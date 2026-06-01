// Append-only, tamper-evident TRANSPARENCY LOG for evidence-bundle Merkle roots (capture-binding Tier 2,
// the ordering anchor). Each anchored bundle is a hash-chained NDJSON entry carrying the previous entry's
// hash, so reordering, removing, or altering any anchored bundle breaks the chain and is detected by
// verifyTimestampLog. A near-clone of decision-log.ts, but it anchors bundle merkleRoots instead of gate
// verdicts and adds an honestly-scoped time dimension.
//
// HONESTY (deliberate, no theater) — what this PROVES vs what it does NOT:
//   • PROVES (deterministic, local, no external dependency): the RELATIVE ORDER of anchored bundles and
//     that the log was not edited after the fact. Entry N provably precedes entry N+1. Label: "ordering".
//   • Does NOT prove (without a TSA): the absolute wall-clock time. The `at` field is the LOCAL machine's
//     claimed time and is forgeable. The local chain says nothing about when, in real time, an entry was
//     made — only its order relative to its neighbours.
//   • A genuine time proof requires an external RFC-3161 Time-Stamp Authority (TSA) token computed over
//     the entry hash. When one is supplied the entry is labeled "tsa" and carries the opaque token. The
//     TSA client is an INJECTED SEAM (default: none) — wiring a live or offline TSA is opt-in and out of
//     the deterministic core, and this module deliberately does NOT hand-roll the ASN.1/RFC-3161 crypto
//     (that would be false assurance); a verifier checks the token with `openssl ts -verify` against the
//     TSA's CA. The token lives OUTSIDE the chain hash, so a tamperer can only STRIP a token (degrading
//     "tsa" → "ordering", a weaker claim) — never forge one over a given entry hash.

import { appendFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const GENESIS_HASH = "0".repeat(64);

/** An opaque RFC-3161 time-stamp token. This module never parses it; a verifier checks it with openssl. */
export interface TsaToken {
  /** Base64 DER RFC-3161 TimeStampToken, computed by the TSA over the entry hash. Opaque here. */
  token: string;
  /** The TSA endpoint the token came from (provenance only; not trusted by itself). */
  tsaUrl: string;
  /** The TSA-asserted time as the TSA reported it (informational; the authoritative value is in the token). */
  genTime?: string;
}

/**
 * Injected seam so live/offline-TSA wiring stays out of the deterministic core (deferred, opt-in).
 * Receives the just-computed entry hash; returns a token over it, or undefined to fall back to ordering.
 */
export type TsaClient = (entryHash: string) => Promise<TsaToken | undefined>;

export interface AnchorInput {
  /** The bundle Merkle root being anchored. */
  merkleRoot: string;
  /** Local claimed time — UNTRUSTED for absolute time; only chain order is proven without a TSA. */
  at: string;
  runDir?: string;
  label?: string;
}

export type TimeProofKind = "ordering" | "tsa";

export interface AnchorEntry {
  seq: number;
  prevHash: string;
  at: string;
  merkleRoot: string;
  runDir?: string;
  label?: string;
  /** Present only when a TSA token was obtained; lives OUTSIDE the chain hash (strip-only, never forge). */
  tsa?: TsaToken;
  entryHash: string;
}

export interface AnchorVerification {
  ok: boolean;
  entryCount: number;
  /** How many entries carry a (recorded-but-not-cryptographically-verified-here) TSA token. */
  tsaAnchoredCount: number;
  /** How many entries are ordering-only (relative order proven; absolute time NOT proven). */
  orderingOnlyCount: number;
  brokenAt?: number;
  reason?: string;
  /** Load-bearing honesty: this function proves chain integrity + ordering, NOT TSA tokens or wall time. */
  note: string;
}

const VERIFY_NOTE =
  "Chain integrity + relative ordering verified locally. TSA tokens (if any) are recorded but NOT cryptographically verified here — verify them offline with `openssl ts -verify` against the TSA CA. Absolute wall-clock time is proven ONLY for tsa-anchored entries; ordering-only entries prove relative order, not time.";

/** Derive the honest time-proof label for an entry (computed, never stored in the hash). */
export function timeProofKind(entry: Pick<AnchorEntry, "tsa">): TimeProofKind {
  return entry.tsa !== undefined && entry.tsa.token.length > 0 ? "tsa" : "ordering";
}

/** Human-readable, honestly-scoped description of what an entry's time proof actually establishes. */
export function describeAnchor(entry: AnchorEntry): string {
  if (timeProofKind(entry) === "tsa") {
    return `time-anchored (TSA ${entry.tsa?.tsaUrl ?? "?"}): token recorded over the entry hash — verify offline with \`openssl ts -verify\`. Proves the bundle existed no later than the TSA's asserted time.`;
  }
  return "ordering-proven (local): relative order vs other anchored bundles is tamper-evident; absolute wall-clock time is NOT proven (the `at` field is the untrusted local clock).";
}

// Stable, field-ordered serialization of everything the chain hash commits to. Deliberately EXCLUDES the
// tsa token: the token is computed FROM this hash, so it cannot be an input to it, and keeping it outside
// makes token-stripping a detectable downgrade rather than a chain break.
function canonical(entry: Omit<AnchorEntry, "entryHash" | "tsa">): string {
  return JSON.stringify({
    seq: entry.seq,
    at: entry.at,
    merkleRoot: entry.merkleRoot,
    runDir: entry.runDir ?? null,
    label: entry.label ?? null,
    prevHash: entry.prevHash
  });
}

function hashEntry(entry: Omit<AnchorEntry, "entryHash" | "tsa">): string {
  return createHash("sha256").update(canonical(entry)).digest("hex");
}

async function readEntries(logPath: string): Promise<AnchorEntry[]> {
  const text = await readFile(logPath, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AnchorEntry);
}

/**
 * Anchor one bundle Merkle root, chaining it to the current tail of the log. If a TsaClient is supplied
 * it is asked to time-stamp the just-computed entry hash; a returned token is recorded alongside (outside
 * the chain hash). The caller supplies `at` so the chain is deterministic and testable.
 */
export async function appendAnchor(logPath: string, input: AnchorInput, tsaClient?: TsaClient): Promise<AnchorEntry> {
  const entries = await readEntries(logPath);
  const last = entries.at(-1);
  const base: Omit<AnchorEntry, "entryHash" | "tsa"> = {
    seq: (last?.seq ?? 0) + 1,
    prevHash: last?.entryHash ?? GENESIS_HASH,
    at: input.at,
    merkleRoot: input.merkleRoot,
    ...(input.runDir === undefined ? {} : { runDir: input.runDir }),
    ...(input.label === undefined ? {} : { label: input.label })
  };
  const entryHash = hashEntry(base);
  const tsa = tsaClient !== undefined ? await tsaClient(entryHash).catch(() => undefined) : undefined;
  const entry: AnchorEntry = { ...base, ...(tsa === undefined ? {} : { tsa }), entryHash };
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

/** Re-walk the chain: sequence continuity, prevHash links, and per-entry hash integrity. */
export async function verifyTimestampLog(logPath: string): Promise<AnchorVerification> {
  const entries = await readEntries(logPath);
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  let tsaAnchoredCount = 0;

  for (const entry of entries) {
    if (entry.seq !== expectedSeq) {
      return { ok: false, entryCount: entries.length, tsaAnchoredCount, orderingOnlyCount: entries.length - tsaAnchoredCount, brokenAt: entry.seq, reason: "sequence out of order", note: VERIFY_NOTE };
    }
    if (entry.prevHash !== prevHash) {
      return { ok: false, entryCount: entries.length, tsaAnchoredCount, orderingOnlyCount: entries.length - tsaAnchoredCount, brokenAt: entry.seq, reason: "prevHash mismatch (chain broken)", note: VERIFY_NOTE };
    }
    const { entryHash, tsa, ...base } = entry;
    if (hashEntry(base) !== entryHash) {
      return { ok: false, entryCount: entries.length, tsaAnchoredCount, orderingOnlyCount: entries.length - tsaAnchoredCount, brokenAt: entry.seq, reason: "entryHash mismatch (entry tampered)", note: VERIFY_NOTE };
    }
    if (tsa !== undefined && tsa.token.length > 0) {
      tsaAnchoredCount += 1;
    }
    prevHash = entryHash;
    expectedSeq += 1;
  }

  return { ok: true, entryCount: entries.length, tsaAnchoredCount, orderingOnlyCount: entries.length - tsaAnchoredCount, note: VERIFY_NOTE };
}
