import { describe, expect, it } from "vitest";

import { compareVantages, type VantageCapture } from "../src/multi-vantage-agreement.js";

// A paragraph long enough that changing one token keeps content jaccard well above the 0.6 threshold,
// so a single differing PRICE splits via fact-disagreement (not content-divergence) — the geo/price-
// discrimination case the single-capture model misses.
const BASE = "The Aurora wireless headphones deliver forty hours of battery life with active noise cancellation tuned for open offices and long flights, shipping worldwide from regional warehouses with a two year limited warranty and free returns within thirty days of delivery.";
const withPrice = (p: string): string => `${BASE} The current price is ${p} including tax.`;

describe("multi-vantage agreement (D3)", () => {
  it("returns 'agreed' when all vantages serve the same content and facts", () => {
    const captures: VantageCapture[] = [
      { vantageId: "eu-west", text: withPrice("$899") },
      { vantageId: "us-east", text: withPrice("$899") },
      { vantageId: "ap-south", text: withPrice("$899") }
    ];
    const result = compareVantages(captures);
    expect(result.verdict).toBe("agreed");
    expect(result.successfulVantages).toBe(3);
    expect(result.contentAgreementRatio).toBe(1);
    expect(result.divergentVantageIds).toEqual([]);
    expect(result.majorityVantageIds).toEqual(["ap-south", "eu-west", "us-east"]);
    const price = result.facts.find((f) => f.kind === "price");
    expect(price?.agreementRatio).toBe(1);
    expect(price?.majorityValue).toBe("899");
    expect(result.note).toMatch(/CONSISTENCY, not truth/);
  });

  it("flags 'split' on price discrimination (same content, one vantage's price differs)", () => {
    const captures: VantageCapture[] = [
      { vantageId: "eu-west", text: withPrice("$899") },
      { vantageId: "us-east", text: withPrice("$899") },
      { vantageId: "ap-south", text: withPrice("$799") } // geo-priced differently
    ];
    const result = compareVantages(captures);
    expect(result.contentAgreementRatio).toBeGreaterThanOrEqual(0.67); // content still clusters (long shared body)
    expect(result.verdict).toBe("split"); // ...but the price disagreement splits it
    const price = result.facts.find((f) => f.kind === "price");
    expect(price?.distinctValues).toEqual(["799", "899"]);
    expect(price?.agreementRatio).toBeCloseTo(2 / 3, 5);
    expect(result.note).toMatch(/price discrimination|cloaking|geo/i);
  });

  it("flags 'split' and names the divergent vantage on content cloaking", () => {
    const captures: VantageCapture[] = [
      { vantageId: "clean-1", text: withPrice("$899") },
      { vantageId: "clean-2", text: withPrice("$899") },
      { vantageId: "cloaked", text: "Access denied. This content is not available in your region. Please disable your VPN and try again from a supported country to continue browsing our catalog." }
    ];
    const result = compareVantages(captures);
    expect(result.verdict).toBe("split");
    expect(result.majorityVantageIds).toEqual(["clean-1", "clean-2"]);
    expect(result.divergentVantageIds).toEqual(["cloaked"]);
    expect(result.contentAgreementRatio).toBeCloseTo(2 / 3, 5);
  });

  it("derives typed facts from text when typedFacts are not supplied", () => {
    const result = compareVantages([
      { vantageId: "a", text: withPrice("$50") },
      { vantageId: "b", text: withPrice("$50") }
    ]);
    const price = result.facts.find((f) => f.kind === "price");
    expect(price?.majorityValue).toBe("50"); // extracted, not passed in
    expect(result.verdict).toBe("agreed");
  });

  it("excludes failed vantages from the quorum but surfaces them", () => {
    const captures: VantageCapture[] = [
      { vantageId: "ok-1", text: withPrice("$1299") },
      { vantageId: "ok-2", text: withPrice("$1299") },
      { vantageId: "blocked", error: "tier-0 declined: http 403" }
    ];
    const result = compareVantages(captures);
    expect(result.successfulVantages).toBe(2);
    expect(result.failedVantageIds).toEqual(["blocked"]);
    expect(result.verdict).toBe("agreed"); // the two reachable vantages agree
  });

  it("returns 'insufficient' when fewer than minVantages succeed", () => {
    const captures: VantageCapture[] = [
      { vantageId: "ok", text: withPrice("$1299") },
      { vantageId: "blocked", error: "timeout" },
      { vantageId: "empty", text: "   " }
    ];
    const result = compareVantages(captures);
    expect(result.verdict).toBe("insufficient");
    expect(result.successfulVantages).toBe(1);
    expect(result.failedVantageIds).toEqual(["blocked"]);
    expect(result.note).toMatch(/Too few/);
  });

  it("honours custom thresholds (minVantages=3 makes two agreeing vantages insufficient)", () => {
    const result = compareVantages(
      [
        { vantageId: "a", text: withPrice("$1299") },
        { vantageId: "b", text: withPrice("$1299") }
      ],
      { minVantages: 3 }
    );
    expect(result.verdict).toBe("insufficient");
  });
});
