import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli, trackTempDirs } from "./helpers/cli-harness.js";

const { dirs, cleanup, makeTempDir } = trackTempDirs();
afterEach(cleanup);

describe("cli coverage-report command", () => {
  it("classifies a maintained source with a fresh passing canary as autonomous_ready", async () => {
    const dir = await makeTempDir("farm-covrep-");
    const golden = join(dir, "golden.json");
    const observation = join(dir, "obs.json");
    const ledger = join(dir, "canary.ndjson");
    await writeFile(golden, JSON.stringify({ recipeKey: "google_search", requiredSelectors: ["#search a"], capturedAt: "2026-05-01T00:00:00.000Z" }), "utf8");
    await writeFile(observation, JSON.stringify({ presentSelectors: ["#search a"], obstructionSignals: [] }), "utf8");

    // Record a fresh passing canary into the ledger.
    const canary = await runCli(["recipe-canary", "--golden-file", golden, "--observation-file", observation, "--canary-ledger", ledger, "--now", "2026-05-29T00:00:00.000Z"]);
    expect(canary.out).toContain('"verdict": "pass"');

    const report = await runCli(["coverage-report", "--platform", "google_search", "--canary-ledger", ledger, "--now", "2026-05-30T00:00:00.000Z", "--format", "json"]);
    const parsed = JSON.parse(report.out) as { entries: Array<{ platform: string; coverageClass: string }>; classCounts: Record<string, number> };
    const entry = parsed.entries.find((e) => e.platform === "google_search");
    expect(entry?.coverageClass).toBe("autonomous_ready");
    expect(parsed.classCounts.autonomous_ready).toBeGreaterThanOrEqual(1);
  });

  it("renders lines and markdown formats", async () => {
    const lines = await runCli(["coverage-report", "--platform", "google_search", "--format", "lines"]);
    expect(lines.out).toContain("coverage-report");

    const md = await runCli(["coverage-report", "--platform", "google_search", "--format", "markdown"]);
    expect(md.out).toContain("# Coverage Report");
    expect(md.out).toContain("| Class | Count |");
  });

  it("rejects an unknown --format", async () => {
    const { exitCode } = await runCli(["coverage-report", "--platform", "google_search", "--format", "bogus"]);
    expect(exitCode).toBe(1);
  });

  it("honors an explicit empty --maintenance set (everything outside the budget)", async () => {
    const report = await runCli(["coverage-report", "--platform", "google_search", "--maintenance", "", "--format", "json"]);
    const parsed = JSON.parse(report.out) as { maintenanceBudget: number; classCounts: Record<string, number> };
    expect(parsed.maintenanceBudget).toBe(0);
    expect(parsed.classCounts.autonomous_ready).toBe(0);
  });
});

describe("cli recipe-canary command (offline replay)", () => {
  it("evaluates a recorded observation and appends a passing verdict to the ledger", async () => {
    const dir = await makeTempDir("farm-canary-cli-");
    const golden = join(dir, "golden.json");
    const obs = join(dir, "obs.json");
    const ledger = join(dir, "canary.ndjson");
    await writeFile(golden, JSON.stringify({ recipeKey: "google_search", requiredSelectors: ["#search a", "div.g h3"], capturedAt: "2026-05-01T00:00:00.000Z" }), "utf8");
    await writeFile(obs, JSON.stringify({ presentSelectors: ["#search a", "div.g h3"], obstructionSignals: [] }), "utf8");

    const { out, exitCode } = await runCli(["recipe-canary", "--golden-file", golden, "--observation-file", obs, "--canary-ledger", ledger, "--now", "2026-05-30T00:00:00.000Z"]);
    expect(out).toContain('"verdict": "pass"');
    expect(exitCode).toBeFalsy();

    const ledgerRaw = await readFile(ledger, "utf8");
    const entry = JSON.parse(ledgerRaw.trim()) as { recipeKey: string; verdict: string };
    expect(entry).toMatchObject({ recipeKey: "google_search", verdict: "pass" });
  });

  it("auto-demotes to needs_recalibration on a missing selector and fails with --fail-on-recalibration", async () => {
    const dir = await makeTempDir("farm-canary-fail-");
    const golden = join(dir, "golden.json");
    const obs = join(dir, "obs.json");
    await writeFile(golden, JSON.stringify({ recipeKey: "google_search", requiredSelectors: ["#search a", "div.g h3"], capturedAt: "2026-05-01T00:00:00.000Z" }), "utf8");
    await writeFile(obs, JSON.stringify({ presentSelectors: ["#search a"], obstructionSignals: [] }), "utf8");

    const { out, exitCode } = await runCli(["recipe-canary", "--golden-file", golden, "--observation-file", obs, "--fail-on-recalibration"]);
    expect(out).toContain('"verdict": "needs_recalibration"');
    expect(out).toContain("div.g h3");
    expect(exitCode).toBe(1);
  });

  it("requires --golden-file", async () => {
    const { exitCode } = await runCli(["recipe-canary"]);
    expect(exitCode).toBe(1);
  });

  it("requires either --observation-file or --url", async () => {
    const dir = await makeTempDir("farm-canary-args-");
    const golden = join(dir, "golden.json");
    await writeFile(golden, JSON.stringify({ recipeKey: "x", requiredSelectors: [], capturedAt: "2026-05-01T00:00:00.000Z" }), "utf8");
    const { out, exitCode } = await runCli(["recipe-canary", "--golden-file", golden]);
    expect(out).toContain("requires --observation-file");
    expect(exitCode).toBe(1);
  });
});
