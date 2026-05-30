// Append-only, tamper-evident gate-verdict decision log (master-plan P5/P6, trust
// domain). Every claim-gate verdict can be appended as a hash-chained NDJSON entry:
// each entry carries the previous entry's hash, so altering or removing any historical
// verdict breaks the chain and is detectable by verifyDecisionLog. This makes the
// gate's decision history auditable and non-repudiable without a database.
//
// The caller supplies the timestamp, so the chain is deterministic and testable; the
// hash covers every recorded field except the entry hash itself.

import { appendFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const GENESIS_HASH = "0".repeat(64);

export interface DecisionInput {
  runDir: string;
  ok: boolean;
  claimCount: number;
  errorCount: number;
  at: string;
  mode?: string;
}

export interface DecisionEntry extends DecisionInput {
  seq: number;
  prevHash: string;
  entryHash: string;
}

export interface DecisionLogVerification {
  ok: boolean;
  entryCount: number;
  brokenAt?: number;
  reason?: string;
}

// Stable, field-ordered serialization of everything the hash commits to.
function canonical(entry: Omit<DecisionEntry, "entryHash">): string {
  return JSON.stringify({
    seq: entry.seq,
    at: entry.at,
    runDir: entry.runDir,
    mode: entry.mode ?? null,
    ok: entry.ok,
    claimCount: entry.claimCount,
    errorCount: entry.errorCount,
    prevHash: entry.prevHash
  });
}

function hashEntry(entry: Omit<DecisionEntry, "entryHash">): string {
  return createHash("sha256").update(canonical(entry)).digest("hex");
}

async function readEntries(logPath: string): Promise<DecisionEntry[]> {
  const text = await readFile(logPath, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DecisionEntry);
}

// Append one verdict, chaining it to the current tail of the log.
export async function appendDecision(logPath: string, input: DecisionInput): Promise<DecisionEntry> {
  const entries = await readEntries(logPath);
  const last = entries.at(-1);
  const base: Omit<DecisionEntry, "entryHash"> = {
    seq: (last?.seq ?? 0) + 1,
    prevHash: last?.entryHash ?? GENESIS_HASH,
    runDir: input.runDir,
    ok: input.ok,
    claimCount: input.claimCount,
    errorCount: input.errorCount,
    at: input.at,
    ...(input.mode === undefined ? {} : { mode: input.mode })
  };
  const entry: DecisionEntry = { ...base, entryHash: hashEntry(base) };
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

// Re-walk the chain: sequence continuity, prevHash links, and per-entry hash integrity.
export async function verifyDecisionLog(logPath: string): Promise<DecisionLogVerification> {
  const entries = await readEntries(logPath);
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;

  for (const entry of entries) {
    if (entry.seq !== expectedSeq) {
      return { ok: false, entryCount: entries.length, brokenAt: entry.seq, reason: "sequence out of order" };
    }
    if (entry.prevHash !== prevHash) {
      return { ok: false, entryCount: entries.length, brokenAt: entry.seq, reason: "prevHash mismatch (chain broken)" };
    }
    const { entryHash, ...base } = entry;
    if (hashEntry(base) !== entryHash) {
      return { ok: false, entryCount: entries.length, brokenAt: entry.seq, reason: "entryHash mismatch (entry tampered)" };
    }
    prevHash = entryHash;
    expectedSeq += 1;
  }

  return { ok: true, entryCount: entries.length };
}
