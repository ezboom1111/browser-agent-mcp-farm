import { appendFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runClaimGate } from "../src/claim-gate.js";
import { FarmService } from "../src/farm-service.js";
import { independentSourceCount, registrableDomain } from "../src/source-independence.js";

// Engine #2 (cross-source corroboration). A claim can cite N supporting sources; the gate verifies each
// is registered, verifies any per-source quote against THAT source's bytes, and counts distinct
// registrable domains. It fails the claim below the required independent-source minimum.

describe("source independence", () => {
  it("reduces a URL to its registrable domain (www-stripped, two-level suffix aware)", () => {
    expect(registrableDomain("https://www.example.com/a")).toBe("example.com");
    expect(registrableDomain("https://news.example.com/a")).toBe("example.com");
    expect(registrableDomain("https://shop.bbc.co.uk/x")).toBe("bbc.co.uk");
    expect(registrableDomain("not a url")).toBeUndefined();
  });

  it("counts distinct registrable domains (subdomains of one site are NOT independent)", () => {
    expect(independentSourceCount(["https://a.com/1", "https://b.org/2"])).toBe(2);
    expect(independentSourceCount(["https://a.com/1", "https://news.a.com/2"])).toBe(1);
    expect(independentSourceCount(["https://a.com/1", undefined, "https://a.com/2"])).toBe(1);
  });
});

describe("claim corroboration (end-to-end through addClaim)", () => {
  let roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
    roots = [];
  });

  async function newRun(): Promise<{ service: FarmService; runDir: string }> {
    const root = await mkdtemp(join(tmpdir(), "farm-corr-"));
    roots.push(root);
    const runDir = join(root, "run-1");
    await mkdir(runDir, { recursive: true });
    return { service: new FarmService(), runDir };
  }

  it("passes when backed by 2 independent sources with a verified per-source quote", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://example.com/r", text: "Market size is $5B in 2026.", evidenceKind: "page_text" });
    const b = await service.registerEvidence({ runDir, sourceUrl: "https://other.org/r", text: "analysts peg the market at roughly $5 billion", evidenceKind: "page_text" });

    const result = await service.addClaim({
      runDir,
      artifactId: a.artifactId as string,
      claim: "The market is about $5B",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      anchor: { type: "text_span", quote: "Market size is $5B" },
      corroboration: { sources: [{ artifactId: b.artifactId as string, quote: "$5 billion" }], minIndependentSources: 2 }
    });
    expect(result.appended).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("fails when the supporting source is the SAME registrable domain (not independent)", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://example.com/r", text: "fact one", evidenceKind: "page_text" });
    const same = await service.registerEvidence({ runDir, sourceUrl: "https://news.example.com/r", text: "fact one again", evidenceKind: "page_text" });

    const result = await service.addClaim({
      runDir,
      artifactId: a.artifactId as string,
      claim: "corroborated?",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      corroboration: { sources: [{ artifactId: same.artifactId as string }], minIndependentSources: 2 }
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.gate?.errors)).toMatch(/corroboration below required independent sources/);
  });

  it("fails when a per-source quote is absent from that source's bytes", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://example.com/r", text: "fact one", evidenceKind: "page_text" });
    const b = await service.registerEvidence({ runDir, sourceUrl: "https://other.org/r", text: "unrelated content", evidenceKind: "page_text" });

    const result = await service.addClaim({
      runDir,
      artifactId: a.artifactId as string,
      claim: "corroborated?",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      corroboration: { sources: [{ artifactId: b.artifactId as string, quote: "a phrase that is not present" }], minIndependentSources: 2 }
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.gate?.errors)).toMatch(/corroboration quote not found in source/);
  });

  it("rejects (before writing) a claim whose corroboration source is unregistered", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://example.com/r", text: "fact one", evidenceKind: "page_text" });

    const result = await service.addClaim({
      runDir,
      artifactId: a.artifactId as string,
      claim: "corroborated?",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      corroboration: { sources: [{ artifactId: "ghost-artifact" }], minIndependentSources: 2 }
    });
    expect(result.appended).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/corroboration source\(s\) not registered/);
  });

  it("clamps a hand-written minIndependentSources below 2 (defends against a manipulated ledger)", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://example.com/a", text: "fact", evidenceKind: "page_text" });
    // Same registrable domain as A, so the genuine independent count is 1.
    const b = await service.registerEvidence({ runDir, sourceUrl: "https://news.example.com/b", text: "fact too", evidenceKind: "page_text" });

    // Hand-write a claim row with minIndependentSources: 1, bypassing the authoring schema's min(2).
    const claimId = "claim-handwritten";
    const claimRow = { schema_version: "1.0", claim_id: claimId, claim_type: "text", claim: "x", evidence: a.artifactId, artifact_id: a.artifactId, evidence_kind: "page_text", verification_level: "grounded", corroboration: { sources: [{ artifactId: b.artifactId }], minIndependentSources: 1 } };
    await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify(claimRow)}\n`);
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: claimId, evidence: a.artifactId, artifact_id: a.artifactId, evidence_kind: "page_text" })}\n${JSON.stringify({ claim_id: claimId, evidence: b.artifactId, artifact_id: b.artifactId })}\n`);

    const gate = await runClaimGate(runDir, { mode: "final", minClaims: 0 });
    // The gate clamps the requested min back to 2, so 1 independent source fails (without the clamp,
    // 1 < 1 would be false and this would wrongly pass).
    expect(gate.ok).toBe(false);
    expect(JSON.stringify(gate.errors)).toMatch(/below required independent sources/);
  });
});
