import { describe, expect, it } from "vitest";

import { literalQuoteIn, proposeGroundedClaims } from "../src/grounded-extraction.js";
import type { StructuredData, StructuredSummary } from "../src/structured-extractor.js";

function structured(summary: StructuredSummary): StructuredData {
  return { jsonLd: [], hydration: [], openGraph: {}, twitter: {}, summary, headings: [], tables: [] };
}

describe("literalQuoteIn", () => {
  it("matches the raw value", () => {
    expect(literalQuoteIn("rated 4.6 out of 5", "4.6")).toBe("4.6");
  });

  it("matches a comma-grouped numeric form of a de-grouped markup value", () => {
    // markup says "19900", the page shows "19,900"
    expect(literalQuoteIn("Price: 19,900 KRW", "19900")).toBe("19,900");
  });

  it("matches a de-grouped form of a comma-grouped value", () => {
    expect(literalQuoteIn("total 1204 reviews", "1,204")).toBe("1204");
  });

  it("returns undefined when no literal form is present", () => {
    expect(literalQuoteIn("Price: 19,900 KRW", "24900")).toBeUndefined();
  });
});

describe("proposeGroundedClaims", () => {
  it("proposes anchored claims only for typed values present in the visible text", () => {
    const text = "Latte Grande — Price: 19,900 KRW — Rating: 4.6 / 5 from 1,204 reviews";
    const data = structured({
      name: "Latte Grande",
      price: { value: "19900", currency: "KRW" },
      rating: { value: "4.6", count: "1204" }
    });
    const proposals = proposeGroundedClaims(data, text);

    const byField = Object.fromEntries(proposals.map((p) => [p.field, p]));
    expect(byField.name?.anchor.quote).toBe("Latte Grande");
    expect(byField.price?.anchor.quote).toBe("19,900");
    expect(byField.rating?.anchor.quote).toBe("4.6");
    // every proposal is a text_span page_text claim
    expect(proposals.every((p) => p.evidenceKind === "page_text" && p.anchor.type === "text_span")).toBe(true);
  });

  it("does NOT propose a typed value that is absent from the page (would-be hallucination)", () => {
    const text = "On sale now! See store for pricing.";
    const data = structured({ price: { value: "19900" }, rating: { value: "4.6" } });
    expect(proposeGroundedClaims(data, text)).toEqual([]);
  });

  it("skips missing summary fields", () => {
    expect(proposeGroundedClaims(structured({}), "anything")).toEqual([]);
  });
});
