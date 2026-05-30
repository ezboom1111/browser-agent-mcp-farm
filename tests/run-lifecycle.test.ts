import { mkdtemp, mkdir, rm, writeFile, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { purgeRun, pruneRuns } from "../src/run-lifecycle.js";

let roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
  roots = [];
});

async function makeRun(root: string, name: string, ledgerMtimeMs?: number): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  const ledger = join(dir, "artifacts.jsonl");
  await writeFile(ledger, '{"path":"raw/x.html","evidence_kind":"page_html"}\n', "utf8");
  if (ledgerMtimeMs !== undefined) {
    const when = new Date(ledgerMtimeMs);
    await utimes(ledger, when, when);
  }
  return dir;
}

describe("purgeRun", () => {
  it("removes a recognizable evidence run", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-lifecycle-"));
    roots.push(root);
    const run = await makeRun(root, "run-1");

    const result = await purgeRun(run);
    expect(result.removed).toBe(true);
    await expect(stat(run)).rejects.toBeTruthy();
  });

  it("refuses a non-run directory unless forced", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-lifecycle-"));
    roots.push(root);
    const notRun = join(root, "important");
    await mkdir(notRun, { recursive: true });
    await writeFile(join(notRun, "keep.txt"), "do not delete", "utf8");

    const refused = await purgeRun(notRun);
    expect(refused.removed).toBe(false);
    expect(refused.reason).toMatch(/not an evidence run/);
    await expect(stat(notRun)).resolves.toBeTruthy();

    const forced = await purgeRun(notRun, { force: true });
    expect(forced.removed).toBe(true);
  });
});

describe("pruneRuns", () => {
  it("removes runs older than maxAge and keeps fresh ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-lifecycle-"));
    roots.push(root);
    const now = 1_000_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;
    const oldRun = await makeRun(root, "old", now - 10 * dayMs);
    const freshRun = await makeRun(root, "fresh", now - 1 * dayMs);
    await mkdir(join(root, "not-a-run"), { recursive: true }); // ignored (no ledger)

    const result = await pruneRuns(root, { maxAgeMs: 7 * dayMs, now });
    expect(result.scanned).toBe(2);
    expect(result.removed.map((entry) => entry.runDir)).toEqual([oldRun]);
    expect(result.kept.map((entry) => entry.runDir)).toEqual([freshRun]);
    await expect(stat(oldRun)).rejects.toBeTruthy();
    await expect(stat(freshRun)).resolves.toBeTruthy();
  });

  it("dry-run reports without deleting", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-lifecycle-"));
    roots.push(root);
    const now = 1_000_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;
    const oldRun = await makeRun(root, "old", now - 10 * dayMs);

    const result = await pruneRuns(root, { maxAgeMs: 7 * dayMs, now, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.removed.map((entry) => entry.runDir)).toEqual([oldRun]);
    await expect(stat(oldRun)).resolves.toBeTruthy(); // still there
  });
});
