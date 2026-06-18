import { describe, expect, it } from "vitest";
import { compareVantages, type VantageCapture } from "../src/multi-vantage-agreement.js";
import type { TypedFact } from "../src/typed-facts.js";

const price = (value: string): TypedFact[] => [{ kind: "price", value, raw: `$${value}`, index: 0 }];
const longText = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt";

describe("compareVantages", () => {
  it("agrees when content and facts match across vantages", () => {
    const r = compareVantages([
      { vantageId: "us", text: `${longText} price $10`, typedFacts: price("10") },
      { vantageId: "eu", text: `${longText} price $10`, typedFacts: price("10") }
    ]);
    expect(r.verdict).toBe("agreed");
    expect(r.contentAgreementRatio).toBe(1);
    expect(r.successfulVantages).toBe(2);
    expect(r.divergentVantageIds).toEqual([]);
    expect(r.note).toContain("CONSISTENCY");
  });

  it("splits when a fact diverges even though content agrees", () => {
    const r = compareVantages([
      { vantageId: "us", text: longText, typedFacts: price("10") },
      { vantageId: "eu", text: longText, typedFacts: price("20") }
    ]);
    expect(r.contentAgreementRatio).toBe(1); // identical content
    expect(r.verdict).toBe("split"); // but price differs
    const priceFact = r.facts.find((f) => f.kind === "price");
    expect(priceFact?.distinctValues.sort()).toEqual(["10", "20"]);
    expect(priceFact?.agreementRatio).toBeCloseTo(0.5);
  });

  it("splits and flags the divergent vantage on content disagreement", () => {
    const r = compareVantages([
      { vantageId: "a", text: "the quick brown fox jumps over the lazy dog here today" },
      { vantageId: "b", text: "the quick brown fox jumps over the lazy dog here today" },
      { vantageId: "c", text: "completely unrelated text about astronomy and distant galaxies tonight" }
    ]);
    expect(r.verdict).toBe("split");
    expect(r.largestAgreeingCluster).toBe(2);
    expect(r.majorityVantageIds).toEqual(["a", "b"]);
    expect(r.divergentVantageIds).toEqual(["c"]);
  });

  it("is insufficient with too few successful vantages and surfaces failures", () => {
    const captures: VantageCapture[] = [
      { vantageId: "ok", text: `${longText} only one good` },
      { vantageId: "blocked", error: "403 blocked" },
      { vantageId: "empty", text: "   " }
    ];
    const r = compareVantages(captures);
    expect(r.verdict).toBe("insufficient");
    expect(r.successfulVantages).toBe(1);
    expect(r.failedVantageIds).toEqual(["blocked"]);
    expect(r.note).toContain("Too few");
  });
});
