import { describe, expect, it } from "vitest";
import {
  buildSourceCoverageReadinessRetryPlan,
  buildSourceCoverageReadinessAudit,
  checkSourceCoverageReadinessRetryPlan,
  filterSourceCoverageReadinessRetryPlan,
  filterSourceCoverageReadinessRetryPlanByCheck,
  formatSourceCoverageReadinessRetryCommandsAsLines,
  formatSourceCoverageReadinessRetryPlanAsMarkdown,
  formatSourceCoverageReadinessRetryPlanCommandsAsLines,
  formatSourceCoverageReadinessRetryPlanMarkdown,
  formatSourceCoverageReadinessTargetsAsLines,
  parseSourceCoverageReadinessRetryPlan
} from "../src/source-coverage-readiness.js";
import type { SourceNavigationPromotionSummary } from "../src/source-navigation-promotion.js";
import type { SourceFamily, SourcePlatform } from "../src/source-strategy.js";

describe("source coverage readiness", () => {
  it("audits Korean search top slots against promotion summaries", () => {
    const audit = buildSourceCoverageReadinessAudit({
      category: "search",
      locale: "ko-KR",
      query: "seoul hotel",
      promotionSummaries: [
        promotionSummary([
          promotionGroup("google_search", "search", "ready", 2, {
            calibrationReportCount: 2,
            maintainedRecipeReadyCount: 2,
            calibrationRequiredCount: 0,
            recommendedActionCount: 2,
            maintainedDefaultReadyCount: 2
          }),
          promotionGroup("daum_search", "search", "empty", 0, {
            calibrationReportCount: 1,
            singleRunReadyCount: 1,
            calibrationRequiredCount: 2
          })
        ])
      ]
    });

    expect(audit.ok).toBe(false);
    expect(audit.items.map((item) => item.platform)).toEqual([
      "naver_search",
      "google_search",
      "daum_search"
    ]);
    expect(audit.items.map((item) => item.status)).toEqual([
      "not_promoted",
      "ready",
      "needs_repeated_calibration"
    ]);
    expect(audit.readyCount).toBe(1);
    expect(audit.notReadyActionableCount).toBe(2);
    expect(formatSourceCoverageReadinessTargetsAsLines(audit)).toContain("naver_search https://search.naver.com/search.naver");
    expect(formatSourceCoverageReadinessTargetsAsLines(audit)).toContain("daum_search https://search.daum.net/search");
  });

  it("skips derivative and private-network source slots from actionable readiness", () => {
    const aiAudit = buildSourceCoverageReadinessAudit({ category: "ai_search", locale: "global" });
    const privateAudit = buildSourceCoverageReadinessAudit({ category: "messenger_private", locale: "ko-KR" });

    expect(aiAudit.ok).toBe(true);
    expect(aiAudit.actionableEntryCount).toBe(0);
    expect(aiAudit.items.every((item) => item.status === "skipped_derivative")).toBe(true);
    expect(privateAudit.ok).toBe(true);
    expect(privateAudit.actionableEntryCount).toBe(0);
    expect(privateAudit.items.every((item) => item.status === "skipped_private")).toBe(true);
  });

  it("emits profile/headed retry commands for blocked promoted slots", () => {
    const googleGroup = promotionGroup("google_search", "search", "empty", 0, {
      calibrationReportCount: 2,
      calibrationRequiredCount: 0,
      blockedCount: 1
    });
    googleGroup.files.selectorHints = "C:\\promotion\\google_search\\selector-hints.tsv";
    googleGroup.blockedSignalCounts = [
      { signal: "captcha-delivery.com", count: 7, actionKeys: ["result-selection", "obstruction-check"] }
    ];
    const audit = buildSourceCoverageReadinessAudit({
      category: "search",
      locale: "ko-KR",
      query: "seoul hotel",
      promotionSummaries: [
        promotionSummary([
          googleGroup
        ])
      ]
    });

    const google = audit.items.find((item) => item.platform === "google_search");
    expect(audit.profileHeadedRetryCount).toBe(1);
    expect(google).toMatchObject({
      status: "blocked",
      profileHeadedRetry: {
        strategy: "profile_headed_calibration",
        profileName: "google_search-profile",
        storagePolicy: "persistent-profile",
        browserChannel: "chrome",
        selectorHintFiles: ["C:\\promotion\\google_search\\selector-hints.tsv"],
        profileSetupArgv: expect.arrayContaining([
          "auth-login",
          "--profile",
          "google_search-profile",
          "--url",
          "--browser-channel",
          "chrome"
        ]),
        argv: [
          "node",
          ".\\dist\\cli.js",
          "source-coverage-calibrate",
          "--platform",
          "google_search",
          "--query",
          "seoul hotel",
          "--repeat",
          "2",
          "--headed",
          "--browser-channel",
          "chrome",
          "--profile",
          "google_search-profile",
          "--persistent-profile",
          "--selector-hints-file",
          "C:\\promotion\\google_search\\selector-hints.tsv"
        ]
      }
    });
    expect(google?.blockedSignalCounts).toEqual([
      { signal: "captcha-delivery.com", count: 7, actionKeys: ["obstruction-check", "result-selection"] }
    ]);
    expect(google?.profileHeadedRetry?.profileSetupUrl).toContain("https://www.google.com/search");
    expect(google?.nextActions[0]).toContain("profile/headed");
    const retryCommands = formatSourceCoverageReadinessRetryCommandsAsLines(audit);
    expect(retryCommands).toContain("auth-login --profile 'google_search-profile' --url 'https://www.google.com/search");
    expect(retryCommands).toContain("--browser-channel 'chrome'");
    expect(retryCommands).toContain(
      "source-coverage-calibrate --platform 'google_search' --query 'seoul hotel' --repeat '2' --headed --browser-channel 'chrome' --profile 'google_search-profile' --persistent-profile"
    );
    expect(retryCommands).toContain("--selector-hints-file 'C:\\promotion\\google_search\\selector-hints.tsv'");
  });

  it("formats blocked profile/headed retries as an ordered QA plan", () => {
    const googleGroup = promotionGroup("google_search", "search", "empty", 0, {
      calibrationReportCount: 2,
      blockedCount: 1
    });
    googleGroup.files.selectorHints = "C:\\promotion\\google_search\\selector-hints.tsv";
    googleGroup.blockedSignalCounts = [
      { signal: "captcha-delivery.com", count: 7, actionKeys: ["result-selection"] }
    ];
    const daumGroup = promotionGroup("daum_search", "search", "empty", 0, {
      calibrationReportCount: 2,
      blockedCount: 1
    });
    const audit = buildSourceCoverageReadinessAudit({
      category: "search",
      locale: "ko-KR",
      query: "seoul hotel",
      promotionSummaries: [
        promotionSummary([
          daumGroup,
          googleGroup
        ])
      ]
    });

    const plan = buildSourceCoverageReadinessRetryPlan(audit);
    expect(plan).toMatchObject({
      executionPolicy: "profile_headed_retry_plan_only",
      itemCount: 2,
      items: [
        {
          order: 1,
          platform: "google_search",
          priority: "top_slot_blocked",
          matchedTopRank: 2,
          selectorHintFiles: ["C:\\promotion\\google_search\\selector-hints.tsv"],
          blockedSignalCounts: [
            { signal: "captcha-delivery.com", count: 7, actionKeys: ["result-selection"] }
          ]
        },
        {
          order: 2,
          platform: "daum_search",
          priority: "top_slot_blocked",
          matchedTopRank: 3,
          selectorHintFiles: []
        }
      ]
    });
    const markdown = formatSourceCoverageReadinessRetryPlanAsMarkdown(audit);
    expect(markdown).toContain("# Source Coverage Profile/Headed Retry Plan");
    expect(markdown).toContain("## 1. Google Search (google_search)");
    expect(markdown).toContain("top-slot rank 2");
    expect(markdown).toContain("Selector hints: C:\\promotion\\google_search\\selector-hints.tsv");
    expect(markdown).toContain("Blocked signals: captcha-delivery.com:7 (result-selection)");
    expect(markdown).toContain("--selector-hints-file 'C:\\promotion\\google_search\\selector-hints.tsv'");
    expect(markdown).toContain("## 2. Daum/Kakao Search (daum_search)");
  });

  it("parses retry-plan JSON and prints command subsets", () => {
    const googleGroup = promotionGroup("google_search", "search", "empty", 0, {
      calibrationReportCount: 2,
      blockedCount: 1
    });
    googleGroup.files.selectorHints = "C:\\promotion\\google_search\\selector-hints.tsv";
    googleGroup.blockedSignalCounts = [
      { signal: "captcha-delivery.com", count: 7, actionKeys: ["result-selection"] }
    ];
    const audit = buildSourceCoverageReadinessAudit({
      category: "search",
      locale: "ko-KR",
      query: "seoul hotel",
      promotionSummaries: [promotionSummary([googleGroup])]
    });
    const plan = buildSourceCoverageReadinessRetryPlan(audit);

    const parsed = parseSourceCoverageReadinessRetryPlan(JSON.stringify(plan));
    const commands = formatSourceCoverageReadinessRetryPlanCommandsAsLines(parsed);
    const setupCommands = formatSourceCoverageReadinessRetryPlanCommandsAsLines(parsed, "setup-commands");
    const retryCommands = formatSourceCoverageReadinessRetryPlanCommandsAsLines(parsed, "retry-commands");
    const markdown = formatSourceCoverageReadinessRetryPlanMarkdown(parsed);

    expect(parsed.itemCount).toBe(1);
    expect(commands).toContain("auth-login --profile 'google_search-profile'");
    expect(commands).toContain("source-coverage-calibrate --platform 'google_search'");
    expect(setupCommands).toContain("auth-login --profile 'google_search-profile'");
    expect(setupCommands).not.toContain("source-coverage-calibrate --platform 'google_search'");
    expect(retryCommands).not.toContain("auth-login --profile 'google_search-profile'");
    expect(retryCommands).toContain("source-coverage-calibrate --platform 'google_search'");
    expect(markdown).toContain("## 1. Google Search (google_search)");
  });

  it("filters retry-plan JSON by platform, priority, and limit", () => {
    const googleGroup = promotionGroup("google_search", "search", "empty", 0, {
      calibrationReportCount: 2,
      blockedCount: 1
    });
    const daumGroup = promotionGroup("daum_search", "search", "empty", 0, {
      calibrationReportCount: 2,
      blockedCount: 1
    });
    const genericGroup = promotionGroup("google_maps", "map", "empty", 0, {
      calibrationReportCount: 2,
      blockedCount: 1
    }, undefined, "map");
    const audit = buildSourceCoverageReadinessAudit({
      query: "seoul hotel",
      promotionSummaries: [
        promotionSummary([googleGroup, daumGroup, genericGroup])
      ]
    });
    const plan = buildSourceCoverageReadinessRetryPlan(audit);

    const googleOnly = filterSourceCoverageReadinessRetryPlan(plan, { platform: "google_search" });
    const topSlotLimited = filterSourceCoverageReadinessRetryPlan(plan, {
      priority: "top_slot_blocked",
      limit: 1
    });

    expect(googleOnly).toMatchObject({
      itemCount: 1,
      items: [
        {
          order: 1,
          platform: "google_search"
        }
      ]
    });
    expect(topSlotLimited.itemCount).toBe(1);
    expect(topSlotLimited.items[0]?.priority).toBe("top_slot_blocked");
    expect(topSlotLimited.items[0]?.order).toBe(1);
    expect(topSlotLimited.warnings).toContain(`Retry plan filtered from ${plan.itemCount} to 1 item(s).`);
  });

  it("filters retry-plan JSON to check-passing items", () => {
    const googleGroup = promotionGroup("google_search", "search", "empty", 0, {
      calibrationReportCount: 2,
      blockedCount: 1
    });
    const daumGroup = promotionGroup("daum_search", "search", "empty", 0, {
      calibrationReportCount: 2,
      blockedCount: 1
    });
    const audit = buildSourceCoverageReadinessAudit({
      category: "search",
      locale: "ko-KR",
      query: "seoul hotel",
      promotionSummaries: [promotionSummary([googleGroup, daumGroup])]
    });
    const plan = buildSourceCoverageReadinessRetryPlan(audit);

    const filtered = filterSourceCoverageReadinessRetryPlanByCheck(plan, {
      profileExists: (profileName) => profileName === "google_search-profile"
    });

    expect(filtered).toMatchObject({
      itemCount: 1,
      items: [
        {
          order: 1,
          platform: "google_search"
        }
      ]
    });
    expect(filtered.warnings).toContain("Retry plan check filter removed 1 item(s) with preflight errors.");
  });

  it("checks retry-plan commands before profile/headed execution", () => {
    const googleGroup = promotionGroup("google_search", "search", "empty", 0, {
      calibrationReportCount: 2,
      blockedCount: 1
    });
    googleGroup.files.selectorHints = "C:\\promotion\\google_search\\selector-hints.tsv";
    const audit = buildSourceCoverageReadinessAudit({
      category: "search",
      locale: "ko-KR",
      query: "seoul hotel",
      promotionSummaries: [promotionSummary([googleGroup])]
    });
    const plan = buildSourceCoverageReadinessRetryPlan(audit);

    const okCheck = checkSourceCoverageReadinessRetryPlan(plan);
    const okFileCheck = checkSourceCoverageReadinessRetryPlan(plan, {
      selectorHintFileExists: (filePath) => filePath.endsWith("selector-hints.tsv")
    });
    const missingFileCheck = checkSourceCoverageReadinessRetryPlan(plan, {
      selectorHintFileExists: () => false
    });
    const okProfileCheck = checkSourceCoverageReadinessRetryPlan(plan, {
      profileExists: (profileName) => profileName === "google_search-profile"
    });
    const missingProfileCheck = checkSourceCoverageReadinessRetryPlan(plan, {
      profileExists: () => false
    });
    const okMarkdown = formatSourceCoverageReadinessRetryPlanMarkdown(plan, okProfileCheck);
    const missingProfileMarkdown = formatSourceCoverageReadinessRetryPlanMarkdown(plan, missingProfileCheck);
    const brokenCheck = checkSourceCoverageReadinessRetryPlan({
      ...plan,
      items: [
        {
          ...plan.items[0]!,
          powershellCommand: "node .\\dist\\cli.js source-coverage-calibrate --platform 'google_search'"
        }
      ]
    });

    expect(okCheck).toMatchObject({
      ok: true,
      errorCount: 0
    });
    expect(okFileCheck.ok).toBe(true);
    expect(okFileCheck.warnings).toContain("Selector-hint file existence was checked for this run.");
    expect(missingFileCheck).toMatchObject({
      ok: false,
      errorCount: 1
    });
    expect(missingFileCheck.issues.map((issue) => issue.code)).toContain("selector_hint_file_missing");
    expect(okProfileCheck.ok).toBe(true);
    expect(okProfileCheck.warnings).toContain("Saved browser profile existence was checked for this run.");
    expect(missingProfileCheck).toMatchObject({
      ok: false,
      errorCount: 1
    });
    expect(missingProfileCheck.issues.map((issue) => issue.code)).toContain("profile_missing");
    expect(okMarkdown).toContain("## Preflight Check");
    expect(okMarkdown).toContain("- OK: yes");
    expect(okMarkdown).toContain("No preflight check issues were found.");
    expect(missingProfileMarkdown).toContain("- OK: no");
    expect(missingProfileMarkdown).toContain("`profile_missing` item 1 platform `google_search`");
    expect(brokenCheck.ok).toBe(false);
    expect(brokenCheck.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "retry_command_missing_headed",
      "retry_command_missing_browser_channel_flag",
      "retry_command_missing_profile_flag",
      "retry_command_missing_persistent_profile",
      "retry_command_missing_selector_hints_flag",
      "retry_command_missing_selector_hint_file"
    ]));
  });

  it("separates destination extraction readiness from general capture readiness", () => {
    const audit = buildSourceCoverageReadinessAudit({
      category: "map_local",
      locale: "ko-KR",
      query: "seongsu cafe",
      promotionSummaries: [
        promotionSummary([
          promotionGroup("naver_map", "map", "ready", 1, {
            calibrationReportCount: 2,
            maintainedRecipeReadyCount: 1,
            calibrationRequiredCount: 0,
            recommendedActionCount: 1,
            maintainedDefaultReadyCount: 1
          }, destinationExtraction({
            candidateCount: 1,
            calibrationRequiredCount: 1,
            clientStateProbeRunCount: 2,
            clientStateProbeOkRunCount: 2,
            clientStateProbeUniqueCandidateCount: 176
          })),
          promotionGroup("google_maps", "map", "ready", 2, {
            calibrationReportCount: 2,
            maintainedRecipeReadyCount: 2,
            calibrationRequiredCount: 0,
            recommendedActionCount: 2,
            maintainedDefaultReadyCount: 2
          }, destinationExtraction({
            candidateCount: 1,
            readyActionCount: 1,
            readyActionKeys: ["destination-followup"],
            maintainedReadyCount: 1
          }))
        ])
      ]
    });

    const naver = audit.items.find((item) => item.platform === "naver_map");
    const google = audit.items.find((item) => item.platform === "google_maps");
    const kakao = audit.items.find((item) => item.platform === "kakao_map");

    expect(naver).toMatchObject({
      status: "ready",
      destinationExtraction: {
        status: "needs_repeated_calibration",
        candidateCount: 2,
        readyActionCount: 0,
        clientStateProbeRunCount: 2,
        clientStateProbeOkRunCount: 2,
        clientStateProbeUniqueCandidateCount: 176
      }
    });
    expect(google).toMatchObject({
      status: "ready",
      destinationExtraction: {
        status: "ready",
        readyActionCount: 1,
        readyActionKeys: ["destination-followup"]
      }
    });
    expect(kakao?.destinationExtraction.status).toBe("not_promoted");
    expect(audit.destinationExtractionReadyCount).toBe(1);
    expect(audit.destinationExtractionNotReadyCount).toBe(2);
    expect(audit.destinationExtractionStatusCounts).toMatchObject({
      ready: 1,
      needs_repeated_calibration: 1,
      not_promoted: 1
    });
  });

  it("carries destination discovery diagnostics into readiness next actions", () => {
    const naverGroup = promotionGroup("naver_map", "map", "ready", 1, {
      calibrationReportCount: 2,
      maintainedRecipeReadyCount: 1,
      calibrationRequiredCount: 1,
      recommendedActionCount: 1,
      maintainedDefaultReadyCount: 1
    }, destinationExtraction({
      candidateCount: 1,
      calibrationRequiredCount: 1,
      discoveryRunCount: 2,
      discoveryPromotableCandidateCount: 1,
      discoveryNonPromotableCandidateCount: 1,
      discoverySelectorHintCount: 1,
      discoveryWarningCounts: [
        { warning: "login_or_account_surface", count: 1 }
      ]
    }));
    naverGroup.files.selectorHints = "C:\\promotion\\naver_map\\selector-hints.tsv";
    const audit = buildSourceCoverageReadinessAudit({
      category: "map_local",
      locale: "ko-KR",
      query: "seongsu cafe",
      promotionSummaries: [
        promotionSummary([
          naverGroup
        ])
      ]
    });

    const naver = audit.items.find((item) => item.platform === "naver_map");
    expect(naver?.destinationExtraction).toMatchObject({
      status: "needs_repeated_calibration",
      discoveryRunCount: 2,
      discoveryPromotableCandidateCount: 1,
      discoveryNonPromotableCandidateCount: 1,
      discoverySelectorHintCount: 1,
      selectorHintFiles: ["C:\\promotion\\naver_map\\selector-hints.tsv"],
      reasons: expect.arrayContaining([
        expect.stringContaining("Global destination discovery found 1 promotable destination target(s) and 1 selector hint")
      ]),
      nextActions: expect.arrayContaining([
        expect.stringContaining("selector hints")
      ])
    });
  });
});

function promotionSummary(groups: SourceNavigationPromotionSummary["groups"]): SourceNavigationPromotionSummary {
  return {
    schemaVersion: "1.0",
    executionPolicy: "explicit_opt_in_only",
    outputDir: "C:\\promotion",
    groupCount: groups.length,
    readyGroupCount: groups.filter((group) => group.status === "ready").length,
    emptyGroupCount: groups.filter((group) => group.status === "empty").length,
    actionFileCount: groups.length,
    groups,
    warnings: []
  };
}

function promotionGroup(
  platform: SourcePlatform,
  sourceFamily: SourceFamily,
  status: SourceNavigationPromotionSummary["groups"][number]["status"],
  actionCount: number,
  summary: Partial<SourceNavigationPromotionSummary["groups"][number]["catalogSummary"]>,
  destinationExtractionSummary?: NonNullable<SourceNavigationPromotionSummary["groups"][number]["destinationExtraction"]>
): SourceNavigationPromotionSummary["groups"][number] {
  return {
    platform,
    sourceFamily,
    url: `https://example.test/${platform}`,
    runDirs: [],
    status,
    actionCount,
    catalogSummary: {
      entryCount: 4,
      calibrationReportCount: 0,
      skippedCalibrationReportCount: 0,
      maintainedRecipeReadyCount: 0,
      singleRunReadyCount: 0,
      manualReviewCount: 0,
      manualValueCount: 0,
      calibrationRequiredCount: 4,
      blockedCount: 0,
      notSupportedCount: 0,
      recommendedActionCount: 0,
      maintainedDefaultReadyCount: 0,
      minimumCalibrationRunsRequired: 2,
      ...summary
    },
    files: {
      catalog: `C:\\promotion\\${platform}\\catalog.json`,
      export: `C:\\promotion\\${platform}\\export.json`,
      actions: `C:\\promotion\\${platform}\\actions.json`
    },
    ...(destinationExtractionSummary === undefined ? {} : { destinationExtraction: destinationExtractionSummary }),
    warnings: []
  };
}

function destinationExtraction(
  input: Partial<NonNullable<SourceNavigationPromotionSummary["groups"][number]["destinationExtraction"]>> = {}
): NonNullable<SourceNavigationPromotionSummary["groups"][number]["destinationExtraction"]> {
  return {
    candidateCount: 0,
    readyActionCount: 0,
    readyActionKeys: [],
    maintainedReadyCount: 0,
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
    clientStateProbeUniqueCandidateCount: 0,
    ...input
  };
}
