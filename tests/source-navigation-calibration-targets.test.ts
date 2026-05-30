import { describe, expect, it } from "vitest";
import { buildSourceNavigationCalibrationTargetPlan, formatSourceNavigationCalibrationTargetsAsLines } from "../src/source-navigation-calibration-targets.js";
import { describeSourceStrategy } from "../src/source-strategy.js";

describe("buildSourceNavigationCalibrationTargetPlan", () => {
  it("generates Korean search calibration targets from registry coverage", () => {
    const plan = buildSourceNavigationCalibrationTargetPlan({
      category: "search",
      locale: "ko-KR",
      minSupportTier: 2,
      query: "성수 카페"
    });

    expect(plan.executionPolicy).toBe("read_only_selector_probe_targets");
    expect(plan.targets.map((target) => target.id).slice(0, 3)).toEqual(["naver_search", "google_search", "daum_search"]);
    expect(new URL(plan.targets.find((target) => target.id === "naver_search")?.url ?? "").searchParams.get("query")).toBe("성수 카페");
    expect(plan.targets.every((target) => target.note?.includes("supportTier"))).toBe(true);
  });

  it("generates Japanese search calibration targets from registry top slots", () => {
    const plan = buildSourceNavigationCalibrationTargetPlan({
      category: "search",
      locale: "ja-JP",
      minSupportTier: 2,
      query: "tokyo hotel"
    });

    expect(plan.targets.map((target) => target.id).slice(0, 3)).toEqual(["google_search", "yahoo_japan_search", "bing"]);
    expect(new URL(plan.targets.find((target) => target.id === "yahoo_japan_search")?.url ?? "").hostname).toBe("search.yahoo.co.jp");
    expect(new URL(plan.targets.find((target) => target.id === "yahoo_japan_search")?.url ?? "").searchParams.get("p")).toBe("tokyo hotel");
    expect(plan.targets.map((target) => describeSourceStrategy(target.url).platform)).toEqual(expect.arrayContaining(["google_search", "yahoo_japan_search", "bing"]));
  });

  it("generates platform-detectable map and travel targets", () => {
    const plan = buildSourceNavigationCalibrationTargetPlan({
      sourceFamily: "map",
      locale: "ko-KR",
      minSupportTier: 2
    });
    const platforms = new Set(plan.targets.map((target) => describeSourceStrategy(target.url).platform));

    expect(platforms).toEqual(new Set(["naver_map", "kakao_map", "google_maps"]));

    const travelPlan = buildSourceNavigationCalibrationTargetPlan({
      sourceFamily: "travel_booking",
      query: "Seoul hotel"
    });
    const travelPlatforms = travelPlan.targets.map((target) => describeSourceStrategy(target.url).platform);

    expect(travelPlatforms).toEqual(expect.arrayContaining(["booking_com", "agoda", "trip_com", "expedia"]));
  });

  it("generates global map/local top targets and explicit Apple Maps calibration targets", () => {
    const plan = buildSourceNavigationCalibrationTargetPlan({
      category: "map_local",
      locale: "global",
      query: "tokyo coffee",
      limit: 3
    });
    const applePlan = buildSourceNavigationCalibrationTargetPlan({
      platform: "apple_maps",
      query: "tokyo coffee"
    });

    expect(plan.targets.map((target) => target.id)).toEqual(["google_maps", "yelp", "tripadvisor"]);
    expect(applePlan.targets.map((target) => target.id)).toEqual(["apple_maps"]);
    expect(new URL(applePlan.targets[0]?.url ?? "").hostname).toBe("maps.apple.com");
    expect(new URL(applePlan.targets[0]?.url ?? "").searchParams.get("q")).toBe("tokyo coffee");
    expect(plan.targets.map((target) => describeSourceStrategy(target.url).platform)).toEqual(["google_maps", "yelp", "tripadvisor"]);
    expect(describeSourceStrategy(applePlan.targets[0]?.url ?? "").platform).toBe("apple_maps");
  });

  it("generates global review and local calibration targets", () => {
    const plan = buildSourceNavigationCalibrationTargetPlan({
      category: "review_reputation",
      locale: "global",
      query: "tokyo restaurants",
      limit: 3
    });

    expect(plan.targets.map((target) => target.id)).toEqual(["google_maps", "yelp", "tripadvisor"]);
    expect(new URL(plan.targets.find((target) => target.id === "yelp")?.url ?? "").hostname).toBe("www.yelp.com");
    expect(new URL(plan.targets.find((target) => target.id === "yelp")?.url ?? "").searchParams.get("find_desc")).toBe("tokyo restaurants");
    expect(new URL(plan.targets.find((target) => target.id === "tripadvisor")?.url ?? "").searchParams.get("q")).toBe("tokyo restaurants");
    expect(plan.targets.map((target) => describeSourceStrategy(target.url).platform)).toEqual(["google_maps", "yelp", "tripadvisor"]);
  });

  it("adds stay-window parameters to travel booking calibration targets", () => {
    const plan = buildSourceNavigationCalibrationTargetPlan({
      sourceFamily: "travel_booking",
      query: "Tokyo hotel"
    });
    const urlById = new Map(plan.targets.map((target) => [target.id, new URL(target.url)]));

    expect(urlById.get("booking_com")?.searchParams.get("ss")).toBe("Tokyo hotel");
    expect(urlById.get("booking_com")?.searchParams.get("dest_id")).toBe("-246227");
    expect(urlById.get("booking_com")?.searchParams.get("dest_type")).toBe("city");
    expect(urlById.get("booking_com")?.searchParams.get("checkin")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(urlById.get("booking_com")?.searchParams.get("checkout")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(urlById.get("booking_com")?.searchParams.get("group_adults")).toBe("2");
    expect(urlById.get("agoda")?.pathname).toBe("/city/tokyo-jp.html");
    expect(urlById.get("agoda")?.searchParams.get("checkIn")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(urlById.get("agoda")?.searchParams.get("adults")).toBe("2");
    expect(urlById.get("trip_com")?.pathname).toBe("/hotels/list");
    expect(urlById.get("trip_com")?.searchParams.get("searchword")).toBe("Tokyo hotel");
    expect(urlById.get("expedia")?.searchParams.get("startDate")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(urlById.get("expedia")?.searchParams.get("rooms")).toBe("1");
  });

  it("generates English-language commerce calibration targets from registry coverage", () => {
    const plan = buildSourceNavigationCalibrationTargetPlan({
      category: "marketplace_transaction",
      locale: "en-US",
      query: "wireless earbuds",
      limit: 3
    });
    const urlById = new Map(plan.targets.map((target) => [target.id, new URL(target.url)]));

    expect(plan.targets.map((target) => target.id)).toEqual(["amazon", "walmart", "ebay"]);
    expect(urlById.get("amazon")?.hostname).toBe("www.amazon.com");
    expect(urlById.get("amazon")?.searchParams.get("k")).toBe("wireless earbuds");
    expect(urlById.get("walmart")?.hostname).toBe("www.walmart.com");
    expect(urlById.get("walmart")?.searchParams.get("q")).toBe("wireless earbuds");
    expect(urlById.get("ebay")?.hostname).toBe("www.ebay.com");
    expect(urlById.get("ebay")?.searchParams.get("_nkw")).toBe("wireless earbuds");
    expect(plan.targets.map((target) => describeSourceStrategy(target.url).platform)).toEqual(["amazon", "walmart", "ebay"]);
  });

  it("generates current Korean news calibration targets", () => {
    const plan = buildSourceNavigationCalibrationTargetPlan({
      category: "news_media",
      locale: "ko-KR",
      query: "AI policy",
      limit: 2
    });
    const daum = plan.targets.find((target) => target.id === "daum_news");
    const naver = plan.targets.find((target) => target.id === "naver_news");
    const daumUrl = new URL(daum?.url ?? "");
    const naverUrl = new URL(naver?.url ?? "");

    expect(plan.targets.map((target) => target.id)).toEqual(["naver_news", "daum_news"]);
    expect(naverUrl.hostname).toBe("search.naver.com");
    expect(naverUrl.searchParams.get("where")).toBe("news");
    expect(naverUrl.searchParams.get("query")).toBe("AI policy");
    expect(describeSourceStrategy(naverUrl.toString()).platform).toBe("naver_news");
    expect(daumUrl.hostname).toBe("search.daum.net");
    expect(daumUrl.searchParams.get("w")).toBe("news");
    expect(daumUrl.searchParams.get("q")).toBe("AI policy");
    expect(describeSourceStrategy(daumUrl.toString()).platform).toBe("daum_news");
  });

  it("generates knowledge database calibration targets from registry coverage", () => {
    const globalPlan = buildSourceNavigationCalibrationTargetPlan({
      category: "knowledge_database",
      locale: "global",
      query: "machine learning",
      limit: 3
    });
    const koreanPlan = buildSourceNavigationCalibrationTargetPlan({
      category: "knowledge_database",
      locale: "ko-KR",
      query: "AI policy",
      limit: 3
    });

    expect(globalPlan.targets.map((target) => target.id)).toEqual(["wikipedia", "google_scholar", "pubmed"]);
    expect(globalPlan.targets.map((target) => describeSourceStrategy(target.url).platform)).toEqual(["wikipedia", "google_scholar", "pubmed"]);
    expect(koreanPlan.targets.map((target) => target.id)).toEqual(["namuwiki", "data_go_kr", "riss"]);
    expect(koreanPlan.targets.map((target) => describeSourceStrategy(target.url).platform)).toEqual(["namuwiki", "data_go_kr", "riss"]);
  });

  it("generates Korean content media calibration targets with Naver Blog first", () => {
    const plan = buildSourceNavigationCalibrationTargetPlan({
      category: "content_media",
      locale: "ko-KR",
      query: "성수 카페",
      limit: 3
    });

    expect(plan.targets.map((target) => target.id)).toEqual(["naver_blog", "youtube", "instagram"]);
    expect(describeSourceStrategy(plan.targets[0]?.url ?? "").platform).toBe("naver_blog");
  });

  it("skips private messenger and derivative AI entries", () => {
    const messengerPlan = buildSourceNavigationCalibrationTargetPlan({
      category: "messenger_private",
      locale: "ko-KR"
    });
    const aiPlan = buildSourceNavigationCalibrationTargetPlan({
      category: "ai_search",
      locale: "global"
    });

    expect(messengerPlan.targets).toEqual([]);
    expect(messengerPlan.skippedEntries.length).toBeGreaterThanOrEqual(3);
    expect(messengerPlan.skippedEntries.every((entry) => entry.reason.includes("Private"))).toBe(true);
    expect(aiPlan.targets).toEqual([]);
    expect(aiPlan.skippedEntries.every((entry) => entry.reason.includes("Derivative"))).toBe(true);
  });

  it("formats batch-compatible target lines", () => {
    const plan = buildSourceNavigationCalibrationTargetPlan({
      platform: "google_search",
      query: "tokyo hotel"
    });

    expect(formatSourceNavigationCalibrationTargetsAsLines(plan)).toBe(`google_search ${plan.targets[0]?.url}\n`);
  });

  it("expands supported search vertical calibration variants on request", () => {
    const googlePlan = buildSourceNavigationCalibrationTargetPlan({
      platform: "google_search",
      query: "tokyo hotel",
      includeSearchVariants: true
    });
    const naverPlan = buildSourceNavigationCalibrationTargetPlan({
      platform: "naver_search",
      query: "seongsu cafe",
      includeSearchVariants: true
    });
    const daumPlan = buildSourceNavigationCalibrationTargetPlan({
      platform: "daum_search",
      query: "seongsu cafe",
      includeSearchVariants: true
    });
    const bingPlan = buildSourceNavigationCalibrationTargetPlan({
      platform: "bing",
      query: "tokyo hotel",
      includeSearchVariants: true
    });
    const yahooPlan = buildSourceNavigationCalibrationTargetPlan({
      platform: "yahoo_search",
      query: "tokyo hotel",
      includeSearchVariants: true
    });
    const yahooJapanPlan = buildSourceNavigationCalibrationTargetPlan({
      platform: "yahoo_japan_search",
      query: "tokyo hotel",
      includeSearchVariants: true
    });

    expect(googlePlan.targets.map((target) => target.id)).toEqual(["google_search", "google_search-news", "google_search-images", "google_search-videos", "google_search-local"]);
    expect(new URL(googlePlan.targets.find((target) => target.id === "google_search-news")?.url ?? "").searchParams.get("tbm")).toBe("nws");
    expect(new URL(googlePlan.targets.find((target) => target.id === "google_search-images")?.url ?? "").searchParams.get("tbm")).toBe("isch");
    expect(new URL(googlePlan.targets.find((target) => target.id === "google_search-videos")?.url ?? "").searchParams.get("tbm")).toBe("vid");
    expect(new URL(googlePlan.targets.find((target) => target.id === "google_search-local")?.url ?? "").searchParams.get("tbm")).toBe("lcl");

    expect(naverPlan.targets.map((target) => target.id)).toEqual(["naver_search", "naver_search-view", "naver_search-news", "naver_search-images", "naver_search-videos", "naver_search-place", "naver_search-shopping"]);
    expect(new URL(naverPlan.targets.find((target) => target.id === "naver_search-news")?.url ?? "").searchParams.get("where")).toBe("news");
    expect(new URL(naverPlan.targets.find((target) => target.id === "naver_search-place")?.url ?? "").searchParams.get("where")).toBe("place");
    expect(naverPlan.targets.find((target) => target.id === "naver_search-news")).toMatchObject({
      parentPlatform: "naver_search",
      variantId: "news",
      detectedPlatform: "naver_news",
      detectedSourceFamily: "portal"
    });
    expect(naverPlan.targetDetectionSummary.crossPlatformVariantTargets).toEqual(["naver_search-news"]);

    expect(daumPlan.targets.map((target) => target.id)).toEqual(["daum_search", "daum_search-news", "daum_search-blog", "daum_search-cafe", "daum_search-images", "daum_search-videos", "daum_search-place", "daum_search-shopping"]);
    expect(new URL(daumPlan.targets.find((target) => target.id === "daum_search-news")?.url ?? "").searchParams.get("w")).toBe("news");
    expect(new URL(daumPlan.targets.find((target) => target.id === "daum_search-videos")?.url ?? "").searchParams.get("w")).toBe("vclip");
    expect(daumPlan.targets.find((target) => target.id === "daum_search-news")).toMatchObject({
      parentPlatform: "daum_search",
      variantId: "news",
      detectedPlatform: "daum_news",
      detectedSourceFamily: "portal"
    });
    expect(daumPlan.targetDetectionSummary.crossPlatformVariantTargets).toEqual(["daum_search-news"]);

    expect(bingPlan.targets.map((target) => target.id)).toEqual(["bing", "bing-images", "bing-videos", "bing-news", "bing-maps"]);
    expect(new URL(bingPlan.targets.find((target) => target.id === "bing-images")?.url ?? "").pathname).toBe("/images/search");
    expect(new URL(bingPlan.targets.find((target) => target.id === "bing-news")?.url ?? "").pathname).toBe("/news/search");
    expect(bingPlan.targetDetectionSummary.platformCounts).toEqual([{ platform: "bing", count: 5 }]);
    expect(bingPlan.targetDetectionSummary.crossPlatformVariantCount).toBe(0);

    expect(yahooPlan.targets.map((target) => target.id)).toEqual(["yahoo_search", "yahoo_search-images", "yahoo_search-news", "yahoo_search-videos"]);
    expect(new URL(yahooPlan.targets.find((target) => target.id === "yahoo_search-images")?.url ?? "").hostname).toBe("images.search.yahoo.com");
    expect(new URL(yahooPlan.targets.find((target) => target.id === "yahoo_search-images")?.url ?? "").pathname).toBe("/search/images");
    expect(new URL(yahooPlan.targets.find((target) => target.id === "yahoo_search-news")?.url ?? "").hostname).toBe("news.search.yahoo.com");
    expect(new URL(yahooPlan.targets.find((target) => target.id === "yahoo_search-news")?.url ?? "").pathname).toBe("/search");
    expect(new URL(yahooPlan.targets.find((target) => target.id === "yahoo_search-videos")?.url ?? "").hostname).toBe("video.search.yahoo.com");

    expect(yahooJapanPlan.targets.map((target) => target.id)).toEqual(["yahoo_japan_search", "yahoo_japan_search-images", "yahoo_japan_search-videos", "yahoo_japan_search-news", "yahoo_japan_search-map", "yahoo_japan_search-shopping", "yahoo_japan_search-qna"]);
    expect(new URL(yahooJapanPlan.targets.find((target) => target.id === "yahoo_japan_search-news")?.url ?? "").hostname).toBe("news.yahoo.co.jp");
    expect(new URL(yahooJapanPlan.targets.find((target) => target.id === "yahoo_japan_search-qna")?.url ?? "").hostname).toBe("chiebukuro.yahoo.co.jp");
    expect(formatSourceNavigationCalibrationTargetsAsLines(googlePlan)).toContain("google_search-videos https://www.google.com/search");
  });
});
