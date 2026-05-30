import type { EvidenceKind } from "./schemas.js";
import type { SourceFamily, SourcePlatform, SourceStrategy } from "./source-strategy.js";

export type SourceNavigationMode = "plan_only" | "safe_execute";

export type SourceNavigationActionKind =
  | "set_query"
  | "open_vertical_tab"
  | "apply_filter"
  | "apply_sort"
  | "scroll_results"
  | "paginate"
  | "select_result"
  | "select_map_place"
  | "capture_page_state"
  | "capture_map_viewport"
  | "open_media_gallery"
  | "sample_video_frames"
  | "run_ocr"
  | "follow_destination"
  | "classify_obstruction";

export type SourceNavigationActionStatus = "planned" | "conditional";

export type SourceExtractionTargetKind =
  | "query_state"
  | "serp"
  | "result_ranking"
  | "visible_filters"
  | "news_module"
  | "publisher_context"
  | "map_viewport"
  | "place_panel"
  | "article_body"
  | "comments"
  | "media_gallery"
  | "offer_card"
  | "product_card"
  | "price_terms"
  | "policy_text"
  | "seller_context"
  | "shipping_terms"
  | "visible_metadata"
  | "frame"
  | "transcript"
  | "ocr_text"
  | "structured_page_data"
  | "obstruction";

export interface SourceQueryState {
  sourceUrl: string;
  canonicalHost: string;
  queryParams: Record<string, string>;
  requiredFields: string[];
  localeSensitive: boolean;
  profileSensitive: boolean;
  queryText?: string;
}

export interface SourceNavigationAction {
  key: string;
  kind: SourceNavigationActionKind;
  status: SourceNavigationActionStatus;
  label: string;
  reason: string;
  requiresCapture: boolean;
  evidenceKind?: EvidenceKind;
}

export interface SourceExtractionTarget {
  key: string;
  kind: SourceExtractionTargetKind;
  evidenceKind: EvidenceKind;
  required: boolean;
  note: string;
}

export interface SourceUnsupportedAction {
  key: string;
  action: string;
  reason: string;
}

export interface SourceNavigationPlan {
  schemaVersion: "1.0";
  inputUrl: string;
  canonicalHost: string;
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  mode: SourceNavigationMode;
  queryState: SourceQueryState;
  plannedActions: SourceNavigationAction[];
  extractionTargets: SourceExtractionTarget[];
  unsupportedActions: SourceUnsupportedAction[];
  warnings: string[];
}

export interface DescribeSourceNavigationPlanInput {
  sourceStrategy: SourceStrategy;
  mode?: SourceNavigationMode | undefined;
}

export function describeSourceNavigationPlan(input: DescribeSourceNavigationPlanInput): SourceNavigationPlan {
  const url = new URL(input.sourceStrategy.inputUrl);
  const queryState = buildQueryState(url, input.sourceStrategy);
  const template = navigationTemplateFor(input.sourceStrategy.sourceFamily, input.sourceStrategy.platform);

  return {
    schemaVersion: "1.0",
    inputUrl: url.toString(),
    canonicalHost: input.sourceStrategy.canonicalHost,
    platform: input.sourceStrategy.platform,
    sourceFamily: input.sourceStrategy.sourceFamily,
    mode: input.mode ?? "plan_only",
    queryState,
    plannedActions: template.plannedActions,
    extractionTargets: template.extractionTargets,
    unsupportedActions: template.unsupportedActions,
    warnings: [...input.sourceStrategy.warnings, ...template.warnings]
  };
}

function buildQueryState(url: URL, sourceStrategy: SourceStrategy): SourceQueryState {
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    queryParams[key] = value;
  });
  const queryText = firstQueryText(url);
  return {
    sourceUrl: url.toString(),
    canonicalHost: sourceStrategy.canonicalHost,
    queryParams,
    requiredFields: requiredQueryFieldsFor(sourceStrategy.sourceFamily, sourceStrategy.platform),
    localeSensitive: sourceStrategy.sourceFamily === "search" || sourceStrategy.sourceFamily === "map" || sourceStrategy.sourceFamily === "travel_booking" || sourceStrategy.sourceFamily === "portal",
    profileSensitive: sourceStrategy.sourceFamily === "video_social" || sourceStrategy.sourceFamily === "travel_booking" || sourceStrategy.sourceFamily === "map",
    ...(queryText === undefined ? {} : { queryText })
  };
}

function firstQueryText(url: URL): string | undefined {
  for (const key of ["query", "q", "keyword", "search", "textQuery"]) {
    const value = url.searchParams.get(key);
    if (value !== null && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function requiredQueryFieldsFor(sourceFamily: SourceFamily, platform: SourcePlatform): string[] {
  if (sourceFamily === "travel_booking") {
    return ["dates", "guests", "rooms", "currency", "filters", "sort"];
  }
  if (sourceFamily === "commerce") {
    return ["query", "currency", "filters", "sort", "seller", "shipping_or_fee_visibility"];
  }
  if (sourceFamily === "map") {
    return ["query", "region_or_viewport", "zoom", "selected_place", "filters"];
  }
  if (sourceFamily === "search") {
    return ["query", "locale", "vertical_tab", "filters", "result_rank"];
  }
  if (sourceFamily === "video_social") {
    return ["content_url", "timestamp_targets", "visible_metadata", "obstruction_state"];
  }
  if (sourceFamily === "blog") {
    return ["article_url", "author_or_source", "published_time_if_visible", "permalink"];
  }
  if (sourceFamily === "portal") {
    return ["query_or_topic", "locale", "section_or_vertical", "publisher", "published_time_if_visible", "sort_or_recency"];
  }
  if (platform === "generic") {
    return ["source_url", "observed_page_shape", "claim_dependent_targets"];
  }
  return ["source_url", "claim_dependent_targets"];
}

function navigationTemplateFor(sourceFamily: SourceFamily, platform: SourcePlatform): Omit<SourceNavigationPlan, "schemaVersion" | "inputUrl" | "canonicalHost" | "platform" | "sourceFamily" | "mode" | "queryState"> {
  if (sourceFamily === "search") {
    return searchTemplate(platform);
  }
  if (sourceFamily === "map") {
    return mapTemplate(platform);
  }
  if (sourceFamily === "blog") {
    return blogTemplate(platform);
  }
  if (sourceFamily === "travel_booking") {
    return travelTemplate(platform);
  }
  if (sourceFamily === "commerce") {
    return commerceTemplate(platform);
  }
  if (sourceFamily === "video_social") {
    return videoSocialTemplate(platform);
  }
  if (sourceFamily === "portal") {
    return portalTemplate(platform);
  }
  return genericTemplate(platform);
}

function searchTemplate(platform: SourcePlatform) {
  return {
    plannedActions: [
      action("query-state", "set_query", "Record search query and locale state.", "The search page display is only meaningful with its query state.", true, "metadata"),
      action("vertical-tab", "open_vertical_tab", "Record the active search vertical or tab.", "Naver and Google results change materially across web, blog, cafe, image, map, and news-like tabs.", true, "page_screenshot"),
      action("visible-filters", "apply_filter", "Record visible filters without assuming hidden defaults.", "Filters affect ranking and must be cited with the SERP screenshot.", true, "page_screenshot", "conditional"),
      action("visible-sort", "apply_sort", "Record sort order when the platform exposes it.", "Date, relevance, review-count, or price ordering changes the claim surface.", true, "page_screenshot", "conditional"),
      action("result-pagination", "paginate", "Capture a bounded next-page or more-results state when claims depend on it.", "Pagination changes result membership and ranking; it must be capped and cited separately.", true, "page_screenshot", "conditional"),
      action("result-selection", "select_result", "Mark result selection as a separate evidence dependency.", "Search snippets prove portal display, not destination truth.", true, "page_screenshot", "conditional"),
      action("destination-followup", "follow_destination", "Run destination evidence separately when claims depend on destination content.", "Final claims about the result page need their own artifacts.", true, "metadata", "conditional")
    ],
    extractionTargets: [
      target("query-state", "query_state", "metadata", true, "Search query, locale, timestamp, profile/headed state, and filters."),
      target("serp-snapshot", "serp", "page_screenshot", true, "Browser-visible result page state."),
      target("result-ranking", "result_ranking", "page_text", true, "Visible result order, snippets, and module labels."),
      target("visible-filters", "visible_filters", "page_screenshot", false, "Visible tab, filter, sort, and sponsored/organic markers.")
    ],
    unsupportedActions: [],
    warnings: [`Search snippets from ${platform} are evidence of what the portal displayed, not proof of destination content.`]
  };
}

function mapTemplate(platform: SourcePlatform) {
  return {
    plannedActions: [
      action("query-state", "set_query", "Record map query, region, viewport, and locale state.", "Map results are viewport-, locale-, and profile-sensitive.", true, "metadata"),
      action("map-filters", "apply_filter", "Record visible category or place filters.", "Filters and categories affect visible pins and list ordering.", true, "page_screenshot", "conditional"),
      action("map-viewport", "capture_map_viewport", "Capture the visible map/list viewport.", "Pins, labels, and ordering must be tied to the rendered viewport.", true, "page_screenshot"),
      action("selected-place", "select_map_place", "Capture selected place/listing panel when present.", "Place claims require panel evidence, not only a map pin.", true, "page_screenshot", "conditional"),
      action("map-ocr", "run_ocr", "Run OCR over image-rendered map labels and badges when enabled.", "Map text is often rendered visually and may not appear in DOM text.", true, "ocr_text", "conditional"),
      action("destination-followup", "follow_destination", "Resolve visible place, website, menu, or review destinations as separate child evidence.", "Claims about a place website, menu, review page, or external place detail need destination artifacts in addition to the map panel.", true, "metadata", "conditional")
    ],
    extractionTargets: [
      target("query-state", "query_state", "metadata", true, "Query, locale, zoom, viewport, filters, profile/headed state."),
      target("map-viewport", "map_viewport", "page_screenshot", true, "Visible map/list viewport, pins, and labels."),
      target("place-panel", "place_panel", "page_screenshot", false, "Selected place panel, address, hours, rating, and visible review snippets."),
      target("map-ocr", "ocr_text", "ocr_text", false, "OCR text derived from map screenshots."),
      target("place-destination-links", "structured_page_data", "metadata", false, "Visible website, menu, review, booking, or place-detail links resolved as bounded child evidence only when followed.")
    ],
    unsupportedActions: [],
    warnings: [`${platform} rankings, labels, and place panels can change with viewport, login state, locale, and time.`]
  };
}

function blogTemplate(platform: SourcePlatform) {
  return {
    plannedActions: [
      action("article-capture", "capture_page_state", "Capture article or thread page state.", "Article claims need visible body evidence, not only a search snippet.", true, "page_text"),
      action("media-gallery", "open_media_gallery", "Treat embedded images/media as separate evidence targets.", "Image text and embedded media can carry claim-critical evidence.", true, "media", "conditional"),
      action("embedded-text-ocr", "run_ocr", "Run OCR over embedded text images when enabled.", "Blog and cafe posts often include text in images.", true, "ocr_text", "conditional"),
      action("destination-followup", "follow_destination", "Resolve visible source, related article, profile, or official links as separate child evidence.", "Claims about linked sources or related destinations need child artifacts in addition to the article body.", true, "metadata", "conditional"),
      action("obstruction-check", "classify_obstruction", "Classify membership, login, or access walls.", "Private or member-only content must be recorded as inaccessible, not summarized.", true, "browser_obstruction", "conditional")
    ],
    extractionTargets: [
      target("article-body", "article_body", "page_text", true, "Title, author/date if visible, permalink, and body text."),
      target("comments", "comments", "page_text", false, "Visible comments only when claims depend on them."),
      target("media-gallery", "media_gallery", "media", false, "Accessible image-like media and captions."),
      target("embedded-ocr", "ocr_text", "ocr_text", false, "OCR over text embedded in screenshots or images."),
      target("article-destination-links", "structured_page_data", "metadata", false, "Visible source, related article, profile, official, or external links resolved as bounded child evidence only when followed.")
    ],
    unsupportedActions: [unsupported("member-only-bypass", "member-only content bypass", "Do not bypass Cafe or blog membership/login walls.")],
    warnings: [`${platform} comments and embedded media should be cited separately when a claim depends on them.`]
  };
}

function travelTemplate(platform: SourcePlatform) {
  return {
    plannedActions: [
      action("query-state", "set_query", "Record dates, guests, rooms, currency, and region.", "Travel offers are not meaningful without exact query state.", true, "metadata"),
      action("visible-filters", "apply_filter", "Record visible filters such as area, price, rating, and amenities.", "Filters materially change available offers.", true, "page_screenshot", "conditional"),
      action("visible-sort", "apply_sort", "Record sort mode such as price, rating, distance, or recommendation.", "Offer order affects comparisons and final claims.", true, "page_screenshot", "conditional"),
      action("result-scroll", "scroll_results", "Capture bounded list state when results are lazy-loaded.", "Infinite lists must be capped and timestamped.", true, "page_screenshot", "conditional"),
      action("result-pagination", "paginate", "Capture a bounded next-page or more-results state when offers are paginated.", "Paginated offers must not be treated as one unbounded list.", true, "page_screenshot", "conditional"),
      action("offer-card", "capture_page_state", "Capture visible offer cards without opening booking or payment flows.", "Travel offer claims require visible card evidence with query and timestamp context.", true, "page_screenshot"),
      action("offer-detail", "select_result", "Capture detail/rate terms when a claim depends on an offer.", "List cards rarely contain all fees and cancellation terms.", true, "page_screenshot", "conditional"),
      action("price-ocr", "run_ocr", "Run OCR over image-rendered price cards and badges when enabled.", "Prices and badges may be rendered visually.", true, "ocr_text", "conditional")
    ],
    extractionTargets: [
      target("query-state", "query_state", "metadata", true, "Dates, guests, rooms, currency, region, sort, and filters."),
      target("offer-card", "offer_card", "page_screenshot", true, "Visible list card with price, availability, and timestamp."),
      target("price-terms", "price_terms", "ocr_text", false, "OCR-derived visible price or fee text."),
      target("policy-text", "policy_text", "page_text", false, "Cancellation, tax/fee, and rate policy text.")
    ],
    unsupportedActions: [
      unsupported("booking", "booking or reservation", "Do not book, reserve, hold inventory, or change account state."),
      unsupported("payment", "payment or checkout", "Do not enter payment flows or submit purchase actions."),
      unsupported("account-change", "account-changing action", "Do not modify profile, loyalty, or account settings.")
    ],
    warnings: [`${platform} prices and availability are volatile; cite timestamped screenshots and visible query parameters.`]
  };
}

function commerceTemplate(platform: SourcePlatform) {
  return {
    plannedActions: [
      action("query-state", "set_query", "Record product query, currency, locale, and result context.", "Marketplace results are not meaningful without exact query state.", true, "metadata"),
      action("visible-filters", "apply_filter", "Record visible filters such as brand, seller, shipping, rating, price, and delivery speed.", "Filters materially change visible product cards and price comparisons.", true, "page_screenshot", "conditional"),
      action("visible-sort", "apply_sort", "Record sort mode such as relevance, price, sales rank, review count, or delivery speed.", "Sort order affects product comparisons and final claims.", true, "page_screenshot", "conditional"),
      action("result-scroll", "scroll_results", "Capture bounded lazy-loaded product list state when results depend on it.", "Infinite marketplace lists must be capped and timestamped.", true, "page_screenshot", "conditional"),
      action("result-pagination", "paginate", "Capture a bounded next-page or more-results state when product cards are paginated.", "Paginated marketplace cards must not be treated as one unbounded list.", true, "page_screenshot", "conditional"),
      action("product-card", "select_result", "Capture visible product or offer cards.", "Product claims require visible card evidence with price, seller, shipping, and ranking context.", true, "page_screenshot"),
      action("seller-terms", "select_result", "Capture visible seller, shipping, fee, return, and coupon terms when claims depend on them.", "List cards can hide material seller or delivery terms.", true, "page_screenshot", "conditional"),
      action("price-ocr", "run_ocr", "Run OCR over image-rendered price, coupon, and shipping badges when enabled.", "Marketplace prices and badges may be rendered visually.", true, "ocr_text", "conditional"),
      action(
        "destination-followup",
        "follow_destination",
        "Resolve visible product-detail, review, seller, or brand destinations as separate child evidence.",
        "Claims about product details, seller pages, review pages, or marketplace destinations need child artifacts in addition to list-card evidence.",
        true,
        "metadata",
        "conditional"
      )
    ],
    extractionTargets: [
      target("query-state", "query_state", "metadata", true, "Query, locale, currency, filters, sort, seller, and shipping/fee visibility."),
      target("product-card", "product_card", "page_screenshot", true, "Visible product card with title, price, seller, rating, shipping, coupon, and timestamp."),
      target("seller-context", "seller_context", "page_text", false, "Visible seller, marketplace, fulfillment, rating, and review context."),
      target("shipping-terms", "shipping_terms", "page_text", false, "Visible delivery, fee, return, and coupon terms."),
      target("price-terms", "price_terms", "ocr_text", false, "OCR-derived visible price, coupon, or shipping text."),
      target("product-destination-links", "structured_page_data", "metadata", false, "Visible product-detail, review, seller, brand, or marketplace links resolved as bounded child evidence only when followed.")
    ],
    unsupportedActions: [
      unsupported("cart", "cart or wishlist action", "Do not add products to cart, wishlist, or saved lists."),
      unsupported("purchase", "purchase or checkout", "Do not buy, reserve, subscribe, or enter checkout/payment flows."),
      unsupported("account-change", "account-changing action", "Do not modify profile, address, membership, seller, or account settings.")
    ],
    warnings: [`${platform} product prices, availability, seller terms, shipping, coupons, and rankings are volatile; cite timestamped screenshots and visible query/filter parameters.`]
  };
}

function videoSocialTemplate(platform: SourcePlatform) {
  return {
    plannedActions: [
      action("obstruction-check", "classify_obstruction", "Classify login walls, app interstitials, bot blocks, age/region gates, and unavailable media.", "Obstructions must become evidence instead of hidden assumptions.", true, "browser_obstruction"),
      action("visible-metadata", "capture_page_state", "Capture visible title/caption/profile/channel/player state.", "Metadata claims must cite browser-visible or official API evidence.", true, "page_screenshot"),
      action(
        "destination-followup",
        "follow_destination",
        "Resolve visible profile, canonical post/video, external bio, or source links as separate child evidence.",
        "Claims about linked social profiles, external sites, or related media need destination artifacts in addition to visible metadata.",
        true,
        "metadata",
        "conditional"
      ),
      action("frame-sampling", "sample_video_frames", "Sample browser-visible frames for visual claims.", "Visual claims require timestamped frame screenshot artifacts.", true, "frame_screenshot", "conditional"),
      action("overlay-ocr", "run_ocr", "Run OCR over sampled frames for visible overlay text when enabled.", "Overlay text is a screenshot derivative and must cite OCR artifacts.", true, "ocr_text", "conditional")
    ],
    extractionTargets: [
      target("visible-metadata", "visible_metadata", "page_screenshot", true, "Title, caption/description, channel/profile, player/post state."),
      target("social-destination-links", "structured_page_data", "metadata", false, "Visible profile, canonical media, external bio, source, or related media links resolved as bounded child evidence only when followed."),
      target("frame-screenshots", "frame", "frame_screenshot", false, "Timestamped browser-visible frame screenshots."),
      target("transcript-cues", "transcript", "transcript_cue", false, "Accessible captions/transcripts only when preserved."),
      target("overlay-ocr", "ocr_text", "ocr_text", false, "OCR text extracted from sampled frame screenshots."),
      target("obstruction", "obstruction", "browser_obstruction", false, "Login, app-open, bot, region, age, or unavailable-media obstruction.")
    ],
    unsupportedActions: [
      unsupported("raw-stream-download", "raw media stream download", "Do not download or bypass raw platform video/audio streams."),
      unsupported("gate-bypass", "login, app, age, region, CAPTCHA, or bot-gate bypass", "Record gates as browser-visible obstructions instead of bypassing them."),
      unsupported("social-write", "like, follow, comment, post, message, or share", "Evidence runs must not perform account-changing social actions.")
    ],
    warnings: [`${platform} visual claims need frame screenshots; full video/audio understanding remains unverified without transcript or audio artifacts.`]
  };
}

function portalTemplate(platform: SourcePlatform) {
  return {
    plannedActions: [
      action("query-state", "set_query", "Record portal query, topic, locale, and section state.", "News and portal modules are only meaningful with their visible query or topic context.", true, "metadata"),
      action("news-section", "open_vertical_tab", "Record the visible news section or vertical.", "News modules vary across politics, society, economy, entertainment, local, and ranking sections.", true, "page_screenshot", "conditional"),
      action("visible-filters", "apply_filter", "Record visible recency, source, and sort filters.", "Filters and sort order affect visible headline ranking and must be cited.", true, "page_screenshot", "conditional"),
      action("result-pagination", "paginate", "Capture a bounded more-results or next-page state when headline claims depend on it.", "News feeds must stay bounded and timestamped.", true, "page_screenshot", "conditional"),
      action("article-capture", "capture_page_state", "Capture visible headline cards and publisher metadata.", "Portal headline modules prove what the portal displayed, not the full article content.", true, "page_screenshot"),
      action("destination-followup", "follow_destination", "Resolve a publisher or article destination for separate evidence when claims depend on the article.", "Claims about the article need destination-page artifacts, not only portal snippets.", true, "metadata", "conditional"),
      action("obstruction-check", "classify_obstruction", "Classify paywall, login, age, region, or unavailable article states.", "Obstructions must be recorded instead of bypassed.", true, "browser_obstruction", "conditional")
    ],
    extractionTargets: [
      target("query-state", "query_state", "metadata", true, "Query/topic, locale, timestamp, section, filters, sort, and profile/headed state."),
      target("news-module", "news_module", "page_screenshot", true, "Visible headline module, ranking, snippets, thumbnails, publisher labels, and timestamp."),
      target("publisher-context", "publisher_context", "page_text", false, "Visible publisher, author, timestamp, section, and article source context."),
      target("article-body", "article_body", "page_text", false, "Destination article body only when followed and separately preserved."),
      target("obstruction", "obstruction", "browser_obstruction", false, "Paywall, login, unavailable, region, or age obstruction.")
    ],
    unsupportedActions: [
      unsupported("paywall-bypass", "paywall, login, or subscription bypass", "Do not bypass paywalls, login walls, subscription gates, or app-only article views."),
      unsupported("comment-write", "comment, like, share, or reaction", "Do not perform account-changing news or community actions."),
      unsupported("unbounded-feed-crawl", "unbounded news feed crawl", "Keep news pagination and feed expansion bounded.")
    ],
    warnings: [`${platform} news modules are volatile and may vary by locale, personalization, time, publisher availability, and ranking experiments.`, `Portal snippets from ${platform} prove only browser-visible portal display; destination article claims need separate evidence.`]
  };
}

function genericTemplate(platform: SourcePlatform) {
  return {
    plannedActions: [
      action("page-capture", "capture_page_state", "Capture browser-visible page state.", "Generic sources start from visible evidence before source-specific assumptions.", true, "page_screenshot"),
      action("page-shape", "classify_obstruction", "Classify obstruction or page shape before proposing deeper actions.", "Unsupported pages should fail visibly, not silently.", true, "browser_obstruction", "conditional"),
      action("bounded-scroll", "scroll_results", "Use bounded scrolling only when visible content depends on it.", "Avoid unbounded crawling and preserve each evidence state.", true, "page_screenshot", "conditional"),
      action("destination-followup", "follow_destination", "Follow destination pages only when final claims require them.", "A generic page may be an index rather than the claim source.", true, "metadata", "conditional")
    ],
    extractionTargets: [
      target("visible-text", "structured_page_data", "page_text", true, "Visible text, headings, links, and tables."),
      target("html", "structured_page_data", "page_html", true, "HTML for deterministic derivatives such as JSON-LD and Open Graph."),
      target("media-index", "media_gallery", "media_index", false, "Accessible image-like media index."),
      target("obstruction", "obstruction", "browser_obstruction", false, "Browser-visible access or availability obstruction.")
    ],
    unsupportedActions: [unsupported("unknown-mutating-action", "unknown mutating action", "Do not click actions that may submit, purchase, post, delete, or modify state.")],
    warnings: [`No specialized navigation recipe is registered for ${platform}; keep follow-up actions conservative.`]
  };
}

function action(key: string, kind: SourceNavigationActionKind, label: string, reason: string, requiresCapture: boolean, evidenceKind: EvidenceKind, status: SourceNavigationActionStatus = "planned"): SourceNavigationAction {
  return {
    key,
    kind,
    status,
    label,
    reason,
    requiresCapture,
    evidenceKind
  };
}

function target(key: string, kind: SourceExtractionTargetKind, evidenceKind: EvidenceKind, required: boolean, note: string): SourceExtractionTarget {
  return {
    key,
    kind,
    evidenceKind,
    required,
    note
  };
}

function unsupported(key: string, actionName: string, reason: string): SourceUnsupportedAction {
  return {
    key,
    action: actionName,
    reason
  };
}
