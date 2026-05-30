import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactWriter } from "../src/artifact-writer.js";
import { runClaimGate } from "../src/claim-gate.js";

// Targets claim-gate.ts branches the existing claim-gate.test.ts does not exercise:
// the SMOKE-mode typed-claim warnings (validateSmokeTypedClaim) and the FINAL-mode
// non-text anchor structural checks (ocr_bbox / transcript_cue / frame requiring a
// matching artifact kind), plus a couple of plain claim-graph error branches. All
// direct-API, no Chromium / no network / temp-dir only.

let runDirs: string[] = [];

afterEach(async () => {
  await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  runDirs = [];
});

// Builds a run with a single registered text artifact and returns its id + kind.
async function runWithTextArtifact(): Promise<{ runDir: string; evidence: string; kind: string }> {
  const runDir = await mkdtemp(join(tmpdir(), "farm-claim-extra-"));
  runDirs.push(runDir);
  const writer = new ArtifactWriter();
  const records = await writer.writeCaptureBundle({
    runDir,
    sourceUrl: "https://example.com/",
    contextToken: "ctx",
    pageId: "p",
    captureId: "gate",
    text: "Evidence body"
  });
  const record = records[0];
  if (record?.artifact_id === undefined) {
    throw new Error("expected a registered text artifact");
  }
  return { runDir, evidence: record.artifact_id, kind: String(record.evidence_kind ?? "page_text") };
}

async function writeClaim(runDir: string, claim: Record<string, unknown>, citation?: Record<string, unknown>): Promise<void> {
  await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify(claim)}\n`);
  if (citation !== undefined) {
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify(citation)}\n`);
  }
}

describe("runClaimGate smoke-mode typed-claim warnings", () => {
  it("warns on an unknown claim_type without failing the smoke gate", async () => {
    const { runDir, evidence } = await runWithTextArtifact();
    await writeClaim(runDir, { claim_id: "c1", claim: "x", evidence, claim_type: "totally-not-a-type" }, { claim_id: "c1", evidence });
    const result = await runClaimGate(runDir, { mode: "smoke" });
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("claim has unknown claim_type");
  });

  it("warns on an unknown evidence_kind without failing the smoke gate", async () => {
    const { runDir, evidence } = await runWithTextArtifact();
    await writeClaim(runDir, { claim_id: "c1", claim: "x", evidence, evidence_kind: "totally-not-a-kind" }, { claim_id: "c1", evidence });
    const result = await runClaimGate(runDir, { mode: "smoke" });
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("claim has unknown evidence_kind");
  });

  it("warns when a (valid) claim evidence_kind does not match the cited artifact", async () => {
    const { runDir, evidence, kind } = await runWithTextArtifact();
    const otherKind = kind === "page_html" ? "page_text" : "page_html";
    await writeClaim(runDir, { claim_id: "c1", claim: "x", evidence, evidence_kind: otherKind }, { claim_id: "c1", evidence });
    const result = await runClaimGate(runDir, { mode: "smoke" });
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("claim evidence_kind does not match artifact");
  });
});

describe("runClaimGate claim-graph error branches", () => {
  it("fails a claim that carries no evidence reference", async () => {
    const { runDir } = await runWithTextArtifact();
    await writeClaim(runDir, { claim_id: "c1", claim: "x" });
    const result = await runClaimGate(runDir, { mode: "smoke" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("claim has no evidence");
  });

  it("fails a claim whose id has no matching citation row", async () => {
    const { runDir, evidence } = await runWithTextArtifact();
    await writeClaim(runDir, { claim_id: "c1", claim: "x", evidence });
    const result = await runClaimGate(runDir, { mode: "smoke" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("claim has no matching citation");
  });
});

describe("runClaimGate final-mode structural branches", () => {
  it("fails a final claim whose artifact_id does not match its evidence ref", async () => {
    const { runDir, evidence, kind } = await runWithTextArtifact();
    await writeClaim(runDir, { claim_id: "c1", claim: "x", evidence, schema_version: "1.0", artifact_id: "some-other-id", claim_type: "text", evidence_kind: kind }, { claim_id: "c1", evidence });
    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("final claim artifact_id does not match evidence");
  });

  it("fails a final claim whose evidence_kind does not match the cited artifact", async () => {
    const { runDir, evidence, kind } = await runWithTextArtifact();
    const otherKind = kind === "page_html" ? "page_text" : "page_html";
    await writeClaim(runDir, { claim_id: "c1", claim: "x", evidence, schema_version: "1.0", artifact_id: evidence, claim_type: "text", evidence_kind: otherKind }, { claim_id: "c1", evidence });
    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("final claim evidence_kind does not match artifact");
  });

  it("fails an ocr_bbox anchor that does not cite an ocr_text artifact", async () => {
    const { runDir, evidence, kind } = await runWithTextArtifact();
    await writeClaim(runDir, { claim_id: "c1", claim: "x", evidence, schema_version: "1.0", artifact_id: evidence, claim_type: "text", evidence_kind: kind, anchor: { type: "ocr_bbox" } }, { claim_id: "c1", evidence });
    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("ocr_bbox anchor requires an ocr_text artifact");
  });

  it("fails a transcript_cue anchor that does not cite a transcript_cue artifact", async () => {
    const { runDir, evidence, kind } = await runWithTextArtifact();
    await writeClaim(runDir, { claim_id: "c1", claim: "x", evidence, schema_version: "1.0", artifact_id: evidence, claim_type: "text", evidence_kind: kind, anchor: { type: "transcript_cue" } }, { claim_id: "c1", evidence });
    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("transcript_cue anchor requires a transcript_cue artifact");
  });

  it("fails a frame anchor that does not cite a frame_screenshot artifact", async () => {
    const { runDir, evidence, kind } = await runWithTextArtifact();
    await writeClaim(runDir, { claim_id: "c1", claim: "x", evidence, schema_version: "1.0", artifact_id: evidence, claim_type: "text", evidence_kind: kind, anchor: { type: "frame", timestampSec: 1.5 } }, { claim_id: "c1", evidence });
    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("frame anchor requires a frame_screenshot artifact");
  });
});
