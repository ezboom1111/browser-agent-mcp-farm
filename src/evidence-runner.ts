import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { computeCaptureCacheKey, isEngineResolved, lookupCachedCapture, playwrightPackageVersion, readEngineIdentity, stalenessAgeMs, storeCachedCapture, writeEngineIdentity, type CachedCaptureArtifact, type CaptureCacheProfile } from "./capture-cache.js";
import { attachTypedFacts, crossCheckStructured, extractStructuredData } from "./structured-extractor.js";
import { httpTier0Capture } from "./http-tier0-capture.js";
import { summarizeStageTimings } from "./run-metrics.js";
import { isAbortError, throwIfAborted, withAbort } from "./abort.js";
import { ArtifactWriter, sanitizeFileBase, type ArtifactRecord, type CaptureBundleInput } from "./artifact-writer.js";
import { classifyBrowserObstructions, type BrowserObstructionReport } from "./browser-obstructions.js";
import { BrowserPool, type BrowserOverlayDismissalReport } from "./browser-pool.js";
import { runClaimGate, type ClaimGateResult } from "./claim-gate.js";
import {
  buildDestinationDeepeningCandidates,
  buildDestinationDeepeningProposals,
  buildDestinationTriage,
  classifyDestinationChildUsefulness,
  selectedDestinationRequests,
  summarizeDestinationDeepeningProposals,
  summarizeDestinationTriageResult,
  writeDestinationCandidateArtifact,
  writeDestinationDeepeningProposalArtifact,
  writeDestinationDeepeningRunArtifact,
  writeDestinationTriageArtifact,
  type DestinationChildEvidenceSummary,
  type DestinationDeepeningCandidate,
  type DestinationDeepeningExecutionResult,
  type DestinationDeepeningExecutionSummary,
  type DestinationDeepeningProposal,
  type DestinationDeepeningProposalSummary,
  type DestinationTriageResult,
  type DestinationTriageSummary,
  type DestinationVisibleLink
} from "./destination-triage.js";
import { analyzeSceneChanges, buildDenseTimestampPlan, type DenseSamplingEvent, type DenseSamplingSource, type DenseTimestampPlan, type FrameSampleRunResult, type SceneChangeDetectionDiagnostics, type SceneChangeHit } from "./frame-sampler.js";
import { LeaseManager } from "./lease-manager.js";
import { collectOfficialApiEvidence } from "./official-api.js";
import { runOcrForFrameArtifacts } from "./ocr.js";
import { describePlatformCapabilities, type PlatformCapabilityMap } from "./platform-adapters/index.js";
import type { ClaimType, EvidenceKind, VerificationLevel } from "./schemas.js";
import { buildSourceNavigationExecutionPlan, type SourceNavigationExecutionPlan } from "./source-navigation-execution.js";
import { executeSourceNavigationActions, type ExecuteSourceNavigationActionsInput, type SourceNavigationExecutionRunResult, type SourceNavigationFollowUpRequest } from "./source-navigation-executor.js";
import { calibrateSourceNavigationRecipePlan, writeSourceNavigationCalibrationArtifact, type SourceNavigationCalibrationReport } from "./source-navigation-calibration.js";
import { describeSourceNavigationRecipePlan, summarizeSourceNavigationRecipePlan, type SourceNavigationRecipePlan, type SourceNavigationRecipePlanSummary } from "./source-navigation-recipes.js";
import { describeSourceNavigationPlan, type SourceNavigationPlan } from "./source-navigation.js";
import { selectSourceRegistryEntriesForUrl, summarizeSourceRegistryMatch } from "./source-registry.js";
import { describeSourceStrategy } from "./source-strategy.js";
import { detectedTextScriptFamilies, destinationQueryFromUrl, hasDominantTextScriptMismatch, matchingTextTokens, normalizeEvidenceText } from "./evidence-runner-text.js";
import type {
  EvidenceWorkflowAssessment,
  EvidenceWorkflowClaim,
  EvidenceWorkflowDeps,
  EvidenceWorkflowOptions,
  EvidenceWorkflowResult,
  EvidenceWorkflowStageTiming,
  FrameSamplingAssessment,
  SourceNavigationCalibrationAssessment,
  SourceNavigationExecutionPlanSummary,
  SourceNavigationExecutionSummary,
  SourceNavigationFollowUpRunSummary,
  SourceNavigationFollowUpSummary,
  SourceNavigationPlanSummary
} from "./evidence-runner-types.js";
export type {
  EvidenceWorkflowAssessment,
  EvidenceWorkflowClaim,
  EvidenceWorkflowDeps,
  EvidenceWorkflowOptions,
  EvidenceWorkflowResult,
  EvidenceWorkflowStageStatus,
  EvidenceWorkflowStageTiming,
  FrameSamplingAssessment,
  SourceNavigationCalibrationAssessment,
  SourceNavigationExecutionPlanSummary,
  SourceNavigationExecutionSummary,
  SourceNavigationFollowUpRunSummary,
  SourceNavigationFollowUpSummary,
  SourceNavigationPlanSummary
} from "./evidence-runner-types.js";

type StageRunner = <T>(stage: string, work: () => Promise<T>) => Promise<T>;

function createStageRunner(stageTimings: EvidenceWorkflowStageTiming[], signal: AbortSignal | undefined): StageRunner {
  return async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
    throwIfAborted(signal);
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    try {
      const result = await work();
      stageTimings.push({
        stage,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedMs),
        status: "ok"
      });
      return result;
    } catch (error) {
      stageTimings.push({
        stage,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedMs),
        status: isAbortError(error) ? "aborted" : "error",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  };
}

export async function runEvidenceWorkflow(options: EvidenceWorkflowOptions, deps: EvidenceWorkflowDeps = {}): Promise<EvidenceWorkflowResult> {
  const stageTimings: EvidenceWorkflowStageTiming[] = [];
  const runStage = createStageRunner(stageTimings, options.abortSignal);
  throwIfAborted(options.abortSignal);
  const parsedUrl = new URL(options.url);
  await runStage("setup", () => withAbort(mkdir(options.runDir, { recursive: true }), options.abortSignal));
  const writer = deps.artifactWriter ?? new ArtifactWriter();
  const platformCapabilities = describePlatformCapabilities(options.url);
  const sourceStrategy = describeSourceStrategy(options.url);
  const sourceRegistry = selectSourceRegistryEntriesForUrl(options.url);
  const sourceNavigationRequested = options.sourceNavigation?.enabled ?? false;
  const sourceNavigationPlan = describeSourceNavigationPlan({
    sourceStrategy,
    mode: sourceNavigationRequested ? "safe_execute" : "plan_only"
  });
  const sourceNavigationExecutionPlan = buildSourceNavigationExecutionPlan(sourceNavigationPlan, options.sourceNavigation?.limits);
  const sourceNavigationRecipePlan = describeSourceNavigationRecipePlan(sourceNavigationPlan);
  const baseCaptureId = sanitizeFileBase(options.captureId ?? `evidence-${platformCapabilities.platform}-${parsedUrl.hostname}`);
  const common = {
    runDir: options.runDir,
    sourceUrl: options.url,
    contextToken: `${baseCaptureId}-workflow`,
    pageId: "evidence-workflow"
  };

  const capabilityRecords = await runStage("platform_capability_artifact", () =>
    withAbort(
      writer.writeCaptureBundle({
        ...common,
        pageId: "platform-capabilities",
        captureId: `${baseCaptureId}-platform-capabilities`,
        metadata: { platformCapabilities },
        text: JSON.stringify(platformCapabilities, null, 2),
        captureMethod: "browser-agent-mcp-farm platform-capabilities",
        toolName: "platform_capabilities"
      }),
      options.abortSignal
    )
  );
  throwIfAborted(options.abortSignal);

  const sourceStrategyRecords = await runStage("source_strategy_artifact", () =>
    withAbort(
      writer.writeCaptureBundle({
        ...common,
        pageId: "source-strategy",
        captureId: `${baseCaptureId}-source-strategy`,
        metadata: { sourceStrategy },
        text: JSON.stringify(sourceStrategy, null, 2),
        captureMethod: "browser-agent-mcp-farm source-strategy",
        toolName: "source_strategy",
        evidenceKind: "source_strategy"
      }),
      options.abortSignal
    )
  );
  throwIfAborted(options.abortSignal);

  const sourceRegistryRecords = await runStage("source_registry_artifact", () =>
    withAbort(
      writer.writeCaptureBundle({
        ...common,
        pageId: "source-registry",
        captureId: `${baseCaptureId}-source-registry`,
        metadata: { sourceRegistry },
        text: JSON.stringify(sourceRegistry, null, 2),
        captureMethod: "browser-agent-mcp-farm source-registry",
        toolName: "source_registry",
        evidenceKind: "source_registry"
      }),
      options.abortSignal
    )
  );
  throwIfAborted(options.abortSignal);

  const sourceNavigationPlanRecords = await runStage("source_navigation_plan_artifact", () =>
    withAbort(
      writer.writeCaptureBundle({
        ...common,
        pageId: "source-navigation-plan",
        captureId: `${baseCaptureId}-source-navigation-plan`,
        metadata: { sourceNavigationPlan },
        text: JSON.stringify(sourceNavigationPlan, null, 2),
        captureMethod: "browser-agent-mcp-farm source-navigation-plan",
        toolName: "source_navigation_plan",
        evidenceKind: "source_navigation_plan"
      }),
      options.abortSignal
    )
  );
  throwIfAborted(options.abortSignal);

  const sourceNavigationExecutionPlanRecords = await runStage("source_navigation_execution_plan_artifact", () =>
    withAbort(
      writer.writeCaptureBundle({
        ...common,
        pageId: "source-navigation-execution-plan",
        captureId: `${baseCaptureId}-source-navigation-execution-plan`,
        metadata: { sourceNavigationExecutionPlan },
        text: JSON.stringify(sourceNavigationExecutionPlan, null, 2),
        captureMethod: "browser-agent-mcp-farm source-navigation-execution-plan",
        toolName: "source_navigation_execution_plan",
        evidenceKind: "source_navigation_execution_plan"
      }),
      options.abortSignal
    )
  );
  throwIfAborted(options.abortSignal);

  const sourceNavigationRecipePlanRecords = await runStage("source_navigation_recipe_plan_artifact", () =>
    withAbort(
      writer.writeCaptureBundle({
        ...common,
        pageId: "source-navigation-recipe-plan",
        captureId: `${baseCaptureId}-source-navigation-recipe-plan`,
        metadata: { sourceNavigationRecipePlan },
        text: JSON.stringify(sourceNavigationRecipePlan, null, 2),
        captureMethod: "browser-agent-mcp-farm source-navigation-recipe-plan",
        toolName: "source_navigation_recipe_plan",
        evidenceKind: "source_navigation_recipe_plan"
      }),
      options.abortSignal
    )
  );
  throwIfAborted(options.abortSignal);

  const browserResult = await captureBrowserEvidence({
    options,
    parsedUrl,
    baseCaptureId,
    writer,
    deps,
    runStage,
    sourceNavigationPlan,
    sourceNavigationRecipePlan
  });
  const officialApi = await runStage("official_api", () =>
    collectOfficialApiEvidence({
      runDir: options.runDir,
      sourceUrl: options.url,
      contextToken: common.contextToken,
      pageId: "official-api",
      baseCaptureId,
      platformCapabilities,
      officialApi: options.officialApi ?? { enabled: false, credentials: {} },
      writer,
      signal: options.abortSignal
    })
  );
  throwIfAborted(options.abortSignal);

  const obstructionResult = await runStage("browser_obstruction_classification", () =>
    classifyBrowserObstructionArtifacts({
      runDir: options.runDir,
      sourceUrl: options.url,
      baseCaptureId,
      platformCapabilities,
      pageCaptureRecords: browserResult.pageCaptureRecords,
      contextToken: common.contextToken,
      pageId: "browser-obstructions",
      writer,
      signal: options.abortSignal
    })
  );
  throwIfAborted(options.abortSignal);

  const frameSampling = summarizeFrameSampling(browserResult.frameResult, browserResult.frameError, options.sampleFrames === false);
  const assessment: EvidenceWorkflowAssessment = {
    url: options.url,
    platform: platformCapabilities.platform,
    ...(platformCapabilities.mediaId === undefined ? {} : { mediaId: platformCapabilities.mediaId }),
    sourceStrategy,
    sourceRegistry: summarizeSourceRegistryMatch(sourceRegistry),
    sourceNavigationPlan: summarizeSourceNavigationPlan(sourceNavigationPlan),
    sourceNavigationExecutionPlan: summarizeSourceNavigationExecutionPlan(sourceNavigationExecutionPlan),
    sourceNavigationRecipePlan: summarizeSourceNavigationRecipePlan(sourceNavigationRecipePlan),
    sourceNavigationCalibration: summarizeSourceNavigationCalibrationAssessment(browserResult.sourceNavigationCalibrationReport, options.sourceNavigation?.calibrate ?? false, browserResult.sourceNavigationCalibrationRecords.length),
    sourceNavigationExecution: summarizeSourceNavigationExecution(browserResult.sourceNavigationExecutionResult, sourceNavigationRequested, browserResult.sourceNavigationActionRecords.length),
    sourceNavigationFollowUps: summarizeSourceNavigationFollowUps(browserResult.sourceNavigationFollowUpResult),
    destinationTriage: summarizeDestinationTriageAssessment(browserResult.sourceNavigationFollowUpResult),
    destinationDeepeningProposals: summarizeDestinationDeepeningProposalAssessment(browserResult.sourceNavigationFollowUpResult),
    destinationDeepeningExecution: summarizeDestinationDeepeningExecution(browserResult.sourceNavigationFollowUpResult),
    browserCaptureRecords: browserResult.pageCaptureRecords.length,
    frameSampling,
    browserOverlayDismissal: browserResult.overlayDismissal,
    browserObstructions: obstructionResult.report,
    stageTimings,
    transcript: {
      officialCaptionBodyCapability: platformCapabilities.capabilities.captionBody.status,
      credentialRequired: platformCapabilities.capabilities.captionBody.requiresCredential,
      verifiedInThisRun: false,
      reason: "No authorized caption body or audio transcription artifact was collected in this run."
    },
    audioVerified: false,
    rawVideoBytesCollected: false
  };
  const frameRecords = browserResult.frameResult?.frames.flatMap((frame) => frame.records) ?? browserResult.frameFailureRecords;
  const assessmentRecords = await runStage("assessment_artifact", () =>
    withAbort(
      writer.writeCaptureBundle({
        ...common,
        pageId: "run-assessment",
        captureId: `${baseCaptureId}-run-assessment`,
        metadata: { assessment },
        text: JSON.stringify(assessment, null, 2),
        captureMethod: "browser-agent-mcp-farm evidence-run assessment",
        toolName: "evidence_run"
      }),
      options.abortSignal
    )
  );

  const claims = buildClaims({
    baseCaptureId,
    platformCapabilities,
    capabilityRecords,
    pageCaptureRecords: browserResult.pageCaptureRecords,
    frameRecords,
    ocrRecords: browserResult.ocrRecords,
    officialApiRecords: officialApi.records,
    obstructionRecords: obstructionResult.records,
    assessmentRecords,
    frameSampling,
    ...(browserResult.capturedViaHttp === true ? { capturedViaHttp: true } : {}),
    ...(browserResult.capturedViaCache === true ? { capturedViaCache: true, ...(browserResult.cacheStalenessMs === undefined ? {} : { cacheStalenessMs: browserResult.cacheStalenessMs }) } : {})
  });
  await runStage("claims_citations", () => withAbort(appendClaims(options.runDir, claims), options.abortSignal));

  const reportPath = join(options.runDir, "reports", `${baseCaptureId}-final.md`);
  const claimGate = options.finalClaimGate === false ? undefined : await runStage("claim_gate", () => withAbort(runClaimGate(options.runDir, { mode: "final", minClaims: 1 }), options.abortSignal));

  await runStage("final_report", () =>
    withAbort(
      writeReport(reportPath, {
        url: options.url,
        runDir: options.runDir,
        assessment,
        claims,
        claimGate
      }),
      options.abortSignal
    )
  );

  // Persist per-run stage metrics (observability / SLO input) as an operational
  // sidecar — deliberately OUTSIDE the artifact ledger/bundle, since it is not evidence.
  await withAbort(writeFile(join(options.runDir, "metrics.json"), `${JSON.stringify(summarizeStageTimings(stageTimings, browserResult.blockedResourceCount === undefined ? {} : { blockedResourceCount: browserResult.blockedResourceCount }), null, 2)}\n`, "utf8"), options.abortSignal).catch(() => undefined);

  return {
    ok: claimGate?.ok ?? true,
    runDir: options.runDir,
    reportPath,
    url: options.url,
    platformCapabilities,
    sourceStrategy,
    sourceRegistry,
    sourceNavigationPlan,
    sourceNavigationExecutionPlan,
    sourceNavigationRecipePlan,
    capabilityRecords,
    sourceStrategyRecords,
    sourceRegistryRecords,
    sourceNavigationPlanRecords,
    sourceNavigationExecutionPlanRecords,
    sourceNavigationRecipePlanRecords,
    sourceNavigationCalibrationRecords: browserResult.sourceNavigationCalibrationRecords,
    sourceNavigationActionRecords: browserResult.sourceNavigationActionRecords,
    sourceNavigationFollowUpRecords: browserResult.sourceNavigationFollowUpRecords,
    destinationCandidateRecords: browserResult.destinationCandidateRecords,
    destinationTriageRecords: browserResult.destinationTriageRecords,
    destinationDeepeningProposalRecords: browserResult.destinationDeepeningProposalRecords,
    destinationDeepeningRunRecords: browserResult.destinationDeepeningRunRecords,
    pageCaptureRecords: browserResult.pageCaptureRecords,
    frameRecords,
    ocrRecords: browserResult.ocrRecords,
    officialApiRecords: officialApi.records,
    overlayDismissalRecords: browserResult.overlayDismissalRecords,
    obstructionRecords: obstructionResult.records,
    assessmentRecords,
    assessment,
    stageTimings,
    claims,
    ...(claimGate === undefined ? {} : { claimGate })
  };
}

async function captureBrowserEvidence(input: { options: EvidenceWorkflowOptions; parsedUrl: URL; baseCaptureId: string; writer: ArtifactWriter; deps: EvidenceWorkflowDeps; runStage: StageRunner; sourceNavigationPlan: SourceNavigationPlan; sourceNavigationRecipePlan: SourceNavigationRecipePlan }): Promise<{
  /** True when the page bytes were captured by the tier-0 browserless HTTP fetch (A1), not a browser. */
  capturedViaHttp?: boolean;
  /** True when the page bytes were replayed from a fresh content-addressed cache entry (C4), not re-captured. */
  capturedViaCache?: boolean;
  /** Age (ms) of the replayed cache entry, recorded on the cached_capture claim. */
  cacheStalenessMs?: number;
  /** Subrequests aborted by the text-profile resource blocker on this run (C3). */
  blockedResourceCount?: number;
  pageCaptureRecords: ArtifactRecord[];
  sourceNavigationCalibrationRecords: ArtifactRecord[];
  sourceNavigationCalibrationReport?: SourceNavigationCalibrationReport;
  sourceNavigationActionRecords: ArtifactRecord[];
  sourceNavigationFollowUpRecords: ArtifactRecord[];
  destinationCandidateRecords: ArtifactRecord[];
  destinationTriageRecords: ArtifactRecord[];
  destinationDeepeningProposalRecords: ArtifactRecord[];
  destinationDeepeningRunRecords: ArtifactRecord[];
  sourceNavigationExecutionResult?: SourceNavigationExecutionRunResult;
  sourceNavigationFollowUpResult?: SourceNavigationFollowUpRunResult;
  frameResult?: FrameSampleRunResult;
  frameFailureRecords: ArtifactRecord[];
  ocrRecords: ArtifactRecord[];
  overlayDismissal: BrowserOverlayDismissalReport;
  overlayDismissalRecords: ArtifactRecord[];
  frameError?: string;
}> {
  const leaseManager = input.deps.leaseManager ?? new LeaseManager();
  const pool =
    input.deps.browserPool ??
    new BrowserPool(leaseManager, {
      navigationTimeoutMs: input.options.navigationTimeoutMs ?? 30_000,
      launchHeadless: !(input.options.headed ?? false),
      ...(input.options.browserChannel === undefined ? {} : { browserChannel: input.options.browserChannel }),
      ...(input.options.captureProfile === undefined ? {} : { captureProfile: input.options.captureProfile }),
      artifactWriter: input.writer
    });
  const ownsPool = input.deps.browserPool === undefined;
  const agentId = "evidence-runner";
  const frameFailureRecords: ArtifactRecord[] = [];
  const sourceNavigationCalibrationRecords: ArtifactRecord[] = [];
  const sourceNavigationActionRecords: ArtifactRecord[] = [];
  let sourceNavigationCalibrationReport: SourceNavigationCalibrationReport | undefined;
  const sourceNavigationFollowUpRecords: ArtifactRecord[] = [];
  const destinationCandidateRecords: ArtifactRecord[] = [];
  const destinationTriageRecords: ArtifactRecord[] = [];
  const destinationDeepeningProposalRecords: ArtifactRecord[] = [];
  const destinationDeepeningRunRecords: ArtifactRecord[] = [];
  let sourceNavigationExecutionResult: SourceNavigationExecutionRunResult | undefined;
  let sourceNavigationFollowUpResult: SourceNavigationFollowUpRunResult | undefined;
  let leaseToken: string | undefined;
  let released = false;

  try {
    throwIfAborted(input.options.abortSignal);

    // Tier-0 browserless capture (A1/D2): try a plain HTTP GET first when opted in directly
    // (httpFetch) OR via auto routing (captureRouting "auto"). On success we skip the browser entirely
    // and early-return with the tier-0 page records (no frames/OCR/source-navigation — those need a
    // browser). On decline (client-rendered shell / non-HTML / off-domain / error) we fall through to
    // the browser path (escalation), so auto is never a worse capture than the browser. The lease/pool
    // below are never touched on the tier-0 success path.
    const tryTier0 = input.options.httpFetch === true || input.options.captureRouting === "auto";
    if (tryTier0) {
      const tier0 = await input.runStage("http_tier0_capture", () =>
        httpTier0Capture({
          runDir: input.options.runDir,
          url: input.options.url,
          allowedDomains: [input.parsedUrl.hostname],
          writer: input.writer,
          captureId: `${input.baseCaptureId}-page-capture`,
          contextToken: `${input.baseCaptureId}-http`,
          pageId: "http-fetch",
          ...(input.options.navigationTimeoutMs === undefined ? {} : { timeoutMs: input.options.navigationTimeoutMs }),
          ...(input.options.abortSignal === undefined ? {} : { signal: input.options.abortSignal })
        })
      );
      if (tier0.ok) {
        return {
          capturedViaHttp: true,
          pageCaptureRecords: tier0.records,
          sourceNavigationCalibrationRecords,
          sourceNavigationActionRecords,
          sourceNavigationFollowUpRecords,
          destinationCandidateRecords,
          destinationTriageRecords,
          destinationDeepeningProposalRecords,
          destinationDeepeningRunRecords,
          frameFailureRecords,
          ocrRecords: [],
          overlayDismissal: skippedOverlayDismissalReport("tier-0 http_fetch capture: no browser, overlay dismissal not applicable"),
          overlayDismissalRecords: []
        };
      }
      // tier-0 declined (non-HTML / off-domain / bot-blocked) -> escalate to the browser path.
    }

    // Capture-cache replay (C4, opt-in): a BARE ephemeral run on the bundled Chromium engine may
    // replay a fresh (<=1h) prior capture by content hash instead of launching. Credentialed,
    // fingerprinted, named-profile, or branded-channel runs are never eligible (an auto-updating or
    // identity-bearing capture must not be served from cache). On a hit we early-return like tier-0;
    // on any miss we fall through to the browser and store this run's capture afterwards.
    const cacheRoot = dirname(input.options.runDir);
    const cacheEligible = input.options.captureCache === true && (input.options.storagePolicy ?? "ephemeral") === "ephemeral" && input.options.profileName === undefined && input.options.browserChannel === undefined;
    if (cacheEligible) {
      const replay = await input.runStage("capture_cache_replay", () =>
        tryReplayCachedCapture({
          cacheRoot,
          runDir: input.options.runDir,
          url: input.options.url,
          options: input.options,
          writer: input.writer,
          baseCaptureId: input.baseCaptureId,
          contextToken: `${input.baseCaptureId}-cache`,
          ...(input.options.abortSignal === undefined ? {} : { signal: input.options.abortSignal })
        })
      );
      if (replay !== undefined) {
        return {
          capturedViaCache: true,
          cacheStalenessMs: replay.stalenessMs,
          pageCaptureRecords: replay.records,
          sourceNavigationCalibrationRecords,
          sourceNavigationActionRecords,
          sourceNavigationFollowUpRecords,
          destinationCandidateRecords,
          destinationTriageRecords,
          destinationDeepeningProposalRecords,
          destinationDeepeningRunRecords,
          frameFailureRecords,
          ocrRecords: [],
          overlayDismissal: skippedOverlayDismissalReport("C4 cached_capture replay: no browser, overlay dismissal not applicable"),
          overlayDismissalRecords: []
        };
      }
    }

    // Pre-launch the shared Browser as a measured stage (C3) so the launch cost is visible in
    // metrics.json and the subsequent openPage does not pay it synchronously.
    await input.runStage("browser_prewarm", () => pool.prewarm());
    const lease = await input.runStage("browser_acquire_context", async () =>
      leaseManager.acquire({
        agentId,
        runId: input.baseCaptureId,
        artifactRunDir: input.options.runDir,
        allowedDomains: [input.parsedUrl.hostname],
        maxPages: 1,
        ttlMs: 180_000,
        capability: input.options.sourceNavigation?.enabled ? "read-write" : "read-only",
        storagePolicy: input.options.storagePolicy ?? "ephemeral",
        ...(input.options.profileName === undefined ? {} : { profileName: input.options.profileName })
      })
    );
    leaseToken = lease.contextToken;
    const page = await input.runStage("browser_open_page", () => pool.openPage(agentId, lease.contextToken, input.options.url, input.options.abortSignal));
    if ((input.options.waitMs ?? 3_000) > 0) {
      await input.runStage("browser_wait", () => pool.waitForPage(agentId, lease.contextToken, page.pageId, input.options.waitMs ?? 3_000, input.options.abortSignal));
    }
    const overlayOptions = input.options.overlayDismissal ?? { enabled: true, maxActions: 3 };
    const overlayDismissal = await input.runStage("browser_overlay_dismissal", async () => {
      if (!overlayOptions.enabled || overlayOptions.maxActions === 0) {
        return skippedOverlayDismissalReport(!overlayOptions.enabled ? "overlay dismissal disabled for this run" : "overlay dismissal maxActions is 0");
      }
      try {
        return await pool.dismissBenignOverlays(agentId, lease.contextToken, page.pageId, overlayOptions.maxActions, input.options.abortSignal);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        return failedOverlayDismissalReport(error instanceof Error ? error.message : String(error));
      }
    });
    const overlayDismissalRecords = await input.runStage("browser_overlay_dismissal_artifact", () =>
      writeOverlayDismissalArtifact({
        runDir: input.options.runDir,
        sourceUrl: input.options.url,
        contextToken: lease.contextToken,
        pageId: page.pageId,
        baseCaptureId: input.baseCaptureId,
        report: overlayDismissal,
        writer: input.writer,
        signal: input.options.abortSignal
      })
    );
    if (input.options.sourceNavigation?.enabled) {
      const executionInput: ExecuteSourceNavigationActionsInput = {
        plan: input.sourceNavigationPlan,
        executableActions: input.options.sourceNavigation?.actions ?? [],
        browserPool: pool,
        artifactWriter: input.writer,
        agentId,
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir: input.options.runDir,
        sourceUrl: input.options.url,
        captureIdBase: `${input.baseCaptureId}-source-navigation`
      };
      if (input.options.sourceNavigation?.limits !== undefined) {
        executionInput.limits = input.options.sourceNavigation.limits;
      }
      if (input.options.abortSignal !== undefined) {
        executionInput.signal = input.options.abortSignal;
      }
      const executionResult = await input.runStage("source_navigation_execution", () => executeSourceNavigationActions(executionInput));
      sourceNavigationExecutionResult = executionResult;
      sourceNavigationActionRecords.push(...executionResult.records);
      sourceNavigationFollowUpResult = await input.runStage("source_navigation_followups", () =>
        runSourceNavigationFollowUps({
          parent: input,
          sourceNavigationPlan: input.sourceNavigationPlan,
          sourceNavigationActionRecords,
          requests: executionResult.followUps,
          leaseManager,
          browserPool: pool
        })
      );
      sourceNavigationFollowUpRecords.push(...sourceNavigationFollowUpResult.records);
      destinationCandidateRecords.push(...sourceNavigationFollowUpResult.destinationCandidateRecords);
      destinationTriageRecords.push(...sourceNavigationFollowUpResult.destinationTriageRecords);
      destinationDeepeningProposalRecords.push(...sourceNavigationFollowUpResult.destinationDeepeningProposalRecords);
      destinationDeepeningRunRecords.push(...sourceNavigationFollowUpResult.destinationDeepeningRunRecords);
    }
    const capture = await input.runStage("browser_page_capture", () => pool.capturePage(agentId, lease.contextToken, page.pageId, `${input.baseCaptureId}-page-capture`, input.options.abortSignal));
    // Record the resolved engine (channel + browser version) as a sidecar for reproducibility. Like
    // metrics.json this is OUTSIDE the artifact ledger/Merkle root; buildBundleManifest attaches it to
    // the manifest beside (not inside) the hashed bytes. Non-fatal.
    await withAbort(writeFile(join(input.options.runDir, "run-meta.json"), `${JSON.stringify({ engine: pool.engineProvenance() }, null, 2)}\n`, "utf8"), input.options.abortSignal).catch(() => undefined);
    // Persist this run's capture into the per-run-root cache (C4) so a later eligible run can replay it
    // by content hash. Best-effort, never fails the run; no-op unless the engine resolved.
    if (cacheEligible) {
      await input.runStage("capture_cache_store", () => storeCaptureInCache({ cacheRoot, runDir: input.options.runDir, url: input.options.url, options: input.options, engine: pool.engineProvenance(), captureRecords: capture.records })).catch(() => undefined);
    }
    if (input.options.sourceNavigation?.calibrate) {
      const calibrationReport = await input.runStage("source_navigation_calibration", () =>
        calibrateSourceNavigationRecipePlan({
          recipePlan: input.sourceNavigationRecipePlan,
          browserPool: pool,
          agentId,
          contextToken: lease.contextToken,
          pageId: page.pageId,
          url: input.options.url,
          ...(input.options.sourceNavigation?.calibrationSelectorTimeoutMs === undefined ? {} : { selectorTimeoutMs: input.options.sourceNavigation.calibrationSelectorTimeoutMs }),
          ...(input.options.abortSignal === undefined ? {} : { signal: input.options.abortSignal })
        })
      );
      sourceNavigationCalibrationReport = calibrationReport;
      const records = await input.runStage("source_navigation_calibration_artifact", () =>
        writeSourceNavigationCalibrationArtifact({
          artifactWriter: input.writer,
          runDir: input.options.runDir,
          sourceUrl: input.options.url,
          contextToken: lease.contextToken,
          pageId: page.pageId,
          report: calibrationReport,
          captureId: `${input.baseCaptureId}-source-navigation-calibration`
        })
      );
      sourceNavigationCalibrationRecords.push(...records);
    }
    let frameResult: FrameSampleRunResult | undefined;
    let frameError: string | undefined;
    let ocrRecords: ArtifactRecord[] = [];
    if (input.options.sampleFrames !== false) {
      try {
        const selector = input.options.frameSelector ?? "video";
        await input.runStage("frame_wait_for_selector", () => pool.waitForSelector(agentId, lease.contextToken, page.pageId, selector, 10_000, input.options.abortSignal));
        frameResult = await input.runStage("frame_sampling", () =>
          pool.sampleFrames(agentId, lease.contextToken, page.pageId, {
            selector,
            captureId: `${input.baseCaptureId}-frame-sample`,
            timestampsSec: input.options.timestampsSec ?? [0, 10],
            strideSec: 60,
            maxFrames: input.options.maxFrames ?? 2,
            seekTimeoutMs: input.options.seekTimeoutMs ?? 10_000,
            settleMs: input.options.settleMs ?? 500,
            abortSignal: input.options.abortSignal
          })
        );
        const denseSampling = input.options.denseSampling;
        if (denseSampling?.enabled) {
          throwIfAborted(input.options.abortSignal);
          const denseHits = collectDenseHitTimestamps(frameResult, denseSampling.query);
          if (denseHits.length > 0) {
            const densePlan = buildDenseTimestampPlan({
              baseTimestampsSec: frameResult.plan.timestampsSec,
              hitTimestampsSec: denseHits,
              durationSec: frameResult.plan.durationSec,
              windowSec: denseSampling.windowSec,
              stepSec: denseSampling.stepSec,
              maxDenseFrames: denseSampling.maxDenseFrames
            });
            if (densePlan.denseTimestampsSec.length > 0) {
              const denseResult = await input.runStage("dense_frame_sampling", () =>
                pool.sampleFrames(agentId, lease.contextToken, page.pageId, {
                  selector,
                  captureId: `${input.baseCaptureId}-dense-frame-sample`,
                  timestampsSec: densePlan.denseTimestampsSec,
                  strideSec: 60,
                  maxFrames: denseSampling.maxDenseFrames,
                  seekTimeoutMs: input.options.seekTimeoutMs ?? 10_000,
                  settleMs: input.options.settleMs ?? 500,
                  abortSignal: input.options.abortSignal
                })
              );
              frameResult = mergeFrameSampleResults(frameResult, denseResult, densePlan, "Transcript dense sampling", {
                source: "transcript_cue",
                hitTimestampsSec: denseHits
              });
            }
          }
          if (denseSampling.sceneChange !== false) {
            const sceneChangeDetection = analyzeSceneChanges({
              frames: frameResult.frames,
              minDistance: denseSampling.sceneChangeThreshold ?? 16,
              maxHits: denseSampling.sceneChangeMaxHits ?? denseSampling.maxDenseFrames
            });
            frameResult = appendSceneChangeDiagnostics(frameResult, sceneChangeDetection.diagnostics);
            const sceneChangeHits = sceneChangeDetection.hits;
            if (sceneChangeHits.length > 0) {
              const densePlan = buildDenseTimestampPlan({
                baseTimestampsSec: frameResult.plan.timestampsSec,
                hitTimestampsSec: sceneChangeHits.map((hit) => hit.midpointSec),
                durationSec: frameResult.plan.durationSec,
                windowSec: denseSampling.windowSec,
                stepSec: denseSampling.stepSec,
                maxDenseFrames: denseSampling.maxDenseFrames
              });
              const uncapturedTimestamps = uncapturedDenseTimestamps(frameResult, densePlan.denseTimestampsSec);
              if (uncapturedTimestamps.length > 0) {
                const denseResult = await input.runStage("scene_change_dense_frame_sampling", () =>
                  pool.sampleFrames(agentId, lease.contextToken, page.pageId, {
                    selector,
                    captureId: `${input.baseCaptureId}-scene-change-dense-frame-sample`,
                    timestampsSec: uncapturedTimestamps,
                    strideSec: 60,
                    maxFrames: denseSampling.maxDenseFrames,
                    seekTimeoutMs: input.options.seekTimeoutMs ?? 10_000,
                    settleMs: input.options.settleMs ?? 500,
                    abortSignal: input.options.abortSignal
                  })
                );
                frameResult = mergeFrameSampleResults(frameResult, denseResult, densePlan, "Scene-change dense sampling", {
                  source: "scene_change",
                  hitTimestampsSec: sceneChangeHits.map((hit) => hit.midpointSec),
                  sceneChangeHits,
                  sceneChangeDiagnostics: sceneChangeDetection.diagnostics
                });
              }
            }
          }
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        frameError = error instanceof Error ? error.message : String(error);
        frameFailureRecords.push(
          ...(await input.writer.recordFailure({
            runDir: input.options.runDir,
            sourceUrl: input.options.url,
            contextToken: lease.contextToken,
            pageId: page.pageId,
            captureId: `${input.baseCaptureId}-frame-sample-failed`,
            error: frameError,
            status: "partial",
            metadata: { stage: "frame_sample", frameError },
            captureMethod: "browser-agent-mcp-farm frame-sample",
            toolName: "farm_sample_frames"
          }))
        );
      }
    }
    const ocrFrameRecords = frameRecordsForOcr(frameResult, frameFailureRecords);
    const ocrResult = await input.runStage("ocr", () =>
      runOcrForFrameArtifacts({
        runDir: input.options.runDir,
        sourceUrl: input.options.url,
        contextToken: lease.contextToken,
        pageId: "ocr",
        baseCaptureId: input.baseCaptureId,
        frameRecords: ocrFrameRecords,
        options: input.options.ocr ?? { enabled: false, maxFrames: 20, timeoutMs: 10_000 },
        writer: input.writer,
        ...(input.deps.ocrWorkerFactory === undefined ? {} : { workerFactory: input.deps.ocrWorkerFactory }),
        signal: input.options.abortSignal
      })
    );
    ocrRecords = [...ocrResult.records];
    if (frameResult !== undefined && input.options.denseSampling?.enabled && input.options.ocr?.enabled) {
      const denseSampling = input.options.denseSampling;
      const ocrHitTimestamps = await collectOcrHitTimestamps(input.options.runDir, ocrRecords, denseSampling.query, input.options.abortSignal);
      if (ocrHitTimestamps.length > 0) {
        const densePlan = buildDenseTimestampPlan({
          baseTimestampsSec: frameResult.plan.timestampsSec,
          hitTimestampsSec: ocrHitTimestamps,
          durationSec: frameResult.plan.durationSec,
          windowSec: denseSampling.windowSec,
          stepSec: denseSampling.stepSec,
          maxDenseFrames: denseSampling.maxDenseFrames
        });
        const uncapturedTimestamps = uncapturedDenseTimestamps(frameResult, densePlan.denseTimestampsSec);
        if (uncapturedTimestamps.length > 0) {
          const selector = input.options.frameSelector ?? "video";
          const denseResult = await input.runStage("ocr_hit_dense_frame_sampling", () =>
            pool.sampleFrames(agentId, lease.contextToken, page.pageId, {
              selector,
              captureId: `${input.baseCaptureId}-ocr-hit-dense-frame-sample`,
              timestampsSec: uncapturedTimestamps,
              strideSec: 60,
              maxFrames: denseSampling.maxDenseFrames,
              seekTimeoutMs: input.options.seekTimeoutMs ?? 10_000,
              settleMs: input.options.settleMs ?? 500,
              abortSignal: input.options.abortSignal
            })
          );
          frameResult = mergeFrameSampleResults(frameResult, denseResult, densePlan, "OCR-hit dense sampling", {
            source: "ocr_text",
            hitTimestampsSec: ocrHitTimestamps
          });
          const denseOcrResult = await input.runStage("ocr_dense_sampling", () =>
            runOcrForFrameArtifacts({
              runDir: input.options.runDir,
              sourceUrl: input.options.url,
              contextToken: lease.contextToken,
              pageId: "ocr",
              baseCaptureId: `${input.baseCaptureId}-ocr-dense`,
              frameRecords: denseResult.frames.flatMap((frame) => frame.records),
              options: input.options.ocr ?? { enabled: false, maxFrames: 20, timeoutMs: 10_000 },
              writer: input.writer,
              ...(input.deps.ocrWorkerFactory === undefined ? {} : { workerFactory: input.deps.ocrWorkerFactory }),
              signal: input.options.abortSignal
            })
          );
          ocrRecords.push(...denseOcrResult.records);
        }
      }
    }
    // Deterministic structured-data derivative over the captured HTML (best-effort,
    // never fails the run). Registers a structured_data artifact when the page
    // exposes JSON-LD / Open Graph, so structured facts become part of the bundle.
    try {
      const htmlRecord = capture.records.find((record) => record.evidence_kind === "page_html" && typeof record.path === "string");
      if (htmlRecord?.path !== undefined) {
        const html = await readFile(join(input.options.runDir, htmlRecord.path), "utf8");
        const structured = extractStructuredData(html);
        // Cross-check the site-claim typed facts against the page's visible text so
        // a JSON-LD price that disagrees with the rendered DOM is surfaced, not trusted.
        const textRecord = capture.records.find((record) => record.kind === "text" && record.evidence_kind === "page_text" && typeof record.path === "string");
        if (textRecord?.path !== undefined) {
          const visibleText = await readFile(join(input.options.runDir, textRecord.path), "utf8");
          const crossCheck = crossCheckStructured(structured, visibleText);
          if (crossCheck.length > 0) {
            structured.crossCheck = crossCheck;
          }
          // Typed facts (price/rating/percentage/date) from the visible text (engine #4), groundable.
          attachTypedFacts(structured, visibleText);
        }
        const hasStructured = structured.jsonLd.length > 0 || structured.hydration.length > 0 || Object.keys(structured.openGraph).length > 0 || structured.summary.name !== undefined || structured.tables.length > 0 || (structured.typedFacts?.length ?? 0) > 0;
        if (hasStructured) {
          await input.runStage("structured_extraction", () =>
            withAbort(
              input.writer.writeCaptureBundle({
                runDir: input.options.runDir,
                sourceUrl: input.options.url,
                contextToken: lease.contextToken,
                pageId: page.pageId,
                captureId: `${input.baseCaptureId}-structured`,
                text: JSON.stringify(structured),
                evidenceKind: "structured_data",
                captureMethod: "structured-extractor"
              }),
              input.options.abortSignal
            )
          );
        }
      }
    } catch {
      // structured extraction is best-effort; never fail the run for it
    }
    await pool.releaseContext(agentId, lease.contextToken).catch(() => undefined);
    released = true;
    return {
      blockedResourceCount: pool.blockedResourceCount(),
      pageCaptureRecords: capture.records,
      sourceNavigationCalibrationRecords,
      ...(sourceNavigationCalibrationReport === undefined ? {} : { sourceNavigationCalibrationReport }),
      sourceNavigationActionRecords,
      sourceNavigationFollowUpRecords,
      destinationCandidateRecords,
      destinationTriageRecords,
      destinationDeepeningProposalRecords,
      destinationDeepeningRunRecords,
      ...(sourceNavigationExecutionResult === undefined ? {} : { sourceNavigationExecutionResult }),
      ...(sourceNavigationFollowUpResult === undefined ? {} : { sourceNavigationFollowUpResult }),
      ...(frameResult === undefined ? {} : { frameResult }),
      frameFailureRecords,
      ocrRecords,
      overlayDismissal,
      overlayDismissalRecords,
      ...(frameError === undefined ? {} : { frameError })
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const pageCaptureRecords = await input.writer.recordFailure({
      runDir: input.options.runDir,
      sourceUrl: input.options.url,
      contextToken: `${input.baseCaptureId}-workflow`,
      pageId: "page-capture",
      captureId: `${input.baseCaptureId}-page-capture-failed`,
      error: message,
      status: "partial",
      metadata: { stage: "open_or_capture", error: message },
      captureMethod: "browser-agent-mcp-farm evidence-run capture",
      toolName: "evidence_run"
    });
    return {
      pageCaptureRecords,
      sourceNavigationCalibrationRecords,
      sourceNavigationActionRecords,
      sourceNavigationFollowUpRecords,
      destinationCandidateRecords,
      destinationTriageRecords,
      destinationDeepeningProposalRecords,
      destinationDeepeningRunRecords,
      frameFailureRecords,
      ocrRecords: [],
      overlayDismissal: failedOverlayDismissalReport("page capture did not reach overlay dismissal"),
      overlayDismissalRecords: [],
      frameError: message
    };
  } finally {
    if (leaseToken !== undefined && !released) {
      await pool.releaseContext(agentId, leaseToken).catch(() => undefined);
    }
    if (ownsPool) {
      await pool.shutdown();
    }
  }
}

// The byte-affecting capture profile for the cache key. EFFECTIVE wait/settle defaults are used (the
// same values the browser path applies) so a run with an explicit default does not false-miss a run
// that left it implicit. A bare ephemeral evidence run carries no fingerprint, so viewport/locale/
// timezone/userAgent stay unset (keyed as "default").
function captureCacheProfileFor(options: EvidenceWorkflowOptions, channel: string, browserVersion: string): CaptureCacheProfile {
  return {
    url: options.url,
    captureProfile: options.captureProfile ?? "full",
    launchArgsProfile: "default",
    resolvedChannel: channel,
    browserVersion,
    sampleFrames: options.sampleFrames !== false,
    waitMs: options.waitMs ?? 3_000,
    settleMs: options.settleMs ?? 500
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Replay a fresh prior capture by content hash instead of launching (C4). Returns undefined (a MISS)
// whenever anything is not perfectly safe to serve: no persisted engine identity, a changed Playwright
// version (the bundled Chromium build could differ), a non-cacheable key, no fresh entry, a missing
// source run dir, or a byte whose re-hash != the stored sha256 (tamper/drift). On a hit it re-registers
// the IDENTICAL bytes into this run (so the SHA-256 and the claim gate are unaffected) and re-derives
// the structured_data exactly as the browser/tier-0 path does.
export async function tryReplayCachedCapture(input: { cacheRoot: string; runDir: string; url: string; options: EvidenceWorkflowOptions; writer: ArtifactWriter; baseCaptureId: string; contextToken: string; signal?: AbortSignal }): Promise<{ records: ArtifactRecord[]; stalenessMs: number } | undefined> {
  throwIfAborted(input.signal);
  const identity = await readEngineIdentity(input.cacheRoot);
  if (identity === undefined) {
    return undefined;
  }
  const playwrightVersion = playwrightPackageVersion();
  if (playwrightVersion === undefined || playwrightVersion !== identity.playwrightVersion) {
    return undefined; // the installed engine could differ from the persisted one -> launch instead
  }
  const nowMs = Date.now();
  const key = computeCaptureCacheKey(captureCacheProfileFor(input.options, identity.channel, identity.browserVersion), { nowMs });
  if (key === null) {
    return undefined;
  }
  const entry = await lookupCachedCapture(input.cacheRoot, key, nowMs);
  if (entry === undefined || entry.runDirName === undefined) {
    return undefined;
  }
  let html: string | undefined;
  let text: string | undefined;
  let screenshot: Uint8Array | undefined;
  for (const artifact of entry.artifacts) {
    const abs = join(input.cacheRoot, entry.runDirName, artifact.relPath);
    if (!existsSync(abs)) {
      return undefined;
    }
    const bytes = await readFile(abs);
    if (sha256Hex(bytes) !== artifact.sha256) {
      return undefined; // tamper / drift -> never serve stale-or-altered bytes as evidence
    }
    if (artifact.evidenceKind === "page_html") {
      html = bytes.toString("utf8");
    } else if (artifact.evidenceKind === "page_text") {
      text = bytes.toString("utf8");
    } else if (artifact.evidenceKind === "page_screenshot") {
      screenshot = bytes;
    }
  }
  if (html === undefined) {
    return undefined; // need at least the page_html to reconstruct the page bundle
  }
  const stalenessMs = stalenessAgeMs(entry.capturedAtMs, nowMs);
  const pageInput: CaptureBundleInput = {
    runDir: input.runDir,
    sourceUrl: input.url,
    contextToken: input.contextToken,
    pageId: "cached-capture",
    captureId: `${input.baseCaptureId}-page-capture`,
    html,
    metadata: { captureTier: "cached_capture", replayedFromKey: key, stalenessMs },
    captureMethod: "cached-capture-replay"
  };
  if (text !== undefined) {
    pageInput.text = text;
  }
  if (screenshot !== undefined) {
    pageInput.screenshot = screenshot;
  }
  const records = [...(await input.writer.writeCaptureBundle(pageInput))];
  const structured = extractStructuredData(html);
  if (text !== undefined) {
    attachTypedFacts(structured, text);
  }
  const hasStructured = structured.jsonLd.length > 0 || structured.hydration.length > 0 || Object.keys(structured.openGraph).length > 0 || structured.summary.name !== undefined || structured.tables.length > 0 || (structured.typedFacts?.length ?? 0) > 0;
  if (hasStructured) {
    records.push(
      ...(await input.writer.writeCaptureBundle({
        runDir: input.runDir,
        sourceUrl: input.url,
        contextToken: input.contextToken,
        pageId: "cached-capture",
        captureId: `${input.baseCaptureId}-structured`,
        text: JSON.stringify(structured),
        evidenceKind: "structured_data",
        captureMethod: "cached-capture-replay-structured"
      }))
    );
  }
  return { records, stalenessMs };
}

// Persist this run's page bundle into the per-run-root cache + the engine identity (C4), so a later
// eligible run can replay it pre-launch. Best-effort, no-op unless the engine resolved and the
// Playwright version is readable and a page_html was captured.
export async function storeCaptureInCache(input: { cacheRoot: string; runDir: string; url: string; options: EvidenceWorkflowOptions; engine: { channel: string; browserVersion: string }; captureRecords: ArtifactRecord[] }): Promise<void> {
  if (!isEngineResolved(input.engine.browserVersion)) {
    return;
  }
  const playwrightVersion = playwrightPackageVersion();
  if (playwrightVersion === undefined) {
    return;
  }
  const nowMs = Date.now();
  const key = computeCaptureCacheKey(captureCacheProfileFor(input.options, input.engine.channel, input.engine.browserVersion), { nowMs });
  if (key === null) {
    return;
  }
  const artifacts: CachedCaptureArtifact[] = input.captureRecords
    .filter((record) => typeof record.path === "string" && (record.evidence_kind === "page_html" || record.evidence_kind === "page_text" || record.evidence_kind === "page_screenshot"))
    .map((record) => ({ relPath: record.path, sha256: record.sha256, evidenceKind: record.evidence_kind ?? "metadata" }));
  if (!artifacts.some((artifact) => artifact.evidenceKind === "page_html")) {
    return; // without the html there is nothing to faithfully replay
  }
  await writeEngineIdentity(input.cacheRoot, { channel: input.engine.channel, browserVersion: input.engine.browserVersion, playwrightVersion });
  await storeCachedCapture(input.cacheRoot, { key, url: input.url, capturedAtMs: nowMs, runDirName: basename(input.runDir), artifacts });
}

interface SourceNavigationFollowUpRunResult {
  summary: SourceNavigationFollowUpSummary;
  records: ArtifactRecord[];
  destinationTriage: DestinationTriageResult;
  destinationCandidateRecords: ArtifactRecord[];
  destinationTriageRecords: ArtifactRecord[];
  destinationDeepeningProposals: DestinationDeepeningProposal[];
  destinationDeepeningProposalRecords: ArtifactRecord[];
  destinationDeepeningExecution: DestinationDeepeningExecutionSummary;
  destinationDeepeningRunRecords: ArtifactRecord[];
}

async function runSourceNavigationFollowUps(input: {
  parent: {
    options: EvidenceWorkflowOptions;
    baseCaptureId: string;
    writer: ArtifactWriter;
    deps: EvidenceWorkflowDeps;
  };
  sourceNavigationPlan: SourceNavigationPlan;
  sourceNavigationActionRecords: ArtifactRecord[];
  requests: SourceNavigationFollowUpRequest[];
  leaseManager: LeaseManager;
  browserPool: BrowserPool;
}): Promise<SourceNavigationFollowUpRunResult> {
  throwIfAborted(input.parent.options.abortSignal);
  const maxFollowUps = input.parent.options.sourceNavigation?.maxFollowUps ?? 1;
  const maxFollowUpsPerDomain = input.parent.options.sourceNavigation?.maxFollowUpsPerDomain ?? Math.min(2, Math.max(0, maxFollowUps));
  const followUpConcurrency = normalizeSourceNavigationFollowUpConcurrency(input.parent.options.sourceNavigation?.followUpConcurrency, maxFollowUps);
  const fallbackFollowUps = input.parent.options.sourceNavigation?.fallbackFollowUps === true;
  const maxFallbackFollowUps = normalizeSourceNavigationMaxFallbackFollowUps(input.parent.options.sourceNavigation?.maxFallbackFollowUps, maxFollowUps);
  const maxDepth = normalizeSourceNavigationMaxDepth(input.parent.options.sourceNavigation?.maxDepth);
  const deepeningBudget = normalizeDestinationDeepeningBudget({
    sourceNavigation: input.parent.options.sourceNavigation,
    parentMaxFollowUps: maxFollowUps,
    parentMaxFollowUpsPerDomain: maxFollowUpsPerDomain,
    parentNavigationTimeoutMs: input.parent.options.navigationTimeoutMs
  });
  const initialTriage = buildDestinationTriage({
    parentUrl: input.parent.options.url,
    platform: input.sourceNavigationPlan.platform,
    sourceFamily: input.sourceNavigationPlan.sourceFamily,
    requests: input.requests,
    maxSelected: maxFollowUps,
    maxPerDomain: maxFollowUpsPerDomain,
    sourceArtifactIds: input.sourceNavigationActionRecords.map((record) => record.artifact_id)
  });
  const destinationCandidateRecords = await writeDestinationCandidateArtifact({
    writer: input.parent.writer,
    runDir: input.parent.options.runDir,
    parentUrl: input.parent.options.url,
    contextToken: `${input.parent.baseCaptureId}-workflow`,
    baseCaptureId: input.parent.baseCaptureId,
    triage: initialTriage,
    signal: input.parent.options.abortSignal
  });
  const selectedRequests = selectedDestinationRequests(initialTriage, input.requests);
  const records: ArtifactRecord[] = [];
  const followUpRunResults = await runSelectedSourceNavigationFollowUps({
    parent: input.parent,
    selectedRequests,
    followUpConcurrency,
    leaseManager: input.leaseManager,
    browserPool: input.browserPool
  });
  const results = followUpRunResults.map((run) => run.result);

  for (const run of followUpRunResults) {
    records.push(
      ...(await writeSourceNavigationFollowUpArtifact({
        parent: input.parent,
        request: run.request,
        index: run.index,
        result: run.result
      }))
    );
  }

  const firstPassTriage = buildDestinationTriage({
    parentUrl: input.parent.options.url,
    platform: input.sourceNavigationPlan.platform,
    sourceFamily: input.sourceNavigationPlan.sourceFamily,
    requests: input.requests,
    maxSelected: maxFollowUps,
    maxPerDomain: maxFollowUpsPerDomain,
    sourceArtifactIds: input.sourceNavigationActionRecords.map((record) => record.artifact_id),
    childResults: results
  });
  const fallbackRequests = fallbackFollowUps
    ? selectFallbackFollowUpRequests({
        requests: input.requests,
        selectedRequests,
        triage: firstPassTriage,
        maxFallbackFollowUps
      })
    : [];
  const fallbackRunResults = await runSelectedSourceNavigationFollowUps({
    parent: input.parent,
    selectedRequests: fallbackRequests,
    followUpConcurrency,
    startIndex: followUpRunResults.length,
    leaseManager: input.leaseManager,
    browserPool: input.browserPool
  });
  const allRunResults = [...followUpRunResults, ...fallbackRunResults];
  const allResults = allRunResults.map((run) => run.result);

  for (const run of fallbackRunResults) {
    records.push(
      ...(await writeSourceNavigationFollowUpArtifact({
        parent: input.parent,
        request: run.request,
        index: run.index,
        result: run.result
      }))
    );
  }

  const effectiveBudgets =
    fallbackRunResults.length === 0
      ? { maxFollowUps, maxFollowUpsPerDomain }
      : expandedFallbackBudgets({
          maxFollowUps,
          maxFollowUpsPerDomain,
          fallbackRunResults,
          firstPassTriage
        });
  const finalTriage =
    fallbackRunResults.length === 0
      ? firstPassTriage
      : buildDestinationTriage({
          parentUrl: input.parent.options.url,
          platform: input.sourceNavigationPlan.platform,
          sourceFamily: input.sourceNavigationPlan.sourceFamily,
          requests: input.requests,
          maxSelected: effectiveBudgets.maxFollowUps,
          maxPerDomain: effectiveBudgets.maxFollowUpsPerDomain,
          sourceArtifactIds: input.sourceNavigationActionRecords.map((record) => record.artifact_id),
          childResults: allResults
        });
  const destinationTriageRecords = await writeDestinationTriageArtifact({
    writer: input.parent.writer,
    runDir: input.parent.options.runDir,
    parentUrl: input.parent.options.url,
    contextToken: `${input.parent.baseCaptureId}-workflow`,
    baseCaptureId: input.parent.baseCaptureId,
    triage: finalTriage,
    records: finalTriage.candidateCount === 0 ? 0 : destinationCandidateRecords.length + 2,
    signal: input.parent.options.abortSignal
  });
  finalTriage.summary = summarizeDestinationTriageResult({
    selected: finalTriage.selected,
    rejected: finalTriage.rejected,
    candidateCount: finalTriage.candidateCount,
    maxSelected: finalTriage.maxSelected,
    maxPerDomain: finalTriage.maxPerDomain,
    records: destinationCandidateRecords.length + destinationTriageRecords.length
  });
  const destinationDeepeningProposals = buildDestinationDeepeningProposals({ triage: finalTriage, maxDepth });
  const destinationDeepeningProposalRecords = await writeDestinationDeepeningProposalArtifact({
    writer: input.parent.writer,
    runDir: input.parent.options.runDir,
    parentUrl: input.parent.options.url,
    contextToken: `${input.parent.baseCaptureId}-workflow`,
    baseCaptureId: input.parent.baseCaptureId,
    proposals: destinationDeepeningProposals,
    signal: input.parent.options.abortSignal
  });
  const destinationDeepeningExecutionResult = await runDestinationDeepeningExecutions({
    parent: input.parent,
    proposals: destinationDeepeningProposals,
    maxDepth,
    budget: deepeningBudget,
    leaseManager: input.leaseManager,
    browserPool: input.browserPool
  });
  if (destinationDeepeningExecutionResult.summary.status !== "not_requested" && destinationDeepeningExecutionResult.summary.status !== "not_enabled") {
    destinationDeepeningExecutionResult.summary.records = 2;
  }
  const destinationDeepeningRunRecords = await writeDestinationDeepeningRunArtifact({
    writer: input.parent.writer,
    runDir: input.parent.options.runDir,
    parentUrl: input.parent.options.url,
    contextToken: `${input.parent.baseCaptureId}-workflow`,
    baseCaptureId: input.parent.baseCaptureId,
    summary: destinationDeepeningExecutionResult.summary,
    signal: input.parent.options.abortSignal
  });
  destinationDeepeningExecutionResult.summary.records = destinationDeepeningRunRecords.length;

  return {
    summary: {
      requestedCount: input.requests.length,
      attemptedCount: allRunResults.length,
      completedCount: allResults.filter((result) => result.status === "ok").length,
      failedCount: allResults.filter((result) => result.status === "error").length,
      omittedCount: Math.max(0, input.requests.length - allRunResults.length),
      maxFollowUps,
      maxFollowUpsPerDomain,
      effectiveMaxFollowUps: effectiveBudgets.maxFollowUps,
      effectiveMaxFollowUpsPerDomain: effectiveBudgets.maxFollowUpsPerDomain,
      followUpConcurrency,
      fallbackFollowUps,
      maxFallbackFollowUps,
      fallbackAttemptedCount: fallbackRunResults.length,
      records: records.length,
      results: allResults
    },
    records,
    destinationTriage: finalTriage,
    destinationCandidateRecords,
    destinationTriageRecords,
    destinationDeepeningProposals,
    destinationDeepeningProposalRecords,
    destinationDeepeningExecution: destinationDeepeningExecutionResult.summary,
    destinationDeepeningRunRecords
  };
}

function selectFallbackFollowUpRequests(input: { requests: SourceNavigationFollowUpRequest[]; selectedRequests: SourceNavigationFollowUpRequest[]; triage: DestinationTriageResult; maxFallbackFollowUps: number }): SourceNavigationFollowUpRequest[] {
  if (input.maxFallbackFollowUps <= 0 || input.triage.summary.fallbackCandidates.length === 0) {
    return [];
  }
  const attempted = new Set(input.selectedRequests.map(sourceNavigationFollowUpRequestKey));
  const fallbackRequests: SourceNavigationFollowUpRequest[] = [];
  for (const candidate of input.triage.summary.fallbackCandidates) {
    const request = input.requests.find((item) => item.actionKey === candidate.actionKey && item.url === candidate.url && !attempted.has(sourceNavigationFollowUpRequestKey(item)));
    if (request === undefined) {
      continue;
    }
    fallbackRequests.push(request);
    attempted.add(sourceNavigationFollowUpRequestKey(request));
    if (fallbackRequests.length >= input.maxFallbackFollowUps) {
      break;
    }
  }
  return fallbackRequests;
}

function sourceNavigationFollowUpRequestKey(request: SourceNavigationFollowUpRequest): string {
  return `${request.actionKey}\n${request.url}`;
}

function expandedFallbackBudgets(input: { maxFollowUps: number; maxFollowUpsPerDomain: number; fallbackRunResults: SourceNavigationFollowUpChildRun[]; firstPassTriage: DestinationTriageResult }): { maxFollowUps: number; maxFollowUpsPerDomain: number } {
  const fallbackUrls = new Set(input.fallbackRunResults.map((run) => run.request.url));
  const attemptedFallbackCandidates = input.firstPassTriage.summary.fallbackCandidates.filter((candidate) => fallbackUrls.has(candidate.url));
  const topKBudgetCount = attemptedFallbackCandidates.filter((candidate) => candidate.budgetReason === "top_k_budget").length;
  const domainBudgetCount = attemptedFallbackCandidates.filter((candidate) => candidate.budgetReason === "domain_budget").length;
  return {
    maxFollowUps: Math.min(5, input.maxFollowUps + topKBudgetCount),
    maxFollowUpsPerDomain: Math.min(5, input.maxFollowUpsPerDomain + Math.max(domainBudgetCount, input.fallbackRunResults.length))
  };
}

interface SourceNavigationFollowUpChildRun {
  index: number;
  request: SourceNavigationFollowUpRequest;
  result: SourceNavigationFollowUpRunSummary;
}

async function runSelectedSourceNavigationFollowUps(input: {
  parent: {
    options: EvidenceWorkflowOptions;
    baseCaptureId: string;
    writer: ArtifactWriter;
    deps: EvidenceWorkflowDeps;
  };
  selectedRequests: SourceNavigationFollowUpRequest[];
  followUpConcurrency: number;
  startIndex?: number | undefined;
  leaseManager: LeaseManager;
  browserPool: BrowserPool;
}): Promise<SourceNavigationFollowUpChildRun[]> {
  if (input.selectedRequests.length === 0) {
    return [];
  }
  const concurrency = Math.max(1, Math.min(input.followUpConcurrency, input.selectedRequests.length));
  const startIndex = input.startIndex ?? 0;
  const runs: SourceNavigationFollowUpChildRun[] = [];
  for (let offset = 0; offset < input.selectedRequests.length; offset += concurrency) {
    throwIfAborted(input.parent.options.abortSignal);
    const batch = input.selectedRequests.slice(offset, offset + concurrency);
    const batchRuns = await Promise.all(
      batch.map((request, batchIndex) =>
        runSingleSourceNavigationFollowUp({
          parent: input.parent,
          request,
          index: startIndex + offset + batchIndex,
          leaseManager: input.leaseManager,
          browserPool: input.browserPool
        })
      )
    );
    runs.push(...batchRuns);
  }
  return runs;
}

async function runSingleSourceNavigationFollowUp(input: {
  parent: {
    options: EvidenceWorkflowOptions;
    baseCaptureId: string;
    writer: ArtifactWriter;
    deps: EvidenceWorkflowDeps;
  };
  request: SourceNavigationFollowUpRequest;
  index: number;
  leaseManager: LeaseManager;
  browserPool: BrowserPool;
}): Promise<SourceNavigationFollowUpChildRun> {
  throwIfAborted(input.parent.options.abortSignal);
  const childRunDir = followUpRunDir(input.parent.options.runDir, input.index, input.request);
  const captureId = input.request.captureId ?? `${input.parent.baseCaptureId}-followup-${input.index + 1}`;
  try {
    const childResult = await runEvidenceWorkflow(
      {
        url: input.request.url,
        runDir: childRunDir,
        captureId,
        frameSelector: input.parent.options.frameSelector,
        timestampsSec: input.parent.options.timestampsSec,
        maxFrames: input.parent.options.maxFrames,
        waitMs: input.parent.options.waitMs,
        navigationTimeoutMs: input.parent.options.navigationTimeoutMs,
        seekTimeoutMs: input.parent.options.seekTimeoutMs,
        settleMs: input.parent.options.settleMs,
        sampleFrames: input.parent.options.sampleFrames,
        finalClaimGate: input.parent.options.finalClaimGate,
        ...childEvidenceStorageOptions(input.parent.options),
        headed: input.parent.options.headed,
        browserChannel: input.parent.options.browserChannel,
        overlayDismissal: input.parent.options.overlayDismissal,
        ocr: input.parent.options.ocr,
        denseSampling: input.parent.options.denseSampling,
        officialApi: input.parent.options.officialApi,
        sourceNavigation: { enabled: false, actions: [], maxFollowUps: 0, maxFollowUpsPerDomain: 0, followUpConcurrency: 1 },
        abortSignal: input.parent.options.abortSignal
      },
      {
        leaseManager: input.leaseManager,
        browserPool: input.browserPool,
        artifactWriter: input.parent.writer,
        ...(input.parent.deps.ocrWorkerFactory === undefined ? {} : { ocrWorkerFactory: input.parent.deps.ocrWorkerFactory })
      }
    );
    const result: SourceNavigationFollowUpRunSummary = {
      actionKey: input.request.actionKey,
      url: input.request.url,
      status: childResult.ok ? "ok" : "error",
      runDir: childResult.runDir,
      reportPath: childResult.reportPath,
      childEvidence: await summarizeDestinationChildEvidence({
        parentUrl: input.parent.options.url,
        childResult,
        signal: input.parent.options.abortSignal
      }),
      ...(childResult.ok ? {} : { error: "child evidence run failed final claim gate" })
    };
    return { index: input.index, request: input.request, result };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      index: input.index,
      request: input.request,
      result: {
        actionKey: input.request.actionKey,
        url: input.request.url,
        status: "error",
        runDir: childRunDir,
        error: message
      }
    };
  }
}

async function runDestinationDeepeningExecutions(input: {
  parent: {
    options: EvidenceWorkflowOptions;
    baseCaptureId: string;
    writer: ArtifactWriter;
    deps: EvidenceWorkflowDeps;
  };
  proposals: DestinationDeepeningProposal[];
  maxDepth: number;
  budget: DestinationDeepeningBudget;
  leaseManager: LeaseManager;
  browserPool: BrowserPool;
}): Promise<{ summary: DestinationDeepeningExecutionSummary }> {
  const candidateCount = input.proposals.reduce((count, proposal) => count + proposal.candidates.length, 0);
  const baseSummary = {
    maxDepth: input.maxDepth,
    maxRuns: input.budget.maxRuns,
    maxPerDomain: input.budget.maxPerDomain,
    concurrency: input.budget.concurrency,
    timeoutMs: input.budget.timeoutMs,
    maxArtifacts: input.budget.maxArtifacts,
    proposalCount: input.proposals.length,
    candidateCount,
    attemptedCount: 0,
    completedCount: 0,
    failedCount: 0,
    omittedCount: candidateCount,
    usefulCount: 0,
    offTopicCount: 0,
    blockedCount: 0,
    budgetLimitedCount: 0,
    timeoutCount: 0,
    records: 0,
    results: [] as DestinationDeepeningExecutionResult[]
  };
  if (input.maxDepth <= 1) {
    return { summary: { ...baseSummary, status: "not_enabled" } };
  }
  if (input.proposals.length === 0 || candidateCount === 0) {
    return { summary: { ...baseSummary, status: "no_proposals", omittedCount: 0 } };
  }

  const selected = selectDestinationDeepeningExecutionCandidates({
    proposals: input.proposals,
    maxRuns: input.budget.maxRuns,
    maxPerDomain: input.budget.maxPerDomain
  });
  const parentQuery = destinationQueryFromUrl(input.parent.options.url);
  const results = await runSelectedDestinationDeepeningCandidates({
    parent: input.parent,
    selected,
    budget: input.budget,
    parentQuery,
    leaseManager: input.leaseManager,
    browserPool: input.browserPool
  });

  return {
    summary: buildDestinationDeepeningExecutionSummary({
      maxDepth: input.maxDepth,
      maxRuns: input.budget.maxRuns,
      maxPerDomain: input.budget.maxPerDomain,
      concurrency: input.budget.concurrency,
      timeoutMs: input.budget.timeoutMs,
      maxArtifacts: input.budget.maxArtifacts,
      proposalCount: input.proposals.length,
      candidateCount,
      selectedCount: selected.length,
      results
    })
  };
}

async function runSelectedDestinationDeepeningCandidates(input: {
  parent: {
    options: EvidenceWorkflowOptions;
    baseCaptureId: string;
    writer: ArtifactWriter;
    deps: EvidenceWorkflowDeps;
  };
  selected: SelectedDestinationDeepeningExecutionCandidate[];
  budget: DestinationDeepeningBudget;
  parentQuery?: string | undefined;
  leaseManager: LeaseManager;
  browserPool: BrowserPool;
}): Promise<DestinationDeepeningExecutionResult[]> {
  if (input.selected.length === 0) {
    return [];
  }
  const concurrency = Math.max(1, Math.min(input.budget.concurrency, input.selected.length));
  const results: DestinationDeepeningExecutionResult[] = [];
  for (let offset = 0; offset < input.selected.length; offset += concurrency) {
    throwIfAborted(input.parent.options.abortSignal);
    const batch = input.selected.slice(offset, offset + concurrency);
    results.push(
      ...(await Promise.all(
        batch.map((selectedCandidate, batchIndex) =>
          runSingleDestinationDeepeningCandidate({
            parent: input.parent,
            selectedCandidate,
            index: offset + batchIndex,
            budget: input.budget,
            parentQuery: input.parentQuery,
            leaseManager: input.leaseManager,
            browserPool: input.browserPool
          })
        )
      ))
    );
  }
  return results;
}

async function runSingleDestinationDeepeningCandidate(input: {
  parent: {
    options: EvidenceWorkflowOptions;
    baseCaptureId: string;
    writer: ArtifactWriter;
    deps: EvidenceWorkflowDeps;
  };
  selectedCandidate: SelectedDestinationDeepeningExecutionCandidate;
  index: number;
  budget: DestinationDeepeningBudget;
  parentQuery?: string | undefined;
  leaseManager: LeaseManager;
  browserPool: BrowserPool;
}): Promise<DestinationDeepeningExecutionResult> {
  throwIfAborted(input.parent.options.abortSignal);
  const { proposal, candidate, candidateIndex } = input.selectedCandidate;
  const childRunDir = deepeningRunDir(input.parent.options.runDir, input.index, candidate);
  const captureId = `${input.parent.baseCaptureId}-deepening-${input.index + 1}`;
  const childAbort = createTimedChildAbortSignal(input.parent.options.abortSignal, input.budget.timeoutMs, `depth-2 evidence run timed out after ${input.budget.timeoutMs}ms`);
  const startedAtMs = Date.now();
  try {
    const childResult = await runEvidenceWorkflow(
      {
        url: candidate.url,
        runDir: childRunDir,
        captureId,
        frameSelector: input.parent.options.frameSelector,
        timestampsSec: input.parent.options.timestampsSec,
        maxFrames: input.parent.options.maxFrames,
        waitMs: input.parent.options.waitMs,
        navigationTimeoutMs: input.budget.timeoutMs,
        seekTimeoutMs: input.parent.options.seekTimeoutMs,
        settleMs: input.parent.options.settleMs,
        sampleFrames: input.parent.options.sampleFrames,
        finalClaimGate: input.parent.options.finalClaimGate,
        ...childEvidenceStorageOptions(input.parent.options),
        headed: input.parent.options.headed,
        browserChannel: input.parent.options.browserChannel,
        overlayDismissal: input.parent.options.overlayDismissal,
        ocr: input.parent.options.ocr,
        denseSampling: input.parent.options.denseSampling,
        officialApi: input.parent.options.officialApi,
        sourceNavigation: { enabled: false, actions: [], maxFollowUps: 0, maxFollowUpsPerDomain: 0, maxDepth: 1 },
        abortSignal: childAbort.signal
      },
      {
        leaseManager: input.leaseManager,
        browserPool: input.browserPool,
        artifactWriter: input.parent.writer,
        ...(input.parent.deps.ocrWorkerFactory === undefined ? {} : { ocrWorkerFactory: input.parent.deps.ocrWorkerFactory })
      }
    );
    const childEvidence = await summarizeDestinationChildEvidence({
      parentUrl: proposal.childUrl,
      childResult,
      signal: childAbort.signal
    });
    const durationMs = Date.now() - startedAtMs;
    const artifactBudgetExceeded = childEvidence.artifactCount > input.budget.maxArtifacts;
    const query = input.parentQuery ?? destinationQueryFromUrl(proposal.childUrl);
    const status: "ok" | "error" = childResult.ok ? "ok" : "error";
    const resultForUsefulness = {
      actionKey: proposal.actionKey,
      url: candidate.url,
      status,
      childEvidence,
      ...(childResult.ok ? {} : { error: "depth-2 evidence run failed final claim gate" })
    };
    return {
      sourceCandidateId: proposal.sourceCandidateId,
      actionKey: proposal.actionKey,
      proposalReason: proposal.reason,
      candidateIndex,
      url: candidate.url,
      candidateKind: candidate.candidateKind,
      status,
      usefulness: artifactBudgetExceeded ? "budget_limited" : classifyDestinationChildUsefulness(resultForUsefulness, query),
      durationMs,
      timeoutMs: input.budget.timeoutMs,
      maxArtifacts: input.budget.maxArtifacts,
      artifactCount: childEvidence.artifactCount,
      artifactBudgetExceeded,
      runDir: childResult.runDir,
      reportPath: childResult.reportPath,
      childEvidence,
      ...(artifactBudgetExceeded ? { error: `depth-2 evidence run exceeded artifact budget of ${input.budget.maxArtifacts}` } : childResult.ok ? {} : { error: "depth-2 evidence run failed final claim gate" })
    };
  } catch (error) {
    if (isAbortError(error) && input.parent.options.abortSignal?.aborted) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = childAbort.timedOut();
    const errorResult = {
      actionKey: proposal.actionKey,
      url: candidate.url,
      status: "error" as const,
      error: message
    };
    const query = input.parentQuery ?? destinationQueryFromUrl(proposal.childUrl);
    return {
      sourceCandidateId: proposal.sourceCandidateId,
      actionKey: proposal.actionKey,
      proposalReason: proposal.reason,
      candidateIndex,
      url: candidate.url,
      candidateKind: candidate.candidateKind,
      status: "error",
      usefulness: timedOut ? "budget_limited" : classifyDestinationChildUsefulness(errorResult, query),
      durationMs: Date.now() - startedAtMs,
      timeoutMs: input.budget.timeoutMs,
      maxArtifacts: input.budget.maxArtifacts,
      ...(timedOut ? { timeoutExceeded: true } : {}),
      runDir: childRunDir,
      error: message
    };
  } finally {
    childAbort.cleanup();
  }
}

interface SelectedDestinationDeepeningExecutionCandidate {
  proposal: DestinationDeepeningProposal;
  candidate: DestinationDeepeningCandidate;
  candidateIndex: number;
}

interface DestinationDeepeningBudget {
  maxRuns: number;
  maxPerDomain: number;
  concurrency: number;
  timeoutMs: number;
  maxArtifacts: number;
}

function selectDestinationDeepeningExecutionCandidates(input: { proposals: DestinationDeepeningProposal[]; maxRuns: number; maxPerDomain: number }): SelectedDestinationDeepeningExecutionCandidate[] {
  const maxRuns = Math.max(0, Math.min(5, Math.trunc(input.maxRuns)));
  const maxPerDomain = Math.max(0, Math.min(5, Math.trunc(input.maxPerDomain)));
  const selected: SelectedDestinationDeepeningExecutionCandidate[] = [];
  const seen = new Set<string>();
  const perDomainCounts = new Map<string, number>();
  for (const proposal of input.proposals) {
    for (const [candidateIndex, candidate] of proposal.candidates.entries()) {
      if (selected.length >= maxRuns) {
        return selected;
      }
      if (seen.has(candidate.normalizedUrl)) {
        continue;
      }
      const domainCount = perDomainCounts.get(candidate.domain) ?? 0;
      if (domainCount >= maxPerDomain) {
        continue;
      }
      seen.add(candidate.normalizedUrl);
      perDomainCounts.set(candidate.domain, domainCount + 1);
      selected.push({ proposal, candidate, candidateIndex });
    }
  }
  return selected;
}

function buildDestinationDeepeningExecutionSummary(input: {
  maxDepth: number;
  maxRuns: number;
  maxPerDomain: number;
  concurrency: number;
  timeoutMs: number;
  maxArtifacts: number;
  proposalCount: number;
  candidateCount: number;
  selectedCount: number;
  results: DestinationDeepeningExecutionResult[];
}): DestinationDeepeningExecutionSummary {
  const failedCount = input.results.filter((result) => result.status === "error").length;
  const usefulCount = input.results.filter((result) => result.usefulness === "useful").length;
  const offTopicCount = input.results.filter((result) => result.usefulness === "off_topic").length;
  const blockedCount = input.results.filter((result) => ["blocked", "paywalled", "private"].includes(result.usefulness)).length;
  const budgetLimitedCount = input.results.filter((result) => result.usefulness === "budget_limited" || result.artifactBudgetExceeded === true).length;
  const timeoutCount = input.results.filter((result) => result.timeoutExceeded === true).length;
  const omittedCount = Math.max(0, input.candidateCount - input.selectedCount);
  const status = failedCount > 0 || omittedCount > 0 || usefulCount < input.results.length || budgetLimitedCount > 0 || timeoutCount > 0 ? "partial" : "ok";
  return {
    status,
    maxDepth: input.maxDepth,
    maxRuns: input.maxRuns,
    maxPerDomain: input.maxPerDomain,
    concurrency: input.concurrency,
    timeoutMs: input.timeoutMs,
    maxArtifacts: input.maxArtifacts,
    proposalCount: input.proposalCount,
    candidateCount: input.candidateCount,
    attemptedCount: input.results.length,
    completedCount: input.results.filter((result) => result.status === "ok").length,
    failedCount,
    omittedCount,
    usefulCount,
    offTopicCount,
    blockedCount,
    budgetLimitedCount,
    timeoutCount,
    records: 0,
    results: input.results
  };
}

async function writeSourceNavigationFollowUpArtifact(input: {
  parent: {
    options: EvidenceWorkflowOptions;
    baseCaptureId: string;
    writer: ArtifactWriter;
  };
  request: SourceNavigationFollowUpRequest;
  index: number;
  result: SourceNavigationFollowUpRunSummary;
}): Promise<ArtifactRecord[]> {
  const metadata = {
    schemaVersion: "1.0",
    request: input.request,
    result: input.result
  };
  return input.parent.writer.writeCaptureBundle({
    runDir: input.parent.options.runDir,
    sourceUrl: input.request.url,
    contextToken: `${input.parent.baseCaptureId}-workflow`,
    pageId: "source-navigation-followup",
    captureId: `${input.parent.baseCaptureId}-source-navigation-followup-${input.index + 1}`,
    status: input.result.status === "ok" ? "ok" : "error",
    metadata: { sourceNavigationFollowUp: metadata },
    text: JSON.stringify(metadata, null, 2),
    captureMethod: "browser-agent-mcp-farm source-navigation-followup",
    toolName: "source_navigation_followup",
    evidenceKind: "source_navigation_followup",
    note: `source navigation follow-up ${input.result.status}: ${input.request.actionKey}`
  });
}

function followUpRunDir(parentRunDir: string, index: number, request: SourceNavigationFollowUpRequest): string {
  let hostname = "unknown-host";
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    // Keep the parent run usable even if a malformed request somehow reaches this layer.
  }
  return join(parentRunDir, "followups", sanitizeFileBase(`${index + 1}-${request.actionKey}-${hostname}`));
}

function childEvidenceStorageOptions(parentOptions: EvidenceWorkflowOptions): Pick<EvidenceWorkflowOptions, "profileName" | "storagePolicy"> {
  if (parentOptions.profileName !== undefined || parentOptions.storagePolicy === "storage-state" || parentOptions.storagePolicy === "persistent-profile") {
    // Child evidence runs execute before the parent context is released, so they
    // cannot safely acquire the same saved profile or storage-state lock.
    return { storagePolicy: "ephemeral" };
  }
  return parentOptions.storagePolicy === undefined ? {} : { storagePolicy: parentOptions.storagePolicy };
}

function deepeningRunDir(parentRunDir: string, index: number, candidate: DestinationDeepeningCandidate): string {
  const hostname = candidate.domain || "unknown-host";
  return join(parentRunDir, "followups", "deepening", sanitizeFileBase(`${index + 1}-${candidate.candidateKind}-${hostname}`));
}

function normalizeSourceNavigationMaxDepth(value: number | undefined): number {
  return Math.max(1, Math.min(2, Math.trunc(value ?? 1)));
}

function normalizeSourceNavigationFollowUpConcurrency(value: number | undefined, maxFollowUps: number): number {
  if (maxFollowUps <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(5, maxFollowUps, Math.trunc(value ?? 1)));
}

function normalizeSourceNavigationMaxFallbackFollowUps(value: number | undefined, maxFollowUps: number): number {
  if (maxFollowUps <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(5, Math.trunc(value ?? 1)));
}

function normalizeDestinationDeepeningBudget(input: { sourceNavigation: EvidenceWorkflowOptions["sourceNavigation"]; parentMaxFollowUps: number; parentMaxFollowUpsPerDomain: number; parentNavigationTimeoutMs?: number | undefined }): DestinationDeepeningBudget {
  const maxRuns = Math.max(0, Math.min(5, Math.trunc(input.sourceNavigation?.maxDeepeningRuns ?? Math.min(1, Math.max(0, input.parentMaxFollowUps)))));
  const maxPerDomain = Math.max(0, Math.min(5, Math.trunc(input.sourceNavigation?.maxDeepeningRunsPerDomain ?? Math.min(1, maxRuns, Math.max(0, input.parentMaxFollowUpsPerDomain)))));
  const concurrency = maxRuns <= 0 ? 0 : Math.max(1, Math.min(5, maxRuns, Math.trunc(input.sourceNavigation?.deepeningConcurrency ?? 1)));
  const parentTimeoutMs = input.parentNavigationTimeoutMs ?? 30_000;
  const timeoutMs = Math.max(1, Math.min(120_000, Math.trunc(input.sourceNavigation?.deepeningTimeoutMs ?? Math.min(parentTimeoutMs, 15_000))));
  const maxArtifacts = Math.max(1, Math.min(1_000, Math.trunc(input.sourceNavigation?.maxDeepeningArtifacts ?? 100)));
  return { maxRuns, maxPerDomain, concurrency, timeoutMs, maxArtifacts };
}

function createTimedChildAbortSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  reason: string
): {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timeoutExceeded = false;
  const timeout = setTimeout(() => {
    timeoutExceeded = true;
    controller.abort(reason);
  }, timeoutMs);
  let removeParentListener: (() => void) | undefined;
  if (parentSignal !== undefined) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      const listener = () => controller.abort(parentSignal.reason);
      parentSignal.addEventListener("abort", listener, { once: true });
      removeParentListener = () => parentSignal.removeEventListener("abort", listener);
    }
  }
  return {
    signal: controller.signal,
    timedOut: () => timeoutExceeded,
    cleanup: () => {
      clearTimeout(timeout);
      removeParentListener?.();
    }
  };
}

async function summarizeDestinationChildEvidence(input: { parentUrl: string; childResult: EvidenceWorkflowResult; signal?: AbortSignal | undefined }): Promise<DestinationChildEvidenceSummary> {
  const captureText = await pageCaptureTextFromRecords(input.childResult.runDir, input.childResult.pageCaptureRecords, input.signal);
  const text = normalizeEvidenceText(captureText.text);
  const browserCaptureOkRecords = input.childResult.pageCaptureRecords.filter(isSuccessfulPageCaptureRecord);
  const browserCaptureFailedRecords = input.childResult.pageCaptureRecords.filter(isFailedPageCaptureRecord);
  const query = destinationQueryFromUrl(input.parentUrl) ?? destinationQueryFromUrl(input.childResult.url);
  const matchedQueryTokens = query === undefined ? [] : matchingTextTokens(query, `${captureText.title ?? ""} ${captureText.finalUrl ?? ""} ${text}`);
  const queryScriptFamilies = query === undefined ? [] : detectedTextScriptFamilies(query);
  const evidenceScriptFamilies = detectedTextScriptFamilies(`${captureText.title ?? ""} ${text}`);
  const queryEvidenceScriptMismatch = query !== undefined && matchedQueryTokens.length === 0 && hasDominantTextScriptMismatch(query, `${captureText.title ?? ""} ${text}`);
  const deeperCandidates = buildDestinationDeepeningCandidates({
    childUrl: captureText.finalUrl ?? input.childResult.url,
    links: captureText.visibleLinks ?? [],
    query,
    maxCandidates: 5
  });
  const evidenceSignals = destinationChildEvidenceSignals({
    childResult: input.childResult,
    browserCaptureOkRecords: browserCaptureOkRecords.length,
    browserCaptureFailedRecords: browserCaptureFailedRecords.length,
    pageTextLength: text.length,
    matchedQueryTokens,
    deeperCandidateCount: deeperCandidates.length
  });
  const evidenceWarnings = destinationChildEvidenceWarnings({
    childResult: input.childResult,
    browserCaptureOkRecords: browserCaptureOkRecords.length,
    browserCaptureFailedRecords: browserCaptureFailedRecords.length,
    pageTextLength: text.length,
    query,
    matchedQueryTokens,
    queryEvidenceScriptMismatch
  });
  const summary: DestinationChildEvidenceSummary = {
    artifactCount: evidenceRunArtifactCount(input.childResult),
    claimCount: input.childResult.claims.length,
    browserCaptureRecords: browserCaptureOkRecords.length,
    ...(browserCaptureFailedRecords.length === 0 ? {} : { browserCaptureFailedRecords: browserCaptureFailedRecords.length }),
    obstructionCount: input.childResult.obstructionRecords.length,
    pageTextLength: text.length,
    queryOverlapTokenCount: matchedQueryTokens.length,
    matchedQueryTokens,
    ...(queryScriptFamilies.length === 0 ? {} : { queryScriptFamilies }),
    ...(evidenceScriptFamilies.length === 0 ? {} : { evidenceScriptFamilies }),
    ...(queryEvidenceScriptMismatch ? { queryEvidenceScriptMismatch: true } : {}),
    deeperCandidateCount: deeperCandidates.length,
    ...(deeperCandidates.length === 0 ? {} : { deeperCandidates }),
    evidenceSignals,
    evidenceWarnings
  };
  if (captureText.title !== undefined) {
    summary.title = captureText.title;
  }
  if (captureText.finalUrl !== undefined) {
    summary.finalUrl = captureText.finalUrl;
  }
  const snippet = text.slice(0, 500);
  if (snippet.length > 0) {
    summary.textSnippet = snippet;
  }
  return summary;
}

function isSuccessfulPageCaptureRecord(record: ArtifactRecord): boolean {
  return record.status === "ok";
}

function isFailedPageCaptureRecord(record: ArtifactRecord): boolean {
  return record.status !== "ok";
}

function evidenceRunArtifactCount(result: EvidenceWorkflowResult): number {
  return [
    result.capabilityRecords,
    result.sourceStrategyRecords,
    result.sourceRegistryRecords,
    result.sourceNavigationPlanRecords,
    result.sourceNavigationExecutionPlanRecords,
    result.sourceNavigationRecipePlanRecords,
    result.sourceNavigationCalibrationRecords,
    result.sourceNavigationActionRecords,
    result.sourceNavigationFollowUpRecords,
    result.destinationCandidateRecords,
    result.destinationTriageRecords,
    result.destinationDeepeningProposalRecords,
    result.destinationDeepeningRunRecords,
    result.pageCaptureRecords,
    result.frameRecords,
    result.ocrRecords,
    result.officialApiRecords,
    result.overlayDismissalRecords,
    result.obstructionRecords,
    result.assessmentRecords
  ].reduce((count, records) => count + records.length, 0);
}

function destinationChildEvidenceSignals(input: { childResult: EvidenceWorkflowResult; browserCaptureOkRecords: number; browserCaptureFailedRecords: number; pageTextLength: number; matchedQueryTokens: string[]; deeperCandidateCount: number }): string[] {
  const signals: string[] = [];
  if (input.childResult.ok) {
    signals.push("claim_gate_ok");
  }
  if (input.browserCaptureOkRecords > 0) {
    signals.push("browser_capture");
  }
  if (input.browserCaptureFailedRecords > 0) {
    signals.push("browser_capture_failed");
  }
  if (input.pageTextLength > 0) {
    signals.push("visible_text");
  }
  if (input.childResult.claims.length > 0) {
    signals.push("claims_registered");
  }
  if (input.childResult.obstructionRecords.length > 0) {
    signals.push("browser_obstruction");
  }
  if (input.matchedQueryTokens.length > 0) {
    signals.push("query_overlap");
  }
  if (input.childResult.ocrRecords.some((record) => record.evidence_kind === "ocr_text" && record.status === "ok")) {
    signals.push("ocr_evidence");
  }
  if (input.childResult.pageCaptureRecords.some((record) => record.evidence_kind === "transcript_cue" && record.status === "ok")) {
    signals.push("transcript_evidence");
  }
  if (input.deeperCandidateCount > 0) {
    signals.push("deeper_candidates_visible");
  }
  return signals;
}

function destinationChildEvidenceWarnings(input: { childResult: EvidenceWorkflowResult; browserCaptureOkRecords: number; browserCaptureFailedRecords: number; pageTextLength: number; query?: string | undefined; matchedQueryTokens: string[]; queryEvidenceScriptMismatch: boolean }): string[] {
  const warnings: string[] = [];
  if (!input.childResult.ok) {
    warnings.push("claim_gate_failed");
  }
  if (input.browserCaptureOkRecords === 0) {
    warnings.push("missing_browser_capture");
  }
  if (input.browserCaptureFailedRecords > 0) {
    warnings.push("failed_browser_capture");
  }
  if (input.pageTextLength === 0) {
    warnings.push("empty_visible_text");
  }
  if (input.childResult.claims.length === 0) {
    warnings.push("missing_claims");
  }
  if (input.childResult.obstructionRecords.length > 0) {
    warnings.push("browser_obstruction_detected");
  }
  if (input.query !== undefined && input.matchedQueryTokens.length === 0) {
    warnings.push("no_query_overlap");
    if (input.queryEvidenceScriptMismatch) {
      warnings.push("query_script_mismatch_possible");
    }
  }
  return warnings;
}

async function writeOverlayDismissalArtifact(input: { runDir: string; sourceUrl: string; contextToken: string; pageId: string; baseCaptureId: string; report: BrowserOverlayDismissalReport; writer: ArtifactWriter; signal?: AbortSignal | undefined }): Promise<ArtifactRecord[]> {
  if (input.report.status === "clear" && input.report.warnings.length === 0) {
    return [];
  }
  return withAbort(
    input.writer.writeCaptureBundle({
      runDir: input.runDir,
      sourceUrl: input.sourceUrl,
      contextToken: input.contextToken,
      pageId: input.pageId,
      captureId: `${input.baseCaptureId}-browser-overlay-dismissal`,
      status: input.report.status === "dismissed" ? "ok" : "partial",
      metadata: { browserOverlayDismissal: input.report },
      text: JSON.stringify(input.report, null, 2),
      captureMethod: "browser-agent-mcp-farm browser-overlay-dismissal",
      toolName: "evidence_run_overlay_dismissal",
      evidenceKind: "browser_overlay_dismissal",
      note: `browser overlay dismissal: ${input.report.status}, dismissed=${input.report.dismissedCount}, skipped=${input.report.skippedCount}`
    }),
    input.signal
  );
}

function failedOverlayDismissalReport(reason: string): BrowserOverlayDismissalReport {
  return {
    status: "partial",
    dismissedCount: 0,
    skippedCount: 0,
    actions: [
      {
        kind: "generic_overlay",
        label: "browser_overlay_dismissal",
        status: "error",
        reason
      }
    ],
    warnings: [`overlay_dismissal_failed:${reason}`]
  };
}

function skippedOverlayDismissalReport(reason: string): BrowserOverlayDismissalReport {
  return {
    status: "skipped",
    dismissedCount: 0,
    skippedCount: 0,
    actions: [],
    warnings: [`overlay_dismissal_skipped:${reason}`]
  };
}

async function classifyBrowserObstructionArtifacts(input: {
  runDir: string;
  sourceUrl: string;
  baseCaptureId: string;
  platformCapabilities: PlatformCapabilityMap;
  pageCaptureRecords: ArtifactRecord[];
  contextToken: string;
  pageId: string;
  writer: ArtifactWriter;
  signal?: AbortSignal | undefined;
}): Promise<{ report: BrowserObstructionReport; records: ArtifactRecord[] }> {
  const captureText = await pageCaptureTextFromRecords(input.runDir, input.pageCaptureRecords, input.signal);
  const report = classifyBrowserObstructions({
    platform: input.platformCapabilities.platform,
    url: input.sourceUrl,
    ...(captureText.finalUrl === undefined ? {} : { finalUrl: captureText.finalUrl }),
    ...(captureText.title === undefined ? {} : { title: captureText.title }),
    ...(captureText.text === undefined ? {} : { text: captureText.text }),
    ...(captureText.html === undefined ? {} : { html: captureText.html })
  });

  if (report.status === "clear") {
    return { report, records: [] };
  }

  const records = await input.writer.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: input.sourceUrl,
    contextToken: input.contextToken,
    pageId: input.pageId,
    captureId: `${input.baseCaptureId}-browser-obstructions`,
    status: "partial",
    metadata: { browserObstructions: report },
    text: JSON.stringify(report, null, 2),
    captureMethod: "browser-agent-mcp-farm browser-obstruction-classifier",
    toolName: "evidence_run_obstruction_classifier",
    evidenceKind: "browser_obstruction",
    note: `browser obstruction detected: ${report.detections.map((detection) => detection.kind).join(",")}`
  });
  return { report, records };
}

async function pageCaptureTextFromRecords(runDir: string, records: ArtifactRecord[], signal: AbortSignal | undefined): Promise<{ text?: string; html?: string; finalUrl?: string; title?: string; visibleLinks?: DestinationVisibleLink[] }> {
  let text: string | undefined;
  let html: string | undefined;
  let finalUrl: string | undefined;
  let title: string | undefined;
  let visibleLinks: DestinationVisibleLink[] | undefined;

  for (const record of records) {
    if (record.kind === "text" && text === undefined) {
      text = await readOptionalText(join(runDir, record.path), signal);
      continue;
    }
    if (record.kind === "html" && html === undefined) {
      html = await readOptionalText(join(runDir, record.path), signal);
      continue;
    }
    if (record.kind !== "structured" || !record.path.endsWith(".metadata.json")) {
      continue;
    }
    const rawMetadata = await readOptionalText(join(runDir, record.path), signal);
    if (rawMetadata === undefined) {
      continue;
    }
    const metadata = parsePageCaptureMetadata(rawMetadata);
    if (metadata?.finalUrl !== undefined && finalUrl === undefined) {
      finalUrl = metadata.finalUrl;
    }
    if (metadata?.title !== undefined && title === undefined) {
      title = metadata.title;
    }
    if (metadata?.visibleLinks !== undefined && visibleLinks === undefined) {
      visibleLinks = metadata.visibleLinks;
    }
  }

  return {
    ...(text === undefined ? {} : { text }),
    ...(html === undefined ? {} : { html }),
    ...(finalUrl === undefined ? {} : { finalUrl }),
    ...(title === undefined ? {} : { title }),
    ...(visibleLinks === undefined ? {} : { visibleLinks })
  };
}

function parsePageCaptureMetadata(raw: string): { finalUrl?: string; title?: string; visibleLinks?: DestinationVisibleLink[] } | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const record = parsed as { finalUrl?: unknown; title?: unknown; visibleLinks?: unknown };
    return {
      ...(typeof record.finalUrl === "string" ? { finalUrl: record.finalUrl } : {}),
      ...(typeof record.title === "string" ? { title: record.title } : {}),
      ...(Array.isArray(record.visibleLinks) ? { visibleLinks: parseVisibleLinks(record.visibleLinks) } : {})
    };
  } catch {
    return undefined;
  }
}

function parseVisibleLinks(values: unknown[]): DestinationVisibleLink[] {
  return values.flatMap((value, fallbackIndex): DestinationVisibleLink[] => {
    if (typeof value !== "object" || value === null) {
      return [];
    }
    const record = value as { index?: unknown; url?: unknown; text?: unknown };
    if (typeof record.url !== "string" || record.url.length === 0) {
      return [];
    }
    return [
      {
        index: typeof record.index === "number" && Number.isFinite(record.index) ? record.index : fallbackIndex,
        url: record.url,
        text: typeof record.text === "string" ? record.text : ""
      }
    ];
  });
}

function collectDenseHitTimestamps(frameResult: FrameSampleRunResult, query: string | undefined): number[] {
  const normalizedQuery = query?.toLowerCase();
  const hits: number[] = [];
  for (const frame of frameResult.frames) {
    for (const cue of frame.activeCues) {
      if (normalizedQuery !== undefined && !cue.text.toLowerCase().includes(normalizedQuery)) {
        continue;
      }
      hits.push(cue.startTime);
    }
  }
  return hits;
}

async function collectOcrHitTimestamps(runDir: string, ocrRecords: ArtifactRecord[], query: string | undefined, signal: AbortSignal | undefined): Promise<number[]> {
  const textByCaptureBase = new Map<string, string>();
  for (const record of ocrRecords) {
    if (record.kind !== "text" || record.evidence_kind !== "ocr_text" || record.status !== "ok") {
      continue;
    }
    const captureBase = ocrCaptureBase(record.path);
    if (captureBase === undefined) {
      continue;
    }
    textByCaptureBase.set(captureBase, (await readOptionalText(join(runDir, record.path), signal)) ?? "");
  }

  const hits = new Set<number>();
  for (const record of ocrRecords) {
    if (record.kind !== "structured" || record.evidence_kind !== "ocr_text" || record.status !== "ok") {
      continue;
    }
    const rawMetadata = await readOptionalText(join(runDir, record.path), signal);
    if (rawMetadata === undefined) {
      continue;
    }
    const metadata = parseOcrMetadata(rawMetadata);
    if (metadata?.status !== "ok" || metadata.timestampSec === undefined) {
      continue;
    }
    if (query !== undefined) {
      const captureBase = ocrCaptureBase(record.path);
      const text = captureBase === undefined ? undefined : textByCaptureBase.get(captureBase);
      if (text === undefined || !text.toLowerCase().includes(query.toLowerCase())) {
        continue;
      }
    }
    hits.add(metadata.timestampSec);
  }
  return [...hits].sort((left, right) => left - right);
}

async function readOptionalText(path: string, signal: AbortSignal | undefined): Promise<string | undefined> {
  try {
    return await withAbort(readFile(path, "utf8"), signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return undefined;
  }
}

function mergeFrameSampleResults(
  base: FrameSampleRunResult,
  additional: FrameSampleRunResult,
  densePlan: DenseTimestampPlan,
  label: string,
  eventInput?:
    | {
        source: DenseSamplingSource;
        hitTimestampsSec: number[];
        sceneChangeHits?: SceneChangeHit[] | undefined;
        sceneChangeDiagnostics?: SceneChangeDetectionDiagnostics | undefined;
      }
    | undefined
): FrameSampleRunResult {
  const denseEvent = eventInput === undefined ? undefined : buildDenseSamplingEvent(eventInput, densePlan, additional);
  const sceneChangeHits = eventInput?.sceneChangeHits ?? [];
  const sceneChangeDiagnostics = [...(base.sceneChangeDiagnostics ?? []), ...(additional.sceneChangeDiagnostics ?? [])];
  return {
    ...base,
    ok: base.ok && additional.ok,
    status: base.status === "ok" && additional.status === "ok" ? "ok" : "partial",
    plan: {
      ...base.plan,
      timestampsSec: densePlan.timestampsSec,
      maxFrames: Math.max(base.plan.maxFrames, densePlan.timestampsSec.length),
      capped: base.plan.capped || densePlan.capped,
      omittedCount: base.plan.omittedCount + densePlan.omittedCount
    },
    frames: [...base.frames, ...additional.frames].sort((left, right) => left.timestampSec - right.timestampSec),
    records: [...base.records, ...additional.records],
    warnings: [...base.warnings, ...additional.warnings, ...sceneChangeHits.map((hit) => `scene_change:${hit.fromTimestampSec}-${hit.toTimestampSec}:distance=${hit.distance}`), ...(densePlan.capped ? [`${label} omitted ${densePlan.omittedCount} planned frames due to maxDenseFrames.`] : [])],
    denseSamplingEvents: [...(base.denseSamplingEvents ?? []), ...(additional.denseSamplingEvents ?? []), ...(denseEvent === undefined ? [] : [denseEvent])],
    ...(sceneChangeDiagnostics.length === 0 ? {} : { sceneChangeDiagnostics })
  };
}

function buildDenseSamplingEvent(
  input: {
    source: DenseSamplingSource;
    hitTimestampsSec: number[];
    sceneChangeHits?: SceneChangeHit[] | undefined;
    sceneChangeDiagnostics?: SceneChangeDetectionDiagnostics | undefined;
  },
  densePlan: DenseTimestampPlan,
  additional: FrameSampleRunResult
): DenseSamplingEvent {
  const event: DenseSamplingEvent = {
    source: input.source,
    hitTimestampsSec: normalizeTimestampValues(input.hitTimestampsSec),
    plannedTimestampsSec: densePlan.denseTimestampsSec,
    capturedTimestampsSec: normalizeTimestampValues(additional.frames.map((frame) => frame.timestampSec)),
    capped: densePlan.capped,
    omittedCount: densePlan.omittedCount
  };
  if (input.sceneChangeHits !== undefined) {
    event.sceneChangeHits = input.sceneChangeHits;
  }
  if (input.sceneChangeDiagnostics !== undefined) {
    event.sceneChangeDiagnostics = input.sceneChangeDiagnostics;
  }
  return event;
}

function appendSceneChangeDiagnostics(frameResult: FrameSampleRunResult, diagnostics: SceneChangeDetectionDiagnostics): FrameSampleRunResult {
  return {
    ...frameResult,
    sceneChangeDiagnostics: [...(frameResult.sceneChangeDiagnostics ?? []), diagnostics]
  };
}

function frameRecordsForOcr(frameResult: FrameSampleRunResult | undefined, frameFailureRecords: ArtifactRecord[]): ArtifactRecord[] {
  return frameResult?.frames.flatMap((frame) => frame.records) ?? frameFailureRecords;
}

function uncapturedDenseTimestamps(frameResult: FrameSampleRunResult, timestampsSec: number[]): number[] {
  const captured = new Set(frameResult.frames.map((frame) => normalizeTimestampKey(frame.timestampSec)));
  return timestampsSec.filter((timestampSec) => !captured.has(normalizeTimestampKey(timestampSec)));
}

function normalizeTimestampValues(timestampsSec: number[]): number[] {
  return [...new Set(timestampsSec.filter((timestampSec) => Number.isFinite(timestampSec) && timestampSec >= 0).map((timestampSec) => Math.round(timestampSec * 1000) / 1000))].sort((left, right) => left - right);
}

function normalizeTimestampKey(timestampSec: number): string {
  return (Math.round(timestampSec * 1000) / 1000).toFixed(3);
}

function parseOcrMetadata(raw: string): { status: string; timestampSec?: number } | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const ocr = (parsed as { ocr?: unknown }).ocr;
    if (typeof ocr !== "object" || ocr === null) {
      return undefined;
    }
    const record = ocr as { status?: unknown; timestampSec?: unknown };
    if (typeof record.status !== "string") {
      return undefined;
    }
    const result: { status: string; timestampSec?: number } = { status: record.status };
    if (typeof record.timestampSec === "number" && Number.isFinite(record.timestampSec)) {
      result.timestampSec = record.timestampSec;
    }
    return result;
  } catch {
    return undefined;
  }
}

function ocrCaptureBase(path: string): string | undefined {
  if (path.startsWith("structured/") && path.endsWith(".metadata.json")) {
    return path.slice("structured/".length, -".metadata.json".length);
  }
  if (path.startsWith("raw/") && path.endsWith(".txt")) {
    return path.slice("raw/".length, -".txt".length);
  }
  return undefined;
}

function summarizeFrameSampling(frameResult: FrameSampleRunResult | undefined, frameError: string | undefined, skipped: boolean): FrameSamplingAssessment {
  if (skipped) {
    return { status: "skipped", reason: "sampleFrames disabled for this run" };
  }
  if (frameResult === undefined) {
    return {
      status: "partial",
      reason: "frame sampling did not produce timestamped screenshots",
      ...(frameError === undefined ? {} : { error: frameError })
    };
  }
  const denseSamplingEvents = frameResult.denseSamplingEvents ?? [];
  const sceneChangeDiagnostics = frameResult.sceneChangeDiagnostics ?? [];
  return {
    status: frameResult.status,
    timestampsSec: frameResult.plan.timestampsSec,
    frames: frameResult.frames.map((frame) => ({
      timestampSec: frame.timestampSec,
      status: frame.status,
      seek: frame.seek
    })),
    ...(sceneChangeDiagnostics.length === 0 ? {} : { sceneChangeDiagnostics }),
    ...(denseSamplingEvents.length === 0
      ? {}
      : {
          denseSampling: {
            totalEvents: denseSamplingEvents.length,
            capturedTimestampsSec: normalizeTimestampValues(denseSamplingEvents.flatMap((event) => event.capturedTimestampsSec)),
            events: denseSamplingEvents
          }
        })
  };
}

function summarizeSourceNavigationPlan(plan: SourceNavigationPlan): SourceNavigationPlanSummary {
  return {
    mode: plan.mode,
    platform: plan.platform,
    sourceFamily: plan.sourceFamily,
    actionCount: plan.plannedActions.length,
    extractionTargetCount: plan.extractionTargets.length,
    unsupportedActionCount: plan.unsupportedActions.length
  };
}

function summarizeSourceNavigationExecutionPlan(plan: SourceNavigationExecutionPlan): SourceNavigationExecutionPlanSummary {
  return {
    mode: plan.sourcePlan.mode,
    platform: plan.sourcePlan.platform,
    sourceFamily: plan.sourcePlan.sourceFamily,
    actionStepCount: plan.steps.length,
    unsupportedStepCount: plan.unsupportedSteps.length,
    omittedActionCount: plan.omittedActionCount,
    perActionTimeoutMs: plan.limits.perActionTimeoutMs,
    captureBeforeAfter: plan.limits.captureBeforeAfter,
    stopOnUnsupported: plan.limits.stopOnUnsupported
  };
}

function sourceNavigationRecipeReportLine(summary: SourceNavigationRecipePlanSummary): string {
  return `- Source navigation recipe plan: ${summary.executionPolicy}, ${summary.verificationStatus}, ${summary.actionCandidateCount} action candidates, ${summary.selectorCandidateCount} selectors, ${summary.captureScopeCandidateCount} scopes`;
}

function sourceNavigationCalibrationReportLine(summary: SourceNavigationCalibrationAssessment): string {
  if (!summary.enabled || summary.summary === undefined) {
    return `- Source navigation calibration: ${summary.status}`;
  }
  return `- Source navigation calibration: ${summary.status}, matched selectors ${summary.summary.matchedSelectorCount}/${summary.summary.selectorCandidateCount}, matched scopes ${summary.summary.matchedCaptureScopeCount}/${summary.summary.captureScopeCandidateCount}, blocked signals ${summary.summary.blockedSignalHits}, records ${summary.calibrationArtifactRecords}`;
}

function destinationTriageReasonReportLine(summary: DestinationTriageSummary): string {
  return `- Destination triage reasons: positive ${formatDestinationReasonCounts(summary.positiveReasonCounts)}, negative ${formatDestinationReasonCounts(summary.negativeReasonCounts)}`;
}

function destinationTriageVisibleMetadataReportLine(summary: DestinationTriageSummary): string {
  const metadata = summary.visibleMetadata;
  return `- Destination triage visible metadata: snippets ${metadata.textSnippetCount}/${metadata.candidateCount}, recent-year ${metadata.recentYearHintCount}, stale-year ${metadata.staleYearHintCount}, price/offer ${metadata.priceLikeCount}, rating/review ${metadata.ratingLikeCount + metadata.reviewLikeCount}, local/place ${metadata.localPlaceLikeCount}, publisher/article ${metadata.publisherLikeCount}`;
}

function destinationTriageKindReportLine(summary: DestinationTriageSummary): string {
  return `- Destination triage candidate kinds: all ${formatDestinationKindCounts(summary.candidateKindCounts)}, selected ${formatDestinationKindCounts(summary.selectedKindCounts)}, useful ${formatDestinationKindCounts(summary.usefulKindCounts)}, rejected ${formatDestinationKindCounts(summary.rejectedKindCounts)}`;
}

function destinationTriageQueryIntentReportLine(summary: DestinationTriageSummary): string {
  return `- Destination triage query intents: ${formatDestinationQueryIntentCounts(summary.queryIntentCounts)}`;
}

function destinationTriageFallbackReportLine(summary: DestinationTriageSummary): string {
  if (summary.fallbackCandidates.length === 0) {
    return "- Destination triage fallback candidates: none";
  }
  return `- Destination triage fallback candidates: ${summary.fallbackCandidates
    .slice(0, 5)
    .map((candidate) => `${candidate.candidateId} ${candidate.candidateKind} ${candidate.url} (${candidate.budgetReason})`)
    .join("; ")}`;
}

function destinationTriageBlockedChildRecoveryReportLine(summary: DestinationTriageSummary): string {
  if (summary.blockedChildRecoveryCandidateCount === 0) {
    return "- Destination triage blocked child recovery candidates: none";
  }
  return `- Destination triage blocked child recovery candidates: ${summary.blockedChildRecoveryCandidateCount} found, samples ${summary.blockedChildRecoveryCandidates
    .slice(0, 5)
    .map((candidate) => `${candidate.candidateKind} ${candidate.url} from ${candidate.sourceCandidateId}`)
    .join("; ")}`;
}

function destinationTriageBlockedChildRecoveryAdviceReportLine(summary: DestinationTriageSummary): string {
  const advice = summary.blockedChildRecoveryAdvice;
  if (advice === undefined) {
    return "- Destination triage blocked child recovery advice: none";
  }
  return `- Destination triage blocked child recovery advice: ${advice.recommendedAction}, candidates ${advice.candidateCount}, reasons ${advice.reasons.join(", ")}, command hints ${advice.commandHints.join(" ; ") || "none"}`;
}

function destinationTriageRetryAdviceReportLine(summary: DestinationTriageSummary): string {
  const advice = summary.retryAdvice;
  if (advice === undefined) {
    return "- Destination triage retry advice: none";
  }
  return `- Destination triage retry advice: maxFollowUps ${advice.recommendedMaxSelected}, maxFollowUpsPerDomain ${advice.recommendedMaxPerDomain}, flags ${advice.cliFlags.join(" ")}, reasons ${advice.reasons.join(", ")}`;
}

function formatDestinationReasonCounts(counts: DestinationTriageSummary["positiveReasonCounts"]): string {
  if (counts.length === 0) {
    return "none";
  }
  return counts
    .slice(0, 5)
    .map((item) => `${item.reasonCode}=${item.count}`)
    .join(", ");
}

function formatDestinationKindCounts(counts: DestinationTriageSummary["candidateKindCounts"]): string {
  if (counts.length === 0) {
    return "none";
  }
  return counts
    .slice(0, 5)
    .map((item) => `${item.candidateKind}=${item.count}`)
    .join(", ");
}

function formatDestinationQueryIntentCounts(counts: DestinationTriageSummary["queryIntentCounts"]): string {
  if (counts.length === 0) {
    return "none";
  }
  return counts
    .slice(0, 5)
    .map((item) => `${item.queryIntent}=${item.count}`)
    .join(", ");
}

function summarizeSourceNavigationCalibrationAssessment(report: SourceNavigationCalibrationReport | undefined, requested: boolean, calibrationArtifactRecords: number): SourceNavigationCalibrationAssessment {
  if (!requested || report === undefined) {
    return {
      enabled: requested,
      status: "not_requested",
      calibrationArtifactRecords
    };
  }
  return {
    enabled: true,
    status: report.summary.blockedSignalHits > 0 || report.summary.erroredActionCount > 0 ? "partial" : "ok",
    calibrationArtifactRecords,
    summary: report.summary
  };
}

function summarizeSourceNavigationExecution(result: SourceNavigationExecutionRunResult | undefined, requested: boolean, actionArtifactRecords: number): SourceNavigationExecutionSummary {
  if (!requested || result === undefined) {
    return {
      enabled: requested,
      status: "not_requested",
      executedActionCount: 0,
      skippedActionCount: 0,
      unsupportedActionCount: 0,
      failedActionCount: 0,
      actionArtifactRecords
    };
  }
  return {
    enabled: true,
    status: result.status,
    executedActionCount: result.executedActionCount,
    skippedActionCount: result.skippedActionCount,
    unsupportedActionCount: result.unsupportedActionCount,
    failedActionCount: result.failedActionCount,
    actionArtifactRecords
  };
}

function summarizeSourceNavigationFollowUps(result: SourceNavigationFollowUpRunResult | undefined): SourceNavigationFollowUpSummary {
  if (result === undefined) {
    return {
      requestedCount: 0,
      attemptedCount: 0,
      completedCount: 0,
      failedCount: 0,
      omittedCount: 0,
      maxFollowUps: 0,
      maxFollowUpsPerDomain: 0,
      effectiveMaxFollowUps: 0,
      effectiveMaxFollowUpsPerDomain: 0,
      followUpConcurrency: 0,
      fallbackFollowUps: false,
      maxFallbackFollowUps: 0,
      fallbackAttemptedCount: 0,
      records: 0,
      results: []
    };
  }
  return result.summary;
}

function summarizeDestinationTriageAssessment(result: SourceNavigationFollowUpRunResult | undefined): DestinationTriageSummary {
  if (result === undefined) {
    return {
      status: "not_requested",
      candidateCount: 0,
      selectedCount: 0,
      rejectedCount: 0,
      usefulCount: 0,
      blockedCount: 0,
      lowValueCount: 0,
      duplicateCount: 0,
      offTopicCount: 0,
      budgetLimitedCount: 0,
      unsupportedCount: 0,
      maxSelected: 0,
      maxPerDomain: 0,
      unattemptedFallbackCount: 0,
      fallbackCandidates: [],
      blockedChildRecoveryCandidateCount: 0,
      blockedChildRecoveryCandidates: [],
      retryRecommended: false,
      positiveReasonCounts: [],
      negativeReasonCounts: [],
      visibleMetadata: {
        candidateCount: 0,
        textSnippetCount: 0,
        recentYearHintCount: 0,
        staleYearHintCount: 0,
        priceLikeCount: 0,
        ratingLikeCount: 0,
        reviewLikeCount: 0,
        localPlaceLikeCount: 0,
        publisherLikeCount: 0
      },
      candidateKindCounts: [],
      selectedKindCounts: [],
      usefulKindCounts: [],
      rejectedKindCounts: [],
      queryIntentCounts: [],
      records: 0
    };
  }
  return {
    ...result.destinationTriage.summary,
    records: result.destinationCandidateRecords.length + result.destinationTriageRecords.length
  };
}

function summarizeDestinationDeepeningProposalAssessment(result: SourceNavigationFollowUpRunResult | undefined): DestinationDeepeningProposalSummary {
  if (result === undefined) {
    return {
      status: "not_requested",
      proposalCount: 0,
      candidateCount: 0,
      records: 0
    };
  }
  return summarizeDestinationDeepeningProposals(result.destinationDeepeningProposals, result.destinationDeepeningProposalRecords.length);
}

function summarizeDestinationDeepeningExecution(result: SourceNavigationFollowUpRunResult | undefined): DestinationDeepeningExecutionSummary {
  if (result === undefined) {
    return {
      status: "not_requested",
      maxDepth: 1,
      maxRuns: 0,
      maxPerDomain: 0,
      concurrency: 0,
      timeoutMs: 0,
      maxArtifacts: 0,
      proposalCount: 0,
      candidateCount: 0,
      attemptedCount: 0,
      completedCount: 0,
      failedCount: 0,
      omittedCount: 0,
      usefulCount: 0,
      offTopicCount: 0,
      blockedCount: 0,
      budgetLimitedCount: 0,
      timeoutCount: 0,
      records: 0,
      results: []
    };
  }
  return result.destinationDeepeningExecution;
}

function buildClaims(input: {
  baseCaptureId: string;
  platformCapabilities: PlatformCapabilityMap;
  capabilityRecords: ArtifactRecord[];
  pageCaptureRecords: ArtifactRecord[];
  frameRecords: ArtifactRecord[];
  ocrRecords: ArtifactRecord[];
  officialApiRecords: ArtifactRecord[];
  obstructionRecords: ArtifactRecord[];
  assessmentRecords: ArtifactRecord[];
  frameSampling: FrameSamplingAssessment;
  /** When true, the page capture came from the tier-0 browserless HTTP fetch — the page-capture
   * claim must be labelled http_fetch (not browser_visible), since no browser rendered the bytes. */
  capturedViaHttp?: boolean;
  /** When true, the page capture was replayed from a fresh cache entry (C4) — the page-capture claim
   * is labelled cached_capture with its staleness age, never browser_visible. */
  capturedViaCache?: boolean;
  cacheStalenessMs?: number;
}): EvidenceWorkflowClaim[] {
  const capabilityEvidence = selectEvidenceRecord(input.capabilityRecords);
  const pageEvidence = selectEvidenceRecord(input.pageCaptureRecords, "screenshot") ?? selectEvidenceRecord(input.pageCaptureRecords);
  const frameEvidence = selectEvidenceRecord(input.frameRecords, "screenshot");
  const fallbackFrameEvidence = selectEvidenceRecord(input.frameRecords) ?? selectEvidenceRecord(input.assessmentRecords);
  const assessmentEvidence = selectEvidenceRecord(input.assessmentRecords);
  const officialApiEvidence = selectEvidenceRecord(input.officialApiRecords, undefined, "official_api_metadata");
  const obstructionEvidence = selectEvidenceRecord(input.obstructionRecords, undefined, "browser_obstruction");
  const ocrTextEvidence = selectEvidenceRecord(input.ocrRecords, "text", "ocr_text", "ok");
  const ocrStatusEvidence = selectEvidenceRecord(input.ocrRecords, undefined, "ocr_text");
  const claims = [
    claimFromRecord({
      baseCaptureId: input.baseCaptureId,
      ordinal: 1,
      claimType: "metadata",
      claim: `The target URL is classified as ${input.platformCapabilities.platform}; raw video bytes are not treated as verified evidence.`,
      record: capabilityEvidence,
      verificationLevel: "verified"
    }),
    claimFromRecord({
      baseCaptureId: input.baseCaptureId,
      ordinal: 2,
      claimType: "metadata",
      claim:
        input.capturedViaCache === true
          ? `A page capture was replayed from a fresh content-addressed cache entry (cached_capture; ~${Math.round((input.cacheStalenessMs ?? 0) / 1000)}s stale; not re-rendered this run).`
          : input.capturedViaHttp === true
            ? "A page capture was registered in the artifact ledger via a browserless HTTP fetch (tier-0; not browser-rendered)."
            : "A browser-visible page capture was attempted and registered in the artifact ledger.",
      record: pageEvidence,
      verificationLevel: input.capturedViaCache === true ? "cached_capture" : input.capturedViaHttp === true ? "http_fetch" : "browser_visible"
    }),
    input.frameSampling.status === "ok"
      ? claimFromRecord({
          baseCaptureId: input.baseCaptureId,
          ordinal: 3,
          claimType: "visual",
          claim: "Timestamped visual frame sampling produced registered frame screenshot evidence.",
          record: frameEvidence,
          verificationLevel: "browser_visible",
          timestampSec: firstSampleTimestamp(input.frameSampling)
        })
      : claimFromRecord({
          baseCaptureId: input.baseCaptureId,
          ordinal: 3,
          claimType: "inference",
          claim: `Timestamped visual frame sampling is ${input.frameSampling.status} and is represented by registered partial/assessment evidence.`,
          record: fallbackFrameEvidence,
          verificationLevel: "inferred"
        }),
    claimFromRecord({
      baseCaptureId: input.baseCaptureId,
      ordinal: 4,
      claimType: "inference",
      claim: "Audio and full transcript understanding are explicitly unverified unless an authorized caption body or audio transcription artifact is present.",
      record: assessmentEvidence,
      verificationLevel: "unverified"
    }),
    claimFromRecord({
      baseCaptureId: input.baseCaptureId,
      ordinal: 5,
      claimType: "metadata",
      claim: "Official platform API evidence was collected or its credential/permission status was recorded.",
      record: officialApiEvidence,
      verificationLevel: "official_api"
    }),
    ocrTextEvidence === undefined
      ? claimFromRecord({
          baseCaptureId: input.baseCaptureId,
          ordinal: 6,
          claimType: "inference",
          claim: "OCR over sampled frames did not produce verified text evidence; the run only recorded OCR status.",
          record: ocrStatusEvidence,
          verificationLevel: "unverified"
        })
      : claimFromRecord({
          baseCaptureId: input.baseCaptureId,
          ordinal: 6,
          claimType: "text",
          claim: "OCR over sampled frames produced registered visible text evidence.",
          record: ocrTextEvidence,
          verificationLevel: "ocr_extracted"
        }),
    claimFromRecord({
      baseCaptureId: input.baseCaptureId,
      ordinal: 7,
      claimType: "metadata",
      claim: "A browser-visible access/interstitial obstruction was detected and recorded as structured evidence.",
      record: obstructionEvidence,
      verificationLevel: "browser_visible"
    })
  ];
  return claims.filter((claim): claim is EvidenceWorkflowClaim => claim !== undefined);
}

function claimFromRecord(input: { baseCaptureId: string; ordinal: number; claimType: ClaimType; claim: string; record: ArtifactRecord | undefined; verificationLevel: VerificationLevel; timestampSec?: number | undefined }): EvidenceWorkflowClaim | undefined {
  if (input.record === undefined) {
    return undefined;
  }
  return {
    schema_version: "1.0",
    claim_id: `${input.baseCaptureId}-C${input.ordinal}`,
    claim_type: input.claimType,
    claim: input.claim,
    evidence: input.record.artifact_id,
    artifact_id: input.record.artifact_id,
    evidence_kind: input.record.evidence_kind ?? "metadata",
    verification_level: input.verificationLevel,
    ...(input.timestampSec === undefined ? {} : { timestampSec: input.timestampSec })
  };
}

function selectEvidenceRecord(records: ArtifactRecord[], kind?: ArtifactRecord["kind"], evidenceKind?: EvidenceKind, status?: ArtifactRecord["status"]): ArtifactRecord | undefined {
  return (
    records.find((item) => {
      if (kind !== undefined && item.kind !== kind) {
        return false;
      }
      if (evidenceKind !== undefined && item.evidence_kind !== evidenceKind) {
        return false;
      }
      if (status !== undefined && item.status !== status) {
        return false;
      }
      return true;
    }) ?? (kind === undefined && evidenceKind === undefined && status === undefined ? records[0] : undefined)
  );
}

function firstSampleTimestamp(frameSampling: FrameSamplingAssessment): number | undefined {
  return "frames" in frameSampling ? frameSampling.frames.find((frame) => frame.status === "ok")?.timestampSec : undefined;
}

async function appendClaims(runDir: string, claims: EvidenceWorkflowClaim[]): Promise<void> {
  for (const claim of claims) {
    await appendJsonl(join(runDir, "claims.jsonl"), claim);
    await appendJsonl(join(runDir, "citations.jsonl"), { claim_id: claim.claim_id, evidence: claim.evidence, artifact_id: claim.artifact_id, evidence_kind: claim.evidence_kind });
  }
}

async function writeReport(
  path: string,
  input: {
    url: string;
    runDir: string;
    assessment: EvidenceWorkflowAssessment;
    claims: EvidenceWorkflowClaim[];
    claimGate?: ClaimGateResult | undefined;
  }
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const report = [
    "# Evidence Run",
    "",
    `URL: ${input.url}`,
    `Run dir: ${input.runDir}`,
    "",
    "## Claims",
    "",
    ...input.claims.map((claim) => `- ${claim.claim_id}: ${claim.claim} Evidence: ${claim.evidence}`),
    "",
    "## Assessment",
    "",
    `- Platform: ${input.assessment.platform}`,
    `- Source strategy: ${input.assessment.sourceStrategy.platform} / ${input.assessment.sourceStrategy.sourceFamily}`,
    `- Source registry: ${input.assessment.sourceRegistry.matchReason}, ${input.assessment.sourceRegistry.matchedEntryCount} entries, platforms ${input.assessment.sourceRegistry.platforms.join(", ") || "none"}, categories ${input.assessment.sourceRegistry.categories.join(", ") || "none"}, support tier ${input.assessment.sourceRegistry.minSupportTier ?? "none"}-${input.assessment.sourceRegistry.maxSupportTier ?? "none"}, top slots ${input.assessment.sourceRegistry.topSlotCount}`,
    `- Source navigation plan: ${input.assessment.sourceNavigationPlan.mode}, ${input.assessment.sourceNavigationPlan.actionCount} actions, ${input.assessment.sourceNavigationPlan.extractionTargetCount} extraction targets, ${input.assessment.sourceNavigationPlan.unsupportedActionCount} unsupported actions`,
    `- Source navigation execution plan: ${input.assessment.sourceNavigationExecutionPlan.actionStepCount} action steps, ${input.assessment.sourceNavigationExecutionPlan.unsupportedStepCount} unsupported steps, timeout ${input.assessment.sourceNavigationExecutionPlan.perActionTimeoutMs}ms`,
    sourceNavigationRecipeReportLine(input.assessment.sourceNavigationRecipePlan),
    sourceNavigationCalibrationReportLine(input.assessment.sourceNavigationCalibration),
    `- Source navigation execution: ${input.assessment.sourceNavigationExecution.status}, executed ${input.assessment.sourceNavigationExecution.executedActionCount}, skipped ${input.assessment.sourceNavigationExecution.skippedActionCount}, unsupported ${input.assessment.sourceNavigationExecution.unsupportedActionCount}, failed ${input.assessment.sourceNavigationExecution.failedActionCount}`,
    `- Source navigation follow-ups: requested ${input.assessment.sourceNavigationFollowUps.requestedCount}, attempted ${input.assessment.sourceNavigationFollowUps.attemptedCount}, completed ${input.assessment.sourceNavigationFollowUps.completedCount}, failed ${input.assessment.sourceNavigationFollowUps.failedCount}, omitted ${input.assessment.sourceNavigationFollowUps.omittedCount}, concurrency ${input.assessment.sourceNavigationFollowUps.followUpConcurrency}, fallback ${input.assessment.sourceNavigationFollowUps.fallbackFollowUps ? "enabled" : "disabled"}, fallback attempted ${input.assessment.sourceNavigationFollowUps.fallbackAttemptedCount}, effective max ${input.assessment.sourceNavigationFollowUps.effectiveMaxFollowUps}/${input.assessment.sourceNavigationFollowUps.effectiveMaxFollowUpsPerDomain}`,
    `- Destination triage: ${input.assessment.destinationTriage.status}, candidates ${input.assessment.destinationTriage.candidateCount}, selected ${input.assessment.destinationTriage.selectedCount}, rejected ${input.assessment.destinationTriage.rejectedCount}, useful ${input.assessment.destinationTriage.usefulCount}, blocked ${input.assessment.destinationTriage.blockedCount}, budget-limited ${input.assessment.destinationTriage.budgetLimitedCount}, fallback candidates ${input.assessment.destinationTriage.unattemptedFallbackCount}, retry recommended ${input.assessment.destinationTriage.retryRecommended ? "yes" : "no"}, max per-domain ${input.assessment.destinationTriage.maxPerDomain}`,
    destinationTriageReasonReportLine(input.assessment.destinationTriage),
    destinationTriageVisibleMetadataReportLine(input.assessment.destinationTriage),
    destinationTriageKindReportLine(input.assessment.destinationTriage),
    destinationTriageQueryIntentReportLine(input.assessment.destinationTriage),
    destinationTriageFallbackReportLine(input.assessment.destinationTriage),
    destinationTriageBlockedChildRecoveryReportLine(input.assessment.destinationTriage),
    destinationTriageBlockedChildRecoveryAdviceReportLine(input.assessment.destinationTriage),
    destinationTriageRetryAdviceReportLine(input.assessment.destinationTriage),
    `- Destination deepening proposals: ${input.assessment.destinationDeepeningProposals.status}, proposals ${input.assessment.destinationDeepeningProposals.proposalCount}, candidates ${input.assessment.destinationDeepeningProposals.candidateCount}`,
    `- Destination deepening execution: ${input.assessment.destinationDeepeningExecution.status}, max depth ${input.assessment.destinationDeepeningExecution.maxDepth}, max runs ${input.assessment.destinationDeepeningExecution.maxRuns}, max per-domain ${input.assessment.destinationDeepeningExecution.maxPerDomain}, concurrency ${input.assessment.destinationDeepeningExecution.concurrency}, timeout ${input.assessment.destinationDeepeningExecution.timeoutMs}ms, max artifacts ${input.assessment.destinationDeepeningExecution.maxArtifacts}, attempted ${input.assessment.destinationDeepeningExecution.attemptedCount}, completed ${input.assessment.destinationDeepeningExecution.completedCount}, failed ${input.assessment.destinationDeepeningExecution.failedCount}, omitted ${input.assessment.destinationDeepeningExecution.omittedCount}, useful ${input.assessment.destinationDeepeningExecution.usefulCount}, budget-limited ${input.assessment.destinationDeepeningExecution.budgetLimitedCount}, timeouts ${input.assessment.destinationDeepeningExecution.timeoutCount}`,
    `- Media ID: ${input.assessment.mediaId ?? "unknown"}`,
    `- Browser capture records: ${input.assessment.browserCaptureRecords}`,
    `- Frame sampling: ${input.assessment.frameSampling.status}`,
    ...denseSamplingReportLines(input.assessment.frameSampling),
    `- Browser overlay dismissal: ${input.assessment.browserOverlayDismissal.status} (${input.assessment.browserOverlayDismissal.dismissedCount} dismissed, ${input.assessment.browserOverlayDismissal.skippedCount} skipped)`,
    `- Browser obstructions: ${input.assessment.browserObstructions.status}`,
    ...(input.assessment.browserObstructions.status === "detected" ? [`- Browser obstruction detections: ${input.assessment.browserObstructions.detections.map((detection) => `${detection.kind}:${detection.confidence}`).join(", ")}`] : []),
    `- Audio verified: ${input.assessment.audioVerified}`,
    `- Raw video bytes collected: ${input.assessment.rawVideoBytesCollected}`,
    `- Transcript verified in this run: ${input.assessment.transcript.verifiedInThisRun}`,
    `- Claim gate: ${input.claimGate === undefined ? "not run" : input.claimGate.ok ? "ok" : "failed"}`,
    "",
    "## Stage Timings",
    "",
    ...input.assessment.stageTimings.map((timing) => `- ${timing.stage}: ${timing.status} ${timing.durationMs}ms${timing.error === undefined ? "" : ` (${timing.error})`}`),
    ""
  ].join("\n");
  await writeFile(path, report, "utf8");
}

function denseSamplingReportLines(frameSampling: FrameSamplingAssessment): string[] {
  const lines: string[] = [];
  if ("denseSampling" in frameSampling && frameSampling.denseSampling !== undefined) {
    const sources = [...new Set(frameSampling.denseSampling.events.map((event) => event.source))].join(", ");
    lines.push(`- Dense sampling events: ${frameSampling.denseSampling.totalEvents} (${sources})`, `- Dense sampling captured timestamps: ${frameSampling.denseSampling.capturedTimestampsSec.join(", ")}`);
    const sceneHits = frameSampling.denseSampling.events.flatMap((event) => event.sceneChangeHits ?? []);
    if (sceneHits.length > 0) {
      lines.push(`- Scene-change hits: ${sceneHits.map((hit) => `${hit.fromTimestampSec}-${hit.toTimestampSec}:distance=${hit.distance}`).join(", ")}`);
    }
  }
  if ("sceneChangeDiagnostics" in frameSampling && frameSampling.sceneChangeDiagnostics !== undefined) {
    const latest = frameSampling.sceneChangeDiagnostics.at(-1);
    if (latest !== undefined) {
      const maxDistance = latest.maxObservedDistance === undefined ? "n/a" : String(latest.maxObservedDistance);
      const p90Distance = latest.distanceP90 === undefined ? "n/a" : String(latest.distanceP90);
      const maxPairGap = latest.pairGapMaxSec === undefined ? "n/a" : String(latest.pairGapMaxSec);
      const recommendation = "thresholdRecommendation" in latest ? `${latest.thresholdRecommendation}${latest.recommendedThreshold === undefined ? "" : `:${latest.recommendedThreshold}`}` : "n/a";
      lines.push(
        `- Scene-change diagnostics: threshold=${latest.threshold}, pairs=${latest.comparablePairCount}, pairGapMaxSec=${maxPairGap}, sampling=${latest.samplingDensityStatus}, unique=${latest.uniqueFingerprintCount}, zeroPairs=${latest.zeroDistancePairCount}, maxDistance=${maxDistance}, p90=${p90Distance}, nearBelow=${latest.nearThresholdBelowCount}, nearAbove=${latest.nearThresholdAboveCount}, selected=${latest.selectedHitCount}, recommendation=${recommendation}`
      );
    }
  }
  return lines;
}

async function appendJsonl(path: string, row: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(row)}\n`, "utf8");
}
