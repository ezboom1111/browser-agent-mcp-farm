// Data model for the evidence workflow — the public option/result/assessment/claim types,
// extracted from evidence-runner.ts so the orchestration logic and its (large) type surface
// live in separate modules. evidence-runner.ts re-exports these, so external importers are
// unaffected. Type-only module: no runtime code.
import type { ArtifactRecord, ArtifactWriter } from "./artifact-writer.js";
import type { BrowserObstructionReport } from "./browser-obstructions.js";
import type { BrowserOverlayDismissalReport, BrowserPool } from "./browser-pool.js";
import type { ClaimGateResult } from "./claim-gate.js";
import type { DestinationChildEvidenceSummary, DestinationDeepeningExecutionSummary, DestinationDeepeningProposalSummary, DestinationTriageSummary } from "./destination-triage.js";
import type { DenseSamplingEvent, SceneChangeDetectionDiagnostics } from "./frame-sampler.js";
import type { LeaseManager, StoragePolicy } from "./lease-manager.js";
import type { OcrOptions, OcrWorkerFactory } from "./ocr.js";
import type { PlatformCapabilityMap } from "./platform-adapters/index.js";
import type { ClaimType, EvidenceKind, VerificationLevel } from "./schemas.js";
import type { SourceNavigationExecutionLimits, SourceNavigationExecutionPlan } from "./source-navigation-execution.js";
import type { SourceNavigationExecutableAction, SourceNavigationExecutionRunResult } from "./source-navigation-executor.js";
import type { SourceNavigationCalibrationSummary } from "./source-navigation-calibration.js";
import type { SourceNavigationRecipePlan, SourceNavigationRecipePlanSummary } from "./source-navigation-recipes.js";
import type { SourceNavigationPlan } from "./source-navigation.js";
import type { SourceRegistryMatch, SourceRegistrySummary } from "./source-registry.js";
import type { SourceStrategy } from "./source-strategy.js";

export interface EvidenceWorkflowOptions {
  url: string;
  runDir: string;
  captureId?: string | undefined;
  frameSelector?: string | undefined;
  timestampsSec?: number[] | undefined;
  maxFrames?: number | undefined;
  waitMs?: number | undefined;
  navigationTimeoutMs?: number | undefined;
  seekTimeoutMs?: number | undefined;
  settleMs?: number | undefined;
  sampleFrames?: boolean | undefined;
  finalClaimGate?: boolean | undefined;
  profileName?: string | undefined;
  storagePolicy?: StoragePolicy | undefined;
  headed?: boolean | undefined;
  browserChannel?: string | undefined;
  /** Tier-0 browserless capture: attempt a plain HTTP GET before the browser (A1). No frames. */
  httpFetch?: boolean | undefined;
  overlayDismissal?:
    | {
        enabled: boolean;
        maxActions: number;
      }
    | undefined;
  ocr?: OcrOptions | undefined;
  denseSampling?:
    | {
        enabled: boolean;
        windowSec: number;
        stepSec: number;
        maxDenseFrames: number;
        sceneChange?: boolean | undefined;
        sceneChangeThreshold?: number | undefined;
        sceneChangeMaxHits?: number | undefined;
        query?: string | undefined;
      }
    | undefined;
  officialApi?:
    | {
        enabled: boolean;
        credentials: {
          youtubeApiKeyEnv?: string | undefined;
          youtubeOAuthTokenEnv?: string | undefined;
          instagramAccessTokenEnv?: string | undefined;
          tiktokAccessTokenEnv?: string | undefined;
          tiktokResearchTokenEnv?: string | undefined;
        };
      }
    | undefined;
  sourceNavigation?:
    | {
        enabled: boolean;
        calibrate?: boolean | undefined;
        calibrationSelectorTimeoutMs?: number | undefined;
        actions: SourceNavigationExecutableAction[];
        maxFollowUps?: number | undefined;
        maxFollowUpsPerDomain?: number | undefined;
        followUpConcurrency?: number | undefined;
        fallbackFollowUps?: boolean | undefined;
        maxFallbackFollowUps?: number | undefined;
        maxDepth?: number | undefined;
        maxDeepeningRuns?: number | undefined;
        maxDeepeningRunsPerDomain?: number | undefined;
        deepeningConcurrency?: number | undefined;
        deepeningTimeoutMs?: number | undefined;
        maxDeepeningArtifacts?: number | undefined;
        limits?: Partial<SourceNavigationExecutionLimits> | undefined;
      }
    | undefined;
  abortSignal?: AbortSignal | undefined;
}

export interface EvidenceWorkflowClaim {
  schema_version: "1.0";
  claim_id: string;
  claim_type: ClaimType;
  claim: string;
  evidence: string;
  artifact_id: string;
  evidence_kind: EvidenceKind;
  verification_level: VerificationLevel;
  timestampSec?: number;
}

export type EvidenceWorkflowStageStatus = "ok" | "error" | "aborted";

export interface EvidenceWorkflowStageTiming {
  stage: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: EvidenceWorkflowStageStatus;
  error?: string;
}

export interface EvidenceWorkflowAssessment {
  url: string;
  platform: PlatformCapabilityMap["platform"];
  mediaId?: string;
  sourceStrategy: SourceStrategy;
  sourceRegistry: SourceRegistrySummary;
  sourceNavigationPlan: SourceNavigationPlanSummary;
  sourceNavigationExecutionPlan: SourceNavigationExecutionPlanSummary;
  sourceNavigationRecipePlan: SourceNavigationRecipePlanSummary;
  sourceNavigationCalibration: SourceNavigationCalibrationAssessment;
  sourceNavigationExecution: SourceNavigationExecutionSummary;
  sourceNavigationFollowUps: SourceNavigationFollowUpSummary;
  destinationTriage: DestinationTriageSummary;
  destinationDeepeningProposals: DestinationDeepeningProposalSummary;
  destinationDeepeningExecution: DestinationDeepeningExecutionSummary;
  browserCaptureRecords: number;
  frameSampling: FrameSamplingAssessment;
  browserOverlayDismissal: BrowserOverlayDismissalReport;
  browserObstructions: BrowserObstructionReport;
  stageTimings: EvidenceWorkflowStageTiming[];
  transcript: {
    officialCaptionBodyCapability: string;
    credentialRequired: string;
    verifiedInThisRun: false;
    reason: string;
  };
  audioVerified: false;
  rawVideoBytesCollected: false;
}

export interface SourceNavigationPlanSummary {
  mode: SourceNavigationPlan["mode"];
  platform: SourceNavigationPlan["platform"];
  sourceFamily: SourceNavigationPlan["sourceFamily"];
  actionCount: number;
  extractionTargetCount: number;
  unsupportedActionCount: number;
}

export interface SourceNavigationExecutionPlanSummary {
  mode: SourceNavigationPlan["mode"];
  platform: SourceNavigationPlan["platform"];
  sourceFamily: SourceNavigationPlan["sourceFamily"];
  actionStepCount: number;
  unsupportedStepCount: number;
  omittedActionCount: number;
  perActionTimeoutMs: number;
  captureBeforeAfter: boolean;
  stopOnUnsupported: boolean;
}

export interface SourceNavigationExecutionSummary {
  enabled: boolean;
  status: "not_requested" | SourceNavigationExecutionRunResult["status"];
  executedActionCount: number;
  skippedActionCount: number;
  unsupportedActionCount: number;
  failedActionCount: number;
  actionArtifactRecords: number;
}

export interface SourceNavigationCalibrationAssessment {
  enabled: boolean;
  status: "not_requested" | "ok" | "partial";
  calibrationArtifactRecords: number;
  summary?: SourceNavigationCalibrationSummary;
}

export interface SourceNavigationFollowUpRunSummary {
  actionKey: string;
  url: string;
  status: "ok" | "error";
  runDir?: string;
  reportPath?: string;
  childEvidence?: DestinationChildEvidenceSummary;
  error?: string;
}

export interface SourceNavigationFollowUpSummary {
  requestedCount: number;
  attemptedCount: number;
  completedCount: number;
  failedCount: number;
  omittedCount: number;
  maxFollowUps: number;
  maxFollowUpsPerDomain: number;
  effectiveMaxFollowUps: number;
  effectiveMaxFollowUpsPerDomain: number;
  followUpConcurrency: number;
  fallbackFollowUps: boolean;
  maxFallbackFollowUps: number;
  fallbackAttemptedCount: number;
  records: number;
  results: SourceNavigationFollowUpRunSummary[];
}

export type FrameSamplingAssessment =
  | {
      status: "ok" | "partial";
      timestampsSec: number[];
      frames: Array<{
        timestampSec: number;
        status: "ok" | "partial";
        seek: unknown;
      }>;
      denseSampling?: {
        totalEvents: number;
        capturedTimestampsSec: number[];
        events: DenseSamplingEvent[];
      };
      sceneChangeDiagnostics?: SceneChangeDetectionDiagnostics[];
    }
  | {
      status: "skipped" | "partial";
      reason: string;
      error?: string;
    };

export interface EvidenceWorkflowResult {
  ok: boolean;
  runDir: string;
  reportPath: string;
  url: string;
  platformCapabilities: PlatformCapabilityMap;
  sourceStrategy: SourceStrategy;
  sourceRegistry: SourceRegistryMatch;
  sourceNavigationPlan: SourceNavigationPlan;
  sourceNavigationExecutionPlan: SourceNavigationExecutionPlan;
  sourceNavigationRecipePlan: SourceNavigationRecipePlan;
  capabilityRecords: ArtifactRecord[];
  sourceStrategyRecords: ArtifactRecord[];
  sourceRegistryRecords: ArtifactRecord[];
  sourceNavigationPlanRecords: ArtifactRecord[];
  sourceNavigationExecutionPlanRecords: ArtifactRecord[];
  sourceNavigationRecipePlanRecords: ArtifactRecord[];
  sourceNavigationCalibrationRecords: ArtifactRecord[];
  sourceNavigationActionRecords: ArtifactRecord[];
  sourceNavigationFollowUpRecords: ArtifactRecord[];
  destinationCandidateRecords: ArtifactRecord[];
  destinationTriageRecords: ArtifactRecord[];
  destinationDeepeningProposalRecords: ArtifactRecord[];
  destinationDeepeningRunRecords: ArtifactRecord[];
  pageCaptureRecords: ArtifactRecord[];
  frameRecords: ArtifactRecord[];
  ocrRecords: ArtifactRecord[];
  officialApiRecords: ArtifactRecord[];
  overlayDismissalRecords: ArtifactRecord[];
  obstructionRecords: ArtifactRecord[];
  assessmentRecords: ArtifactRecord[];
  assessment: EvidenceWorkflowAssessment;
  stageTimings: EvidenceWorkflowStageTiming[];
  claims: EvidenceWorkflowClaim[];
  claimGate?: ClaimGateResult;
}

export interface EvidenceWorkflowDeps {
  leaseManager?: LeaseManager | undefined;
  browserPool?: BrowserPool | undefined;
  artifactWriter?: ArtifactWriter | undefined;
  ocrWorkerFactory?: OcrWorkerFactory | undefined;
}
