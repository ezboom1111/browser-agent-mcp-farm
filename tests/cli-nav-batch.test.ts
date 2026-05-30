import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli, trackTempDirs } from "./helpers/cli-harness.js";

const { cleanup, makeTempDir } = trackTempDirs();

afterEach(cleanup);

// A minimal calibration-batch manifest that passes isSourceNavigationCalibrationBatchManifest
// (schemaVersion 1.0 + read_only_selector_probe_batch + string runRoot + array attempts/catalogHints)
// with an EMPTY catalogHints array so promoteSourceNavigationCalibrationBatch iterates zero hints
// and never reads run dirs, describes strategies, or launches a browser.
function emptyCatalogHintsManifest(runRoot: string): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0",
      executionPolicy: "read_only_selector_probe_batch",
      runRoot,
      targetCount: 0,
      repeat: 1,
      concurrency: 1,
      runtime: { headed: false, storagePolicy: "ephemeral" },
      attemptCount: 0,
      succeededCount: 0,
      failedCount: 0,
      attempts: [],
      catalogHints: [],
      warnings: []
    },
    null,
    2
  );
}

// A minimal promotion summary that parseSourceNavigationPromotionSummary accepts
// (schemaVersion 1.0 + explicit_opt_in_only + string outputDir + finite numbers + array groups/warnings)
// with zero groups so reviewSourceNavigationPromotion runs the empty-groups branch in-memory only.
function emptyGroupsPromotionSummary(outputDir: string): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0",
      executionPolicy: "explicit_opt_in_only",
      outputDir,
      groupCount: 0,
      readyGroupCount: 0,
      emptyGroupCount: 0,
      actionFileCount: 0,
      groups: [],
      warnings: []
    },
    null,
    2
  );
}

describe("cli source-navigation-calibrate-batch (offline guards)", () => {
  it("requires --urls-file (arg-validation throw, exit 1)", async () => {
    const { out, exitCode } = await runCli(["source-navigation-calibrate-batch"]);
    expect(out).toContain("source-navigation-calibrate-batch requires --urls-file <path>");
    expect(exitCode).toBe(1);
  });

  it("rejects a non-http(s) target URL in the urls file", async () => {
    const dir = await makeTempDir();
    const targets = join(dir, "targets.txt");
    await writeFile(targets, "file:///tmp/test.html\n", "utf8");
    const { out, exitCode } = await runCli(["source-navigation-calibrate-batch", "--urls-file", targets]);
    expect(out).toContain("Calibration target URL must be http or https: file:///tmp/test.html");
    expect(exitCode).toBe(1);
  });

  it("rejects an empty urls file", async () => {
    const dir = await makeTempDir();
    const targets = join(dir, "empty.txt");
    await writeFile(targets, "   \n", "utf8");
    const { out, exitCode } = await runCli(["source-navigation-calibrate-batch", "--urls-file", targets]);
    expect(out).toContain("Calibration batch target file is empty.");
    expect(exitCode).toBe(1);
  });

  it("rejects an out-of-range --calibration-concurrency (bounded arg guard)", async () => {
    const dir = await makeTempDir();
    const targets = join(dir, "targets.txt");
    await writeFile(targets, "https://example.com/one\n", "utf8");
    const { out, exitCode } = await runCli(["source-navigation-calibrate-batch", "--urls-file", targets, "--calibration-concurrency", "6"]);
    expect(out).toContain("--calibration-concurrency must be an integer between 1 and 5");
    expect(exitCode).toBe(1);
  });

  it("rejects --persistent-profile with concurrency > 1 (assertCalibrationConcurrencyCompatible)", async () => {
    const dir = await makeTempDir();
    const targets = join(dir, "targets.txt");
    await writeFile(targets, "https://example.com/one\n", "utf8");
    const { out, exitCode } = await runCli(["source-navigation-calibrate-batch", "--urls-file", targets, "--profile", "calib-profile", "--persistent-profile", "--calibration-concurrency", "2"]);
    expect(out).toContain("--calibration-concurrency must be 1 when --persistent-profile is used");
    expect(exitCode).toBe(1);
  });
});

describe("cli source-navigation-promote-batch (offline empty-catalogHints branch)", () => {
  it("requires --calibration-batch-manifest (arg-validation throw, exit 1)", async () => {
    const { out, exitCode } = await runCli(["source-navigation-promote-batch"]);
    expect(out).toContain("source-navigation-promote-batch requires --calibration-batch-manifest <path>");
    expect(exitCode).toBe(1);
  });

  it("rejects a JSON file that is not a calibration batch manifest", async () => {
    const dir = await makeTempDir();
    const bad = join(dir, "bad.json");
    await writeFile(bad, JSON.stringify({ schemaVersion: "2.0" }), "utf8");
    const { out, exitCode } = await runCli(["source-navigation-promote-batch", "--calibration-batch-manifest", bad]);
    expect(out).toContain("Calibration batch manifest must be a read-only source navigation calibration batch object.");
    expect(exitCode).toBe(1);
  });

  it("promotes an empty-catalogHints manifest with no Chromium and prints ok:true", async () => {
    const dir = await makeTempDir();
    const manifest = join(dir, "manifest.json");
    const outputDir = join(dir, "promotion");
    await writeFile(manifest, emptyCatalogHintsManifest(dir), "utf8");
    const { out, exitCode } = await runCli(["source-navigation-promote-batch", "--calibration-batch-manifest", manifest, "--output-dir", outputDir]);
    expect(out).toContain('"ok": true');
    expect(out).toContain('"promotionPath":');
    expect(out).toContain('"groupCount": 0');
    expect(out).toContain('"readyGroupCount": 0');
    expect(out).toContain('"emptyGroupCount": 0');
    expect(out).toContain("Promotion writes explicit action files only; it does not execute browser actions.");
    expect(exitCode).toBeFalsy();

    // The summary file is written inside the temp dir; confirm it parses and matches.
    const summaryRaw = await readFile(join(outputDir, "promotion-summary.json"), "utf8");
    const summary = JSON.parse(summaryRaw) as Record<string, unknown>;
    expect(summary.executionPolicy).toBe("explicit_opt_in_only");
    expect(summary.groupCount).toBe(0);
  });
});

describe("cli source-navigation-promotion-review (offline empty-groups branch)", () => {
  it("requires --promotion-summary or --promotion-dir (arg-validation throw, exit 1)", async () => {
    const { out, exitCode } = await runCli(["source-navigation-promotion-review"]);
    expect(out).toContain("source-navigation-promotion-review requires --promotion-summary <path> or --promotion-dir <path>");
    expect(exitCode).toBe(1);
  });

  it("(json) reviews an empty-groups promotion summary and prints ok:true with empty counts", async () => {
    const dir = await makeTempDir();
    const summary = join(dir, "promotion-summary.json");
    await writeFile(summary, emptyGroupsPromotionSummary(dir), "utf8");
    const { out, exitCode } = await runCli(["source-navigation-promotion-review", "--promotion-summary", summary]);
    expect(out).toContain('"ok": true');
    expect(out).toContain('"promotionSummaryPath":');
    expect(out).toContain('"readyGroupCount": 0');
    expect(out).toContain('"readyActionFileCount": 0');
    expect(out).toContain("No ready action files were found in this promotion summary.");
    expect(out).toContain("Run the generated evidence-run commands only after reviewing the matching catalog/export files.");
    expect(exitCode).toBeFalsy();
  });

  it("--format commands on an empty-groups summary prints the no-ready marker", async () => {
    const dir = await makeTempDir();
    const summary = join(dir, "promotion-summary.json");
    await writeFile(summary, emptyGroupsPromotionSummary(dir), "utf8");
    const { out, exitCode } = await runCli(["source-navigation-promotion-review", "--promotion-summary", summary, "--format", "commands"]);
    expect(out).toBe("# No ready source-navigation action files found.");
    expect(exitCode).toBeFalsy();
  });

  it("--fail-no-ready exits 1 when no ready groups", async () => {
    const dir = await makeTempDir();
    const summary = join(dir, "promotion-summary.json");
    await writeFile(summary, emptyGroupsPromotionSummary(dir), "utf8");
    const { out, exitCode } = await runCli(["source-navigation-promotion-review", "--promotion-summary", summary, "--fail-no-ready"]);
    expect(out).toContain('"ok": false');
    expect(exitCode).toBe(1);
  });

  it("rejects an invalid --format value", async () => {
    const dir = await makeTempDir();
    const summary = join(dir, "promotion-summary.json");
    await writeFile(summary, emptyGroupsPromotionSummary(dir), "utf8");
    const { out, exitCode } = await runCli(["source-navigation-promotion-review", "--promotion-summary", summary, "--format", "xml"]);
    expect(out).toContain("--format must be json or commands");
    expect(exitCode).toBe(1);
  });

  it("rejects an out-of-range source-navigation budget flag (optionalBoundedIntegerArg)", async () => {
    const dir = await makeTempDir();
    const summary = join(dir, "promotion-summary.json");
    await writeFile(summary, emptyGroupsPromotionSummary(dir), "utf8");
    const { out, exitCode } = await runCli(["source-navigation-promotion-review", "--promotion-summary", summary, "--source-navigation-max-followups", "9"]);
    expect(out).toContain("--source-navigation-max-followups must be an integer between 0 and 5");
    expect(exitCode).toBe(1);
  });
});
