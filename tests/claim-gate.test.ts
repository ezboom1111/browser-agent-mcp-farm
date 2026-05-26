import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";
import { runClaimGate } from "../src/claim-gate.js";

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
});
