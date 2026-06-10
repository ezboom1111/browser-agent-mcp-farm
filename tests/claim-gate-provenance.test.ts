import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";
import { runClaimGate } from "../src/claim-gate.js";
import { FarmService } from "../src/farm-service.js";

// Structured-provenance check (the measured "structured-in-disguise" hole): in QA only ~36% of
// `structured` findings were genuine — agents repackaged news text into JSON to fill the shape.
// The gate cannot judge truth, but it CAN read the ledger's capture_method: `agent-authored`
// structured_data is self-asserted provenance, while `structured-extractor` / `http-fetch-structured`
// bytes were derived deterministically by the farm from witnessed pages. Default = warn (no behavior
// flip for existing consumers, same discipline as the 999999 hole); `strictProvenance` = hard error.

let runDirs: string[] = [];

async function newRunDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  runDirs.push(dir);
  return dir;
}

async function appendStructuredClaim(runDir: string, artifactId: string, quote: string): Promise<void> {
  const row = {
    schema_version: "1.0",
    claim_id: "structured-1",
    claim_type: "metadata",
    claim: "A typed figure read from structured data.",
    artifact_id: artifactId,
    evidence: artifactId,
    evidence_kind: "structured_data",
    verification_level: "structured",
    anchor: { type: "text_span", quote }
  };
  await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify(row)}\n`);
  await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: "structured-1", evidence: artifactId, artifact_id: artifactId, evidence_kind: "structured_data" })}\n`);
}

describe("claim gate structured-data provenance", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("warns (default) when a claim cites agent-authored structured_data", async () => {
    const runDir = await newRunDir("farm-prov-warn-");
    const service = new FarmService();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://api.example.org/v1/stats",
      text: '{"viewCount": "658078"}',
      evidenceKind: "structured_data"
    });
    await appendStructuredClaim(runDir, reg.artifactId as string, '"viewCount": "658078"');

    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(true); // default keeps the pass/fail contract
    expect(result.warnings.join("\n")).toContain("agent-authored");
    expect(result.warnings.join("\n")).toContain("structured");
  });

  it("fails the gate for agent-authored structured_data when strictProvenance is set", async () => {
    const runDir = await newRunDir("farm-prov-strict-");
    const service = new FarmService();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://api.example.org/v1/stats",
      text: '{"viewCount": "658078"}',
      evidenceKind: "structured_data"
    });
    await appendStructuredClaim(runDir, reg.artifactId as string, '"viewCount": "658078"');

    const result = await runClaimGate(runDir, { mode: "final", strictProvenance: true });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("agent-authored");
  });

  it("does NOT flag farm-derived structured_data (structured-extractor), even under strictProvenance", async () => {
    const runDir = await newRunDir("farm-prov-derived-");
    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://shop.example.com/product",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "structured",
      text: '{"jsonLd":[],"openGraph":{},"summary":{"price":{"value":"4500"}}}',
      evidenceKind: "structured_data",
      captureMethod: "structured-extractor"
    });
    // kind === "text" selects the record whose BYTES hold the structured JSON (the bundle's
    // metadata sidecar shares the evidence_kind override but not the quoted bytes).
    const structured = records.find((record) => record.kind === "text" && record.evidence_kind === "structured_data");
    if (!structured) {
      throw new Error("Expected a structured_data artifact");
    }
    await appendStructuredClaim(runDir, structured.artifact_id, '"value":"4500"');

    const result = await runClaimGate(runDir, { mode: "final", strictProvenance: true });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).not.toContain("agent-authored");
  });

  it("flags the repackaging pattern: agent-authored structured_data whose domain matches an already-registered page", async () => {
    const runDir = await newRunDir("farm-prov-disguise-");
    const writer = new ArtifactWriter();
    // The news page is already captured in this run...
    await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://news.example.com/article-123",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "news",
      text: "Company X grew 45% this quarter."
    });
    // ...and the agent hand-packs the same page's numbers into "structured" JSON.
    const service = new FarmService();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://news.example.com/article-123",
      text: '{"growth": "45%"}',
      evidenceKind: "structured_data"
    });
    await appendStructuredClaim(runDir, reg.artifactId as string, '"growth": "45%"');

    const result = await runClaimGate(runDir, { mode: "final" });
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("repackag");

    const strict = await runClaimGate(runDir, { mode: "final", strictProvenance: true });
    expect(strict.ok).toBe(false);
    expect(strict.errors.join("\n")).toContain("repackag");
  });
});
