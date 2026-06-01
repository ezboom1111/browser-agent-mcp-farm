import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

// Content-addressed capture cache (C4) — the deterministic, correctness-critical core. Keyed by
// EVERY byte-affecting input plus a coarse time bucket, so two runs that would capture identical
// bytes can replay a prior registered capture (keeping its original sha256) instead of re-launching.
//
// For a VERIFICATION tool, serving stale bytes as current evidence is a hazard, so the design is
// deliberately conservative (these are the adversarial-review mustFixes, enforced here):
//  - Unresolved engine => NON-cacheable. computeCaptureCacheKey returns null when browserVersion is
//    "unknown" (e.g. a persistent-profile run), so two different binaries can never collide on one key.
//  - Only a BARE ephemeral lease is cacheable (no fingerprint/credentials). That gate lives at the
//    call site (lease-manager.isBareEphemeralLease) — this module assumes a bare profile and keys on
//    the run defaults; a caller MUST NOT cache a fingerprinted/credentialed lease.
//  - Freshness defaults to <= 1 hour (NOT a day): both the time bucket and the TTL are clamped to
//    MAX_CACHE_TTL_SEC, and a replay records its numeric staleness age.
//  - The cache directory is scoped per run-root (NOT a single global ~/.gstack dir), so one
//    agent/process does not silently serve another's bytes as first-party.
//
// NOTE: the hot-path replay wiring (read a fresh hit -> re-register the bytes -> label the page
// claim "cached_capture" with its staleness age -> skip the browser) is intentionally a separate,
// conservative follow-up: for a verification tool that wiring must be opt-in and is the most
// freshness-sensitive change, so it is not enabled by default here. This module is its foundation.

export const MAX_CACHE_TTL_SEC = 3600;
export const DEFAULT_CACHE_TTL_SEC = 3600;
export const DEFAULT_TIME_BUCKET_SEC = 3600;

export interface CaptureCacheProfile {
  url: string;
  captureProfile: "text" | "full";
  launchArgsProfile: "default" | "minimal";
  /** From BrowserPool.engineProvenance(): the resolved channel + browser version. */
  resolvedChannel: string;
  browserVersion: string;
  sampleFrames: boolean;
  viewport?: string;
  locale?: string;
  timezoneId?: string;
  userAgent?: string;
  waitMs?: number;
  settleMs?: number;
}

export interface CaptureCacheKeyOptions {
  /** Coarse bucket width; clamped to [1, MAX_CACHE_TTL_SEC]. */
  timeBucketSec?: number;
  /** Injected wall-clock ms, so key computation is deterministic + testable. */
  nowMs: number;
}

/** True when the engine is fully resolved (a real browser launched and reported its version). */
export function isEngineResolved(browserVersion: string): boolean {
  return browserVersion.length > 0 && browserVersion !== "unknown";
}

function clampSeconds(sec: number): number {
  return Math.max(1, Math.min(MAX_CACHE_TTL_SEC, Math.floor(sec)));
}

/** The cache key for this run, or null if it is NON-cacheable (unresolved engine). */
export function computeCaptureCacheKey(profile: CaptureCacheProfile, opts: CaptureCacheKeyOptions): string | null {
  if (!isEngineResolved(profile.browserVersion)) {
    return null;
  }
  const bucketSec = clampSeconds(opts.timeBucketSec ?? DEFAULT_TIME_BUCKET_SEC);
  const bucket = Math.floor(opts.nowMs / 1000 / bucketSec);
  // Canonical, order-stable material over EVERY byte-affecting field + the time bucket. Omitting any
  // of these would let a different-engine / different-viewport / different-settle capture collide.
  const material = JSON.stringify([
    profile.url,
    profile.captureProfile,
    profile.launchArgsProfile,
    profile.resolvedChannel,
    profile.browserVersion,
    profile.sampleFrames,
    profile.viewport ?? "default",
    profile.locale ?? "default",
    profile.timezoneId ?? "default",
    profile.userAgent ?? "default",
    profile.waitMs ?? -1,
    profile.settleMs ?? -1,
    bucket
  ]);
  return createHash("sha256").update(material, "utf8").digest("hex");
}

/** Fresh when the entry's age is within the TTL (clamped to <= 1h) and not in the future. */
export function isCacheEntryFresh(capturedAtMs: number, nowMs: number, ttlSec: number = DEFAULT_CACHE_TTL_SEC): boolean {
  const ageMs = nowMs - capturedAtMs;
  return ageMs >= 0 && ageMs <= clampSeconds(ttlSec) * 1000;
}

export function stalenessAgeMs(capturedAtMs: number, nowMs: number): number {
  return Math.max(0, nowMs - capturedAtMs);
}

/** Per-run-root cache directory (NOT a single global dir) — cross-agent replay stays opt-in. */
export function captureCacheDir(runRoot: string): string {
  return resolve(runRoot, ".capture-cache");
}

export interface CachedCaptureArtifact {
  relPath: string;
  sha256: string;
  evidenceKind: string;
}

export interface CachedCaptureEntry {
  key: string;
  url: string;
  capturedAtMs: number;
  /** Run-dir name (basename) under the cache root that holds the cached bytes; replay reads from it. */
  runDirName?: string;
  artifacts: CachedCaptureArtifact[];
}

// Pre-launch engine resolution (D2 replay wiring). The cache key needs the resolved browser version,
// which is only known AFTER a launch — so to ever SKIP a launch we persist the engine identity beside
// the cache after a real capture, STAMPED with the installed Playwright package version (readable with
// no launch). A later run trusts that persisted browserVersion to compute the key ONLY when the
// Playwright version still matches; otherwise the bundled Chromium build could differ, so we decline
// to replay and launch instead. This closes the "stale persisted engine" hole cheaply and safely.
export interface EngineIdentity {
  channel: string;
  browserVersion: string;
  playwrightVersion: string;
}

const ENGINE_IDENTITY_FILE = "engine-identity.json";

/** The installed Playwright package version, or undefined if it cannot be read (best-effort). */
export function playwrightPackageVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("playwright/package.json") as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

export async function readEngineIdentity(runRoot: string): Promise<EngineIdentity | undefined> {
  const path = join(captureCacheDir(runRoot), ENGINE_IDENTITY_FILE);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<EngineIdentity>;
    if (typeof parsed.channel === "string" && typeof parsed.browserVersion === "string" && typeof parsed.playwrightVersion === "string" && isEngineResolved(parsed.browserVersion)) {
      return { channel: parsed.channel, browserVersion: parsed.browserVersion, playwrightVersion: parsed.playwrightVersion };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function writeEngineIdentity(runRoot: string, identity: EngineIdentity): Promise<void> {
  const dir = captureCacheDir(runRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ENGINE_IDENTITY_FILE), `${JSON.stringify(identity, null, 2)}\n`, "utf8");
}

/** Look up a fresh cached entry for key under runRoot, or undefined (miss/stale/tampered). */
export async function lookupCachedCapture(runRoot: string, key: string, nowMs: number, ttlSec: number = DEFAULT_CACHE_TTL_SEC): Promise<CachedCaptureEntry | undefined> {
  const path = join(captureCacheDir(runRoot), `${key}.json`);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const entry = JSON.parse(await readFile(path, "utf8")) as CachedCaptureEntry;
    if (entry.key !== key || !isCacheEntryFresh(entry.capturedAtMs, nowMs, ttlSec)) {
      return undefined;
    }
    return entry;
  } catch {
    return undefined;
  }
}

export async function storeCachedCapture(runRoot: string, entry: CachedCaptureEntry): Promise<void> {
  const dir = captureCacheDir(runRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${entry.key}.json`), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}
