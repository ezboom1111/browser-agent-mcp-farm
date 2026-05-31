import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeCaptureCacheKey, isCacheEntryFresh, isEngineResolved, lookupCachedCapture, storeCachedCapture, stalenessAgeMs, MAX_CACHE_TTL_SEC, type CaptureCacheProfile } from "../src/capture-cache.js";

// C4 (v0.5.0): the content-addressed capture cache core. Conservative-by-design for a verification
// tool: unresolved engine => non-cacheable; the key includes every byte-affecting field; freshness
// is clamped to <= 1h; the cache dir is per-run-root.

const NOW = 1_700_000_000_000; // fixed injected clock

function profile(extra: Partial<CaptureCacheProfile> = {}): CaptureCacheProfile {
  return { url: "https://example.com/p", captureProfile: "full", launchArgsProfile: "default", resolvedChannel: "chromium", browserVersion: "131.0.6778.0", sampleFrames: true, ...extra };
}

describe("computeCaptureCacheKey (C4)", () => {
  it("is stable for an identical profile + time bucket", () => {
    expect(computeCaptureCacheKey(profile(), { nowMs: NOW })).toBe(computeCaptureCacheKey(profile(), { nowMs: NOW }));
  });

  it("returns null (NON-cacheable) when the engine is unresolved", () => {
    expect(isEngineResolved("unknown")).toBe(false);
    expect(computeCaptureCacheKey(profile({ browserVersion: "unknown" }), { nowMs: NOW })).toBeNull();
    expect(computeCaptureCacheKey(profile({ browserVersion: "" }), { nowMs: NOW })).toBeNull();
  });

  it("changes when ANY byte-affecting field changes", () => {
    const baseKey = computeCaptureCacheKey(profile(), { nowMs: NOW });
    const mutate: Array<Partial<CaptureCacheProfile>> = [
      { url: "https://example.com/q" },
      { captureProfile: "text" },
      { launchArgsProfile: "minimal" },
      { resolvedChannel: "msedge" },
      { browserVersion: "131.0.6778.1" },
      { sampleFrames: false },
      { viewport: "800x600" },
      { locale: "ja-JP" },
      { timezoneId: "Asia/Tokyo" },
      { userAgent: "UA2" },
      { waitMs: 5000 },
      { settleMs: 500 }
    ];
    for (const m of mutate) {
      expect(computeCaptureCacheKey(profile(m), { nowMs: NOW })).not.toBe(baseKey);
    }
  });

  it("changes when the time bucket rolls over", () => {
    const k1 = computeCaptureCacheKey(profile(), { nowMs: NOW, timeBucketSec: 3600 });
    const k2 = computeCaptureCacheKey(profile(), { nowMs: NOW + 3600_000, timeBucketSec: 3600 });
    expect(k1).not.toBe(k2);
  });
});

describe("freshness (C4) is clamped to <= 1h", () => {
  it("treats a <=1h-old entry as fresh and an older one as stale", () => {
    expect(isCacheEntryFresh(NOW - 30 * 60_000, NOW)).toBe(true);
    expect(isCacheEntryFresh(NOW - 2 * 3600_000, NOW)).toBe(false);
  });

  it("never honours a TTL beyond the max (a 1-day ttl is clamped to 1h)", () => {
    // 90 minutes old, caller asks for a 1-day ttl: still stale because ttl is clamped to 1h.
    expect(isCacheEntryFresh(NOW - 90 * 60_000, NOW, 86_400)).toBe(false);
    expect(MAX_CACHE_TTL_SEC).toBe(3600);
  });

  it("records numeric staleness age", () => {
    expect(stalenessAgeMs(NOW - 1234, NOW)).toBe(1234);
  });
});

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
  roots = [];
});

describe("store/lookup is per-run-root + miss on stale/tamper (C4)", () => {
  it("stores under runRoot and looks up a fresh entry; misses when stale", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "farm-cache-"));
    roots.push(runRoot);
    const key = computeCaptureCacheKey(profile(), { nowMs: NOW }) as string;
    await storeCachedCapture(runRoot, { key, url: "https://example.com/p", capturedAtMs: NOW, artifacts: [{ relPath: "raw/p.html", sha256: "ab".repeat(32), evidenceKind: "page_html" }] });

    const hit = await lookupCachedCapture(runRoot, key, NOW + 60_000);
    expect(hit?.artifacts[0]?.sha256).toBe("ab".repeat(32));

    const stale = await lookupCachedCapture(runRoot, key, NOW + 2 * 3600_000);
    expect(stale).toBeUndefined();
  });

  it("a different run-root does not see another run-root's entry", async () => {
    const runA = await mkdtemp(join(tmpdir(), "farm-cacheA-"));
    const runB = await mkdtemp(join(tmpdir(), "farm-cacheB-"));
    roots.push(runA, runB);
    const key = computeCaptureCacheKey(profile(), { nowMs: NOW }) as string;
    await storeCachedCapture(runA, { key, url: "https://example.com/p", capturedAtMs: NOW, artifacts: [] });
    expect(await lookupCachedCapture(runB, key, NOW + 1000)).toBeUndefined();
  });
});
