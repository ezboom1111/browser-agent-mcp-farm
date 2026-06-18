import { describe, expect, it } from "vitest";
import { destinationQueryFromUrl, detectedTextScriptFamilies, hasDominantTextScriptMismatch, matchingTextTokens, normalizeEvidenceText } from "../src/evidence-runner-text.js";

describe("detectedTextScriptFamilies", () => {
  it("detects latin and digit, preserving family order", () => {
    expect(detectedTextScriptFamilies("abc123")).toEqual(["latin", "digit"]);
  });
  it("detects each non-latin family", () => {
    expect(detectedTextScriptFamilies("한국어")).toEqual(["hangul"]);
    expect(detectedTextScriptFamilies("ㄱㄴㄷ")).toEqual(["hangul"]); // compatibility jamo block
    expect(detectedTextScriptFamilies("ひらがな")).toEqual(["hiragana"]);
    expect(detectedTextScriptFamilies("カタカナ")).toEqual(["katakana"]);
    expect(detectedTextScriptFamilies("漢字")).toEqual(["han"]);
    expect(detectedTextScriptFamilies("12345")).toEqual(["digit"]);
  });
  it("returns families in canonical order for mixed input and [] for none", () => {
    expect(detectedTextScriptFamilies("a한カ漢9")).toEqual(["latin", "hangul", "katakana", "han", "digit"]);
    expect(detectedTextScriptFamilies("")).toEqual([]);
    expect(detectedTextScriptFamilies("   !@#")).toEqual([]); // symbols/space map to no family
  });
});

describe("hasDominantTextScriptMismatch", () => {
  it("flags disjoint dominant scripts (hangul query vs latin evidence)", () => {
    expect(hasDominantTextScriptMismatch("호텔뷰", "Hotel View")).toBe(true);
    expect(hasDominantTextScriptMismatch("ホテル", "Hotel")).toBe(true);
  });
  it("does not flag when scripts overlap", () => {
    expect(hasDominantTextScriptMismatch("Hotel", "Hotel Azure Beachfront")).toBe(false);
    expect(hasDominantTextScriptMismatch("Seoul서울타워", "Tokyo")).toBe(false); // query has latin too
  });
  it("returns false when either side has < 2 non-digit chars", () => {
    expect(hasDominantTextScriptMismatch("a", "한국어")).toBe(false);
    expect(hasDominantTextScriptMismatch("", "Hotel")).toBe(false);
    expect(hasDominantTextScriptMismatch("호텔", "123456")).toBe(false); // digits don't count
  });
});

describe("destinationQueryFromUrl", () => {
  it("reads the first matching query parameter and trims it", () => {
    expect(destinationQueryFromUrl("https://example.com/?q=hotel")).toBe("hotel");
    expect(destinationQueryFromUrl("https://example.com/?query=beach%20resort")).toBe("beach resort");
    expect(destinationQueryFromUrl("https://example.com/?keyword=%20%20spaced%20%20")).toBe("spaced");
  });
  it("recovers a query from a known search path and decodes +", () => {
    expect(destinationQueryFromUrl("https://maps.google.com/maps/search/Seoul+Tower")).toBe("Seoul Tower");
    expect(destinationQueryFromUrl("https://map.naver.com/p/search/%EB%A7%9B%EC%A7%91")).toBe("맛집");
  });
  it("returns undefined for invalid url, no query, or empty param", () => {
    expect(destinationQueryFromUrl("not a url")).toBeUndefined();
    expect(destinationQueryFromUrl("https://example.com/path")).toBeUndefined();
    expect(destinationQueryFromUrl("https://example.com/?q=")).toBeUndefined();
  });
});

describe("matchingTextTokens / normalizeEvidenceText", () => {
  it("returns shared tokens between query and value", () => {
    const tokens = matchingTextTokens("Seoul Tower", "namsan seoul tower view");
    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens).toContain("seoul");
    expect(tokens).toContain("tower");
  });
  it("collapses whitespace and handles undefined", () => {
    expect(normalizeEvidenceText("  a   b\n\tc ")).toBe("a b c");
    expect(normalizeEvidenceText(undefined)).toBe("");
    expect(normalizeEvidenceText("   ")).toBe("");
  });
});
