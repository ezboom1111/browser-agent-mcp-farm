import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter, type ArtifactRecord } from "../src/artifact-writer.js";
import { runClaimGate } from "../src/claim-gate.js";
import type { EvidenceKind } from "../src/schemas.js";

let runDirs: string[] = [];

describe("runClaimGate", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("passes when claims cite registered artifacts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-pass-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "gate",
      text: "Evidence"
    });
    const evidence = records[0]?.artifact_id;
    if (!evidence) {
      throw new Error("Expected a registered artifact");
    }

    await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify({ claim_id: "claim-1", claim: "Supported", evidence })}\n`);
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: "claim-1", evidence })}\n`);

    const result = await runClaimGate(runDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when claims cite unregistered artifacts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-fail-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "gate",
      text: "Evidence"
    });

    await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify({ claim_id: "claim-1", claim: "Unsupported", evidence: "raw/missing.html" })}\n`);
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: "claim-1", evidence: "raw/missing.html" })}\n`);

    const result = await runClaimGate(runDir);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("not registered");
  });

  it("passes zero-claim smoke runs with a warning", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-smoke-empty-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "gate",
      text: "Evidence"
    });

    const result = await runClaimGate(runDir);
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("no claims");
  });

  it("fails zero-claim final runs", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-final-empty-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "gate",
      text: "Evidence"
    });

    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("claim count below required minimum");
  });

  it("passes typed visual claims only with timestamped frame screenshots", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-visual-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/video",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "frame",
      screenshot: Buffer.from("fake-png"),
      toolName: "farm_sample_frames"
    });
    const frame = records.find((record) => record.evidence_kind === "frame_screenshot");
    if (!frame) {
      throw new Error("Expected frame screenshot artifact");
    }

    await appendTypedClaim(runDir, {
      claim_id: "visual-1",
      claim_type: "visual",
      claim: "Visible frame evidence exists.",
      artifact_id: frame.artifact_id,
      evidence_kind: "frame_screenshot",
      verification_level: "browser_visible",
      timestampSec: 3
    });

    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails visual claims without frame screenshot evidence", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-visual-fail-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "page",
      screenshot: Buffer.from("fake-png")
    });
    const page = records.find((record) => record.evidence_kind === "page_screenshot");
    if (!page) {
      throw new Error("Expected page screenshot artifact");
    }

    await appendTypedClaim(runDir, {
      claim_id: "visual-1",
      claim_type: "visual",
      claim: "Page screenshot is not enough for video timestamp evidence.",
      artifact_id: page.artifact_id,
      evidence_kind: "page_screenshot",
      verification_level: "browser_visible",
      timestampSec: 3
    });

    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("visual claim must cite a timestamped frame screenshot");
  });

  it("passes transcript and audio claims only with matching semantic artifacts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-semantic-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    const transcriptRecords = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/captions.vtt",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "captioned",
      mediaArtifacts: [{
        url: "https://example.com/captions.vtt",
        bytes: Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\ncaption text\n", "utf8"),
        mime: "text/vtt",
        resourceType: "media"
      }]
    });
    const transcript = transcriptRecords.find((record) => record.evidence_kind === "transcript_cue");
    const audioRecords = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/audio",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "audio",
      text: "spoken words",
      evidenceKind: "audio_transcription"
    });
    const audio = audioRecords.find((record) => record.evidence_kind === "audio_transcription");
    if (!transcript || !audio) {
      throw new Error("Expected transcript and audio artifacts");
    }

    await appendTypedClaim(runDir, {
      claim_id: "text-1",
      claim_type: "text",
      claim: "Caption text exists.",
      artifact_id: transcript.artifact_id,
      evidence_kind: "transcript_cue",
      verification_level: "transcript_cue"
    });
    await appendTypedClaim(runDir, {
      claim_id: "audio-1",
      claim_type: "audio",
      claim: "Audio transcription exists.",
      artifact_id: audio.artifact_id,
      evidence_kind: "audio_transcription",
      verification_level: "verified"
    });

    const result = await runClaimGate(runDir, { mode: "final", minClaims: 2 });
    expect(result.ok).toBe(true);
  });

  it("fails untyped final claims", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-untyped-final-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "gate",
      text: "Evidence"
    });
    const evidence = records[0]?.artifact_id;
    if (!evidence) {
      throw new Error("Expected a registered artifact");
    }

    await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify({ claim_id: "claim-1", claim: "Legacy", evidence })}\n`);
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: "claim-1", evidence })}\n`);

    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("schema_version");
  });

  it("requires destination claims to cite parent and child provenance artifacts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-destination-provenance-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    const action = await writeEvidenceArtifact(writer, runDir, "source_navigation_action");
    const candidate = await writeEvidenceArtifact(writer, runDir, "destination_candidate");
    const followUp = await writeEvidenceArtifact(writer, runDir, "source_navigation_followup");
    const triage = await writeEvidenceArtifact(writer, runDir, "destination_triage");

    await appendTypedClaim(runDir, {
      claim_id: "destination-1",
      claim_type: "metadata",
      claim: "Destination triage preserved parent and child evidence.",
      artifact_id: triage.artifact_id,
      evidence_kind: "destination_triage",
      verification_level: "verified",
      extraCitations: [action, candidate, followUp]
    });

    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails destination claims missing provenance citations", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-destination-provenance-fail-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    const action = await writeEvidenceArtifact(writer, runDir, "source_navigation_action");
    const candidate = await writeEvidenceArtifact(writer, runDir, "destination_candidate");
    const triage = await writeEvidenceArtifact(writer, runDir, "destination_triage");

    await appendTypedClaim(runDir, {
      claim_id: "destination-1",
      claim_type: "metadata",
      claim: "Destination triage without child follow-up provenance is incomplete.",
      artifact_id: triage.artifact_id,
      evidence_kind: "destination_triage",
      verification_level: "verified",
      extraCitations: [action, candidate]
    });

    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("destination claim missing provenance citation");
    expect(result.errors.join("\n")).toContain("source_navigation_followup");
  });

  it("requires depth-2 destination claims to cite the deeper proposal chain", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-destination-deepening-provenance-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    const action = await writeEvidenceArtifact(writer, runDir, "source_navigation_action");
    const candidate = await writeEvidenceArtifact(writer, runDir, "destination_candidate");
    const followUp = await writeEvidenceArtifact(writer, runDir, "source_navigation_followup");
    const proposal = await writeEvidenceArtifact(writer, runDir, "destination_deepening_proposal");
    const deepeningRun = await writeEvidenceArtifact(writer, runDir, "destination_deepening_run");

    await appendTypedClaim(runDir, {
      claim_id: "destination-depth-2",
      claim_type: "metadata",
      claim: "Depth-2 destination evidence preserved the parent chain.",
      artifact_id: deepeningRun.artifact_id,
      evidence_kind: "destination_deepening_run",
      verification_level: "verified",
      extraCitations: [action, candidate, followUp, proposal]
    });

    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(true);
  });

  it("fails when a claim's only citation has no usable evidence reference", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-orphan-citation-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "gate",
      text: "Evidence"
    });
    const evidence = records[0]?.artifact_id;
    if (!evidence) {
      throw new Error("Expected a registered artifact");
    }

    // The claim cites a registered artifact, but its only citation row carries
    // no usable evidence/artifact reference. Before the per-claim fix this left
    // the global citation-ref set empty and silently passed every claim.
    await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify({ claim_id: "claim-1", claim: "Orphan", evidence })}\n`);
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: "claim-1" })}\n`);

    const result = await runClaimGate(runDir);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("no usable evidence reference");
  });

  it("fails when a citation points at a different artifact than the claim evidence", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-claim-citation-mismatch-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    const aRecords = await writer.writeCaptureBundle({
      runDir, sourceUrl: "https://example.com/a", contextToken: "ctx_test", pageId: "page_a", captureId: "a", text: "Evidence A"
    });
    const bRecords = await writer.writeCaptureBundle({
      runDir, sourceUrl: "https://example.com/b", contextToken: "ctx_test", pageId: "page_b", captureId: "b", text: "Evidence B"
    });
    const evidenceA = aRecords[0]?.artifact_id;
    const evidenceB = bRecords[0]?.artifact_id;
    if (!evidenceA || !evidenceB) {
      throw new Error("Expected two registered artifacts");
    }

    // The claim cites artifact A, but the citation row points at artifact B.
    await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify({ claim_id: "claim-1", claim: "Mismatch", evidence: evidenceA })}\n`);
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: "claim-1", evidence: evidenceB })}\n`);

    const result = await runClaimGate(runDir);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("does not match evidence");
  });
});

async function appendTypedClaim(runDir: string, claim: {
  claim_id: string;
  claim_type: "visual" | "text" | "metadata" | "audio" | "inference";
  claim: string;
  artifact_id: string;
  evidence_kind: EvidenceKind | string;
  verification_level: string;
  timestampSec?: number;
  extraCitations?: ArtifactRecord[];
}): Promise<void> {
  const row = {
    schema_version: "1.0",
    ...claim,
    evidence: claim.artifact_id
  };
  await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify(row)}\n`);
  await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: claim.claim_id, evidence: claim.artifact_id, artifact_id: claim.artifact_id, evidence_kind: claim.evidence_kind })}\n`);
  for (const record of claim.extraCitations ?? []) {
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({
      claim_id: claim.claim_id,
      evidence: record.artifact_id,
      artifact_id: record.artifact_id,
      evidence_kind: record.evidence_kind
    })}\n`);
  }
}

async function writeEvidenceArtifact(
  writer: ArtifactWriter,
  runDir: string,
  evidenceKind: EvidenceKind
): Promise<ArtifactRecord> {
  const records = await writer.writeCaptureBundle({
    runDir,
    sourceUrl: "https://example.com/",
    contextToken: "ctx_test",
    pageId: evidenceKind,
    captureId: evidenceKind,
    text: `${evidenceKind} evidence`,
    evidenceKind
  });
  const record = records.find((item) => item.evidence_kind === evidenceKind);
  if (record === undefined) {
    throw new Error(`Expected ${evidenceKind} artifact`);
  }
  return record;
}
