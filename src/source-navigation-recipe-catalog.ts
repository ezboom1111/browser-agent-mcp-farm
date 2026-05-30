import type { SourceNavigationExecutableAction, SourceNavigationExecutableOperation } from "./source-navigation-executor.js";
import { unique as uniqueStrings } from "./util/collections.js";
import { stripBom } from "./util/text.js";
import type {
  SourceNavigationActionCalibrationResult,
  SourceNavigationCalibrationReport,
  SourceNavigationClientStateProbeResult,
  SourceNavigationClientStateProbeStatus,
  SourceNavigationDestinationProbeResult,
  SourceNavigationDestinationProbeSampleTarget,
  SourceNavigationDestinationProbeStatus,
  SourceNavigationSelectorCalibrationResult,
  SourceNavigationSignalCalibrationResult
} from "./source-navigation-calibration.js";
import type { SourceNavigationRecipeActionCandidate, SourceNavigationRecipePlan, SourceNavigationSelectorCandidate } from "./source-navigation-recipes.js";

export type SourceNavigationRecipeCatalogReadiness = "maintained_recipe_ready" | "single_run_ready" | "manual_review_required" | "manual_value_required" | "calibration_required" | "blocked_signal_detected" | "not_supported";

export interface SourceNavigationRecipeCatalogEntry {
  actionKey: string;
  operation: SourceNavigationExecutableOperation;
  readiness: SourceNavigationRecipeCatalogReadiness;
  reason: string;
  matchedSelectors: SourceNavigationSelectorCalibrationResult[];
  matchedCaptureScopes: SourceNavigationSelectorCalibrationResult[];
  blockedSignals: SourceNavigationSignalCalibrationResult[];
  expectedSignalsPresent: SourceNavigationSignalCalibrationResult[];
  calibrationRunCount: number;
  stableSelectors: SourceNavigationSelectorCalibrationResult[];
  stableCaptureScopes: SourceNavigationSelectorCalibrationResult[];
  destinationDiscovery?: SourceNavigationDestinationDiscoveryCatalogSummary;
  clientStateProbe?: SourceNavigationClientStateProbeCatalogSummary;
  recommendedAction?: SourceNavigationExecutableAction;
  riskNotes: string[];
}

export interface SourceNavigationClientStateProbeCatalogSummary {
  runCount: number;
  statusCounts: Array<{ status: SourceNavigationClientStateProbeStatus; count: number }>;
  okRunCount: number;
  totalFrameCount: number;
  totalMatchedFrameCount: number;
  totalParsedFrameCount: number;
  totalTruncatedFrameCount: number;
  totalRawCandidateCount: number;
  totalUniqueCandidateCount: number;
  sampleUrls?: string[];
  sampleOriginalUrls?: string[];
  sampleTexts?: string[];
  sampleFrameUrls?: string[];
}

export interface SourceNavigationDestinationDiscoveryCatalogSummary {
  runCount: number;
  statusCounts: Array<{ status: SourceNavigationDestinationProbeStatus; count: number }>;
  totalRawCandidateCount: number;
  totalUsableCandidateCount: number;
  totalPromotableCandidateCount: number;
  totalNonPromotableCandidateCount: number;
  warningCounts: Array<{ warning: string; count: number }>;
  selectorHints?: SourceNavigationDestinationDiscoverySelectorHint[];
  samplePromotableTargets?: SourceNavigationDestinationProbeSampleTarget[];
  sampleNonPromotableTargets?: SourceNavigationDestinationProbeSampleTarget[];
}

export interface SourceNavigationDestinationDiscoverySelectorHint {
  selector: string;
  scopedSelectorSuggestions?: string[];
  sampleUrl: string;
  host: string;
  pathPrefix?: string;
  source: "anchor" | "attribute";
  attributeName?: string;
  basis: "promotable_sample_target";
  promotionPolicy: "manual_calibration_required";
  note: string;
}

export interface SourceNavigationRecipeCatalogSummary {
  entryCount: number;
  calibrationReportCount: number;
  skippedCalibrationReportCount: number;
  maintainedRecipeReadyCount: number;
  singleRunReadyCount: number;
  manualReviewCount: number;
  manualValueCount: number;
  calibrationRequiredCount: number;
  blockedCount: number;
  notSupportedCount: number;
  recommendedActionCount: number;
  maintainedDefaultReadyCount: number;
  minimumCalibrationRunsRequired: number;
}

export interface SourceNavigationRecipeCatalog {
  schemaVersion: "1.0";
  platform: SourceNavigationRecipePlan["platform"];
  sourceFamily: SourceNavigationRecipePlan["sourceFamily"];
  executionPolicy: "explicit_opt_in_only";
  generatedFrom: "recipe_plan" | "calibration_report" | "calibration_reports";
  calibrationUrl?: string;
  calibrationUrls?: string[];
  entries: SourceNavigationRecipeCatalogEntry[];
  summary: SourceNavigationRecipeCatalogSummary;
  warnings: string[];
}

export interface SourceNavigationMaintainedRecipeExport {
  schemaVersion: "1.0";
  platform: SourceNavigationRecipeCatalog["platform"];
  sourceFamily: SourceNavigationRecipeCatalog["sourceFamily"];
  executionPolicy: "explicit_opt_in_only";
  status: "ready" | "empty";
  actions: SourceNavigationExecutableAction[];
  actionCount: number;
  omittedEntries: Array<{
    actionKey: string;
    readiness: SourceNavigationRecipeCatalogReadiness;
    reason: string;
  }>;
  warnings: string[];
}

export interface SourceNavigationDestinationSelectorHintLine {
  platform: SourceNavigationRecipeCatalog["platform"];
  sourceFamily: SourceNavigationRecipeCatalog["sourceFamily"];
  actionKey: string;
  selector: string;
  scopedSelectorSuggestions: string[];
  sampleUrl: string;
  host: string;
  pathPrefix?: string;
  source: SourceNavigationDestinationDiscoverySelectorHint["source"];
  attributeName?: string;
  promotionPolicy: SourceNavigationDestinationDiscoverySelectorHint["promotionPolicy"];
}

export function parseSourceNavigationDestinationSelectorHintsAsLines(text: string): SourceNavigationDestinationSelectorHintLine[] {
  const hints: SourceNavigationDestinationSelectorHintLine[] = [];
  for (const [index, rawLine] of stripBom(text).split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const columns = line.split("\t");
    if (columns.length !== 10 && columns.length !== 11) {
      throw new Error(`Invalid selector hint line ${index + 1}: expected 10 or 11 tab-separated columns.`);
    }
    const hasScopedSuggestions = columns.length === 11;
    const platform = requiredColumn(columns, 0, index, "platform") as SourceNavigationRecipeCatalog["platform"];
    const sourceFamily = requiredColumn(columns, 1, index, "sourceFamily") as SourceNavigationRecipeCatalog["sourceFamily"];
    const actionKey = requiredColumn(columns, 2, index, "actionKey");
    const selector = requiredColumn(columns, 3, index, "selector");
    const scopedSelectorSuggestions = hasScopedSuggestions ? splitSelectorSuggestions(columns[4] ?? "") : [];
    const sampleUrl = requiredColumn(columns, hasScopedSuggestions ? 5 : 4, index, "sampleUrl");
    const host = requiredColumn(columns, hasScopedSuggestions ? 6 : 5, index, "host");
    const pathPrefix = optionalColumn(columns, hasScopedSuggestions ? 7 : 6);
    const source = requiredColumn(columns, hasScopedSuggestions ? 8 : 7, index, "source");
    const attributeName = optionalColumn(columns, hasScopedSuggestions ? 9 : 8);
    const promotionPolicy = requiredColumn(columns, hasScopedSuggestions ? 10 : 9, index, "promotionPolicy");
    if (source !== "anchor" && source !== "attribute") {
      throw new Error(`Invalid selector hint line ${index + 1}: source must be anchor or attribute.`);
    }
    if (promotionPolicy !== "manual_calibration_required") {
      throw new Error(`Invalid selector hint line ${index + 1}: promotionPolicy must be manual_calibration_required.`);
    }
    hints.push({
      platform,
      sourceFamily,
      actionKey,
      selector,
      scopedSelectorSuggestions,
      sampleUrl,
      host,
      ...(pathPrefix === undefined ? {} : { pathPrefix }),
      source,
      ...(attributeName === undefined ? {} : { attributeName }),
      promotionPolicy
    });
  }
  return hints;
}

export function applySourceNavigationSelectorHintsToRecipePlan(recipePlan: SourceNavigationRecipePlan, hints: SourceNavigationDestinationSelectorHintLine[]): SourceNavigationRecipePlan {
  const relevantHints = hints.filter((hint) => hint.platform === recipePlan.platform && hint.sourceFamily === recipePlan.sourceFamily);
  if (relevantHints.length === 0) {
    return recipePlan;
  }
  return {
    ...recipePlan,
    actionCandidates: recipePlan.actionCandidates.map((action) => {
      const selectorCandidates = selectorCandidatesFromHints(relevantHints.filter((hint) => hint.actionKey === action.actionKey));
      if (selectorCandidates.length === 0) {
        return action;
      }
      return {
        ...action,
        selectorCandidates: uniqueSelectorCandidates([...action.selectorCandidates, ...selectorCandidates]),
        riskNotes: uniqueStrings([...action.riskNotes, "Selector-hint candidates are calibration handoffs only; repeated browser-visible calibration is required before maintained export."])
      };
    }),
    warnings: uniqueStrings([...recipePlan.warnings, "Selector hints were supplied as additional manual calibration candidates; they are not maintained recipes."])
  };
}

export function collectSourceNavigationDestinationSelectorHints(catalog: SourceNavigationRecipeCatalog): SourceNavigationDestinationSelectorHintLine[] {
  return catalog.entries.flatMap((entry) =>
    (entry.destinationDiscovery?.selectorHints ?? []).map((hint) => ({
      platform: catalog.platform,
      sourceFamily: catalog.sourceFamily,
      actionKey: entry.actionKey,
      selector: hint.selector,
      scopedSelectorSuggestions: hint.scopedSelectorSuggestions ?? [],
      sampleUrl: hint.sampleUrl,
      host: hint.host,
      ...(hint.pathPrefix === undefined ? {} : { pathPrefix: hint.pathPrefix }),
      source: hint.source,
      ...(hint.attributeName === undefined ? {} : { attributeName: hint.attributeName }),
      promotionPolicy: hint.promotionPolicy
    }))
  );
}

export function formatSourceNavigationDestinationSelectorHintsAsLines(catalog: SourceNavigationRecipeCatalog): string {
  const hints = collectSourceNavigationDestinationSelectorHints(catalog);
  return hints.map((hint) => [hint.platform, hint.sourceFamily, hint.actionKey, hint.selector, hint.scopedSelectorSuggestions.join("|"), hint.sampleUrl, hint.host, hint.pathPrefix ?? "", hint.source, hint.attributeName ?? "", hint.promotionPolicy].join("\t")).join("\n") + (hints.length > 0 ? "\n" : "");
}

export function buildSourceNavigationRecipeCatalog(input: {
  recipePlan: SourceNavigationRecipePlan;
  calibrationReport?: SourceNavigationCalibrationReport | undefined;
  calibrationReports?: SourceNavigationCalibrationReport[] | undefined;
  minimumCalibrationRunsRequired?: number | undefined;
}): SourceNavigationRecipeCatalog {
  const providedCalibrationReports = normalizeCalibrationReports(input.calibrationReport, input.calibrationReports);
  const { compatibleReports: calibrationReports, skippedReports } = filterCompatibleCalibrationReports(input.recipePlan, providedCalibrationReports);
  const calibrationByKey = groupCalibrationsByActionKey(calibrationReports);
  const minimumCalibrationRunsRequired = Math.max(2, input.minimumCalibrationRunsRequired ?? 2);
  const entries = input.recipePlan.actionCandidates.map((candidate) => catalogEntryFor(candidate, calibrationByKey.get(calibrationGroupKey(candidate.actionKey, candidate.operation)) ?? [], minimumCalibrationRunsRequired, input.recipePlan.platform, input.recipePlan.sourceFamily));
  const calibrationUrls = [...new Set(calibrationReports.map((report) => report.url))];
  return {
    schemaVersion: "1.0",
    platform: input.recipePlan.platform,
    sourceFamily: input.recipePlan.sourceFamily,
    executionPolicy: "explicit_opt_in_only",
    generatedFrom: generatedFromFor(calibrationReports.length),
    ...(calibrationReports.length === 1 ? { calibrationUrl: calibrationReports[0]?.url ?? "" } : {}),
    ...(calibrationReports.length > 1 ? { calibrationUrls } : {}),
    entries,
    summary: summarizeCatalogEntries(entries, minimumCalibrationRunsRequired, calibrationReports.length, skippedReports.length),
    warnings: [
      ...skippedReports.map((report) => `Skipped calibration report for ${report.platform}/${report.sourceFamily}; expected ${input.recipePlan.platform}/${input.recipePlan.sourceFamily}.`),
      "Catalog entries are proposal metadata, not default automation.",
      "single_run_ready means the action may be copied into explicit sourceNavigation.actions after human review.",
      `maintained_recipe_ready requires at least ${minimumCalibrationRunsRequired} successful calibration runs with the same promotable selector plus fixture coverage.`,
      "Click, fill, select, payment, login, CAPTCHA, booking, account-changing, and gate-bypass flows remain manual-review or unsupported."
    ]
  };
}

export function exportMaintainedSourceNavigationRecipes(catalog: SourceNavigationRecipeCatalog): SourceNavigationMaintainedRecipeExport {
  const actions: SourceNavigationExecutableAction[] = [];
  const exportedActionKeys = new Set<string>();
  for (const entry of catalog.entries.filter((candidate) => candidate.readiness === "maintained_recipe_ready")) {
    const action = entry.recommendedAction;
    if (action === undefined || exportedActionKeys.has(action.actionKey)) {
      continue;
    }
    actions.push(action);
    exportedActionKeys.add(action.actionKey);
  }
  const omittedEntries = catalog.entries
    .filter((entry) => entry.readiness !== "maintained_recipe_ready" || entry.recommendedAction === undefined || !actions.includes(entry.recommendedAction))
    .map((entry) => ({
      actionKey: entry.actionKey,
      readiness: entry.readiness,
      reason: entry.reason
    }));
  return {
    schemaVersion: "1.0",
    platform: catalog.platform,
    sourceFamily: catalog.sourceFamily,
    executionPolicy: "explicit_opt_in_only",
    status: actions.length > 0 ? "ready" : "empty",
    actions,
    actionCount: actions.length,
    omittedEntries,
    warnings: [
      "Exported actions are not defaults; pass them explicitly through sourceNavigation.actions or --source-navigation-actions-file.",
      "Run exported actions only against the calibrated platform and comparable browser-visible state.",
      "Click, fill, select, press, login, payment, booking, CAPTCHA, gate-bypass, and account-changing actions are intentionally omitted."
    ]
  };
}

function catalogEntryFor(candidate: SourceNavigationRecipeActionCandidate, calibrations: SourceNavigationActionCalibrationResult[], minimumCalibrationRunsRequired: number, platform: SourceNavigationRecipePlan["platform"], sourceFamily: SourceNavigationRecipePlan["sourceFamily"]): SourceNavigationRecipeCatalogEntry {
  if (calibrations.length === 0) {
    return baseEntry(candidate, {
      readiness: "calibration_required",
      reason: "No calibration report was supplied for this action."
    });
  }

  const matchedSelectors = calibrations.flatMap((calibration) => calibration.selectorResults).filter((result) => result.status === "matched");
  const matchedCaptureScopes = calibrations.flatMap((calibration) => calibration.captureScopeResults).filter((result) => result.status === "matched");
  const promotableMatchedSelectors = preferredSelectorResultsFor(
    candidate,
    matchedSelectors.filter((result) => isPromotableSelectorResultFor(candidate, result))
  );
  const promotableMatchedCaptureScopes = matchedCaptureScopes.filter((result) => isPromotableSelectorResultFor(candidate, result));
  const blockedSignals = calibrations.flatMap((calibration) => calibration.blockedSignals).filter((signal) => signal.status === "present");
  const expectedSignalsPresent = calibrations.flatMap((calibration) => calibration.expectedTextSignals).filter((signal) => signal.status === "present");
  const stableSelectors = preferredSelectorResultsFor(
    candidate,
    stableSelectorResults(calibrations, "selectorResults", minimumCalibrationRunsRequired).filter((result) => isPromotableSelectorResultFor(candidate, result))
  );
  const stableCaptureScopes = stableSelectorResults(calibrations, "captureScopeResults", minimumCalibrationRunsRequired).filter((result) => isPromotableSelectorResultFor(candidate, result));
  const destinationDiscovery = summarizeDestinationDiscovery(calibrations, platform, sourceFamily);
  const clientStateProbe = summarizeClientStateProbe(calibrations);
  if (blockedSignals.length > 0 || calibrations.some((calibration) => calibration.status === "blocked_signal_detected")) {
    return baseEntry(candidate, {
      readiness: "blocked_signal_detected",
      reason: "Blocked text signals were visible during calibration.",
      matchedSelectors,
      matchedCaptureScopes,
      blockedSignals,
      expectedSignalsPresent,
      stableSelectors,
      stableCaptureScopes,
      calibrationRunCount: calibrations.length,
      destinationDiscovery,
      clientStateProbe
    });
  }

  if (candidate.operation === "extract_client_state_destinations" && !hasSuccessfulClientStateProbe(clientStateProbe)) {
    return baseEntry(candidate, {
      readiness: "calibration_required",
      reason: clientStateProbeReason(clientStateProbe, minimumCalibrationRunsRequired),
      matchedSelectors,
      matchedCaptureScopes,
      blockedSignals,
      expectedSignalsPresent,
      stableSelectors,
      stableCaptureScopes,
      calibrationRunCount: calibrations.length,
      destinationDiscovery,
      clientStateProbe
    });
  }

  const firstSelector = promotableMatchedSelectors[0];
  if (requiresManualValue(candidate.operation)) {
    return baseEntry(candidate, {
      readiness: "manual_value_required",
      reason: "This operation needs a user-supplied value or key and must not become a default action.",
      matchedSelectors,
      matchedCaptureScopes,
      blockedSignals,
      expectedSignalsPresent,
      stableSelectors,
      stableCaptureScopes,
      calibrationRunCount: calibrations.length,
      destinationDiscovery,
      clientStateProbe
    });
  }

  if (requiresManualReview(candidate.operation)) {
    return baseEntry(candidate, {
      readiness: "manual_review_required",
      reason: "This operation changes page state and needs human review before explicit execution.",
      matchedSelectors,
      matchedCaptureScopes,
      blockedSignals,
      expectedSignalsPresent,
      stableSelectors,
      stableCaptureScopes,
      calibrationRunCount: calibrations.length,
      destinationDiscovery,
      clientStateProbe
    });
  }

  if (
    candidate.verificationStatus === "fixture_verified" &&
    stableEnoughForMaintainedRecipe(candidate, stableSelectors, stableCaptureScopes, minimumCalibrationRunsRequired, calibrations.length) &&
    (candidate.operation !== "extract_client_state_destinations" || clientStateProbeReady(clientStateProbe, minimumCalibrationRunsRequired))
  ) {
    const maintainedAction = recommendedActionFor(candidate, stableSelectors[0], stableCaptureScopes);
    if (maintainedAction !== undefined) {
      return baseEntry(candidate, {
        readiness: "maintained_recipe_ready",
        reason: "Repeated calibration found stable browser-visible selectors and local fixture coverage exists.",
        matchedSelectors,
        matchedCaptureScopes,
        blockedSignals,
        expectedSignalsPresent,
        stableSelectors,
        stableCaptureScopes,
        calibrationRunCount: calibrations.length,
        destinationDiscovery,
        clientStateProbe,
        recommendedAction: maintainedAction
      });
    }
  }

  const recommendedAction = recommendedActionFor(candidate, firstSelector, promotableMatchedCaptureScopes);
  if (recommendedAction === undefined) {
    const hasFixtureOnlyMatch = matchedSelectors.length > 0 || matchedCaptureScopes.length > 0;
    const hasBroadDestinationFallbackMatch = candidate.operation === "extract_destinations" && matchedSelectors.some(isBroadDestinationFallbackSelector);
    const hasUnusableDestinationProbe = candidate.operation === "extract_destinations" && matchedSelectors.some((result) => result.destinationProbe !== undefined && result.destinationProbe.usableCandidateCount <= 0);
    const hasNonPromotableOnlyDestinationProbe =
      candidate.operation === "extract_destinations" && matchedSelectors.some((result) => result.destinationProbe !== undefined && result.destinationProbe.promotableCandidateCount !== undefined && result.destinationProbe.usableCandidateCount > 0 && result.destinationProbe.promotableCandidateCount <= 0);
    const baseReason =
      candidate.operation === "scroll"
        ? "Bounded scroll can be supplied explicitly; repeated calibration is still required before default catalog promotion."
        : hasBroadDestinationFallbackMatch
          ? "Only broad destination fallback selectors matched; narrower destination selectors require calibration before maintained export."
          : hasUnusableDestinationProbe
            ? "Matched destination selectors produced no usable HTTP(S) destination links; destination extraction requires deeper calibration before export."
            : hasNonPromotableOnlyDestinationProbe
              ? "Matched destination selectors produced only low-value, login, or unsupported destination links; destination extraction requires more specific calibration before export."
              : hasFixtureOnlyMatch
                ? "Only fixture-scoped selectors matched; real-site selectors require calibration before an explicit recipe can be exported."
                : "No visible selector was matched for this read-only operation.";
    return baseEntry(candidate, {
      readiness: candidate.operation === "scroll" ? "single_run_ready" : "calibration_required",
      reason: withDestinationDiscoveryReason(baseReason, destinationDiscovery),
      matchedSelectors,
      matchedCaptureScopes,
      blockedSignals,
      expectedSignalsPresent,
      stableSelectors,
      stableCaptureScopes,
      calibrationRunCount: calibrations.length,
      destinationDiscovery,
      clientStateProbe
    });
  }

  return baseEntry(candidate, {
    readiness: "single_run_ready",
    reason: "Calibration found browser-visible candidates for a read-only explicit recipe.",
    matchedSelectors,
    matchedCaptureScopes,
    blockedSignals,
    expectedSignalsPresent,
    stableSelectors,
    stableCaptureScopes,
    calibrationRunCount: calibrations.length,
    destinationDiscovery,
    clientStateProbe,
    recommendedAction
  });
}

function baseEntry(
  candidate: SourceNavigationRecipeActionCandidate,
  input: {
    readiness: SourceNavigationRecipeCatalogReadiness;
    reason: string;
    matchedSelectors?: SourceNavigationSelectorCalibrationResult[] | undefined;
    matchedCaptureScopes?: SourceNavigationSelectorCalibrationResult[] | undefined;
    blockedSignals?: SourceNavigationSignalCalibrationResult[] | undefined;
    expectedSignalsPresent?: SourceNavigationSignalCalibrationResult[] | undefined;
    stableSelectors?: SourceNavigationSelectorCalibrationResult[] | undefined;
    stableCaptureScopes?: SourceNavigationSelectorCalibrationResult[] | undefined;
    destinationDiscovery?: SourceNavigationDestinationDiscoveryCatalogSummary | undefined;
    clientStateProbe?: SourceNavigationClientStateProbeCatalogSummary | undefined;
    calibrationRunCount?: number | undefined;
    recommendedAction?: SourceNavigationExecutableAction | undefined;
  }
): SourceNavigationRecipeCatalogEntry {
  return {
    actionKey: candidate.actionKey,
    operation: candidate.operation,
    readiness: input.readiness,
    reason: input.reason,
    matchedSelectors: input.matchedSelectors ?? [],
    matchedCaptureScopes: input.matchedCaptureScopes ?? [],
    blockedSignals: input.blockedSignals ?? [],
    expectedSignalsPresent: input.expectedSignalsPresent ?? [],
    calibrationRunCount: input.calibrationRunCount ?? 0,
    stableSelectors: input.stableSelectors ?? [],
    stableCaptureScopes: input.stableCaptureScopes ?? [],
    ...(input.destinationDiscovery === undefined ? {} : { destinationDiscovery: input.destinationDiscovery }),
    ...(input.clientStateProbe === undefined ? {} : { clientStateProbe: input.clientStateProbe }),
    ...(input.recommendedAction === undefined ? {} : { recommendedAction: input.recommendedAction }),
    riskNotes: candidate.riskNotes
  };
}

function summarizeDestinationDiscovery(calibrations: SourceNavigationActionCalibrationResult[], platform: SourceNavigationRecipePlan["platform"], sourceFamily: SourceNavigationRecipePlan["sourceFamily"]): SourceNavigationDestinationDiscoveryCatalogSummary | undefined {
  const discoveries = calibrations.map((calibration) => calibration.destinationDiscovery).filter((discovery): discovery is SourceNavigationDestinationProbeResult => discovery !== undefined);
  if (discoveries.length === 0) {
    return undefined;
  }
  const samplePromotableTargets = uniqueSampleTargets(discoveries.flatMap((discovery) => discovery.samplePromotableTargets ?? []));
  const sampleNonPromotableTargets = uniqueSampleTargets(discoveries.flatMap((discovery) => discovery.sampleNonPromotableTargets ?? []));
  const selectorHints = selectorHintsFromSampleTargets(samplePromotableTargets, platform, sourceFamily);
  return {
    runCount: discoveries.length,
    statusCounts: countDestinationDiscoveryStatuses(discoveries),
    totalRawCandidateCount: sumProbeCounts(discoveries, "rawCandidateCount"),
    totalUsableCandidateCount: sumProbeCounts(discoveries, "usableCandidateCount"),
    totalPromotableCandidateCount: sumOptionalProbeCounts(discoveries, "promotableCandidateCount"),
    totalNonPromotableCandidateCount: sumOptionalProbeCounts(discoveries, "nonPromotableCandidateCount"),
    warningCounts: mergeDestinationDiscoveryWarnings(discoveries.flatMap((discovery) => discovery.warningCounts ?? [])),
    ...(selectorHints.length === 0 ? {} : { selectorHints }),
    ...(samplePromotableTargets.length === 0 ? {} : { samplePromotableTargets }),
    ...(sampleNonPromotableTargets.length === 0 ? {} : { sampleNonPromotableTargets })
  };
}

function summarizeClientStateProbe(calibrations: SourceNavigationActionCalibrationResult[]): SourceNavigationClientStateProbeCatalogSummary | undefined {
  const probes = calibrations.map((calibration) => calibration.clientStateProbe).filter((probe): probe is SourceNavigationClientStateProbeResult => probe !== undefined);
  if (probes.length === 0) {
    return undefined;
  }
  const sampleUrls = uniqueStrings(probes.flatMap((probe) => probe.sampleUrls ?? [])).slice(0, 10);
  const sampleOriginalUrls = uniqueStrings(probes.flatMap((probe) => probe.sampleOriginalUrls ?? [])).slice(0, 10);
  const sampleTexts = uniqueStrings(probes.flatMap((probe) => probe.sampleTexts ?? [])).slice(0, 10);
  const sampleFrameUrls = uniqueStrings(probes.flatMap((probe) => probe.sampleFrameUrls ?? [])).slice(0, 10);
  return {
    runCount: probes.length,
    statusCounts: countClientStateProbeStatuses(probes),
    okRunCount: probes.filter((probe) => probe.status === "ok").length,
    totalFrameCount: probes.reduce((sum, probe) => sum + probe.frameCount, 0),
    totalMatchedFrameCount: probes.reduce((sum, probe) => sum + probe.matchedFrameCount, 0),
    totalParsedFrameCount: probes.reduce((sum, probe) => sum + probe.parsedFrameCount, 0),
    totalTruncatedFrameCount: probes.reduce((sum, probe) => sum + probe.truncatedFrameCount, 0),
    totalRawCandidateCount: probes.reduce((sum, probe) => sum + probe.rawCandidateCount, 0),
    totalUniqueCandidateCount: probes.reduce((sum, probe) => sum + probe.uniqueCandidateCount, 0),
    ...(sampleUrls.length === 0 ? {} : { sampleUrls }),
    ...(sampleOriginalUrls.length === 0 ? {} : { sampleOriginalUrls }),
    ...(sampleTexts.length === 0 ? {} : { sampleTexts }),
    ...(sampleFrameUrls.length === 0 ? {} : { sampleFrameUrls })
  };
}

function clientStateProbeReady(summary: SourceNavigationClientStateProbeCatalogSummary | undefined, minimumCalibrationRunsRequired: number): boolean {
  return summary !== undefined && summary.runCount >= minimumCalibrationRunsRequired && summary.okRunCount >= minimumCalibrationRunsRequired && summary.totalUniqueCandidateCount > 0;
}

function hasSuccessfulClientStateProbe(summary: SourceNavigationClientStateProbeCatalogSummary | undefined): boolean {
  return summary !== undefined && summary.okRunCount > 0 && summary.totalUniqueCandidateCount > 0;
}

function clientStateProbeReason(summary: SourceNavigationClientStateProbeCatalogSummary | undefined, minimumCalibrationRunsRequired: number): string {
  if (summary === undefined || summary.runCount === 0) {
    return "Client-state destination extraction needs calibration reports with a successful client-state probe before export.";
  }
  if (summary.okRunCount < minimumCalibrationRunsRequired) {
    return `Client-state destination extraction needs ${minimumCalibrationRunsRequired} successful probe run(s); currently ${summary.okRunCount}/${summary.runCount} probe run(s) found destination candidates.`;
  }
  if (summary.totalUniqueCandidateCount <= 0) {
    return "Client-state probes ran but found no unique destination candidates.";
  }
  return "Client-state destination extraction needs repeated successful probe calibration before export.";
}

function countClientStateProbeStatuses(probes: SourceNavigationClientStateProbeResult[]): Array<{ status: SourceNavigationClientStateProbeStatus; count: number }> {
  const order: SourceNavigationClientStateProbeStatus[] = ["ok", "no_state_found", "no_candidates", "error"];
  return order
    .map((status) => ({
      status,
      count: probes.filter((probe) => probe.status === status).length
    }))
    .filter((entry) => entry.count > 0);
}

function countDestinationDiscoveryStatuses(discoveries: SourceNavigationDestinationProbeResult[]): Array<{ status: SourceNavigationDestinationProbeStatus; count: number }> {
  const counts = new Map<SourceNavigationDestinationProbeStatus, number>();
  for (const discovery of discoveries) {
    counts.set(discovery.status, (counts.get(discovery.status) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([status, count]) => ({ status, count }));
}

function sumProbeCounts(discoveries: SourceNavigationDestinationProbeResult[], key: "rawCandidateCount" | "usableCandidateCount"): number {
  return discoveries.reduce((sum, discovery) => sum + discovery[key], 0);
}

function sumOptionalProbeCounts(discoveries: SourceNavigationDestinationProbeResult[], key: "promotableCandidateCount" | "nonPromotableCandidateCount"): number {
  return discoveries.reduce((sum, discovery) => sum + (discovery[key] ?? 0), 0);
}

function mergeDestinationDiscoveryWarnings(warnings: Array<{ warning: string; count: number }>): Array<{ warning: string; count: number }> {
  const counts = new Map<string, number>();
  for (const warning of warnings) {
    counts.set(warning.warning, (counts.get(warning.warning) ?? 0) + warning.count);
  }
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([warning, count]) => ({ warning, count }));
}

function uniqueSampleTargets(targets: SourceNavigationDestinationProbeSampleTarget[]): SourceNavigationDestinationProbeSampleTarget[] {
  const seen = new Set<string>();
  const unique: SourceNavigationDestinationProbeSampleTarget[] = [];
  for (const target of targets) {
    const key = [target.url, target.source ?? "", target.attributeName ?? "", target.frameUrl ?? "", target.text].join("\0");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(target);
    if (unique.length >= 5) {
      break;
    }
  }
  return unique;
}

function selectorHintsFromSampleTargets(targets: SourceNavigationDestinationProbeSampleTarget[], platform: SourceNavigationRecipePlan["platform"], sourceFamily: SourceNavigationRecipePlan["sourceFamily"]): SourceNavigationDestinationDiscoverySelectorHint[] {
  const hints: SourceNavigationDestinationDiscoverySelectorHint[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const hint = selectorHintFromSampleTarget(target, platform, sourceFamily);
    if (hint === undefined || seen.has(hint.selector)) {
      continue;
    }
    seen.add(hint.selector);
    hints.push(hint);
    if (hints.length >= 10) {
      break;
    }
  }
  return hints;
}

function selectorHintFromSampleTarget(target: SourceNavigationDestinationProbeSampleTarget, platform: SourceNavigationRecipePlan["platform"], sourceFamily: SourceNavigationRecipePlan["sourceFamily"]): SourceNavigationDestinationDiscoverySelectorHint | undefined {
  if (target.source !== "anchor" && target.source !== "attribute") {
    return undefined;
  }
  const parsed = parseUrlForSelectorHint(target.url);
  if (parsed === undefined) {
    return undefined;
  }
  if (target.source === "attribute" && target.attributeName !== undefined && safeAttributeName(target.attributeName)) {
    const selector = `[${target.attributeName}*="${cssStringValue(parsed.selectorValue)}"]`;
    return {
      selector,
      scopedSelectorSuggestions: scopedSelectorSuggestions(selector, platform, sourceFamily),
      sampleUrl: target.url,
      host: parsed.host,
      ...(parsed.pathPrefix === undefined ? {} : { pathPrefix: parsed.pathPrefix }),
      source: "attribute",
      attributeName: target.attributeName,
      basis: "promotable_sample_target",
      promotionPolicy: "manual_calibration_required",
      note: "Add a provider/card/container scope around this hint and rerun repeated read-only calibration before maintained export."
    };
  }
  if (target.source === "anchor") {
    const selector = `a[href*="${cssStringValue(parsed.selectorValue)}"]`;
    return {
      selector,
      scopedSelectorSuggestions: scopedSelectorSuggestions(selector, platform, sourceFamily),
      sampleUrl: target.url,
      host: parsed.host,
      ...(parsed.pathPrefix === undefined ? {} : { pathPrefix: parsed.pathPrefix }),
      source: "anchor",
      basis: "promotable_sample_target",
      promotionPolicy: "manual_calibration_required",
      note: "Add a provider/card/container scope around this hint and rerun repeated read-only calibration before maintained export."
    };
  }
  return undefined;
}

function scopedSelectorSuggestions(selector: string, platform: SourceNavigationRecipePlan["platform"], sourceFamily: SourceNavigationRecipePlan["sourceFamily"]): string[] {
  return uniqueStrings(selectorHintContainerScopes(platform, sourceFamily).map((scope) => `${scope} ${selector}`));
}

function selectorCandidatesFromHints(hints: SourceNavigationDestinationSelectorHintLine[]): SourceNavigationSelectorCandidate[] {
  return hints.flatMap((hint) => {
    const selectors = hint.scopedSelectorSuggestions.length > 0 ? hint.scopedSelectorSuggestions : [hint.selector];
    return selectors.map((selector) => ({
      selector,
      target: "fallback" as const,
      source: "real_site_candidate" as const,
      note: `Selector hint from ${hint.sampleUrl}; base selector ${hint.selector}.`
    }));
  });
}

function uniqueSelectorCandidates(candidates: SourceNavigationSelectorCandidate[]): SourceNavigationSelectorCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.selector}\0${candidate.target}\0${candidate.source}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function requiredColumn(columns: string[], index: number, lineIndex: number, name: string): string {
  const value = columns[index]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`Invalid selector hint line ${lineIndex + 1}: missing ${name}.`);
  }
  return value;
}

function optionalColumn(columns: string[], index: number): string | undefined {
  const value = columns[index]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function splitSelectorSuggestions(value: string): string[] {
  return value
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function selectorHintContainerScopes(platform: SourceNavigationRecipePlan["platform"], sourceFamily: SourceNavigationRecipePlan["sourceFamily"]): string[] {
  switch (platform) {
    case "naver_search":
    case "naver_news":
      return ["#main_pack"];
    case "daum_search":
    case "daum_news":
      return ["#mArticle", "#cMain", "#daumContent"];
    case "google_search":
      return ["#search", "#rso"];
    case "google_scholar":
      return ["#gs_res_ccl_mid", "#gs_res_ccl", "#gs_bdy"];
    case "reuters":
      return ["#fusion-app", "main", "article"];
    case "bing":
      return ["#b_results", "#b_context"];
    case "yahoo_search":
      return ["#web", "#results", "#main"];
    case "yahoo_japan_search":
      return ["#contents", "#web", "#results"];
    case "naver_map":
      return ["#root"];
    case "kakao_map":
      return ["#info", "#mArticle"];
    case "google_maps":
      return ['[role="main"]', "#pane", "#QA0Szd"];
    case "apple_maps":
      return ['[role="main"]', "#maps-app", '[data-testid*="map"]'];
    case "yelp":
      return ["#main-content", "main", '[data-testid*="serp"]'];
    case "tripadvisor":
      return ["#BODYCON", "main", '[data-automation*="searchResults"]', '[data-test-target*="search-results"]'];
    case "naver_blog":
      return ["#content", "main", "article"];
    case "naver_cafe":
    case "naver_kin":
    case "dcinside":
    case "reddit":
    case "quora":
    case "stack_overflow":
      return ["main", "article", '[role="main"]'];
    case "youtube":
    case "instagram":
    case "tiktok":
    case "x_twitter":
      return ["main", '[role="main"]'];
    case "amazon":
      return ['[data-component-type*="search-result"]'];
    case "coupang":
      return ["#product-list", "#productList", ".search-product"];
    case "naver_shopping":
      return ["#content", "#container", '[class*="product"]'];
    case "gmarket":
      return ["#section__inner-content-body-container", ".box__item", ".itemcard"];
    case "elevenst":
      return ['[class*="product"]', '[class*="item"]'];
    case "booking_com":
    case "agoda":
    case "trip_com":
    case "expedia":
      return ["main", '[data-testid*="property-card"]', '[class*="card"]'];
    case "wikipedia":
      return ["#mw-content-text", ".mw-parser-output", "#content"];
    case "namuwiki":
      return ["article", ".wiki-paragraph", "#app"];
    case "pubmed":
      return ["#search-results", ".docsum-content", "#article-details"];
    case "data_go_kr":
      return ["#contents", "#content", ".result-list", ".data-list"];
    case "kosis":
      return ["#contents", "#content", ".search-result", ".tbl-list"];
    case "riss":
      return ["#divContent", "#content", ".srchResultListW"];
    case "kipris":
      return ["#content", "#contents", ".search-result", ".result-list"];
    default:
      break;
  }
  if (sourceFamily === "search" || sourceFamily === "portal") {
    return ["main", '[role="main"]'];
  }
  if (sourceFamily === "map") {
    return ["main", '[role="main"]'];
  }
  if (sourceFamily === "commerce" || sourceFamily === "travel_booking") {
    return ["main", '[class*="card"]'];
  }
  return ["main"];
}

function parseUrlForSelectorHint(url: string): { host: string; pathPrefix?: string; selectorValue: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) {
    return undefined;
  }
  const pathPrefix = semanticPathPrefixForSelectorHint(host, parsed.pathname);
  return {
    host,
    ...(pathPrefix === undefined ? {} : { pathPrefix }),
    selectorValue: `${host}${pathPrefix ?? ""}`
  };
}

function semanticPathPrefixForSelectorHint(host: string, pathname: string): string | undefined {
  const segments = pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodeURIComponentSafely);
  if (segments.length === 0) {
    return undefined;
  }
  if (host === "map.naver.com" && segments[0] === "p" && segments[1] === "entry" && segments[2] !== undefined) {
    return `/p/entry/${segments[2]}`;
  }
  if (host === "www.google.com" && segments[0] === "maps" && segments[1] !== undefined) {
    return `/maps/${segments[1]}`;
  }
  return `/${segments[0]}`;
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeAttributeName(value: string): boolean {
  return /^[a-zA-Z_][\w:.-]*$/.test(value);
}

function cssStringValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function withDestinationDiscoveryReason(reason: string, discovery: SourceNavigationDestinationDiscoveryCatalogSummary | undefined): string {
  const discoveryReason = destinationDiscoveryReason(discovery);
  return discoveryReason === undefined ? reason : `${reason} ${discoveryReason}`;
}

function destinationDiscoveryReason(discovery: SourceNavigationDestinationDiscoveryCatalogSummary | undefined): string | undefined {
  if (discovery === undefined) {
    return undefined;
  }
  if (discovery.totalPromotableCandidateCount > 0) {
    return `Global destination discovery found ${discovery.totalPromotableCandidateCount} promotable destination target(s), but no planned selector is promotable yet; add a narrower provider selector from the sampled targets before maintained export.`;
  }
  if (discovery.totalUsableCandidateCount > 0) {
    return `Global destination discovery found ${discovery.totalUsableCandidateCount} usable destination target(s), but sampled targets were non-promotable; inspect warningCounts before adding selectors.`;
  }
  if (discovery.totalRawCandidateCount > 0) {
    return `Global destination discovery saw ${discovery.totalRawCandidateCount} raw candidate target(s), but no usable HTTP(S) destination was available.`;
  }
  const errorCount = discovery.statusCounts.find((entry) => entry.status === "error")?.count ?? 0;
  if (errorCount > 0) {
    return `Global destination discovery errored in ${errorCount} calibration run(s); rerun calibration before promotion.`;
  }
  return undefined;
}

function requiresManualValue(operation: SourceNavigationExecutableOperation): boolean {
  return operation === "fill" || operation === "select" || operation === "press";
}

function requiresManualReview(operation: SourceNavigationExecutableOperation): boolean {
  return operation === "click";
}

function recommendedActionFor(candidate: SourceNavigationRecipeActionCandidate, firstSelector: SourceNavigationSelectorCalibrationResult | undefined, matchedCaptureScopes: SourceNavigationSelectorCalibrationResult[]): SourceNavigationExecutableAction | undefined {
  if (candidate.operation === "capture") {
    if (candidate.captureScopeCandidates.length > 0 && matchedCaptureScopes.length === 0) {
      return undefined;
    }
    return withOptionalScopes(
      {
        actionKey: candidate.actionKey,
        operation: "capture"
      },
      matchedCaptureScopes
    );
  }
  if (candidate.operation === "follow_up" && firstSelector !== undefined) {
    return { actionKey: candidate.actionKey, operation: "follow_up", selector: firstSelector.selector };
  }
  if (candidate.operation === "extract_destinations" && firstSelector !== undefined) {
    return { actionKey: candidate.actionKey, operation: "extract_destinations", selector: firstSelector.selector, maxLinks: 10 };
  }
  if (candidate.operation === "extract_client_state_destinations" && firstSelector !== undefined) {
    return {
      actionKey: candidate.actionKey,
      operation: "extract_client_state_destinations",
      selector: firstSelector.selector,
      ...(candidate.clientStateExtraction === undefined
        ? {}
        : {
            stateKey: candidate.clientStateExtraction.stateKey,
            extractor: candidate.clientStateExtraction.extractor,
            ...(candidate.clientStateExtraction.destinationPath === undefined ? {} : { destinationPath: candidate.clientStateExtraction.destinationPath }),
            ...(candidate.clientStateExtraction.maxLinks === undefined ? {} : { maxLinks: candidate.clientStateExtraction.maxLinks })
          })
    };
  }
  if (candidate.operation === "wait_for_selector" && firstSelector !== undefined) {
    return withOptionalScopes(
      {
        actionKey: candidate.actionKey,
        operation: "wait_for_selector",
        selector: firstSelector.selector
      },
      matchedCaptureScopes
    );
  }
  if (candidate.operation === "scroll") {
    return { actionKey: candidate.actionKey, operation: "scroll", direction: "bottom" };
  }
  return undefined;
}

function stableEnoughForMaintainedRecipe(candidate: SourceNavigationRecipeActionCandidate, stableSelectors: SourceNavigationSelectorCalibrationResult[], stableCaptureScopes: SourceNavigationSelectorCalibrationResult[], minimumCalibrationRunsRequired: number, calibrationRunCount: number): boolean {
  if (calibrationRunCount < minimumCalibrationRunsRequired) {
    return false;
  }
  if (candidate.operation === "scroll") {
    return false;
  }
  if (candidate.operation === "capture") {
    return stableSelectors.length > 0 || stableCaptureScopes.length > 0;
  }
  return stableSelectors.length > 0;
}

function isPromotableSelectorResult(result: SourceNavigationSelectorCalibrationResult): boolean {
  return result.source !== "local_fixture";
}

function isPromotableSelectorResultFor(candidate: SourceNavigationRecipeActionCandidate, result: SourceNavigationSelectorCalibrationResult): boolean {
  if (!isPromotableSelectorResult(result)) {
    return false;
  }
  if (candidate.operation === "extract_destinations" && isBroadDestinationFallbackSelector(result)) {
    return false;
  }
  if (candidate.operation === "extract_destinations" && result.destinationProbe !== undefined && result.destinationProbe.usableCandidateCount <= 0) {
    return false;
  }
  if (candidate.operation === "extract_destinations" && result.destinationProbe !== undefined && result.destinationProbe.promotableCandidateCount !== undefined && result.destinationProbe.usableCandidateCount > 0 && result.destinationProbe.promotableCandidateCount <= 0) {
    return false;
  }
  return true;
}

function isBroadDestinationFallbackSelector(result: SourceNavigationSelectorCalibrationResult): boolean {
  const selector = normalizeSelectorForPromotion(result.selector);
  if (/^#root\s+a\[href\*=["']map\.naver\.com["']\]/.test(selector)) {
    return true;
  }
  if (/^(?:main|article)\s+a\[href\*=["']reuters\.com["']\]/.test(selector)) {
    return true;
  }
  if ([/^body$/, /^html$/, /^main$/, /^article$/, /^#root$/, /^#app$/, /^#view$/, /^#content$/, /^#contents$/, /^#b_results$/, /^#rso$/, /^#web$/, /^#results$/, /^#search$/, /^#main_pack$/, /^#marticle$/, /^#cmain$/, /^#daumcontent$/, /^\[role="main"\]$/].some((pattern) => pattern.test(selector))) {
    return true;
  }
  return (
    [
      /^body\s+a\[href(?:\]|\^=)/,
      /^html\s+a\[href(?:\]|\^=)/,
      /^main\s+a\[href(?:\]|\^=)/,
      /^article\s+a\[href(?:\]|\^=)/,
      /^#root\s+a\[href(?:\]|\^=)/,
      /^#app\s+a\[href(?:\]|\^=)/,
      /^#view\s+a\[href(?:\]|\^=)/,
      /^#content\s+a\[href(?:\]|\^=)/,
      /^#contents\s+a\[href(?:\]|\^=)/,
      /^#b_results\s+a\[href(?:\]|\^=)/,
      /^#web\s+a\[href(?:\]|\^=)/,
      /^#results\s+a\[href(?:\]|\^=)/,
      /^#search\s+a\[href(?:\]|\^=)/,
      /^#main_pack\s+a\[href(?:\]|\^=)/,
      /^#marticle\s+a\[href(?:\]|\^=)/,
      /^#cmain\s+a\[href(?:\]|\^=)/,
      /^#daumcontent\s+a\[href(?:\]|\^=)/,
      /^\[role="main"\]\s+a\[href(?:\]|\^=)/,
      /^ytd-video-renderer\s+a\[href(?:\]|\^=)/,
      /^ytd-rich-item-renderer\s+a\[href(?:\]|\^=)/
    ].some((pattern) => pattern.test(selector)) ||
    [
      /^body\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^html\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^main\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^article\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#root\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#app\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#view\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#content\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#contents\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#b_results\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#web\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#results\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#search\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#rso\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#main_pack\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#marticle\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#cmain\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^#daumcontent\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/,
      /^\[role="main"\]\s+\[(?:data-url|data-href|data-link|data-link-url|data-target-url)\]$/
    ].some((pattern) => pattern.test(selector))
  );
}

function normalizeSelectorForPromotion(selector: string): string {
  return selector.toLowerCase().replace(/\s+/g, " ").trim();
}

function preferredSelectorResultsFor(candidate: SourceNavigationRecipeActionCandidate, results: SourceNavigationSelectorCalibrationResult[]): SourceNavigationSelectorCalibrationResult[] {
  if (candidate.operation !== "extract_destinations" || results.length <= 1) {
    return results;
  }
  return results
    .map((result, index) => ({ result, index, score: destinationExtractionSelectorScore(result) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.result);
}

function destinationExtractionSelectorScore(result: SourceNavigationSelectorCalibrationResult): number {
  const selector = normalizeSelectorForPromotion(result.selector);
  let score = 0;
  const probe = result.destinationProbe;
  if (probe !== undefined) {
    score += 100;
    score += Math.min(25, Math.max(0, probe.promotableCandidateCount ?? 0));
    score -= Math.min(30, Math.max(0, probe.uniqueCandidateCount - 1));
    if ((probe.nonPromotableCandidateCount ?? 0) > 0) {
      score -= Math.min(20, probe.nonPromotableCandidateCount ?? 0);
    }
  }
  if (/\[href\*=["'][^"']+["']\]/.test(selector)) {
    score += 40;
  }
  if (/\[(?:data-(?:place|product|item|review|seller|brand|profile|channel|media|travel|hotel|offer)-url|data-target-url)\*=["'][^"']+["']\]/.test(selector)) {
    score += 40;
  }
  if (/\/travel\/(?:hotels|search)\b|\[(?:data-(?:travel|hotel|offer)-url)\*=["'][^"']+["']\]/.test(selector)) {
    score += 35;
  }
  if (/ytd-(?:video|rich-item)-renderer\s+a#(?:video-title|video-title-link|thumbnail)\[href\*=["']\/(?:watch|shorts)["']\]/.test(selector)) {
    score += 70;
  }
  if (/ytd-channel-name\s+a\[href\*=["']\/(?:channel\/|@)["']\]|a#channel-thumbnail\[href\*=["']\/(?:channel\/|@)["']\]/.test(selector)) {
    score += 30;
  }
  if (/\/(?:travel\/hotels|travel\/search|maps\/place|p\/entry\/place|watch|shorts|channel|read|articles|itm|ip|products?|hotel|hotels|restaurant|review|reviews|place)\b/.test(selector)) {
    score += 35;
  }
  if (/:has\(h3\)/.test(selector)) {
    score += 10;
  }
  if (/^(?:#search|#rso|#b_results|#web|#results|main|article|\[role="main"\])\s+/.test(selector)) {
    score -= 3;
  }
  return score;
}

function withOptionalScopes<T extends SourceNavigationExecutableAction>(action: T, matchedCaptureScopes: SourceNavigationSelectorCalibrationResult[]): T {
  if (matchedCaptureScopes.length === 0) {
    return action;
  }
  return {
    ...action,
    captureScopes: matchedCaptureScopes.map((scope, index) => ({
      key: `${scope.actionKey}-scope-${index + 1}`,
      selector: scope.selector,
      phase: "after" as const,
      note: scope.note
    }))
  };
}

function summarizeCatalogEntries(entries: SourceNavigationRecipeCatalogEntry[], minimumCalibrationRunsRequired: number, calibrationReportCount: number, skippedCalibrationReportCount: number): SourceNavigationRecipeCatalogSummary {
  return {
    entryCount: entries.length,
    calibrationReportCount,
    skippedCalibrationReportCount,
    maintainedRecipeReadyCount: entries.filter((entry) => entry.readiness === "maintained_recipe_ready").length,
    singleRunReadyCount: entries.filter((entry) => entry.readiness === "single_run_ready").length,
    manualReviewCount: entries.filter((entry) => entry.readiness === "manual_review_required").length,
    manualValueCount: entries.filter((entry) => entry.readiness === "manual_value_required").length,
    calibrationRequiredCount: entries.filter((entry) => entry.readiness === "calibration_required").length,
    blockedCount: entries.filter((entry) => entry.readiness === "blocked_signal_detected").length,
    notSupportedCount: entries.filter((entry) => entry.readiness === "not_supported").length,
    recommendedActionCount: entries.filter((entry) => entry.recommendedAction !== undefined).length,
    maintainedDefaultReadyCount: entries.filter((entry) => entry.readiness === "maintained_recipe_ready").length,
    minimumCalibrationRunsRequired
  };
}

function normalizeCalibrationReports(calibrationReport: SourceNavigationCalibrationReport | undefined, calibrationReports: SourceNavigationCalibrationReport[] | undefined): SourceNavigationCalibrationReport[] {
  const reports: SourceNavigationCalibrationReport[] = [];
  if (calibrationReport !== undefined) {
    reports.push(calibrationReport);
  }
  if (calibrationReports !== undefined) {
    reports.push(...calibrationReports);
  }
  return reports;
}

function filterCompatibleCalibrationReports(
  recipePlan: SourceNavigationRecipePlan,
  reports: SourceNavigationCalibrationReport[]
): {
  compatibleReports: SourceNavigationCalibrationReport[];
  skippedReports: SourceNavigationCalibrationReport[];
} {
  const compatibleReports: SourceNavigationCalibrationReport[] = [];
  const skippedReports: SourceNavigationCalibrationReport[] = [];
  for (const report of reports) {
    if (report.platform === recipePlan.platform && report.sourceFamily === recipePlan.sourceFamily) {
      compatibleReports.push(report);
    } else {
      skippedReports.push(report);
    }
  }
  return { compatibleReports, skippedReports };
}

function groupCalibrationsByActionKey(reports: SourceNavigationCalibrationReport[]): Map<string, SourceNavigationActionCalibrationResult[]> {
  const grouped = new Map<string, SourceNavigationActionCalibrationResult[]>();
  for (const report of reports) {
    for (const calibration of report.actionCalibrations) {
      const key = calibrationGroupKey(calibration.actionKey, calibration.operation);
      const values = grouped.get(key) ?? [];
      values.push(calibration);
      grouped.set(key, values);
    }
  }
  return grouped;
}

function calibrationGroupKey(actionKey: string, operation: SourceNavigationExecutableOperation): string {
  return `${actionKey}\0${operation}`;
}

function generatedFromFor(calibrationReportCount: number): SourceNavigationRecipeCatalog["generatedFrom"] {
  if (calibrationReportCount === 0) {
    return "recipe_plan";
  }
  if (calibrationReportCount === 1) {
    return "calibration_report";
  }
  return "calibration_reports";
}

function stableSelectorResults(calibrations: SourceNavigationActionCalibrationResult[], key: "selectorResults" | "captureScopeResults", minimumCalibrationRunsRequired: number): SourceNavigationSelectorCalibrationResult[] {
  const grouped = new Map<string, { sample: SourceNavigationSelectorCalibrationResult; runIndexes: Set<number> }>();
  for (const [runIndex, calibration] of calibrations.entries()) {
    for (const result of calibration[key]) {
      if (result.status !== "matched") {
        continue;
      }
      const groupKey = `${result.kind}:${result.source}:${result.selector}`;
      const existing = grouped.get(groupKey) ?? { sample: result, runIndexes: new Set<number>() };
      existing.runIndexes.add(runIndex);
      grouped.set(groupKey, existing);
    }
  }
  return [...grouped.values()].filter((entry) => entry.runIndexes.size >= minimumCalibrationRunsRequired).map((entry) => entry.sample);
}
