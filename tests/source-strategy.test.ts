import { describe, expect, it } from "vitest";
import { describeSourceStrategy } from "../src/source-strategy.js";

describe("describeSourceStrategy", () => {
  it("classifies Naver map and blog sources", () => {
    expect(describeSourceStrategy("https://map.naver.com/p/search/example")).toMatchObject({
      platform: "naver_map",
      sourceFamily: "map",
      confidence: "high"
    });
    expect(describeSourceStrategy("https://blog.naver.com/example/123")).toMatchObject({
      platform: "naver_blog",
      sourceFamily: "blog",
      confidence: "high"
    });
    expect(describeSourceStrategy("https://section.blog.naver.com/Search/Post.naver?keyword=cafe")).toMatchObject({
      platform: "naver_blog",
      sourceFamily: "blog",
      confidence: "high"
    });
  });

  it("classifies Google map, search, and travel sources", () => {
    expect(describeSourceStrategy("https://www.google.com/maps/place/example")).toMatchObject({
      platform: "google_maps",
      sourceFamily: "map"
    });
    expect(describeSourceStrategy("https://www.google.co.kr/search?q=example")).toMatchObject({
      platform: "google_search",
      sourceFamily: "search"
    });
    expect(describeSourceStrategy("https://www.google.com/travel/hotels")).toMatchObject({
      platform: "google_travel",
      sourceFamily: "travel_booking"
    });
  });

  it("classifies Yahoo Search vertical subdomains as search surfaces", () => {
    for (const url of ["https://images.search.yahoo.com/search/images?p=tokyo+hotel", "https://news.search.yahoo.com/search?p=tokyo+hotel", "https://video.search.yahoo.com/search/video?p=tokyo+hotel"]) {
      expect(describeSourceStrategy(url)).toMatchObject({
        platform: "yahoo_search",
        sourceFamily: "search",
        confidence: "high"
      });
    }
  });

  it("classifies travel booking sources with price-evidence warnings", () => {
    const strategy = describeSourceStrategy("https://www.agoda.com/hotel/example.html");
    expect(strategy).toMatchObject({
      platform: "agoda",
      sourceFamily: "travel_booking"
    });
    expect(strategy.evidencePlan).toEqual(expect.arrayContaining([expect.objectContaining({ key: "offer_snapshot", status: "primary" }), expect.objectContaining({ key: "booking_actions", status: "unsupported" })]));
    expect(strategy.warnings.join("\n")).toContain("prices and availability are volatile");
  });

  it("classifies knowledge database sources as browser-visible generic evidence surfaces", () => {
    expect(describeSourceStrategy("https://scholar.google.com/scholar?q=machine+learning")).toMatchObject({
      platform: "google_scholar",
      sourceFamily: "portal",
      confidence: "high"
    });

    const cases = [
      ["https://en.wikipedia.org/wiki/Tokyo", "wikipedia"],
      ["https://namu.wiki/w/%EC%84%B1%EC%88%98%EB%8F%99", "namuwiki"],
      ["https://pubmed.ncbi.nlm.nih.gov/?term=playwright", "pubmed"],
      ["https://www.data.go.kr/tcs/dss/selectDataSetList.do?keyword=population", "data_go_kr"],
      ["https://kosis.kr/search/search.do?query=population", "kosis"],
      ["https://www.riss.kr/search/Search.do?queryText=ai", "riss"],
      ["https://www.kipris.or.kr/khome/search/search.do?queryText=robot", "kipris"]
    ] as const;

    for (const [url, platform] of cases) {
      expect(describeSourceStrategy(url)).toMatchObject({
        platform,
        sourceFamily: "generic_web",
        confidence: "high"
      });
    }
  });

  it("falls back to generic browser-visible strategy", () => {
    const strategy = describeSourceStrategy("https://example.com/path");
    expect(strategy).toMatchObject({
      platform: "generic",
      sourceFamily: "generic_web",
      confidence: "low"
    });
    expect(strategy.evidencePlan.some((step) => step.key === "browser_visible_capture")).toBe(true);
  });
});
