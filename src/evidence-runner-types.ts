// Data model for the evidence workflow — the public option/result/assessment/claim types,
// extracted from evidence-runner.ts so the orchestration logic and its (large) type surface
// live in separate modules. evidence-runner.ts re-exports these, so external importers are
// unaffected. Type-only module: no runtime code.
import type { ArtifactRecord, ArtifactWriter } from "./artifact-writer.js";
import type { AcquisitionMethodPlan } from "./acquisition-method-planner.js";
import type { BrowserObstructionReport } from "./browser-obstructions.js";
import type { BrowserOverlayDismissalReport, BrowserPool } from "./browser-pool.js";
import type { ClaimGateResult } from "./claim-gate.js";
import type { DenseSamplingEvent, SceneChangeDetectionDiagnostics } from "./frame-sampler.js";
import type { LeaseManager, StoragePolicy } from "./lease-manager.js";
import type { OcrOptions, OcrWorkerFactory } from "./ocr.js";
import type { OfficialApiReadinessReport } from "./official-api.js";
import type { PlatformCapabilityMap } from "./platform-adapters/index.js";
import type { PublicGatewayAssessment, PublicGatewayCapture } from "./public-gateway-capture.js";
import type { ClaimType, EvidenceKind, NormalizedEvidenceRunInput, VerificationLevel } from "./schemas.js";
import type { SourceRegistryMatch, SourceRegistrySummary } from "./source-registry.js";
import type { SourceStrategy } from "./source-strategy.js";
import type { CandidateDeepeningLedger } from "./candidate-deepening-ledger.js";
import type { IntentProfileReport } from "./intent-profile.js";
import type { SearchResultCandidatesReport } from "./search-result-candidates.js";
import type { SearchStrategyPlan } from "./search-strategy-planner.js";
import type { TrendAnalysisReport } from "./trend-analysis.js";

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
  researchIntent?: NormalizedEvidenceRunInput["researchIntent"] | undefined;
  /** Tier-0 browserless capture: attempt a plain HTTP GET before the browser (A1). No frames. */
  httpFetch?: boolean | undefined;
  /** Capture routing (D2). "auto" tries tier-0 first and escalates to the browser on any decline
   * (client-rendered shell / non-HTML / off-domain / error); "browser" (default) always uses Chromium. */
  captureRouting?: "browser" | "auto" | undefined;
  /** Opt-in capture replay (C4). Replay a fresh (<=1h) prior bare-ephemeral capture by content hash
   * instead of launching, labelling the page claim "cached_capture". Default false. */
  captureCache?: boolean | undefined;
  /** Capture profile (A3). "text" blocks image/media/font + ad-host subrequests and skips the page
   * screenshot for text/structure-only browser runs; "full" (default) captures everything. */
  captureProfile?: "text" | "full" | undefined;
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
  acquisitionPlan: AcquisitionMethodPlan;
  runtimeAcquisitionPlan?: AcquisitionMethodPlan;
  sourceRegistry: SourceRegistrySummary;
  intentProfile: IntentProfileReport;
  browserCaptureRecords: number;
  frameSampling: FrameSamplingAssessment;
  browserOverlayDismissal: BrowserOverlayDismissalReport;
  browserObstructions: BrowserObstructionReport;
  trendAnalysis: TrendAnalysisReport;
  searchResultCandidates: SearchResultCandidatesReport;
  searchStrategyPlan: SearchStrategyPlan;
  candidateDeepeningLedger: CandidateDeepeningLedger;
  publicGateway: PublicGatewayAssessment;
  officialApiReadiness: OfficialApiReadinessReport;
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
  acquisitionPlan: AcquisitionMethodPlan;
  runtimeAcquisitionPlan?: AcquisitionMethodPlan;
  sourceRegistry: SourceRegistryMatch;
  capabilityRecords: ArtifactRecord[];
  sourceStrategyRecords: ArtifactRecord[];
  acquisitionPlanRecords: ArtifactRecord[];
  runtimeAcquisitionPlanRecords: ArtifactRecord[];
  sourceRegistryRecords: ArtifactRecord[];
  intentProfileRecords: ArtifactRecord[];
  pageCaptureRecords: ArtifactRecord[];
  frameRecords: ArtifactRecord[];
  ocrRecords: ArtifactRecord[];
  officialApiRecords: ArtifactRecord[];
  officialApiReadiness: OfficialApiReadinessReport;
  officialApiReadinessRecords: ArtifactRecord[];
  overlayDismissalRecords: ArtifactRecord[];
  obstructionRecords: ArtifactRecord[];
  trendAnalysisRecords: ArtifactRecord[];
  searchResultCandidateRecords: ArtifactRecord[];
  searchStrategyPlanRecords: ArtifactRecord[];
  candidateDeepeningLedgerRecords: ArtifactRecord[];
  clientStateDestinationsRecords: ArtifactRecord[];
  publicGatewayRecords: ArtifactRecord[];
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
  publicGatewayCapture?: PublicGatewayCapture | undefined;
}
