import { describe, expect, it } from "vitest";
import {
  contentShingles,
  independentSourceCount,
  independentSourceGroups,
  jaccardSimilarity,
  registrableDomain
} from "../src/source-independence.js";

describe("registrableDomain", () => {
  it("strips www and reduces to eTLD+1", () => {
    expect(registrableDomain("https://www.example.com/path?x=1")).toBe("example.com");
    expect(registrableDomain("https://sub.example.org")).toBe("example.org");
    expect(registrableDomain("https://example.com")).toBe("example.com");
  });
  it("keeps three labels for known two-level public suffixes", () => {
    expect(registrableDomain("https://news.bbc.co.uk")).toBe("bbc.co.uk");
    expect(registrableDomain("https://shop.example.com.au")).toBe("example.com.au");
    expect(registrableDomain("https://blog.daum.co.kr")).toBe("daum.co.kr");
  });
  it("returns undefined for an unparseable url", () => {
    expect(registrableDomain("not a url")).toBeUndefined();
    expect(registrableDomain("ftp://")).toBeUndefined();
  });
});

describe("independentSourceCount", () => {
  it("counts distinct registrable domains, ignoring undefined and www duplicates", () => {
    expect(
      independentSourceCount(["https://a.com", "https://www.a.com/x", "https://b.com", undefined, "nonsense"])
    ).toBe(2);
    expect(independentSourceCount([])).toBe(0);
  });
});

describe("contentShingles / jaccardSimilarity", () => {
  it("builds k-word shingles and collapses short text to one", () => {
    expect(contentShingles("the quick brown fox jumps over", 5)).toEqual(
      new Set(["the quick brown fox jumps", "quick brown fox jumps over"])
    );
    expect(contentShingles("only three words", 5)).toEqual(new Set(["only three words"]));
    expect(contentShingles("   ")).toEqual(new Set());
  });
  it("computes Jaccard similarity, 0 for empty/disjoint and 1 for identical", () => {
    const a = new Set(["x y", "y z"]);
    expect(jaccardSimilarity(a, new Set(["x y", "y z"]))).toBe(1);
    expect(jaccardSimilarity(a, new Set(["p q"]))).toBe(0);
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });
});

describe("independentSourceGroups", () => {
  it("groups by shared domain and by near-duplicate content", () => {
    const dup = "the quick brown fox jumps over the lazy dog and runs away fast today";
    const groups = independentSourceGroups([
      { url: "https://a.com/1", text: dup },
      { url: "https://b.com/2", text: dup }, // different domain, same text => one source
      { url: "https://c.com", text: "an entirely different unrelated sentence about nothing in particular" }
    ]);
    expect(groups).toBe(2);
  });
  it("groups same-domain captures even with different text", () => {
    expect(
      independentSourceGroups([
        { url: "https://a.com/1", text: "alpha" },
        { url: "https://www.a.com/2", text: "beta" },
        { url: "https://b.com", text: "gamma" }
      ])
    ).toBe(2);
  });
  it("excludes a source with neither a usable domain nor text", () => {
    expect(independentSourceGroups([{ url: "https://a.com", text: "hi" }, {}])).toBe(1);
    expect(independentSourceGroups([])).toBe(0);
  });
});
