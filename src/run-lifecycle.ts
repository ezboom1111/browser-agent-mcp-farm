// Evidence-run retention / lifecycle (master-plan P6, data-lifecycle domain). Captured
// runs hold page bytes, screenshots, and — on read-write leases — session-derived
// artifacts, so an operator needs a first-class way to purge a single run and to sweep
// a runs root by age. Deliberately conservative: it only deletes a directory that looks
// like an evidence run (contains an artifacts.jsonl ledger) unless explicitly forced,
// so a mistyped path cannot wipe an unrelated tree. `now` is injectable for testing.

import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RUN_LEDGER = "artifacts.jsonl";
// The byte-heavy artifact directories. `archiveRun` strips these (screenshots + downloaded media) while
// keeping the cheap, high-value index — the ledger, claims/citations, report, structured metadata, and
// raw html/text — so an old run stays SEARCHABLE and its text claims stay re-verifiable, only its bulky
// image/media bytes are reclaimed. (raw/ html+text is small and is the actual content, so it is kept.)
const HEAVY_RUN_DIRS = ["screenshots", "media"];
const RETENTION_MARKER = ".retention.json";

export interface PurgeRunResult {
  runDir: string;
  removed: boolean;
  reason?: string;
}

export interface PruneRunsOptions {
  maxAgeMs: number;
  now?: number;
  dryRun?: boolean;
}

export interface PrunedRun {
  runDir: string;
  ageMs: number;
}

export interface PruneRunsResult {
  root: string;
  scanned: number;
  removed: PrunedRun[];
  kept: PrunedRun[];
  dryRun: boolean;
}

async function looksLikeRun(dir: string): Promise<boolean> {
  const info = await stat(join(dir, RUN_LEDGER)).catch(() => null);
  return info?.isFile() ?? false;
}

// Age of a run, measured from the most recent modification of its ledger (robust and
// deterministic; the ledger is appended throughout a run).
async function runAgeMs(dir: string, now: number): Promise<number | null> {
  const info = await stat(join(dir, RUN_LEDGER)).catch(() => null);
  if (info === null) {
    return null;
  }
  return Math.max(0, now - info.mtimeMs);
}

// Delete a single evidence run. Refuses a directory that is not a recognizable run
// unless `force` is set, so a wrong path is a no-op rather than a destructive surprise.
export async function purgeRun(runDir: string, options: { force?: boolean } = {}): Promise<PurgeRunResult> {
  if (options.force !== true && !(await looksLikeRun(runDir))) {
    return { runDir, removed: false, reason: `not an evidence run (no ${RUN_LEDGER}); pass force to override` };
  }
  await rm(runDir, { recursive: true, force: true });
  return { runDir, removed: true };
}

// Sweep a runs root, removing (or, in dry-run, just reporting) every immediate
// sub-run older than maxAgeMs. Non-run subdirectories are ignored.
export async function pruneRuns(root: string, options: PruneRunsOptions): Promise<PruneRunsResult> {
  const now = options.now ?? Date.now();
  const dryRun = options.dryRun === true;
  const result: PruneRunsResult = { root, scanned: 0, removed: [], kept: [], dryRun };

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = join(root, entry.name);
    if (!(await looksLikeRun(dir))) {
      continue;
    }
    result.scanned += 1;
    const ageMs = await runAgeMs(dir, now);
    if (ageMs === null) {
      continue;
    }
    if (ageMs > options.maxAgeMs) {
      if (!dryRun) {
        await rm(dir, { recursive: true, force: true });
      }
      result.removed.push({ runDir: dir, ageMs });
    } else {
      result.kept.push({ runDir: dir, ageMs });
    }
  }
  return result;
}

/** Total size (bytes) of a directory tree. Best-effort: unreadable entries count as 0. */
export async function runSizeBytes(dir: string): Promise<number> {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await runSizeBytes(path);
    } else {
      const info = await stat(path).catch(() => null);
      total += info?.size ?? 0;
    }
  }
  return total;
}

export interface PruneBudgetOptions {
  maxBytes: number;
  now?: number;
  dryRun?: boolean;
}

export interface BudgetedRun {
  runDir: string;
  bytes: number;
  ageMs: number;
}

export interface PruneBudgetResult {
  root: string;
  maxBytes: number;
  totalBytesBefore: number;
  totalBytesAfter: number;
  removed: BudgetedRun[];
  kept: BudgetedRun[];
  dryRun: boolean;
}

// Enforce a disk budget over a runs root: delete the OLDEST runs (by ledger mtime) until the total is
// within maxBytes. The newest runs are always kept (they are the ones a user is most likely to still
// need). Non-run subdirectories are ignored, and a budget already satisfied removes nothing.
export async function pruneRunsByBudget(root: string, options: PruneBudgetOptions): Promise<PruneBudgetResult> {
  const now = options.now ?? Date.now();
  const dryRun = options.dryRun === true;
  const result: PruneBudgetResult = { root, maxBytes: options.maxBytes, totalBytesBefore: 0, totalBytesAfter: 0, removed: [], kept: [], dryRun };

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return result;
  }

  const runs: BudgetedRun[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = join(root, entry.name);
    if (!(await looksLikeRun(dir))) {
      continue;
    }
    runs.push({ runDir: dir, bytes: await runSizeBytes(dir), ageMs: (await runAgeMs(dir, now)) ?? 0 });
  }

  result.totalBytesBefore = runs.reduce((sum, run) => sum + run.bytes, 0);
  let total = result.totalBytesBefore;
  // Oldest first, so deletion starts from the front (the oldest runs) and stops once within budget.
  runs.sort((a, b) => b.ageMs - a.ageMs);
  for (const run of runs) {
    if (total <= options.maxBytes) {
      result.kept.push(run);
      continue;
    }
    if (!dryRun) {
      await rm(run.runDir, { recursive: true, force: true });
    }
    result.removed.push(run);
    total -= run.bytes;
  }
  result.totalBytesAfter = total;
  return result;
}

export interface ArchiveRunResult {
  runDir: string;
  archived: boolean;
  reclaimedBytes: number;
  strippedDirs: string[];
  reason?: string;
}

// Tiered retention: reclaim a run's bulky bytes (screenshots + media) while KEEPING its index, so the
// run stays listable/searchable and its text claims stay re-verifiable. Writes a `.retention.json`
// marker recording what was stripped, so a later re-verify of a stripped VISUAL artifact reports an
// honest "archived" provenance rather than looking like tampering. Refuses a non-run directory.
export async function archiveRun(runDir: string, options: { dryRun?: boolean; now?: number } = {}): Promise<ArchiveRunResult> {
  if (!(await looksLikeRun(runDir))) {
    return { runDir, archived: false, reclaimedBytes: 0, strippedDirs: [], reason: `not an evidence run (no ${RUN_LEDGER})` };
  }
  const strippedDirs: string[] = [];
  let reclaimedBytes = 0;
  for (const heavy of HEAVY_RUN_DIRS) {
    const dir = join(runDir, heavy);
    const size = await runSizeBytes(dir);
    if (size === 0) {
      continue; // absent or already empty
    }
    reclaimedBytes += size;
    strippedDirs.push(heavy);
    if (options.dryRun !== true) {
      await rm(dir, { recursive: true, force: true });
    }
  }
  if (options.dryRun !== true && strippedDirs.length > 0) {
    const marker = { archivedAt: new Date(options.now ?? Date.now()).toISOString(), strippedDirs, reclaimedBytes, note: "Bulky artifact bytes were reclaimed; the ledger/claims/report/raw index is preserved. Re-verification of a stripped visual artifact will report it missing-by-archival, not tampered." };
    await writeFile(join(runDir, RETENTION_MARKER), `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  }
  return { runDir, archived: strippedDirs.length > 0, reclaimedBytes, strippedDirs };
}

export interface AutoPruneConfig {
  root: string;
  maxAgeDays?: number;
  maxBytes?: number;
  now?: number;
  dryRun?: boolean;
}

export interface AutoPruneResult {
  aged?: PruneRunsResult;
  budgeted?: PruneBudgetResult;
}

// Apply the configured retention to a runs root: an age sweep (if maxAgeDays > 0) then a disk-budget
// sweep (if maxBytes set). Pure over its config (no env, no logging) so it is directly testable; the
// CLI reads env and renders a summary around it.
export async function autoPruneRunsRoot(config: AutoPruneConfig): Promise<AutoPruneResult> {
  const result: AutoPruneResult = {};
  const baseOptions = config.dryRun === true ? { dryRun: true } : {};
  const nowOption = config.now === undefined ? {} : { now: config.now };
  if (config.maxAgeDays !== undefined && Number.isFinite(config.maxAgeDays) && config.maxAgeDays > 0) {
    result.aged = await pruneRuns(config.root, { maxAgeMs: config.maxAgeDays * 24 * 60 * 60 * 1000, ...baseOptions, ...nowOption });
  }
  if (config.maxBytes !== undefined) {
    result.budgeted = await pruneRunsByBudget(config.root, { maxBytes: config.maxBytes, ...baseOptions, ...nowOption });
  }
  return result;
}

// Build an auto-prune config from environment variables, or undefined when FARM_RUNS_ROOT is unset
// (the opt-in switch). Kept here (not in the CLI) so the env-parsing branches are unit-tested.
export function autoPruneConfigFromEnv(env: Record<string, string | undefined>): AutoPruneConfig | undefined {
  const root = env.FARM_RUNS_ROOT;
  if (root === undefined || root.length === 0) {
    return undefined;
  }
  const config: AutoPruneConfig = { root };
  const days = Number(env.FARM_RUNS_MAX_AGE_DAYS ?? "");
  if (Number.isFinite(days) && days > 0) {
    config.maxAgeDays = days;
  }
  const maxBytes = env.FARM_RUNS_MAX_BYTES === undefined ? undefined : parseByteSize(env.FARM_RUNS_MAX_BYTES);
  if (maxBytes !== undefined) {
    config.maxBytes = maxBytes;
  }
  return config;
}

/** Parse a byte size like "5GB", "500mb", "1024" into bytes. undefined on a malformed value. */
export function parseByteSize(value: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?\s*$/i.exec(value);
  if (match === null) {
    return undefined;
  }
  const amount = Number(match[1]);
  const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
  const unit = (match[2] ?? "b").toLowerCase();
  return Math.floor(amount * (multipliers[unit] ?? 1));
}
