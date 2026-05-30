// Evidence-run retention / lifecycle (master-plan P6, data-lifecycle domain). Captured
// runs hold page bytes, screenshots, and — on read-write leases — session-derived
// artifacts, so an operator needs a first-class way to purge a single run and to sweep
// a runs root by age. Deliberately conservative: it only deletes a directory that looks
// like an evidence run (contains an artifacts.jsonl ledger) unless explicitly forced,
// so a mistyped path cannot wipe an unrelated tree. `now` is injectable for testing.

import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const RUN_LEDGER = "artifacts.jsonl";

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
  return info !== null && info.isFile();
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

  let entries;
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
