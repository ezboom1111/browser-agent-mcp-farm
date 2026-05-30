import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SourceNavigationCalibrationBatchManifest } from "../src/source-navigation-calibration-batch.js";
import type { SourceNavigationActionCalibrationResult, SourceNavigationCalibrationReport, SourceNavigationDestinationProbeResult, SourceNavigationSelectorCalibrationResult } from "../src/source-navigation-calibration.js";
import { parseSourceNavigationPromotionSummary, promoteSourceNavigationCalibrationBatch, reviewSourceNavigationPromotion, type SourceNavigationPromotionSummary } from "../src/source-navigation-promotion.js";
import { describeSourceNavigationPlan } from "../src/source-navigation.js";
import { describeSourceNavigationRecipePlan } from "../src/source-navigation-recipes.js";
import { describeSourceStrategy } from "../src/source-strategy.js";

let runDirs: string[] = [];

describe("promoteSourceNavigationCalibrationBatch", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("writes grouped catalog, export, and evidence-run action files", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-source-nav-promotion-"));
    runDirs.push(root);
    const firstRunDir = join(root, "google-r1");
    const secondRunDir = join(root, "google-r2");
    const recipePlan = describeSourceNavigationRecipePlan(
      describeSourceNavigationPlan({
        sourceStrategy: describeSourceStrategy("https://www.google.com/search?q=tokyo+hotel")
      })
    );
    await writeCalibrationRun(
      firstRunDir,
      calibrationReport(recipePlan, [calibratedAction("result-selection", "capture", [matched("result-selection", "#result-card")], [matched("result-selection", "#result-card", "capture_scope")]), calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", "#result-card")])])
    );
    await writeCalibrationRun(
      secondRunDir,
      calibrationReport(recipePlan, [calibratedAction("result-selection", "capture", [matched("result-selection", "#result-card")], [matched("result-selection", "#result-card", "capture_scope")]), calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", "#result-card")])])
    );

    const manifest: SourceNavigationCalibrationBatchManifest = {
      schemaVersion: "1.0",
      executionPolicy: "read_only_selector_probe_batch",
      runRoot: root,
      targetCount: 1,
      repeat: 2,
      runtime: {
        headed: true,
        storagePolicy: "storage-state",
        profileName: "search-profile",
        browserChannel: "chrome"
      },
      attemptCount: 2,
      succeededCount: 2,
      failedCount: 0,
      attempts: [],
      catalogHints: [
        {
          platform: "google_search",
          sourceFamily: "search",
          url: "https://www.google.com/search?q=tokyo+hotel",
          runDirs: [firstRunDir, secondRunDir],
          runtime: {
            headed: true,
            storagePolicy: "storage-state",
            profileName: "search-profile",
            browserChannel: "chrome"
          },
          catalogCommand: "",
          exportCommand: ""
        }
      ],
      warnings: []
    };

    const promotion = await promoteSourceNavigationCalibrationBatch({
      manifest,
      outputDir: join(root, "promotion")
    });

    expect(promotion).toMatchObject({
      groupCount: 1,
      readyGroupCount: 1,
      emptyGroupCount: 0,
      actionFileCount: 1
    });
    const group = promotion.groups[0];
    expect(group).toMatchObject({
      platform: "google_search",
      sourceFamily: "search",
      status: "ready",
      actionCount: 2,
      destinationExtraction: {
        candidateCount: 1,
        readyActionCount: 1,
        readyActionKeys: ["destination-followup"],
        maintainedReadyCount: 1
      }
    });
    const actions = JSON.parse(await readFile(group?.files.actions ?? "", "utf8")) as unknown[];
    expect(actions).toEqual([expect.objectContaining({ actionKey: "result-selection", operation: "capture" }), expect.objectContaining({ actionKey: "destination-followup", operation: "extract_destinations", selector: "#result-card", maxLinks: 10 })]);
    await expect(readFile(group?.files.catalog ?? "", "utf8")).resolves.toContain("maintained_recipe_ready");
    await expect(readFile(group?.files.export ?? "", "utf8")).resolves.toContain('"status": "ready"');

    const parsedPromotion = parseSourceNavigationPromotionSummary(`\uFEFF${JSON.stringify(promotion)}`);
    const review = reviewSourceNavigationPromotion(parsedPromotion, {
      evidenceRunOptions: {
        maxFollowUps: 3,
        maxFollowUpsPerDomain: 2,
        followUpConcurrency: 2,
        fallbackFollowUps: true,
        maxFallbackFollowUps: 1,
        maxDepth: 2,
        maxDeepeningRuns: 2,
        deepeningConcurrency: 2
      }
    });
    expect(review).toMatchObject({
      groupCount: 1,
      readyGroupCount: 1,
      readyActionFileCount: 1,
      blockedGroupCount: 0,
      needsRepeatedCalibrationGroupCount: 0,
      evidenceRunOptions: {
        maxFollowUps: 3,
        maxFollowUpsPerDomain: 2,
        followUpConcurrency: 2,
        fallbackFollowUps: true,
        maxFallbackFollowUps: 1,
        maxDepth: 2,
        maxDeepeningRuns: 2,
        deepeningConcurrency: 2
      }
    });
    expect(review.groups[0]?.destinationExtraction).toMatchObject({
      candidateCount: 1,
      readyActionCount: 1,
      readyActionKeys: ["destination-followup"]
    });
    expect(review.readyActionFiles[0]).toMatchObject({
      platform: "google_search",
      sourceFamily: "search",
      actionCount: 2,
      evidenceRun: {
        argv: [
          "node",
          ".\\dist\\cli.js",
          "evidence-run",
          "--url",
          "https://www.google.com/search?q=tokyo+hotel",
          "--headed",
          "--browser-channel",
          "chrome",
          "--profile",
          "search-profile",
          "--source-navigation-max-followups",
          "3",
          "--source-navigation-max-followups-per-domain",
          "2",
          "--source-navigation-followup-concurrency",
          "2",
          "--source-navigation-fallback-followups",
          "--source-navigation-max-fallback-followups",
          "1",
          "--source-navigation-max-depth",
          "2",
          "--source-navigation-max-deepening-runs",
          "2",
          "--source-navigation-deepening-concurrency",
          "2",
          "--source-navigation",
          "--source-navigation-actions-file",
          group?.files.actions
        ],
        sourceNavigationOptions: {
          maxFollowUps: 3,
          maxFollowUpsPerDomain: 2,
          followUpConcurrency: 2,
          fallbackFollowUps: true,
          maxFallbackFollowUps: 1,
          maxDepth: 2,
          maxDeepeningRuns: 2,
          deepeningConcurrency: 2
        }
      }
    });
    expect(review.readyActionFiles[0]?.evidenceRun.powershellCommand).toContain("--headed --browser-channel 'chrome' --profile 'search-profile'");
    expect(review.readyActionFiles[0]?.evidenceRun.powershellCommand).toContain("--source-navigation-max-followups 3 --source-navigation-max-followups-per-domain 2 --source-navigation-followup-concurrency 2");
    expect(review.readyActionFiles[0]?.evidenceRun.powershellCommand).toContain("--source-navigation-fallback-followups --source-navigation-max-fallback-followups 1");
    expect(review.readyActionFiles[0]?.evidenceRun.powershellCommand).toContain("--source-navigation-max-depth 2 --source-navigation-max-deepening-runs 2 --source-navigation-deepening-concurrency 2");
    expect(review.readyActionFiles[0]?.evidenceRun.powershellCommand).toContain("--source-navigation-actions-file");
  });

  it("promotes Naver Map client-state destination follow-up actions", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-source-nav-promotion-naver-state-"));
    runDirs.push(root);
    const firstRunDir = join(root, "naver-r1");
    const secondRunDir = join(root, "naver-r2");
    const url = "https://map.naver.com/p/search/seongsu%20cafe";
    const recipePlan = describeSourceNavigationRecipePlan(
      describeSourceNavigationPlan({
        sourceStrategy: describeSourceStrategy(url)
      })
    );
    await writeCalibrationRun(firstRunDir, calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_client_state_destinations", [matched("destination-followup", "#app-root")], [], { clientStateProbe: clientStateProbe() })]));
    await writeCalibrationRun(secondRunDir, calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_client_state_destinations", [matched("destination-followup", "#app-root")], [], { clientStateProbe: clientStateProbe() })]));

    const manifest: SourceNavigationCalibrationBatchManifest = {
      schemaVersion: "1.0",
      executionPolicy: "read_only_selector_probe_batch",
      runRoot: root,
      targetCount: 1,
      repeat: 2,
      runtime: {
        headed: false,
        storagePolicy: "ephemeral"
      },
      attemptCount: 2,
      succeededCount: 2,
      failedCount: 0,
      attempts: [],
      catalogHints: [
        {
          platform: "naver_map",
          sourceFamily: "map",
          url,
          runDirs: [firstRunDir, secondRunDir],
          catalogCommand: "",
          exportCommand: ""
        }
      ],
      warnings: []
    };

    const promotion = await promoteSourceNavigationCalibrationBatch({
      manifest,
      outputDir: join(root, "promotion")
    });

    const group = promotion.groups[0];
    expect(group).toMatchObject({
      platform: "naver_map",
      sourceFamily: "map",
      status: "ready",
      actionCount: 1,
      destinationExtraction: {
        candidateCount: 2,
        readyActionCount: 1,
        readyActionKeys: ["destination-followup"],
        maintainedReadyCount: 1,
        clientStateProbeRunCount: 2,
        clientStateProbeOkRunCount: 2,
        clientStateProbeUniqueCandidateCount: 2
      }
    });
    const actions = JSON.parse(await readFile(group?.files.actions ?? "", "utf8")) as unknown[];
    expect(actions).toEqual([
      expect.objectContaining({
        actionKey: "destination-followup",
        operation: "extract_client_state_destinations",
        selector: "#app-root",
        stateKey: "__APOLLO_STATE__",
        extractor: "naver_place_apollo",
        destinationPath: "restaurant",
        maxLinks: 10
      })
    ]);
  });

  it("classifies empty promotion groups by the next required review action", () => {
    const baseSummary = catalogSummary();
    const promotion: SourceNavigationPromotionSummary = {
      schemaVersion: "1.0",
      executionPolicy: "explicit_opt_in_only",
      outputDir: "C:\\promotion",
      groupCount: 3,
      readyGroupCount: 0,
      emptyGroupCount: 3,
      actionFileCount: 3,
      groups: [
        promotionGroup({
          catalogSummary: {
            ...baseSummary,
            blockedCount: 1,
            calibrationReportCount: 2,
            calibrationRequiredCount: 0
          }
        }),
        promotionGroup({
          sourceFamily: "map",
          catalogSummary: {
            ...baseSummary,
            calibrationReportCount: 1,
            singleRunReadyCount: 1,
            calibrationRequiredCount: 2
          }
        }),
        promotionGroup({
          sourceFamily: "travel_booking",
          catalogSummary: {
            ...baseSummary,
            calibrationReportCount: 2,
            calibrationRequiredCount: 0,
            manualReviewCount: 1,
            manualValueCount: 1
          }
        })
      ],
      warnings: []
    };

    const review = reviewSourceNavigationPromotion(promotion);

    expect(review).toMatchObject({
      readyGroupCount: 0,
      readyActionFileCount: 0,
      blockedGroupCount: 1,
      needsRepeatedCalibrationGroupCount: 1,
      manualReviewRequiredGroupCount: 1
    });
    expect(review.groups.map((group) => group.status)).toEqual(["blocked", "needs_repeated_calibration", "manual_review_required"]);
    expect(review.warnings).toContain("No ready action files were found in this promotion summary.");
  });

  it("summarizes blocked calibration signals into promotion and review handoffs", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-source-nav-promotion-blocked-signals-"));
    runDirs.push(root);
    const firstRunDir = join(root, "google-blocked-r1");
    const secondRunDir = join(root, "google-blocked-r2");
    const recipePlan = describeSourceNavigationRecipePlan(
      describeSourceNavigationPlan({
        sourceStrategy: describeSourceStrategy("https://www.google.com/search?q=tokyo+hotel")
      })
    );
    const blockedSignals = [
      { actionKey: "result-selection", signal: "captcha-delivery.com", kind: "blocked_text" as const, status: "present" as const },
      { actionKey: "result-selection", signal: "var dd=", kind: "blocked_text" as const, status: "present" as const }
    ];
    for (const runDir of [firstRunDir, secondRunDir]) {
      await writeCalibrationRun(
        runDir,
        calibrationReport(recipePlan, [
          calibratedAction("result-selection", "capture", [matched("result-selection", "#search")], [matched("result-selection", "#search", "capture_scope")], {
            status: "blocked_signal_detected",
            blockedSignals
          })
        ])
      );
    }

    const promotion = await promoteSourceNavigationCalibrationBatch({
      manifest: {
        schemaVersion: "1.0",
        executionPolicy: "read_only_selector_probe_batch",
        runRoot: root,
        targetCount: 1,
        repeat: 2,
        runtime: {
          headed: false,
          storagePolicy: "ephemeral"
        },
        attemptCount: 2,
        succeededCount: 2,
        failedCount: 0,
        attempts: [],
        catalogHints: [
          {
            platform: "google_search",
            sourceFamily: "search",
            url: "https://www.google.com/search?q=tokyo+hotel",
            runDirs: [firstRunDir, secondRunDir],
            catalogCommand: "",
            exportCommand: ""
          }
        ],
        warnings: []
      },
      outputDir: join(root, "promotion")
    });

    expect(promotion.groups[0]).toMatchObject({
      status: "empty",
      catalogSummary: {
        blockedCount: 1
      },
      blockedSignalCounts: [
        { signal: "captcha-delivery.com", count: 2, actionKeys: ["result-selection"] },
        { signal: "var dd=", count: 2, actionKeys: ["result-selection"] }
      ]
    });
    const parsedPromotion = parseSourceNavigationPromotionSummary(JSON.stringify(promotion));
    const review = reviewSourceNavigationPromotion(parsedPromotion);
    expect(review.groups[0]).toMatchObject({
      status: "blocked",
      blockedSignalCounts: [
        { signal: "captcha-delivery.com", count: 2, actionKeys: ["result-selection"] },
        { signal: "var dd=", count: 2, actionKeys: ["result-selection"] }
      ],
      reasons: expect.arrayContaining([expect.stringContaining("Blocked signal pressure: captcha-delivery.com:2")])
    });
  });

  it("treats blocked calibration signals as blocking even when another action exported", () => {
    const promotion: SourceNavigationPromotionSummary = {
      schemaVersion: "1.0",
      executionPolicy: "explicit_opt_in_only",
      outputDir: "C:\\promotion",
      groupCount: 1,
      readyGroupCount: 1,
      emptyGroupCount: 0,
      actionFileCount: 1,
      groups: [
        promotionGroup({
          status: "ready",
          actionCount: 1,
          catalogSummary: {
            ...catalogSummary(),
            calibrationReportCount: 2,
            maintainedRecipeReadyCount: 1,
            calibrationRequiredCount: 0,
            recommendedActionCount: 1,
            maintainedDefaultReadyCount: 1,
            blockedCount: 1
          },
          blockedSignalCounts: [{ signal: "captcha-delivery.com", count: 7, actionKeys: ["article-capture", "obstruction-check"] }]
        })
      ],
      warnings: []
    };

    const review = reviewSourceNavigationPromotion(promotion);

    expect(review).toMatchObject({
      readyGroupCount: 0,
      blockedGroupCount: 1,
      readyActionFileCount: 0
    });
    expect(review.groups[0]).toMatchObject({
      status: "blocked",
      blockedSignalCounts: [{ signal: "captcha-delivery.com", count: 7, actionKeys: ["article-capture", "obstruction-check"] }],
      reasons: expect.arrayContaining([expect.stringContaining("No maintained read-only action file is ready"), expect.stringContaining("Blocked signal pressure: captcha-delivery.com:7")])
    });
  });

  it("carries global destination discovery counts into promotion review reasons", () => {
    const promotion: SourceNavigationPromotionSummary = {
      schemaVersion: "1.0",
      executionPolicy: "explicit_opt_in_only",
      outputDir: "C:\\promotion",
      groupCount: 1,
      readyGroupCount: 0,
      emptyGroupCount: 1,
      actionFileCount: 1,
      groups: [
        promotionGroup({
          sourceFamily: "map",
          catalogSummary: {
            ...catalogSummary(),
            calibrationReportCount: 2,
            calibrationRequiredCount: 1
          },
          destinationExtraction: {
            candidateCount: 1,
            readyActionCount: 0,
            readyActionKeys: [],
            maintainedReadyCount: 0,
            singleRunReadyCount: 0,
            calibrationRequiredCount: 1,
            blockedCount: 0,
            manualReviewCount: 0,
            manualValueCount: 0,
            discoveryRunCount: 2,
            discoveryPromotableCandidateCount: 2,
            discoveryNonPromotableCandidateCount: 1,
            discoverySelectorHintCount: 2,
            discoveryWarningCounts: [{ warning: "login_or_account_surface", count: 1 }],
            clientStateProbeRunCount: 0,
            clientStateProbeOkRunCount: 0,
            clientStateProbeUniqueCandidateCount: 0
          }
        })
      ],
      warnings: []
    };

    const review = reviewSourceNavigationPromotion(promotion);

    expect(review.groups[0]).toMatchObject({
      status: "needs_repeated_calibration",
      destinationExtraction: {
        discoveryRunCount: 2,
        discoveryPromotableCandidateCount: 2,
        discoveryNonPromotableCandidateCount: 1,
        discoverySelectorHintCount: 2
      },
      reasons: expect.arrayContaining([expect.stringContaining("Global destination discovery found 2 promotable destination target(s) and 2 selector hint")])
    });
  });

  it("writes selector-hints TSV files for discovery handoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-source-nav-promotion-hints-"));
    runDirs.push(root);
    const runDir = join(root, "naver-map-r1");
    const url = "https://map.naver.com/p/search/seongsu%20cafe";
    const recipePlan = describeSourceNavigationRecipePlan(
      describeSourceNavigationPlan({
        sourceStrategy: describeSourceStrategy(url)
      })
    );
    await writeCalibrationRun(
      runDir,
      calibrationReport(recipePlan, [
        calibratedAction("destination-followup", "extract_destinations", [], [], {
          destinationDiscovery: destinationDiscovery()
        })
      ])
    );

    const manifest: SourceNavigationCalibrationBatchManifest = {
      schemaVersion: "1.0",
      executionPolicy: "read_only_selector_probe_batch",
      runRoot: root,
      targetCount: 1,
      repeat: 1,
      runtime: {
        headed: false,
        storagePolicy: "ephemeral"
      },
      attemptCount: 1,
      succeededCount: 1,
      failedCount: 0,
      attempts: [],
      catalogHints: [
        {
          platform: "naver_map",
          sourceFamily: "map",
          url,
          runDirs: [runDir],
          catalogCommand: "",
          exportCommand: ""
        }
      ],
      warnings: []
    };

    const promotion = await promoteSourceNavigationCalibrationBatch({
      manifest,
      outputDir: join(root, "promotion")
    });

    const group = promotion.groups[0];
    expect(group).toMatchObject({
      destinationExtraction: {
        discoverySelectorHintCount: 1
      },
      files: {
        selectorHints: expect.stringContaining("selector-hints.tsv")
      }
    });
    await expect(readFile(group?.files.selectorHints ?? "", "utf8")).resolves.toContain(
      'naver_map\tmap\tdestination-followup\t[data-place-url*="place.naver.com/restaurant"]\t#root [data-place-url*="place.naver.com/restaurant"]\thttps://place.naver.com/restaurant/1\tplace.naver.com\t/restaurant\tattribute\tdata-place-url\tmanual_calibration_required'
    );
    const parsed = parseSourceNavigationPromotionSummary(JSON.stringify(promotion));
    expect(parsed.groups[0]?.files.selectorHints).toBe(group?.files.selectorHints);
  });
});

function calibrationReport(recipePlan: ReturnType<typeof describeSourceNavigationRecipePlan>, actionCalibrations: SourceNavigationActionCalibrationResult[]): SourceNavigationCalibrationReport {
  return {
    schemaVersion: "1.0",
    url: "https://www.google.com/search?q=tokyo+hotel",
    platform: recipePlan.platform,
    sourceFamily: recipePlan.sourceFamily,
    recipeExecutionPolicy: recipePlan.executionPolicy,
    executionPolicy: "read_only_selector_probe",
    selectorTimeoutMs: 1000,
    actionCalibrations,
    summary: {
      executionPolicy: "read_only_selector_probe",
      actionCandidateCount: actionCalibrations.length,
      observedActionCount: actionCalibrations.length,
      partialActionCount: 0,
      notObservedActionCount: 0,
      blockedActionCount: 0,
      erroredActionCount: 0,
      selectorCandidateCount: actionCalibrations.flatMap((action) => action.selectorResults).length,
      matchedSelectorCount: actionCalibrations.flatMap((action) => action.selectorResults).length,
      captureScopeCandidateCount: actionCalibrations.flatMap((action) => action.captureScopeResults).length,
      matchedCaptureScopeCount: actionCalibrations.flatMap((action) => action.captureScopeResults).length,
      expectedSignalHits: 0,
      blockedSignalHits: 0,
      realSiteCandidateMatches: 0,
      localFixtureCandidateMatches: 0,
      clientStateProbeCount: actionCalibrations.filter((action) => action.clientStateProbe !== undefined).length,
      clientStateProbeOkCount: actionCalibrations.filter((action) => action.clientStateProbe?.status === "ok").length,
      manualOnly: true
    },
    warnings: []
  };
}

function calibratedAction(
  actionKey: string,
  operation: SourceNavigationActionCalibrationResult["operation"],
  selectorResults: SourceNavigationSelectorCalibrationResult[],
  captureScopeResults: SourceNavigationSelectorCalibrationResult[] = [],
  overrides: Partial<SourceNavigationActionCalibrationResult> = {}
): SourceNavigationActionCalibrationResult {
  return {
    actionKey,
    operation,
    verificationStatus: "fixture_verified",
    status: "observed",
    selectorResults,
    captureScopeResults,
    expectedTextSignals: [],
    blockedSignals: [],
    riskNotes: [],
    ...overrides
  };
}

function clientStateProbe(overrides: Partial<NonNullable<SourceNavigationActionCalibrationResult["clientStateProbe"]>> = {}): NonNullable<SourceNavigationActionCalibrationResult["clientStateProbe"]> {
  return {
    status: "ok",
    stateKey: "__APOLLO_STATE__",
    extractor: "naver_place_apollo",
    destinationPath: "restaurant",
    frameCount: 1,
    matchedFrameCount: 1,
    parsedFrameCount: 1,
    truncatedFrameCount: 0,
    rawCandidateCount: 1,
    uniqueCandidateCount: 1,
    sampleUrls: ["https://map.naver.com/p/entry/place/1790076538"],
    sampleOriginalUrls: ["https://place.naver.com/restaurant/1790076538"],
    sampleTexts: ["\uC131\uC218 \uCE74\uD398 | \uCE74\uD398"],
    sampleFrameUrls: ["https://map.naver.com/p/search/seongsu%20cafe"],
    ...overrides
  };
}

function matched(actionKey: string, selector: string, kind: SourceNavigationSelectorCalibrationResult["kind"] = "selector", source: SourceNavigationSelectorCalibrationResult["source"] = "real_site_candidate"): SourceNavigationSelectorCalibrationResult {
  return {
    actionKey,
    selector,
    target: kind === "selector" ? "primary" : "scope",
    source,
    kind,
    status: "matched",
    matchCount: 1,
    visibleCount: 1,
    inspectedCount: 1,
    note: source === "local_fixture" ? "fixture match" : "real-site match"
  };
}

function destinationDiscovery(): SourceNavigationDestinationProbeResult {
  return {
    status: "ok",
    rawCandidateCount: 1,
    usableCandidateCount: 1,
    uniqueCandidateCount: 1,
    duplicateCandidateCount: 0,
    omittedDuplicateCount: 0,
    anchorCandidateCount: 0,
    attributeCandidateCount: 1,
    promotableCandidateCount: 1,
    nonPromotableCandidateCount: 0,
    warningCounts: [],
    samplePromotableTargets: [
      {
        url: "https://place.naver.com/restaurant/1",
        text: "Seongsu Cafe",
        source: "attribute",
        attributeName: "data-place-url",
        warnings: []
      }
    ]
  };
}

async function writeCalibrationRun(runDir: string, report: SourceNavigationCalibrationReport): Promise<void> {
  await mkdir(join(runDir, "raw"), { recursive: true });
  await writeFile(join(runDir, "raw", "source-navigation-calibration.txt"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(
    join(runDir, "artifacts.jsonl"),
    JSON.stringify({
      path: "raw/source-navigation-calibration.txt",
      kind: "text",
      format: "txt",
      tool_name: "source_navigation_calibration",
      evidence_kind: "source_navigation_calibration"
    }),
    "utf8"
  );
}

function promotionGroup(input: Partial<SourceNavigationPromotionSummary["groups"][number]>): SourceNavigationPromotionSummary["groups"][number] {
  return {
    platform: input.platform ?? "google_search",
    sourceFamily: input.sourceFamily ?? "search",
    url: input.url ?? "https://www.google.com/search?q=tokyo+hotel",
    runDirs: input.runDirs ?? [],
    runtime: input.runtime ?? {
      headed: false,
      storagePolicy: "ephemeral"
    },
    status: input.status ?? "empty",
    actionCount: input.actionCount ?? 0,
    catalogSummary: input.catalogSummary ?? catalogSummary(),
    ...(input.blockedSignalCounts === undefined ? {} : { blockedSignalCounts: input.blockedSignalCounts }),
    ...(input.destinationExtraction === undefined ? {} : { destinationExtraction: input.destinationExtraction }),
    files: input.files ?? {
      catalog: "C:\\promotion\\catalog.json",
      export: "C:\\promotion\\export.json",
      actions: "C:\\promotion\\actions.json"
    },
    warnings: input.warnings ?? []
  };
}

function catalogSummary(): SourceNavigationPromotionSummary["groups"][number]["catalogSummary"] {
  return {
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
    minimumCalibrationRunsRequired: 2
  };
}
