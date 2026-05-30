import { describe, expect, it } from "vitest";
import { describeSourceNavigationPlan } from "../src/source-navigation.js";
import { describeSourceStrategy } from "../src/source-strategy.js";

describe("describeSourceNavigationPlan", () => {
  it("plans Naver search vertical, filter, and destination evidence", () => {
    const plan = planFor("https://search.naver.com/search.naver?query=%EC%84%9C%EC%9A%B8%20%EB%A7%9B%EC%A7%91");

    expect(plan).toMatchObject({
      platform: "naver_search",
      sourceFamily: "search",
      mode: "plan_only",
      queryState: {
        queryText: "서울 맛집",
        localeSensitive: true
      }
    });
    expect(plan.plannedActions.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "set_query",
      "open_vertical_tab",
      "apply_filter",
      "apply_sort",
      "paginate",
      "select_result",
      "follow_destination"
    ]));
    expect(plan.extractionTargets.map((target) => target.kind)).toEqual(expect.arrayContaining([
      "serp",
      "result_ranking",
      "visible_filters"
    ]));
    expect(plan.warnings.join("\n")).toContain("Search snippets");
  });

  it("plans map viewport, selected place, and OCR evidence", () => {
    const plan = planFor("https://map.naver.com/p/search/%EC%B9%B4%ED%8E%98");

    expect(plan).toMatchObject({
      platform: "naver_map",
      sourceFamily: "map"
    });
    expect(plan.queryState.requiredFields).toEqual(expect.arrayContaining([
      "region_or_viewport",
      "selected_place"
    ]));
    expect(plan.plannedActions.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "capture_map_viewport",
      "select_map_place",
      "run_ocr",
      "follow_destination"
    ]));
    expect(plan.extractionTargets.map((target) => target.kind)).toEqual(expect.arrayContaining([
      "map_viewport",
      "place_panel",
      "ocr_text",
      "structured_page_data"
    ]));
  });

  it("plans blog and cafe-like article evidence without bypassing member walls", () => {
    const plan = planFor("https://blog.naver.com/example/123");

    expect(plan).toMatchObject({
      platform: "naver_blog",
      sourceFamily: "blog"
    });
    expect(plan.plannedActions.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "capture_page_state",
      "open_media_gallery",
      "run_ocr",
      "follow_destination",
      "classify_obstruction"
    ]));
    expect(plan.extractionTargets.map((target) => target.kind)).toEqual(expect.arrayContaining([
      "article_body",
      "comments",
      "media_gallery",
      "structured_page_data"
    ]));
    expect(plan.unsupportedActions.map((action) => action.key)).toContain("member-only-bypass");
  });

  it("plans global Google search and map evidence", () => {
    const googleSearch = planFor("https://www.google.com/search?q=best+ramen");
    const googleMap = planFor("https://www.google.com/maps/search/coffee");

    expect(googleSearch).toMatchObject({
      platform: "google_search",
      sourceFamily: "search",
      queryState: { queryText: "best ramen" }
    });
    expect(googleSearch.plannedActions.map((action) => action.kind)).toContain("follow_destination");
    expect(googleMap).toMatchObject({
      platform: "google_maps",
      sourceFamily: "map"
    });
    expect(googleMap.plannedActions.map((action) => action.kind)).toContain("capture_map_viewport");
  });

  it("plans Naver and Daum news portal modules without bypassing article gates", () => {
    const naver = planFor("https://search.naver.com/search.naver?where=news&query=ai");
    const daum = planFor("https://search.daum.net/search?w=news&q=ai");

    for (const plan of [naver, daum]) {
      expect(plan.sourceFamily).toBe("portal");
      expect(plan.queryState.requiredFields).toEqual(expect.arrayContaining([
        "query_or_topic",
        "section_or_vertical",
        "publisher",
        "published_time_if_visible"
      ]));
      expect(plan.plannedActions.map((action) => action.key)).toEqual(expect.arrayContaining([
        "query-state",
        "news-section",
        "visible-filters",
        "result-pagination",
        "article-capture",
        "destination-followup",
        "obstruction-check"
      ]));
      expect(plan.extractionTargets.map((target) => target.kind)).toEqual(expect.arrayContaining([
        "news_module",
        "publisher_context",
        "article_body",
        "obstruction"
      ]));
      expect(plan.unsupportedActions.map((action) => action.key)).toEqual(expect.arrayContaining([
        "paywall-bypass",
        "comment-write",
        "unbounded-feed-crawl"
      ]));
    }
  });

  it("plans global community/forum portal sources with destination and obstruction boundaries", () => {
    const reddit = planFor("https://www.reddit.com/search/?q=tokyo%20travel");
    const quora = planFor("https://www.quora.com/search?q=tokyo%20travel");
    const stackOverflow = planFor("https://stackoverflow.com/search?q=playwright");

    for (const plan of [reddit, quora, stackOverflow]) {
      expect(plan.sourceFamily).toBe("portal");
      expect(plan.queryState.requiredFields).toEqual(expect.arrayContaining([
        "query_or_topic",
        "section_or_vertical",
        "publisher",
        "sort_or_recency"
      ]));
      expect(plan.plannedActions.map((action) => action.key)).toEqual(expect.arrayContaining([
        "article-capture",
        "destination-followup",
        "obstruction-check"
      ]));
      expect(plan.unsupportedActions.map((action) => action.key)).toEqual(expect.arrayContaining([
        "paywall-bypass",
        "comment-write",
        "unbounded-feed-crawl"
      ]));
    }
  });

  it("plans travel query state and blocks booking/payment actions", () => {
    const plan = planFor("https://www.agoda.com/hotel/example.html");

    expect(plan).toMatchObject({
      platform: "agoda",
      sourceFamily: "travel_booking"
    });
    expect(plan.queryState.requiredFields).toEqual(expect.arrayContaining([
      "dates",
      "guests",
      "currency",
      "filters"
    ]));
    expect(plan.plannedActions.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "apply_filter",
      "apply_sort",
      "paginate",
      "capture_page_state",
      "select_result",
      "run_ocr"
    ]));
    expect(plan.unsupportedActions.map((action) => action.key)).toEqual(expect.arrayContaining([
      "booking",
      "payment",
      "account-change"
    ]));
  });

  it("plans commerce product cards and blocks transaction actions", () => {
    const plan = planFor("https://www.coupang.com/np/search?q=%EB%85%B8%ED%8A%B8%EB%B6%81");

    expect(plan).toMatchObject({
      platform: "coupang",
      sourceFamily: "commerce"
    });
    expect(plan.queryState.requiredFields).toEqual(expect.arrayContaining([
      "query",
      "currency",
      "seller",
      "shipping_or_fee_visibility"
    ]));
    expect(plan.plannedActions.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "apply_filter",
      "apply_sort",
      "scroll_results",
      "paginate",
      "select_result",
      "run_ocr",
      "follow_destination"
    ]));
    expect(plan.extractionTargets.map((target) => target.kind)).toEqual(expect.arrayContaining([
      "product_card",
      "seller_context",
      "shipping_terms",
      "price_terms",
      "structured_page_data"
    ]));
    expect(plan.unsupportedActions.map((action) => action.key)).toEqual(expect.arrayContaining([
      "cart",
      "purchase",
      "account-change"
    ]));
  });

  it("plans video/social frame, OCR, obstruction, and unsupported gate actions", () => {
    const youtube = planFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const tiktok = planFor("https://www.tiktok.com/@example/video/123");
    const x = planFor("https://x.com/example/status/1234567890");

    for (const plan of [youtube, tiktok, x]) {
      expect(plan.sourceFamily).toBe("video_social");
      expect(plan.plannedActions.map((action) => action.kind)).toEqual(expect.arrayContaining([
        "classify_obstruction",
        "follow_destination",
        "sample_video_frames",
        "run_ocr"
      ]));
      expect(plan.extractionTargets.map((target) => target.evidenceKind)).toEqual(expect.arrayContaining([
        "metadata",
        "frame_screenshot",
        "transcript_cue",
        "ocr_text",
        "browser_obstruction"
      ]));
      expect(plan.unsupportedActions.map((action) => action.key)).toEqual(expect.arrayContaining([
        "raw-stream-download",
        "gate-bypass",
        "social-write"
      ]));
    }
  });

  it("falls back to a conservative generic web plan", () => {
    const plan = planFor("https://example.com/path");

    expect(plan).toMatchObject({
      platform: "generic",
      sourceFamily: "generic_web"
    });
    expect(plan.plannedActions.map((action) => action.kind)).toEqual(expect.arrayContaining([
      "capture_page_state",
      "scroll_results",
      "follow_destination"
    ]));
    expect(plan.unsupportedActions.map((action) => action.key)).toContain("unknown-mutating-action");
  });
});

function planFor(url: string) {
  return describeSourceNavigationPlan({ sourceStrategy: describeSourceStrategy(url) });
}
