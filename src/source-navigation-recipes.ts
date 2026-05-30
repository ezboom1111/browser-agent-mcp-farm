import type { SourceNavigationExecutableOperation } from "./source-navigation-executor.js";
import { unique as uniqueStrings } from "./util/collections.js";
import type { SourceNavigationPlan } from "./source-navigation.js";

export type SourceNavigationRecipeExecutionPolicy = "manual_opt_in_only";
export type SourceNavigationRecipeVerificationStatus = "fixture_verified" | "candidate_unverified" | "not_available";

export interface SourceNavigationSelectorCandidate {
  selector: string;
  target: "primary" | "fallback" | "scope";
  source: "local_fixture" | "real_site_candidate";
  note: string;
}

export interface SourceNavigationRecipeActionCandidate {
  actionKey: string;
  operation: SourceNavigationExecutableOperation;
  verificationStatus: SourceNavigationRecipeVerificationStatus;
  selectorCandidates: SourceNavigationSelectorCandidate[];
  captureScopeCandidates: SourceNavigationSelectorCandidate[];
  expectedTextSignals: string[];
  blockedSignals: string[];
  riskNotes: string[];
  clientStateExtraction?: SourceNavigationRecipeClientStateExtraction | undefined;
}

export interface SourceNavigationRecipeClientStateExtraction {
  stateKey: string;
  extractor: "naver_place_apollo";
  destinationPath?: string | undefined;
  maxLinks?: number | undefined;
}

export interface SourceNavigationRecipePlan {
  schemaVersion: "1.0";
  platform: SourceNavigationPlan["platform"];
  sourceFamily: SourceNavigationPlan["sourceFamily"];
  executionPolicy: SourceNavigationRecipeExecutionPolicy;
  verificationStatus: SourceNavigationRecipeVerificationStatus;
  actionCandidates: SourceNavigationRecipeActionCandidate[];
  warnings: string[];
}

export interface SourceNavigationRecipePlanSummary {
  executionPolicy: SourceNavigationRecipeExecutionPolicy;
  verificationStatus: SourceNavigationRecipeVerificationStatus;
  actionCandidateCount: number;
  selectorCandidateCount: number;
  captureScopeCandidateCount: number;
  manualOnly: true;
}

export function describeSourceNavigationRecipePlan(plan: SourceNavigationPlan): SourceNavigationRecipePlan {
  const actionCandidates = recipeCandidatesFor(plan).filter((candidate) => hasPlannedAction(plan, candidate.actionKey));
  return {
    schemaVersion: "1.0",
    platform: plan.platform,
    sourceFamily: plan.sourceFamily,
    executionPolicy: "manual_opt_in_only",
    verificationStatus: summarizeVerification(actionCandidates),
    actionCandidates,
    warnings: ["Recipe candidates are not executed by default.", "Use these selectors only after live browser-visible calibration confirms they still match the intended page state.", "Do not use candidates for login, CAPTCHA, booking, payment, app-open, or account-changing flows."]
  };
}

export function summarizeSourceNavigationRecipePlan(plan: SourceNavigationRecipePlan): SourceNavigationRecipePlanSummary {
  return {
    executionPolicy: plan.executionPolicy,
    verificationStatus: plan.verificationStatus,
    actionCandidateCount: plan.actionCandidates.length,
    selectorCandidateCount: plan.actionCandidates.reduce((sum, action) => sum + action.selectorCandidates.length, 0),
    captureScopeCandidateCount: plan.actionCandidates.reduce((sum, action) => sum + action.captureScopeCandidates.length, 0),
    manualOnly: true
  };
}

function recipeCandidatesFor(plan: SourceNavigationPlan): SourceNavigationRecipeActionCandidate[] {
  if (plan.sourceFamily === "search") {
    return searchRecipeCandidates(plan.platform);
  }
  if (plan.sourceFamily === "map") {
    return mapRecipeCandidates(plan.platform);
  }
  if (plan.sourceFamily === "blog") {
    return blogRecipeCandidates(plan.platform);
  }
  if (plan.sourceFamily === "travel_booking") {
    return travelRecipeCandidates(plan.platform);
  }
  if (plan.sourceFamily === "commerce") {
    return commerceRecipeCandidates(plan.platform);
  }
  if (plan.sourceFamily === "video_social") {
    return videoSocialRecipeCandidates(plan.platform);
  }
  if (plan.sourceFamily === "portal") {
    return portalRecipeCandidates(plan.platform);
  }
  if (isKnowledgeDatabasePlatform(plan.platform)) {
    return knowledgeDatabaseRecipeCandidates(plan.platform);
  }
  return genericRecipeCandidates();
}

const SECURITY_CHALLENGE_SIGNALS = [
  "performing security verification",
  "security service to protect against malicious bots",
  "malicious bots",
  "verifies you are not a bot",
  "you are not a bot",
  "solve the puzzle below",
  "solve the task below",
  "complete the task below",
  "complete the challenge below",
  "you've been blocked by network security",
  "blocked by network security",
  "file a ticket below",
  "performance and security by cloudflare",
  "datadome",
  "captcha-delivery.com",
  "geo.captcha-delivery.com",
  "var dd=",
  "var dd =",
  "ray id:",
  "\uACC4\uC18D\uD558\uB824\uBA74 \uC544\uB798 \uACFC\uC81C",
  "\uC544\uB798 \uACFC\uC81C \uD574\uACB0",
  "\uACFC\uC81C \uD574\uACB0",
  "\uC11C\uBE44\uC2A4 \uC774\uC6A9\uC774 \uC81C\uD55C",
  "\uACFC\uB3C4\uD55C \uC811\uADFC \uC694\uCCAD"
];

function searchRecipeCandidates(platform: SourceNavigationPlan["platform"]): SourceNavigationRecipeActionCandidate[] {
  const isNaver = platform === "naver_search";
  const isGoogle = platform === "google_search";
  const isDaum = platform === "daum_search";
  const isBing = platform === "bing";
  const isYahoo = platform === "yahoo_search";
  const isYahooJapan = platform === "yahoo_japan_search";
  const fixtureVerified = isNaver || isGoogle || isDaum || isBing || isYahoo || isYahooJapan;
  const searchBlockedSignals = ["Our systems have detected unusual traffic", "unusual traffic from your computer network", "not a robot", "automated queries", "captcha", "CAPTCHA", ...SECURITY_CHALLENGE_SIGNALS];
  const googleResultScopes = [
    fixture("#result-card"),
    fixture("#map-pack"),
    fixture("#news-cluster"),
    fixture("#ad-module"),
    fixture("#google-rich-main", "Fixture Google rich search module shell."),
    fixture("#google-local-module", "Fixture Google local/map module."),
    fixture("#google-news-module", "Fixture Google news module."),
    fixture("#google-image-module", "Fixture Google image module."),
    fixture("#google-video-module", "Fixture Google video module."),
    fixture("#google-travel-module", "Fixture Google travel/hotel module."),
    fixture("#google-hotel-offer-card", "Fixture Google hotel offer card with visible price/rate state."),
    fixture("#google-destination-links", "Fixture Google mixed destination link set."),
    real("#rso", "Google organic result area; captures result cards without the entire SERP shell."),
    real("#rso a[href]:has(h3)", "Google organic result heading link; useful for first-result snippet evidence."),
    real("#search a[href]:has(h3)", "Google visible result heading link; excludes hash-only utility links."),
    real("#tads", "Google top ad block; cite separately from organic results when visible."),
    real("#bottomads", "Google bottom ad block; cite separately from organic results when visible."),
    real("#rhs", "Google right-side knowledge/local panel when present."),
    real("#Odp5De", "Google local places pack container when present."),
    real("#Odp5De .VkpGBb", "Google local place cards inside the places pack when present."),
    real("#Odp5De .rllt__details", "Google local place detail text inside the places pack when present."),
    real('#Odp5De [aria-label*="Places"]', "Google local places heading inside the places pack when present."),
    real('#Odp5De [data-test-id="moc"]', "Google embedded local map canvas container when present."),
    real('#Odp5De img[src*="googleusercontent.com"]', "Google local place thumbnail images when present."),
    real("#lu_map", "Google legacy local map panel when present."),
    real('#search a[href*="/maps/place"]', "Google local-pack place links when visible on a search result page."),
    real('#search a[href*="google.com/maps"]', "Google local/maps result links when visible on a search result page."),
    real('#search [aria-label*="Places"]', "Google local places module when exposed with an accessible label."),
    real('#search [aria-label*="Map"]', "Google map/local module when exposed with an accessible label."),
    real("#search g-section-with-header", "Google vertical module such as news, videos, or related result clusters."),
    real('#search a[href*="/travel/hotels"]', "Google Travel hotel links when visible inside Search."),
    real('#search a[href*="/travel/search"]', "Google Travel search/offer links when visible inside Search."),
    real('#search div:has(a[href*="/travel/hotels"])', "Google travel/hotel result module with hotel destination links."),
    real('#search div:has(a[href*="/travel/search"])', "Google travel/search result module with price or offer links."),
    real('#search g-section-with-header:has(a[href*="news.google.com"])', "Google news module when visible inside Search."),
    real('#search a[href*="news.google.com"]', "Google News destination links when visible inside Search."),
    real('#search [aria-label*="News"]', "Google news module with English accessible label."),
    real('#search [aria-label*="\uB274\uC2A4"]', "Google news module with Korean accessible label."),
    real('#search [aria-label*="\u30CB\u30E5\u30FC\u30B9"]', "Google news module with Japanese accessible label."),
    real('#search div:has(a[href*="news.google.com"])', "Google news-like result container with News links."),
    real('#search g-section-with-header:has(a[href*="youtube.com"])', "Google video module with YouTube results when visible inside Search."),
    real('#search a[href*="youtube.com/watch"]', "Google video result links when visible inside Search."),
    real('#search a[href*="youtube.com/shorts"]', "Google Shorts result links when visible inside Search."),
    real('#search a[href*="youtu.be/"]', "Google shortened YouTube result links when visible inside Search."),
    real('#search a[href*="vimeo.com"]', "Google Vimeo video result links when visible inside Search."),
    real('#search [aria-label*="Videos"]', "Google video module with English accessible label."),
    real('#search [aria-label*="\uB3D9\uC601\uC0C1"]', "Google video module with Korean accessible label."),
    real('#search [aria-label*="\u52D5\u753B"]', "Google video module with Japanese accessible label."),
    real('#search div:has(a[href*="youtube.com/watch"])', "Google video-like result container with YouTube watch links."),
    real("#search g-img", "Google image/thumbnail module when visible inside Search."),
    real("#search img", "Google image or video thumbnails when visible inside Search."),
    real("#search a[href]:has(img)", "Google image or thumbnail anchor candidates when visible."),
    real('#search a[href*="/imgres"]', "Google image-result links when visible inside Search."),
    real('#search [aria-label*="Images"]', "Google image module with English accessible label."),
    real('#search [aria-label*="\uC774\uBBF8\uC9C0"]', "Google image module with Korean accessible label."),
    real('#search [aria-label*="\u753B\u50CF"]', "Google image module with Japanese accessible label."),
    real("#search div:has(g-img)", "Google image-like result container with image thumbnails."),
    real("#search div[data-attrid]", "Google knowledge/local attribute rows when present."),
    real("#search", "Fallback Google search result container when narrower modules are unavailable.")
  ];
  const googleVerticalSelectors = [
    fixture("#tab-images"),
    fixture("#google-tab-news", "Fixture Google News vertical tab."),
    fixture("#google-tab-images", "Fixture Google Images vertical tab."),
    fixture("#google-tab-videos", "Fixture Google Videos vertical tab."),
    fixture("#google-tab-maps", "Fixture Google Maps/local vertical tab."),
    real('a[href*="tbm=isch"]'),
    real('a[href*="tbm=nws"]'),
    real('a[href*="tbm=vid"]'),
    real('a[href*="udm=2"]'),
    real('a[href*="udm=7"]'),
    real('a:has-text("Images")'),
    real('a:has-text("News")'),
    real('a:has-text("Videos")'),
    real('a:has-text("\uC774\uBBF8\uC9C0")'),
    real('a:has-text("\uB274\uC2A4")'),
    real('a:has-text("\uB3D9\uC601\uC0C1")'),
    real('a:has-text("\u753B\u50CF")'),
    real('a:has-text("\u30CB\u30E5\u30FC\u30B9")'),
    real('a:has-text("\u52D5\u753B")')
  ];
  const googleDestinationSelectors = [
    fixture("#result-card"),
    fixture("#result-link"),
    fixture("#google-destination-links", "Fixture Google mixed destination link container."),
    fixture("#google-organic-link", "Fixture Google organic result destination link."),
    fixture("#google-news-link", "Fixture Google News destination link."),
    fixture("#google-local-link", "Fixture Google local/maps destination link."),
    fixture("#google-image-link", "Fixture Google image destination link."),
    fixture("#google-video-link", "Fixture Google video destination link."),
    fixture("#google-travel-link", "Fixture Google Travel hotel destination link."),
    fixture("#google-travel-module", "Fixture Google travel/hotel module with SPA destination attributes."),
    fixture("#google-hotel-offer-card", "Fixture Google hotel offer card with SPA destination attributes."),
    fixture("#google-video-module", "Fixture Google video module with SPA destination attributes."),
    fixture("#google-image-module", "Fixture Google image module with SPA destination attributes."),
    real("#rso"),
    real("#search"),
    real("#rso [data-url]", "Google organic result cards with SPA-style destination URL attributes."),
    real("#rso [data-href]", "Google organic result cards with SPA-style href attributes."),
    real("#search [data-url]", "Google visible result modules with SPA-style URL attributes."),
    real("#search [data-href]", "Google visible result modules with SPA-style href attributes."),
    real("#search [data-target-url]", "Google visible result modules with explicit target URL attributes."),
    real("#search [data-travel-url]", "Google visible travel modules with travel destination URL attributes."),
    real("#search [data-hotel-url]", "Google visible hotel modules with hotel destination URL attributes."),
    real("#search [data-offer-url]", "Google visible hotel offer modules with offer destination URL attributes."),
    real("#rso a[href]:has(h3)"),
    real("#search a[href]:has(h3)"),
    real("#search a[data-ved][href]:has(h3)"),
    real("#search a[data-ved][href]"),
    real('#search a[href*="news.google.com"]'),
    real('#search a[href*="youtube.com/watch"]'),
    real('#search a[href*="youtube.com/shorts"]'),
    real('#search a[href*="youtu.be/"]'),
    real('#search a[href*="vimeo.com"]'),
    real("#search a[href]:has(img)"),
    real('#search a[href*="/imgres"]'),
    real('#search a[href*="/travel/hotels"]'),
    real('#search a[href*="/travel/search"]')
  ];
  const naverResultScopes = [
    fixture("#result-card"),
    fixture("#map-pack"),
    fixture("#news-cluster"),
    fixture("#naver-integrated-main", "Fixture Naver integrated search main result shell."),
    fixture("#naver-view-module", "Fixture Naver View/Blog/Cafe result module."),
    fixture("#naver-news-module", "Fixture Naver News result module."),
    fixture("#naver-place-module", "Fixture Naver Place/local result module."),
    fixture("#naver-image-module", "Fixture Naver Image result module."),
    fixture("#naver-video-module", "Fixture Naver Video result module."),
    fixture("#naver-shopping-module", "Fixture Naver Shopping result module."),
    fixture("#naver-integrated-destination-links", "Fixture Naver mixed vertical destination link set."),
    real("#main_pack", "Naver integrated search result container."),
    real("#main_pack .api_subject_bx", "Naver vertical result module container such as blog, cafe, news, or shopping."),
    real("#main_pack .total_wrap", "Naver organic result card wrapper."),
    real("#main_pack .view_wrap", "Naver Blog/Cafe style result wrapper."),
    real("#main_pack .news_wrap", "Naver news result wrapper."),
    real("#main_pack .place_section", "Naver place/local module wrapper."),
    real("#main_pack .video_wrap", "Naver video result module wrapper when visible."),
    real("#main_pack .image_wrap", "Naver image result module wrapper when visible."),
    real("#main_pack .shopping_wrap", "Naver shopping result module wrapper when visible."),
    real("#main_pack .sp_nshop", "Naver shopping/product module wrapper when visible."),
    real("#main_pack .sc_new", "Naver integrated search section wrapper."),
    real("#main_pack a.news_tit", "Naver news title destination links."),
    real("#main_pack a.api_txt_lines", "Naver visible title/snippet destination links."),
    real('#main_pack a[href*="n.news.naver.com"]', "Naver mobile/news article destination links inside integrated search."),
    real('#main_pack a[href*="news.naver.com"]', "Naver News destination links inside integrated search."),
    real('#main_pack a[href*="blog.naver.com"]', "Naver Blog destination links inside integrated search."),
    real('#main_pack a[href*="cafe.naver.com"]', "Naver Cafe destination links inside integrated search."),
    real('#main_pack a[href*="place.naver.com"]', "Naver Place destination links inside integrated search."),
    real('#main_pack a[href*="map.naver.com"]', "Naver Map/place destination links inside integrated search."),
    real('#main_pack a[href*="shopping.naver.com"]', "Naver Shopping destination links inside integrated search."),
    real('#main_pack a[href*="smartstore.naver.com"]', "Naver SmartStore destination links inside integrated search."),
    real('#main_pack a[href*="youtube.com/watch"]', "Naver video module YouTube destination links when visible."),
    real('#main_pack a[href*="youtu.be/"]', "Naver video module shortened YouTube destination links when visible."),
    real("#search", "Fallback Naver search container when narrower modules are unavailable.")
  ];
  const naverVerticalSelectors = [
    fixture("#tab-blog"),
    fixture("#naver-tab-view", "Fixture Naver View vertical tab."),
    fixture("#naver-tab-news", "Fixture Naver News vertical tab."),
    fixture("#naver-tab-image", "Fixture Naver Image vertical tab."),
    fixture("#naver-tab-video", "Fixture Naver Video vertical tab."),
    fixture("#naver-tab-place", "Fixture Naver Place vertical tab."),
    fixture("#naver-tab-shopping", "Fixture Naver Shopping vertical tab."),
    real('a[href*="where=blog"]', "Naver Blog vertical tab."),
    real('a[href*="where=cafe"]', "Naver Cafe vertical tab."),
    real('a[href*="where=news"]', "Naver News vertical tab."),
    real('a[href*="where=image"]', "Naver Image vertical tab."),
    real('a[href*="where=video"]', "Naver Video vertical tab."),
    real('a[href*="where=place"]', "Naver Place/Map vertical tab."),
    real('a[href*="where=shopping"]', "Naver Shopping vertical tab."),
    real('a[href*="where=view"]', "Naver View vertical tab containing blog/cafe style results."),
    real('a:has-text("\uBE14\uB85C\uADF8")', "Naver Blog vertical label."),
    real('a:has-text("\uCE74\uD398")', "Naver Cafe vertical label."),
    real('a:has-text("\uB274\uC2A4")', "Naver News vertical label."),
    real('a:has-text("\uC774\uBBF8\uC9C0")', "Naver Image vertical label."),
    real('a:has-text("\uB3D9\uC601\uC0C1")', "Naver Video vertical label."),
    real('a:has-text("\uC9C0\uB3C4")', "Naver Map vertical label."),
    real('a:has-text("\uC1FC\uD551")', "Naver Shopping vertical label.")
  ];
  const naverDestinationSelectors = [
    fixture("#result-card"),
    fixture("#result-link"),
    fixture("#naver-integrated-destination-links", "Fixture Naver mixed vertical destination link container."),
    fixture("#naver-view-link", "Fixture Naver View/Blog destination link."),
    fixture("#naver-cafe-link", "Fixture Naver Cafe destination link."),
    fixture("#naver-news-link", "Fixture Naver News destination link."),
    fixture("#naver-place-link", "Fixture Naver Place destination link."),
    fixture("#naver-image-link", "Fixture Naver Image destination link."),
    fixture("#naver-video-link", "Fixture Naver Video destination link."),
    fixture("#naver-shopping-link", "Fixture Naver Shopping destination link."),
    fixture("#naver-place-module", "Fixture Naver Place module with SPA destination attributes."),
    fixture("#naver-shopping-module", "Fixture Naver Shopping module with SPA destination attributes."),
    real("#main_pack"),
    real("#main_pack .total_wrap"),
    real("#main_pack .view_wrap"),
    real("#main_pack .news_wrap"),
    real("#main_pack .place_section"),
    real("#main_pack .video_wrap"),
    real("#main_pack .image_wrap"),
    real("#main_pack .shopping_wrap"),
    real("#main_pack .sp_nshop"),
    real("#main_pack [data-url]"),
    real("#main_pack [data-href]"),
    real("#main_pack [data-link-url]"),
    real("#main_pack [data-target-url]"),
    real('#main_pack [data-url*="blog.naver.com"]'),
    real('#main_pack [data-url*="cafe.naver.com"]'),
    real('#main_pack [data-url*="place.naver.com"]'),
    real('#main_pack [data-url*="map.naver.com"]'),
    real('#main_pack [data-url*="shopping.naver.com"]'),
    real('#main_pack [data-url*="smartstore.naver.com"]'),
    real("#main_pack a.news_tit"),
    real("#main_pack a.api_txt_lines"),
    real('#main_pack a[href*="n.news.naver.com"]'),
    real('#main_pack a[href*="news.naver.com"]'),
    real('#main_pack a[href*="blog.naver.com"]'),
    real('#main_pack a[href*="cafe.naver.com"]'),
    real('#main_pack a[href*="place.naver.com"]'),
    real('#main_pack a[href*="map.naver.com"]'),
    real('#main_pack a[href*="shopping.naver.com"]'),
    real('#main_pack a[href*="smartstore.naver.com"]'),
    real('#main_pack a[href*="youtube.com/watch"]'),
    real('#main_pack a[href*="youtu.be/"]'),
    real("#search"),
    real("#search a[href]")
  ];
  const daumResultScopes = [
    fixture("#daum-result-card"),
    real("#mArticle", "Daum/Kakao search main article/result container."),
    real("#cMain", "Daum/Kakao search main content container."),
    real("#daumContent", "Daum/Kakao search content shell."),
    real("#mArticle .wrap_cont", "Daum result content wrapper."),
    real("#mArticle .cont_inner", "Daum result inner content wrapper."),
    real("#mArticle .item-title", "Daum result title rows when visible."),
    real("#mArticle .tit_main", "Daum result title text when visible."),
    real("#mArticle .c-list-basic", "Daum list-style result cards."),
    real("#mArticle .news_item", "Daum news result item wrapper."),
    real("#mArticle .wrap_thumb", "Daum image/video thumbnail result wrapper."),
    real("#mArticle a[href*='v.daum.net']", "Daum News article destination links."),
    real("#mArticle a[href*='news.daum.net']", "Daum News destination links."),
    real("#mArticle a[href*='blog.daum.net']", "Daum Blog destination links."),
    real("#mArticle a[href*='tistory.com']", "Tistory blog destination links surfaced by Daum."),
    real("#mArticle a[href*='cafe.daum.net']", "Daum Cafe destination links."),
    real("#mArticle a[href*='place.map.kakao.com']", "KakaoMap place destination links surfaced by Daum."),
    real("#mArticle a[href*='map.kakao.com']", "KakaoMap destination links surfaced by Daum."),
    real("#mArticle a[href*='shoppinghow.kakao.com']", "Kakao Shopping destination links surfaced by Daum."),
    real("#mArticle a[href*='youtube.com/watch']", "Daum video module YouTube destination links when visible.")
  ];
  const daumVerticalSelectors = [
    fixture("#daum-tab-cafe"),
    real(".list_tab a", "Daum visible search vertical tab list."),
    real("#daumGnb a", "Daum global/search navigation links."),
    real('a[href*="w=news"]', "Daum News vertical tab."),
    real('a[href*="w=blog"]', "Daum Blog vertical tab."),
    real('a[href*="w=cafe"]', "Daum Cafe vertical tab."),
    real('a[href*="w=img"]', "Daum Image vertical tab."),
    real('a[href*="w=vclip"]', "Daum Video vertical tab."),
    real('a[href*="w=place"]', "Daum/Kakao place vertical tab."),
    real('a[href*="w=shopping"]', "Daum Shopping vertical tab."),
    real('a:has-text("\uB274\uC2A4")', "Daum News vertical label."),
    real('a:has-text("\uBE14\uB85C\uADF8")', "Daum Blog vertical label."),
    real('a:has-text("\uCE74\uD398")', "Daum Cafe vertical label."),
    real('a:has-text("\uC774\uBBF8\uC9C0")', "Daum Image vertical label."),
    real('a:has-text("\uB3D9\uC601\uC0C1")', "Daum Video vertical label."),
    real('a:has-text("\uC9C0\uB3C4")', "Daum Map vertical label."),
    real('a:has-text("\uC1FC\uD551")', "Daum Shopping vertical label.")
  ];
  const daumDestinationSelectors = [
    fixture("#daum-result-card"),
    fixture("#daum-result-link"),
    real("#mArticle"),
    real("#cMain"),
    real("#daumContent"),
    real("#mArticle .wrap_cont"),
    real("#mArticle .cont_inner"),
    real("#mArticle .item-title"),
    real("#mArticle .tit_main"),
    real("#mArticle .c-list-basic"),
    real("#mArticle .news_item"),
    real("#mArticle .wrap_thumb"),
    real("#mArticle a[href]"),
    real("#cMain a[href]"),
    real("#daumContent a[href]"),
    real("#mArticle [data-url]"),
    real("#mArticle [data-href]"),
    real("#mArticle [data-target-url]"),
    real("#mArticle a[href*='v.daum.net']"),
    real("#mArticle a[href*='news.daum.net']"),
    real("#mArticle a[href*='blog.daum.net']"),
    real("#mArticle a[href*='tistory.com']"),
    real("#mArticle a[href*='cafe.daum.net']"),
    real("#mArticle a[href*='place.map.kakao.com']"),
    real("#mArticle a[href*='map.kakao.com']"),
    real("#mArticle a[href*='shoppinghow.kakao.com']"),
    real("#mArticle a[href*='youtube.com/watch']"),
    real("#mArticle a[href*='youtu.be/']")
  ];
  const bingResultScopes = [
    fixture("#bing-results"),
    fixture("#bing-result-card"),
    fixture("#bing-context"),
    real("#b_results", "Bing primary result list container."),
    real("#b_results .b_algo", "Bing organic result cards."),
    real("#b_results h2 a[href]", "Bing result title destination links."),
    real("#b_results .b_caption", "Bing result snippet/caption text."),
    real("#b_context", "Bing right-side entity/context panel when visible."),
    real("#b_tween", "Bing result filter and count row."),
    real("#b_results .b_ad", "Bing ad result cards; cite separately from organic results."),
    real('#b_results a[href*="/news/search"]', "Bing news vertical or news-result links."),
    real('#b_results a[href*="/videos/search"]', "Bing video vertical or video-result links."),
    real('#b_results a[href*="/images/search"]', "Bing image vertical or image-result links.")
  ];
  const bingVerticalSelectors = [
    fixture("#bing-tab-images"),
    fixture("#bing-tab-news"),
    fixture("#bing-tab-videos"),
    real('a[href*="/images/search"]', "Bing Images vertical tab."),
    real('a[href*="/videos/search"]', "Bing Videos vertical tab."),
    real('a[href*="/news/search"]', "Bing News vertical tab."),
    real('a[href*="/maps"]', "Bing Maps/local vertical tab when present."),
    real('a:has-text("Images")', "Bing Images vertical label."),
    real('a:has-text("News")', "Bing News vertical label."),
    real('a:has-text("Videos")', "Bing Videos vertical label."),
    real('a:has-text("\uC774\uBBF8\uC9C0")', "Bing Korean Images vertical label."),
    real('a:has-text("\uB274\uC2A4")', "Bing Korean News vertical label."),
    real('a:has-text("\uB3D9\uC601\uC0C1")', "Bing Korean Videos vertical label."),
    real('a:has-text("\u753B\u50CF")', "Bing Japanese Images vertical label."),
    real('a:has-text("\u30CB\u30E5\u30FC\u30B9")', "Bing Japanese News vertical label."),
    real('a:has-text("\u52D5\u753B")', "Bing Japanese Videos vertical label.")
  ];
  const bingDestinationSelectors = [
    fixture("#bing-destination-links"),
    fixture("#bing-result-link"),
    real("#b_results", "Bing result container for destination extraction."),
    real("#b_results .b_algo", "Bing organic result cards for bounded extraction."),
    real("#b_results h2 a[href]", "Bing result title links."),
    real("#b_results a[href]", "Bing visible result links."),
    real("#b_results [data-url]", "Bing result cards exposing URL attributes."),
    real("#b_results [data-href]", "Bing result cards exposing href-like attributes."),
    real("#b_context a[href]", "Bing right-side context panel links."),
    real('#b_results a[href*="/news/search"]', "Bing news-result links."),
    real('#b_results a[href*="/videos/search"]', "Bing video-result links."),
    real('#b_results a[href*="/images/search"]', "Bing image-result links.")
  ];
  const yahooResultScopes = [
    fixture("#yahoo-results"),
    fixture("#yahoo-result-card"),
    fixture("#yahoo-context"),
    real("#web", "Yahoo Search web-result container."),
    real("#results", "Yahoo Search result shell."),
    real("#main", "Yahoo Search main content region."),
    real("ol.searchCenterMiddle", "Yahoo Search ordered result list."),
    real(".dd.algo", "Yahoo Search organic result cards."),
    real(".compTitle a[href]", "Yahoo Search result title links."),
    real(".compText", "Yahoo Search snippet text."),
    real("#right", "Yahoo Search right-side module when visible."),
    real('a[href*="news.yahoo.com"]', "Yahoo News destination links surfaced in search."),
    real('a[href*="images.search.yahoo.com/search/images"]', "Yahoo image vertical or image-result links."),
    real('a[href*="news.search.yahoo.com/search"]', "Yahoo news vertical result surface links."),
    real('a[href*="video.search.yahoo.com/search/video"]', "Yahoo video vertical or video-result links.")
  ];
  const yahooVerticalSelectors = [
    fixture("#yahoo-tab-images"),
    fixture("#yahoo-tab-news"),
    fixture("#yahoo-tab-videos"),
    real('a[href*="images.search.yahoo.com/search/images"]', "Yahoo Images vertical tab."),
    real('a[href*="news.search.yahoo.com/search"]', "Yahoo News vertical tab."),
    real('a[href*="video.search.yahoo.com/search/video"]', "Yahoo Video vertical tab."),
    real('a[href*="/search/images"]', "Yahoo Images vertical path fallback."),
    real('a[href*="/search/video"]', "Yahoo Video vertical path fallback."),
    real('a[href*="/search/local"]', "Yahoo Local vertical tab when present."),
    real('a:has-text("Images")', "Yahoo Images vertical label."),
    real('a:has-text("News")', "Yahoo News vertical label."),
    real('a:has-text("Videos")', "Yahoo Videos vertical label."),
    real('a:has-text("Local")', "Yahoo Local vertical label.")
  ];
  const yahooDestinationSelectors = [
    fixture("#yahoo-destination-links"),
    fixture("#yahoo-result-link"),
    real("#web", "Yahoo Search web-result container for destination extraction."),
    real("#results", "Yahoo Search result shell for destination extraction."),
    real("ol.searchCenterMiddle", "Yahoo ordered result list for destination extraction."),
    real(".dd.algo", "Yahoo organic result cards for bounded extraction."),
    real(".compTitle a[href]", "Yahoo result title links."),
    real("#web a[href]", "Yahoo visible result links."),
    real("#results a[href]", "Yahoo result-shell links."),
    real("#web [data-url]", "Yahoo result cards exposing URL attributes."),
    real("#web [data-href]", "Yahoo result cards exposing href-like attributes."),
    real('a[href*="news.yahoo.com"]', "Yahoo News destination links."),
    real('a[href*="r.search.yahoo.com"]', "Yahoo redirect links; keep as calibration evidence until triage verifies useful child evidence.")
  ];
  const yahooJapanResultScopes = [
    fixture("#yahoo-japan-contents"),
    fixture("#yahoo-japan-result-card"),
    fixture("#yahoo-japan-context"),
    real("#contents", "Yahoo Japan search contents container."),
    real("#web", "Yahoo Japan web-result container when present."),
    real("#results", "Yahoo Japan result shell when present."),
    real("#main", "Yahoo Japan main content region."),
    real("#WS2m", "Yahoo Japan web search result module observed on current layouts."),
    real(".sw-Card", "Yahoo Japan result cards."),
    real(".sw-CardBase", "Yahoo Japan card base wrappers."),
    real('a[href*="news.yahoo.co.jp"]', "Yahoo Japan News destination links surfaced in search."),
    real('a[href*="chiebukuro.yahoo.co.jp"]', "Yahoo Japan Chiebukuro/Q&A destination links."),
    real('a[href*="shopping.yahoo.co.jp"]', "Yahoo Japan Shopping destination links."),
    real('a[href*="map.yahoo.co.jp"]', "Yahoo Japan Map/local destination links.")
  ];
  const yahooJapanVerticalSelectors = [
    fixture("#yahoo-japan-tab-images"),
    fixture("#yahoo-japan-tab-news"),
    fixture("#yahoo-japan-tab-videos"),
    real('a[href*="/image/search"]', "Yahoo Japan Images vertical tab."),
    real('a[href*="/video/search"]', "Yahoo Japan Videos vertical tab."),
    real('a[href*="news.yahoo.co.jp/search"]', "Yahoo Japan News vertical tab."),
    real('a[href*="map.yahoo.co.jp"]', "Yahoo Japan Map/local vertical tab."),
    real('a[href*="shopping.yahoo.co.jp/search"]', "Yahoo Japan Shopping vertical tab."),
    real('a[href*="chiebukuro.yahoo.co.jp/search"]', "Yahoo Japan Chiebukuro/Q&A vertical tab."),
    real('a:has-text("\u753B\u50CF")', "Yahoo Japan Images vertical label."),
    real('a:has-text("\u30CB\u30E5\u30FC\u30B9")', "Yahoo Japan News vertical label."),
    real('a:has-text("\u52D5\u753B")', "Yahoo Japan Videos vertical label."),
    real('a:has-text("\u5730\u56F3")', "Yahoo Japan Map vertical label."),
    real('a:has-text("\u30B7\u30E7\u30C3\u30D4\u30F3\u30B0")', "Yahoo Japan Shopping vertical label."),
    real('a:has-text("\u77E5\u6075\u888B")', "Yahoo Japan Chiebukuro/Q&A vertical label.")
  ];
  const yahooJapanDestinationSelectors = [
    fixture("#yahoo-japan-destination-links"),
    fixture("#yahoo-japan-result-link"),
    real("#contents", "Yahoo Japan search contents container for destination extraction."),
    real("#web", "Yahoo Japan web-result container for destination extraction."),
    real("#results", "Yahoo Japan result shell for destination extraction."),
    real("#WS2m", "Yahoo Japan web search result module for destination extraction."),
    real(".sw-Card", "Yahoo Japan result cards for bounded extraction."),
    real(".sw-CardBase", "Yahoo Japan card base wrappers for bounded extraction."),
    real("#contents a[href]", "Yahoo Japan visible result links."),
    real("#web a[href]", "Yahoo Japan web-result links."),
    real("#contents [data-url]", "Yahoo Japan cards exposing URL attributes."),
    real("#contents [data-href]", "Yahoo Japan cards exposing href-like attributes."),
    real('a[href*="news.yahoo.co.jp"]', "Yahoo Japan News destination links."),
    real('a[href*="chiebukuro.yahoo.co.jp"]', "Yahoo Japan Chiebukuro/Q&A destination links."),
    real('a[href*="shopping.yahoo.co.jp"]', "Yahoo Japan Shopping destination links."),
    real('a[href*="map.yahoo.co.jp"]', "Yahoo Japan Map/local destination links.")
  ];
  const genericSearchResultScopes = [fixture("#result-card"), real("#search"), real("#main_pack")];
  return [
    candidate("query-state", "fill", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: isNaver
        ? [fixture("#q"), fixture("#naver-integrated-query"), real('input[name="query"]'), real('input[title*="\uAC80\uC0C9"]')]
        : isGoogle
          ? [fixture("#google-query"), real('textarea[name="q"]'), real('input[name="q"]')]
          : isDaum
            ? [fixture("#daum-query"), real('input[name="q"]'), real("#q")]
            : isBing
              ? [fixture("#bing-query"), real("#sb_form_q"), real('input[name="q"]'), real('textarea[name="q"]')]
              : isYahooJapan
                ? [fixture("#yahoo-japan-query"), real('input[name="p"]'), real('input[name="q"]'), real('input[type="search"]')]
                : isYahoo
                  ? [fixture("#yahoo-query"), real('input[name="p"]'), real('input[name="q"]'), real('input[type="search"]')]
                  : [real('input[type="search"]'), real('input[name="q"]')],
      expectedTextSignals: ["query", "\uAC80\uC0C9\uC5B4", "Search"],
      blockedSignals: searchBlockedSignals,
      riskNotes: ["Changing query text changes result membership; capture query state before citing ranking."]
    }),
    candidate("vertical-tab", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: isNaver ? naverVerticalSelectors : isGoogle ? googleVerticalSelectors : isDaum ? daumVerticalSelectors : isBing ? bingVerticalSelectors : isYahooJapan ? yahooJapanVerticalSelectors : isYahoo ? yahooVerticalSelectors : [real('[role="tab"]'), real("nav a")],
      scopes: isDaum ? [fixture("#daum-results"), ...daumResultScopes] : isGoogle ? googleResultScopes : isNaver ? naverResultScopes : isBing ? bingResultScopes : isYahooJapan ? yahooJapanResultScopes : isYahoo ? yahooResultScopes : genericSearchResultScopes,
      expectedTextSignals: ["blog", "cafe", "images", "news", "videos", "shopping", "map", "\uBE14\uB85C\uADF8", "\uCE74\uD398", "\uB274\uC2A4", "\uC774\uBBF8\uC9C0", "\uB3D9\uC601\uC0C1", "\uC9C0\uB3C4", "\uC1FC\uD551"],
      blockedSignals: searchBlockedSignals,
      riskNotes: ["Vertical tabs alter result scope; cite the active tab with the SERP."]
    }),
    candidate("visible-filters", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: isGoogle
        ? [fixture("#tools"), real('[aria-label="Search tools"]'), real('[aria-label="\uAC80\uC0C9 \uB3C4\uAD6C"]')]
        : isNaver
          ? [fixture("#recent-filter"), fixture("#naver-integrated-filter"), real('a[href*="date"]'), real("button")]
          : isDaum
            ? [fixture("#daum-filter"), real(".btn_filter"), real(".d_filter button")]
            : isBing
              ? [fixture("#bing-filter"), real("#b_tween a"), real("#b_tween button"), real('[aria-label*="Filter"]')]
              : isYahooJapan
                ? [fixture("#yahoo-japan-filter"), real("nav a"), real('[role="button"]'), real('a[href*="fr2="]')]
                : isYahoo
                  ? [fixture("#yahoo-filter"), real("nav a"), real('[role="button"]'), real('a[href*="fr2="]')]
                  : [real("button"), real('[role="button"]')],
      scopes: isDaum
        ? [fixture("#daum-filter-state"), real("#schSearchFilter"), real("#mArticle"), real("#cMain")]
        : isNaver
          ? [fixture("#naver-integrated-filter-state"), fixture("#filter-panel"), real("#snb"), real("#main_pack")]
          : isBing
            ? [fixture("#bing-filter-state"), fixture("#bing-results"), real("#b_tween"), real("#b_results")]
            : isYahooJapan
              ? [fixture("#yahoo-japan-filter-state"), fixture("#yahoo-japan-contents"), real("#contents"), real("#web"), real("#results")]
              : isYahoo
                ? [fixture("#yahoo-filter-state"), fixture("#yahoo-results"), real("#web"), real("#results"), real("#main")]
                : [fixture("#filter-panel"), real('[role="menu"]'), real("#snb"), real("#main_pack")],
      expectedTextSignals: ["filter", "date", "recent", "\uAE30\uAC04", "\uC815\uB82C"],
      blockedSignals: searchBlockedSignals,
      riskNotes: ["Filter labels are locale-sensitive and must be verified from visible text."]
    }),
    candidate("result-pagination", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: isDaum
        ? [fixture("#daum-next-page"), real('a[aria-label*="\uB2E4\uC74C"]'), real(".paging a"), real(".more_dynamic a")]
        : isNaver
          ? [fixture("#naver-integrated-more"), fixture("#more-results"), fixture("#next-page"), real('a[aria-label*="Next"]'), real('a[aria-label*="\uB2E4\uC74C"]')]
          : isBing
            ? [fixture("#bing-next-page"), real('a[title*="Next"]'), real('a[aria-label*="Next"]'), real(".sb_pagN")]
            : isYahooJapan
              ? [fixture("#yahoo-japan-next-page"), real('a[aria-label*="\u6B21"]'), real('a:has-text("\u6B21\u3078")'), real(".Pagenation a")]
              : isYahoo
                ? [fixture("#yahoo-next-page"), real('a[aria-label*="Next"]'), real("a.next"), real(".next a")]
                : [fixture("#more-results"), fixture("#next-page"), real('a[aria-label*="Next"]'), real('a[aria-label*="\uB2E4\uC74C"]')],
      scopes: isDaum
        ? [fixture("#daum-results"), real("#mArticle"), real("#cMain")]
        : isNaver
          ? [fixture("#naver-integrated-main"), fixture("#main_pack"), real("#main_pack"), real("#search")]
          : isBing
            ? [fixture("#bing-results"), real("#b_results")]
            : isYahooJapan
              ? [fixture("#yahoo-japan-contents"), real("#contents"), real("#web"), real("#results")]
              : isYahoo
                ? [fixture("#yahoo-results"), real("#web"), real("#results")]
                : [fixture("#results"), real("#search"), real("#main_pack")],
      expectedTextSignals: ["page", "more results", "\uB2E4\uC74C", "\uB354\uBCF4\uAE30"],
      blockedSignals: searchBlockedSignals,
      riskNotes: ["Pagination must stay bounded; do not crawl unbounded result pages."]
    }),
    candidate("result-selection", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: isDaum
        ? [fixture("#daum-result-card"), real("#mArticle a"), real("#cMain a")]
        : isGoogle
          ? [fixture("#result-card"), real("#rso a[href]:has(h3)"), real("#search a[href]:has(h3)"), real("#search a[data-ved][href]"), real("#search a")]
          : isNaver
            ? [fixture("#result-card"), fixture("#naver-integrated-main"), fixture("#naver-view-module"), fixture("#naver-news-module"), fixture("#naver-place-module"), fixture("#naver-shopping-module"), real("#main_pack a"), real("#main_pack [data-url]")]
            : isBing
              ? [fixture("#bing-result-card"), fixture("#bing-result-link"), real("#b_results h2 a[href]"), real("#b_results a[href]")]
              : isYahooJapan
                ? [fixture("#yahoo-japan-result-card"), fixture("#yahoo-japan-result-link"), real("#contents a[href]"), real("#web a[href]")]
                : isYahoo
                  ? [fixture("#yahoo-result-card"), fixture("#yahoo-result-link"), real(".compTitle a[href]"), real("#web a[href]")]
                  : [fixture("#result-card"), real("#search a"), real("#main_pack a")],
      scopes: isDaum ? daumResultScopes : isGoogle ? googleResultScopes : isNaver ? naverResultScopes : isBing ? bingResultScopes : isYahooJapan ? yahooJapanResultScopes : isYahoo ? yahooResultScopes : genericSearchResultScopes,
      expectedTextSignals: ["snippet", "result", "\uAD11\uACE0", "Sponsored", "Maps", "News", "Videos", "Images"],
      blockedSignals: searchBlockedSignals,
      riskNotes: ["Search snippets prove only portal display; destination claims require follow-up evidence."]
    }),
    candidate("destination-followup", "extract_destinations", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: isDaum
        ? daumDestinationSelectors
        : isGoogle
          ? googleDestinationSelectors
          : isNaver
            ? naverDestinationSelectors
            : isBing
              ? bingDestinationSelectors
              : isYahooJapan
                ? yahooJapanDestinationSelectors
                : isYahoo
                  ? yahooDestinationSelectors
                  : [fixture("#result-card"), fixture("#result-link"), real("#main_pack"), real("#search"), real("#search a[href]"), real("#main_pack a[href]")],
      expectedTextSignals: ["http", "https"],
      blockedSignals: searchBlockedSignals,
      riskNotes: ["Extract visible destination links without navigating the parent page.", "Destination triage must select bounded useful child runs before following links."]
    })
  ];
}

function mapRecipeCandidates(platform: SourceNavigationPlan["platform"]): SourceNavigationRecipeActionCandidate[] {
  const fixtureVerified = platform === "naver_map" || platform === "kakao_map" || platform === "google_maps" || platform === "apple_maps";
  const querySelectors = [
    fixture("#map-query"),
    fixture("#kakao-query"),
    fixture("#google-map-query"),
    fixture("#apple-map-query"),
    ...(platform === "kakao_map" ? [real("#search\\.keyword\\.query"), real('input[name="q"]')] : []),
    ...(platform === "google_maps" ? [real("#searchboxinput"), real('input[aria-label*="Search"]'), real('input[aria-label*="검색"]')] : []),
    ...(platform === "naver_map" ? [real("#root"), real('input[aria-label*="검색"]')] : []),
    ...(platform === "apple_maps" ? [real('input[aria-label*="Search Maps"]', "Apple Maps search input by accessible label."), real('input[placeholder*="Search Maps"]', "Apple Maps search input by placeholder."), real('input[id*="search"]', "Apple Maps search input fallback by id.")] : []),
    real('input[aria-label*="Search"]'),
    real('input[aria-label*="검색"]')
  ];
  const mapViewportScopes = [
    fixture("#map-viewport"),
    fixture("#kakao-map-viewport"),
    fixture("#google-map-viewport"),
    fixture("#apple-map-viewport"),
    ...(platform === "naver_map" ? [real("#root")] : []),
    ...(platform === "kakao_map" ? [real("#view\\.mapContainer"), real("#view\\.map"), real("#view")] : []),
    ...(platform === "google_maps" ? [real(".lbMcOd"), real(".UL7Qtf")] : []),
    ...(platform === "apple_maps" ? [real("#maps-app", "Apple Maps app shell."), real('[class*="maps"]', "Apple Maps map shell class fallback."), real('[data-testid*="map"]', "Apple Maps map viewport/test-id fallback."), real('[aria-label*="Map"]', "Apple Maps map viewport accessible label.")] : []),
    real('[aria-label*="Map"]'),
    real('[aria-label*="지도"]'),
    real('[role="main"]')
  ];
  const selectedPlaceScopes = [
    fixture("#place-panel"),
    fixture("#place-detail"),
    fixture("#google-place-sheet"),
    fixture("#apple-place-card"),
    fixture("#review-list"),
    fixture("#google-review-list"),
    fixture("#google-photo-strip"),
    fixture("#apple-review-list"),
    ...(platform === "kakao_map" ? [real("#info\\.search"), real("#info\\.search\\.place"), real("#info\\.search\\.place\\.list")] : []),
    ...(platform === "naver_map" ? [real("#root")] : []),
    ...(platform === "google_maps" ? [real(".m6QErb"), real(".Nv2PK"), real(".hfpxzc"), real(".lbMcOd")] : []),
    ...(platform === "apple_maps"
      ? [
          real('[data-testid*="place-card"]', "Apple Maps selected place card/test-id fallback."),
          real('[class*="place-card"]', "Apple Maps selected place card class fallback."),
          real('[aria-label*="place"]', "Apple Maps selected place accessible label fallback."),
          real('[aria-label*="rating"]', "Apple Maps rating/review accessible label fallback.")
        ]
      : []),
    real('[role="main"]')
  ];
  const destinationSelectors = [
    fixture("#map-destination-links", "Fixture place panel links for website, menu, review, and related place detail destinations."),
    fixture("#place-website-link", "Fixture selected-place website destination."),
    fixture("#place-menu-link", "Fixture selected-place menu destination."),
    fixture("#place-review-link", "Fixture selected-place review destination."),
    fixture("#google-place-website-link", "Fixture Google Maps selected-place website destination."),
    fixture("#google-place-menu-link", "Fixture Google Maps selected-place menu destination."),
    fixture("#google-place-review-link", "Fixture Google Maps selected-place review destination."),
    fixture("#apple-place-website-link", "Fixture Apple Maps selected-place website destination."),
    fixture("#apple-place-menu-link", "Fixture Apple Maps selected-place menu destination."),
    fixture("#apple-place-review-link", "Fixture Apple Maps selected-place review destination."),
    ...(platform === "naver_map"
      ? [
          real('#root [data-place-url*="place.naver.com/restaurant"]', "Naver Map SPA restaurant cards with explicit Naver Place destination attributes."),
          real('#root [data-place-url*="place.naver.com/hospital"]', "Naver Map SPA hospital cards with explicit Naver Place destination attributes."),
          real('#root [data-place-url*="place.naver.com/place"]', "Naver Map SPA generic place cards with explicit Naver Place destination attributes."),
          real('#root [data-place-url*="place.naver.com/accommodation"]', "Naver Map SPA accommodation cards with explicit Naver Place destination attributes."),
          real('#root [data-url*="place.naver.com/restaurant"]', "Naver Map SPA cards with restaurant Naver Place URL attributes."),
          real('#root [data-url*="place.naver.com/hospital"]', "Naver Map SPA cards with hospital Naver Place URL attributes."),
          real('#root [data-url*="place.naver.com/place"]', "Naver Map SPA cards with generic Naver Place URL attributes."),
          real('#root [data-url*="place.naver.com/accommodation"]', "Naver Map SPA cards with accommodation Naver Place URL attributes."),
          real('#root a[href*="place.naver.com/restaurant"]', "Naver Place restaurant detail links visible in the map shell."),
          real('#root a[href*="place.naver.com/hospital"]', "Naver Place hospital detail links visible in the map shell."),
          real('#root a[href*="place.naver.com/place"]', "Naver Place generic detail links visible in the map shell."),
          real('#root a[href*="place.naver.com/accommodation"]', "Naver Place accommodation detail links visible in the map shell."),
          real('#root [data-place-url*="place.naver.com"]', "Naver Map SPA place cards with explicit Naver Place URL attributes."),
          real('#root [data-url*="place.naver.com"]', "Naver Map SPA cards with Naver Place URL attributes."),
          real('#root [data-url*="map.naver.com/p/entry/place"]', "Naver Map SPA cards with entry-place URL attributes."),
          real('#root [data-url*="map.naver.com/v5/entry/place"]', "Naver Map SPA cards with legacy entry-place URL attributes."),
          real('#root [data-target-url*="booking.naver.com"]', "Naver Map SPA cards with Naver Booking target URL attributes."),
          real('#root [data-source-url*="smartplace.naver.com"]', "Naver Map SPA cards with SmartPlace source URL attributes."),
          real('#root a[href*="place.naver.com"]', "Naver Place detail or place-home destination links visible in the map shell."),
          real('#root a[href*="map.naver.com/p/entry/place"]', "Naver Map entry-place links visible in result or selected-place surfaces."),
          real('#root a[href*="map.naver.com/v5/entry/place"]', "Legacy Naver Map entry-place links visible in result or selected-place surfaces."),
          real('#root a[href*="map.naver.com"]', "Naver Map place/detail links visible in list or panel surfaces."),
          real('#root a[href*="booking.naver.com"]', "Naver Booking links are extracted as evidence candidates only; booking actions remain unsupported."),
          real('#root a[href*="smartplace.naver.com"]', "Naver SmartPlace business-profile links visible from place panels."),
          real('#root a[href^="http"]', "Fallback Naver Map HTTP(S) links after narrower place/website/menu/review selectors fail.")
        ]
      : []),
    ...(platform === "kakao_map"
      ? [
          real('#info\\.search\\.place\\.list [data-url*="place.map.kakao.com"]', "KakaoMap SPA place-list cards with place URL attributes."),
          real('#info\\.search\\.place [data-url*="place.map.kakao.com"]', "KakaoMap selected-place cards with place URL attributes."),
          real('#view [data-url*="place.map.kakao.com"]', "KakaoMap view cards with place URL attributes."),
          real("#info\\.search\\.place\\.list a[href]", "KakaoMap visible place-list links."),
          real("#info\\.search\\.place a[href]", "KakaoMap selected place links."),
          real("#info\\.search a[href]", "KakaoMap search panel links before falling back to the full view."),
          real("#view a[href]", "KakaoMap visible page-shell HTTP(S) links."),
          real('a[href*="place.map.kakao.com"]', "Kakao place detail links.")
        ]
      : []),
    ...(platform === "google_maps"
      ? [
          real('[role="main"] [data-url*="/maps/place"]', "Google Maps SPA place cards with place URL attributes."),
          real('[role="main"] [data-href*="/maps/place"]', "Google Maps SPA place cards with href-like place attributes."),
          real('[role="main"] [data-place-url]', "Google Maps selected-place cards with explicit place URL attributes."),
          real('[role="main"] [data-target-url]', "Google Maps selected-place buttons with target URL attributes."),
          real('a[href*="google.com/maps/place"]', "Google Maps place detail links."),
          real('a[href*="/maps/place"]', "Google Maps relative place links."),
          real('a[data-item-id*="authority"]', "Google Maps website authority links from selected-place panels."),
          real('a[href^="http"][aria-label*="Website"]', "Google Maps selected-place website links by accessible label."),
          real('a[href^="http"][aria-label*="Menu"]', "Google Maps selected-place menu links by accessible label."),
          real('a[href^="http"][aria-label*="Reviews"]', "Google Maps selected-place review links by accessible label."),
          real('[role="main"] a[href^="http"]', "Fallback Google Maps visible HTTP(S) links scoped to the main map/place surface.")
        ]
      : []),
    ...(platform === "apple_maps"
      ? [
          real('[data-place-url*="maps.apple.com"]', "Apple Maps SPA place cards with explicit Apple Maps destination attributes."),
          real('[data-url*="maps.apple.com"]', "Apple Maps SPA place cards with URL attributes."),
          real('[data-target-url*="maps.apple.com"]', "Apple Maps selected-place controls with target URL attributes."),
          real('a[href*="maps.apple.com/place"]', "Apple Maps place detail links."),
          real('a[href*="maps.apple.com/?address"]', "Apple Maps address/place links."),
          real('a[href^="http"][aria-label*="Website"]', "Apple Maps selected-place website links by accessible label."),
          real('a[href^="http"][aria-label*="Menu"]', "Apple Maps selected-place menu links by accessible label."),
          real('a[href^="http"][aria-label*="Reviews"]', "Apple Maps selected-place review links by accessible label."),
          real('[role="main"] a[href^="http"]', "Fallback Apple Maps visible HTTP(S) links scoped to the main map/place surface.")
        ]
      : [])
  ];
  return [
    candidate("query-state", "fill", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: querySelectors,
      expectedTextSignals: ["query", "\uAC80\uC0C9", "Search"],
      riskNotes: ["Map results are viewport- and locale-sensitive; record viewport and query together."]
    }),
    candidate("map-filters", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#category-filter"), fixture("#google-filter-open-now"), fixture("#apple-filter-open-now"), real("button"), real('[role="button"]')],
      scopes: [fixture("#place-list"), fixture("#google-place-list"), fixture("#apple-place-list"), real('[role="feed"]'), real('[aria-label*="Results"]')],
      expectedTextSignals: ["category", "filter", "\uCE74\uD398", "\uC74C\uC2DD\uC810"],
      riskNotes: ["Filter buttons can include mutating reservation or route actions; calibrate text before clicking."]
    }),
    candidate("map-viewport", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [...mapViewportScopes, real("#scene")],
      scopes: mapViewportScopes,
      expectedTextSignals: ["pin", "\uC9C0\uB3C4", "Map"],
      riskNotes: ["Viewport screenshots are primary evidence; OCR may be needed for canvas-rendered labels."]
    }),
    candidate("selected-place", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#place-alpha"), fixture("#place-gamma"), fixture("#google-place-row"), fixture("#apple-place-row"), real('[role="article"]'), real('a[href*="place"]')],
      scopes: selectedPlaceScopes,
      expectedTextSignals: ["address", "hours", "review", "\uC8FC\uC18C", "\uB9AC\uBDF0"],
      riskNotes: ["Place selection must not click route, call, reservation, or booking controls."]
    }),
    candidate("map-ocr", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#map-viewport"), fixture("#kakao-map-viewport"), fixture("#google-map-label"), fixture("#google-map-viewport"), fixture("#apple-map-label"), fixture("#apple-map-viewport"), ...mapViewportScopes],
      scopes: [fixture("#google-map-label"), fixture("#apple-map-label"), ...mapViewportScopes],
      expectedTextSignals: ["pin", "label", "\uC9C0\uB3C4"],
      riskNotes: ["OCR is derivative evidence and must cite the screenshot artifact."]
    }),
    candidate("destination-followup", "extract_destinations", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: destinationSelectors,
      expectedTextSignals: ["http", "https", "website", "menu", "review", "place", "\uBA54\uB274", "\uB9AC\uBDF0", "\uC7A5\uC18C"],
      riskNotes: [
        "Map destination extraction reads visible place, website, menu, and review links without clicking the parent map page.",
        "Route, call, reservation, booking, login, and account-changing controls remain unsupported; extracted links still pass through bounded destination triage before child evidence runs."
      ]
    }),
    ...(platform === "naver_map"
      ? [
          candidate("destination-followup", "extract_client_state_destinations", "fixture_verified", {
            selectors: [
              fixture("#root", "Fixture Naver Map shell with browser-received Apollo place state."),
              fixture("#app-root", "Fixture Naver Place list iframe root with Apollo place state."),
              real("#app-root", "Naver Map result iframe root; validate before reading browser-received Apollo state."),
              real("#_pcmap_list_scroll_container", "Naver Map place-list scroll container when Apollo state backs visible cards."),
              real("#_pcmap_list_scroll_container li", "Naver Map visible place-list cards backed by client state."),
              real("#root", "Fallback Naver Map shell; use only when visible place-list state is present.")
            ],
            expectedTextSignals: ["\uB9AC\uBDF0", "\uC8FC\uC18C", "\uCE74\uD398", "\uC74C\uC2DD\uC810", "review", "address"],
            blockedSignals: SECURITY_CHALLENGE_SIGNALS,
            riskNotes: ["Reads browser-received Naver Place Apollo state without clicking result cards.", "Use only when visible cards expose place text but no usable href or SPA destination attribute.", "Child runs execute map.naver.com/p/entry/place/<id> while preserving canonical place.naver.com provenance."],
            clientStateExtraction: {
              stateKey: "__APOLLO_STATE__",
              extractor: "naver_place_apollo",
              destinationPath: "restaurant",
              maxLinks: 10
            }
          })
        ]
      : [])
  ];
}

function blogRecipeCandidates(platform: SourceNavigationPlan["platform"]): SourceNavigationRecipeActionCandidate[] {
  const fixtureVerified = platform === "naver_blog" || platform === "naver_cafe";
  const naverPageStateCandidates =
    platform === "naver_blog"
      ? [real("#content"), real("#app"), real(".post_list_wrap"), real('[data-innerhtml="postList"]'), real(".BlogId_content"), real("body", "Fallback page-shell candidate; prefer narrower Naver Blog scopes when present.")]
      : platform === "naver_cafe"
        ? [real("#app"), real("#main-area"), real(".ArticleContentBox"), real(".article-board"), real("body", "Fallback page-shell candidate; prefer narrower Naver Cafe scopes when present.")]
        : [];
  const membershipBlockedSignals = [
    "\uBE44\uACF5\uAC1C",
    "\uBE44\uACF5\uAC1C \uAE00",
    "\uC774 \uCE74\uD398\uB294 \uBA64\uBC84\uB9CC",
    "\uCE74\uD398 \uBA64\uBC84\uB9CC",
    "\uAC00\uC785\uD574\uC57C",
    "\uC811\uADFC \uAD8C\uD55C",
    "\uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4",
    "members only",
    "member-only",
    "private",
    "login required"
  ];
  const blogDestinationSelectors = [
    fixture("#blog-destination-links", "Fixture article links for source, related post, profile, and official destinations."),
    fixture("#article-source-link", "Fixture visible article source destination."),
    fixture("#related-post-link", "Fixture visible related article destination."),
    fixture("#profile-link", "Fixture visible author/profile destination."),
    fixture("#official-link", "Fixture visible official/external destination."),
    ...(platform === "naver_blog"
      ? [
          real("#postViewArea a[href]", "Naver Blog post body links."),
          real(".se-main-container a[href]", "Naver SmartEditor body links."),
          real(".BlogId_content a[href]", "Naver Blog page-shell content links."),
          real('a[href*="blog.naver.com"]', "Naver Blog related post or author links."),
          real('a[href*="naver.me"]', "Naver shortened outbound links visible in blog posts."),
          real('article a[href^="http"]', "Fallback article HTTP(S) links.")
        ]
      : []),
    ...(platform === "naver_cafe"
      ? [
          real("#main-area a[href]", "Naver Cafe article area links."),
          real(".ArticleContentBox a[href]", "Naver Cafe article body links."),
          real(".article-board a[href]", "Naver Cafe board/article links."),
          real('a[href*="cafe.naver.com"]', "Naver Cafe related post or board links."),
          real('a[href*="naver.me"]', "Naver shortened outbound links visible in cafe posts."),
          real('article a[href^="http"]', "Fallback article HTTP(S) links.")
        ]
      : []),
    real("main a[href]", "Generic visible main-content links."),
    real("article a[href]", "Generic article links.")
  ];
  return [
    candidate("article-capture", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#article"), fixture("#cafe-article"), real("article"), real("#postViewArea"), real(".se-main-container"), ...naverPageStateCandidates],
      scopes: [fixture("#article"), fixture("#cafe-article"), real("article"), real(".se-main-container"), ...naverPageStateCandidates],
      expectedTextSignals: ["author", "date", "\uBCF8\uBB38", "\uB313\uAE00"],
      riskNotes: ["Do not summarize member-only or login-walled content as if it was visible."]
    }),
    candidate("media-gallery", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#open-gallery"), fixture("#open-cafe-gallery"), real("figure"), real("img")],
      scopes: [fixture("#gallery"), fixture("#cafe-gallery"), real("figure"), real(".se-image")],
      expectedTextSignals: ["caption", "image", "\uC0AC\uC9C4"],
      riskNotes: ["Embedded image text needs separate screenshot/OCR evidence."]
    }),
    candidate("destination-followup", "extract_destinations", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: blogDestinationSelectors,
      expectedTextSignals: ["http", "https", "source", "profile", "official", "related", "\uCD9C\uCC98", "\uAD00\uB828", "\uD504\uB85C\uD544"],
      blockedSignals: membershipBlockedSignals,
      riskNotes: [
        "Blog/Cafe destination extraction reads visible source, related-post, profile, and official links without navigating the parent article page.",
        "Member-only, join, login, comment-write, like, scrape-private, and account-changing controls remain unsupported; extracted links still pass through bounded destination triage before child evidence runs."
      ]
    }),
    candidate("obstruction-check", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#member-wall"), real('[role="dialog"]'), real("body")],
      scopes: [fixture("#member-wall"), real('[role="dialog"]'), real("body")],
      expectedTextSignals: ["login", "members only", "\uAC00\uC785", "\uB85C\uADF8\uC778"],
      blockedSignals: membershipBlockedSignals,
      riskNotes: ["Record membership walls; never automate joins or login bypass."]
    })
  ];
}

function travelRecipeCandidates(platform: SourceNavigationPlan["platform"]): SourceNavigationRecipeActionCandidate[] {
  const fixtureVerified = ["agoda", "booking_com", "trip_com", "expedia"].includes(platform);
  const isAgoda = platform === "agoda";
  const isBooking = platform === "booking_com";
  const isTrip = platform === "trip_com";
  const isExpedia = platform === "expedia";
  const travelBlockedSignals = [
    "Access Denied",
    "access to this page has been denied",
    "permission to access",
    "Pardon Our Interruption",
    "verify you are human",
    "Show us your human side",
    "human or a bot",
    "can't tell if you're a human or a bot",
    "Bot or Not?",
    "not a robot",
    "are you a robot",
    "captcha",
    "CAPTCHA",
    "checking your browser",
    "unusual traffic",
    "temporarily blocked",
    "complete the security check",
    "challenge required",
    ...SECURITY_CHALLENGE_SIGNALS,
    "please enable cookies",
    "enable cookies to continue",
    "sign in to continue",
    "log in to continue",
    "login required"
  ];
  const travelQuerySelectors = [
    fixture("#destination"),
    fixture("#rate-destination"),
    ...(isBooking ? [real('input[name="ss"]'), real('[data-testid="destination-container"]'), real('[data-testid="destination-container"] input'), real('[data-testid="date-display-field-start"]'), real('[data-testid="occupancy-config"]')] : []),
    ...(isAgoda ? [real('input[data-selenium="textInput"]'), real('[data-selenium*="destination"]'), real('[data-selenium*="checkIn"]'), real('[data-selenium*="occupancy"]')] : []),
    ...(isTrip ? [real('input[name="keyword"]'), real('[data-testid*="destination"]'), real('[class*="destination"] input'), real('[class*="search-box"] input')] : []),
    ...(isExpedia ? [real('input[name="destination"]'), real('[data-stid="destination_form_field-menu-trigger"]'), real('[data-stid*="destination"]'), real('[aria-label*="Going to"]')] : []),
    real('input[name*="destination"]'),
    real('input[type="search"]')
  ];
  const travelFilterSelectors = [
    fixture("#breakfast-filter"),
    fixture("#refundable-filter"),
    ...(isBooking ? [real('[data-testid*="filter"]'), real('[data-testid="filters-group-label-content"]'), real('button[data-testid*="filter"]')] : []),
    ...(isAgoda ? [real('[data-selenium*="filter"]'), real('[data-element-name*="filter"]'), real('button[data-selenium*="filter"]')] : []),
    ...(isTrip ? [real('[data-testid*="filter"]'), real('[class*="filter"]')] : []),
    ...(isExpedia ? [real('[data-stid*="filter"]'), real('[data-stid*="amenity"]')] : []),
    real("button"),
    real('[role="checkbox"]'),
    real('input[type="checkbox"]')
  ];
  const travelFilterScopes = [
    fixture("#filter-state"),
    ...(isBooking ? [real('[data-testid*="filter"]'), real('[data-testid="filters-sidebar"]'), real('[data-testid="property-card-container"]')] : []),
    ...(isAgoda ? [real('[data-selenium*="filter"]'), real('[data-selenium="hotel-item"]'), real("#contentContainer")] : []),
    ...(isTrip ? [real('[class*="filter"]'), real('[class*="hotel-list"]'), real('[data-testid*="hotel"]')] : []),
    ...(isExpedia ? [real('[data-stid*="filter"]'), real('[data-stid*="section-results"]'), real('[data-stid*="property-listing"]')] : []),
    real('[data-testid*="filter"]'),
    real("aside")
  ];
  const travelSortSelectors = [
    fixture("#sort"),
    fixture("#rate-sort"),
    ...(isBooking ? [real('[data-testid*="sort"]'), real('[data-testid="sorters-dropdown-trigger"]')] : []),
    ...(isAgoda ? [real('[data-selenium*="sort"]'), real('[data-element-name*="sort"]')] : []),
    ...(isTrip ? [real('[data-testid*="sort"]'), real('[class*="sort"]')] : []),
    ...(isExpedia ? [real('[data-stid*="sort"]'), real('[data-stid*="sort-filter"]')] : []),
    real("select"),
    real('[role="button"]')
  ];
  const travelListScopes = [
    fixture("#room-list"),
    ...(isBooking ? [real('[data-testid="property-card"]'), real('[data-testid*="property-card"]'), real('[data-testid="property-card-container"]'), real('[data-testid="title"]'), real('[data-testid="availability-cta"]')] : []),
    ...(isAgoda
      ? [
          real('[data-selenium="hotel-item"]'),
          real('[data-selenium="property-card"]'),
          real('[data-element-name*="property-card"]'),
          real('[data-element-name="geo-carousel-card"]'),
          real('[data-selenium="base-card"]'),
          real(".base-card.property-details"),
          real('[data-selenium="hotel-name"]'),
          real("#contentContainer")
        ]
      : []),
    ...(isTrip ? [real('[class*="hotel-card"]'), real('[class*="HotelCard"]'), real('[class*="list-card"]'), real('[class*="hotel-list"]'), real('[data-testid*="hotel"]')] : []),
    ...(isExpedia ? [real('[data-stid*="property-listing"]'), real('[data-stid*="property-card"]'), real('[data-stid*="section-results"]'), real('[data-stid*="lodging-card-responsive"]')] : []),
    real('[data-testid*="property-card"]'),
    real('[data-testid*="hotel"]')
  ];
  const travelOfferSelectors = [
    fixture("#offer-detail"),
    fixture("#show-rate-terms"),
    ...(isBooking ? [real('[data-testid="availability-cta"]'), real('[data-testid*="availability"]'), real('[data-testid="property-card"]')] : []),
    ...(isAgoda ? [real('[data-selenium="room-card"]'), real('[data-selenium*="room"]'), real('[data-element-name*="room"]'), real('[data-selenium="hotel-item"]')] : []),
    ...(isTrip ? [real('[class*="room"]'), real('[class*="HotelCard"]'), real('[data-testid*="room"]')] : []),
    ...(isExpedia ? [real('[data-stid*="open-hotel-information"]'), real('[data-stid*="property-listing"]'), real('[data-stid*="room-card"]')] : []),
    real('[data-testid*="availability"]'),
    real("button")
  ];
  const travelOfferScopes = [
    fixture("#rate-panel"),
    fixture("#rate-terms"),
    fixture("#price-card"),
    ...(isBooking ? [real('[data-testid="property-card"]'), real('[data-testid*="property-card"]'), real('[data-testid="availability-cta"]'), real('[data-testid*="room"]')] : []),
    ...(isAgoda ? [real('[data-selenium="room-card"]'), real('[data-selenium*="room"]'), real('[data-selenium*="cancellation"]'), real('[data-selenium="hotel-item"]')] : []),
    ...(isTrip ? [real('[class*="room"]'), real('[class*="cancel"]'), real('[class*="HotelCard"]')] : []),
    ...(isExpedia ? [real('[data-stid*="room-card"]'), real('[data-stid*="property-listing"]'), real('[data-stid*="price-summary"]')] : []),
    real('[data-testid*="property-card"]')
  ];
  const travelPriceScopes = [
    fixture("#price-card"),
    fixture("#rate-price-card"),
    ...(isBooking ? [real('[data-testid="price-and-discounted-price"]'), real('[data-testid="taxes-and-charges"]'), real('[data-testid*="price"]')] : []),
    ...(isAgoda ? [real('[data-selenium="display-price"]'), real('[data-selenium*="price"]'), real('[data-element-name*="price"]'), real('[data-element-name="geo-dateless-search-property-card"]'), real('[class*="PriceCurrency"]'), real('[class*="DatelessPropertyCard"]')] : []),
    ...(isTrip ? [real('[data-testid*="price"]'), real('[class*="price"]'), real('[class*="tax"]')] : []),
    ...(isExpedia ? [real('[data-stid*="price-summary"]'), real('[data-stid*="price"]'), real('[data-stid*="lodging-card-price"]')] : []),
    real('[data-testid*="price"]'),
    real('[data-testid*="property-card"]')
  ];
  const travelPaginationSelectors = [
    fixture("#show-more-rates"),
    ...(isBooking ? [real('[data-testid*="pagination"]'), real('button[aria-label*="Next"]'), real('a[aria-label*="Next"]')] : []),
    ...(isAgoda ? [real('[data-selenium*="pagination"]'), real('[data-element-name*="pagination"]'), real('button[aria-label*="Next"]')] : []),
    ...(isTrip ? [real('[class*="pagination"]'), real('[class*="loadMore"]'), real('button[aria-label*="Next"]')] : []),
    ...(isExpedia ? [real('[data-stid*="pagination"]'), real('[data-stid*="show-more"]'), real('button[aria-label*="Next"]')] : []),
    real('button[aria-label*="Next"]'),
    real('a[aria-label*="Next"]'),
    real("button")
  ];
  return [
    candidate("query-state", "fill", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: travelQuerySelectors,
      expectedTextSignals: ["destination", "dates", "guests", "rooms", "currency"],
      blockedSignals: travelBlockedSignals,
      riskNotes: ["Record dates, guests, rooms, currency, and tax visibility before comparing offers."]
    }),
    candidate("visible-filters", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: travelFilterSelectors,
      scopes: travelFilterScopes,
      expectedTextSignals: ["breakfast", "free cancellation", "filter", "amenities", "rating"],
      blockedSignals: travelBlockedSignals,
      riskNotes: ["Filter controls must not enter booking or payment funnels."]
    }),
    candidate("visible-sort", "select", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: travelSortSelectors,
      expectedTextSignals: ["sort", "recommended", "price", "total", "distance", "rating"],
      blockedSignals: travelBlockedSignals,
      riskNotes: ["Sort labels vary by locale; cite visible sort state."]
    }),
    candidate("result-scroll", "scroll", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [],
      scopes: travelListScopes,
      expectedTextSignals: ["hotel", "room", "price", "availability", "property"],
      blockedSignals: travelBlockedSignals,
      riskNotes: ["Keep travel result scrolling bounded and timestamp each captured list state."]
    }),
    candidate("result-pagination", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: travelPaginationSelectors,
      scopes: travelListScopes,
      expectedTextSignals: ["more", "next", "page", "room", "availability"],
      blockedSignals: travelBlockedSignals,
      riskNotes: ["Pagination must stay bounded; do not crawl unbounded travel listings."]
    }),
    candidate("offer-card", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: travelListScopes,
      scopes: travelListScopes,
      expectedTextSignals: ["hotel", "room", "price", "availability", "review", "rating"],
      blockedSignals: travelBlockedSignals,
      riskNotes: ["Capture list cards as read-only evidence; do not click reserve, book, pay, or sign-in controls."]
    }),
    candidate("offer-detail", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: travelOfferSelectors,
      scopes: travelOfferScopes,
      expectedTextSignals: ["cancellation", "tax", "fee", "No prepayment", "pay at property"],
      blockedSignals: travelBlockedSignals,
      riskNotes: ["Do not click reserve, book, pay, sign-in, or hold-inventory actions."]
    }),
    candidate("price-ocr", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: travelPriceScopes,
      scopes: travelPriceScopes,
      expectedTextSignals: ["KRW", "USD", "JPY", "tax", "fee", "total"],
      blockedSignals: travelBlockedSignals,
      riskNotes: ["Prices are volatile point-in-time evidence and may require OCR over screenshot regions."]
    })
  ];
}

function commerceRecipeCandidates(platform: SourceNavigationPlan["platform"]): SourceNavigationRecipeActionCandidate[] {
  const fixtureVerified = ["amazon", "coupang", "naver_shopping", "gmarket", "elevenst", "walmart", "ebay"].includes(platform);
  const isAmazon = platform === "amazon";
  const isCoupang = platform === "coupang";
  const isNaverShopping = platform === "naver_shopping";
  const isGmarket = platform === "gmarket";
  const isElevenst = platform === "elevenst";
  const isWalmart = platform === "walmart";
  const isEbay = platform === "ebay";
  const fixturePrefix = commerceFixturePrefixFor(platform);
  const platformFixture = (suffix: string, note: string): SourceNavigationSelectorCandidate[] => (fixturePrefix === undefined ? [] : [fixture(`#${fixturePrefix}-${suffix}`, note)]);
  const commerceBlockedSignals = [
    "Access Denied",
    "permission to access",
    "errors.edgesuite.net",
    "temporarily blocked",
    "unusual traffic",
    "captcha",
    "CAPTCHA",
    ...SECURITY_CHALLENGE_SIGNALS,
    "\uC811\uC18D\uC774 \uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C",
    "\uC1FC\uD551 \uC11C\uBE44\uC2A4 \uC811\uC18D\uC774 \uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C",
    "\uBE44\uC815\uC0C1\uC801\uC778 \uC811\uADFC",
    "\uBD07 \uD655\uC778",
    "\uBD07(Bot)",
    "\uAC04\uB2E8\uD55C \uD655\uC778",
    "\uC6D0\uD65C\uD55C \uC11C\uBE44\uC2A4 \uC774\uC6A9\uC744 \uC704\uD55C \uAC04\uB2E8\uD55C \uD655\uC778"
  ];
  const commerceListScopes = [
    ...platformFixture("product-list", "Provider-specific local commerce fixture product list."),
    ...platformFixture("product-card", "Provider-specific local commerce fixture product card."),
    ...(isAmazon
      ? [real('[data-component-type*="s-search-result"]', "Amazon search-result product card."), real('[data-component-type*="search-result"]', "Amazon search-result component fallback."), real(".s-result-item", "Amazon result item card."), real("[data-asin]", "Amazon product card with ASIN metadata.")]
      : []),
    ...(isCoupang ? [real("#product-list", "Coupang search result list container observed in live calibration."), real("#productList"), real(".search-product"), real(".search-product-list"), real(".search-product-wrap"), real(".search-product-link")] : []),
    ...(isNaverShopping ? [real("#content"), real("#container"), real('[class*="basicList"]'), real('[class*="product_item"]'), real('[class*="productCard"]'), real('[class*="product_list"]'), real('a[href*="/catalog/"]'), real('a[href*="/products/"]')] : []),
    ...(isGmarket ? [real("#section__inner-content-body-container"), real(".box__component"), real(".box__item"), real(".box__item-container"), real(".box__information"), real(".list-item"), real(".itemcard"), real('a[href*="item.gmarket.co.kr"]')] : []),
    ...(isElevenst ? [real('[class*="search_content"]', "11st search content container."), real('[class*="c_prd"]', "11st product card container."), real('[class*="product"]', "11st product-card fallback."), real('a[href*="/products/"]', "11st product detail links.")] : []),
    ...(isWalmart
      ? [
          real('[data-testid="item-stack"]', "Walmart search result stack."),
          real("[data-item-id]", "Walmart product cards with item IDs."),
          real('[data-testid*="list-view"]', "Walmart list-view product container."),
          real('[data-testid*="product"]', "Walmart product-card test-id fallback."),
          real('a[href*="/ip/"]', "Walmart product detail links.")
        ]
      : []),
    ...(isEbay ? [real(".srp-results", "eBay search result list."), real(".s-item", "eBay search-result item card."), real(".s-item__info", "eBay item information block."), real(".s-card", "eBay card layout fallback."), real('a[href*="/itm/"]', "eBay item detail links.")] : []),
    real('[data-component-type*="search-result"]'),
    real(".product-list"),
    real('[class*="product"]'),
    real('[class*="item"]')
  ];
  const commercePriceScopes = [
    ...platformFixture("price-badge", "Provider-specific local commerce fixture price/coupon/shipping badge."),
    ...(isAmazon ? [real(".a-price", "Amazon visible price block."), real(".a-price-whole", "Amazon visible whole-price text."), real('[data-a-color="price"]', "Amazon price-colored block.")] : []),
    ...(isCoupang ? [real('[class*="price"]'), real('[class*="Price"]'), real(".price-value"), real(".sale-price")] : []),
    ...(isNaverShopping ? [real('[class*="price"]'), real('[class*="Price"]'), real('[class*="price_num"]'), real('[class*="product_price"]')] : []),
    ...(isGmarket ? [real('[class*="price"]'), real('[class*="Price"]'), real(".box__price"), real(".text__price"), real(".box__item-price")] : []),
    ...(isElevenst ? [real('[class*="price"]'), real('[class*="Price"]'), real('[class*="salePrice"]'), real('[class*="c_prd_price"]')] : []),
    ...(isWalmart ? [real('[data-automation-id="product-price"]', "Walmart product price block."), real('[data-testid*="price"]', "Walmart price test-id block."), real('[itemprop="price"]', "Walmart structured visible price value."), real('[class*="price"]')] : []),
    ...(isEbay ? [real(".s-item__price", "eBay search result price."), real(".x-price-primary", "eBay item primary price."), real('[class*="price"]')] : []),
    real('[data-testid*="price"]')
  ];
  const commerceDestinationSelectors = [
    ...platformFixture("destination-links", "Provider-specific local commerce fixture destination links."),
    ...platformFixture("product-detail-link", "Provider-specific local product-detail destination."),
    ...platformFixture("product-review-link", "Provider-specific local product-review destination."),
    ...platformFixture("seller-profile-link", "Provider-specific local seller-profile destination."),
    ...platformFixture("brand-store-link", "Provider-specific local brand/store destination."),
    fixture("#commerce-destination-links", "Fixture product-card destination links for product detail, review, seller, and brand pages."),
    fixture("#product-detail-link", "Fixture product detail destination."),
    fixture("#product-review-link", "Fixture product review destination."),
    fixture("#seller-profile-link", "Fixture seller profile destination."),
    fixture("#brand-store-link", "Fixture brand/store destination."),
    ...(isAmazon
      ? [
          real('[data-component-type*="search-result"] [data-asin][data-url]', "Amazon product cards exposing URL attributes."),
          real('[data-component-type*="search-result"] [data-product-url]', "Amazon product cards exposing product URL attributes."),
          real('a[href*="/dp/"]', "Amazon product detail links."),
          real('a[href*="/gp/product/"]', "Amazon product links using gp/product paths."),
          real('a[href*="customerReviews"]', "Amazon product review links."),
          real('a[href*="/sp?"]', "Amazon seller profile links."),
          real('[data-component-type*="search-result"] a[href]', "Amazon visible search-result links.")
        ]
      : []),
    ...(isCoupang
      ? [
          real("[data-product-id][data-url]", "Coupang product cards exposing URL attributes."),
          real("[data-product-url]", "Coupang product cards exposing product URL attributes."),
          real("[data-item-url]", "Coupang item cards exposing item URL attributes."),
          real('a[href*="/vp/products/"]', "Coupang product detail links."),
          real('a[href*="/np/products/"]', "Coupang product links visible from list cards."),
          real('a[href*="itemId="]', "Coupang item-specific links."),
          real('a[href*="vendorItemId="]', "Coupang vendor-item links."),
          real(".search-product-link", "Coupang search product anchors.")
        ]
      : []),
    ...(isNaverShopping
      ? [
          real("[data-product-url]", "Naver Shopping product cards exposing product URL attributes."),
          real("[data-item-url]", "Naver Shopping item cards exposing item URL attributes."),
          real("[data-brand-url]", "Naver Shopping brand/store cards exposing brand URL attributes."),
          real('a[href*="/catalog/"]', "Naver Shopping catalog detail links."),
          real('a[href*="/products/"]', "Naver Shopping product detail links."),
          real('a[href*="smartstore.naver.com"]', "Naver SmartStore seller/product links."),
          real('a[href*="brand.naver.com"]', "Naver brand-store links."),
          real('[class*="product"] a[href]', "Naver Shopping visible product-card links.")
        ]
      : []),
    ...(isGmarket
      ? [
          real("[data-item-url]", "Gmarket item cards exposing item URL attributes."),
          real("[data-product-url]", "Gmarket product cards exposing product URL attributes."),
          real("[data-seller-url]", "Gmarket seller cards exposing seller URL attributes."),
          real('a[href*="item.gmarket.co.kr"]', "Gmarket item detail links."),
          real('a[href*="goodsCode="]', "Gmarket item-code links."),
          real('a[href*="seller"]', "Gmarket seller links when visible."),
          real(".box__item a[href]", "Gmarket item-card links."),
          real(".itemcard a[href]", "Gmarket item-card fallback links.")
        ]
      : []),
    ...(isElevenst
      ? [
          real("[data-item-url]", "11st item cards exposing item URL attributes."),
          real("[data-product-url]", "11st product cards exposing product URL attributes."),
          real("[data-seller-url]", "11st seller cards exposing seller URL attributes."),
          real('a[href*="/products/"]', "11st product detail links."),
          real('a[href*="prdNo="]', "11st product-number links."),
          real('a[href*="seller"]', "11st seller links when visible."),
          real('[class*="product"] a[href]', "11st product-card links.")
        ]
      : []),
    ...(isWalmart
      ? [
          real("[data-product-url]", "Walmart product cards exposing product URL attributes."),
          real("[data-item-url]", "Walmart item cards exposing item URL attributes."),
          real("[data-seller-url]", "Walmart seller cards exposing seller URL attributes."),
          real('a[href*="/ip/"]', "Walmart product detail links."),
          real('a[href*="sellerId="]', "Walmart seller profile links when visible."),
          real('[data-testid*="product"] a[href]', "Walmart product-card links.")
        ]
      : []),
    ...(isEbay
      ? [
          real("[data-item-url]", "eBay item cards exposing item URL attributes."),
          real("[data-product-url]", "eBay product cards exposing product URL attributes."),
          real("[data-seller-url]", "eBay seller cards exposing seller URL attributes."),
          real('a[href*="/itm/"]', "eBay item detail links."),
          real('a[href*="seller"]', "eBay seller links when visible."),
          real(".s-item a[href]", "eBay item-card links."),
          real(".s-card a[href]", "eBay card fallback links.")
        ]
      : []),
    real('[class*="product"] a[href]', "Fallback visible product-card HTTP(S) links."),
    real('[class*="item"] a[href]', "Fallback visible item-card HTTP(S) links.")
  ];
  return [
    candidate("query-state", "fill", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [...platformFixture("query", "Provider-specific local commerce fixture query input."), fixture("#commerce-query"), real('input[name="field-keywords"]'), real('input[name="q"]'), real('input[name="query"]'), real('input[type="search"]')],
      expectedTextSignals: ["query", "search", "\uAC80\uC0C9"],
      blockedSignals: commerceBlockedSignals,
      riskNotes: ["Record the visible query, locale, and currency before comparing product cards."]
    }),
    candidate("visible-filters", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [...platformFixture("filter", "Provider-specific local commerce fixture filter control."), fixture("#rocket-filter"), real('[role="checkbox"]'), real("button"), real("a")],
      scopes: [...platformFixture("filter-state", "Provider-specific local commerce fixture filter state."), fixture("#filter-state"), real('[data-component-type*="filter"]'), real("aside"), real("#content"), real("#container")],
      expectedTextSignals: ["shipping", "delivery", "filter", "\uBC30\uC1A1", "\uD544\uD130"],
      blockedSignals: commerceBlockedSignals,
      riskNotes: ["Filter controls must not trigger cart, subscription, membership, or checkout actions."]
    }),
    candidate("visible-sort", "select", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [...platformFixture("sort", "Provider-specific local commerce fixture sort control."), fixture("#commerce-sort"), real("select"), real('[aria-label*="Sort"]'), real('[aria-label*="\uC815\uB82C"]')],
      expectedTextSignals: ["sort", "price", "review", "\uC815\uB82C"],
      blockedSignals: commerceBlockedSignals,
      riskNotes: ["Sort labels vary by marketplace and locale; cite visible sort state."]
    }),
    candidate("result-scroll", "scroll", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [],
      scopes: [fixture("#product-list"), ...commerceListScopes, real("#content")],
      expectedTextSignals: ["product", "price", "\uC0C1\uD488"],
      blockedSignals: commerceBlockedSignals,
      riskNotes: ["Keep marketplace scrolling bounded and timestamp each captured list state."]
    }),
    candidate("result-pagination", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [...platformFixture("more-products", "Provider-specific local commerce fixture pagination/more-results control."), fixture("#more-products"), real('a[aria-label*="Next"]'), real('a[aria-label*="\uB2E4\uC74C"]'), real("button")],
      scopes: [fixture("#product-list"), ...commerceListScopes],
      expectedTextSignals: ["more", "next", "\uB354\uBCF4\uAE30", "\uB2E4\uC74C"],
      blockedSignals: commerceBlockedSignals,
      riskNotes: ["Pagination must stay bounded; do not crawl unbounded marketplace listings."]
    }),
    candidate("product-card", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#product-card"), ...commerceListScopes, real("article")],
      scopes: [fixture("#product-card"), fixture("#product-list"), ...commerceListScopes],
      expectedTextSignals: ["price", "shipping", "seller", "review", "\uC6D0", "\uBC30\uC1A1"],
      blockedSignals: commerceBlockedSignals,
      riskNotes: ["Product cards prove only browser-visible marketplace display at that time."]
    }),
    candidate("seller-terms", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [...platformFixture("seller-terms-button", "Provider-specific local commerce fixture seller/shipping terms control."), fixture("#seller-terms-button"), real("button"), real("a")],
      scopes: [
        ...platformFixture("seller-terms", "Provider-specific local commerce fixture seller/return terms."),
        ...platformFixture("shipping-panel", "Provider-specific local commerce fixture shipping panel."),
        fixture("#seller-terms"),
        fixture("#shipping-panel"),
        real('[data-testid*="seller"]'),
        real('[data-testid*="shipping"]')
      ],
      expectedTextSignals: ["seller", "shipping", "return", "coupon", "\uD310\uB9E4\uC790", "\uBC18\uD488"],
      blockedSignals: commerceBlockedSignals,
      riskNotes: ["Do not click cart, buy, subscribe, address, membership, or checkout controls."]
    }),
    candidate("price-ocr", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#price-badge"), fixture("#product-card"), ...commercePriceScopes],
      scopes: [fixture("#price-badge"), fixture("#product-card"), ...commercePriceScopes, ...commerceListScopes],
      expectedTextSignals: ["KRW", "USD", "JPY", "\uC6D0", "shipping", "coupon"],
      blockedSignals: commerceBlockedSignals,
      riskNotes: ["Prices, coupons, and shipping badges are volatile point-in-time evidence and may require OCR over screenshots."]
    }),
    candidate("destination-followup", "extract_destinations", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: commerceDestinationSelectors,
      expectedTextSignals: ["http", "https", "product", "seller", "review", "brand", "\uC0C1\uD488", "\uD310\uB9E4\uC790", "\uB9AC\uBDF0"],
      blockedSignals: commerceBlockedSignals,
      riskNotes: [
        "Commerce destination extraction reads visible product, seller, review, and brand links without clicking the parent marketplace page.",
        "Cart, wishlist, purchase, checkout, subscribe, address, membership, login, and account-changing controls remain unsupported; extracted links still pass through bounded destination triage before child evidence runs."
      ]
    })
  ];
}

function commerceFixturePrefixFor(platform: SourceNavigationPlan["platform"]): string | undefined {
  switch (platform) {
    case "amazon":
      return "amazon-commerce";
    case "coupang":
      return "coupang-commerce";
    case "naver_shopping":
      return "naver-shopping-commerce";
    case "gmarket":
      return "gmarket-commerce";
    case "elevenst":
      return "elevenst-commerce";
    case "walmart":
      return "walmart-commerce";
    case "ebay":
      return "ebay-commerce";
    default:
      return undefined;
  }
}

function videoSocialRecipeCandidates(platform: SourceNavigationPlan["platform"]): SourceNavigationRecipeActionCandidate[] {
  const fixtureVerified = platform === "youtube" || platform === "instagram" || platform === "tiktok" || platform === "x_twitter";
  const youtubeMetadataSelectors = platform === "youtube" ? [real("ytd-video-renderer"), real("ytd-rich-item-renderer"), real("#video-title"), real("#contents")] : [];
  const youtubeMetadataScopes = platform === "youtube" ? [real("ytd-video-renderer"), real("ytd-rich-item-renderer"), real("#contents")] : [];
  const youtubeOverlaySelectors = platform === "youtube" ? [real("#overlay-text"), real("ytd-thumbnail-overlay-time-status-renderer"), real("ytd-thumbnail")] : [];
  const xMetadataSelectors = platform === "x_twitter" ? [fixture("#x-visible-post"), fixture("#x-post-metadata"), real('article[data-testid="tweet"]'), real('[data-testid="tweetText"]'), real('[data-testid="User-Name"]'), real("time")] : [];
  const xMetadataScopes =
    platform === "x_twitter" ? [fixture("#x-visible-post"), fixture("#x-post-metadata"), fixture("#x-profile-card"), fixture("#x-thread-context"), fixture("#x-engagement-state"), fixture("#x-reply-list"), real('article[data-testid="tweet"]'), real('[data-testid="tweetText"]'), real('[data-testid="User-Name"]')] : [];
  const publicPostMetadataScopes = platform === "instagram" || platform === "tiktok" ? [fixture("#visible-post"), fixture("#post-metadata"), fixture("#profile-card"), fixture("#caption-body"), fixture("#engagement-state"), fixture("#comment-preview-list")] : [];
  const tiktokMetadataSelectors =
    platform === "tiktok"
      ? [
          fixture("#tiktok-visible-post", "Fixture TikTok public post shell."),
          fixture("#tiktok-post-metadata", "Fixture TikTok visible metadata block."),
          real('[data-e2e="browse-video"]', "TikTok public visible video/post shell when rendered."),
          real('[data-e2e="user-post-item"]', "TikTok public user post item card."),
          real('[data-e2e="video-desc"]', "TikTok visible caption/body text."),
          real('a[href*="/@"]', "TikTok visible public profile handle links.")
        ]
      : [];
  const tiktokMetadataScopes =
    platform === "tiktok"
      ? [
          fixture("#tiktok-visible-post"),
          fixture("#tiktok-post-metadata"),
          fixture("#tiktok-profile-card"),
          fixture("#tiktok-caption-body"),
          fixture("#tiktok-engagement-state"),
          fixture("#tiktok-comment-preview-list"),
          real('[data-e2e="browse-video"]'),
          real('[data-e2e="user-post-item"]'),
          real('[data-e2e="video-desc"]')
        ]
      : [];
  const xFrameSelectors = platform === "x_twitter" ? [fixture("#x-media-frame"), real('[data-testid="videoPlayer"]'), real('[data-testid="tweetPhoto"]')] : [];
  const xOverlaySelectors = platform === "x_twitter" ? [fixture("#x-overlay-text"), real('[data-testid="videoPlayer"]'), real('[data-testid="tweetPhoto"]')] : [];
  const tiktokFrameSelectors = platform === "tiktok" ? [fixture("#tiktok-video-frame"), real('[data-e2e="video-player"]'), real("video")] : [];
  const tiktokOverlaySelectors = platform === "tiktok" ? [fixture("#tiktok-overlay-text"), fixture("#tiktok-video-frame"), real('[data-e2e="video-player"]'), real('[data-e2e="video-desc"]')] : [];
  const socialBlockedSignals = [
    "captcha",
    "please log in",
    "log in to continue",
    "log in to view",
    "login to continue",
    "login to view",
    "sign in to continue",
    "sign in to view",
    "sign up to view",
    "open app",
    "age restricted",
    "not available",
    "unlock more posts",
    "something went wrong",
    "something wrong with the server",
    "rate limit",
    ...SECURITY_CHALLENGE_SIGNALS
  ];
  const socialDestinationSelectors = [
    fixture("#social-destination-links", "Fixture public profile, external bio, canonical media, and related media links."),
    fixture("#profile-link", "Fixture visible public profile destination."),
    fixture("#external-link", "Fixture visible external bio/source destination."),
    fixture("#video-watch-link", "Fixture visible canonical video/media destination."),
    fixture("#channel-link", "Fixture visible channel/profile destination."),
    fixture("#tiktok-destination-links", "Fixture TikTok profile, external source, canonical media, and SPA destination links."),
    fixture("#tiktok-profile-link", "Fixture TikTok visible public profile destination."),
    fixture("#tiktok-external-link", "Fixture TikTok visible external source destination."),
    fixture("#tiktok-video-watch-link", "Fixture TikTok visible canonical media destination."),
    fixture("#x-profile-link", "Fixture visible X/Twitter profile destination."),
    ...(platform === "youtube"
      ? [
          real("#contents [data-media-url]", "YouTube visible media cards exposing canonical media URL attributes."),
          real("#contents [data-channel-url]", "YouTube visible media cards exposing channel URL attributes."),
          real('ytd-video-renderer a#video-title[href*="/watch"]', "YouTube search-result title links for canonical watch pages."),
          real('ytd-video-renderer a#video-title[href*="/shorts"]', "YouTube search-result title links for Shorts pages."),
          real('ytd-rich-item-renderer a#video-title-link[href*="/watch"]', "YouTube rich-grid title links for canonical watch pages."),
          real('ytd-rich-item-renderer a#thumbnail[href*="/watch"]', "YouTube rich-grid thumbnail links for canonical watch pages."),
          real('ytd-rich-item-renderer a#thumbnail[href*="/shorts"]', "YouTube rich-grid thumbnail links for Shorts pages."),
          real('ytd-channel-name a[href*="/channel/"]', "YouTube visible channel-name links."),
          real('ytd-channel-name a[href*="/@"]', "YouTube visible handle links."),
          real('a#channel-thumbnail[href*="/channel/"]', "YouTube visible channel thumbnail links."),
          real('a#channel-thumbnail[href*="/@"]', "YouTube visible handle thumbnail links."),
          real('#contents a[href*="/watch"]', "YouTube visible watch-page links in search or related media surfaces."),
          real('#contents a[href*="/shorts"]', "YouTube visible Shorts links."),
          real('#contents a[href*="/channel/"]', "YouTube channel links."),
          real('#contents a[href*="/@"]', "YouTube handle/channel links."),
          real("ytd-video-renderer a[href]", "YouTube video-renderer links."),
          real("ytd-rich-item-renderer a[href]", "YouTube rich-item links.")
        ]
      : []),
    ...(platform === "instagram"
      ? [
          real("article [data-media-url]", "Instagram visible media cards exposing canonical media URL attributes."),
          real("article [data-profile-url]", "Instagram visible profile cards exposing profile URL attributes."),
          real("article [data-target-url]", "Instagram visible cards exposing target URL attributes."),
          real('article a[href^="/p/"]', "Instagram public post links when visible."),
          real('article a[href^="/reel/"]', "Instagram public reel links when visible."),
          real('article a[href^="/stories/"]', "Instagram story links are extracted only as evidence candidates; login gates remain unsupported."),
          real('article a[href^="/"]', "Instagram visible profile or post links."),
          real('a[href^="http"]', "Instagram visible external profile/bio links.")
        ]
      : []),
    ...(platform === "tiktok"
      ? [
          real("[data-media-url]", "TikTok visible media cards exposing canonical media URL attributes."),
          real("[data-profile-url]", "TikTok visible profile cards exposing profile URL attributes."),
          real('a[href*="/video/"]', "TikTok public video links when visible."),
          real('a[href*="/@"]', "TikTok public profile links when visible."),
          real('a[href^="http"]', "TikTok visible external links.")
        ]
      : []),
    ...(platform === "x_twitter"
      ? [
          real('[data-testid="tweet"] [data-media-url]', "X/Twitter visible media cards exposing media URL attributes."),
          real('[data-testid="tweet"] [data-profile-url]', "X/Twitter visible profile cards exposing profile URL attributes."),
          real('[data-testid="tweet"] a[href*="/status/"]', "X/Twitter public status links in a visible post or thread."),
          real('[data-testid="tweet"] a[href^="/"]', "X/Twitter visible profile, thread, or media links."),
          real('article[data-testid="tweet"] a[href]', "X/Twitter article links."),
          real('[data-testid="User-Name"] a[href]', "X/Twitter visible author/profile links.")
        ]
      : []),
    real("article a[href]", "Generic visible social/media article links."),
    real("main a[href]", "Generic visible social/media main-content links.")
  ];
  return [
    candidate("obstruction-check", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#gate"), fixture("#x-obstruction-state"), real('[role="dialog"]'), real("body")],
      scopes: [fixture("#gate"), fixture("#x-obstruction-state"), real('[role="dialog"]'), real("body")],
      expectedTextSignals: ["log in", "open app", "not available", "age", "region"],
      blockedSignals: socialBlockedSignals,
      riskNotes: ["Record gates as evidence; do not bypass login, app, age, region, or CAPTCHA surfaces."]
    }),
    candidate("visible-metadata", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#visible-post"), fixture("#post-metadata"), ...youtubeMetadataSelectors, ...xMetadataSelectors, ...tiktokMetadataSelectors, real("h1"), real("article"), real("body")],
      scopes: [...publicPostMetadataScopes, ...youtubeMetadataScopes, ...xMetadataScopes, ...tiktokMetadataScopes, real("h1"), real("article"), real("body")],
      expectedTextSignals: ["title", "caption", "profile", "channel", "post", "thread", "reply", "comment", "likes"],
      blockedSignals: socialBlockedSignals,
      riskNotes: ["Visible caption/metadata is not timed transcript or full video understanding.", "Public comments and engagement counts are volatile browser-visible context; do not perform likes, follows, comments, shares, or messages."]
    }),
    candidate("destination-followup", "extract_destinations", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: socialDestinationSelectors,
      expectedTextSignals: ["http", "https", "profile", "channel", "post", "video", "external", "bio"],
      blockedSignals: socialBlockedSignals,
      riskNotes: [
        "Video/social destination extraction reads visible profile, channel, canonical media, external bio, and related media links without navigating the parent page.",
        "Login, app-open, follow, like, comment, share, message, subscribe, raw stream, and gate-bypass actions remain unsupported; extracted links still pass through bounded destination triage before child evidence runs."
      ]
    }),
    candidate("frame-sampling", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#video-frame"), ...xFrameSelectors, ...tiktokFrameSelectors, real("video")],
      scopes: [fixture("#video-frame"), ...xFrameSelectors, ...tiktokFrameSelectors, real("video")],
      expectedTextSignals: ["video", "frame"],
      blockedSignals: socialBlockedSignals,
      riskNotes: ["Visual claims require timestamped frame screenshots."]
    }),
    candidate("overlay-ocr", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#overlay-text"), fixture("#video-frame"), ...youtubeOverlaySelectors, ...xOverlaySelectors, ...tiktokOverlaySelectors, real("video"), real("body")],
      scopes: [fixture("#overlay-text"), fixture("#video-frame"), ...youtubeOverlaySelectors, ...xOverlaySelectors, ...tiktokOverlaySelectors, real("video"), real("body")],
      expectedTextSignals: ["overlay", "caption", "text"],
      blockedSignals: socialBlockedSignals,
      riskNotes: ["Overlay OCR is derivative evidence and must cite the sampled frame or screenshot artifact."]
    })
  ];
}

function portalRecipeCandidates(platform: SourceNavigationPlan["platform"]): SourceNavigationRecipeActionCandidate[] {
  const fixtureVerified = ["naver_news", "daum_news", "google_news", "yahoo_news", "reuters", "google_scholar", "dcinside", "naver_kin", "reddit", "quora", "stack_overflow", "yelp", "tripadvisor"].includes(platform);
  const isGoogleNews = platform === "google_news";
  const isYahooNews = platform === "yahoo_news";
  const isReuters = platform === "reuters";
  const isGoogleScholar = platform === "google_scholar";
  const isYelp = platform === "yelp";
  const isTripadvisor = platform === "tripadvisor";
  const isReviewPortal = isYelp || isTripadvisor;
  const isDcinside = platform === "dcinside";
  const isNaverKin = platform === "naver_kin";
  const isReddit = platform === "reddit";
  const isQuora = platform === "quora";
  const isStackOverflow = platform === "stack_overflow";
  const isCommunityForum = isDcinside || isNaverKin || isReddit || isQuora || isStackOverflow;
  const communityQueryFixtures = isDcinside ? [fixture("#dcinside-query")] : isNaverKin ? [fixture("#naver-kin-query")] : isReddit ? [fixture("#reddit-query")] : isQuora ? [fixture("#quora-query")] : isStackOverflow ? [fixture("#stack-overflow-query")] : [];
  const communityModuleFixtures = isCommunityForum ? [fixture("#community-module"), fixture("#thread-card"), fixture("#community-meta")] : [];
  const communityDestinationFixtures = isCommunityForum ? [fixture("#community-destination"), fixture("#destination-meta"), fixture("#question-body"), fixture("#thread-body"), fixture("#answer-body"), fixture("#accepted-answer"), fixture("#comment-list")] : [];
  const communitySectionFixtures = isCommunityForum ? [fixture("#community-section"), fixture("#community-section-state")] : [];
  const communityFilterFixtures = isCommunityForum ? [fixture("#community-recent"), fixture("#community-filter-state")] : [];
  const communityPaginationFixtures = isCommunityForum ? [fixture("#community-more")] : [];
  const communityFollowupFixtures = isCommunityForum ? [fixture("#community-link")] : [];
  const communityObstructionFixtures = isCommunityForum ? [fixture("#community-obstruction-state")] : [];
  const communityDestinationObstructionFixtures = isCommunityForum ? [fixture("#destination-obstruction-state")] : [];
  const reviewQueryFixtures = isReviewPortal ? [fixture("#review-query"), fixture("#review-location")] : [];
  const reviewModuleFixtures = isReviewPortal ? [fixture("#review-module"), fixture("#review-card"), fixture("#review-meta")] : [];
  const reviewSectionFixtures = isReviewPortal ? [fixture("#review-category"), fixture("#review-section-state")] : [];
  const reviewFilterFixtures = isReviewPortal ? [fixture("#review-filter"), fixture("#review-filter-state")] : [];
  const reviewPaginationFixtures = isReviewPortal ? [fixture("#review-more")] : [];
  const reviewFollowupFixtures = isReviewPortal ? [fixture("#review-destination-links"), fixture("#review-listing-link"), fixture("#review-menu-link"), fixture("#review-external-link")] : [];
  const reviewObstructionFixtures = isReviewPortal ? [fixture("#review-obstruction-state")] : [];
  const googleNewsQuerySelectors = isGoogleNews
    ? [fixture("#google-news-query", "Fixture Google News query field."), real('input[aria-label*="Search"]', "Google News search input when exposed."), real('input[type="search"]', "Google News search input fallback."), real('input[type="text"]', "Google News text input fallback.")]
    : [];
  const googleNewsSectionSelectors = isGoogleNews
    ? [
        fixture("#google-news-section", "Fixture Google News section control."),
        real('a[href*="/home"]', "Google News home/top-story navigation link."),
        real('a[href*="/topics/"]', "Google News topic navigation links."),
        real('a[href*="/publications/"]', "Google News publication links."),
        real('[role="tab"]', "Google News tab control fallback.")
      ]
    : [];
  const googleNewsFilterSelectors = isGoogleNews
    ? [fixture("#google-news-recent", "Fixture Google News recency/filter state."), real('a[href*="when:"]', "Google News query operator link when visible."), real('button:has-text("Latest")', "Google News latest filter button."), real('button:has-text("Recent")', "Google News recent filter button.")]
    : [];
  const googleNewsModuleSelectors = isGoogleNews
    ? [
        fixture("#google-news-module", "Fixture Google News module."),
        real("main", "Google News main result container."),
        real('[role="main"]', "Google News accessible main result container."),
        real("article", "Google News article/result card."),
        real('a[href^="./read/"]', "Google News relative article read links."),
        real('a[href*="news.google.com/read/"]', "Google News absolute article read links.")
      ]
    : [];
  const googleNewsFollowupSelectors = isGoogleNews
    ? [
        fixture("#google-news-module a[href]", "Fixture Google News module links."),
        real('article a[href^="./read/"]', "Google News article-card relative read links."),
        real('main a[href^="./read/"]', "Google News main relative read links."),
        real('a[href^="./read/"]', "Google News visible relative read links."),
        real('a[href*="news.google.com/read/"]', "Google News visible absolute read links."),
        real('a[href*="news.google.com/articles/"]', "Google News article links when exposed with articles path.")
      ]
    : [];
  const yahooNewsQuerySelectors = isYahooNews ? [fixture("#yahoo-news-query", "Fixture Yahoo News query field."), real('input[name="p"]', "Yahoo News search query field."), real("#ybar-sbq", "Yahoo News/Yahoo header search box."), real('input[type="search"]', "Yahoo News search input fallback.")] : [];
  const yahooNewsSectionSelectors = isYahooNews
    ? [
        fixture("#yahoo-news-section", "Fixture Yahoo News section control."),
        real('a[href*="/category/"]', "Yahoo News category navigation links."),
        real('a[href*="/topic/"]', "Yahoo News topic navigation links."),
        real('nav a[href*="news.yahoo.com"]', "Yahoo News navigation links."),
        real('[role="tab"]', "Yahoo News tab control fallback.")
      ]
    : [];
  const yahooNewsFilterSelectors = isYahooNews
    ? [fixture("#yahoo-news-recent", "Fixture Yahoo News recency filter control."), real('a[href*="sort="]', "Yahoo News sort/filter links when visible."), real('button:has-text("Latest")', "Yahoo News latest filter button."), real('button:has-text("Most Recent")', "Yahoo News most-recent filter button.")]
    : [];
  const yahooNewsModuleSelectors = isYahooNews
    ? [
        real("#Main", "Yahoo News main content container."),
        real("#YDC-Stream", "Yahoo News stream/list container."),
        real('[data-test-locator="stream-item"]', "Yahoo News stream item card."),
        real('article[data-test-locator="stream-item"]', "Yahoo News article stream item."),
        real("article", "Yahoo News article/card fallback.")
      ]
    : [];
  const yahooNewsFollowupSelectors = isYahooNews
    ? [
        real('#Main a[href*="news.yahoo.com"]', "Yahoo News main article links."),
        real('#YDC-Stream a[href*="news.yahoo.com"]', "Yahoo News stream article links."),
        real('[data-test-locator="stream-item"] a[href]', "Yahoo News stream item links."),
        real('article a[href*="/news/"]', "Yahoo News article/news links."),
        real('a[href*="news.yahoo.com"]', "Yahoo News visible article links.")
      ]
    : [];
  const reutersQuerySelectors = isReuters ? [fixture("#reuters-query", "Fixture Reuters query/topic field."), real('input[name="q"]', "Reuters search query field."), real('input[type="search"]', "Reuters search input fallback."), real('[data-testid*="search"] input', "Reuters data-testid search field.")] : [];
  const reutersSectionSelectors = isReuters
    ? [
        fixture("#reuters-section", "Fixture Reuters section control."),
        real('a[href*="/world/"]', "Reuters World section links."),
        real('a[href*="/business/"]', "Reuters Business section links."),
        real('a[href*="/technology/"]', "Reuters Technology section links."),
        real('nav a[href*="reuters.com"]', "Reuters navigation links.")
      ]
    : [];
  const reutersFilterSelectors = isReuters ? [fixture("#reuters-recent", "Fixture Reuters latest filter control."), real('button:has-text("Latest")', "Reuters latest filter button."), real('a[href*="/latest/"]', "Reuters latest news links."), real('a[href*="sort="]', "Reuters sort/filter links when visible.")] : [];
  const reutersModuleSelectors = isReuters
    ? [
        fixture("#reuters-news-module", "Fixture Reuters news module."),
        real("#fusion-app", "Reuters app shell."),
        real("main", "Reuters main content container."),
        real("article", "Reuters article/card content."),
        real('[data-testid*="Heading"]', "Reuters headline region."),
        real('[data-testid*="Body"]', "Reuters article body region."),
        real('[data-testid*="MediaStoryCard"]', "Reuters media story-card region."),
        real('[data-testid*="StoryCard"]', "Reuters story-card region."),
        real('[data-testid*="SearchResult"]', "Reuters search-result region."),
        real('[data-testid*="ArticleHeader"]', "Reuters article header region.")
      ]
    : [];
  const reutersFollowupSelectors = isReuters
    ? [
        fixture("#reuters-news-module a[href]", "Fixture Reuters module links."),
        real('[data-testid*="MediaStoryCard"] a[href*="-20"]', "Reuters dated media story-card links."),
        real('[data-testid*="StoryCard"] a[href*="-20"]', "Reuters dated story-card links."),
        real('[data-testid*="SearchResult"] a[href*="-20"]', "Reuters dated search-result links."),
        real('main a[href*="/world/"][href*="-20"]', "Reuters World article links with visible date slug."),
        real('main a[href*="/business/"][href*="-20"]', "Reuters Business article links with visible date slug."),
        real('main a[href*="/technology/"][href*="-20"]', "Reuters Technology article links with visible date slug."),
        real('main a[href*="/markets/"][href*="-20"]', "Reuters Markets article links with visible date slug."),
        real('main a[href*="/legal/"][href*="-20"]', "Reuters Legal article links with visible date slug."),
        real('main a[href*="reuters.com"]', "Reuters broad main links; calibration must prove only article destinations before promotion."),
        real('article a[href*="reuters.com"]', "Reuters broad article links; calibration must prove only article destinations before promotion."),
        real('[data-testid*="MediaStoryCard"] a[href]', "Reuters broad story-card links.")
      ]
    : [];
  const scholarQuerySelectors = isGoogleScholar ? [real('input[name="q"]'), real("#gs_hdr_tsi"), real("#gs_asd_q"), real('input[type="search"]')] : [];
  const scholarSectionSelectors = isGoogleScholar
    ? [
        real('a[href*="scholar?hl="]', "Google Scholar all-results navigation."),
        real('a[href*="as_ylo"]', "Google Scholar year filter links."),
        real('a[href*="as_yhi"]', "Google Scholar upper-year filter links."),
        real('a[href*="scisbd=1"]', "Google Scholar sort-by-date control when present."),
        real('a:has-text("Since")', "Google Scholar visible year filter label.")
      ]
    : [];
  const scholarModuleSelectors = isGoogleScholar
    ? [
        real("#gs_res_ccl_mid", "Google Scholar result list."),
        real("#gs_res_ccl", "Google Scholar result container."),
        real(".gs_r", "Google Scholar result card."),
        real(".gs_or", "Google Scholar organic result wrapper."),
        real(".gs_ri", "Google Scholar result info wrapper."),
        real(".gs_rt", "Google Scholar result title."),
        real(".gs_a", "Google Scholar author/publication metadata."),
        real(".gs_rs", "Google Scholar snippet/abstract text."),
        real(".gs_fl", "Google Scholar citation/save/related links."),
        real(".gs_or_ggsm", "Google Scholar full-text/PDF side link region.")
      ]
    : [];
  const scholarFollowupSelectors = isGoogleScholar
    ? [
        real(".gs_rt a[href]", "Google Scholar result title destination links."),
        real(".gs_or_ggsm a[href]", "Google Scholar full-text or PDF links."),
        real(".gs_fl a[href]", "Google Scholar citation, related, or versions links."),
        real('a[href*="scholar?cites="]', "Google Scholar cited-by links."),
        real('a[href*="scholar?cluster="]', "Google Scholar versions/cluster links."),
        real("#gs_res_ccl_mid a[href]", "Google Scholar visible result-list links.")
      ]
    : [];
  const reviewQuerySelectors = [
    ...(isYelp
      ? [
          real('input[name="find_desc"]', "Yelp search keyword field."),
          real("#find_desc", "Yelp search keyword input."),
          real('input[name="find_loc"]', "Yelp location field."),
          real("#dropperText_Mast", "Yelp location/input surface when exposed."),
          real('input[placeholder*="Search"]', "Yelp search input fallback."),
          real('input[placeholder*="Restaurants"]', "Yelp restaurant search input fallback.")
        ]
      : []),
    ...(isTripadvisor
      ? [
          real('input[name="q"]', "TripAdvisor search keyword field."),
          real('input[type="search"]', "TripAdvisor search box."),
          real('input[placeholder*="Search"]', "TripAdvisor search input fallback."),
          real('input[placeholder*="Where to"]', "TripAdvisor destination search input."),
          real('[data-test-target*="search"] input', "TripAdvisor search input in data-test search container.")
        ]
      : [])
  ];
  const reviewSectionSelectors = [
    ...(isYelp
      ? [
          real('a[href*="/c/"]', "Yelp category navigation links."),
          real('a[href*="find_desc=Restaurants"]', "Yelp restaurant category/search link."),
          real('a[href*="find_desc=Coffee"]', "Yelp coffee category/search link."),
          real('button[aria-label*="Filter"]', "Yelp filter controls."),
          real('[data-testid*="filter"]', "Yelp data-testid filter controls.")
        ]
      : []),
    ...(isTripadvisor
      ? [
          real('a[href*="/Restaurants-"]', "TripAdvisor restaurant vertical links."),
          real('a[href*="/Hotels-"]', "TripAdvisor hotel vertical links."),
          real('a[href*="/Attractions-"]', "TripAdvisor attraction vertical links."),
          real('a[href*="/Tourism-"]', "TripAdvisor destination/tourism links."),
          real('[data-test-target*="nav"] a[href]', "TripAdvisor navigation tabs."),
          real('[role="tab"]', "TripAdvisor tab control fallback.")
        ]
      : [])
  ];
  const reviewFilterSelectors = [
    ...(isYelp
      ? [real('button:has-text("Filters")', "Yelp filter button."), real('button:has-text("Price")', "Yelp price filter button."), real('button:has-text("Open Now")', "Yelp open-now filter button."), real('button:has-text("Sort")', "Yelp sort control."), real('label:has-text("Rating")', "Yelp rating filter label.")]
      : []),
    ...(isTripadvisor
      ? [
          real('button:has-text("Sort")', "TripAdvisor sort control."),
          real('button:has-text("Rating")', "TripAdvisor rating filter control."),
          real('button:has-text("Traveler rating")', "TripAdvisor traveler-rating filter control."),
          real('button:has-text("Price")', "TripAdvisor price filter control."),
          real('[data-test-target*="filter"]', "TripAdvisor filter panel."),
          real('[data-test-target*="sort"]', "TripAdvisor sort panel.")
        ]
      : [])
  ];
  const reviewPaginationSelectors = [
    ...(isYelp ? [real('a[aria-label*="Next"]', "Yelp next page link."), real('a[href*="start="]', "Yelp paginated result links."), real('button[aria-label*="Next"]', "Yelp next page button.")] : []),
    ...(isTripadvisor ? [real('a[aria-label*="Next"]', "TripAdvisor next page link."), real('a[href*="-oa"]', "TripAdvisor offset pagination links."), real('button[aria-label*="Next"]', "TripAdvisor next page button."), real('[data-smoke-attr*="pagination"] a[href]', "TripAdvisor pagination region links.")] : [])
  ];
  const reviewArticleSelectors = [
    ...(isYelp
      ? [
          real("#main-content", "Yelp main content region."),
          real("main", "Yelp semantic main content fallback."),
          real('[data-testid*="serp"]', "Yelp search result card region."),
          real('[data-testid*="business"]', "Yelp business card or detail region."),
          real('[class*="businessName"]', "Yelp business-name region."),
          real('a[href*="/biz/"]', "Yelp visible business detail links."),
          real('[aria-label*="rating"]', "Yelp rating text or star region."),
          real('[aria-label*="reviews"]', "Yelp review count or review section region.")
        ]
      : []),
    ...(isTripadvisor
      ? [
          real("#BODYCON", "TripAdvisor body/content shell."),
          real("main", "TripAdvisor semantic main content fallback."),
          real('[data-automation*="searchResults"]', "TripAdvisor search results region."),
          real('[data-test-target*="search-results"]', "TripAdvisor search results region."),
          real('[data-test-target*="reviews"]', "TripAdvisor review section region."),
          real('[data-test-target*="rating"]', "TripAdvisor rating region."),
          real('a[href*="/Restaurant_Review-"]', "TripAdvisor restaurant listing links."),
          real('a[href*="/Hotel_Review-"]', "TripAdvisor hotel listing links."),
          real('a[href*="/Attraction_Review-"]', "TripAdvisor attraction listing links."),
          real('a[href*="/ShowUserReviews-"]', "TripAdvisor user review links."),
          real('[class*="rating"]', "TripAdvisor rating class fallback."),
          real('[class*="review"]', "TripAdvisor review class fallback.")
        ]
      : [])
  ];
  const reviewDestinationSelectors = [
    ...(isYelp
      ? [
          real('main a[href*="/biz/"]', "Yelp business detail links from visible results."),
          real('#main-content a[href*="/biz/"]', "Yelp main-content business detail links."),
          real('a[href*="yelp.com/biz/"]', "Absolute Yelp business detail links."),
          real('a[href*="/menu/"]', "Yelp menu links when visible."),
          real('a[href*="/reviews"]', "Yelp review links when visible."),
          real('a[href*="biz_redir"]', "Yelp external website redirect links when visible.")
        ]
      : []),
    ...(isTripadvisor
      ? [
          real('main a[href*="/Restaurant_Review-"]', "TripAdvisor restaurant listing detail links."),
          real('main a[href*="/Hotel_Review-"]', "TripAdvisor hotel listing detail links."),
          real('main a[href*="/Attraction_Review-"]', "TripAdvisor attraction listing detail links."),
          real('main a[href*="/VacationRentalReview-"]', "TripAdvisor vacation-rental review links."),
          real('main a[href*="/ShowUserReviews-"]', "TripAdvisor user review links."),
          real('main a[href*="/Tourism-"]', "TripAdvisor destination/tourism links."),
          real('[data-automation*="searchResults"] a[href]', "TripAdvisor search-result links."),
          real('[data-test-target*="search-results"] a[href]', "TripAdvisor search-result links.")
        ]
      : [])
  ];
  const reviewObstructionSelectors = isReviewPortal ? [real('[role="dialog"]', "Review/local login, cookie, app, or region dialog."), real('[aria-modal="true"]', "Review/local modal obstruction."), real("#px-captcha", "PerimeterX or bot-check captcha region."), real("body", "Full-page obstruction fallback.")] : [];
  const communityArticleSelectors = [
    ...(isDcinside ? [real("#container"), real(".sch_result"), real(".result_list"), real(".search_result"), real('a[href*="board/view"]'), real(".writing_view_box"), real(".view_content_wrap"), real(".gallview_contents"), real(".comment_box")] : []),
    ...(isNaverKin ? [real("#s_content"), real("#content"), real(".basic1"), real(".question_group"), real(".question"), real(".kin_wrap"), real(".question-content"), real(".answer-content"), real(".answer_wrap"), real(".c-heading__content")] : []),
    ...(isReddit ? [real("shreddit-post"), real('[data-testid="post-container"]'), real('[slot="title"]'), real('[slot="text-body"]'), real('[data-testid="comment"]'), real("shreddit-comment"), real('a[href*="/comments/"]')] : []),
    ...(isQuora ? [real(".q-box"), real('[class*="Question"]'), real('[class*="question"]'), real('[class*="Answer"]'), real('[class*="answer"]'), real('[role="main"]')] : []),
    ...(isStackOverflow ? [real("#questions"), real("#question"), real("#answers"), real(".s-post-summary"), real(".question-summary"), real(".js-post-summary"), real(".js-post-body"), real(".answer"), real(".accepted-answer"), real("a.question-hyperlink")] : [])
  ];
  const communityFollowupSelectors = [
    ...(isDcinside ? [real('a[href*="board/view"]'), real(".sch_result a[href]")] : []),
    ...(isNaverKin ? [real('a[href*="qna/detail.naver"]'), real('a[href*="kin.naver.com/qna"]'), real(".basic1 a[href]")] : []),
    ...(isReddit ? [real('a[href*="/comments/"]'), real("shreddit-post a[href]")] : []),
    ...(isQuora ? [real('a[href*="/profile/"]'), real('a[href*="/answer/"]'), real('[role="main"] a[href]')] : []),
    ...(isStackOverflow ? [real("a.question-hyperlink"), real('a[href*="/questions/"]')] : [])
  ];
  const communityBlockedSignals = [
    "login required",
    "log in to continue",
    "sign up or log in",
    "join to view",
    "private community",
    "private subreddit",
    "this community is private",
    "restricted community",
    "deleted by",
    ...SECURITY_CHALLENGE_SIGNALS,
    "\uB85C\uADF8\uC778 \uD6C4",
    "\uB85C\uADF8\uC778\uC774 \uD544\uC694",
    "\uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4",
    "\uC811\uADFC \uAD8C\uD55C",
    "\uC0AD\uC81C\uB41C \uAE00",
    "\uBE44\uACF5\uAC1C"
  ];
  const reviewBlockedSignals = isReviewPortal
    ? ["verify you are human", "are you a human", "please enable cookies", "enable location services", "access denied", "temporarily unavailable", "unusual traffic", "captcha", "CAPTCHA", "sign in to continue", "log in to continue", "open in app", ...SECURITY_CHALLENGE_SIGNALS]
    : [];
  const portalBlockedSignals = ["paywall", "subscriber only", "not available", "unavailable", "unusual traffic", "not a robot", "automated queries", "captcha", "\uAD6C\uB3C5 \uD6C4", "\uAD6C\uB3C5\uC790 \uC804\uC6A9", "\uD398\uC774\uC9C0\uAC00 \uC5C6\uC5B4\uC694", ...communityBlockedSignals, ...reviewBlockedSignals];
  return [
    candidate("query-state", "fill", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [
        fixture("#naver-news-query"),
        fixture("#daum-news-query"),
        ...googleNewsQuerySelectors,
        ...yahooNewsQuerySelectors,
        ...reutersQuerySelectors,
        ...communityQueryFixtures,
        ...reviewQueryFixtures,
        ...scholarQuerySelectors,
        ...reviewQuerySelectors,
        ...(isReddit ? [real("faceplate-search-input input"), real('input[name="q"]')] : []),
        ...(isQuora ? [real('input[placeholder*="Search"]'), real('input[type="text"]')] : []),
        ...(isStackOverflow ? [real('#search input[name="q"]'), real('input[name="q"]')] : []),
        real('input[name="query"]'),
        real('input[name="keyword"]'),
        real('input[name="search_keyword"]'),
        real('input[name="q"]'),
        real('input[type="search"]')
      ],
      expectedTextSignals: ["query", "news", "reviews", "rating", "restaurants", "hotels", "\uB274\uC2A4", "\uAC80\uC0C9"],
      blockedSignals: portalBlockedSignals,
      riskNotes: ["Record visible query/topic state before citing headline rankings."]
    }),
    candidate("news-section", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [
        fixture("#naver-news-section"),
        fixture("#daum-news-section"),
        ...googleNewsSectionSelectors,
        ...yahooNewsSectionSelectors,
        ...reutersSectionSelectors,
        ...communitySectionFixtures,
        ...reviewSectionFixtures,
        ...scholarSectionSelectors,
        ...reviewSectionSelectors,
        ...(isReddit ? [real('a[href*="/r/"]'), real('[aria-label*="Subreddit"]')] : []),
        ...(isQuora ? [real('a[href*="/topic/"]'), real('[role="tab"]')] : []),
        ...(isStackOverflow ? [real(".s-navigation a"), real('[data-value="Newest"]')] : []),
        real("nav a"),
        real('[role="tab"]')
      ],
      scopes: [
        fixture("#news-section-state"),
        fixture("#news-module"),
        ...communityModuleFixtures,
        ...communityDestinationFixtures,
        ...reviewModuleFixtures,
        ...reviewSectionFixtures,
        ...googleNewsModuleSelectors,
        ...yahooNewsModuleSelectors,
        ...reutersModuleSelectors,
        ...scholarModuleSelectors,
        ...reviewArticleSelectors,
        real("main"),
        real('[role="main"]')
      ],
      expectedTextSignals: ["section", "society", "politics", "forum", "thread", "category", "restaurant", "hotel", "attraction", "\uC0AC\uD68C", "\uC815\uCE58", "\uC9C8\uBB38"],
      blockedSignals: portalBlockedSignals,
      riskNotes: ["Section switches alter headline or thread membership; cite the active section with the module."]
    }),
    candidate("visible-filters", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [
        fixture("#naver-news-recent"),
        fixture("#daum-news-recent"),
        ...googleNewsFilterSelectors,
        ...yahooNewsFilterSelectors,
        ...reutersFilterSelectors,
        ...communityFilterFixtures,
        ...reviewFilterFixtures,
        ...scholarSectionSelectors,
        ...reviewFilterSelectors,
        ...(isReddit ? [real('a[href*="sort="]'), real('button[aria-label*="Sort"]')] : []),
        ...(isQuora ? [real('a[href*="time"]'), real('button[aria-label*="Sort"]')] : []),
        ...(isStackOverflow ? [real('[data-value="Newest"]'), real('[data-value="Votes"]'), real(".s-navigation a")] : []),
        real("button"),
        real("a")
      ],
      scopes: [
        fixture("#news-filter-state"),
        fixture("#news-module"),
        ...communityModuleFixtures,
        ...communityDestinationFixtures,
        ...reviewModuleFixtures,
        ...reviewFilterFixtures,
        ...googleNewsModuleSelectors,
        ...yahooNewsModuleSelectors,
        ...reutersModuleSelectors,
        ...scholarModuleSelectors,
        ...reviewArticleSelectors,
        real("main")
      ],
      expectedTextSignals: ["recent", "latest", "sort", "rating", "price", "open now", "traveler rating", "\uCD5C\uC2E0", "\uC815\uB82C", "\uC815\uD655\uB3C4"],
      blockedSignals: portalBlockedSignals,
      riskNotes: ["Recency and source filters change ranking and must be visible in evidence."]
    }),
    candidate("result-pagination", "click", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [
        fixture("#naver-news-more"),
        fixture("#daum-news-more"),
        fixture("#yahoo-news-more", "Fixture Yahoo News more-results control."),
        fixture("#reuters-more", "Fixture Reuters more-results control."),
        ...communityPaginationFixtures,
        ...reviewPaginationFixtures,
        ...reviewPaginationSelectors,
        real('a[aria-label*="Next"]'),
        real('a[aria-label*="\uB2E4\uC74C"]'),
        real("button")
      ],
      scopes: [fixture("#news-module"), ...communityModuleFixtures, ...communityDestinationFixtures, ...reviewModuleFixtures, ...googleNewsModuleSelectors, ...yahooNewsModuleSelectors, ...reutersModuleSelectors, ...scholarModuleSelectors, ...reviewArticleSelectors, real("main"), real('[role="main"]')],
      expectedTextSignals: ["more", "page", "\uB354\uBCF4\uAE30", "\uB2E4\uC74C"],
      blockedSignals: portalBlockedSignals,
      riskNotes: ["Pagination must stay bounded; do not crawl unbounded news or community feeds."]
    }),
    candidate("article-capture", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [
        fixture("#news-module"),
        fixture("#headline-card"),
        ...communityModuleFixtures,
        ...reviewModuleFixtures,
        real("#dnsColl"),
        real("#main_pack"),
        real(".main_pack"),
        real(".news_wrap"),
        ...googleNewsModuleSelectors,
        ...yahooNewsModuleSelectors,
        ...reutersModuleSelectors,
        ...scholarModuleSelectors,
        ...communityArticleSelectors,
        ...reviewArticleSelectors,
        real("article"),
        real("main")
      ],
      scopes: [
        fixture("#news-module"),
        fixture("#headline-card"),
        fixture("#publisher-meta"),
        ...communityModuleFixtures,
        ...communityDestinationFixtures,
        ...reviewModuleFixtures,
        real("#dnsColl"),
        real("#dnsColl .c-list-basic"),
        real("#main_pack"),
        real(".main_pack"),
        real(".news_wrap"),
        ...googleNewsModuleSelectors,
        ...yahooNewsModuleSelectors,
        ...reutersModuleSelectors,
        ...scholarModuleSelectors,
        ...communityArticleSelectors,
        ...reviewArticleSelectors,
        real("article"),
        real("main")
      ],
      expectedTextSignals: ["headline", "publisher", "timestamp", "thread", "question", "answer", "comment", "accepted", "rating", "review", "reviews", "price", "address", "hours", "\uAE30\uC0AC", "\uC5B8\uB860\uC0AC", "\uC9C8\uBB38", "\uB2F5\uBCC0", "\uB313\uAE00"],
      blockedSignals: portalBlockedSignals,
      riskNotes: [
        "Headline/thread/review cards prove portal display only; destination article or listing claims need follow-up evidence.",
        "Destination thread scopes preserve browser-visible question, answer, and comment context without posting, joining, or bypassing access controls.",
        "Review and rating surfaces are volatile and may be personalized by location, locale, time, or profile state."
      ]
    }),
    candidate("destination-followup", "extract_destinations", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [
        fixture("#news-module"),
        fixture("#headline-card"),
        fixture("#news-link"),
        ...communityModuleFixtures,
        ...communityFollowupFixtures,
        ...reviewFollowupFixtures,
        ...googleNewsFollowupSelectors,
        real("#dnsColl"),
        real("#main_pack"),
        real(".news_wrap"),
        real('#dnsColl .item-title a[href*="v.daum.net/v/"]'),
        real('#dnsColl a[href*="v.daum.net/v/"]'),
        real('a[href*="n.news.naver.com"]'),
        real('a[href*="news.naver.com/main/read"]'),
        real(".news_wrap a[href]"),
        ...yahooNewsFollowupSelectors,
        ...reutersFollowupSelectors,
        ...scholarFollowupSelectors,
        ...communityFollowupSelectors,
        ...reviewDestinationSelectors,
        real("article a[href]")
      ],
      expectedTextSignals: ["http", "https", "review", "rating", "restaurant", "hotel", "business", "menu", "website"],
      blockedSignals: portalBlockedSignals,
      riskNotes: [
        "Extract publisher/article/thread/listing destinations without navigating the parent portal page.",
        "Destination triage must keep headline/thread/review-card evidence separate from child destination evidence.",
        "Review/local destination extraction may include listing, official-site redirect, menu, tourism, or user-review links; child evidence must remain bounded and cited separately."
      ]
    }),
    candidate("obstruction-check", "capture", fixtureVerified ? "fixture_verified" : "candidate_unverified", {
      selectors: [fixture("#news-obstruction-state"), ...communityObstructionFixtures, ...communityDestinationObstructionFixtures, ...reviewObstructionFixtures, ...reviewObstructionSelectors, real('[role="dialog"]'), real("body")],
      scopes: [fixture("#news-obstruction-state"), ...communityObstructionFixtures, ...communityDestinationObstructionFixtures, ...reviewObstructionFixtures, ...reviewObstructionSelectors, real('[role="dialog"]'), real("body")],
      expectedTextSignals: ["paywall", "login", "unavailable", "human", "captcha", "cookies", "\uB85C\uADF8\uC778", "\uAD6C\uB3C5"],
      blockedSignals: portalBlockedSignals,
      riskNotes: ["Record paywall/login/unavailable or community access states; never bypass them."]
    })
  ];
}

function knowledgeDatabaseRecipeCandidates(platform: SourceNavigationPlan["platform"]): SourceNavigationRecipeActionCandidate[] {
  const isWikipedia = platform === "wikipedia";
  const isNamuwiki = platform === "namuwiki";
  const isPubMed = platform === "pubmed";
  const isDataGoKr = platform === "data_go_kr";
  const isKosis = platform === "kosis";
  const isRiss = platform === "riss";
  const isKipris = platform === "kipris";
  const knowledgeBlockedSignals = ["login required", "access denied", "permission denied", "subscriber only", "institutional access", "forbidden", ...SECURITY_CHALLENGE_SIGNALS, "\uB85C\uADF8\uC778", "\uC811\uADFC \uAD8C\uD55C", "\uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4"];
  const articleSelectors = [
    ...(isWikipedia
      ? [
          real("#firstHeading", "Wikipedia article title."),
          real("#content", "Wikipedia article shell."),
          real("#mw-content-text", "Wikipedia article body."),
          real(".mw-parser-output", "Wikipedia parsed article content."),
          real(".infobox", "Wikipedia infobox structured summary."),
          real(".reflist", "Wikipedia references list."),
          real("ol.references", "Wikipedia citation list.")
        ]
      : []),
    ...(isNamuwiki
      ? [
          real("#app", "Namuwiki app shell."),
          real("article", "Namuwiki article body when exposed semantically."),
          real(".wiki-heading-content", "Namuwiki section heading content."),
          real(".wiki-paragraph", "Namuwiki paragraph content."),
          real('[class*="wiki-table"]', "Namuwiki table content."),
          real('[class*="wiki-link"]', "Namuwiki internal/external link surfaces.")
        ]
      : []),
    ...(isPubMed
      ? [
          real("#search-results", "PubMed search results container."),
          real(".docsum-content", "PubMed result summary content."),
          real(".full-docsum", "PubMed full document summary."),
          real("article.full-docsum", "PubMed article result card."),
          real("#enc-abstract", "PubMed abstract panel."),
          real(".abstract", "PubMed abstract text."),
          real(".cit", "PubMed citation metadata."),
          real("#article-details", "PubMed article details region.")
        ]
      : []),
    ...(isDataGoKr
      ? [
          real("#contents", "data.go.kr contents region."),
          real("#content", "data.go.kr content region."),
          real(".result-list", "data.go.kr dataset result list."),
          real(".data-list", "data.go.kr dataset list."),
          real(".dataset-list", "data.go.kr dataset list."),
          real(".list-data", "data.go.kr list data region."),
          real(".detail-info", "data.go.kr dataset detail information.")
        ]
      : []),
    ...(isKosis
      ? [real("#contents", "KOSIS contents region."), real("#content", "KOSIS content region."), real(".search-result", "KOSIS search result region."), real(".tbl-list", "KOSIS table/list region."), real(".table", "KOSIS table region."), real('[class*="stat"]', "KOSIS statistic-related content region.")]
      : []),
    ...(isRiss
      ? [real("#divContent", "RISS content region."), real("#content", "RISS content region."), real(".srchResultListW", "RISS search result list."), real(".cont", "RISS result content region."), real(".metadata", "RISS metadata region when visible."), real(".recordDetail", "RISS record detail region.")]
      : []),
    ...(isKipris ? [real("#content", "KIPRIS content region."), real("#contents", "KIPRIS contents region."), real(".search-result", "KIPRIS search result region."), real(".result-list", "KIPRIS result list."), real(".patentView", "KIPRIS patent detail view."), real(".detail", "KIPRIS detail metadata region.")] : []),
    real("main", "Generic knowledge database main content fallback."),
    real("article", "Generic article/record content fallback.")
  ];
  const destinationSelectors = [
    ...(isWikipedia
      ? [
          real("#mw-content-text a[href]", "Wikipedia body links."),
          real(".mw-parser-output a[href]", "Wikipedia parsed-content links."),
          real("ol.references a[href]", "Wikipedia citation links."),
          real(".reflist a[href]", "Wikipedia reference links."),
          real('a[href*="Special:BookSources"]', "Wikipedia book-source links.")
        ]
      : []),
    ...(isNamuwiki ? [real("article a[href]", "Namuwiki article links."), real(".wiki-paragraph a[href]", "Namuwiki paragraph links."), real('[class*="wiki-link"] a[href]', "Namuwiki wiki-link anchors."), real('a[href^="http"]', "Namuwiki visible external links.")] : []),
    ...(isPubMed
      ? [
          real(".docsum-title[href]", "PubMed result detail links."),
          real(".docsum-content a[href]", "PubMed result-summary links."),
          real("#article-details a[href]", "PubMed article detail links."),
          real(".full-view a[href]", "PubMed full-view links."),
          real('a[href*="pmc.ncbi.nlm.nih.gov"]', "PubMed Central full-text links."),
          real('a[href*="doi.org"]', "DOI destination links.")
        ]
      : []),
    ...(isDataGoKr
      ? [
          real("#contents a[href]", "data.go.kr contents links."),
          real(".result-list a[href]", "data.go.kr dataset result links."),
          real(".data-list a[href]", "data.go.kr dataset links."),
          real('a[href*="selectDataSetList"]', "data.go.kr dataset list links."),
          real('a[href*="selectDataSetDetail"]', "data.go.kr dataset detail links.")
        ]
      : []),
    ...(isKosis
      ? [real("#contents a[href]", "KOSIS contents links."), real(".search-result a[href]", "KOSIS search result links."), real(".tbl-list a[href]", "KOSIS table/list links."), real('a[href*="statisticsList"]', "KOSIS statistics list links."), real('a[href*="statHtml"]', "KOSIS statistic table links.")]
      : []),
    ...(isRiss ? [real("#divContent a[href]", "RISS content links."), real(".srchResultListW a[href]", "RISS result list links."), real(".cont a[href]", "RISS result content links."), real('a[href*="DetailView"]', "RISS record detail links."), real('a[href*="search/Search.do"]', "RISS search links.")] : []),
    ...(isKipris ? [real("#content a[href]", "KIPRIS content links."), real(".search-result a[href]", "KIPRIS search result links."), real(".result-list a[href]", "KIPRIS result list links."), real('a[href*="khome/search"]', "KIPRIS search links."), real('a[href*="patent"]', "KIPRIS patent detail links.")] : []),
    real("main a[href]", "Generic main-content knowledge database links."),
    real("article a[href]", "Generic article/record links.")
  ];
  return [
    candidate("page-capture", "capture", "fixture_verified", {
      selectors: articleSelectors,
      scopes: articleSelectors,
      expectedTextSignals: ["title", "abstract", "record", "dataset", "citation", "references", "\uCD9C\uCC98", "\uC778\uC6A9"],
      blockedSignals: knowledgeBlockedSignals,
      riskNotes: ["Knowledge/database pages are read-only evidence surfaces; capture record fields, update date, citations, and visible tables before deriving claims.", "Do not click edit, login, download-restricted, paid full text, or institutional-access controls."]
    }),
    candidate("bounded-scroll", "scroll", "fixture_verified", {
      selectors: [],
      scopes: articleSelectors,
      expectedTextSignals: ["references", "citations", "dataset", "abstract", "table"],
      blockedSignals: knowledgeBlockedSignals,
      riskNotes: ["Keep long article, citation, and table scrolling bounded and timestamp each captured state."]
    }),
    candidate("destination-followup", "extract_destinations", "fixture_verified", {
      selectors: destinationSelectors,
      expectedTextSignals: ["http", "https", "doi", "citation", "source", "dataset", "record"],
      blockedSignals: knowledgeBlockedSignals,
      riskNotes: [
        "Knowledge/database destination extraction reads visible citation, source, dataset, DOI, full-text, and related-record links without mutating the source page.",
        "Destination claims still require bounded child evidence and final citation gates; a database listing is not the same as a cited primary document."
      ]
    })
  ];
}

function genericRecipeCandidates(): SourceNavigationRecipeActionCandidate[] {
  return [
    candidate("page-capture", "capture", "fixture_verified", {
      selectors: [real("body")],
      scopes: [real("body"), real("main"), real("article")],
      expectedTextSignals: ["visible text"],
      riskNotes: ["Start with visible evidence before any source-specific assumptions."]
    }),
    candidate("bounded-scroll", "scroll", "fixture_verified", {
      selectors: [],
      expectedTextSignals: ["more content"],
      riskNotes: ["Keep scrolling bounded and timestamp each capture state."]
    }),
    candidate("destination-followup", "extract_destinations", "fixture_verified", {
      selectors: [real("main"), real("article"), real("body"), real("a[href]")],
      expectedTextSignals: ["http", "https"],
      riskNotes: ["Extract destinations only when final claims depend on destination content.", "Keep extracted child runs bounded by top-K and depth limits."]
    })
  ];
}

function isKnowledgeDatabasePlatform(platform: SourceNavigationPlan["platform"]): boolean {
  return platform === "wikipedia" || platform === "namuwiki" || platform === "pubmed" || platform === "data_go_kr" || platform === "kosis" || platform === "riss" || platform === "kipris";
}

function candidate(
  actionKey: string,
  operation: SourceNavigationExecutableOperation,
  verificationStatus: SourceNavigationRecipeVerificationStatus,
  input: {
    selectors?: SourceNavigationSelectorCandidate[];
    scopes?: SourceNavigationSelectorCandidate[];
    expectedTextSignals?: string[];
    blockedSignals?: string[];
    riskNotes?: string[];
    clientStateExtraction?: SourceNavigationRecipeClientStateExtraction | undefined;
  }
): SourceNavigationRecipeActionCandidate {
  return {
    actionKey,
    operation,
    verificationStatus,
    selectorCandidates: uniqueCandidates(input.selectors ?? []),
    captureScopeCandidates: uniqueCandidates(input.scopes ?? []),
    expectedTextSignals: uniqueStrings(input.expectedTextSignals ?? []),
    blockedSignals: uniqueStrings(input.blockedSignals ?? []),
    riskNotes: uniqueStrings(["Manual opt-in only; candidates are not executed by evidence-run unless explicitly supplied as recipes.", ...(input.riskNotes ?? [])]),
    ...(input.clientStateExtraction === undefined ? {} : { clientStateExtraction: input.clientStateExtraction })
  };
}

function fixture(selector: string, note = "Covered by local safe-executor fixture."): SourceNavigationSelectorCandidate {
  return { selector, target: "primary", source: "local_fixture", note };
}

function real(selector: string, note = "Real-site selector candidate; must be calibrated before use."): SourceNavigationSelectorCandidate {
  return { selector, target: "fallback", source: "real_site_candidate", note };
}

function uniqueCandidates(candidates: SourceNavigationSelectorCandidate[]): SourceNavigationSelectorCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.selector}\0${candidate.target}\0${candidate.source}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function hasPlannedAction(plan: SourceNavigationPlan, actionKey: string): boolean {
  return plan.plannedActions.some((action) => action.key === actionKey);
}

function summarizeVerification(actions: SourceNavigationRecipeActionCandidate[]): SourceNavigationRecipeVerificationStatus {
  if (actions.length === 0) {
    return "not_available";
  }
  if (actions.every((action) => action.verificationStatus === "fixture_verified")) {
    return "fixture_verified";
  }
  return "candidate_unverified";
}
