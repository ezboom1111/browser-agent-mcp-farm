import { mkdtemp, mkdir, rm, writeFile, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { existsSync } from "node:fs";
import { archiveRun, autoPruneConfigFromEnv, autoPruneRunsRoot, parseByteSize, pruneRuns, pruneRunsByBudget, purgeRun, runSizeBytes } from "../src/run-lifecycle.js";

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

async function makeRichRun(root: string, name: string, opts: { screenshotBytes?: number; mediaBytes?: number; ageMs?: number }): Promise<string> {
  const dir = join(root, name);
  await mkdir(join(dir, "screenshots"), { recursive: true });
  await mkdir(join(dir, "media", "cap"), { recursive: true });
  await mkdir(join(dir, "raw"), { recursive: true });
  await writeFile(join(dir, "raw", "x.txt"), "the cited page text", "utf8");
  await writeFile(join(dir, "screenshots", "s.png"), Buffer.alloc(opts.screenshotBytes ?? 0), "utf8");
  await writeFile(join(dir, "media", "cap", "m.png"), Buffer.alloc(opts.mediaBytes ?? 0), "utf8");
  const ledger = join(dir, "artifacts.jsonl");
  await writeFile(ledger, '{"path":"raw/x.txt","evidence_kind":"page_text"}\n', "utf8");
  if (opts.ageMs !== undefined) {
    const when = new Date(opts.ageMs);
    await utimes(ledger, when, when);
  }
  return dir;
}

describe("parseByteSize", () => {
  it("parses byte units and rejects garbage", () => {
    expect(parseByteSize("1024")).toBe(1024);
    expect(parseByteSize("5GB")).toBe(5 * 1024 ** 3);
    expect(parseByteSize("500mb")).toBe(500 * 1024 ** 2);
    expect(parseByteSize("1.5 kb")).toBe(Math.floor(1.5 * 1024));
    expect(parseByteSize("nope")).toBeUndefined();
    expect(parseByteSize("")).toBeUndefined();
  });
});

describe("runSizeBytes", () => {
  it("sums a run's bytes recursively", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-size-"));
    roots.push(root);
    const run = await makeRichRun(root, "r", { screenshotBytes: 1000, mediaBytes: 500 });
    const size = await runSizeBytes(run);
    expect(size).toBeGreaterThanOrEqual(1500); // screenshots + media + the small text/ledger
  });
});

describe("pruneRunsByBudget", () => {
  it("deletes the OLDEST runs until the total fits the budget, keeping the newest", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-budget-"));
    roots.push(root);
    const now = 1_000_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;
    const old = await makeRichRun(root, "old", { screenshotBytes: 100_000, ageMs: now - 9 * dayMs });
    const mid = await makeRichRun(root, "mid", { screenshotBytes: 100_000, ageMs: now - 5 * dayMs });
    const fresh = await makeRichRun(root, "fresh", { screenshotBytes: 100_000, ageMs: now - 1 * dayMs });

    // Budget ~ 250KB: total is ~300KB+, so the single oldest run must go, the two newest stay.
    const result = await pruneRunsByBudget(root, { maxBytes: 250_000, now });
    expect(result.removed.map((r) => r.runDir)).toEqual([old]);
    expect(result.kept.map((r) => r.runDir).sort()).toEqual([fresh, mid].sort());
    expect(existsSync(old)).toBe(false);
    expect(existsSync(mid)).toBe(true);
    expect(existsSync(fresh)).toBe(true);
    expect(result.totalBytesAfter).toBeLessThanOrEqual(result.totalBytesBefore);
  });

  it("removes nothing when already under budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-budget2-"));
    roots.push(root);
    await makeRichRun(root, "a", { screenshotBytes: 1000 });
    const result = await pruneRunsByBudget(root, { maxBytes: 10 ** 9 });
    expect(result.removed).toEqual([]);
  });
});

describe("archiveRun (tiered)", () => {
  it("strips screenshots + media, keeps the ledger/raw index, and writes a marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-archive-"));
    roots.push(root);
    const run = await makeRichRun(root, "r", { screenshotBytes: 50_000, mediaBytes: 30_000 });

    const result = await archiveRun(run);
    expect(result.archived).toBe(true);
    expect(result.strippedDirs.sort()).toEqual(["media", "screenshots"]);
    expect(result.reclaimedBytes).toBeGreaterThanOrEqual(80_000);
    expect(existsSync(join(run, "screenshots"))).toBe(false);
    expect(existsSync(join(run, "media"))).toBe(false);
    expect(existsSync(join(run, "raw", "x.txt"))).toBe(true); // index preserved
    expect(existsSync(join(run, "artifacts.jsonl"))).toBe(true);
    expect(existsSync(join(run, ".retention.json"))).toBe(true);
  });

  it("dry-run reports reclaimable bytes without deleting", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-archive-dry-"));
    roots.push(root);
    const run = await makeRichRun(root, "r", { screenshotBytes: 50_000 });
    const result = await archiveRun(run, { dryRun: true });
    expect(result.reclaimedBytes).toBeGreaterThanOrEqual(50_000);
    expect(existsSync(join(run, "screenshots"))).toBe(true); // untouched
    expect(existsSync(join(run, ".retention.json"))).toBe(false);
  });

  it("refuses a non-run directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-archive-no-"));
    roots.push(root);
    await mkdir(join(root, "plain"), { recursive: true });
    const result = await archiveRun(join(root, "plain"));
    expect(result.archived).toBe(false);
    expect(result.reason).toMatch(/not an evidence run/);
  });
});

describe("autoPruneRunsRoot", () => {
  it("applies the age sweep then the budget sweep over a root", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-auto-"));
    roots.push(root);
    const now = 1_000_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;
    const ancient = await makeRichRun(root, "ancient", { screenshotBytes: 100_000, ageMs: now - 40 * dayMs });
    const old = await makeRichRun(root, "old", { screenshotBytes: 100_000, ageMs: now - 9 * dayMs });
    const fresh = await makeRichRun(root, "fresh", { screenshotBytes: 100_000, ageMs: now - 1 * dayMs });

    const result = await autoPruneRunsRoot({ root, maxAgeDays: 30, maxBytes: 150_000, now });
    // Age sweep removes the 40-day run; the budget sweep then drops the next-oldest until <= 150KB.
    expect(result.aged?.removed.map((r) => r.runDir)).toEqual([ancient]);
    expect(existsSync(ancient)).toBe(false);
    expect(result.budgeted?.removed.map((r) => r.runDir)).toEqual([old]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it("is a no-op with no age/budget configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-auto-noop-"));
    roots.push(root);
    await makeRichRun(root, "a", { screenshotBytes: 1000 });
    const result = await autoPruneRunsRoot({ root });
    expect(result.aged).toBeUndefined();
    expect(result.budgeted).toBeUndefined();
  });
});

describe("autoPruneConfigFromEnv (opt-in switch)", () => {
  it("returns undefined unless FARM_RUNS_ROOT is set", () => {
    expect(autoPruneConfigFromEnv({})).toBeUndefined();
    expect(autoPruneConfigFromEnv({ FARM_RUNS_ROOT: "" })).toBeUndefined();
  });

  it("parses age + budget from env", () => {
    expect(autoPruneConfigFromEnv({ FARM_RUNS_ROOT: "/runs", FARM_RUNS_MAX_AGE_DAYS: "30", FARM_RUNS_MAX_BYTES: "5GB" })).toEqual({ root: "/runs", maxAgeDays: 30, maxBytes: 5 * 1024 ** 3 });
  });

  it("ignores invalid age/budget but keeps the root", () => {
    expect(autoPruneConfigFromEnv({ FARM_RUNS_ROOT: "/runs", FARM_RUNS_MAX_AGE_DAYS: "nope", FARM_RUNS_MAX_BYTES: "bad" })).toEqual({ root: "/runs" });
    expect(autoPruneConfigFromEnv({ FARM_RUNS_ROOT: "/runs", FARM_RUNS_MAX_AGE_DAYS: "0" })).toEqual({ root: "/runs" });
  });
});
