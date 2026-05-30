import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserPool } from "./browser-pool.js";
import { runClaimGate, type ClaimGateOptions } from "./claim-gate.js";
import { normalizeEvidenceRunInput } from "./evidence-run-input.js";
import { runEvidenceWorkflow } from "./evidence-runner.js";
import { LeaseManager, redactLease } from "./lease-manager.js";
import {
  AcquireContextInputSchema,
  CaptureAfterIdleInputSchema,
  CaptureInputSchema,
  ClosePageInputSchema,
  ClickInputSchema,
  FillInputSchema,
  HeartbeatInputSchema,
  OpenPageInputSchema,
  PressInputSchema,
  ReleaseContextInputSchema,
  SampleFramesInputSchema,
  ScrollInputSchema,
  SelectOptionInputSchema,
  WaitForSelectorInputSchema,
  WaitInputSchema,
  EvidenceRunInputSchema,
  ReadReportInputSchema,
  ListArtifactsInputSchema,
  RunClaimGateInputSchema,
  ReadArtifactInputSchema,
  type AcquireContextInput,
  type CaptureAfterIdleInput,
  type CaptureInput,
  type ClosePageInput,
  type ClickInput,
  type FillInput,
  type HeartbeatInput,
  type OpenPageInput,
  type PressInput,
  type ReleaseContextInput,
  type SampleFramesInput,
  type ScrollInput,
  type SelectOptionInput,
  type WaitForSelectorInput,
  type WaitInput,
  type EvidenceRunInput,
  type ReadReportInput,
  type ListArtifactsInput,
  type RunClaimGateInput,
  type ReadArtifactInput
} from "./schemas.js";

export class FarmService {
  readonly leaseManager: LeaseManager;
  readonly browserPool: BrowserPool;

  constructor(leaseManager = new LeaseManager(), browserPool?: BrowserPool) {
    this.leaseManager = leaseManager;
    this.browserPool = browserPool ?? new BrowserPool(leaseManager);
  }

  acquireContext(input: AcquireContextInput) {
    return { ok: true as const, lease: redactLease(this.leaseManager.acquire(AcquireContextInputSchema.parse(input))) };
  }

  heartbeat(input: HeartbeatInput) {
    const parsed = HeartbeatInputSchema.parse(input);
    const lease = redactLease(this.leaseManager.heartbeat(parsed.contextToken, parsed.agentId));
    // Keep the cross-process profile lock fresh for the duration of an active
    // lease, so a long (heartbeated) run is never reaped+stolen by the TTL.
    this.browserPool.touchProfileLock(parsed.contextToken);
    return { ok: true as const, lease };
  }

  async openPage(input: OpenPageInput) {
    const parsed = OpenPageInputSchema.parse(input);
    const page = await this.browserPool.openPage(parsed.agentId, parsed.contextToken, parsed.url);
    return { ok: true as const, page };
  }

  async capture(input: CaptureInput) {
    const parsed = CaptureInputSchema.parse(input);
    const capture = await this.browserPool.capturePage(parsed.agentId, parsed.contextToken, parsed.pageId, parsed.captureId);
    return { ok: true as const, ...capture };
  }

  async wait(input: WaitInput) {
    const parsed = WaitInputSchema.parse(input);
    return this.browserPool.waitForPage(parsed.agentId, parsed.contextToken, parsed.pageId, parsed.waitMs);
  }

  async waitForSelector(input: WaitForSelectorInput) {
    const parsed = WaitForSelectorInputSchema.parse(input);
    return this.browserPool.waitForSelector(parsed.agentId, parsed.contextToken, parsed.pageId, parsed.selector, parsed.timeoutMs);
  }

  async scroll(input: ScrollInput) {
    const parsed = ScrollInputSchema.parse(input);
    return this.browserPool.scroll(parsed.agentId, parsed.contextToken, parsed.pageId, parsed.direction, parsed.pixels);
  }

  async captureAfterIdle(input: CaptureAfterIdleInput) {
    const parsed = CaptureAfterIdleInputSchema.parse(input);
    const capture = await this.browserPool.captureAfterIdle(
      parsed.agentId,
      parsed.contextToken,
      parsed.pageId,
      parsed.captureId,
      parsed.waitMs,
      parsed.idleMs,
      parsed.timeoutMs
    );
    return { ok: true as const, ...capture };
  }

  async sampleFrames(input: SampleFramesInput) {
    const parsed = SampleFramesInputSchema.parse(input);
    return this.browserPool.sampleFrames(parsed.agentId, parsed.contextToken, parsed.pageId, parsed);
  }

  async closePage(input: ClosePageInput) {
    const parsed = ClosePageInputSchema.parse(input);
    await this.browserPool.closePage(parsed.agentId, parsed.contextToken, parsed.pageId);
    return { ok: true as const };
  }

  async click(input: ClickInput) {
    const parsed = ClickInputSchema.parse(input);
    return this.browserPool.click(parsed.agentId, parsed.contextToken, parsed.pageId, parsed.selector);
  }

  async fill(input: FillInput) {
    const parsed = FillInputSchema.parse(input);
    return this.browserPool.fill(parsed.agentId, parsed.contextToken, parsed.pageId, parsed.selector, parsed.value);
  }

  async press(input: PressInput) {
    const parsed = PressInputSchema.parse(input);
    return this.browserPool.press(parsed.agentId, parsed.contextToken, parsed.pageId, parsed.key);
  }

  async selectOption(input: SelectOptionInput) {
    const parsed = SelectOptionInputSchema.parse(input);
    return this.browserPool.selectOption(parsed.agentId, parsed.contextToken, parsed.pageId, parsed.selector, parsed.value);
  }

  async releaseContext(input: ReleaseContextInput) {
    const parsed = ReleaseContextInputSchema.parse(input);
    await this.browserPool.releaseContext(parsed.agentId, parsed.contextToken);
    return { ok: true as const };
  }

  async reapExpired() {
    const expired = this.leaseManager.reapExpired();
    for (const lease of expired) {
      await this.browserPool.closeContext(lease.contextToken);
    }
    return { ok: true as const, expired: expired.map(redactLease) };
  }

  listLeases() {
    return { ok: true as const, leases: this.leaseManager.list().map(redactLease) };
  }

  // Read-only evidence-loop tools: let a pure-MCP agent read back what a prior
  // evidence run produced (report, artifact ledger) and re-validate it, without
  // opening a browser.
  async readReport(input: ReadReportInput) {
    const parsed = ReadReportInputSchema.parse(input);
    const content = await readFile(parsed.reportPath, "utf8");
    return { ok: true as const, reportPath: parsed.reportPath, content };
  }

  async listArtifacts(input: ListArtifactsInput) {
    const parsed = ListArtifactsInputSchema.parse(input);
    const text = await readFile(join(parsed.runDir, "artifacts.jsonl"), "utf8").catch(() => "");
    const rows = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter((row): row is Record<string, unknown> => row !== undefined);
    const filtered = parsed.evidenceKind === undefined
      ? rows
      : rows.filter((row) => row.evidence_kind === parsed.evidenceKind);
    const artifacts = filtered.slice(-parsed.limit).reverse();
    return { ok: true as const, runDir: parsed.runDir, total: filtered.length, returned: artifacts.length, artifacts };
  }

  async runClaimGate(input: RunClaimGateInput) {
    const parsed = RunClaimGateInputSchema.parse(input);
    const options: ClaimGateOptions = { mode: parsed.mode };
    if (parsed.minClaims !== undefined) {
      options.minClaims = parsed.minClaims;
    }
    return runClaimGate(parsed.runDir, options);
  }

  // Read one registered artifact's bytes, RE-HASHING on read so a parallel agent
  // can both see the evidence and detect tampering (recordedSha256 vs recomputed).
  async readArtifact(input: ReadArtifactInput) {
    const parsed = ReadArtifactInputSchema.parse(input);
    const text = await readFile(join(parsed.runDir, "artifacts.jsonl"), "utf8").catch(() => "");
    const rows = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .filter((row): row is Record<string, unknown> => row !== undefined);
    const row = rows.find((candidate) =>
      (parsed.artifactId !== undefined && candidate.artifact_id === parsed.artifactId) ||
      (parsed.path !== undefined && candidate.path === parsed.path));
    if (row === undefined || typeof row.path !== "string") {
      return { ok: false as const, found: false as const, runDir: parsed.runDir };
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(join(parsed.runDir, row.path));
    } catch {
      return { ok: false as const, found: true as const, missingOnDisk: true as const, path: row.path };
    }
    const recomputedSha256 = createHash("sha256").update(bytes).digest("hex");
    const recordedSha256 = typeof row.sha256 === "string" ? row.sha256 : undefined;
    const tampered = recordedSha256 !== undefined && recordedSha256 !== recomputedSha256;
    const evidenceKind = typeof row.evidence_kind === "string" ? row.evidence_kind : undefined;
    const asText = parsed.asText ?? isTextLikeEvidenceKind(evidenceKind);
    const slice = bytes.subarray(0, parsed.maxBytes);
    return {
      ok: !tampered,
      found: true as const,
      artifactId: typeof row.artifact_id === "string" ? row.artifact_id : undefined,
      path: row.path,
      evidenceKind,
      sourceUrl: typeof row.source_url === "string" ? row.source_url : undefined,
      bytes: bytes.byteLength,
      recordedSha256,
      recomputedSha256,
      tampered,
      encoding: asText ? ("utf8" as const) : ("base64" as const),
      truncated: bytes.byteLength > slice.byteLength,
      content: asText ? slice.toString("utf8") : slice.toString("base64")
    };
  }

  async evidenceRun(input: EvidenceRunInput) {
    const parsed = EvidenceRunInputSchema.parse(input);
    if (parsed.headed) {
      throw new Error("headed evidence-run is available through the CLI; MCP evidence-run uses the server BrowserPool lifecycle.");
    }
    const options = await normalizeEvidenceRunInput(parsed);
    const result = await runEvidenceWorkflow(options, {
      leaseManager: this.leaseManager,
      browserPool: this.browserPool
    });
    return {
      ok: result.ok,
      runDir: result.runDir,
      reportPath: result.reportPath,
      platform: result.platformCapabilities.platform,
      sourceStrategy: {
        platform: result.sourceStrategy.platform,
        family: result.sourceStrategy.sourceFamily
      },
      sourceRegistry: result.assessment.sourceRegistry,
      sourceNavigationPlan: result.assessment.sourceNavigationPlan,
      sourceNavigationExecutionPlan: result.assessment.sourceNavigationExecutionPlan,
      sourceNavigationRecipePlan: result.assessment.sourceNavigationRecipePlan,
      sourceNavigationCalibration: result.assessment.sourceNavigationCalibration,
      sourceNavigationExecution: result.assessment.sourceNavigationExecution,
      sourceNavigationFollowUps: result.assessment.sourceNavigationFollowUps,
      destinationTriage: result.assessment.destinationTriage,
      destinationDeepeningProposals: result.assessment.destinationDeepeningProposals,
      destinationDeepeningExecution: result.assessment.destinationDeepeningExecution,
      mediaId: result.platformCapabilities.mediaId,
      claims: result.claims.length,
      claimGate: result.claimGate,
      frameSampling: result.assessment.frameSampling,
      stageTimings: result.stageTimings,
      artifacts: {
        capability: result.capabilityRecords.length,
        sourceStrategy: result.sourceStrategyRecords.length,
        sourceRegistry: result.sourceRegistryRecords.length,
        sourceNavigationPlan: result.sourceNavigationPlanRecords.length,
        sourceNavigationExecutionPlan: result.sourceNavigationExecutionPlanRecords.length,
        sourceNavigationRecipePlan: result.sourceNavigationRecipePlanRecords.length,
        sourceNavigationCalibration: result.sourceNavigationCalibrationRecords.length,
        sourceNavigationActions: result.sourceNavigationActionRecords.length,
        sourceNavigationFollowUps: result.sourceNavigationFollowUpRecords.length,
        destinationCandidates: result.destinationCandidateRecords.length,
        destinationTriage: result.destinationTriageRecords.length,
        destinationDeepeningProposals: result.destinationDeepeningProposalRecords.length,
        destinationDeepeningRuns: result.destinationDeepeningRunRecords.length,
        page: result.pageCaptureRecords.length,
        frames: result.frameRecords.length,
        ocr: result.ocrRecords.length,
        officialApi: result.officialApiRecords.length,
        overlayDismissal: result.overlayDismissalRecords.length,
        obstruction: result.obstructionRecords.length,
        assessment: result.assessmentRecords.length
      }
    };
  }

  shutdown() {
    return this.browserPool.shutdown();
  }
}

function isTextLikeEvidenceKind(kind: string | undefined): boolean {
  return kind !== "page_screenshot" && kind !== "frame_screenshot" && kind !== "media";
}
