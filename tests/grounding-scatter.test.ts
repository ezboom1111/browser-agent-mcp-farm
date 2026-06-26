import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FarmService } from "../src/farm-service.js";

// Hardening (fuzzer-motivated): an aggregated/derived claim grounds on TOKEN PRESENCE (paraphrase),
// which a recombination of real tokens across unrelated content can satisfy. The gate now WARNS (does
// not block — legitimate cross-page synthesis exists) when the smallest window covering all tokens is
// far larger than the claim, surfacing a likely recombination. A high-assurance claim should use a
// contiguous text_span (0 leak) or corroboration.

describe("aggregated-claim scatter warning", () => {
  let roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
    roots = [];
  });

  async function newRun() {
    const root = await mkdtemp(join(tmpdir(), "farm-scatter-"));
    roots.push(root);
    const runDir = join(root, "run-1");
    await mkdir(runDir, { recursive: true });
    return { service: new FarmService(), runDir };
  }

  it("warns when aggregated tokens are scattered across unrelated content (no block)", async () => {
    const { service, runDir } = await newRun();
    const text = `Alpha grew twelve percent last year. ${"filler ".repeat(60)}Bravo grew forty-seven percent this year.`;
    const reg = await service.registerEvidence({ runDir, sourceUrl: "https://example.com/r", text, evidenceKind: "page_text" });
    const result = await service.addClaim({
      runDir,
      artifactId: reg.artifactId,
      claim: "Alpha grew forty-seven percent",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      claimTaxonomy: "aggregated",
      anchor: { type: "text_span", quote: "Alpha grew forty-seven percent", normalizedTokens: ["alpha", "forty-seven"] }
    });
    expect(result.ok).toBe(true); // token-presence still passes (does not block legitimate synthesis)
    expect(JSON.stringify(result.gate?.warnings)).toMatch(/scattered/);
  });

  it("does NOT warn when aggregated tokens are close together (legitimate paraphrase)", async () => {
    const { service, runDir } = await newRun();
    const text = "Revenue grew while churn fell sharply in the quarter.";
    const reg = await service.registerEvidence({ runDir, sourceUrl: "https://example.com/r", text, evidenceKind: "page_text" });
    const result = await service.addClaim({
      runDir,
      artifactId: reg.artifactId,
      claim: "revenue grew and churn fell",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      claimTaxonomy: "aggregated",
      anchor: { type: "text_span", quote: "revenue grew churn fell", normalizedTokens: ["revenue", "churn", "fell"] }
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.gate?.warnings ?? [])).not.toMatch(/scattered/);
  });
});
