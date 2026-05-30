import { describe, expect, it } from "vitest";
import { buildSourceNavigationCalibrationBatchManifest, expandSourceNavigationCalibrationBatchAttempts, parseSourceNavigationCalibrationBatchTargets, runSourceNavigationCalibrationBatchAttempts } from "../src/source-navigation-calibration-batch.js";

describe("parseSourceNavigationCalibrationBatchTargets", () => {
  it("parses newline targets with generated and explicit IDs", () => {
    const targets = parseSourceNavigationCalibrationBatchTargets(`
# real-site calibration targets
https://example.com/search?q=tokyo
google https://www.google.com/search?q=tokyo+hotel
`);

    expect(targets).toEqual([
      { id: "target-001", url: "https://example.com/search?q=tokyo" },
      { id: "google", url: "https://www.google.com/search?q=tokyo+hotel" }
    ]);
  });

  it("parses JSON targets and de-duplicates IDs", () => {
    const targets = parseSourceNavigationCalibrationBatchTargets(
      JSON.stringify({
        targets: [
          { id: "naver", url: "https://search.naver.com/search.naver?query=hotel", note: "Korean search" },
          { id: "naver", url: "https://map.naver.com/" }
        ]
      })
    );

    expect(targets).toEqual([
      { id: "naver", url: "https://search.naver.com/search.naver?query=hotel", note: "Korean search" },
      { id: "naver-2", url: "https://map.naver.com/" }
    ]);
  });

  it("rejects non-web URLs", () => {
    expect(() => parseSourceNavigationCalibrationBatchTargets("file:///tmp/test.html")).toThrow("http or https");
  });
});

describe("source navigation calibration batch manifest", () => {
  it("expands repeated attempts and creates grouped catalog hints", () => {
    const targets = parseSourceNavigationCalibrationBatchTargets("https://www.google.com/search?q=tokyo+hotel");
    const attempts = expandSourceNavigationCalibrationBatchAttempts({ targets, repeat: 2 });

    expect(attempts).toEqual([expect.objectContaining({ attemptId: "target-001-r1", repeatIndex: 1 }), expect.objectContaining({ attemptId: "target-001-r2", repeatIndex: 2 })]);

    const manifest = buildSourceNavigationCalibrationBatchManifest({
      runRoot: "C:/runs",
      targets,
      repeat: 2,
      concurrency: 2,
      runtime: {
        headed: true,
        storagePolicy: "storage-state",
        profileName: "travel-login",
        browserChannel: "chrome"
      },
      selectorHintFiles: ["C:/runs/promotion/google-search/selector-hints.tsv"],
      attempts: attempts.map((attempt, index) => ({
        ...attempt,
        runDir: `C:/runs/${attempt.runDirName}`,
        status: "succeeded",
        platform: "google_search",
        sourceFamily: "search",
        calibrationArtifactPaths: [`C:/runs/${attempt.runDirName}/raw/source-navigation-calibration.txt`],
        calibrationSummary: {
          executionPolicy: "read_only_selector_probe",
          actionCandidateCount: 1,
          observedActionCount: 1,
          partialActionCount: 0,
          notObservedActionCount: 0,
          blockedActionCount: 0,
          erroredActionCount: 0,
          selectorCandidateCount: 1,
          matchedSelectorCount: 1,
          captureScopeCandidateCount: 0,
          matchedCaptureScopeCount: 0,
          expectedSignalHits: 0,
          blockedSignalHits: 0,
          realSiteCandidateMatches: index + 1,
          localFixtureCandidateMatches: 0,
          manualOnly: true
        }
      }))
    });

    expect(manifest).toMatchObject({
      executionPolicy: "read_only_selector_probe_batch",
      targetCount: 1,
      repeat: 2,
      concurrency: 2,
      runtime: {
        headed: true,
        storagePolicy: "storage-state",
        profileName: "travel-login",
        browserChannel: "chrome"
      },
      selectorHintFiles: ["C:/runs/promotion/google-search/selector-hints.tsv"],
      attemptCount: 2,
      succeededCount: 2,
      failedCount: 0
    });
    expect(manifest.catalogHints).toEqual([
      expect.objectContaining({
        platform: "google_search",
        sourceFamily: "search",
        runtime: {
          headed: true,
          storagePolicy: "storage-state",
          profileName: "travel-login",
          browserChannel: "chrome"
        },
        runDirs: [expect.stringContaining("target-001-r1"), expect.stringContaining("target-001-r2")]
      })
    ]);
    expect(manifest.catalogHints[0]?.catalogCommand).toContain("--calibration-run-dirs");
    expect(manifest.warnings).toContain("Batch calibration used bounded concurrency; keep profile-heavy or fragile platforms at concurrency 1 unless the targets were reviewed as safe read-only surfaces.");
    expect(manifest.warnings).toContain("Selector hint files were loaded only as manual read-only calibration candidates, not as maintained recipes.");
  });

  it("runs calibration attempts in bounded concurrent batches", async () => {
    const targets = parseSourceNavigationCalibrationBatchTargets(`
one https://example.com/one
two https://example.com/two
three https://example.com/three
`);
    const attempts = expandSourceNavigationCalibrationBatchAttempts({ targets });
    let active = 0;
    let maxActive = 0;
    const progressCounts: number[] = [];

    const results = await runSourceNavigationCalibrationBatchAttempts({
      attempts,
      concurrency: 2,
      runAttempt: async (attempt) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(attempt.targetId === "one" ? 20 : 5);
        active -= 1;
        return {
          ...attempt,
          runDir: `C:/runs/${attempt.runDirName}`,
          status: "succeeded",
          platform: "generic",
          sourceFamily: "generic_web",
          calibrationArtifactPaths: []
        };
      },
      onProgress: (progressResults) => {
        progressCounts.push(progressResults.length);
      }
    });

    expect(results.map((result) => result.targetId)).toEqual(["one", "two", "three"]);
    expect(maxActive).toBe(2);
    expect(progressCounts).toEqual([2, 3]);
  });

  it("stops after the current concurrent batch when stopOnError is enabled", async () => {
    const targets = parseSourceNavigationCalibrationBatchTargets(`
one https://example.com/one
two https://example.com/two
three https://example.com/three
`);
    const attempts = expandSourceNavigationCalibrationBatchAttempts({ targets });
    const attempted: string[] = [];

    await expect(
      runSourceNavigationCalibrationBatchAttempts({
        attempts,
        concurrency: 2,
        stopOnError: true,
        runAttempt: async (attempt) => {
          attempted.push(attempt.targetId);
          return {
            ...attempt,
            runDir: `C:/runs/${attempt.runDirName}`,
            status: attempt.targetId === "one" ? "failed" : "succeeded",
            calibrationArtifactPaths: [],
            ...(attempt.targetId === "one" ? { error: "blocked" } : {})
          };
        }
      })
    ).rejects.toThrow("Calibration batch stopped after failed attempt one");

    expect(attempted).toEqual(["one", "two"]);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
