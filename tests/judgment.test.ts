import { appendFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runClaimGate } from "../src/claim-gate.js";
import { FarmService } from "../src/farm-service.js";

// Caged-judge protocol (Tier 1). A semantic verdict over a claim whose SUPPORTING/REFUTING spans the
// gate verifies literally appear in their sources' bytes, with a structural quorum. The judge's verdict
// is untrusted, but it cannot make 'supported' stand on a fabricated/recombined span — this is the
// deterministic cage around an LLM judge, and the fix for the aggregated-token recombination weakness.

describe("farm_judge_claim", () => {
  let roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
    roots = [];
  });

  async function newRun() {
    const root = await mkdtemp(join(tmpdir(), "farm-judge-"));
    roots.push(root);
    const runDir = join(root, "run-1");
    await mkdir(runDir, { recursive: true });
    return { service: new FarmService(), runDir };
  }

  it("accepts a 'supported' verdict backed by verified spans on 2 independent domains", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://a.com/r", text: "Revenue grew to $5 billion in 2026.", evidenceKind: "page_text" });
    const b = await service.registerEvidence({ runDir, sourceUrl: "https://b.org/r", text: "The company reported roughly $5 billion in revenue.", evidenceKind: "page_text" });
    const result = await service.judgeClaim({
      runDir,
      claim: "Revenue was about $5 billion",
      verdict: "supported",
      support: [
        { artifactId: a.artifactId as string, quote: "Revenue grew to $5 billion" },
        { artifactId: b.artifactId as string, quote: "$5 billion in revenue" }
      ],
      minIndependentSources: 2
    });
    expect(result.appended).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("rejects a 'supported' verdict whose supporting span does NOT appear in the source", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://a.com/r", text: "Revenue grew modestly.", evidenceKind: "page_text" });
    const result = await service.judgeClaim({
      runDir,
      claim: "Revenue doubled",
      verdict: "supported",
      support: [{ artifactId: a.artifactId as string, quote: "Revenue doubled to $10 billion" }],
      minIndependentSources: 1
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.gate?.errors)).toMatch(/span quote not found in source/);
  });

  it("BLOCKS a recombination that token-mode would pass (the caged-judge fix)", async () => {
    const { service, runDir } = await newRun();
    // Alpha grew 12%, Bravo grew 47% — the phrase "Alpha grew 47%" is NOT contiguous anywhere.
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://a.com/r", text: "Alpha grew 12% last year. Bravo grew 47% this year.", evidenceKind: "page_text" });
    const result = await service.judgeClaim({
      runDir,
      claim: "Alpha grew 47%",
      verdict: "supported",
      support: [{ artifactId: a.artifactId as string, quote: "Alpha grew 47%" }],
      minIndependentSources: 1
    });
    expect(result.ok).toBe(false); // the contiguous span does not exist -> recombination cannot stand
  });

  it("rejects a 'supported' verdict on a single domain when 2 independent are required", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://x.example.com/1", text: "fact one is here", evidenceKind: "page_text" });
    const b = await service.registerEvidence({ runDir, sourceUrl: "https://news.example.com/2", text: "fact one is here too", evidenceKind: "page_text" });
    const result = await service.judgeClaim({
      runDir,
      claim: "fact one",
      verdict: "supported",
      support: [
        { artifactId: a.artifactId as string, quote: "fact one is here" },
        { artifactId: b.artifactId as string, quote: "fact one is here" }
      ],
      minIndependentSources: 2
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.gate?.errors)).toMatch(/below required independent supporting sources/);
  });

  it("rejects a 'supported' verdict contradicted by a verified refuting span (inconsistent)", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://a.com/r", text: "Sales rose this quarter.", evidenceKind: "page_text" });
    const b = await service.registerEvidence({ runDir, sourceUrl: "https://b.org/r", text: "Sales fell sharply this quarter.", evidenceKind: "page_text" });
    const result = await service.judgeClaim({
      runDir,
      claim: "Sales rose",
      verdict: "supported",
      support: [{ artifactId: a.artifactId as string, quote: "Sales rose" }],
      refute: [{ artifactId: b.artifactId as string, quote: "Sales fell sharply" }],
      minIndependentSources: 1
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.gate?.errors)).toMatch(/contradicted by a verified refuting span/);
  });

  it("accepts a 'refuted' verdict backed by a verified refuting span", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://a.com/r", text: "The product was discontinued in 2026.", evidenceKind: "page_text" });
    const result = await service.judgeClaim({
      runDir,
      claim: "The product is still sold",
      verdict: "refuted",
      refute: [{ artifactId: a.artifactId as string, quote: "The product was discontinued" }]
    });
    expect(result.ok).toBe(true);
  });

  it("allows an explicit single-source 'supported' (min 1) but WARNS it is lower assurance", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://a.com/r", text: "The figure is $5 billion.", evidenceKind: "page_text" });
    const result = await service.judgeClaim({
      runDir,
      claim: "about $5 billion",
      verdict: "supported",
      support: [{ artifactId: a.artifactId as string, quote: "$5 billion" }],
      minIndependentSources: 1
    });
    expect(result.ok).toBe(true); // single-source is legal when explicitly requested
    expect(JSON.stringify(result.gate?.warnings)).toMatch(/single independent source/);
  });

  it("rejects (before writing) a judgment whose span source is unregistered", async () => {
    const { service, runDir } = await newRun();
    const result = await service.judgeClaim({ runDir, claim: "x", verdict: "supported", support: [{ artifactId: "ghost", quote: "y" }] });
    expect(result.appended).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not registered/);
  });

  it("clamps a hand-written min_independent_sources below 1 / honours the default (direct-ledger defence)", async () => {
    const { service, runDir } = await newRun();
    const a = await service.registerEvidence({ runDir, sourceUrl: "https://x.example.com/1", text: "alpha here", evidenceKind: "page_text" });
    const b = await service.registerEvidence({ runDir, sourceUrl: "https://news.example.com/2", text: "alpha here too", evidenceKind: "page_text" });
    // Hand-written 'supported' judgment with min 0 (bypassing the schema). Both spans are the same
    // registrable domain -> 1 independent. The gate must clamp min to >= the default (2) and fail it.
    const row = {
      judgment_id: "j1",
      claim: "alpha",
      verdict: "supported",
      support: [
        { artifactId: a.artifactId, quote: "alpha here" },
        { artifactId: b.artifactId, quote: "alpha here too" }
      ],
      min_independent_sources: 0
    };
    await appendFile(join(runDir, "judgments.jsonl"), `${JSON.stringify(row)}\n`);
    const gate = await runClaimGate(runDir, { mode: "final", minClaims: 0 });
    expect(gate.ok).toBe(false);
    expect(JSON.stringify(gate.errors)).toMatch(/below required independent supporting sources/);
  });
});
