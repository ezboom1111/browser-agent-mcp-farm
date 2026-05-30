import { describe, expect, it } from "vitest";
import { SOURCE_REGISTRY, SOURCE_LEGAL_BASIS_VALUES, assertRegistryCoverage, listSourceRegistryEntries, selectSourceRegistryEntriesForIntent, selectSourceRegistryEntriesForUrl, summarizeSourceRegistryMatch } from "../src/source-registry.js";
import { describeSourceStrategy } from "../src/source-strategy.js";

describe("source registry", () => {
  it("assigns every source a legal_basis derived from its evidence role", () => {
    const valid = new Set<string>(SOURCE_LEGAL_BASIS_VALUES);
    for (const entry of SOURCE_REGISTRY) {
      expect(valid.has(entry.legalBasis), `${entry.platform} has an invalid legalBasis`).toBe(true);
      if (entry.evidenceRole === "derivative") {
        expect(entry.legalBasis).toBe("derivative_citation");
      }
      if (entry.evidenceRole === "user_controlled") {
        expect(entry.legalBasis).toBe("user_provided");
      }
      if (entry.evidenceRole === "primary") {
        expect(entry.legalBasis).toBe("public_browser_visible");
      }
    }
  });

  it("surfaces the matched sources' legal bases in the summary", () => {
    const match = selectSourceRegistryEntriesForIntent({ category: "ai_search", locale: "global" });
    const summary = summarizeSourceRegistryMatch(match);
    expect(summary.legalBases).toEqual(["derivative_citation"]);
  });

  it("passes mandatory top-slot coverage checks", () => {
    const report = assertRegistryCoverage();

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.checkedRequirements.length).toBeGreaterThan(10);
    expect(report.checkedRequirements.every((check) => check.ok)).toBe(true);
  });

  it("keeps Korean search coverage explicit across top slots", () => {
    const entries = listSourceRegistryEntries({ category: "search", locale: "ko-KR" });
    const platforms = entries.map((entry) => entry.platform);
    const topRanks = entries.flatMap((entry) => entry.topSlots.filter((slot) => slot.category === "search" && slot.segment === "ko-KR").map((slot) => slot.rank));

    expect(platforms).toEqual(expect.arrayContaining(["naver_search", "google_search", "daum_search"]));
    expect(new Set(topRanks).size).toBeGreaterThanOrEqual(3);
  });

  it("keeps Japanese search coverage explicit across top slots", () => {
    const entries = listSourceRegistryEntries({ category: "search", locale: "ja-JP" });
    const platforms = entries.map((entry) => entry.platform);
    const topRanks = entries.flatMap((entry) => entry.topSlots.filter((slot) => slot.category === "search" && slot.segment === "ja-JP").map((slot) => slot.rank));

    expect(platforms).toEqual(expect.arrayContaining(["google_search", "yahoo_japan_search", "bing"]));
    expect(new Set(topRanks).size).toBeGreaterThanOrEqual(3);
  });

  it("keeps English-language public coverage explicit across representative top slots", () => {
    const expectations = [
      {
        category: "search",
        platforms: ["google_search", "bing", "yahoo_search"]
      },
      {
        category: "news_media",
        platforms: ["google_news", "yahoo_news", "reuters"]
      },
      {
        category: "map_local",
        platforms: ["google_maps", "apple_maps", "yelp"]
      },
      {
        category: "marketplace_transaction",
        platforms: ["amazon", "walmart", "ebay"]
      },
      {
        category: "knowledge_database",
        platforms: ["wikipedia", "google_scholar", "pubmed"]
      }
    ] as const;

    for (const expectation of expectations) {
      const entries = listSourceRegistryEntries({ category: expectation.category, locale: "en-US" });
      const platforms = entries.map((entry) => entry.platform);
      const topRanks = entries.flatMap((entry) => entry.topSlots.filter((slot) => slot.category === expectation.category && slot.segment === "en-US").map((slot) => slot.rank));

      expect(platforms).toEqual(expect.arrayContaining([...expectation.platforms]));
      expect(new Set(topRanks)).toEqual(new Set([1, 2, 3]));
    }
  });

  it("keeps Korean content media coverage explicit across top slots", () => {
    const entries = listSourceRegistryEntries({ category: "content_media", locale: "ko-KR" });
    const platforms = entries.map((entry) => entry.platform);
    const topRanks = entries.flatMap((entry) => entry.topSlots.filter((slot) => slot.category === "content_media" && slot.segment === "ko-KR").map((slot) => slot.rank));

    expect(platforms).toEqual(expect.arrayContaining(["naver_blog", "youtube", "instagram"]));
    expect(new Set(topRanks).size).toBeGreaterThanOrEqual(3);
  });

  it("selects URL matches by exact platform before fallback", () => {
    const match = selectSourceRegistryEntriesForUrl("https://map.naver.com/p/search/cafe");
    const summary = summarizeSourceRegistryMatch(match);

    expect(match.matchReason).toBe("platform");
    expect(summary.platforms).toEqual(["naver_map"]);
    expect(summary.categories).toEqual(expect.arrayContaining(["map_local", "review_reputation"]));
    expect(summary.maxSupportTier).toBe(4);
  });

  it("uses generic fallback for unknown web sources", () => {
    const match = selectSourceRegistryEntriesForUrl("https://example.com/path");
    const summary = summarizeSourceRegistryMatch(match);

    expect(match.matchReason).toBe("platform");
    expect(summary.platforms).toEqual(["generic"]);
    expect(summary.evidenceRoles).toEqual(["planning_only"]);
  });

  it("marks AI answer engines as derivative evidence", () => {
    const match = selectSourceRegistryEntriesForIntent({ category: "ai_search", locale: "global" });

    expect(match.entries.map((entry) => entry.platform)).toEqual(expect.arrayContaining(["chatgpt_search", "gemini", "perplexity"]));
    expect(match.entries.every((entry) => entry.evidenceRole === "derivative")).toBe(true);
    expect(match.warnings.join("\n")).toContain("derivative evidence");
  });

  it("marks private messengers as user-controlled capture only", () => {
    const entries = listSourceRegistryEntries({ category: "messenger_private", locale: "ko-KR" });

    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(entries.every((entry) => entry.evidenceRole === "user_controlled")).toBe(true);
    expect(entries.every((entry) => entry.requiredCapabilities.includes("explicit_user_visible_capture"))).toBe(true);
  });

  it("keeps global community source-family metadata compatible with detected strategies", () => {
    const urls = ["https://www.reddit.com/search/?q=tokyo%20travel", "https://www.quora.com/search?q=tokyo%20travel", "https://stackoverflow.com/search?q=playwright"];

    for (const url of urls) {
      const strategy = describeSourceStrategy(url);
      const entry = listSourceRegistryEntries({ platform: strategy.platform })[0];

      expect(entry?.informationCategories).toContain("community_forum");
      expect(entry?.sourceFamilies).toContain(strategy.sourceFamily);
    }
  });

  it("keeps publisher news source-family metadata compatible with detected strategies", () => {
    const urls = ["https://www.reuters.com/site-search/?query=AI%20policy", "https://www.bloomberg.com/search?query=AI%20policy", "https://www.bbc.com/search?q=AI%20policy", "https://www.yna.co.kr/search/index?query=AI%20policy"];

    for (const url of urls) {
      const strategy = describeSourceStrategy(url);
      const entry = listSourceRegistryEntries({ platform: strategy.platform })[0];

      expect(entry?.informationCategories).toContain("news_media");
      expect(entry?.sourceFamilies).toContain(strategy.sourceFamily);
    }
  });

  it("keeps each top slot tied to local ranking metadata", () => {
    const topSlots = SOURCE_REGISTRY.flatMap((entry) => entry.topSlots);

    expect(topSlots.length).toBeGreaterThan(30);
    expect(topSlots.every((slot) => slot.metric === "strategic_relevance")).toBe(true);
    expect(topSlots.every((slot) => slot.sourceUrl.includes("INFORMATION_SOURCE_TAXONOMY.md"))).toBe(true);
    expect(topSlots.every((slot) => slot.observedAt === "2026-05-26")).toBe(true);
  });
});
