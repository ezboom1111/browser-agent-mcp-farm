import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactWriter, type CaptureBundleInput } from "./artifact-writer.js";
import { BrowserPool } from "./browser-pool.js";
import { runClaimGate, type ClaimGateOptions } from "./claim-gate.js";
import { normalizeEvidenceRunInput } from "./evidence-run-input.js";
import { runEvidenceWorkflow } from "./evidence-runner.js";
import { extractStructuredData } from "./structured-extractor.js";
import { proposeGroundedClaims } from "./grounded-extraction.js";
import { parseWebVtt } from "./transcript-parser.js";
import type { EvidenceKind } from "./schemas.js";
import { buildBundleManifest, signManifest, verifyBundle as verifyEvidenceBundle, type BundleManifest } from "./evidence-bundle.js";
import { LeaseManager, leaseManagerOptionsFromEnv, redactLease } from "./lease-manager.js";
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
  RegisterEvidenceInputSchema,
  AddClaimInputSchema,
  ListRunsInputSchema,
  ExtractStructuredInputSchema,
  ExportBundleInputSchema,
  VerifyBundleInputSchema,
  EvidenceKindSchema,
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
  type ReadArtifactInput,
  type RegisterEvidenceInput,
  type AddClaimInput,
  type ListRunsInput,
  type ExtractStructuredInput,
  type ExportBundleInput,
  type VerifyBundleInput
} from "./schemas.js";

export class FarmService {
  readonly leaseManager: LeaseManager;
  readonly browserPool: BrowserPool;

  constructor(leaseManager = new LeaseManager(leaseManagerOptionsFromEnv()), browserPool?: BrowserPool) {
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
    const capture = await this.browserPool.captureAfterIdle(parsed.agentId, parsed.contextToken, parsed.pageId, parsed.captureId, parsed.waitMs, parsed.idleMs, parsed.timeoutMs);
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

  private async readArtifactRows(runDir: string): Promise<Array<Record<string, unknown>>> {
    const text = await readFile(join(runDir, "artifacts.jsonl"), "utf8").catch(() => "");
    return text
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
  }

  async listArtifacts(input: ListArtifactsInput) {
    const parsed = ListArtifactsInputSchema.parse(input);
    const rows = await this.readArtifactRows(parsed.runDir);
    const filtered = parsed.evidenceKind === undefined ? rows : rows.filter((row) => row.evidence_kind === parsed.evidenceKind);
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
    const rows = await this.readArtifactRows(parsed.runDir);
    const row = rows.find((candidate) => (parsed.artifactId !== undefined && candidate.artifact_id === parsed.artifactId) || (parsed.path !== undefined && candidate.path === parsed.path));
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

  // Register a piece of evidence (the bytes the agent saw) as a hash-verified
  // artifact the agent can then cite. Part of the cite-or-fail authoring loop.
  async registerEvidence(input: RegisterEvidenceInput) {
    const parsed = RegisterEvidenceInputSchema.parse(input);
    const writer = new ArtifactWriter();
    const bundleInput: CaptureBundleInput = {
      runDir: parsed.runDir,
      sourceUrl: parsed.sourceUrl,
      contextToken: "agent-authored",
      pageId: "agent",
      text: parsed.text,
      evidenceKind: parsed.evidenceKind,
      // Bring-your-own-capture: honor caller-supplied provenance (an external capturer records
      // its own method/id/time); default to agent-authored for the existing cite-or-fail path.
      captureMethod: parsed.captureMethod ?? "agent-authored"
    };
    if (parsed.captureId !== undefined) {
      bundleInput.captureId = parsed.captureId;
    }
    if (parsed.capturedBy !== undefined) {
      bundleInput.capturedBy = parsed.capturedBy;
    }
    if (parsed.capturedAt !== undefined) {
      bundleInput.capturedAt = parsed.capturedAt;
    }
    const records = await writer.writeCaptureBundle(bundleInput);
    // Select the raw text artifact (the one whose bytes hold the registered
    // text), not the sibling metadata.json that writeCaptureBundle also emits.
    const record = records.find((item) => item.kind === "text") ?? records[0];
    if (record === undefined) {
      return { ok: false as const, registered: false as const };
    }
    return {
      ok: true as const,
      registered: true as const,
      artifactId: record.artifact_id,
      path: record.path,
      sha256: record.sha256,
      evidenceKind: record.evidence_kind
    };
  }

  // Ingest a video's transcript (its spoken/caption track) from ANY lawful source — a YouTube
  // auto-caption fetch, yt-dlp --write-auto-sub, a transcript service, or a human paste — and
  // register it as a transcript_cue artifact. WebVTT is parsed into timed cues (parseWebVtt);
  // plain text is registered as-is. A spoken-content claim then cites this artifact with a
  // text_span anchor on the quoted phrase, so the gate verifies WHAT WAS SAID against the
  // captured transcript bytes. The farm performs no speech-to-text — the transcript is the
  // platform's own caption (e.g. Google's auto-ASR for YouTube), supplied lawfully and recorded
  // with bring-your-own-capture provenance.
  async registerTranscript(input: { runDir: string; sourceUrl: string; vtt?: string; text?: string; captureMethod?: string; capturedBy?: string }) {
    let transcriptText: string;
    let cueCount = 0;
    if (input.vtt !== undefined) {
      const parsed = parseWebVtt(input.vtt);
      if (parsed.cueCount === 0) {
        return { ok: false as const, error: "no transcript cues parsed from the supplied WebVTT" };
      }
      transcriptText = parsed.text;
      cueCount = parsed.cueCount;
    } else if (input.text !== undefined && input.text.trim().length > 0) {
      transcriptText = input.text;
    } else {
      return { ok: false as const, error: "provide a WebVTT (vtt) or plain-text (text) transcript" };
    }
    const reg = await this.registerEvidence({
      runDir: input.runDir,
      sourceUrl: input.sourceUrl,
      text: transcriptText,
      evidenceKind: "transcript_cue",
      captureMethod: input.captureMethod ?? "byo-transcript",
      capturedBy: input.capturedBy
    });
    if (!reg.registered) {
      return { ok: false as const, error: "failed to register transcript artifact" };
    }
    return { ok: true as const, artifactId: reg.artifactId, evidenceKind: "transcript_cue" as const, cueCount, chars: transcriptText.length };
  }

  // Author a substantive claim that cites a registered artifact, then run the
  // gate so the agent gets immediate cite-or-fail feedback (a claim whose anchor
  // is not grounded in the cited bytes makes gate.ok false).
  async addClaim(input: AddClaimInput) {
    const parsed = AddClaimInputSchema.parse(input);
    const registered = (await this.readArtifactRows(parsed.runDir)).some((row) => row.artifact_id === parsed.artifactId);
    if (!registered) {
      return { ok: false as const, appended: false as const, error: `cited artifact not registered: ${parsed.artifactId}` };
    }
    const claimId = `claim-${randomUUID()}`;
    const claimRow: Record<string, unknown> = {
      schema_version: "1.0",
      claim_id: claimId,
      claim_type: parsed.claimType,
      claim: parsed.claim,
      evidence: parsed.artifactId,
      artifact_id: parsed.artifactId,
      evidence_kind: parsed.evidenceKind,
      verification_level: parsed.verificationLevel
    };
    if (parsed.anchor !== undefined) {
      claimRow.anchor = parsed.anchor;
    }
    if (parsed.claimTaxonomy !== undefined) {
      claimRow.claim_taxonomy = parsed.claimTaxonomy;
    }
    if (parsed.timestampSec !== undefined) {
      claimRow.timestampSec = parsed.timestampSec;
    }
    const citationRow = {
      claim_id: claimId,
      evidence: parsed.artifactId,
      artifact_id: parsed.artifactId,
      evidence_kind: parsed.evidenceKind
    };
    await appendFile(join(parsed.runDir, "claims.jsonl"), `${JSON.stringify(claimRow)}\n`);
    await appendFile(join(parsed.runDir, "citations.jsonl"), `${JSON.stringify(citationRow)}\n`);
    const gate = await runClaimGate(parsed.runDir, { mode: "final", minClaims: 0 });
    return { ok: gate.ok, appended: true as const, claimId, gate };
  }

  // Self-description so an agent can confirm it reached THIS server (vs a
  // collidingly-named browse skill) and discover evidence kinds + non-goals.
  capabilities() {
    return {
      ok: true as const,
      serverName: "browser-agent-mcp-farm",
      version: "0.3.0",
      evidenceKinds: EvidenceKindSchema.options,
      nonGoals: ["no login / CAPTCHA / paywall / age-gate bypass", "no payments / bookings / account changes", "no raw video or audio stream download", "no full-video understanding without transcript/audio evidence"],
      optionalDeps: { tesseractAvailable: optionalDepAvailable("tesseract.js") }
    };
  }

  // Discover prior runs (so a parallel agent can find a runDir to read/verify).
  async listRuns(input: ListRunsInput) {
    const parsed = ListRunsInputSchema.parse(input);
    const root = parsed.runRoot ?? tmpdir();
    const runs: Array<{ runDir: string; artifactCount: number; claimCount: number; hasReport: boolean }> = [];
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const runDir = join(root, entry.name);
        if (!existsSync(join(runDir, "artifacts.jsonl"))) {
          continue;
        }
        runs.push({
          runDir,
          artifactCount: countJsonlLines(await readFile(join(runDir, "artifacts.jsonl"), "utf8").catch(() => "")),
          claimCount: countJsonlLines(await readFile(join(runDir, "claims.jsonl"), "utf8").catch(() => "")),
          hasReport: existsSync(join(runDir, "reports"))
        });
      }
    } catch {
      // unreadable root -> empty list
    }
    return { ok: true as const, runRoot: root, runs: runs.slice(0, parsed.limit) };
  }

  // Deterministic structured-data extraction over captured HTML (JSON-LD, Open
  // Graph, Twitter cards, canonical, title). Publisher markup is a site claim.
  async extractStructured(input: ExtractStructuredInput) {
    const parsed = ExtractStructuredInputSchema.parse(input);
    let html = parsed.html;
    if (html === undefined && parsed.runDir !== undefined) {
      const row = (await this.readArtifactRows(parsed.runDir)).find((candidate) => (parsed.artifactId !== undefined && candidate.artifact_id === parsed.artifactId) || (parsed.path !== undefined && candidate.path === parsed.path));
      if (row !== undefined && typeof row.path === "string") {
        html = await readFile(join(parsed.runDir, row.path), "utf8").catch(() => undefined);
      }
    }
    if (html === undefined) {
      return { ok: false as const, error: "could not load HTML (provide html, or a valid runDir + artifactId/path)" };
    }
    return {
      ok: true as const,
      ...extractStructuredData(html),
      note: "Publisher markup (JSON-LD / Open Graph) is a site claim, not ground truth; cross-check against DOM/OCR."
    };
  }

  // Verifiable generic-extraction loop: extract typed values from a captured HTML artifact and
  // author a text_span-anchored claim, citing the VISIBLE-TEXT artifact, for each value that
  // literally appears in what a human sees. Grounding against visible text (not the raw HTML
  // that contains the JSON-LD) keeps it non-tautological — a publisher value that disagrees with
  // the rendered page is never grounded. addClaim re-runs the gate, so an invented value is
  // never groundable: extraction proposes, the gate decides. Deterministic, no LLM.
  async groundExtractedClaims(input: { runDir: string; htmlArtifactId: string; textArtifactId: string }) {
    const rows = await this.readArtifactRows(input.runDir);
    const htmlRow = rows.find((candidate) => candidate.artifact_id === input.htmlArtifactId);
    const textRow = rows.find((candidate) => candidate.artifact_id === input.textArtifactId);
    if (htmlRow === undefined || typeof htmlRow.path !== "string") {
      return { ok: false as const, error: `html artifact not found: ${input.htmlArtifactId}` };
    }
    if (textRow === undefined || typeof textRow.path !== "string") {
      return { ok: false as const, error: `text artifact not found: ${input.textArtifactId}` };
    }
    const html = await readFile(join(input.runDir, htmlRow.path), "utf8").catch(() => undefined);
    const visibleText = await readFile(join(input.runDir, textRow.path), "utf8").catch(() => undefined);
    if (html === undefined || visibleText === undefined) {
      return { ok: false as const, error: "could not read artifact bytes" };
    }
    const evidenceKind: EvidenceKind = (typeof textRow.evidence_kind === "string" ? textRow.evidence_kind : "page_text") as EvidenceKind;
    const proposals = proposeGroundedClaims(extractStructuredData(html), visibleText, evidenceKind);

    const claims: Array<{ field: string; claim: string; grounded: boolean }> = [];
    for (const proposal of proposals) {
      const result = await this.addClaim({
        runDir: input.runDir,
        artifactId: input.textArtifactId,
        claim: proposal.claim,
        claimType: proposal.claimType,
        evidenceKind: proposal.evidenceKind,
        verificationLevel: "grounded",
        anchor: proposal.anchor
      });
      const grounded = (result as { gate?: { ok?: boolean }; appended?: boolean }).gate?.ok ?? Boolean((result as { appended?: boolean }).appended);
      claims.push({ field: proposal.field, claim: proposal.claim, grounded });
    }
    return {
      ok: true as const,
      proposed: proposals.length,
      grounded: claims.filter((claim) => claim.grounded).length,
      claims
    };
  }

  // Export a verifiable bundle manifest (Merkle root over artifact hashes +
  // optional Ed25519 signature) for a run, so a second agent can re-verify it.
  async exportBundle(input: ExportBundleInput) {
    const parsed = ExportBundleInputSchema.parse(input);
    const manifest = await buildBundleManifest(parsed.runDir);
    if (parsed.privateKeyEnv !== undefined) {
      const pem = process.env[parsed.privateKeyEnv];
      if (pem !== undefined && pem.length > 0) {
        manifest.signature = signManifest(manifest, pem);
      }
    }
    return { ok: true as const, signed: manifest.signature !== undefined, manifest };
  }

  // Re-verify a bundle against the run's artifacts in place: re-hashes each file
  // (detects tampered bytes), recomputes the Merkle root (detects a tampered
  // manifest), and optionally checks the signature. No network.
  async verifyBundle(input: VerifyBundleInput) {
    const parsed = VerifyBundleInputSchema.parse(input);
    const publicKeyPem = parsed.publicKeyEnv !== undefined ? process.env[parsed.publicKeyEnv] : undefined;
    return verifyEvidenceBundle(parsed.runDir, parsed.manifest as BundleManifest, publicKeyPem);
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

function countJsonlLines(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

const requireForOptionalDeps = createRequire(import.meta.url);

function optionalDepAvailable(name: string): boolean {
  try {
    requireForOptionalDeps.resolve(name);
    return true;
  } catch {
    return false;
  }
}
