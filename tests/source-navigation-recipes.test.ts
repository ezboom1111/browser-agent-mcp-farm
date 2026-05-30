import { describe, expect, it } from "vitest";
import { describeSourceNavigationPlan } from "../src/source-navigation.js";
import { describeSourceNavigationRecipePlan, summarizeSourceNavigationRecipePlan } from "../src/source-navigation-recipes.js";
import { describeSourceStrategy } from "../src/source-strategy.js";

describe("describeSourceNavigationRecipePlan", () => {
  it("builds manual-only Google search selector candidates", () => {
    const plan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");

    expect(plan).toMatchObject({
      platform: "google_search",
      sourceFamily: "search",
      executionPolicy: "manual_opt_in_only",
      verificationStatus: "fixture_verified"
    });
    expect(plan.actionCandidates.map((action) => action.actionKey)).toEqual(expect.arrayContaining(["query-state", "vertical-tab", "visible-filters", "result-selection", "destination-followup"]));
    const queryState = plan.actionCandidates.find((action) => action.actionKey === "query-state");
    expect(queryState?.selectorCandidates.map((candidate) => candidate.selector)).toContain('textarea[name="q"]');
    expect(plan.actionCandidates.find((action) => action.actionKey === "result-selection")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#rso a[href]:has(h3)", "#search a[href]:has(h3)", "#search a[data-ved][href]"]));
    expect(plan.actionCandidates.find((action) => action.actionKey === "result-selection")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining([
        "#google-rich-main",
        "#google-local-module",
        "#google-news-module",
        "#google-image-module",
        "#google-video-module",
        "#google-travel-module",
        "#google-hotel-offer-card",
        "#google-destination-links",
        "#rso",
        "#rso a[href]:has(h3)",
        "#tads",
        "#bottomads",
        "#rhs",
        "#Odp5De",
        "#Odp5De .VkpGBb",
        "#Odp5De .rllt__details",
        '#Odp5De [aria-label*="Places"]',
        '#Odp5De [data-test-id="moc"]',
        '#Odp5De img[src*="googleusercontent.com"]',
        "#lu_map",
        '#search a[href*="/maps/place"]',
        '#search a[href*="google.com/maps"]',
        '#search [aria-label*="Places"]',
        '#search [aria-label*="Map"]',
        "#search g-section-with-header",
        '#search a[href*="/travel/hotels"]',
        '#search a[href*="/travel/search"]',
        '#search div:has(a[href*="/travel/hotels"])',
        '#search div:has(a[href*="/travel/search"])',
        '#search g-section-with-header:has(a[href*="news.google.com"])',
        '#search a[href*="news.google.com"]',
        '#search [aria-label*="News"]',
        '#search [aria-label*="뉴스"]',
        '#search [aria-label*="ニュース"]',
        '#search div:has(a[href*="news.google.com"])',
        '#search g-section-with-header:has(a[href*="youtube.com"])',
        '#search a[href*="youtube.com/watch"]',
        '#search a[href*="youtube.com/shorts"]',
        '#search a[href*="youtu.be/"]',
        '#search a[href*="vimeo.com"]',
        '#search [aria-label*="Videos"]',
        '#search [aria-label*="동영상"]',
        '#search [aria-label*="動画"]',
        '#search div:has(a[href*="youtube.com/watch"])',
        "#search g-img",
        "#search img",
        "#search a[href]:has(img)",
        '#search a[href*="/imgres"]',
        '#search [aria-label*="Images"]',
        '#search [aria-label*="이미지"]',
        '#search [aria-label*="画像"]',
        "#search div:has(g-img)",
        "#search div[data-attrid]"
      ])
    );
    expect(plan.actionCandidates.find((action) => action.actionKey === "vertical-tab")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining([
        "#google-tab-news",
        "#google-tab-images",
        "#google-tab-videos",
        "#google-tab-maps",
        'a[href*="tbm=isch"]',
        'a[href*="tbm=nws"]',
        'a[href*="tbm=vid"]',
        'a[href*="udm=2"]',
        'a[href*="udm=7"]',
        'a:has-text("Images")',
        'a:has-text("News")',
        'a:has-text("Videos")',
        'a:has-text("이미지")',
        'a:has-text("뉴스")',
        'a:has-text("동영상")',
        'a:has-text("画像")',
        'a:has-text("ニュース")',
        'a:has-text("動画")'
      ])
    );
    expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.operation).toBe("extract_destinations");
    expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual([
      "#result-card",
      "#result-link",
      "#google-destination-links",
      "#google-organic-link",
      "#google-news-link",
      "#google-local-link",
      "#google-image-link",
      "#google-video-link",
      "#google-travel-link",
      "#google-travel-module",
      "#google-hotel-offer-card",
      "#google-video-module",
      "#google-image-module",
      "#rso",
      "#search",
      "#rso [data-url]",
      "#rso [data-href]",
      "#search [data-url]",
      "#search [data-href]",
      "#search [data-target-url]",
      "#search [data-travel-url]",
      "#search [data-hotel-url]",
      "#search [data-offer-url]",
      "#rso a[href]:has(h3)",
      "#search a[href]:has(h3)",
      "#search a[data-ved][href]:has(h3)",
      "#search a[data-ved][href]",
      '#search a[href*="news.google.com"]',
      '#search a[href*="youtube.com/watch"]',
      '#search a[href*="youtube.com/shorts"]',
      '#search a[href*="youtu.be/"]',
      '#search a[href*="vimeo.com"]',
      "#search a[href]:has(img)",
      '#search a[href*="/imgres"]',
      '#search a[href*="/travel/hotels"]',
      '#search a[href*="/travel/search"]'
    ]);
    expect(JSON.stringify(plan)).toContain("Search tools");
    expect(plan.warnings.join("\n")).toContain("not executed by default");
    expect(plan.actionCandidates.find((action) => action.actionKey === "result-selection")?.blockedSignals).toEqual(expect.arrayContaining(["unusual traffic from your computer network", "not a robot", "solve the task below", "\uACC4\uC18D\uD558\uB824\uBA74 \uC544\uB798 \uACFC\uC81C"]));
  });

  it("builds Naver search module scopes for destination extraction calibration", () => {
    const plan = recipePlanFor("https://search.naver.com/search.naver?query=seongsu+cafe");

    expect(plan).toMatchObject({
      platform: "naver_search",
      sourceFamily: "search",
      verificationStatus: "fixture_verified"
    });
    expect(plan.actionCandidates.find((action) => action.actionKey === "vertical-tab")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining([
        "#naver-tab-view",
        "#naver-tab-news",
        "#naver-tab-image",
        "#naver-tab-video",
        "#naver-tab-place",
        "#naver-tab-shopping",
        'a[href*="where=blog"]',
        'a[href*="where=cafe"]',
        'a[href*="where=news"]',
        'a[href*="where=image"]',
        'a[href*="where=video"]',
        'a[href*="where=place"]',
        'a[href*="where=shopping"]',
        'a[href*="where=view"]',
        'a:has-text("뉴스")',
        'a:has-text("이미지")',
        'a:has-text("동영상")',
        'a:has-text("지도")',
        'a:has-text("쇼핑")'
      ])
    );
    expect(plan.actionCandidates.find((action) => action.actionKey === "result-selection")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining([
        "#naver-integrated-main",
        "#naver-view-module",
        "#naver-news-module",
        "#naver-place-module",
        "#naver-image-module",
        "#naver-video-module",
        "#naver-shopping-module",
        "#naver-integrated-destination-links",
        "#main_pack",
        "#main_pack .api_subject_bx",
        "#main_pack .total_wrap",
        "#main_pack .view_wrap",
        "#main_pack .news_wrap",
        "#main_pack .place_section",
        "#main_pack .video_wrap",
        "#main_pack .image_wrap",
        "#main_pack .shopping_wrap",
        "#main_pack .sp_nshop",
        "#main_pack a.news_tit",
        "#main_pack a.api_txt_lines",
        '#main_pack a[href*="n.news.naver.com"]',
        '#main_pack a[href*="news.naver.com"]',
        '#main_pack a[href*="blog.naver.com"]',
        '#main_pack a[href*="cafe.naver.com"]',
        '#main_pack a[href*="place.naver.com"]',
        '#main_pack a[href*="map.naver.com"]',
        '#main_pack a[href*="shopping.naver.com"]',
        '#main_pack a[href*="smartstore.naver.com"]',
        '#main_pack a[href*="youtube.com/watch"]'
      ])
    );
    expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining([
        "#naver-integrated-destination-links",
        "#naver-view-link",
        "#naver-cafe-link",
        "#naver-news-link",
        "#naver-place-link",
        "#naver-image-link",
        "#naver-video-link",
        "#naver-shopping-link",
        "#naver-place-module",
        "#naver-shopping-module",
        "#main_pack .total_wrap",
        "#main_pack .view_wrap",
        "#main_pack .news_wrap",
        "#main_pack .place_section",
        "#main_pack .video_wrap",
        "#main_pack .image_wrap",
        "#main_pack .shopping_wrap",
        "#main_pack .sp_nshop",
        '#main_pack [data-url*="place.naver.com"]',
        '#main_pack [data-url*="shopping.naver.com"]',
        '#main_pack [data-url*="smartstore.naver.com"]',
        "#main_pack a.news_tit",
        "#main_pack a.api_txt_lines",
        '#main_pack a[href*="n.news.naver.com"]',
        '#main_pack a[href*="news.naver.com"]',
        '#main_pack a[href*="blog.naver.com"]',
        '#main_pack a[href*="cafe.naver.com"]',
        '#main_pack a[href*="place.naver.com"]',
        '#main_pack a[href*="map.naver.com"]',
        '#main_pack a[href*="shopping.naver.com"]',
        '#main_pack a[href*="smartstore.naver.com"]',
        '#main_pack a[href*="youtube.com/watch"]'
      ])
    );
  });

  it("builds fixture-backed Daum search scopes for real-site calibration", () => {
    const plan = recipePlanFor("https://search.daum.net/search?q=seongsu+cafe");

    expect(plan).toMatchObject({
      platform: "daum_search",
      sourceFamily: "search",
      verificationStatus: "fixture_verified"
    });
    expect(plan.actionCandidates.find((action) => action.actionKey === "vertical-tab")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining([
        ".list_tab a",
        "#daumGnb a",
        'a[href*="w=news"]',
        'a[href*="w=blog"]',
        'a[href*="w=cafe"]',
        'a[href*="w=img"]',
        'a[href*="w=vclip"]',
        'a[href*="w=place"]',
        'a[href*="w=shopping"]',
        'a:has-text("뉴스")',
        'a:has-text("이미지")',
        'a:has-text("동영상")',
        'a:has-text("지도")',
        'a:has-text("쇼핑")'
      ])
    );
    expect(plan.actionCandidates.find((action) => action.actionKey === "result-selection")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining([
        "#daum-result-card",
        "#mArticle",
        "#cMain",
        "#daumContent",
        "#mArticle .wrap_cont",
        "#mArticle .cont_inner",
        "#mArticle .item-title",
        "#mArticle .tit_main",
        "#mArticle .c-list-basic",
        "#mArticle .news_item",
        "#mArticle .wrap_thumb",
        "#mArticle a[href*='v.daum.net']",
        "#mArticle a[href*='news.daum.net']",
        "#mArticle a[href*='blog.daum.net']",
        "#mArticle a[href*='tistory.com']",
        "#mArticle a[href*='cafe.daum.net']",
        "#mArticle a[href*='place.map.kakao.com']",
        "#mArticle a[href*='shoppinghow.kakao.com']",
        "#mArticle a[href*='youtube.com/watch']"
      ])
    );
    expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.operation).toBe("extract_destinations");
    expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining([
        "#daum-result-card",
        "#daum-result-link",
        "#mArticle",
        "#cMain",
        "#daumContent",
        "#mArticle .wrap_cont",
        "#mArticle .cont_inner",
        "#mArticle .item-title",
        "#mArticle .tit_main",
        "#mArticle .c-list-basic",
        "#mArticle .news_item",
        "#mArticle .wrap_thumb",
        "#mArticle a[href]",
        "#cMain a[href]",
        "#daumContent a[href]",
        "#mArticle [data-url]",
        "#mArticle [data-href]",
        "#mArticle [data-target-url]",
        "#mArticle a[href*='v.daum.net']",
        "#mArticle a[href*='news.daum.net']",
        "#mArticle a[href*='blog.daum.net']",
        "#mArticle a[href*='tistory.com']",
        "#mArticle a[href*='cafe.daum.net']",
        "#mArticle a[href*='place.map.kakao.com']",
        "#mArticle a[href*='shoppinghow.kakao.com']",
        "#mArticle a[href*='youtube.com/watch']"
      ])
    );
  });

  it("builds provider-specific Bing and Yahoo search candidates for top-slot calibration", () => {
    const bing = recipePlanFor("https://www.bing.com/search?q=tokyo+hotel");
    const yahoo = recipePlanFor("https://search.yahoo.com/search?p=tokyo+hotel");
    const yahooJapan = recipePlanFor("https://search.yahoo.co.jp/search?p=tokyo+hotel");

    for (const plan of [bing, yahoo, yahooJapan]) {
      expect(plan).toMatchObject({
        sourceFamily: "search",
        executionPolicy: "manual_opt_in_only",
        verificationStatus: "fixture_verified"
      });
      expect(plan.actionCandidates.map((action) => action.actionKey)).toEqual(expect.arrayContaining(["query-state", "vertical-tab", "visible-filters", "result-selection", "destination-followup"]));
      expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.operation).toBe("extract_destinations");
    }

    expect(bing).toMatchObject({ platform: "bing" });
    expect(bing.actionCandidates.find((action) => action.actionKey === "query-state")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#bing-query", "#sb_form_q"]));
    expect(bing.actionCandidates.find((action) => action.actionKey === "vertical-tab")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#bing-tab-news", 'a[href*="/images/search"]', 'a[href*="/videos/search"]', 'a[href*="/news/search"]']));
    expect(bing.actionCandidates.find((action) => action.actionKey === "result-selection")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#bing-results", "#bing-result-card", "#b_results", "#b_results .b_algo", "#b_context"]));
    expect(bing.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#bing-destination-links", "#bing-result-link", "#b_results h2 a[href]", "#b_context a[href]"]));

    expect(yahoo).toMatchObject({ platform: "yahoo_search" });
    expect(yahoo.actionCandidates.find((action) => action.actionKey === "query-state")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#yahoo-query", 'input[name="p"]']));
    expect(yahoo.actionCandidates.find((action) => action.actionKey === "vertical-tab")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(['a[href*="images.search.yahoo.com/search/images"]', 'a[href*="news.search.yahoo.com/search"]', 'a[href*="video.search.yahoo.com/search/video"]'])
    );
    expect(yahoo.actionCandidates.find((action) => action.actionKey === "result-selection")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#yahoo-results", "#yahoo-result-card", "#web", "ol.searchCenterMiddle", ".dd.algo"]));
    expect(yahoo.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#yahoo-destination-links", "#yahoo-result-link", ".compTitle a[href]", 'a[href*="news.yahoo.com"]', 'a[href*="r.search.yahoo.com"]'])
    );

    expect(yahooJapan).toMatchObject({ platform: "yahoo_japan_search" });
    expect(yahooJapan.actionCandidates.find((action) => action.actionKey === "vertical-tab")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#yahoo-japan-tab-news", 'a[href*="/image/search"]', 'a[href*="/video/search"]', 'a[href*="news.yahoo.co.jp/search"]', 'a[href*="chiebukuro.yahoo.co.jp/search"]'])
    );
    expect(yahooJapan.actionCandidates.find((action) => action.actionKey === "result-selection")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#yahoo-japan-contents", "#yahoo-japan-result-card", "#contents", "#WS2m", ".sw-Card"]));
    expect(yahooJapan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#yahoo-japan-destination-links", "#yahoo-japan-result-link", "#contents a[href]", 'a[href*="news.yahoo.co.jp"]', 'a[href*="chiebukuro.yahoo.co.jp"]', 'a[href*="shopping.yahoo.co.jp"]', 'a[href*="map.yahoo.co.jp"]'])
    );
  });

  it("keeps Naver and Kakao map recipes manual and scoped", () => {
    const naver = recipePlanFor("https://map.naver.com/p/search/cafe");
    const kakao = recipePlanFor("https://map.kakao.com/?q=seoul+cafe");
    const google = recipePlanFor("https://www.google.com/maps/search/seoul+cafe");
    const apple = recipePlanFor("https://maps.apple.com/?q=seoul+cafe");

    for (const plan of [naver, kakao, google, apple]) {
      const summary = summarizeSourceNavigationRecipePlan(plan);
      expect(summary).toMatchObject({
        executionPolicy: "manual_opt_in_only",
        manualOnly: true
      });
      expect(plan.verificationStatus).toBe("fixture_verified");
      expect(plan.actionCandidates.map((action) => action.actionKey)).toEqual(expect.arrayContaining(["map-viewport", "selected-place", "map-ocr", "destination-followup"]));
      expect(plan.actionCandidates.flatMap((action) => action.riskNotes).join("\n")).toContain("must not click route, call, reservation, or booking controls");
      expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.operation).toBe("extract_destinations");
    }

    expect(google.actionCandidates.find((action) => action.actionKey === "selected-place")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#google-place-sheet", "#google-review-list", "#google-photo-strip"]));
    expect(naver.actionCandidates.find((action) => action.actionKey === "map-viewport")?.captureScopeCandidates.map((candidate) => candidate.selector)).toContain("#root");
    expect(naver.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining([
        "#map-destination-links",
        "#place-website-link",
        '#root [data-place-url*="place.naver.com/restaurant"]',
        '#root [data-place-url*="place.naver.com/hospital"]',
        '#root [data-place-url*="place.naver.com/place"]',
        '#root [data-place-url*="place.naver.com/accommodation"]',
        '#root [data-url*="place.naver.com/restaurant"]',
        '#root a[href*="place.naver.com/restaurant"]',
        '#root [data-place-url*="place.naver.com"]',
        '#root [data-url*="place.naver.com"]',
        '#root [data-url*="map.naver.com/p/entry/place"]',
        '#root a[href*="place.naver.com"]',
        '#root a[href*="map.naver.com/p/entry/place"]',
        '#root a[href*="map.naver.com/v5/entry/place"]',
        '#root a[href*="booking.naver.com"]'
      ])
    );
    const naverDestinationCandidates = naver.actionCandidates.filter((action) => action.actionKey === "destination-followup");
    expect(naverDestinationCandidates.map((action) => action.operation)).toEqual(expect.arrayContaining(["extract_destinations", "extract_client_state_destinations"]));
    expect(naverDestinationCandidates.find((action) => action.operation === "extract_client_state_destinations")).toMatchObject({
      clientStateExtraction: {
        stateKey: "__APOLLO_STATE__",
        extractor: "naver_place_apollo",
        destinationPath: "restaurant",
        maxLinks: 10
      }
    });
    expect(naverDestinationCandidates.find((action) => action.operation === "extract_client_state_destinations")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#app-root", "#_pcmap_list_scroll_container", "#_pcmap_list_scroll_container li"]));
    expect(kakao.actionCandidates.find((action) => action.actionKey === "map-viewport")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#view\\.mapContainer", "#view\\.map", "#view"]));
    expect(kakao.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(['#info\\.search\\.place\\.list [data-url*="place.map.kakao.com"]', "#info\\.search\\.place\\.list a[href]", "#info\\.search\\.place a[href]", 'a[href*="place.map.kakao.com"]'])
    );
    expect(google.actionCandidates.find((action) => action.actionKey === "map-viewport")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining([".lbMcOd", ".UL7Qtf"]));
    expect(google.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#google-place-website-link", '[role="main"] [data-url*="/maps/place"]', '[role="main"] [data-href*="/maps/place"]', 'a[href*="google.com/maps/place"]', 'a[data-item-id*="authority"]', '[role="main"] a[href^="http"]'])
    );
    expect(apple.actionCandidates.find((action) => action.actionKey === "query-state")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#apple-map-query", 'input[aria-label*="Search Maps"]', 'input[placeholder*="Search Maps"]']));
    expect(apple.actionCandidates.find((action) => action.actionKey === "map-viewport")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#apple-map-viewport", "#maps-app", '[data-testid*="map"]']));
    expect(apple.actionCandidates.find((action) => action.actionKey === "selected-place")?.selectorCandidates.map((candidate) => candidate.selector)).toContain("#apple-place-row");
    expect(apple.actionCandidates.find((action) => action.actionKey === "selected-place")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#apple-place-card", "#apple-review-list", '[data-testid*="place-card"]']));
    expect(apple.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#apple-place-website-link", "#apple-place-menu-link", "#apple-place-review-link", '[data-place-url*="maps.apple.com"]', 'a[href*="maps.apple.com/place"]', 'a[href^="http"][aria-label*="Website"]'])
    );
  });

  it("keeps Naver Blog generic login headers out of blocked signals", () => {
    const plan = recipePlanFor("https://section.blog.naver.com/Search/Post.naver?keyword=cafe");
    const articleCapture = plan.actionCandidates.find((action) => action.actionKey === "article-capture");
    const obstruction = plan.actionCandidates.find((action) => action.actionKey === "obstruction-check");

    expect(plan).toMatchObject({
      platform: "naver_blog",
      sourceFamily: "blog",
      verificationStatus: "fixture_verified"
    });
    expect(plan.actionCandidates.map((action) => action.actionKey)).toEqual(expect.arrayContaining(["article-capture", "media-gallery", "destination-followup", "obstruction-check"]));
    expect(articleCapture?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#content", "#app", ".post_list_wrap", "body"]));
    expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.operation).toBe("extract_destinations");
    expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#blog-destination-links", "#article-source-link", "#related-post-link", "#official-link", "#postViewArea a[href]", ".se-main-container a[href]", 'a[href*="blog.naver.com"]', 'a[href*="naver.me"]'])
    );
    expect(obstruction?.blockedSignals).toEqual(expect.arrayContaining(["\uAC00\uC785\uD574\uC57C", "\uC811\uADFC \uAD8C\uD55C", "members only"]));
    expect(obstruction?.blockedSignals).not.toContain("\uB85C\uADF8\uC778");
    expect(obstruction?.blockedSignals).not.toContain("\uAC00\uC785");
  });

  it("marks travel and video/social candidates as opt-in only with blocked signals", () => {
    const booking = recipePlanFor("https://www.booking.com/hotel/kr/example.html");
    const tiktok = recipePlanFor("https://www.tiktok.com/@example/video/1234567890123456789");

    expect(booking.actionCandidates.map((action) => action.actionKey)).toEqual(expect.arrayContaining(["result-scroll", "result-pagination", "offer-detail", "price-ocr"]));
    expect(booking.actionCandidates.flatMap((action) => action.riskNotes).join("\n")).toContain("Do not click reserve, book, pay");
    expect(booking.actionCandidates.find((action) => action.actionKey === "offer-detail")?.blockedSignals).toEqual(expect.arrayContaining(["Pardon Our Interruption", "access to this page has been denied", "complete the security check"]));
    const obstruction = tiktok.actionCandidates.find((action) => action.actionKey === "obstruction-check");
    expect(obstruction?.blockedSignals).toEqual(expect.arrayContaining(["captcha", "please log in", "log in to continue", "open app"]));
    expect(tiktok.actionCandidates.find((action) => action.actionKey === "visible-metadata")?.selectorCandidates.map((candidate) => candidate.selector)).toContain("#visible-post");
    expect(tiktok.actionCandidates.find((action) => action.actionKey === "visible-metadata")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#tiktok-visible-post", "#tiktok-post-metadata", '[data-e2e="browse-video"]', '[data-e2e="video-desc"]']));
    expect(tiktok.actionCandidates.find((action) => action.actionKey === "visible-metadata")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#profile-card", "#caption-body", "#engagement-state", "#comment-preview-list", "#tiktok-profile-card", "#tiktok-caption-body", "#tiktok-engagement-state", "#tiktok-comment-preview-list"])
    );
    expect(tiktok.actionCandidates.find((action) => action.actionKey === "destination-followup")?.operation).toBe("extract_destinations");
    expect(tiktok.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#social-destination-links", "#profile-link", "#external-link", "#video-watch-link", "#tiktok-destination-links", "#tiktok-profile-link", "#tiktok-external-link", "#tiktok-video-watch-link", 'a[href*="/video/"]', "[data-media-url]", "[data-profile-url]", 'a[href*="/@"]'])
    );
    expect(tiktok.actionCandidates.find((action) => action.actionKey === "frame-sampling")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#video-frame", "#tiktok-video-frame", '[data-e2e="video-player"]']));
    expect(tiktok.actionCandidates.find((action) => action.actionKey === "overlay-ocr")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#overlay-text", "#tiktok-overlay-text", "#tiktok-video-frame"]));
    expect(tiktok.executionPolicy).toBe("manual_opt_in_only");

    const x = recipePlanFor("https://x.com/example/status/1234567890");
    expect(x).toMatchObject({
      platform: "x_twitter",
      sourceFamily: "video_social",
      verificationStatus: "fixture_verified"
    });
    expect(x.actionCandidates.find((action) => action.actionKey === "visible-metadata")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#x-visible-post", "#x-post-metadata", "#x-profile-card", "#x-thread-context", "#x-engagement-state", "#x-reply-list", 'article[data-testid="tweet"]', '[data-testid="tweetText"]'])
    );
    expect(x.actionCandidates.find((action) => action.actionKey === "frame-sampling")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#x-media-frame", '[data-testid="videoPlayer"]', '[data-testid="tweetPhoto"]']));
    expect(x.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#x-profile-link", '[data-testid="tweet"] [data-media-url]', '[data-testid="tweet"] [data-profile-url]', '[data-testid="tweet"] a[href*="/status/"]', '[data-testid="tweet"] a[href^="/"]', '[data-testid="User-Name"] a[href]'])
    );
    expect(x.actionCandidates.find((action) => action.actionKey === "obstruction-check")?.blockedSignals).toEqual(expect.arrayContaining(["sign in to continue", "unlock more posts"]));

    const youtube = recipePlanFor("https://www.youtube.com/results?search_query=seongsu+cafe");
    expect(youtube.actionCandidates.find((action) => action.actionKey === "visible-metadata")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["ytd-video-renderer", "ytd-rich-item-renderer", "#contents"]));
    expect(youtube.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining([
        "#channel-link",
        "#contents [data-media-url]",
        "#contents [data-channel-url]",
        'ytd-video-renderer a#video-title[href*="/watch"]',
        'ytd-video-renderer a#video-title[href*="/shorts"]',
        'ytd-rich-item-renderer a#video-title-link[href*="/watch"]',
        'ytd-rich-item-renderer a#thumbnail[href*="/watch"]',
        'ytd-channel-name a[href*="/@"]',
        'a#channel-thumbnail[href*="/@"]',
        '#contents a[href*="/watch"]',
        '#contents a[href*="/shorts"]',
        '#contents a[href*="/channel/"]',
        '#contents a[href*="/@"]'
      ])
    );
    expect(youtube.actionCandidates.find((action) => action.actionKey === "overlay-ocr")?.selectorCandidates).toEqual(expect.arrayContaining([expect.objectContaining({ selector: "#overlay-text", source: "real_site_candidate" })]));
  });

  it("builds provider-specific travel booking selectors for global platforms", () => {
    const booking = recipePlanFor("https://www.booking.com/searchresults.html?ss=Tokyo");
    const agoda = recipePlanFor("https://www.agoda.com/search?text=Tokyo");
    const trip = recipePlanFor("https://www.trip.com/search?keyword=Tokyo");
    const expedia = recipePlanFor("https://www.expedia.com/Hotel-Search?destination=Tokyo");

    for (const plan of [booking, agoda, trip, expedia]) {
      expect(plan).toMatchObject({
        sourceFamily: "travel_booking",
        executionPolicy: "manual_opt_in_only",
        verificationStatus: "fixture_verified"
      });
      expect(plan.actionCandidates.map((action) => action.actionKey)).toEqual(expect.arrayContaining(["query-state", "visible-filters", "visible-sort", "result-scroll", "result-pagination", "offer-card", "offer-detail", "price-ocr"]));
      expect(plan.actionCandidates.find((action) => action.actionKey === "price-ocr")?.blockedSignals).toEqual(expect.arrayContaining(["verify you are human", "please enable cookies"]));
    }

    expect(booking.actionCandidates.find((action) => action.actionKey === "query-state")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(['input[name="ss"]', '[data-testid="destination-container"]', '[data-testid="occupancy-config"]']));
    expect(booking.actionCandidates.find((action) => action.actionKey === "price-ocr")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(['[data-testid="price-and-discounted-price"]', '[data-testid="taxes-and-charges"]']));

    expect(agoda.actionCandidates.find((action) => action.actionKey === "offer-detail")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(['[data-selenium="room-card"]', '[data-selenium="hotel-item"]']));
    expect(agoda.actionCandidates.find((action) => action.actionKey === "offer-card")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(['[data-element-name="geo-carousel-card"]', '[data-selenium="base-card"]']));
    expect(agoda.actionCandidates.find((action) => action.actionKey === "price-ocr")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(['[data-selenium="display-price"]', '[class*="PriceCurrency"]', '[data-element-name="geo-dateless-search-property-card"]']));

    expect(trip.actionCandidates.find((action) => action.actionKey === "result-scroll")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(['[class*="hotel-card"]', '[class*="HotelCard"]', '[class*="hotel-list"]']));

    expect(expedia.actionCandidates.find((action) => action.actionKey === "offer-detail")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(['[data-stid*="open-hotel-information"]', '[data-stid*="property-listing"]']));
    expect(expedia.actionCandidates.find((action) => action.actionKey === "price-ocr")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(['[data-stid*="price-summary"]', '[data-stid*="lodging-card-price"]']));
  });

  it("builds provider-specific knowledge database capture and citation candidates", () => {
    const googleScholar = recipePlanFor("https://scholar.google.com/scholar?q=machine+learning");
    const wikipedia = recipePlanFor("https://en.wikipedia.org/wiki/Tokyo");
    const namuwiki = recipePlanFor("https://namu.wiki/w/%EC%84%B1%EC%88%98%EB%8F%99");
    const pubmed = recipePlanFor("https://pubmed.ncbi.nlm.nih.gov/?term=playwright");
    const dataGoKr = recipePlanFor("https://www.data.go.kr/tcs/dss/selectDataSetList.do?keyword=population");
    const riss = recipePlanFor("https://www.riss.kr/search/Search.do?queryText=ai");
    const kipris = recipePlanFor("https://www.kipris.or.kr/khome/search/search.do?queryText=robot");

    expect(googleScholar).toMatchObject({
      platform: "google_scholar",
      sourceFamily: "portal",
      executionPolicy: "manual_opt_in_only",
      verificationStatus: "fixture_verified"
    });
    expect(googleScholar.actionCandidates.map((action) => action.actionKey)).toEqual(expect.arrayContaining(["query-state", "news-section", "visible-filters", "article-capture", "destination-followup", "obstruction-check"]));
    expect(googleScholar.actionCandidates.find((action) => action.actionKey === "query-state")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(['input[name="q"]', "#gs_hdr_tsi"]));
    expect(googleScholar.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#gs_res_ccl_mid", ".gs_r", ".gs_rt", ".gs_a", ".gs_rs", ".gs_or_ggsm"]));
    expect(googleScholar.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining([".gs_rt a[href]", ".gs_or_ggsm a[href]", 'a[href*="scholar?cites="]', 'a[href*="scholar?cluster="]']));

    for (const plan of [wikipedia, namuwiki, pubmed, dataGoKr, riss, kipris]) {
      expect(plan).toMatchObject({
        sourceFamily: "generic_web",
        executionPolicy: "manual_opt_in_only",
        verificationStatus: "fixture_verified"
      });
      expect(plan.actionCandidates.map((action) => action.actionKey)).toEqual(["page-capture", "bounded-scroll", "destination-followup"]);
      expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.operation).toBe("extract_destinations");
      expect(plan.actionCandidates.flatMap((action) => action.riskNotes).join("\n")).toContain("Do not click edit, login, download-restricted, paid full text, or institutional-access controls");
    }

    expect(wikipedia).toMatchObject({ platform: "wikipedia" });
    expect(wikipedia.actionCandidates.find((action) => action.actionKey === "page-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#mw-content-text", ".mw-parser-output", ".infobox", "ol.references"]));
    expect(wikipedia.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#mw-content-text a[href]", ".mw-parser-output a[href]", "ol.references a[href]"]));

    expect(namuwiki).toMatchObject({ platform: "namuwiki" });
    expect(namuwiki.actionCandidates.find((action) => action.actionKey === "page-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#app", "article", ".wiki-paragraph"]));

    expect(pubmed).toMatchObject({ platform: "pubmed" });
    expect(pubmed.actionCandidates.find((action) => action.actionKey === "page-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#search-results", ".docsum-content", "#enc-abstract", ".abstract"]));
    expect(pubmed.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining([".docsum-title[href]", 'a[href*="pmc.ncbi.nlm.nih.gov"]', 'a[href*="doi.org"]']));

    expect(dataGoKr).toMatchObject({ platform: "data_go_kr" });
    expect(dataGoKr.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#contents a[href]", ".result-list a[href]", 'a[href*="selectDataSetDetail"]']));

    expect(riss).toMatchObject({ platform: "riss" });
    expect(riss.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toContain('a[href*="DetailView"]');

    expect(kipris).toMatchObject({ platform: "kipris" });
    expect(kipris.actionCandidates.find((action) => action.actionKey === "page-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining([".patentView", ".detail"]));
  });

  it("builds manual-only commerce product-card candidates", () => {
    const amazon = recipePlanFor("https://www.amazon.com/s?k=laptop");
    const coupang = recipePlanFor("https://www.coupang.com/np/search?q=laptop");
    const naverShopping = recipePlanFor("https://shopping.naver.com/search/all?query=laptop");
    const gmarket = recipePlanFor("https://browse.gmarket.co.kr/search?keyword=laptop");
    const elevenst = recipePlanFor("https://www.11st.co.kr/products/123456789");
    const walmart = recipePlanFor("https://www.walmart.com/search?q=laptop");
    const ebay = recipePlanFor("https://www.ebay.com/sch/i.html?_nkw=laptop");

    expect(coupang).toMatchObject({
      platform: "coupang",
      sourceFamily: "commerce",
      executionPolicy: "manual_opt_in_only",
      verificationStatus: "fixture_verified"
    });
    expect(coupang.actionCandidates.map((action) => action.actionKey)).toEqual(expect.arrayContaining(["query-state", "visible-filters", "visible-sort", "result-scroll", "result-pagination", "product-card", "seller-terms", "price-ocr", "destination-followup"]));
    const coupangProductScopes = coupang.actionCandidates.find((action) => action.actionKey === "product-card")?.captureScopeCandidates.map((candidate) => candidate.selector);
    expect(coupangProductScopes).toEqual(expect.arrayContaining(["#product-card", "#product-list", "#coupang-commerce-product-card", "#coupang-commerce-product-list", ".search-product"]));
    expect(coupang.actionCandidates.find((action) => action.actionKey === "price-ocr")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#coupang-commerce-price-badge", ".price-value", ".sale-price"]));
    expect(coupang.actionCandidates.find((action) => action.actionKey === "destination-followup")?.operation).toBe("extract_destinations");
    expect(coupang.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining([
        "#commerce-destination-links",
        "#product-detail-link",
        "#product-review-link",
        "#seller-profile-link",
        "#coupang-commerce-destination-links",
        "[data-product-id][data-url]",
        "[data-product-url]",
        "[data-item-url]",
        'a[href*="/vp/products/"]',
        'a[href*="vendorItemId="]',
        ".search-product-link"
      ])
    );
    expect(naverShopping.actionCandidates.find((action) => action.actionKey === "product-card")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#naver-shopping-commerce-product-card", "#naver-shopping-commerce-product-list", "#content", "#container", '[class*="basicList"]', '[class*="product_item"]'])
    );
    expect(naverShopping.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#naver-shopping-commerce-destination-links", "[data-product-url]", "[data-item-url]", "[data-brand-url]", 'a[href*="/catalog/"]', 'a[href*="/products/"]', 'a[href*="smartstore.naver.com"]', 'a[href*="brand.naver.com"]'])
    );
    expect(gmarket.actionCandidates.find((action) => action.actionKey === "product-card")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#gmarket-commerce-product-card", "#gmarket-commerce-product-list", "#section__inner-content-body-container", ".box__item", 'a[href*="item.gmarket.co.kr"]'])
    );
    expect(gmarket.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#gmarket-commerce-destination-links", "[data-item-url]", "[data-product-url]", "[data-seller-url]", 'a[href*="item.gmarket.co.kr"]', 'a[href*="goodsCode="]', ".box__item a[href]"])
    );
    expect(gmarket.actionCandidates.find((action) => action.actionKey === "product-card")?.blockedSignals).toEqual(expect.arrayContaining(["\uBE44\uC815\uC0C1\uC801\uC778 \uC811\uADFC", "\uBD07 \uD655\uC778"]));
    expect(amazon.actionCandidates.find((action) => action.actionKey === "product-card")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#amazon-commerce-product-card", "#amazon-commerce-product-list", '[data-component-type*="s-search-result"]', ".s-result-item", "[data-asin]"])
    );
    expect(amazon.actionCandidates.find((action) => action.actionKey === "price-ocr")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#amazon-commerce-price-badge", ".a-price", ".a-price-whole", '[data-a-color="price"]']));
    expect(elevenst).toMatchObject({
      platform: "elevenst",
      sourceFamily: "commerce",
      verificationStatus: "fixture_verified"
    });
    expect(elevenst.actionCandidates.find((action) => action.actionKey === "product-card")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#elevenst-commerce-product-card", "#elevenst-commerce-product-list", '[class*="search_content"]', '[class*="c_prd"]']));
    expect(elevenst.actionCandidates.find((action) => action.actionKey === "price-ocr")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#elevenst-commerce-price-badge", '[class*="salePrice"]', '[class*="c_prd_price"]']));
    expect(walmart).toMatchObject({
      platform: "walmart",
      sourceFamily: "commerce",
      verificationStatus: "fixture_verified"
    });
    expect(walmart.actionCandidates.find((action) => action.actionKey === "product-card")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#walmart-commerce-product-card", "#walmart-commerce-product-list", '[data-testid="item-stack"]', "[data-item-id]", 'a[href*="/ip/"]'])
    );
    expect(walmart.actionCandidates.find((action) => action.actionKey === "price-ocr")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#walmart-commerce-price-badge", '[data-automation-id="product-price"]', '[itemprop="price"]']));
    expect(walmart.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#walmart-commerce-destination-links", "[data-product-url]", "[data-item-url]", "[data-seller-url]", 'a[href*="/ip/"]', 'a[href*="sellerId="]'])
    );
    expect(ebay).toMatchObject({
      platform: "ebay",
      sourceFamily: "commerce",
      verificationStatus: "fixture_verified"
    });
    expect(ebay.actionCandidates.find((action) => action.actionKey === "product-card")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#ebay-commerce-product-card", "#ebay-commerce-product-list", ".srp-results", ".s-item", 'a[href*="/itm/"]']));
    expect(ebay.actionCandidates.find((action) => action.actionKey === "price-ocr")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#ebay-commerce-price-badge", ".s-item__price", ".x-price-primary"]));
    expect(ebay.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#ebay-commerce-destination-links", "[data-item-url]", "[data-product-url]", "[data-seller-url]", 'a[href*="/itm/"]', ".s-item a[href]"])
    );
    expect(coupang.actionCandidates.flatMap((action) => action.riskNotes).join("\n")).toContain("Do not click cart, buy");
  });

  it("builds provider-specific review and local portal candidates", () => {
    const yelp = recipePlanFor("https://www.yelp.com/search?find_desc=coffee");
    const tripadvisor = recipePlanFor("https://www.tripadvisor.com/Search?q=tokyo%20hotel");

    for (const plan of [yelp, tripadvisor]) {
      expect(plan).toMatchObject({
        sourceFamily: "portal",
        executionPolicy: "manual_opt_in_only",
        verificationStatus: "fixture_verified"
      });
      expect(plan.actionCandidates.map((action) => action.actionKey)).toEqual(expect.arrayContaining(["query-state", "news-section", "visible-filters", "result-pagination", "article-capture", "destination-followup", "obstruction-check"]));
      expect(plan.actionCandidates.find((action) => action.actionKey === "article-capture")?.expectedTextSignals).toEqual(expect.arrayContaining(["rating", "review", "address", "hours"]));
      expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.operation).toBe("extract_destinations");
      expect(plan.actionCandidates.find((action) => action.actionKey === "obstruction-check")?.blockedSignals).toEqual(expect.arrayContaining(["verify you are human", "please enable cookies", "open in app"]));
    }

    expect(yelp).toMatchObject({ platform: "yelp" });
    expect(yelp.actionCandidates.find((action) => action.actionKey === "query-state")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#review-query", "#review-location", 'input[name="find_desc"]', 'input[name="find_loc"]']));
    expect(yelp.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#review-module", "#review-card", "#review-meta", "#main-content", '[data-testid*="serp"]', 'a[href*="/biz/"]', '[aria-label*="rating"]'])
    );
    expect(yelp.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#review-destination-links", "#review-listing-link", "#review-menu-link", "#review-external-link", 'main a[href*="/biz/"]', 'a[href*="yelp.com/biz/"]', 'a[href*="/menu/"]', 'a[href*="biz_redir"]'])
    );

    expect(tripadvisor).toMatchObject({ platform: "tripadvisor" });
    expect(tripadvisor.actionCandidates.find((action) => action.actionKey === "query-state")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#review-query", 'input[name="q"]', 'input[type="search"]']));
    expect(tripadvisor.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#review-module", "#review-card", "#review-meta", "#BODYCON", '[data-automation*="searchResults"]', 'a[href*="/Restaurant_Review-"]', 'a[href*="/Hotel_Review-"]', '[data-test-target*="rating"]'])
    );
    expect(tripadvisor.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#review-destination-links", "#review-listing-link", 'main a[href*="/Restaurant_Review-"]', 'main a[href*="/Hotel_Review-"]', 'main a[href*="/Attraction_Review-"]', 'main a[href*="/ShowUserReviews-"]'])
    );
  });

  it("builds fixture-backed news portal candidates for Korean and global providers", () => {
    const naver = recipePlanFor("https://search.naver.com/search.naver?where=news&query=ai");
    const daum = recipePlanFor("https://search.daum.net/search?w=news&q=ai");
    const google = recipePlanFor("https://news.google.com/search?q=ai");
    const yahoo = recipePlanFor("https://news.yahoo.com/search?p=ai");
    const reuters = recipePlanFor("https://www.reuters.com/world/us/ai-policy-2026-05-28/");

    for (const plan of [naver, daum, google, yahoo, reuters]) {
      expect(plan.sourceFamily).toBe("portal");
      expect(plan.executionPolicy).toBe("manual_opt_in_only");
      expect(plan.verificationStatus).toBe("fixture_verified");
      expect(plan.actionCandidates.map((action) => action.actionKey)).toEqual(expect.arrayContaining(["query-state", "news-section", "visible-filters", "result-pagination", "article-capture", "destination-followup", "obstruction-check"]));
      expect(plan.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#news-module", "#headline-card", "#publisher-meta"]));
      expect(plan.actionCandidates.find((action) => action.actionKey === "obstruction-check")?.blockedSignals).toEqual(expect.arrayContaining(["paywall", "login required"]));
    }

    expect(google).toMatchObject({ platform: "google_news" });
    expect(google.actionCandidates.find((action) => action.actionKey === "query-state")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#google-news-query", 'input[aria-label*="Search"]']));
    expect(google.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#google-news-module", "main", "article", 'a[href^="./read/"]', 'a[href*="news.google.com/read/"]']));
    expect(google.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#google-news-module a[href]", 'article a[href^="./read/"]', 'main a[href^="./read/"]', 'a[href^="./read/"]', 'a[href*="news.google.com/read/"]'])
    );

    expect(yahoo).toMatchObject({ platform: "yahoo_news" });
    expect(yahoo.actionCandidates.find((action) => action.actionKey === "query-state")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#yahoo-news-query", 'input[name="p"]', "#ybar-sbq"]));
    expect(yahoo.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#Main", "#YDC-Stream", '[data-test-locator="stream-item"]']));
    expect(yahoo.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(['#Main a[href*="news.yahoo.com"]', '[data-test-locator="stream-item"] a[href]']));

    expect(reuters).toMatchObject({ platform: "reuters" });
    expect(reuters.actionCandidates.find((action) => action.actionKey === "query-state")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#reuters-query", 'input[name="q"]', '[data-testid*="search"] input']));
    expect(reuters.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#reuters-news-module", "#fusion-app", '[data-testid*="MediaStoryCard"]', '[data-testid*="StoryCard"]', '[data-testid*="SearchResult"]', '[data-testid*="Body"]'])
    );
    expect(reuters.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(
      expect.arrayContaining(["#reuters-news-module a[href]", '[data-testid*="MediaStoryCard"] a[href*="-20"]', '[data-testid*="SearchResult"] a[href*="-20"]', 'main a[href*="/world/"][href*="-20"]', 'main a[href*="/technology/"][href*="-20"]', 'main a[href*="reuters.com"]', '[data-testid*="MediaStoryCard"] a[href]'])
    );
  });

  it("builds fixture-backed community portal candidates for Korean and global forums", () => {
    const dcinside = recipePlanFor("https://search.dcinside.com/post?keyword=seongsu+cafe");
    const kin = recipePlanFor("https://kin.naver.com/search/list.naver?query=seongsu+cafe");
    const reddit = recipePlanFor("https://www.reddit.com/search/?q=tokyo%20travel");
    const quora = recipePlanFor("https://www.quora.com/search?q=tokyo%20travel");
    const stackOverflow = recipePlanFor("https://stackoverflow.com/search?q=playwright");

    for (const plan of [dcinside, kin, reddit, quora, stackOverflow]) {
      expect(plan.sourceFamily).toBe("portal");
      expect(plan.executionPolicy).toBe("manual_opt_in_only");
      expect(plan.verificationStatus).toBe("fixture_verified");
      expect(plan.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(
        expect.arrayContaining(["#community-module", "#thread-card", "#community-meta", "#community-destination", "#question-body", "#thread-body", "#answer-body", "#comment-list"])
      );
      expect(plan.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toContain("#community-link");
      expect(plan.actionCandidates.find((action) => action.actionKey === "obstruction-check")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#community-obstruction-state", "#destination-obstruction-state"]));
      expect(plan.actionCandidates.find((action) => action.actionKey === "obstruction-check")?.blockedSignals).toEqual(expect.arrayContaining(["private community", "join to view", "performing security verification", "you've been blocked by network security", "\uC811\uADFC \uAD8C\uD55C", "\uC0AD\uC81C\uB41C \uAE00"]));
    }

    expect(dcinside.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#container", ".sch_result", 'a[href*="board/view"]']));
    expect(kin.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#s_content", ".basic1", ".question_group"]));
    expect(reddit.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["shreddit-post", '[data-testid="post-container"]', 'a[href*="/comments/"]']));
    expect(reddit.actionCandidates.find((action) => action.actionKey === "destination-followup")?.selectorCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(['a[href*="/comments/"]', "shreddit-post a[href]"]));
    expect(quora.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining([".q-box", '[class*="Question"]', '[role="main"]']));
    expect(stackOverflow.actionCandidates.find((action) => action.actionKey === "article-capture")?.captureScopeCandidates.map((candidate) => candidate.selector)).toEqual(expect.arrayContaining(["#questions", ".s-post-summary", "a.question-hyperlink"]));
  });
});

function recipePlanFor(url: string) {
  return describeSourceNavigationRecipePlan(
    describeSourceNavigationPlan({
      sourceStrategy: describeSourceStrategy(url)
    })
  );
}
