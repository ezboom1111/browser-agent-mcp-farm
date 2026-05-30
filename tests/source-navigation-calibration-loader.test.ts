import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SourceNavigationCalibrationReport } from "../src/source-navigation-calibration.js";
import {
  loadSourceNavigationCalibrationReports,
  parseSourceNavigationCalibrationReport
} from "../src/source-navigation-calibration-loader.js";

let runDirs: string[] = [];

describe("loadSourceNavigationCalibrationReports", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("loads direct calibration report files and wrapped metadata JSON", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-loader-file-"));
    runDirs.push(runDir);
    const report = calibrationReport("https://example.com/file");
    const directPath = join(runDir, "report.json");
    const wrappedPath = join(runDir, "wrapped.json");
    await writeFile(directPath, JSON.stringify(report, null, 2), "utf8");
    await writeFile(wrappedPath, JSON.stringify({ sourceNavigationCalibration: report }, null, 2), "utf8");

    const result = await loadSourceNavigationCalibrationReports({ files: [directPath, wrappedPath] });

    expect(result.reports).toHaveLength(2);
    expect(result.reports[0]?.url).toBe("https://example.com/file");
    expect(result.sources.map((source) => source.kind)).toEqual(["file", "file"]);
    expect(result.warnings).toEqual([]);
  });

  it("discovers calibration report text artifacts from an evidence run ledger", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-loader-ledger-"));
    runDirs.push(runDir);
    await mkdir(join(runDir, "raw"), { recursive: true });
    await mkdir(join(runDir, "structured"), { recursive: true });
    const report = calibrationReport("https://example.com/ledger");
    await writeFile(join(runDir, "raw", "run-source-navigation-calibration.txt"), JSON.stringify(report, null, 2), "utf8");
    await writeFile(join(runDir, "structured", "run-source-navigation-calibration.metadata.json"), JSON.stringify({ sourceNavigationCalibration: report }, null, 2), "utf8");
    await writeFile(join(runDir, "artifacts.jsonl"), [
      JSON.stringify({
        path: "structured/run-source-navigation-calibration.metadata.json",
        kind: "structured",
        format: "json",
        tool_name: "source_navigation_calibration",
        evidence_kind: "source_navigation_calibration"
      }),
      JSON.stringify({
        path: "raw/run-source-navigation-calibration.txt",
        kind: "text",
        format: "txt",
        tool_name: "source_navigation_calibration",
        evidence_kind: "source_navigation_calibration"
      })
    ].join("\n"), "utf8");

    const result = await loadSourceNavigationCalibrationReports({ runDirs: [runDir] });

    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]?.url).toBe("https://example.com/ledger");
    expect(result.sources[0]).toMatchObject({
      input: runDir,
      kind: "run_dir_manifest"
    });
    expect(result.sources[0]?.path).toContain("raw");
  });

  it("falls back to raw artifact discovery when artifacts.jsonl is missing", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-loader-fallback-"));
    runDirs.push(runDir);
    await mkdir(join(runDir, "raw"), { recursive: true });
    await writeFile(
      join(runDir, "raw", "example-source-navigation-calibration.txt"),
      JSON.stringify(calibrationReport("https://example.com/fallback"), null, 2),
      "utf8"
    );

    const result = await loadSourceNavigationCalibrationReports({ runDirs: [runDir] });

    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]?.url).toBe("https://example.com/fallback");
    expect(result.sources[0]?.kind).toBe("run_dir_fallback");
    expect(result.warnings.join(" ")).toContain("falling back");
  });

  it("loads succeeded run directories from calibration batch manifests", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "farm-source-nav-loader-batch-"));
    runDirs.push(runRoot);
    const firstRunDir = join(runRoot, "google-r1");
    const secondRunDir = join(runRoot, "google-r2");
    await writeRunDirCalibrationReport(firstRunDir, calibrationReport("https://example.com/batch-1"));
    await writeRunDirCalibrationReport(secondRunDir, calibrationReport("https://example.com/batch-2"));
    const manifestPath = join(runRoot, "calibration-batch-manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: "1.0",
      executionPolicy: "read_only_selector_probe_batch",
      runRoot,
      targetCount: 1,
      repeat: 3,
      attemptCount: 3,
      succeededCount: 2,
      failedCount: 1,
      attempts: [
        {
          attemptId: "google-r1",
          status: "succeeded",
          runDir: firstRunDir,
          calibrationArtifactPaths: [join(firstRunDir, "raw", "source-navigation-calibration.txt")]
        },
        {
          attemptId: "google-r2",
          status: "succeeded",
          runDir: secondRunDir,
          calibrationArtifactPaths: [join(secondRunDir, "raw", "source-navigation-calibration.txt")]
        },
        {
          attemptId: "google-r3",
          status: "failed",
          runDir: join(runRoot, "google-r3"),
          calibrationArtifactPaths: [],
          error: "timeout"
        }
      ],
      catalogHints: [],
      warnings: []
    }, null, 2), "utf8");

    const result = await loadSourceNavigationCalibrationReports({ batchManifests: [manifestPath] });

    expect(result.reports.map((report) => report.url)).toEqual([
      "https://example.com/batch-1",
      "https://example.com/batch-2"
    ]);
    expect(result.sources.map((source) => source.kind)).toEqual(expect.arrayContaining([
      "batch_manifest",
      "run_dir_manifest"
    ]));
    expect(result.warnings.join(" ")).toContain("Skipped failed calibration batch attempt google-r3");
  });
});

describe("parseSourceNavigationCalibrationReport", () => {
  it("rejects non-calibration JSON", () => {
    expect(() => parseSourceNavigationCalibrationReport(JSON.stringify({ schemaVersion: "1.0" })))
      .toThrow("source_navigation_calibration");
  });
});

function calibrationReport(url: string): SourceNavigationCalibrationReport {
  return {
    schemaVersion: "1.0",
    url,
    platform: "generic",
    sourceFamily: "generic_web",
    recipeExecutionPolicy: "manual_opt_in_only",
    executionPolicy: "read_only_selector_probe",
    selectorTimeoutMs: 1000,
    actionCalibrations: [],
    summary: {
      executionPolicy: "read_only_selector_probe",
      actionCandidateCount: 0,
      observedActionCount: 0,
      partialActionCount: 0,
      notObservedActionCount: 0,
      blockedActionCount: 0,
      erroredActionCount: 0,
      selectorCandidateCount: 0,
      matchedSelectorCount: 0,
      captureScopeCandidateCount: 0,
      matchedCaptureScopeCount: 0,
      expectedSignalHits: 0,
      blockedSignalHits: 0,
      realSiteCandidateMatches: 0,
      localFixtureCandidateMatches: 0,
      manualOnly: true
    },
    warnings: []
  };
}

async function writeRunDirCalibrationReport(runDir: string, report: SourceNavigationCalibrationReport): Promise<void> {
  await mkdir(join(runDir, "raw"), { recursive: true });
  await writeFile(join(runDir, "raw", "source-navigation-calibration.txt"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(join(runDir, "artifacts.jsonl"), JSON.stringify({
    path: "raw/source-navigation-calibration.txt",
    kind: "text",
    format: "txt",
    tool_name: "source_navigation_calibration",
    evidence_kind: "source_navigation_calibration"
  }), "utf8");
}
