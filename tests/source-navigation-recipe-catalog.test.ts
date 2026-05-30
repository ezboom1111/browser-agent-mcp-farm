import { describe, expect, it } from "vitest";
import { applySourceNavigationSelectorHintsToRecipePlan, buildSourceNavigationRecipeCatalog, exportMaintainedSourceNavigationRecipes, formatSourceNavigationDestinationSelectorHintsAsLines, parseSourceNavigationDestinationSelectorHintsAsLines } from "../src/source-navigation-recipe-catalog.js";
import type { SourceNavigationActionCalibrationResult, SourceNavigationCalibrationReport, SourceNavigationDestinationProbeResult, SourceNavigationSelectorCalibrationResult } from "../src/source-navigation-calibration.js";
import { describeSourceNavigationPlan } from "../src/source-navigation.js";
import { describeSourceNavigationRecipePlan } from "../src/source-navigation-recipes.js";
import { describeSourceStrategy } from "../src/source-strategy.js";

describe("buildSourceNavigationRecipeCatalog", () => {
  it("keeps recipe candidates calibration-required without calibration evidence", () => {
    const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
    const catalog = buildSourceNavigationRecipeCatalog({ recipePlan });

    expect(catalog.generatedFrom).toBe("recipe_plan");
    expect(catalog.executionPolicy).toBe("explicit_opt_in_only");
    expect(catalog.summary.calibrationRequiredCount).toBe(recipePlan.actionCandidates.length);
    expect(catalog.summary.maintainedDefaultReadyCount).toBe(0);
    expect(catalog.entries.every((entry) => entry.recommendedAction === undefined)).toBe(true);
  });

  it("turns calibrated read-only actions into explicit recipe proposals while keeping mutating actions manual", () => {
    const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReport: calibrationReport(recipePlan, [
        calibratedAction("query-state", "fill", [matched("query-state", "#google-query")]),
        calibratedAction("vertical-tab", "click", [matched("vertical-tab", "#tab-images")]),
        calibratedAction("result-selection", "capture", [matched("result-selection", "#result-card")], [matched("result-selection", "#result-card", "capture_scope")]),
        calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", "#result-card")])
      ])
    });

    expect(catalog.generatedFrom).toBe("calibration_report");
    expect(catalog.summary.singleRunReadyCount).toBe(2);
    expect(catalog.summary.manualValueCount).toBe(1);
    expect(catalog.summary.manualReviewCount).toBe(1);
    expect(catalog.summary.maintainedDefaultReadyCount).toBe(0);
    expect(catalog.entries.find((entry) => entry.actionKey === "query-state")?.readiness).toBe("manual_value_required");
    expect(catalog.entries.find((entry) => entry.actionKey === "vertical-tab")?.readiness).toBe("manual_review_required");
    expect(catalog.entries.find((entry) => entry.actionKey === "result-selection")?.recommendedAction).toMatchObject({
      actionKey: "result-selection",
      operation: "capture",
      captureScopes: [{ selector: "#result-card" }]
    });
    expect(catalog.entries.find((entry) => entry.actionKey === "destination-followup")?.recommendedAction).toMatchObject({
      actionKey: "destination-followup",
      operation: "extract_destinations",
      selector: "#result-card",
      maxLinks: 10
    });
  });

  it("promotes repeated stable read-only calibration into maintained recipe readiness", () => {
    const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [calibratedAction("result-selection", "capture", [matched("result-selection", "#result-card")], [matched("result-selection", "#result-card", "capture_scope")]), calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", "#result-card")])]),
        calibrationReport(recipePlan, [calibratedAction("result-selection", "capture", [matched("result-selection", "#result-card")], [matched("result-selection", "#result-card", "capture_scope")]), calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", "#result-card")])])
      ]
    });

    expect(catalog.generatedFrom).toBe("calibration_reports");
    expect(catalog.summary.maintainedRecipeReadyCount).toBe(2);
    expect(catalog.summary.maintainedDefaultReadyCount).toBe(2);
    expect(catalog.entries.find((entry) => entry.actionKey === "result-selection")).toMatchObject({
      readiness: "maintained_recipe_ready",
      calibrationRunCount: 2,
      stableCaptureScopes: [{ selector: "#result-card" }],
      recommendedAction: {
        actionKey: "result-selection",
        operation: "capture"
      }
    });
    expect(catalog.entries.find((entry) => entry.actionKey === "destination-followup")).toMatchObject({
      readiness: "maintained_recipe_ready",
      stableSelectors: [{ selector: "#result-card" }],
      recommendedAction: {
        actionKey: "destination-followup",
        operation: "extract_destinations",
        selector: "#result-card",
        maxLinks: 10
      }
    });

    const exportBundle = exportMaintainedSourceNavigationRecipes(catalog);
    expect(exportBundle).toMatchObject({
      status: "ready",
      actionCount: 2,
      actions: [
        {
          actionKey: "result-selection",
          operation: "capture"
        },
        {
          actionKey: "destination-followup",
          operation: "extract_destinations",
          selector: "#result-card",
          maxLinks: 10
        }
      ]
    });
    expect(exportBundle.omittedEntries).toEqual(expect.arrayContaining([expect.objectContaining({ actionKey: "query-state", readiness: "calibration_required" }), expect.objectContaining({ actionKey: "vertical-tab", readiness: "calibration_required" })]));
  });

  it("does not promote broad destination fallback selectors into maintained recipes", () => {
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", '#root a[href^="http"]', "selector", "real_site_candidate", "fallback")])]),
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", '#root a[href^="http"]', "selector", "real_site_candidate", "fallback")])])
      ]
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup).toMatchObject({
      readiness: "calibration_required",
      reason: expect.stringContaining("broad destination fallback selectors"),
      matchedSelectors: [expect.objectContaining({ selector: '#root a[href^="http"]', target: "fallback" }), expect.objectContaining({ selector: '#root a[href^="http"]', target: "fallback" })],
      stableSelectors: []
    });
    expect(destinationFollowup?.recommendedAction).toBeUndefined();
    expect(exportMaintainedSourceNavigationRecipes(catalog)).toMatchObject({
      status: "empty",
      actionCount: 0
    });
  });

  it("does not promote broad page-shell containers into maintained destination extraction", () => {
    const recipePlan = recipePlanFor("https://search.yahoo.co.jp/search?p=tokyo+hotel");
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", "#contents", "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(5, 5)
            })
          ])
        ]),
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", "#contents", "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(5, 5)
            })
          ])
        ])
      ]
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup).toMatchObject({
      readiness: "calibration_required",
      reason: expect.stringContaining("broad destination fallback selectors"),
      matchedSelectors: [expect.objectContaining({ selector: "#contents", target: "fallback" }), expect.objectContaining({ selector: "#contents", target: "fallback" })],
      stableSelectors: []
    });
    expect(destinationFollowup?.recommendedAction).toBeUndefined();
  });

  it("prefers narrower search result-card selectors over broad result containers", () => {
    const recipePlan = recipePlanFor("https://www.bing.com/search?q=tokyo+hotel");
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", "#b_results", "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(10, 10)
            }),
            matched("destination-followup", "#b_results .b_algo", "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(5, 5)
            })
          ])
        ]),
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", "#b_results", "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(10, 10)
            }),
            matched("destination-followup", "#b_results .b_algo", "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(5, 5)
            })
          ])
        ])
      ]
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup).toMatchObject({
      readiness: "maintained_recipe_ready",
      stableSelectors: [expect.objectContaining({ selector: "#b_results .b_algo", target: "fallback" })],
      recommendedAction: {
        actionKey: "destination-followup",
        operation: "extract_destinations",
        selector: "#b_results .b_algo",
        maxLinks: 10
      }
    });
  });

  it("prefers semantic Google Travel destination selectors over generic organic links", () => {
    const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
    const genericHeadingSelector = "#rso a[href]:has(h3)";
    const travelSelector = '#search a[href*="/travel/hotels"]';
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", "#rso", "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(9, 9)
            }),
            matched("destination-followup", genericHeadingSelector, "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(9, 9)
            }),
            matched("destination-followup", travelSelector, "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(1, 1)
            })
          ])
        ]),
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", "#rso", "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(9, 9)
            }),
            matched("destination-followup", genericHeadingSelector, "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(9, 9)
            }),
            matched("destination-followup", travelSelector, "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(1, 1)
            })
          ])
        ])
      ]
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup?.readiness).toBe("maintained_recipe_ready");
    expect(destinationFollowup?.stableSelectors[0]).toMatchObject({ selector: travelSelector, target: "fallback" });
    expect(destinationFollowup?.recommendedAction).toMatchObject({
      actionKey: "destination-followup",
      operation: "extract_destinations",
      selector: travelSelector,
      maxLinks: 10
    });
    expect(destinationFollowup?.stableSelectors.map((result) => result.selector)).not.toContain("#rso");
  });

  it("prefers precise YouTube media selectors over broad renderer links", () => {
    const recipePlan = recipePlanFor("https://www.youtube.com/results?search_query=seongsu+cafe");
    const broadRendererSelector = "ytd-video-renderer a[href]";
    const contentsWatchSelector = '#contents a[href*="/watch"]';
    const channelThumbnailSelector = 'a#channel-thumbnail[href*="/channel/"]';
    const titleWatchSelector = 'ytd-video-renderer a#video-title[href*="/watch"]';
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", broadRendererSelector, "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(6, 6)
            }),
            matched("destination-followup", contentsWatchSelector, "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(3, 3)
            }),
            matched("destination-followup", channelThumbnailSelector, "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(6, 6)
            }),
            matched("destination-followup", titleWatchSelector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(1, 1)
            })
          ])
        ]),
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", broadRendererSelector, "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(6, 6)
            }),
            matched("destination-followup", contentsWatchSelector, "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(3, 3)
            }),
            matched("destination-followup", channelThumbnailSelector, "selector", "real_site_candidate", "fallback", {
              destinationProbe: destinationProbe(6, 6)
            }),
            matched("destination-followup", titleWatchSelector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(1, 1)
            })
          ])
        ])
      ]
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup?.readiness).toBe("maintained_recipe_ready");
    expect(destinationFollowup?.stableSelectors[0]).toMatchObject({ selector: titleWatchSelector, target: "primary" });
    expect(destinationFollowup?.recommendedAction).toMatchObject({
      actionKey: "destination-followup",
      operation: "extract_destinations",
      selector: titleWatchSelector,
      maxLinks: 10
    });
    expect(destinationFollowup?.stableSelectors.map((result) => result.selector)).not.toContain(broadRendererSelector);
    expect(destinationFollowup?.stableSelectors[0]?.selector).not.toBe(channelThumbnailSelector);
  });

  it("prefers dated Reuters article selectors over broad Reuters shell link selectors", () => {
    const recipePlan = recipePlanFor("https://www.reuters.com/site-search/?query=AI%20policy");
    const broadSelector = 'main a[href*="reuters.com"]';
    const narrowSelector = 'main a[href*="/world/"][href*="-20"]';
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", broadSelector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(10, 10)
            }),
            matched("destination-followup", narrowSelector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(2, 2)
            })
          ])
        ]),
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", broadSelector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(10, 10)
            }),
            matched("destination-followup", narrowSelector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(2, 2)
            })
          ])
        ])
      ]
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup).toMatchObject({
      readiness: "maintained_recipe_ready",
      stableSelectors: [expect.objectContaining({ selector: narrowSelector })],
      recommendedAction: {
        actionKey: "destination-followup",
        operation: "extract_destinations",
        selector: narrowSelector,
        maxLinks: 10
      }
    });
    expect(destinationFollowup?.stableSelectors).not.toEqual(expect.arrayContaining([expect.objectContaining({ selector: broadSelector })]));
  });

  it("promotes scoped map destination selectors that include provider-specific href filters", () => {
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const selector = '#root a[href*="place.naver.com"]';
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")])]),
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")])])
      ]
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup).toMatchObject({
      readiness: "maintained_recipe_ready",
      stableSelectors: [expect.objectContaining({ selector, target: "primary" })],
      recommendedAction: {
        actionKey: "destination-followup",
        operation: "extract_destinations",
        selector,
        maxLinks: 10
      }
    });
    expect(exportMaintainedSourceNavigationRecipes(catalog)).toMatchObject({
      status: "ready",
      actionCount: 1,
      actions: [
        {
          actionKey: "destination-followup",
          operation: "extract_destinations",
          selector,
          maxLinks: 10
        }
      ]
    });
  });

  it("promotes Naver Map client-state destination extraction as an alternative follow-up recipe", () => {
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const selector = "#app-root";
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_client_state_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")], [], { clientStateProbe: clientStateProbe() })]),
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_client_state_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")], [], { clientStateProbe: clientStateProbe() })])
      ]
    });

    const clientStateFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup" && entry.operation === "extract_client_state_destinations");
    expect(clientStateFollowup).toMatchObject({
      readiness: "maintained_recipe_ready",
      stableSelectors: [expect.objectContaining({ selector, target: "primary" })],
      clientStateProbe: {
        runCount: 2,
        okRunCount: 2,
        totalUniqueCandidateCount: 2,
        sampleUrls: ["https://map.naver.com/p/entry/place/1790076538"]
      },
      recommendedAction: {
        actionKey: "destination-followup",
        operation: "extract_client_state_destinations",
        selector,
        stateKey: "__APOLLO_STATE__",
        extractor: "naver_place_apollo",
        destinationPath: "restaurant",
        maxLinks: 10
      }
    });
    expect(catalog.entries.find((entry) => entry.actionKey === "destination-followup" && entry.operation === "extract_destinations")?.readiness).toBe("calibration_required");
    expect(exportMaintainedSourceNavigationRecipes(catalog)).toMatchObject({
      status: "ready",
      actionCount: 1,
      actions: [
        {
          actionKey: "destination-followup",
          operation: "extract_client_state_destinations",
          selector,
          stateKey: "__APOLLO_STATE__",
          extractor: "naver_place_apollo",
          destinationPath: "restaurant",
          maxLinks: 10
        }
      ]
    });
  });

  it("does not promote Naver Map client-state extraction when calibration cannot parse destination candidates", () => {
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const selector = "#app-root";
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_client_state_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")], [], { clientStateProbe: clientStateProbe({ status: "no_candidates", rawCandidateCount: 0, uniqueCandidateCount: 0 }) })
        ]),
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_client_state_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")], [], {
            clientStateProbe: clientStateProbe({ status: "no_state_found", matchedFrameCount: 0, parsedFrameCount: 0, rawCandidateCount: 0, uniqueCandidateCount: 0 })
          })
        ])
      ]
    });

    const clientStateFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup" && entry.operation === "extract_client_state_destinations");
    expect(clientStateFollowup).toMatchObject({
      readiness: "calibration_required",
      reason: expect.stringContaining("needs 2 successful probe run"),
      clientStateProbe: {
        runCount: 2,
        okRunCount: 0,
        totalUniqueCandidateCount: 0
      }
    });
    expect(clientStateFollowup?.recommendedAction).toBeUndefined();
  });

  it("does not promote generic Naver Map domain selectors without a place-specific path", () => {
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const selector = '#root a[href*="map.naver.com"]';
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")])]),
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")])])
      ]
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup).toMatchObject({
      readiness: "calibration_required",
      reason: expect.stringContaining("broad destination fallback selectors"),
      stableSelectors: []
    });
    expect(destinationFollowup?.recommendedAction).toBeUndefined();
    expect(exportMaintainedSourceNavigationRecipes(catalog).status).toBe("empty");
  });

  it("does not promote broad SPA destination attribute selectors without a narrowed URL or semantic attribute", () => {
    const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
    const selector = "#search [data-url]";
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")])]),
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")])])
      ]
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup).toMatchObject({
      readiness: "calibration_required",
      reason: expect.stringContaining("broad destination fallback selectors"),
      stableSelectors: []
    });
    expect(destinationFollowup?.recommendedAction).toBeUndefined();
    expect(exportMaintainedSourceNavigationRecipes(catalog).status).toBe("empty");
  });

  it("promotes scoped SPA destination attributes when they encode a provider-specific destination", () => {
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const selector = '#root [data-url*="place.naver.com"]';
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")])]),
        calibrationReport(recipePlan, [calibratedAction("destination-followup", "extract_destinations", [matched("destination-followup", selector, "selector", "real_site_candidate", "primary")])])
      ]
    });

    expect(catalog.entries.find((entry) => entry.actionKey === "destination-followup")).toMatchObject({
      readiness: "maintained_recipe_ready",
      recommendedAction: {
        actionKey: "destination-followup",
        operation: "extract_destinations",
        selector,
        maxLinks: 10
      }
    });
    expect(exportMaintainedSourceNavigationRecipes(catalog).status).toBe("ready");
  });

  it("does not promote matched destination selectors when the destination probe finds no usable links", () => {
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const selector = '#root [data-url*="place.naver.com"]';
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", selector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(0)
            })
          ])
        ]),
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", selector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(0)
            })
          ])
        ])
      ]
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup).toMatchObject({
      readiness: "calibration_required",
      reason: expect.stringContaining("no usable HTTP(S) destination links"),
      stableSelectors: []
    });
    expect(destinationFollowup?.recommendedAction).toBeUndefined();
    expect(exportMaintainedSourceNavigationRecipes(catalog).status).toBe("empty");
  });

  it("promotes matched destination selectors when repeated probes find usable links", () => {
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const selector = '#root [data-url*="place.naver.com"]';
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", selector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(2)
            })
          ])
        ]),
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", selector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(2)
            })
          ])
        ])
      ]
    });

    expect(catalog.entries.find((entry) => entry.actionKey === "destination-followup")).toMatchObject({
      readiness: "maintained_recipe_ready",
      recommendedAction: {
        actionKey: "destination-followup",
        operation: "extract_destinations",
        selector,
        maxLinks: 10
      }
    });
    expect(exportMaintainedSourceNavigationRecipes(catalog).status).toBe("ready");
  });

  it("does not promote matched destination selectors when probes find only non-promotable links", () => {
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const selector = '#root [data-url*="place.naver.com"]';
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", selector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(2, 0)
            })
          ])
        ]),
        calibrationReport(recipePlan, [
          calibratedAction("destination-followup", "extract_destinations", [
            matched("destination-followup", selector, "selector", "real_site_candidate", "primary", {
              destinationProbe: destinationProbe(2, 0)
            })
          ])
        ])
      ]
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup).toMatchObject({
      readiness: "calibration_required",
      reason: expect.stringContaining("only low-value, login, or unsupported destination links"),
      stableSelectors: []
    });
    expect(destinationFollowup?.recommendedAction).toBeUndefined();
    expect(exportMaintainedSourceNavigationRecipes(catalog).status).toBe("empty");
  });

  it("surfaces promotable global destination discovery without promoting unplanned selectors", () => {
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReport: calibrationReport(recipePlan, [
        calibratedAction("destination-followup", "extract_destinations", [], [], {
          destinationDiscovery: destinationDiscovery(2, 1)
        })
      ])
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup).toMatchObject({
      readiness: "calibration_required",
      reason: expect.stringContaining("Global destination discovery found 1 promotable destination target"),
      destinationDiscovery: {
        runCount: 1,
        totalUsableCandidateCount: 2,
        totalPromotableCandidateCount: 1,
        totalNonPromotableCandidateCount: 1,
        selectorHints: [
          expect.objectContaining({
            selector: '[data-place-url*="place.naver.com/restaurant"]',
            scopedSelectorSuggestions: ['#root [data-place-url*="place.naver.com/restaurant"]'],
            host: "place.naver.com",
            pathPrefix: "/restaurant",
            source: "attribute",
            attributeName: "data-place-url",
            promotionPolicy: "manual_calibration_required"
          })
        ],
        samplePromotableTargets: [
          expect.objectContaining({
            url: "https://place.naver.com/restaurant/1",
            source: "attribute",
            attributeName: "data-place-url"
          })
        ],
        sampleNonPromotableTargets: [
          expect.objectContaining({
            url: "https://nid.naver.com/nidlogin.login",
            warnings: ["login_or_account_surface"]
          })
        ]
      }
    });
    expect(destinationFollowup?.recommendedAction).toBeUndefined();
    expect(exportMaintainedSourceNavigationRecipes(catalog).status).toBe("empty");
    expect(formatSourceNavigationDestinationSelectorHintsAsLines(catalog)).toContain(
      'naver_map\tmap\tdestination-followup\t[data-place-url*="place.naver.com/restaurant"]\t#root [data-place-url*="place.naver.com/restaurant"]\thttps://place.naver.com/restaurant/1\tplace.naver.com\t/restaurant\tattribute\tdata-place-url\tmanual_calibration_required'
    );
  });

  it("surfaces non-promotable global destination discovery warning pressure", () => {
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReport: calibrationReport(recipePlan, [
        calibratedAction("destination-followup", "extract_destinations", [], [], {
          destinationDiscovery: destinationDiscovery(2, 0)
        })
      ])
    });

    const destinationFollowup = catalog.entries.find((entry) => entry.actionKey === "destination-followup");
    expect(destinationFollowup).toMatchObject({
      readiness: "calibration_required",
      reason: expect.stringContaining("sampled targets were non-promotable"),
      destinationDiscovery: {
        totalPromotableCandidateCount: 0,
        totalNonPromotableCandidateCount: 2,
        warningCounts: [{ warning: "login_or_account_surface", count: 2 }]
      }
    });
    expect(destinationFollowup?.destinationDiscovery?.selectorHints).toBeUndefined();
    expect(destinationFollowup?.recommendedAction).toBeUndefined();
  });

  it("parses selector hint TSV rows and applies scoped suggestions as calibration candidates", () => {
    const hints = parseSourceNavigationDestinationSelectorHintsAsLines(
      [
        'naver_map\tmap\tdestination-followup\t[data-place-url*="place.naver.com/restaurant/1"]\t#root [data-place-url*="place.naver.com/restaurant/1"]\thttps://place.naver.com/restaurant/1\tplace.naver.com\t/restaurant/1\tattribute\tdata-place-url\tmanual_calibration_required',
        'google_maps\tmap\tdestination-followup\ta[href*="www.google.com/maps/place"]\t[role="main"] a[href*="www.google.com/maps/place"]|#pane a[href*="www.google.com/maps/place"]\thttps://www.google.com/maps/place/example\twww.google.com\t/maps/place\tanchor\t\tmanual_calibration_required'
      ].join("\n")
    );
    const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
    const hintedPlan = applySourceNavigationSelectorHintsToRecipePlan(recipePlan, hints);
    const destinationFollowup = hintedPlan.actionCandidates.find((entry) => entry.actionKey === "destination-followup");

    expect(hints).toHaveLength(2);
    expect(destinationFollowup?.selectorCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '#root [data-place-url*="place.naver.com/restaurant/1"]',
          source: "real_site_candidate",
          note: expect.stringContaining("Selector hint")
        })
      ])
    );
    expect(destinationFollowup?.selectorCandidates.some((candidate) => candidate.selector.includes("www.google.com/maps/place"))).toBe(false);
    expect(hintedPlan.warnings).toContain("Selector hints were supplied as additional manual calibration candidates; they are not maintained recipes.");
  });

  it("does not propose scoped capture actions when calibration found no visible scope", () => {
    const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReport: calibrationReport(recipePlan, [calibratedAction("result-selection", "capture", [])])
    });

    const resultSelection = catalog.entries.find((entry) => entry.actionKey === "result-selection");
    expect(resultSelection?.readiness).toBe("calibration_required");
    expect(resultSelection?.recommendedAction).toBeUndefined();
  });

  it("does not export local fixture selectors that happen to match a real platform page", () => {
    const recipePlan = recipePlanFor("https://www.youtube.com/results?search_query=seongsu+cafe");
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: [
        calibrationReport(recipePlan, [calibratedAction("overlay-ocr", "capture", [matched("overlay-ocr", "#overlay-text", "selector", "local_fixture")], [matched("overlay-ocr", "#overlay-text", "capture_scope", "local_fixture")])]),
        calibrationReport(recipePlan, [calibratedAction("overlay-ocr", "capture", [matched("overlay-ocr", "#overlay-text", "selector", "local_fixture")], [matched("overlay-ocr", "#overlay-text", "capture_scope", "local_fixture")])])
      ]
    });

    const overlayOcr = catalog.entries.find((entry) => entry.actionKey === "overlay-ocr");
    expect(overlayOcr?.readiness).toBe("calibration_required");
    expect(overlayOcr?.reason).toContain("fixture-scoped selectors");
    expect(overlayOcr?.matchedCaptureScopes).toEqual(expect.arrayContaining([expect.objectContaining({ selector: "#overlay-text", source: "local_fixture" })]));
    expect(overlayOcr?.stableCaptureScopes).toEqual([]);
    expect(overlayOcr?.recommendedAction).toBeUndefined();
    expect(exportMaintainedSourceNavigationRecipes(catalog)).toMatchObject({
      status: "empty",
      actionCount: 0
    });
  });

  it("ignores calibration reports from a different platform or source family", () => {
    const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
    const incompatibleReport: SourceNavigationCalibrationReport = {
      ...calibrationReport(recipePlan, [calibratedAction("result-selection", "capture", [matched("result-selection", "#result-card")], [matched("result-selection", "#result-card", "capture_scope")])]),
      platform: "naver_search"
    };
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReport: incompatibleReport
    });

    expect(catalog.generatedFrom).toBe("recipe_plan");
    expect(catalog.summary.calibrationReportCount).toBe(0);
    expect(catalog.summary.skippedCalibrationReportCount).toBe(1);
    const resultSelection = catalog.entries.find((entry) => entry.actionKey === "result-selection");
    expect(resultSelection?.readiness).toBe("calibration_required");
    expect(resultSelection?.recommendedAction).toBeUndefined();
    expect(catalog.warnings.join(" ")).toContain("Skipped calibration report");
  });

  it("exports an empty bundle when no maintained read-only recipe is ready", () => {
    const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReport: calibrationReport(recipePlan, [calibratedAction("query-state", "fill", [matched("query-state", "#google-query")]), calibratedAction("vertical-tab", "click", [matched("vertical-tab", "#tab-images")])])
    });

    const exportBundle = exportMaintainedSourceNavigationRecipes(catalog);
    expect(exportBundle.status).toBe("empty");
    expect(exportBundle.actions).toEqual([]);
    expect(exportBundle.omittedEntries).toEqual(expect.arrayContaining([expect.objectContaining({ actionKey: "query-state", readiness: "manual_value_required" }), expect.objectContaining({ actionKey: "vertical-tab", readiness: "manual_review_required" })]));
    expect(exportBundle.warnings.join(" ")).toContain("intentionally omitted");
  });

  it("blocks catalog promotion when calibration sees blocked signals", () => {
    const recipePlan = recipePlanFor("https://www.tiktok.com/@example/video/123");
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReport: calibrationReport(recipePlan, [
        {
          ...calibratedAction("obstruction-check", "capture", [matched("obstruction-check", "#gate")]),
          status: "blocked_signal_detected",
          blockedSignals: [{ actionKey: "obstruction-check", signal: "log in", kind: "blocked_text", status: "present" }]
        }
      ])
    });

    const obstruction = catalog.entries.find((entry) => entry.actionKey === "obstruction-check");
    expect(obstruction?.readiness).toBe("blocked_signal_detected");
    expect(obstruction?.recommendedAction).toBeUndefined();
    expect(catalog.summary.blockedCount).toBe(1);
  });
});

function recipePlanFor(url: string) {
  return describeSourceNavigationRecipePlan(
    describeSourceNavigationPlan({
      sourceStrategy: describeSourceStrategy(url)
    })
  );
}

function calibrationReport(recipePlan: ReturnType<typeof recipePlanFor>, actionCalibrations: SourceNavigationActionCalibrationResult[]): SourceNavigationCalibrationReport {
  return {
    schemaVersion: "1.0",
    url: "https://example.com/",
    platform: recipePlan.platform,
    sourceFamily: recipePlan.sourceFamily,
    recipeExecutionPolicy: recipePlan.executionPolicy,
    executionPolicy: "read_only_selector_probe",
    selectorTimeoutMs: 1000,
    actionCalibrations,
    summary: {
      executionPolicy: "read_only_selector_probe",
      actionCandidateCount: actionCalibrations.length,
      observedActionCount: actionCalibrations.filter((action) => action.status === "observed").length,
      partialActionCount: 0,
      notObservedActionCount: 0,
      blockedActionCount: actionCalibrations.filter((action) => action.status === "blocked_signal_detected").length,
      erroredActionCount: 0,
      selectorCandidateCount: actionCalibrations.flatMap((action) => action.selectorResults).length,
      matchedSelectorCount: actionCalibrations.flatMap((action) => action.selectorResults).filter((result) => result.status === "matched").length,
      captureScopeCandidateCount: actionCalibrations.flatMap((action) => action.captureScopeResults).length,
      matchedCaptureScopeCount: actionCalibrations.flatMap((action) => action.captureScopeResults).filter((result) => result.status === "matched").length,
      expectedSignalHits: 0,
      blockedSignalHits: actionCalibrations.flatMap((action) => action.blockedSignals).filter((signal) => signal.status === "present").length,
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

function matched(
  actionKey: string,
  selector: string,
  kind: SourceNavigationSelectorCalibrationResult["kind"] = "selector",
  source: SourceNavigationSelectorCalibrationResult["source"] = "real_site_candidate",
  target: SourceNavigationSelectorCalibrationResult["target"] = kind === "selector" ? "primary" : "scope",
  overrides: Partial<SourceNavigationSelectorCalibrationResult> = {}
): SourceNavigationSelectorCalibrationResult {
  return {
    actionKey,
    selector,
    target,
    source,
    kind,
    status: "matched",
    matchCount: 1,
    visibleCount: 1,
    inspectedCount: 1,
    note: source === "local_fixture" ? "fixture match" : "real-site match",
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

function destinationProbe(usableCandidateCount: number, promotableCandidateCount = usableCandidateCount): NonNullable<SourceNavigationSelectorCalibrationResult["destinationProbe"]> {
  return {
    status: usableCandidateCount > 0 ? "ok" : "no_usable_links",
    rawCandidateCount: usableCandidateCount,
    usableCandidateCount,
    uniqueCandidateCount: usableCandidateCount,
    duplicateCandidateCount: 0,
    omittedDuplicateCount: 0,
    anchorCandidateCount: usableCandidateCount,
    attributeCandidateCount: 0,
    promotableCandidateCount,
    nonPromotableCandidateCount: Math.max(0, usableCandidateCount - promotableCandidateCount),
    warningCounts: promotableCandidateCount < usableCandidateCount ? [{ warning: "low_value_navigation_surface", count: usableCandidateCount - promotableCandidateCount }] : [],
    ...(usableCandidateCount > 0 ? { sampleUrls: ["https://place.naver.com/restaurant/1"] } : {}),
    ...(promotableCandidateCount > 0 ? { samplePromotableUrls: ["https://place.naver.com/restaurant/1"] } : {}),
    ...(promotableCandidateCount < usableCandidateCount ? { sampleNonPromotableUrls: ["https://nid.naver.com/nidlogin.login"] } : {})
  };
}

function destinationDiscovery(usableCandidateCount: number, promotableCandidateCount = usableCandidateCount): SourceNavigationDestinationProbeResult {
  const nonPromotableCandidateCount = Math.max(0, usableCandidateCount - promotableCandidateCount);
  return {
    status: usableCandidateCount > 0 ? "ok" : "no_usable_links",
    rawCandidateCount: usableCandidateCount,
    usableCandidateCount,
    uniqueCandidateCount: usableCandidateCount,
    duplicateCandidateCount: 0,
    omittedDuplicateCount: 0,
    anchorCandidateCount: nonPromotableCandidateCount,
    attributeCandidateCount: promotableCandidateCount,
    promotableCandidateCount,
    nonPromotableCandidateCount,
    warningCounts: nonPromotableCandidateCount > 0 ? [{ warning: "login_or_account_surface", count: nonPromotableCandidateCount }] : [],
    ...(promotableCandidateCount > 0
      ? {
          samplePromotableTargets: [
            {
              url: "https://place.naver.com/restaurant/1",
              text: "Seongsu Cafe",
              source: "attribute" as const,
              attributeName: "data-place-url",
              warnings: []
            }
          ]
        }
      : {}),
    ...(nonPromotableCandidateCount > 0
      ? {
          sampleNonPromotableTargets: [
            {
              url: "https://nid.naver.com/nidlogin.login",
              text: "로그인",
              source: "anchor" as const,
              warnings: ["login_or_account_surface"]
            }
          ]
        }
      : {})
  };
}
