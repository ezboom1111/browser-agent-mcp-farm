import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { computeCaptureCacheKey, isEngineResolved, lookupCachedCapture, playwrightPackageVersion, readEngineIdentity, stalenessAgeMs, storeCachedCapture, writeEngineIdentity, type CachedCaptureArtifact, type CaptureCacheProfile } from "./capture-cache.js";
import { attachTypedFacts, crossCheckStructured, extractStructuredData } from "./structured-extractor.js";
import { observedFailureFromBrowserObstructionKinds, planAcquisitionMethods, type AcquisitionMethodPlan } from "./acquisition-method-planner.js";
import { httpTier0Capture } from "./http-tier0-capture.js";
import { summarizeStageTimings } from "./run-metrics.js";
import { isAbortError, throwIfAborted, withAbort } from "./abort.js";
import { ArtifactWriter, sanitizeFileBase, type ArtifactRecord, type CaptureBundleInput } from "./artifact-writer.js";
import { classifyBrowserObstructions, type BrowserObstructionReport } from "./browser-obstructions.js";
import { BrowserPool, type BrowserOverlayDismissalReport } from "./browser-pool.js";
import { runClaimGate, type ClaimGateResult } from "./claim-gate.js";
import type { DestinationVisibleLink } from "./destination-triage.js";
import { analyzeSceneChanges, buildDenseTimestampPlan, type DenseSamplingEvent, type DenseSamplingSource, type DenseTimestampPlan, type FrameSampleRunResult, type SceneChangeDetectionDiagnostics, type SceneChangeHit } from "./frame-sampler.js";
import { planIntentProfile, type IntentProfileReport } from "./intent-profile.js";
import { LeaseManager } from "./lease-manager.js";
import { collectOfficialApiEvidence, writeOfficialApiReadinessArtifact } from "./official-api.js";
import { runOcrForFrameArtifacts } from "./ocr.js";
import { describePlatformCapabilities, type PlatformCapabilityMap } from "./platform-adapters/index.js";
import { publicGatewayCapture, skippedPublicGatewayCapture, type PublicGatewayCaptureResult } from "./public-gateway-capture.js";
import type { ClaimType, EvidenceKind, VerificationLevel } from "./schemas.js";
import { selectSourceRegistryEntriesForUrl, summarizeSourceRegistryMatch } from "./source-registry.js";
import { extractSearchResultCandidates, type SearchResultCandidatesReport } from "./search-result-candidates.js";
import { describeSourceStrategy } from "./source-strategy.js";
import { analyzeTrendSignals, type TrendAnalysisReport } from "./trend-analysis.js";
import type { EvidenceWorkflowAssessment, EvidenceWorkflowClaim, EvidenceWorkflowDeps, EvidenceWorkflowOptions, EvidenceWorkflowResult, EvidenceWorkflowStageTiming, FrameSamplingAssessment } from "./evidence-runner-types.js";
export type {
  EvidenceWorkflowAssessment,
  EvidenceWorkflowClaim,
  EvidenceWorkflowDeps,
  EvidenceWorkflowOptions,
  EvidenceWorkflowResult,
  EvidenceWorkflowStageStatus,
  EvidenceWorkflowStageTiming,
  FrameSamplingAssessment
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
  const acquisitionPlan = planAcquisitionMethods({ url: options.url, allowExternalBridge: false });
  const sourceRegistry = selectSourceRegistryEntriesForUrl(options.url);
  const officialApiConfig = options.officialApi ?? { enabled: false, credentials: {} };
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

  const acquisitionPlanRecords = await runStage("acquisition_method_plan_artifact", () =>
    withAbort(
      writer.writeCaptureBundle({
        ...common,
        pageId: "acquisition-method-plan",
        captureId: `${baseCaptureId}-acquisition-method-plan`,
        metadata: { acquisitionPlan },
        text: JSON.stringify(acquisitionPlan, null, 2),
        captureMethod: "browser-agent-mcp-farm acquisition-method-plan",
        toolName: "acquisition_method_plan",
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

  const intentProfile = planIntentProfile({
    url: options.url,
    sourcePlatform: sourceStrategy.platform,
    sourceFamily: sourceStrategy.sourceFamily,
    ...(options.researchIntent === undefined ? {} : { intent: options.researchIntent })
  });
  const intentProfileRecords = await runStage("intent_profile_artifact", () =>
    withAbort(
      writer.writeCaptureBundle({
        ...common,
        pageId: "intent-profile",
        captureId: `${baseCaptureId}-intent-profile`,
        status: intentProfile.status === "locked" ? "ok" : "partial",
        metadata: { intentProfile },
        text: JSON.stringify(intentProfile, null, 2),
        captureMethod: "browser-agent-mcp-farm intent-profile",
        toolName: "intent_profile",
        evidenceKind: "intent_profile"
      }),
      options.abortSignal
    )
  );
  throwIfAborted(options.abortSignal);
  const runtimeOptions = applyIntentProfileRuntimeOptions(options, intentProfile);

  const officialApiReadiness = await runStage("official_api_readiness", () =>
    writeOfficialApiReadinessArtifact({
      runDir: options.runDir,
      sourceUrl: options.url,
      contextToken: common.contextToken,
      pageId: "official-api-readiness",
      baseCaptureId,
      platformCapabilities,
      credentials: officialApiConfig.credentials,
      writer,
      ...(options.abortSignal === undefined ? {} : { signal: options.abortSignal })
    })
  );
  throwIfAborted(options.abortSignal);

  const officialApi = await runStage("official_api", () =>
    collectOfficialApiEvidence({
      runDir: options.runDir,
      sourceUrl: options.url,
      contextToken: common.contextToken,
      pageId: "official-api",
      baseCaptureId,
      platformCapabilities,
      officialApi: officialApiConfig,
      writer,
      ...(options.abortSignal === undefined ? {} : { signal: options.abortSignal })
    })
  );
  throwIfAborted(options.abortSignal);

  const browserResult = await captureBrowserEvidence({
    options: runtimeOptions,
    parsedUrl,
    baseCaptureId,
    writer,
    deps,
    runStage
  });

  const trendAnalysisResult = await runStage("trend_analysis", () =>
    writeTrendAnalysisArtifact({
      runDir: options.runDir,
      sourceUrl: options.url,
      baseCaptureId,
      sourceStrategy,
      pageCaptureRecords: browserResult.pageCaptureRecords,
      contextToken: common.contextToken,
      pageId: "trend-analysis",
      writer,
      signal: options.abortSignal
    })
  );

  const searchResultCandidateResult = await runStage("search_result_candidates", () =>
    writeSearchResultCandidatesArtifact({
      runDir: options.runDir,
      sourceUrl: options.url,
      baseCaptureId,
      sourceStrategy,
      pageCaptureRecords: browserResult.pageCaptureRecords,
      contextToken: common.contextToken,
      pageId: "search-result-candidates",
      writer,
      signal: options.abortSignal
    })
  );

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

  const runtimeAcquisitionPlan = planRuntimeAcquisitionMethods(options.url, obstructionResult.report);
  const runtimeAcquisitionPlanRecords =
    runtimeAcquisitionPlan === undefined
      ? []
      : await runStage("acquisition_method_runtime_plan_artifact", () =>
          withAbort(
            writer.writeCaptureBundle({
              ...common,
              pageId: "acquisition-method-runtime-plan",
              captureId: `${baseCaptureId}-acquisition-method-runtime-plan`,
              status: "partial",
              metadata: {
                acquisitionPlan: runtimeAcquisitionPlan,
                triggeringObstructions: obstructionResult.report
              },
              text: JSON.stringify(
                {
                  triggeringObstructions: obstructionResult.report,
                  acquisitionPlan: runtimeAcquisitionPlan
                },
                null,
                2
              ),
              captureMethod: "browser-agent-mcp-farm acquisition-method-runtime-plan",
              toolName: "acquisition_method_runtime_plan",
              evidenceKind: "source_strategy",
              note: `runtime acquisition re-plan from ${obstructionResult.report.detections.map((detection) => detection.kind).join(",")}`
            }),
            options.abortSignal
          )
        );
  throwIfAborted(options.abortSignal);

  const publicGatewayResult = shouldAttemptPublicGateway(runtimeAcquisitionPlan)
    ? await runStage("public_gateway_capture", () =>
        (deps.publicGatewayCapture ?? publicGatewayCapture)({
          runDir: options.runDir,
          url: options.url,
          writer,
          captureId: `${baseCaptureId}-public-gateway`,
          contextToken: common.contextToken,
          pageId: "public-gateway",
          ...(options.abortSignal === undefined ? {} : { signal: options.abortSignal })
        })
      )
    : skippedPublicGatewayCapture(runtimeAcquisitionPlan === undefined ? "no runtime acquisition re-plan" : `runtime plan observedFailure=${runtimeAcquisitionPlan.observedFailure} is terminal or not gateway-eligible`);
  throwIfAborted(options.abortSignal);

  const frameSampling = summarizeFrameSampling(browserResult.frameResult, browserResult.frameError, runtimeOptions.sampleFrames === false);
  const assessment: EvidenceWorkflowAssessment = {
    url: options.url,
    platform: platformCapabilities.platform,
    ...(platformCapabilities.mediaId === undefined ? {} : { mediaId: platformCapabilities.mediaId }),
    sourceStrategy,
    acquisitionPlan,
    ...(runtimeAcquisitionPlan === undefined ? {} : { runtimeAcquisitionPlan }),
    sourceRegistry: summarizeSourceRegistryMatch(sourceRegistry),
    intentProfile,
    browserCaptureRecords: browserResult.pageCaptureRecords.length,
    frameSampling,
    browserOverlayDismissal: browserResult.overlayDismissal,
    browserObstructions: obstructionResult.report,
    trendAnalysis: trendAnalysisResult.report,
    searchResultCandidates: searchResultCandidateResult.report,
    publicGateway: publicGatewayAssessment(publicGatewayResult),
    officialApiReadiness: officialApiReadiness.report,
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
    officialApiReadinessRecords: officialApiReadiness.records,
    obstructionRecords: obstructionResult.records,
    publicGatewayRecords: publicGatewayResult.records,
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
    acquisitionPlan,
    ...(runtimeAcquisitionPlan === undefined ? {} : { runtimeAcquisitionPlan }),
    sourceRegistry,
    capabilityRecords,
    sourceStrategyRecords,
    acquisitionPlanRecords,
    runtimeAcquisitionPlanRecords,
    sourceRegistryRecords,
    intentProfileRecords,
    pageCaptureRecords: browserResult.pageCaptureRecords,
    frameRecords,
    ocrRecords: browserResult.ocrRecords,
    officialApiRecords: officialApi.records,
    officialApiReadiness: officialApiReadiness.report,
    officialApiReadinessRecords: officialApiReadiness.records,
    overlayDismissalRecords: browserResult.overlayDismissalRecords,
    obstructionRecords: obstructionResult.records,
    trendAnalysisRecords: trendAnalysisResult.records,
    searchResultCandidateRecords: searchResultCandidateResult.records,
    publicGatewayRecords: publicGatewayResult.records,
    assessmentRecords,
    assessment,
    stageTimings,
    claims,
    ...(claimGate === undefined ? {} : { claimGate })
  };
}

function applyIntentProfileRuntimeOptions(options: EvidenceWorkflowOptions, profile: IntentProfileReport): EvidenceWorkflowOptions {
  const shapes = new Set(profile.inferredShapes);
  const needsBrowserVisual = shapes.has("ui_screenshot") || shapes.has("ocr_image_text") || shapes.has("map_place_state");
  const needsOcr = shapes.has("ocr_image_text") || shapes.has("map_place_state");
  const needsFrames = shapes.has("video_frames");
  if (!needsBrowserVisual && !needsOcr && !needsFrames) {
    return options;
  }

  const runtimeOptions: EvidenceWorkflowOptions = { ...options };
  if (needsBrowserVisual) {
    runtimeOptions.captureRouting = "browser";
    runtimeOptions.httpFetch = false;
    runtimeOptions.captureProfile = "full";
    runtimeOptions.captureCache = false;
  }
  if (needsOcr) {
    runtimeOptions.ocr = {
      enabled: true,
      maxFrames: options.ocr?.maxFrames ?? 20,
      timeoutMs: options.ocr?.timeoutMs ?? 10_000,
      language: effectiveOcrLanguage(options),
      minConfidence: options.ocr?.minConfidence ?? 0
    };
  }
  if (needsFrames && options.sampleFrames === undefined) {
    runtimeOptions.sampleFrames = true;
  }
  return runtimeOptions;
}

function effectiveOcrLanguage(options: EvidenceWorkflowOptions): string {
  const explicitLanguage = options.ocr?.language?.trim();
  if (explicitLanguage !== undefined && explicitLanguage.length > 0 && (options.ocr?.enabled === true || explicitLanguage !== "eng")) {
    return explicitLanguage;
  }
  return defaultOcrLanguageForUrl(options.url);
}

function defaultOcrLanguageForUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.endsWith(".kr") || hostname.includes("naver.") || hostname.includes("daum.")) {
      return "kor+eng";
    }
  } catch {
    // fall through to the general bilingual default
  }
  return "eng+kor";
}

function planRuntimeAcquisitionMethods(url: string, report: BrowserObstructionReport): AcquisitionMethodPlan | undefined {
  if (report.status === "clear") {
    return undefined;
  }
  const observedFailure = observedFailureFromBrowserObstructionKinds(report.detections.map((detection) => detection.kind));
  if (observedFailure === "none") {
    return undefined;
  }
  return planAcquisitionMethods({
    url,
    observedFailure,
    allowExternalBridge: false
  });
}

function shouldAttemptPublicGateway(plan: AcquisitionMethodPlan | undefined): boolean {
  if (plan === undefined) {
    return false;
  }
  if (plan.observedFailure === "login_or_paywall" || plan.observedFailure === "captcha_or_challenge" || plan.observedFailure === "none") {
    return false;
  }
  return plan.methods.some((method) => method.tier === "feed" && method.status === "try");
}

function publicGatewayAssessment(result: PublicGatewayCaptureResult): EvidenceWorkflowAssessment["publicGateway"] {
  return {
    status: result.status,
    attempts: result.attempts,
    ...(result.reason === undefined ? {} : { reason: result.reason })
  };
}

async function captureBrowserEvidence(input: { options: EvidenceWorkflowOptions; parsedUrl: URL; baseCaptureId: string; writer: ArtifactWriter; deps: EvidenceWorkflowDeps; runStage: StageRunner }): Promise<{
  /** True when the page bytes were captured by the tier-0 browserless HTTP fetch (A1), not a browser. */
  capturedViaHttp?: boolean;
  /** True when the page bytes were replayed from a fresh content-addressed cache entry (C4), not re-captured. */
  capturedViaCache?: boolean;
  /** Age (ms) of the replayed cache entry, recorded on the cached_capture claim. */
  cacheStalenessMs?: number;
  /** Subrequests aborted by the text-profile resource blocker on this run (C3). */
  blockedResourceCount?: number;
  pageCaptureRecords: ArtifactRecord[];
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
  let leaseToken: string | undefined;
  let released = false;

  try {
    throwIfAborted(input.options.abortSignal);

    // Tier-0 browserless capture (A1/D2): try a plain HTTP GET first when opted in directly
    // (httpFetch) OR via auto routing (captureRouting "auto"). On success we skip the browser entirely
    // and early-return with the tier-0 page records (no frames/OCR — those need a
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
        capability: "read-only",
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
    const pageScreenshotRecords = capture.records.filter((record) => record.kind === "screenshot" && record.evidence_kind === "page_screenshot");
    const ocrResult = await input.runStage("ocr", () =>
      runOcrForFrameArtifacts({
        runDir: input.options.runDir,
        sourceUrl: input.options.url,
        contextToken: lease.contextToken,
        pageId: "ocr",
        baseCaptureId: input.baseCaptureId,
        frameRecords: ocrFrameRecords,
        imageRecords: pageScreenshotRecords,
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

async function writeTrendAnalysisArtifact(input: {
  runDir: string;
  sourceUrl: string;
  baseCaptureId: string;
  sourceStrategy: ReturnType<typeof describeSourceStrategy>;
  pageCaptureRecords: ArtifactRecord[];
  contextToken: string;
  pageId: string;
  writer: ArtifactWriter;
  signal?: AbortSignal | undefined;
}): Promise<{ report: TrendAnalysisReport; records: ArtifactRecord[] }> {
  const captureText = await pageCaptureTextFromRecords(input.runDir, input.pageCaptureRecords, input.signal);
  const report = analyzeTrendSignals({
    sourceUrl: input.sourceUrl,
    platform: input.sourceStrategy.platform,
    sourceFamily: input.sourceStrategy.sourceFamily,
    ...(captureText.text === undefined ? {} : { text: captureText.text }),
    ...(captureText.title === undefined ? {} : { title: captureText.title })
  });
  const records = await input.writer.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: input.sourceUrl,
    contextToken: input.contextToken,
    pageId: input.pageId,
    captureId: `${input.baseCaptureId}-trend-analysis`,
    status: report.status === "empty" ? "partial" : "ok",
    metadata: { trendAnalysis: report },
    text: JSON.stringify(report, null, 2),
    captureMethod: "browser-agent-mcp-farm trend-analysis",
    toolName: "trend_analysis",
    evidenceKind: "trend_analysis",
    note: "deterministic trend-signal summary derived from captured page_text/title; cite source page_text for load-bearing factual claims"
  });
  return { report, records };
}

async function writeSearchResultCandidatesArtifact(input: {
  runDir: string;
  sourceUrl: string;
  baseCaptureId: string;
  sourceStrategy: ReturnType<typeof describeSourceStrategy>;
  pageCaptureRecords: ArtifactRecord[];
  contextToken: string;
  pageId: string;
  writer: ArtifactWriter;
  signal?: AbortSignal | undefined;
}): Promise<{ report: SearchResultCandidatesReport; records: ArtifactRecord[] }> {
  const captureText = await pageCaptureTextFromRecords(input.runDir, input.pageCaptureRecords, input.signal);
  const pageScreenshotCount = input.pageCaptureRecords.filter((record) => record.kind === "screenshot" && record.evidence_kind === "page_screenshot").length;
  const report = extractSearchResultCandidates({
    sourceUrl: input.sourceUrl,
    platform: input.sourceStrategy.platform,
    ...(captureText.text === undefined ? {} : { text: captureText.text }),
    ...(captureText.visibleLinks === undefined ? {} : { visibleLinks: captureText.visibleLinks }),
    pageScreenshotCount
  });
  if (report.status === "not_search_surface") {
    return { report, records: [] };
  }
  const records = await input.writer.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: input.sourceUrl,
    contextToken: input.contextToken,
    pageId: input.pageId,
    captureId: `${input.baseCaptureId}-search-result-candidates`,
    status: report.status === "ok" ? "ok" : "partial",
    metadata: { searchResultCandidates: report },
    text: JSON.stringify(report, null, 2),
    captureMethod: "browser-agent-mcp-farm search-result-candidates",
    toolName: "search_result_candidates",
    evidenceKind: "search_result_candidates",
    note: "deterministic candidate index derived from captured search-result text/link metadata; cite original page_text/page_screenshot for load-bearing claims"
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

function buildClaims(input: {
  baseCaptureId: string;
  platformCapabilities: PlatformCapabilityMap;
  capabilityRecords: ArtifactRecord[];
  pageCaptureRecords: ArtifactRecord[];
  frameRecords: ArtifactRecord[];
  ocrRecords: ArtifactRecord[];
  officialApiRecords: ArtifactRecord[];
  officialApiReadinessRecords: ArtifactRecord[];
  obstructionRecords: ArtifactRecord[];
  publicGatewayRecords: ArtifactRecord[];
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
  const officialApiReadinessEvidence = selectEvidenceRecord(input.officialApiReadinessRecords, undefined, "source_strategy");
  const obstructionEvidence = selectEvidenceRecord(input.obstructionRecords, undefined, "browser_obstruction");
  const publicGatewayEvidence = selectEvidenceRecord(input.publicGatewayRecords, "text", "page_text", "ok");
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
          claim: "OCR over sampled frames or page screenshots did not produce verified text evidence; the run only recorded OCR status.",
          record: ocrStatusEvidence,
          verificationLevel: "unverified"
        })
      : claimFromRecord({
          baseCaptureId: input.baseCaptureId,
          ordinal: 6,
          claimType: "text",
          claim: "OCR over sampled frames or page screenshots produced registered visible text evidence.",
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
    }),
    claimFromRecord({
      baseCaptureId: input.baseCaptureId,
      ordinal: 8,
      claimType: "text",
      claim: "A legal public gateway returned readable source text and the exact gateway bytes were registered in the artifact ledger.",
      record: publicGatewayEvidence,
      verificationLevel: "grounded"
    }),
    claimFromRecord({
      baseCaptureId: input.baseCaptureId,
      ordinal: 9,
      claimType: "metadata",
      claim: "Official API credential readiness was evaluated before browser capture without calling provider APIs.",
      record: officialApiReadinessEvidence,
      verificationLevel: "grounded"
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
    `- Acquisition plan: ${formatAcquisitionPlanSummary(input.assessment.acquisitionPlan)}`,
    ...(input.assessment.runtimeAcquisitionPlan === undefined ? [] : [`- Runtime acquisition re-plan: ${formatAcquisitionPlanSummary(input.assessment.runtimeAcquisitionPlan)}`]),
    `- Intent profile: ${formatIntentProfileSummary(input.assessment.intentProfile)}`,
    `- Official API readiness: ${input.assessment.officialApiReadiness.platform}, supported=${input.assessment.officialApiReadiness.supportedLookupCount}, ready=${input.assessment.officialApiReadiness.readyLookupCount}, missing_env=${input.assessment.officialApiReadiness.missingEnvCount}, missing_reference=${input.assessment.officialApiReadiness.missingReferenceCount}, missing_media_id=${input.assessment.officialApiReadiness.missingMediaIdCount}`,
    `- Source registry: ${input.assessment.sourceRegistry.matchReason}, ${input.assessment.sourceRegistry.matchedEntryCount} entries, platforms ${input.assessment.sourceRegistry.platforms.join(", ") || "none"}, categories ${input.assessment.sourceRegistry.categories.join(", ") || "none"}, support tier ${input.assessment.sourceRegistry.minSupportTier ?? "none"}-${input.assessment.sourceRegistry.maxSupportTier ?? "none"}, top slots ${input.assessment.sourceRegistry.topSlotCount}`,
    `- Trend analysis: ${formatTrendAnalysisSummary(input.assessment.trendAnalysis)}`,
    `- Search result candidates: ${input.assessment.searchResultCandidates.status}, candidates=${input.assessment.searchResultCandidates.candidates.length}`,
    `- Media ID: ${input.assessment.mediaId ?? "unknown"}`,
    `- Browser capture records: ${input.assessment.browserCaptureRecords}`,
    `- Frame sampling: ${input.assessment.frameSampling.status}`,
    ...denseSamplingReportLines(input.assessment.frameSampling),
    `- Browser overlay dismissal: ${input.assessment.browserOverlayDismissal.status} (${input.assessment.browserOverlayDismissal.dismissedCount} dismissed, ${input.assessment.browserOverlayDismissal.skippedCount} skipped)`,
    `- Browser obstructions: ${input.assessment.browserObstructions.status}`,
    ...(input.assessment.browserObstructions.status === "detected" ? [`- Browser obstruction detections: ${input.assessment.browserObstructions.detections.map((detection) => `${detection.kind}:${detection.confidence}`).join(", ")}`] : []),
    `- Public gateway: ${input.assessment.publicGateway.status}${input.assessment.publicGateway.reason === undefined ? "" : ` (${input.assessment.publicGateway.reason})`}`,
    ...(input.assessment.publicGateway.attempts.length === 0 ? [] : [`- Public gateway attempts: ${input.assessment.publicGateway.attempts.map((attempt) => `${attempt.key}:${attempt.status}${attempt.statusCode === undefined ? "" : `:${attempt.statusCode}`}`).join(", ")}`]),
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

function formatAcquisitionPlanSummary(plan: EvidenceWorkflowAssessment["acquisitionPlan"]): string {
  const first = plan.methods[0]?.key ?? "none";
  const last = plan.methods.at(-1)?.key ?? "none";
  const boundaryMethods = plan.methods
    .filter((method) => method.status === "terminal" || method.tier === "external_bridge")
    .map((method) => method.key)
    .join(", ");
  const boundarySummary = boundaryMethods.length === 0 ? "" : `, boundary=${boundaryMethods}`;
  return `${plan.methods.length} methods, observedFailure=${plan.observedFailure}, first=${first}, last=${last}${boundarySummary}, decision=${plan.decision}`;
}

function formatIntentProfileSummary(profile: EvidenceWorkflowAssessment["intentProfile"]): string {
  const shapes = profile.inferredShapes.join(", ") || "none";
  const questions = profile.questions.length === 0 ? "none" : profile.questions.length;
  return `${profile.status}, autonomy=${profile.autonomyMode}, shapes=${shapes}, questions=${questions}, heavyPath=${profile.recommendedOptions.heavyPath}, captureProfile=${profile.recommendedOptions.captureProfile}`;
}

function formatTrendAnalysisSummary(report: TrendAnalysisReport): string {
  const topTerms = report.topTerms
    .slice(0, 5)
    .map((term) => `${term.term}:${term.count}`)
    .join(", ");
  const signalGroups = Array.from(new Set(report.signals.map((signal) => signal.kind))).join(", ") || "none";
  return `${report.status}, ${report.summary}, top_terms=${topTerms || "none"}, signal_groups=${signalGroups}`;
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
