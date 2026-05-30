import { describe, expect, it } from "vitest";
import { ClaimAnchorSchema, ClaimTaxonomySchema, VerificationLevelSchema } from "../src/schemas.js";

describe("ClaimAnchorSchema (master-plan flagship slice 1)", () => {
  it("validates each anchor type", () => {
    expect(ClaimAnchorSchema.safeParse({ type: "text_span", quote: "38,000 KRW" }).success).toBe(true);
    expect(ClaimAnchorSchema.safeParse({ type: "ocr_bbox", wordIndexes: [3, 4] }).success).toBe(true);
    expect(ClaimAnchorSchema.safeParse({ type: "transcript_cue", cueIndex: 2 }).success).toBe(true);
    expect(ClaimAnchorSchema.safeParse({ type: "frame", timestampSec: 83 }).success).toBe(true);
  });

  it("rejects an unknown anchor type and required-field omissions", () => {
    expect(ClaimAnchorSchema.safeParse({ type: "nope" }).success).toBe(false);
    expect(ClaimAnchorSchema.safeParse({ type: "text_span" }).success).toBe(false); // missing quote
    expect(ClaimAnchorSchema.safeParse({ type: "frame" }).success).toBe(false); // missing timestampSec
  });

  it("adds a grounded verification level and a claim taxonomy", () => {
    expect(VerificationLevelSchema.safeParse("grounded").success).toBe(true);
    expect(ClaimTaxonomySchema.safeParse("quote").success).toBe(true);
    expect(ClaimTaxonomySchema.safeParse("derived").success).toBe(true);
    expect(ClaimTaxonomySchema.safeParse("aggregated").success).toBe(true);
    expect(ClaimTaxonomySchema.safeParse("invalid").success).toBe(false);
  });
});
