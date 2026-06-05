import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSourceCoverageCalibrationLoopPlan, formatSourceCoverageCalibrationLoopReport, sourceCoverageCalibrationLoopOutputPaths } from "../src/source-coverage-calibration-loop.js";
import type { SourceNavigationPromotionSummary } from "../src/source-navigation-promotion.js";
import { reviewSourceNavigationPromotion } from "../src/source-navigation-promotion.js";

describe("source coverage calibration loop", () => {
  it("builds a readiness-guided calibration plan for actionable top slots", () => {
    const runRoot = resolve("runs", "coverage");
    const targetFile = join(runRoot, "targets.txt");
    const promotionDir = join(runRoot, "promotion");
    const selectorHint = join(promotionDir, "google_search-search", "selector-hints.tsv");
    const retryPlanMd = join(runRoot, "profile-headed-retry-plan.md");
    const retryPlanJson = join(runRoot, "profile-headed-retry-plan.json");
    const retryPlanCheck = join(runRoot, "profile-headed-retry-plan-check.json");
    const plan = buildSourceCoverageCalibrationLoopPlan({
      category: "search",
      locale: "ko-KR",
      query: "seoul hotel",
      runRoot,
      targetFile,
      promotionDir,
      repeat: 2,
      calibrationConcurrency: 2,
      calibrationRuntime: {
        headed: true,
        storagePolicy: "storage-state",
        profileName: "ko-search",
        browserChannel: "chrome"
      },
      promotionReviewEvidenceRunOptions: {
        maxFollowUps: 3,
        followUpConcurrency: 2,
        fallbackFollowUps: true,
        maxFallbackFollowUps: 1,
        maxDepth: 2,
        deepeningConcurrency: 2
      },
      selectorHintFiles: [selectorHint],
      promotionSummaries: [promotionSummary("google_search", "ready", 2)]
    });

    expect(plan).toMatchObject({
      executionPolicy: "readiness_guided_read_only_calibration_loop",
      repeat: 2,
      calibrationConcurrency: 2,
      calibrationRuntime: {
        headed: true,
        storagePolicy: "storage-state",
        profileName: "ko-search",
        browserChannel: "chrome"
      },
      promotionReviewEvidenceRunOptions: {
        maxFollowUps: 3,
        followUpConcurrency: 2,
        fallbackFollowUps: true,
        maxFallbackFollowUps: 1,
        maxDepth: 2,
        deepeningConcurrency: 2
      },
      selectorHintFiles: [selectorHint],
      targetCount: 2
    });
    expect(plan.targets.map((target) => target.id)).toEqual(["naver_search", "daum_search"]);
    expect(plan.targetLines).toContain("naver_search https://search.naver.com/search.naver");
    expect(plan.commands.calibrateBatch).toContain("source-navigation-calibrate-batch");
    expect(plan.commands.calibrateBatch).toContain("--calibration-concurrency '2'");
    expect(plan.commands.calibrateBatch).toContain("--headed --browser-channel 'chrome' --profile 'ko-search'");
    expect(plan.commands.calibrateBatch).not.toContain("--persistent-profile");
    expect(plan.commands.calibrateBatch).toContain(`--selector-hints-file '${selectorHint}'`);
    expect(plan.commands.promoteBatch).toContain("source-navigation-promote-batch");
    expect(plan.commands.promotionReview).toContain("source-navigation-promotion-review");
    expect(plan.commands.promotionReview).toContain("--source-navigation-max-followups '3'");
    expect(plan.commands.promotionReview).toContain("--source-navigation-followup-concurrency '2'");
    expect(plan.commands.promotionReview).toContain("--source-navigation-fallback-followups");
    expect(plan.commands.promotionReview).toContain("--source-navigation-max-fallback-followups '1'");
    expect(plan.commands.promotionReview).toContain("--source-navigation-max-depth '2'");
    expect(plan.commands.promotionReview).toContain("--source-navigation-deepening-concurrency '2'");
    expect(plan.commands.coverageReadinessAfterPromotion).toContain("source-coverage-readiness");

    const report = formatSourceCoverageCalibrationLoopReport({
      plan,
      files: sourceCoverageCalibrationLoopOutputPaths(runRoot)
    });
    expect(report).toContain("# Source Coverage Calibration Report");
    expect(report).toContain("- Mode: plan_only");
    expect(report).toContain("- Target count: 2");
    expect(report).toContain("- Calibration concurrency: 2");
    expect(report).toContain("- Destination extraction ready count: 0");
    expect(report).toContain("- Destination extraction not-ready count: 3");
    expect(report).toContain("Destination extraction statuses: ready=0, blocked=0, needs_repeated_calibration=1, not_promoted=2, not_applicable=0");
    expect(report).toContain("- Profile/headed retry check: ok (0 error(s), 1 warning(s))");
    expect(report).toContain("google_search: ready; destination extraction: needs_repeated_calibration");
    expect(report).toContain("- Browser mode: headed");
    expect(report).toContain("- Browser channel: chrome");
    expect(report).toContain("- Profile mode: storage-state:ko-search");
    expect(report).toContain("- Promotion evidence-run options: --source-navigation-max-followups '3' --source-navigation-followup-concurrency '2' --source-navigation-fallback-followups --source-navigation-max-fallback-followups '1' --source-navigation-max-depth '2' --source-navigation-deepening-concurrency '2'");
    expect(report).toContain("- Selector hint input files: 1");
    expect(report).toContain(`- Profile/headed retry plan: ${retryPlanMd}`);
    expect(report).toContain(`- Profile/headed retry plan JSON: ${retryPlanJson}`);
    expect(report).toContain(`- Profile/headed retry plan check: ${retryPlanCheck}`);
    expect(report).toContain("## Profile/Headed Retry Check");
    expect(report).toContain("warning: empty_retry_plan");
    expect(report).toContain(selectorHint);
    expect(report).toContain("source-navigation-calibrate-batch");
    expect(report).toContain("Calibration batch concurrency is enabled; keep profile-heavy, login, or fragile provider retries at concurrency 1 unless reviewed.");
  });

  it("does not generate unattended targets for derivative source categories", () => {
    const paths = sourceCoverageCalibrationLoopOutputPaths("C:\\runs\\ai");
    const plan = buildSourceCoverageCalibrationLoopPlan({
      category: "ai_search",
      locale: "global",
      runRoot: paths.runRoot,
      targetFile: paths.targetFile,
      promotionDir: paths.promotionDir
    });

    expect(plan.audit.ok).toBe(true);
    expect(plan.targetCount).toBe(0);
    expect(plan.targetLines).toBe("");
    expect(plan.warnings).toContain("No actionable not-ready calibration targets were found.");
  });

  it("prints blocked signal pressure in readiness report lines", () => {
    const paths = sourceCoverageCalibrationLoopOutputPaths("C:\\runs\\blocked-signals");
    const promotion = promotionSummary("google_search", "empty", 0);
    promotion.groups[0]!.catalogSummary.blockedCount = 2;
    promotion.groups[0]!.blockedSignalCounts = [
      {
        signal: "captcha-delivery.com",
        count: 7,
        actionKeys: ["result-selection"]
      },
      {
        signal: "var dd=",
        count: 3,
        actionKeys: ["result-selection", "destination-followup"]
      }
    ];
    const plan = buildSourceCoverageCalibrationLoopPlan({
      category: "search",
      locale: "ko-KR",
      query: "seoul hotel",
      runRoot: paths.runRoot,
      targetFile: paths.targetFile,
      promotionDir: paths.promotionDir,
      promotionSummaries: [promotion]
    });

    const report = formatSourceCoverageCalibrationLoopReport({ plan, files: paths });

    expect(report).toContain("google_search: blocked; destination extraction:");
    expect(report).toContain("- Profile/headed retry check: ok (0 error(s), 0 warning(s))");
    expect(report).toContain("blocked signals: captcha-delivery.com:7 (result-selection), var dd=:3 (destination-followup,result-selection)");
    expect(report).toContain("## Profile/Headed Retries");
    expect(report).toContain("google_search: priority=top_slot_blocked; top-slot rank=2; profile=google_search-profile");
    expect(report).toContain("setup=node .\\dist\\cli.js auth-login --profile 'google_search-profile'");
    expect(report).toContain("retry=node .\\dist\\cli.js source-coverage-calibrate --platform 'google_search' --query 'seoul hotel' --repeat '2' --headed --browser-channel 'chrome' --profile 'google_search-profile' --persistent-profile");
    expect(report).toContain("## Profile/Headed Retry Check");
    expect(report).toContain("- No retry-plan check issues.");
  });

  it("can include retry-plan profile readiness checks in coverage reports", () => {
    const paths = sourceCoverageCalibrationLoopOutputPaths("C:\\runs\\profile-check");
    const promotion = promotionSummary("google_search", "empty", 0);
    promotion.groups[0]!.catalogSummary.blockedCount = 1;
    const plan = buildSourceCoverageCalibrationLoopPlan({
      category: "search",
      locale: "ko-KR",
      query: "seoul hotel",
      runRoot: paths.runRoot,
      targetFile: paths.targetFile,
      promotionDir: paths.promotionDir,
      promotionSummaries: [promotion]
    });

    const report = formatSourceCoverageCalibrationLoopReport({
      plan,
      files: paths,
      retryPlanCheckOptions: {
        profileExists: () => false
      }
    });

    expect(report).toContain("- Profile/headed retry check: failed (1 error(s), 0 warning(s))");
    expect(report).toContain("error: profile_missing item=1 platform=google_search");
    expect(report).toContain("Saved browser profile does not exist: google_search-profile");
  });

  it("expands Google and Naver search variants in coverage calibration plans on request", () => {
    const paths = sourceCoverageCalibrationLoopOutputPaths("C:\\runs\\search-variants");
    const plan = buildSourceCoverageCalibrationLoopPlan({
      category: "search",
      locale: "ko-KR",
      query: "seongsu cafe",
      runRoot: paths.runRoot,
      targetFile: paths.targetFile,
      promotionDir: paths.promotionDir,
      includeSearchVariants: true
    });

    expect(plan.includeSearchVariants).toBe(true);
    expect(plan.targets.map((target) => target.id)).toEqual(
      expect.arrayContaining(["naver_search", "naver_search-news", "naver_search-images", "naver_search-videos", "naver_search-place", "naver_search-shopping", "google_search", "google_search-news", "google_search-images", "google_search-videos", "google_search-local"])
    );
    expect(plan.targetLines).toContain("naver_search-news https://search.naver.com/search.naver");
    expect(plan.targetLines).toContain("google_search-videos https://www.google.com/search");
    expect(plan.targets.map((target) => target.id)).toEqual(expect.arrayContaining(["daum_search-news", "daum_search-blog", "daum_search-images", "daum_search-videos", "daum_search-place", "daum_search-shopping"]));
    expect(plan.targetDetectionSummary).toMatchObject({
      targetCount: 20,
      crossPlatformVariantCount: 2,
      crossPlatformVariantTargets: ["naver_search-news", "daum_search-news"]
    });
    expect(plan.targetDetectionSummary.platformCounts).toEqual([
      { platform: "naver_search", count: 6 },
      { platform: "naver_news", count: 1 },
      { platform: "google_search", count: 5 },
      { platform: "daum_search", count: 7 },
      { platform: "daum_news", count: 1 }
    ]);
    expect(plan.warnings).toContain("Search variant targets are expanded for reviewed vertical calibration; review each variant before promotion.");
    expect(plan.warnings).toContain("Some variant target URLs are detected as a different platform; promotion and review will group by detected browser-visible platform/source family.");

    const report = formatSourceCoverageCalibrationLoopReport({ plan, files: paths });
    expect(report).toContain("- Search variants: included");
    expect(report).toContain("- Target detected platforms: naver_search=6, naver_news=1, google_search=5, daum_search=7, daum_news=1");
    expect(report).toContain("- Cross-platform variant targets: 2 (naver_search-news, daum_search-news)");
    expect(report).toContain("naver_search-news: https://search.naver.com/search.naver");
    expect(report).toContain("(detected naver_news/portal; parent naver_search; variant news)");
  });

  it("rejects invalid promotion-review evidence-run budgets", () => {
    const paths = sourceCoverageCalibrationLoopOutputPaths("C:\\runs\\bad-budget");
    expect(() =>
      buildSourceCoverageCalibrationLoopPlan({
        category: "search",
        locale: "ko-KR",
        runRoot: paths.runRoot,
        targetFile: paths.targetFile,
        promotionDir: paths.promotionDir,
        promotionReviewEvidenceRunOptions: {
          followUpConcurrency: 0
        }
      })
    ).toThrow("--source-navigation-followup-concurrency must be an integer between 1 and 5");
  });

  it("rejects invalid calibration batch concurrency", () => {
    const paths = sourceCoverageCalibrationLoopOutputPaths("C:\\runs\\bad-concurrency");
    expect(() =>
      buildSourceCoverageCalibrationLoopPlan({
        category: "search",
        locale: "ko-KR",
        runRoot: paths.runRoot,
        targetFile: paths.targetFile,
        promotionDir: paths.promotionDir,
        calibrationConcurrency: 0
      })
    ).toThrow("Coverage calibration loop concurrency must be an integer between 1 and 5");
  });

  it("rejects concurrent calibration with persistent profiles", () => {
    const paths = sourceCoverageCalibrationLoopOutputPaths("C:\\runs\\bad-profile-concurrency");
    expect(() =>
      buildSourceCoverageCalibrationLoopPlan({
        category: "search",
        locale: "ko-KR",
        runRoot: paths.runRoot,
        targetFile: paths.targetFile,
        promotionDir: paths.promotionDir,
        calibrationConcurrency: 2,
        calibrationRuntime: {
          headed: true,
          storagePolicy: "persistent-profile",
          profileName: "google-search"
        }
      })
    ).toThrow("Coverage calibration loop concurrency must be 1 when persistent-profile calibration is used");
  });

  it("prints promotion destination extraction totals when promotion review is supplied", () => {
    const paths = sourceCoverageCalibrationLoopOutputPaths("C:\\runs\\map");
    const promotion = promotionSummary(
      "google_maps",
      "ready",
      2,
      {
        candidateCount: 1,
        readyActionCount: 1,
        readyActionKeys: ["destination-followup"],
        maintainedReadyCount: 1,
        singleRunReadyCount: 0,
        calibrationRequiredCount: 0,
        blockedCount: 0,
        manualReviewCount: 0,
        manualValueCount: 0,
        discoveryRunCount: 0,
        discoveryPromotableCandidateCount: 0,
        discoveryNonPromotableCandidateCount: 0,
        discoverySelectorHintCount: 0,
        discoveryWarningCounts: [],
        clientStateProbeRunCount: 0,
        clientStateProbeOkRunCount: 0,
        clientStateProbeUniqueCandidateCount: 0
      },
      "map"
    );
    promotion.groups[0]!.files.selectorHints = "C:\\runs\\map\\promotion\\google_maps-map\\selector-hints.tsv";
    const plan = buildSourceCoverageCalibrationLoopPlan({
      category: "map_local",
      locale: "ko-KR",
      query: "seongsu cafe",
      runRoot: paths.runRoot,
      targetFile: paths.targetFile,
      promotionDir: paths.promotionDir,
      promotionSummaries: [promotion]
    });

    const report = formatSourceCoverageCalibrationLoopReport({
      plan,
      files: paths,
      promotion,
      promotionReview: reviewSourceNavigationPromotion(promotion)
    });

    expect(report).toContain("- Destination extraction ready actions: 1/1");
    expect(report).toContain("google_maps: ready; destination extraction: ready (1/1 ready; keys: destination-followup)");
    expect(report).toContain("## Selector Hints");
    expect(report).toContain("google_maps: C:\\runs\\map\\promotion\\google_maps-map\\selector-hints.tsv");
  });
});

function promotionSummary(
  platform: SourceNavigationPromotionSummary["groups"][number]["platform"],
  status: SourceNavigationPromotionSummary["groups"][number]["status"],
  actionCount: number,
  destinationExtraction?: NonNullable<SourceNavigationPromotionSummary["groups"][number]["destinationExtraction"]>,
  sourceFamily: SourceNavigationPromotionSummary["groups"][number]["sourceFamily"] = "search"
): SourceNavigationPromotionSummary {
  return {
    schemaVersion: "1.0",
    executionPolicy: "explicit_opt_in_only",
    outputDir: "C:\\promotion",
    groupCount: 1,
    readyGroupCount: status === "ready" ? 1 : 0,
    emptyGroupCount: status === "empty" ? 1 : 0,
    actionFileCount: 1,
    groups: [
      {
        platform,
        sourceFamily,
        url: `https://example.test/${platform}`,
        runDirs: [],
        status,
        actionCount,
        catalogSummary: {
          entryCount: 4,
          calibrationReportCount: 2,
          skippedCalibrationReportCount: 0,
          maintainedRecipeReadyCount: actionCount,
          singleRunReadyCount: 0,
          manualReviewCount: 0,
          manualValueCount: 0,
          calibrationRequiredCount: 0,
          blockedCount: 0,
          notSupportedCount: 0,
          recommendedActionCount: actionCount,
          maintainedDefaultReadyCount: actionCount,
          minimumCalibrationRunsRequired: 2
        },
        files: {
          catalog: "C:\\promotion\\catalog.json",
          export: "C:\\promotion\\export.json",
          actions: "C:\\promotion\\actions.json"
        },
        ...(destinationExtraction === undefined ? {} : { destinationExtraction }),
        warnings: []
      }
    ],
    warnings: []
  };
}
