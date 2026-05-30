import { type ArtifactWriter, sanitizeFileBase, type ArtifactRecord } from "./artifact-writer.js";
import type { BrowserLinkTargetsResult, BrowserPool } from "./browser-pool.js";
import { extractClientStateDestinationCandidates, type ClientStateDestinationExtractor } from "./client-state-destinations.js";
import { classifyDestinationProbeCandidate } from "./destination-triage.js";
import type { SourceNavigationRecipeActionCandidate, SourceNavigationRecipePlan, SourceNavigationSelectorCandidate } from "./source-navigation-recipes.js";

export type SourceNavigationSelectorCalibrationStatus = "matched" | "hidden_match" | "not_matched" | "error";

export type SourceNavigationSignalCalibrationStatus = "present" | "missing" | "unavailable";

export type SourceNavigationActionCalibrationStatus = "observed" | "partial" | "not_observed" | "blocked_signal_detected" | "error";

export type SourceNavigationDestinationProbeStatus = "ok" | "no_usable_links" | "error";

export type SourceNavigationClientStateProbeStatus = "ok" | "no_state_found" | "no_candidates" | "error";

export interface SourceNavigationDestinationProbeResult {
  status: SourceNavigationDestinationProbeStatus;
  rawCandidateCount: number;
  usableCandidateCount: number;
  uniqueCandidateCount: number;
  duplicateCandidateCount: number;
  omittedDuplicateCount: number;
  anchorCandidateCount: number;
  attributeCandidateCount: number;
  promotableCandidateCount?: number;
  nonPromotableCandidateCount?: number;
  warningCounts?: Array<{ warning: string; count: number }>;
  frameCount?: number;
  matchedFrameCount?: number;
  sampleUrls?: string[];
  samplePromotableUrls?: string[];
  sampleNonPromotableUrls?: string[];
  samplePromotableTargets?: SourceNavigationDestinationProbeSampleTarget[];
  sampleNonPromotableTargets?: SourceNavigationDestinationProbeSampleTarget[];
  error?: string;
}

export interface SourceNavigationDestinationProbeSampleTarget {
  url: string;
  text: string;
  source?: "anchor" | "attribute";
  attributeName?: string;
  frameIndex?: number;
  frameUrl?: string;
  frameName?: string;
  warnings: string[];
}

export interface SourceNavigationClientStateProbeResult {
  status: SourceNavigationClientStateProbeStatus;
  stateKey: string;
  extractor: ClientStateDestinationExtractor;
  destinationPath?: string;
  frameCount: number;
  matchedFrameCount: number;
  parsedFrameCount: number;
  truncatedFrameCount: number;
  rawCandidateCount: number;
  uniqueCandidateCount: number;
  sampleUrls?: string[];
  sampleOriginalUrls?: string[];
  sampleTexts?: string[];
  sampleFrameUrls?: string[];
  error?: string;
}

export interface SourceNavigationSelectorCalibrationResult {
  actionKey: string;
  selector: string;
  target: SourceNavigationSelectorCandidate["target"];
  source: SourceNavigationSelectorCandidate["source"];
  kind: "selector" | "capture_scope";
  status: SourceNavigationSelectorCalibrationStatus;
  matchCount: number;
  visibleCount: number;
  inspectedCount: number;
  frameCount?: number;
  matchedFrameCount?: number;
  visibleFrameCount?: number;
  firstMatchedFrameUrl?: string;
  firstVisibleFrameUrl?: string;
  note: string;
  firstTextSnippet?: string;
  firstVisibleTextSnippet?: string;
  destinationProbe?: SourceNavigationDestinationProbeResult;
  error?: string;
}

export interface SourceNavigationSignalCalibrationResult {
  actionKey: string;
  signal: string;
  kind: "expected_text" | "blocked_text";
  status: SourceNavigationSignalCalibrationStatus;
}

export interface SourceNavigationActionCalibrationResult {
  actionKey: string;
  operation: SourceNavigationRecipeActionCandidate["operation"];
  verificationStatus: SourceNavigationRecipeActionCandidate["verificationStatus"];
  status: SourceNavigationActionCalibrationStatus;
  selectorResults: SourceNavigationSelectorCalibrationResult[];
  captureScopeResults: SourceNavigationSelectorCalibrationResult[];
  destinationDiscovery?: SourceNavigationDestinationProbeResult;
  clientStateProbe?: SourceNavigationClientStateProbeResult;
  expectedTextSignals: SourceNavigationSignalCalibrationResult[];
  blockedSignals: SourceNavigationSignalCalibrationResult[];
  riskNotes: string[];
}

export interface SourceNavigationCalibrationSummary {
  executionPolicy: "read_only_selector_probe";
  actionCandidateCount: number;
  observedActionCount: number;
  partialActionCount: number;
  notObservedActionCount: number;
  blockedActionCount: number;
  erroredActionCount: number;
  selectorCandidateCount: number;
  matchedSelectorCount: number;
  captureScopeCandidateCount: number;
  matchedCaptureScopeCount: number;
  expectedSignalHits: number;
  blockedSignalHits: number;
  realSiteCandidateMatches: number;
  localFixtureCandidateMatches: number;
  clientStateProbeCount: number;
  clientStateProbeOkCount: number;
  manualOnly: true;
}

export interface SourceNavigationCalibrationReport {
  schemaVersion: "1.0";
  url: string;
  finalUrl?: string;
  platform: SourceNavigationRecipePlan["platform"];
  sourceFamily: SourceNavigationRecipePlan["sourceFamily"];
  recipeExecutionPolicy: SourceNavigationRecipePlan["executionPolicy"];
  executionPolicy: "read_only_selector_probe";
  selectorTimeoutMs: number;
  actionCalibrations: SourceNavigationActionCalibrationResult[];
  summary: SourceNavigationCalibrationSummary;
  warnings: string[];
}

export interface CalibrateSourceNavigationRecipePlanInput {
  recipePlan: SourceNavigationRecipePlan;
  browserPool: BrowserPool;
  agentId: string;
  contextToken: string;
  pageId: string;
  url: string;
  selectorTimeoutMs?: number;
  signal?: AbortSignal;
}

export async function calibrateSourceNavigationRecipePlan(input: CalibrateSourceNavigationRecipePlanInput): Promise<SourceNavigationCalibrationReport> {
  const selectorTimeoutMs = Math.max(100, Math.min(10_000, input.selectorTimeoutMs ?? 1_000));
  const bodyText = await readBodyText(input, selectorTimeoutMs);
  const actionCalibrations: SourceNavigationActionCalibrationResult[] = [];

  for (const action of input.recipePlan.actionCandidates) {
    const selectorResults = await calibrateSelectorList(input, action, action.selectorCandidates, "selector", selectorTimeoutMs);
    const captureScopeResults = await calibrateSelectorList(input, action, action.captureScopeCandidates, "capture_scope", selectorTimeoutMs);
    const destinationDiscovery = action.operation === "extract_destinations" ? await discoverDestinationLinks(input) : undefined;
    const clientStateProbe = action.operation === "extract_client_state_destinations" ? await probeClientStateDestinations(input, action) : undefined;
    const expectedTextSignals = action.expectedTextSignals.map((signal) => signalResult(action.actionKey, signal, "expected_text", bodyText));
    const blockedSignals = action.blockedSignals.map((signal) => signalResult(action.actionKey, signal, "blocked_text", bodyText));
    actionCalibrations.push({
      actionKey: action.actionKey,
      operation: action.operation,
      verificationStatus: action.verificationStatus,
      status: actionStatus(selectorResults, captureScopeResults, blockedSignals, clientStateProbe),
      selectorResults,
      captureScopeResults,
      ...(destinationDiscovery === undefined ? {} : { destinationDiscovery }),
      ...(clientStateProbe === undefined ? {} : { clientStateProbe }),
      expectedTextSignals,
      blockedSignals,
      riskNotes: action.riskNotes
    });
  }

  const warnings = [...input.recipePlan.warnings, "Calibration is read-only and does not prove that clicking or filling a candidate is safe.", "Promote a selector into a maintained provider recipe only after repeated browser-visible calibration."];
  return {
    schemaVersion: "1.0",
    url: input.url,
    platform: input.recipePlan.platform,
    sourceFamily: input.recipePlan.sourceFamily,
    recipeExecutionPolicy: input.recipePlan.executionPolicy,
    executionPolicy: "read_only_selector_probe",
    selectorTimeoutMs,
    actionCalibrations,
    summary: summarizeSourceNavigationCalibration(actionCalibrations),
    warnings
  };
}

export function summarizeSourceNavigationCalibration(actionCalibrations: SourceNavigationActionCalibrationResult[]): SourceNavigationCalibrationSummary {
  const selectorResults = actionCalibrations.flatMap((action) => action.selectorResults);
  const captureScopeResults = actionCalibrations.flatMap((action) => action.captureScopeResults);
  const matchedSelectors = selectorResults.filter((result) => result.status === "matched");
  const matchedScopes = captureScopeResults.filter((result) => result.status === "matched");
  return {
    executionPolicy: "read_only_selector_probe",
    actionCandidateCount: actionCalibrations.length,
    observedActionCount: actionCalibrations.filter((action) => action.status === "observed").length,
    partialActionCount: actionCalibrations.filter((action) => action.status === "partial").length,
    notObservedActionCount: actionCalibrations.filter((action) => action.status === "not_observed").length,
    blockedActionCount: actionCalibrations.filter((action) => action.status === "blocked_signal_detected").length,
    erroredActionCount: actionCalibrations.filter((action) => action.status === "error").length,
    selectorCandidateCount: selectorResults.length,
    matchedSelectorCount: matchedSelectors.length,
    captureScopeCandidateCount: captureScopeResults.length,
    matchedCaptureScopeCount: matchedScopes.length,
    expectedSignalHits: actionCalibrations.flatMap((action) => action.expectedTextSignals).filter((signal) => signal.status === "present").length,
    blockedSignalHits: actionCalibrations.flatMap((action) => action.blockedSignals).filter((signal) => signal.status === "present").length,
    realSiteCandidateMatches: [...matchedSelectors, ...matchedScopes].filter((result) => result.source === "real_site_candidate").length,
    localFixtureCandidateMatches: [...matchedSelectors, ...matchedScopes].filter((result) => result.source === "local_fixture").length,
    clientStateProbeCount: actionCalibrations.filter((action) => action.clientStateProbe !== undefined).length,
    clientStateProbeOkCount: actionCalibrations.filter((action) => action.clientStateProbe?.status === "ok").length,
    manualOnly: true
  };
}

export async function writeSourceNavigationCalibrationArtifact(input: { artifactWriter: ArtifactWriter; runDir: string; sourceUrl: string; contextToken: string; pageId: string; report: SourceNavigationCalibrationReport; captureId?: string }): Promise<ArtifactRecord[]> {
  return input.artifactWriter.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: input.sourceUrl,
    contextToken: input.contextToken,
    pageId: input.pageId,
    captureId: sanitizeFileBase(input.captureId ?? "source-navigation-calibration"),
    metadata: {
      sourceNavigationCalibration: input.report
    },
    text: JSON.stringify(input.report, null, 2),
    captureMethod: "browser-agent-mcp-farm source-navigation-calibration",
    toolName: "source_navigation_calibration",
    evidenceKind: "source_navigation_calibration"
  });
}

async function calibrateSelectorList(input: CalibrateSourceNavigationRecipePlanInput, action: SourceNavigationRecipeActionCandidate, selectors: SourceNavigationSelectorCandidate[], kind: "selector" | "capture_scope", selectorTimeoutMs: number): Promise<SourceNavigationSelectorCalibrationResult[]> {
  const results: SourceNavigationSelectorCalibrationResult[] = [];
  for (const selectorCandidate of selectors) {
    try {
      const inspection = await input.browserPool.inspectSelector(input.agentId, input.contextToken, input.pageId, selectorCandidate.selector, {
        maxMatches: 10,
        maxTextLength: 300,
        ...(input.signal === undefined ? {} : { signal: input.signal })
      });
      const status = inspection.visibleCount > 0 ? "matched" : inspection.matchCount > 0 ? "hidden_match" : "not_matched";
      const destinationProbe = action.operation === "extract_destinations" && kind === "selector" && status === "matched" ? await probeDestinationLinks(input, selectorCandidate.selector, selectorTimeoutMs) : undefined;
      const matchedFrameUrl = firstMatchedFrameUrl(inspection);
      const visibleFrameUrl = firstVisibleFrameUrl(inspection);
      results.push({
        actionKey: action.actionKey,
        selector: selectorCandidate.selector,
        target: selectorCandidate.target,
        source: selectorCandidate.source,
        kind,
        status,
        matchCount: inspection.matchCount,
        visibleCount: inspection.visibleCount,
        inspectedCount: inspection.inspectedCount,
        ...(inspection.frameCount === undefined ? {} : { frameCount: inspection.frameCount }),
        ...(inspection.matchedFrameCount === undefined ? {} : { matchedFrameCount: inspection.matchedFrameCount }),
        ...(inspection.visibleFrameCount === undefined ? {} : { visibleFrameCount: inspection.visibleFrameCount }),
        ...(matchedFrameUrl === undefined ? {} : { firstMatchedFrameUrl: matchedFrameUrl }),
        ...(visibleFrameUrl === undefined ? {} : { firstVisibleFrameUrl: visibleFrameUrl }),
        note: selectorCandidate.note,
        ...(inspection.firstTextSnippet === undefined ? {} : { firstTextSnippet: inspection.firstTextSnippet }),
        ...(inspection.firstVisibleTextSnippet === undefined ? {} : { firstVisibleTextSnippet: inspection.firstVisibleTextSnippet }),
        ...(destinationProbe === undefined ? {} : { destinationProbe })
      });
    } catch (error) {
      results.push({
        actionKey: action.actionKey,
        selector: selectorCandidate.selector,
        target: selectorCandidate.target,
        source: selectorCandidate.source,
        kind,
        status: "error",
        matchCount: 0,
        visibleCount: 0,
        inspectedCount: 0,
        note: selectorCandidate.note,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return results;
}

function firstMatchedFrameUrl(inspection: Awaited<ReturnType<BrowserPool["inspectSelector"]>>): string | undefined {
  return inspection.matches.find((match) => match.frameUrl !== undefined)?.frameUrl;
}

function firstVisibleFrameUrl(inspection: Awaited<ReturnType<BrowserPool["inspectSelector"]>>): string | undefined {
  return inspection.matches.find((match) => match.visible && match.frameUrl !== undefined)?.frameUrl;
}

async function probeDestinationLinks(input: CalibrateSourceNavigationRecipePlanInput, selector: string, selectorTimeoutMs: number): Promise<SourceNavigationDestinationProbeResult> {
  try {
    const targets = await input.browserPool.readLinkTargets(input.agentId, input.contextToken, input.pageId, selector, 10, selectorTimeoutMs, input.signal);
    return destinationProbeFromTargets(targets, input.recipePlan.sourceFamily, input.url);
  } catch (error) {
    return {
      status: "error",
      rawCandidateCount: 0,
      usableCandidateCount: 0,
      uniqueCandidateCount: 0,
      duplicateCandidateCount: 0,
      omittedDuplicateCount: 0,
      anchorCandidateCount: 0,
      attributeCandidateCount: 0,
      promotableCandidateCount: 0,
      nonPromotableCandidateCount: 0,
      warningCounts: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function discoverDestinationLinks(input: CalibrateSourceNavigationRecipePlanInput): Promise<SourceNavigationDestinationProbeResult> {
  try {
    const targets = await input.browserPool.discoverLinkTargets(input.agentId, input.contextToken, input.pageId, 25, input.signal);
    return destinationProbeFromTargets(targets, input.recipePlan.sourceFamily, input.url);
  } catch (error) {
    return {
      status: "error",
      rawCandidateCount: 0,
      usableCandidateCount: 0,
      uniqueCandidateCount: 0,
      duplicateCandidateCount: 0,
      omittedDuplicateCount: 0,
      anchorCandidateCount: 0,
      attributeCandidateCount: 0,
      promotableCandidateCount: 0,
      nonPromotableCandidateCount: 0,
      warningCounts: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function probeClientStateDestinations(input: CalibrateSourceNavigationRecipePlanInput, action: SourceNavigationRecipeActionCandidate): Promise<SourceNavigationClientStateProbeResult> {
  const stateKey = action.clientStateExtraction?.stateKey ?? "__APOLLO_STATE__";
  const extractor = action.clientStateExtraction?.extractor ?? "naver_place_apollo";
  const destinationPath = action.clientStateExtraction?.destinationPath;
  const maxLinks = Math.max(1, Math.min(25, action.clientStateExtraction?.maxLinks ?? 10));
  try {
    const state = await input.browserPool.readClientState(input.agentId, input.contextToken, input.pageId, stateKey, 2_000_000, input.signal);
    const extracted = extractClientStateDestinationCandidates(state, {
      extractor,
      maxLinks,
      destinationPath
    });
    const sampleUrls = extracted.candidates.map((candidate) => candidate.url).slice(0, 5);
    const sampleOriginalUrls = extracted.candidates
      .map((candidate) => candidate.originalUrl)
      .filter((url): url is string => url !== undefined)
      .slice(0, 5);
    const sampleTexts = extracted.candidates.map((candidate) => candidate.text).slice(0, 5);
    const sampleFrameUrls = [...new Set(extracted.candidates.map((candidate) => candidate.frameUrl))].slice(0, 5);
    return {
      status: state.matchedFrameCount <= 0 ? "no_state_found" : extracted.uniqueCandidateCount <= 0 ? "no_candidates" : "ok",
      stateKey,
      extractor,
      ...(destinationPath === undefined ? {} : { destinationPath }),
      frameCount: state.frameCount,
      matchedFrameCount: state.matchedFrameCount,
      parsedFrameCount: extracted.parsedFrameCount,
      truncatedFrameCount: extracted.truncatedFrameCount,
      rawCandidateCount: extracted.rawCandidateCount,
      uniqueCandidateCount: extracted.uniqueCandidateCount,
      ...(sampleUrls.length === 0 ? {} : { sampleUrls }),
      ...(sampleOriginalUrls.length === 0 ? {} : { sampleOriginalUrls }),
      ...(sampleTexts.length === 0 ? {} : { sampleTexts }),
      ...(sampleFrameUrls.length === 0 ? {} : { sampleFrameUrls })
    };
  } catch (error) {
    return {
      status: "error",
      stateKey,
      extractor,
      ...(destinationPath === undefined ? {} : { destinationPath }),
      frameCount: 0,
      matchedFrameCount: 0,
      parsedFrameCount: 0,
      truncatedFrameCount: 0,
      rawCandidateCount: 0,
      uniqueCandidateCount: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function destinationProbeFromTargets(targets: BrowserLinkTargetsResult, sourceFamily: CalibrateSourceNavigationRecipePlanInput["recipePlan"]["sourceFamily"], parentUrl: string): SourceNavigationDestinationProbeResult {
  const classifications = targets.links.map((link) => ({
    link,
    classification: classifyDestinationProbeCandidate({
      parentUrl,
      sourceFamily,
      url: link.url,
      linkText: link.text
    })
  }));
  const promotableLinks = classifications.filter((entry) => entry.classification.promotable).map((entry) => entry.link);
  const nonPromotableLinks = classifications.filter((entry) => !entry.classification.promotable).map((entry) => entry.link);
  const warningCounts = countDestinationProbeWarnings(classifications.flatMap((entry) => entry.classification.warnings));
  const sampleUrls = targets.links.map((link) => link.url).slice(0, 5);
  const samplePromotableUrls = promotableLinks.map((link) => link.url).slice(0, 5);
  const sampleNonPromotableUrls = nonPromotableLinks.map((link) => link.url).slice(0, 5);
  const samplePromotableTargets = classifications
    .filter((entry) => entry.classification.promotable)
    .slice(0, 5)
    .map((entry) => sampleTarget(entry));
  const sampleNonPromotableTargets = classifications
    .filter((entry) => !entry.classification.promotable)
    .slice(0, 5)
    .map((entry) => sampleTarget(entry));
  return {
    status: targets.usableCandidateCount > 0 ? "ok" : "no_usable_links",
    rawCandidateCount: targets.rawCandidateCount,
    usableCandidateCount: targets.usableCandidateCount,
    uniqueCandidateCount: targets.uniqueCandidateCount,
    duplicateCandidateCount: targets.duplicateCandidateCount,
    omittedDuplicateCount: targets.omittedDuplicateCount,
    anchorCandidateCount: targets.anchorCandidateCount,
    attributeCandidateCount: targets.attributeCandidateCount,
    promotableCandidateCount: promotableLinks.length,
    nonPromotableCandidateCount: nonPromotableLinks.length,
    warningCounts,
    ...(targets.frameCount === undefined ? {} : { frameCount: targets.frameCount }),
    ...(targets.matchedFrameCount === undefined ? {} : { matchedFrameCount: targets.matchedFrameCount }),
    ...(sampleUrls.length === 0 ? {} : { sampleUrls }),
    ...(samplePromotableUrls.length === 0 ? {} : { samplePromotableUrls }),
    ...(sampleNonPromotableUrls.length === 0 ? {} : { sampleNonPromotableUrls }),
    ...(samplePromotableTargets.length === 0 ? {} : { samplePromotableTargets }),
    ...(sampleNonPromotableTargets.length === 0 ? {} : { sampleNonPromotableTargets })
  };
}

function sampleTarget(entry: { link: BrowserLinkTargetsResult["links"][number]; classification: ReturnType<typeof classifyDestinationProbeCandidate> }): SourceNavigationDestinationProbeSampleTarget {
  return {
    url: entry.link.url,
    text: entry.link.text,
    ...(entry.link.source === undefined ? {} : { source: entry.link.source }),
    ...(entry.link.attributeName === undefined ? {} : { attributeName: entry.link.attributeName }),
    ...(entry.link.frameIndex === undefined ? {} : { frameIndex: entry.link.frameIndex }),
    ...(entry.link.frameUrl === undefined ? {} : { frameUrl: entry.link.frameUrl }),
    ...(entry.link.frameName === undefined || entry.link.frameName.length === 0 ? {} : { frameName: entry.link.frameName }),
    warnings: entry.classification.warnings
  };
}

function countDestinationProbeWarnings(warnings: string[]): Array<{ warning: string; count: number }> {
  const counts = new Map<string, number>();
  for (const warning of warnings) {
    counts.set(warning, (counts.get(warning) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([warning, count]) => ({ warning, count }));
}

async function readBodyText(input: CalibrateSourceNavigationRecipePlanInput, timeoutMs: number): Promise<string | undefined> {
  const chunks: string[] = [];
  try {
    const result = await input.browserPool.readVisibleText(input.agentId, input.contextToken, input.pageId, "body", timeoutMs, input.signal);
    chunks.push(result.text);
  } catch {
    // Continue to DOM textContent fallback below; challenge pages often hide signals in script text.
  }
  try {
    const inspection = await input.browserPool.inspectSelector(input.agentId, input.contextToken, input.pageId, "body", {
      maxMatches: 1,
      maxTextLength: 5_000,
      ...(input.signal === undefined ? {} : { signal: input.signal })
    });
    for (const snippet of [inspection.firstVisibleTextSnippet, inspection.firstTextSnippet]) {
      if (snippet !== undefined && snippet.trim().length > 0) {
        chunks.push(snippet);
      }
    }
  } catch {
    // If DOM inspection is unavailable, visible text is still enough for ordinary pages.
  }
  const uniqueChunks = [...new Set(chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0))];
  return uniqueChunks.length === 0 ? undefined : uniqueChunks.join("\n");
}

function signalResult(actionKey: string, signal: string, kind: "expected_text" | "blocked_text", bodyText: string | undefined): SourceNavigationSignalCalibrationResult {
  if (bodyText === undefined) {
    return { actionKey, signal, kind, status: "unavailable" };
  }
  return {
    actionKey,
    signal,
    kind,
    status: includesText(bodyText, signal) ? "present" : "missing"
  };
}

function actionStatus(
  selectorResults: SourceNavigationSelectorCalibrationResult[],
  captureScopeResults: SourceNavigationSelectorCalibrationResult[],
  blockedSignals: SourceNavigationSignalCalibrationResult[],
  clientStateProbe: SourceNavigationClientStateProbeResult | undefined
): SourceNavigationActionCalibrationStatus {
  if (blockedSignals.some((signal) => signal.status === "present")) {
    return "blocked_signal_detected";
  }
  if (clientStateProbe?.status === "error") {
    return "error";
  }
  const allResults = [...selectorResults, ...captureScopeResults];
  if (clientStateProbe !== undefined && clientStateProbe.status !== "ok" && allResults.some((result) => result.status === "matched" || result.status === "hidden_match")) {
    return "partial";
  }
  if (allResults.length === 0) {
    return "partial";
  }
  if (allResults.some((result) => result.status === "matched")) {
    return "observed";
  }
  if (allResults.some((result) => result.status === "hidden_match")) {
    return "partial";
  }
  if (allResults.every((result) => result.status === "error")) {
    return "error";
  }
  return "not_observed";
}

function includesText(text: string, signal: string): boolean {
  return text.toLocaleLowerCase().includes(signal.toLocaleLowerCase());
}
