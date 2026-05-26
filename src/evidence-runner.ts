import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ArtifactWriter, sanitizeFileBase, type ArtifactRecord } from "./artifact-writer.js";
import { BrowserPool } from "./browser-pool.js";
import { runClaimGate, type ClaimGateResult } from "./claim-gate.js";
import { type FrameSampleRunResult } from "./frame-sampler.js";
import { LeaseManager } from "./lease-manager.js";
import { describePlatformCapabilities, type PlatformCapabilityMap } from "./platform-adapters/index.js";

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
}

export interface EvidenceWorkflowClaim {
  claim_id: string;
  claim: string;
  evidence: string;
}

export interface EvidenceWorkflowAssessment {
  url: string;
  platform: PlatformCapabilityMap["platform"];
  mediaId?: string;
  browserCaptureRecords: number;
  frameSampling: FrameSamplingAssessment;
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
  capabilityRecords: ArtifactRecord[];
  pageCaptureRecords: ArtifactRecord[];
  frameRecords: ArtifactRecord[];
  assessmentRecords: ArtifactRecord[];
  assessment: EvidenceWorkflowAssessment;
  claims: EvidenceWorkflowClaim[];
  claimGate?: ClaimGateResult;
}

export async function runEvidenceWorkflow(options: EvidenceWorkflowOptions): Promise<EvidenceWorkflowResult> {
  const parsedUrl = new URL(options.url);
  await mkdir(options.runDir, { recursive: true });
  const writer = new ArtifactWriter();
  const platformCapabilities = describePlatformCapabilities(options.url);
  const baseCaptureId = sanitizeFileBase(options.captureId ?? `evidence-${platformCapabilities.platform}-${parsedUrl.hostname}`);
  const common = {
    runDir: options.runDir,
    sourceUrl: options.url,
    contextToken: `${baseCaptureId}-workflow`,
    pageId: "evidence-workflow"
  };

  const capabilityRecords = await writer.writeCaptureBundle({
    ...common,
    pageId: "platform-capabilities",
    captureId: `${baseCaptureId}-platform-capabilities`,
    metadata: { platformCapabilities },
    text: JSON.stringify(platformCapabilities, null, 2),
    captureMethod: "browser-agent-mcp-farm platform-capabilities",
    toolName: "platform_capabilities"
  });

  const browserResult = await captureBrowserEvidence({
    options,
    parsedUrl,
    baseCaptureId,
    writer
  });

  const frameSampling = summarizeFrameSampling(browserResult.frameResult, browserResult.frameError, options.sampleFrames === false);
  const assessment: EvidenceWorkflowAssessment = {
    url: options.url,
    platform: platformCapabilities.platform,
    ...(platformCapabilities.mediaId === undefined ? {} : { mediaId: platformCapabilities.mediaId }),
    browserCaptureRecords: browserResult.pageCaptureRecords.length,
    frameSampling,
    transcript: {
      officialCaptionBodyCapability: platformCapabilities.capabilities.captionBody.status,
      credentialRequired: platformCapabilities.capabilities.captionBody.requiresCredential,
      verifiedInThisRun: false,
      reason: "No authorized caption body or audio transcription artifact was collected in this run."
    },
    audioVerified: false,
    rawVideoBytesCollected: false
  };
  const assessmentRecords = await writer.writeCaptureBundle({
    ...common,
    pageId: "run-assessment",
    captureId: `${baseCaptureId}-run-assessment`,
    metadata: { assessment },
    text: JSON.stringify(assessment, null, 2),
    captureMethod: "browser-agent-mcp-farm evidence-run assessment",
    toolName: "evidence_run"
  });

  const frameRecords = browserResult.frameResult?.frames.flatMap((frame) => frame.records) ?? browserResult.frameFailureRecords;
  const claims = buildClaims({
    baseCaptureId,
    platformCapabilities,
    capabilityRecords,
    pageCaptureRecords: browserResult.pageCaptureRecords,
    frameRecords,
    assessmentRecords,
    frameSampling
  });
  await appendClaims(options.runDir, claims);

  const reportPath = join(options.runDir, "reports", `${baseCaptureId}-final.md`);
  await writeReport(reportPath, {
    url: options.url,
    runDir: options.runDir,
    assessment,
    claims
  });

  const claimGate = options.finalClaimGate === false
    ? undefined
    : await runClaimGate(options.runDir, { mode: "final", minClaims: 1 });

  return {
    ok: claimGate?.ok ?? true,
    runDir: options.runDir,
    reportPath,
    url: options.url,
    platformCapabilities,
    capabilityRecords,
    pageCaptureRecords: browserResult.pageCaptureRecords,
    frameRecords,
    assessmentRecords,
    assessment,
    claims,
    ...(claimGate === undefined ? {} : { claimGate })
  };
}

async function captureBrowserEvidence(input: {
  options: EvidenceWorkflowOptions;
  parsedUrl: URL;
  baseCaptureId: string;
  writer: ArtifactWriter;
}): Promise<{
  pageCaptureRecords: ArtifactRecord[];
  frameResult?: FrameSampleRunResult;
  frameFailureRecords: ArtifactRecord[];
  frameError?: string;
}> {
  const leaseManager = new LeaseManager();
  const pool = new BrowserPool(leaseManager, { navigationTimeoutMs: input.options.navigationTimeoutMs ?? 30_000 });
  const agentId = "evidence-runner";
  const frameFailureRecords: ArtifactRecord[] = [];

  try {
    const lease = leaseManager.acquire({
      agentId,
      runId: input.baseCaptureId,
      artifactRunDir: input.options.runDir,
      allowedDomains: [input.parsedUrl.hostname],
      maxPages: 1,
      ttlMs: 180_000
    });
    const page = await pool.openPage(agentId, lease.contextToken, input.options.url);
    if ((input.options.waitMs ?? 3_000) > 0) {
      await pool.waitForPage(agentId, lease.contextToken, page.pageId, input.options.waitMs ?? 3_000);
    }
    const capture = await pool.capturePage(agentId, lease.contextToken, page.pageId, `${input.baseCaptureId}-page-capture`);
    let frameResult: FrameSampleRunResult | undefined;
    let frameError: string | undefined;
    if (input.options.sampleFrames !== false) {
      try {
        const selector = input.options.frameSelector ?? "video";
        await pool.waitForSelector(agentId, lease.contextToken, page.pageId, selector, 10_000);
        frameResult = await pool.sampleFrames(agentId, lease.contextToken, page.pageId, {
          selector,
          captureId: `${input.baseCaptureId}-frame-sample`,
          timestampsSec: input.options.timestampsSec ?? [0, 10],
          strideSec: 60,
          maxFrames: input.options.maxFrames ?? 2,
          seekTimeoutMs: input.options.seekTimeoutMs ?? 10_000,
          settleMs: input.options.settleMs ?? 500
        });
      } catch (error) {
        frameError = error instanceof Error ? error.message : String(error);
        frameFailureRecords.push(...await input.writer.recordFailure({
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
        }));
      }
    }
    await pool.releaseContext(agentId, lease.contextToken).catch(() => undefined);
    return {
      pageCaptureRecords: capture.records,
      ...(frameResult === undefined ? {} : { frameResult }),
      frameFailureRecords,
      ...(frameError === undefined ? {} : { frameError })
    };
  } catch (error) {
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
    return { pageCaptureRecords, frameFailureRecords, frameError: message };
  } finally {
    await pool.shutdown();
  }
}

function summarizeFrameSampling(
  frameResult: FrameSampleRunResult | undefined,
  frameError: string | undefined,
  skipped: boolean
): FrameSamplingAssessment {
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
  return {
    status: frameResult.status,
    timestampsSec: frameResult.plan.timestampsSec,
    frames: frameResult.frames.map((frame) => ({
      timestampSec: frame.timestampSec,
      status: frame.status,
      seek: frame.seek
    }))
  };
}

function buildClaims(input: {
  baseCaptureId: string;
  platformCapabilities: PlatformCapabilityMap;
  capabilityRecords: ArtifactRecord[];
  pageCaptureRecords: ArtifactRecord[];
  frameRecords: ArtifactRecord[];
  assessmentRecords: ArtifactRecord[];
  frameSampling: FrameSamplingAssessment;
}): EvidenceWorkflowClaim[] {
  const capabilityEvidence = selectEvidence(input.capabilityRecords);
  const pageEvidence = selectEvidence(input.pageCaptureRecords, "screenshot") ?? selectEvidence(input.pageCaptureRecords);
  const frameEvidence = selectEvidence(input.frameRecords, "screenshot") ?? selectEvidence(input.frameRecords) ?? selectEvidence(input.assessmentRecords);
  const assessmentEvidence = selectEvidence(input.assessmentRecords);
  return [
    {
      claim_id: `${input.baseCaptureId}-C1`,
      claim: `The target URL is classified as ${input.platformCapabilities.platform}; raw video bytes are not treated as verified evidence.`,
      evidence: capabilityEvidence
    },
    {
      claim_id: `${input.baseCaptureId}-C2`,
      claim: "A browser-visible page capture was attempted and registered in the artifact ledger.",
      evidence: pageEvidence
    },
    {
      claim_id: `${input.baseCaptureId}-C3`,
      claim: input.frameSampling.status === "ok"
        ? "Timestamped visual frame sampling produced registered frame evidence."
        : `Timestamped visual frame sampling is ${input.frameSampling.status} and is represented by registered partial/assessment evidence.`,
      evidence: frameEvidence
    },
    {
      claim_id: `${input.baseCaptureId}-C4`,
      claim: "Audio and full transcript understanding are explicitly unverified unless an authorized caption body or audio transcription artifact is present.",
      evidence: assessmentEvidence
    }
  ].filter((claim): claim is EvidenceWorkflowClaim => typeof claim.evidence === "string" && claim.evidence.length > 0);
}

function selectEvidence(records: ArtifactRecord[], kind?: ArtifactRecord["kind"]): string | undefined {
  const record = kind === undefined ? records[0] : records.find((item) => item.kind === kind);
  return record?.artifact_id ?? record?.path;
}

async function appendClaims(runDir: string, claims: EvidenceWorkflowClaim[]): Promise<void> {
  for (const claim of claims) {
    await appendJsonl(join(runDir, "claims.jsonl"), claim);
    await appendJsonl(join(runDir, "citations.jsonl"), { claim_id: claim.claim_id, evidence: claim.evidence });
  }
}

async function writeReport(path: string, input: {
  url: string;
  runDir: string;
  assessment: EvidenceWorkflowAssessment;
  claims: EvidenceWorkflowClaim[];
}): Promise<void> {
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
    `- Media ID: ${input.assessment.mediaId ?? "unknown"}`,
    `- Browser capture records: ${input.assessment.browserCaptureRecords}`,
    `- Frame sampling: ${input.assessment.frameSampling.status}`,
    `- Audio verified: ${input.assessment.audioVerified}`,
    `- Raw video bytes collected: ${input.assessment.rawVideoBytesCollected}`,
    `- Transcript verified in this run: ${input.assessment.transcript.verifiedInThisRun}`,
    ""
  ].join("\n");
  await writeFile(path, report, "utf8");
}

async function appendJsonl(path: string, row: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(row)}\n`, "utf8");
}
