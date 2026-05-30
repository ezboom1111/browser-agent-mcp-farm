import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FarmService } from "../src/farm-service.js";

// End-to-end verifiable generic-extraction loop: extract typed values from a captured HTML
// artifact, author text_span-anchored claims citing the VISIBLE-TEXT artifact, and let the gate
// decide. A publisher (JSON-LD) value that disagrees with the rendered page is never grounded.

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
  roots = [];
});

async function newRun(): Promise<{ service: FarmService; runDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "farm-ground-"));
  roots.push(root);
  const runDir = join(root, "run-1");
  await mkdir(runDir, { recursive: true });
  return { service: new FarmService(), runDir };
}

function htmlWith(price: string, rating: string): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "Product",
    name: "Latte Grande",
    offers: { price, priceCurrency: "KRW" },
    aggregateRating: { ratingValue: rating, reviewCount: "1204" }
  })}</script></head><body><h1>Latte Grande</h1></body></html>`;
}

describe("FarmService.groundExtractedClaims", () => {
  it("grounds typed values that appear in the visible text, citing the page_text artifact", async () => {
    const { service, runDir } = await newRun();
    const html = await service.registerEvidence({
      runDir,
      sourceUrl: "https://shop.example/p",
      evidenceKind: "page_html",
      text: htmlWith("19900", "4.6")
    });
    const text = await service.registerEvidence({
      runDir,
      sourceUrl: "https://shop.example/p",
      evidenceKind: "page_text",
      text: "Latte Grande — Price: 19,900 KRW — Rating: 4.6 / 5 from 1,204 reviews"
    });

    const result = await service.groundExtractedClaims({
      runDir,
      htmlArtifactId: html.artifactId as string,
      textArtifactId: text.artifactId as string
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byField = Object.fromEntries(result.claims.map((c) => [c.field, c]));
    expect(byField.name?.grounded).toBe(true);
    expect(byField.price?.grounded).toBe(true);
    expect(byField.rating?.grounded).toBe(true);
    expect(result.grounded).toBe(result.proposed);
    expect(result.proposed).toBeGreaterThanOrEqual(3);
  });

  it("does NOT ground a publisher value that disagrees with the rendered page (non-tautological)", async () => {
    const { service, runDir } = await newRun();
    // JSON-LD claims 99,999 but the visible page shows 19,900 — the disagreement must not ground.
    const html = await service.registerEvidence({
      runDir,
      sourceUrl: "https://shop.example/p",
      evidenceKind: "page_html",
      text: htmlWith("99999", "4.6")
    });
    const text = await service.registerEvidence({
      runDir,
      sourceUrl: "https://shop.example/p",
      evidenceKind: "page_text",
      text: "Latte Grande — Price: 19,900 KRW — Rating: 4.6 / 5"
    });

    const result = await service.groundExtractedClaims({
      runDir,
      htmlArtifactId: html.artifactId as string,
      textArtifactId: text.artifactId as string
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fields = result.claims.map((c) => c.field);
    expect(fields).not.toContain("price"); // 99,999 is absent from the visible text → not proposed
    expect(fields).toContain("rating"); // 4.6 agrees → grounded
  });

  it("returns a typed error for a missing artifact", async () => {
    const { service, runDir } = await newRun();
    const result = await service.groundExtractedClaims({ runDir, htmlArtifactId: "nope", textArtifactId: "nope2" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not found");
  });
});
