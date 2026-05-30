import { describeSourceStrategy, type SourceFamily, type SourcePlatform } from "./source-strategy.js";

export const INFORMATION_CATEGORY_VALUES = ["search", "ai_search", "social_feed", "community_forum", "content_media", "news_media", "review_reputation", "map_local", "marketplace_transaction", "knowledge_database", "messenger_private", "recommendation_curation", "ai_agent"] as const;

export type InformationCategory = (typeof INFORMATION_CATEGORY_VALUES)[number];

export const LOCALE_SEGMENT_VALUES = ["global", "ko-KR", "ja-JP", "en-US", "zh-CN", "regional"] as const;

export type LocaleSegment = (typeof LOCALE_SEGMENT_VALUES)[number];
export type SourceSupportTier = 0 | 1 | 2 | 3 | 4 | 5;
export type SourceRegistryEvidenceRole = "primary" | "derivative" | "user_controlled" | "planning_only";

// The lawful basis under which the farm accesses a source. Documents the legal/ToS
// posture per source so the registry is auditable, and pairs with the hard non-goals
// (no login/CAPTCHA/paywall bypass, no raw-stream download). Robots/ToS stance is
// honored at the browser layer; this field records the INTENDED basis, not a license.
export const SOURCE_LEGAL_BASIS_VALUES = [
  "public_browser_visible", // public pages a human can view without auth; robots-respecting, no bypass
  "official_api", // the provider's official API, under the operator's own credentials
  "user_provided", // operator-supplied authenticated session; the user owns the account/data
  "derivative_citation", // AI/aggregator output used only to point at primary sources to cite
  "planning_only" // registry/planning seed, not a live data access
] as const;

export type SourceLegalBasis = (typeof SOURCE_LEGAL_BASIS_VALUES)[number];
export type SourceTopSlotMetric = "market_share" | "monthly_visits" | "active_users" | "strategic_relevance";

export interface SourceRegistryTopSlot {
  segment: LocaleSegment;
  category: InformationCategory;
  rank: number;
  metric: SourceTopSlotMetric;
  sourceUrl: string;
  observedAt: string;
  note: string;
}

export interface SourceRegistryEntry {
  schemaVersion: "1.0";
  platform: SourcePlatform;
  displayName: string;
  informationCategories: InformationCategory[];
  sourceFamilies: SourceFamily[];
  localeSegments: LocaleSegment[];
  supportTier: SourceSupportTier;
  evidenceRole: SourceRegistryEvidenceRole;
  legalBasis: SourceLegalBasis;
  requiredCapabilities: string[];
  unsupportedActions: string[];
  topSlots: SourceRegistryTopSlot[];
  notes: string[];
}

export interface SourceRegistryFilter {
  category?: InformationCategory | undefined;
  locale?: LocaleSegment | undefined;
  platform?: SourcePlatform | undefined;
  sourceFamily?: SourceFamily | undefined;
  minSupportTier?: SourceSupportTier | undefined;
}

export interface SourceRegistryCoverageRequirement {
  category: InformationCategory;
  locale: LocaleSegment;
  minEntries: number;
  note: string;
}

export interface SourceRegistryCoverageCheck {
  requirement: SourceRegistryCoverageRequirement;
  entryCount: number;
  platforms: SourcePlatform[];
  ranks: number[];
  ok: boolean;
}

export interface SourceRegistryCoverageReport {
  ok: boolean;
  checkedRequirements: SourceRegistryCoverageCheck[];
  errors: string[];
  warnings: string[];
}

export interface SourceRegistryMatch {
  schemaVersion: "1.0";
  inputUrl?: string;
  canonicalHost?: string;
  detectedPlatform?: SourcePlatform;
  detectedSourceFamily?: SourceFamily;
  matchReason: "platform" | "source_family" | "intent" | "fallback";
  entries: SourceRegistryEntry[];
  warnings: string[];
}

export interface SourceRegistrySummary {
  matchReason: SourceRegistryMatch["matchReason"];
  matchedEntryCount: number;
  platforms: SourcePlatform[];
  categories: InformationCategory[];
  localeSegments: LocaleSegment[];
  minSupportTier: SourceSupportTier | null;
  maxSupportTier: SourceSupportTier | null;
  topSlotCount: number;
  evidenceRoles: SourceRegistryEvidenceRole[];
  legalBases: SourceLegalBasis[];
  warnings: string[];
}

const REGISTRY_SOURCE_URL = "docs/INFORMATION_SOURCE_TAXONOMY.md#initial-mandatory-slots";
const REGISTRY_OBSERVED_AT = "2026-05-26";
const PLANNING_NOTE = "Planning seed from the local taxonomy; refresh external ranking evidence before claiming current market position.";

export const SOURCE_REGISTRY_COVERAGE_REQUIREMENTS: SourceRegistryCoverageRequirement[] = [
  requirement("search", "global"),
  requirement("search", "en-US"),
  requirement("search", "ko-KR"),
  requirement("search", "ja-JP"),
  requirement("ai_search", "global"),
  requirement("social_feed", "global"),
  requirement("social_feed", "en-US"),
  requirement("content_media", "global"),
  requirement("content_media", "en-US"),
  requirement("content_media", "ko-KR"),
  requirement("community_forum", "global"),
  requirement("community_forum", "en-US"),
  requirement("community_forum", "ko-KR"),
  requirement("news_media", "global"),
  requirement("news_media", "en-US"),
  requirement("news_media", "ko-KR"),
  requirement("review_reputation", "ko-KR"),
  requirement("review_reputation", "global"),
  requirement("review_reputation", "en-US"),
  requirement("map_local", "ko-KR"),
  requirement("map_local", "global"),
  requirement("map_local", "en-US"),
  requirement("marketplace_transaction", "global"),
  requirement("marketplace_transaction", "en-US"),
  requirement("marketplace_transaction", "ko-KR"),
  requirement("knowledge_database", "global"),
  requirement("knowledge_database", "en-US"),
  requirement("knowledge_database", "ko-KR"),
  requirement("messenger_private", "ko-KR")
];

export const SOURCE_REGISTRY: SourceRegistryEntry[] = [
  entry(
    "google_search",
    "Google Search",
    ["search"],
    ["search"],
    ["global", "ko-KR", "ja-JP", "en-US"],
    4,
    "primary",
    [top("search", "global", 1), top("search", "en-US", 1), top("search", "ko-KR", 2), top("search", "ja-JP", 1)],
    ["query_state", "visible_result_ranking", "destination_followup"],
    ["login_bypass", "captcha_bypass"]
  ),
  entry("bing", "Bing", ["search"], ["search"], ["global", "ko-KR", "ja-JP", "en-US"], 2, "primary", [top("search", "global", 2), top("search", "en-US", 2), top("search", "ko-KR", 4), top("search", "ja-JP", 3)], ["query_state", "visible_result_ranking"], ["login_bypass", "captcha_bypass"]),
  entry("yahoo_search", "Yahoo Search", ["search"], ["search"], ["global", "en-US"], 2, "primary", [top("search", "global", 3), top("search", "en-US", 3)], ["query_state", "visible_result_ranking"], ["login_bypass", "captcha_bypass"]),
  entry("yandex", "Yandex", ["search"], ["search"], ["global", "regional"], 1, "primary", [top("search", "global", 4)], ["query_state", "visible_result_ranking"], ["login_bypass", "captcha_bypass"], ["Regional safety slot; not required for top-three pass."]),
  entry("naver_search", "Naver Search", ["search", "recommendation_curation"], ["search", "portal"], ["ko-KR"], 4, "primary", [top("search", "ko-KR", 1)], ["query_state", "visible_result_ranking", "vertical_tabs", "destination_followup"], ["login_bypass", "captcha_bypass", "hidden_api_scraping"]),
  entry("daum_search", "Daum/Kakao Search", ["search"], ["search", "portal"], ["ko-KR"], 2, "primary", [top("search", "ko-KR", 3)], ["query_state", "visible_result_ranking"], ["login_bypass", "captcha_bypass"]),
  entry("yahoo_japan_search", "Yahoo Japan Search", ["search"], ["search", "portal"], ["ja-JP"], 2, "primary", [top("search", "ja-JP", 2)], ["query_state", "visible_result_ranking"], ["login_bypass", "captcha_bypass"]),

  entry(
    "chatgpt_search",
    "ChatGPT Search",
    ["ai_search", "ai_agent"],
    ["generic_web"],
    ["global"],
    1,
    "derivative",
    [top("ai_search", "global", 1)],
    ["answer_citations", "source_followup"],
    ["treating_answer_as_primary_evidence"],
    ["AI search output is derivative evidence; primary claims still need cited source artifacts."]
  ),
  entry("gemini", "Gemini", ["ai_search", "ai_agent"], ["generic_web"], ["global"], 1, "derivative", [top("ai_search", "global", 2)], ["answer_citations", "source_followup"], ["treating_answer_as_primary_evidence"], ["AI search output is derivative evidence."]),
  entry("perplexity", "Perplexity", ["ai_search"], ["generic_web"], ["global"], 1, "derivative", [top("ai_search", "global", 3)], ["answer_citations", "source_followup"], ["treating_answer_as_primary_evidence"], ["AI search output is derivative evidence."]),

  entry(
    "instagram",
    "Instagram",
    ["social_feed", "content_media", "recommendation_curation"],
    ["video_social"],
    ["global", "ko-KR", "en-US"],
    4,
    "primary",
    [top("social_feed", "global", 1), top("social_feed", "en-US", 1), top("content_media", "global", 3), top("content_media", "en-US", 3), top("content_media", "ko-KR", 3)],
    ["browser_visible_post", "frame_sampling", "ocr_overlay", "obstruction_classification"],
    ["login_bypass", "app_open_bypass", "raw_stream_download"]
  ),
  entry(
    "tiktok",
    "TikTok",
    ["social_feed", "content_media", "recommendation_curation"],
    ["video_social"],
    ["global", "en-US"],
    4,
    "primary",
    [top("social_feed", "global", 2), top("social_feed", "en-US", 2), top("content_media", "global", 2), top("content_media", "en-US", 2)],
    ["browser_visible_post", "frame_sampling", "ocr_overlay", "obstruction_classification"],
    ["login_bypass", "app_open_bypass", "raw_stream_download"]
  ),
  entry("x_twitter", "X/Twitter", ["social_feed", "news_media"], ["video_social", "generic_web"], ["global", "en-US"], 2, "primary", [top("social_feed", "global", 3), top("social_feed", "en-US", 3)], ["browser_visible_post", "visible_thread_context"], ["login_bypass", "private_message_access"]),
  entry(
    "reddit",
    "Reddit",
    ["social_feed", "community_forum"],
    ["portal", "generic_web"],
    ["global", "en-US"],
    2,
    "primary",
    [top("social_feed", "global", 4), top("community_forum", "global", 1), top("community_forum", "en-US", 1)],
    ["visible_thread_context", "comment_context"],
    ["login_bypass", "private_subreddit_bypass"]
  ),
  entry(
    "youtube",
    "YouTube",
    ["content_media", "social_feed", "recommendation_curation"],
    ["video_social"],
    ["global", "ko-KR", "en-US"],
    5,
    "primary",
    [top("content_media", "global", 1), top("content_media", "en-US", 1), top("content_media", "ko-KR", 2)],
    ["visible_metadata", "frame_sampling", "ocr_overlay", "caption_when_accessible", "official_api_optional"],
    ["raw_stream_download", "caption_rights_bypass"]
  ),
  entry("facebook", "Facebook", ["social_feed"], ["video_social", "generic_web"], ["global"], 1, "primary", [], ["browser_visible_post"], ["login_bypass", "private_group_bypass"]),
  entry("threads", "Threads", ["social_feed"], ["video_social", "generic_web"], ["global"], 1, "primary", [], ["browser_visible_post"], ["login_bypass"]),

  entry("quora", "Quora", ["community_forum"], ["portal", "generic_web"], ["global", "en-US"], 1, "primary", [top("community_forum", "global", 2), top("community_forum", "en-US", 2)], ["visible_thread_context"], ["login_bypass", "private_content_bypass"]),
  entry(
    "stack_overflow",
    "Stack Overflow / Stack Exchange",
    ["community_forum", "knowledge_database"],
    ["portal", "generic_web"],
    ["global", "en-US"],
    2,
    "primary",
    [top("community_forum", "global", 3), top("community_forum", "en-US", 3)],
    ["visible_question_answer_context"],
    ["login_bypass", "deleted_content_bypass"]
  ),
  entry("naver_blog", "Naver Blog", ["content_media", "review_reputation"], ["blog"], ["ko-KR"], 4, "primary", [top("content_media", "ko-KR", 1)], ["visible_article_body", "author_date_context", "embedded_media_ocr"], ["login_bypass", "private_post_bypass"]),
  entry("naver_cafe", "Naver Cafe", ["community_forum"], ["blog", "portal"], ["ko-KR"], 3, "primary", [top("community_forum", "ko-KR", 1)], ["visible_thread_context", "profile_context_when_visible"], ["login_bypass", "private_cafe_bypass"]),
  entry("dcinside", "DCInside", ["community_forum"], ["portal", "generic_web"], ["ko-KR"], 1, "primary", [top("community_forum", "ko-KR", 2)], ["visible_thread_context"], ["login_bypass", "deleted_content_bypass"]),
  entry("naver_kin", "Naver Knowledge iN", ["community_forum", "knowledge_database"], ["portal"], ["ko-KR"], 2, "primary", [top("community_forum", "ko-KR", 3)], ["visible_question_answer_context"], ["login_bypass", "private_content_bypass"]),
  entry("blind", "Blind", ["community_forum"], ["generic_web"], ["ko-KR"], 0, "planning_only", [top("community_forum", "ko-KR", 4)], ["obstruction_classification"], ["login_bypass", "private_forum_bypass"], ["Use only explicit user-visible capture if access is already available."]),

  entry("google_news", "Google News", ["news_media"], ["search", "portal"], ["global", "en-US"], 2, "primary", [top("news_media", "global", 1), top("news_media", "en-US", 1)], ["visible_article_ranking", "publisher_context", "destination_followup"], ["login_bypass", "paywall_bypass"]),
  entry("yahoo_news", "Yahoo News", ["news_media"], ["portal", "generic_web"], ["global", "en-US"], 1, "primary", [top("news_media", "global", 2), top("news_media", "en-US", 2)], ["visible_article_ranking", "publisher_context"], ["login_bypass", "paywall_bypass"]),
  entry("reuters", "Reuters", ["news_media"], ["portal", "generic_web"], ["global", "en-US"], 2, "primary", [top("news_media", "global", 3), top("news_media", "en-US", 3)], ["visible_article_body", "publisher_context"], ["paywall_bypass"]),
  entry("bloomberg", "Bloomberg", ["news_media"], ["portal", "generic_web"], ["global"], 1, "primary", [], ["visible_article_body", "publisher_context"], ["paywall_bypass"]),
  entry("bbc", "BBC", ["news_media"], ["portal", "generic_web"], ["global"], 1, "primary", [], ["visible_article_body", "publisher_context"], ["paywall_bypass"]),
  entry("naver_news", "Naver News", ["news_media"], ["portal"], ["ko-KR"], 3, "primary", [top("news_media", "ko-KR", 1)], ["visible_article_ranking", "publisher_context", "destination_followup"], ["login_bypass", "paywall_bypass"]),
  entry("daum_news", "Daum News", ["news_media"], ["portal"], ["ko-KR"], 2, "primary", [top("news_media", "ko-KR", 2)], ["visible_article_ranking", "publisher_context"], ["login_bypass", "paywall_bypass"]),
  entry("yonhap_news", "Yonhap News", ["news_media"], ["portal", "generic_web"], ["ko-KR"], 1, "primary", [top("news_media", "ko-KR", 3)], ["visible_article_body", "publisher_context"], ["paywall_bypass"]),

  entry("naver_map", "Naver Map", ["review_reputation", "map_local"], ["map"], ["ko-KR"], 4, "primary", [top("review_reputation", "ko-KR", 1), top("map_local", "ko-KR", 1)], ["map_viewport", "selected_place_panel", "review_snippets", "ocr_map_labels"], ["login_bypass", "route_account_action"]),
  entry("kakao_map", "Kakao Map", ["review_reputation", "map_local"], ["map"], ["ko-KR"], 2, "primary", [top("review_reputation", "ko-KR", 2), top("map_local", "ko-KR", 2)], ["map_viewport", "selected_place_panel", "review_snippets"], ["login_bypass", "route_account_action"]),
  entry(
    "google_maps",
    "Google Maps",
    ["review_reputation", "map_local"],
    ["map"],
    ["global", "ko-KR", "en-US"],
    4,
    "primary",
    [top("review_reputation", "ko-KR", 3), top("review_reputation", "global", 1), top("review_reputation", "en-US", 1), top("map_local", "ko-KR", 3), top("map_local", "global", 1), top("map_local", "en-US", 1)],
    ["map_viewport", "selected_place_panel", "review_snippets", "ocr_map_labels"],
    ["login_bypass", "route_account_action"]
  ),
  entry(
    "yelp",
    "Yelp",
    ["review_reputation", "map_local"],
    ["generic_web"],
    ["global", "en-US"],
    1,
    "primary",
    [top("review_reputation", "global", 2), top("review_reputation", "en-US", 2), top("map_local", "global", 2), top("map_local", "en-US", 3)],
    ["visible_listing_context", "review_snippets"],
    ["login_bypass", "private_review_bypass"]
  ),
  entry(
    "tripadvisor",
    "Tripadvisor",
    ["review_reputation", "map_local", "marketplace_transaction"],
    ["travel_booking", "generic_web"],
    ["global", "en-US"],
    2,
    "primary",
    [top("review_reputation", "global", 3), top("review_reputation", "en-US", 3), top("map_local", "global", 3)],
    ["visible_listing_context", "review_snippets", "price_context_when_visible"],
    ["login_bypass", "booking_action"]
  ),
  entry("apple_maps", "Apple Maps", ["map_local"], ["map"], ["global", "en-US"], 1, "primary", [top("map_local", "en-US", 2)], ["map_viewport", "selected_place_panel"], ["login_bypass"]),

  entry(
    "amazon",
    "Amazon",
    ["marketplace_transaction", "review_reputation"],
    ["commerce"],
    ["global", "en-US"],
    2,
    "primary",
    [top("marketplace_transaction", "global", 1), top("marketplace_transaction", "en-US", 1)],
    ["query_state", "price_cards", "review_snippets"],
    ["login_bypass", "cart_action", "purchase_action"]
  ),
  entry("booking_com", "Booking.com", ["marketplace_transaction", "review_reputation"], ["travel_booking"], ["global"], 4, "primary", [top("marketplace_transaction", "global", 2)], ["date_guest_currency_state", "price_cards", "rate_terms"], ["login_bypass", "booking_action", "payment_action"]),
  entry("agoda", "Agoda", ["marketplace_transaction", "review_reputation"], ["travel_booking"], ["global", "regional"], 4, "primary", [top("marketplace_transaction", "global", 3)], ["date_guest_currency_state", "price_cards", "rate_terms"], ["login_bypass", "booking_action", "payment_action"]),
  entry("trip_com", "Trip.com", ["marketplace_transaction", "review_reputation"], ["travel_booking"], ["global", "regional"], 4, "primary", [top("marketplace_transaction", "global", 4)], ["date_guest_currency_state", "price_cards", "rate_terms"], ["login_bypass", "booking_action", "payment_action"]),
  entry("expedia", "Expedia", ["marketplace_transaction"], ["travel_booking"], ["global"], 3, "primary", [], ["date_guest_currency_state", "price_cards", "rate_terms"], ["login_bypass", "booking_action", "payment_action"]),
  entry("coupang", "Coupang", ["marketplace_transaction", "review_reputation"], ["commerce"], ["ko-KR"], 2, "primary", [top("marketplace_transaction", "ko-KR", 1)], ["query_state", "price_cards", "review_snippets"], ["login_bypass", "cart_action", "purchase_action"]),
  entry("naver_shopping", "Naver Shopping", ["marketplace_transaction", "review_reputation"], ["commerce", "portal"], ["ko-KR"], 3, "primary", [top("marketplace_transaction", "ko-KR", 2)], ["query_state", "price_cards", "review_snippets"], ["login_bypass", "cart_action", "purchase_action"]),
  entry("gmarket", "Gmarket", ["marketplace_transaction"], ["commerce"], ["ko-KR"], 1, "primary", [top("marketplace_transaction", "ko-KR", 3)], ["query_state", "price_cards"], ["login_bypass", "cart_action", "purchase_action"]),
  entry("elevenst", "11st", ["marketplace_transaction"], ["commerce"], ["ko-KR"], 1, "primary", [], ["query_state", "price_cards"], ["login_bypass", "cart_action", "purchase_action"]),
  entry("walmart", "Walmart", ["marketplace_transaction", "review_reputation"], ["commerce"], ["en-US"], 1, "primary", [top("marketplace_transaction", "en-US", 2)], ["query_state", "price_cards", "review_snippets"], ["login_bypass", "cart_action", "purchase_action"]),
  entry("ebay", "eBay", ["marketplace_transaction", "review_reputation"], ["commerce"], ["en-US"], 1, "primary", [top("marketplace_transaction", "en-US", 3)], ["query_state", "price_cards", "seller_context"], ["login_bypass", "cart_action", "purchase_action"]),

  entry("wikipedia", "Wikipedia", ["knowledge_database"], ["generic_web"], ["global", "en-US"], 2, "primary", [top("knowledge_database", "global", 1), top("knowledge_database", "en-US", 1)], ["article_body", "revision_context_when_visible", "citation_chain"], ["login_bypass", "editing_action"]),
  entry(
    "google_scholar",
    "Google Scholar",
    ["knowledge_database", "search"],
    ["search", "generic_web"],
    ["global", "en-US"],
    1,
    "primary",
    [top("knowledge_database", "global", 2), top("knowledge_database", "en-US", 2)],
    ["query_state", "visible_result_ranking", "destination_followup"],
    ["login_bypass", "paywall_bypass"]
  ),
  entry("pubmed", "PubMed", ["knowledge_database"], ["generic_web"], ["global", "en-US"], 2, "primary", [top("knowledge_database", "global", 3), top("knowledge_database", "en-US", 3)], ["record_fields", "publication_metadata"], ["login_bypass", "paywall_bypass"]),
  entry("namuwiki", "Namuwiki", ["knowledge_database"], ["generic_web"], ["ko-KR"], 1, "primary", [top("knowledge_database", "ko-KR", 1)], ["article_body", "revision_context_when_visible"], ["login_bypass", "editing_action"]),
  entry("data_go_kr", "data.go.kr", ["knowledge_database"], ["generic_web"], ["ko-KR"], 1, "primary", [top("knowledge_database", "ko-KR", 2)], ["dataset_metadata", "download_metadata_when_visible"], ["login_bypass", "restricted_dataset_bypass"]),
  entry("riss", "RISS", ["knowledge_database"], ["generic_web"], ["ko-KR"], 1, "primary", [top("knowledge_database", "ko-KR", 3)], ["record_fields", "publication_metadata"], ["login_bypass", "paywall_bypass"]),
  entry("kosis", "KOSIS", ["knowledge_database"], ["generic_web"], ["ko-KR"], 1, "primary", [], ["dataset_metadata"], ["login_bypass", "restricted_dataset_bypass"]),
  entry("kipris", "KIPRIS", ["knowledge_database"], ["generic_web"], ["ko-KR"], 1, "primary", [], ["record_fields"], ["login_bypass", "restricted_record_bypass"]),

  entry(
    "kakao_talk",
    "KakaoTalk / KakaoChannel",
    ["messenger_private"],
    ["generic_web"],
    ["ko-KR"],
    0,
    "user_controlled",
    [top("messenger_private", "ko-KR", 1)],
    ["explicit_user_visible_capture"],
    ["private_chat_crawling", "account_bypass", "message_sending"],
    ["Private-network evidence requires user-controlled visible capture."]
  ),
  entry("discord", "Discord", ["messenger_private", "community_forum"], ["generic_web"], ["global", "ko-KR"], 0, "user_controlled", [top("messenger_private", "ko-KR", 2)], ["explicit_user_visible_capture"], ["private_server_crawling", "account_bypass", "message_sending"]),
  entry("slack", "Slack / Teams", ["messenger_private"], ["generic_web"], ["global", "ko-KR"], 0, "user_controlled", [top("messenger_private", "ko-KR", 3)], ["explicit_user_visible_capture"], ["workspace_crawling", "account_bypass", "message_sending"]),
  entry("telegram", "Telegram", ["messenger_private"], ["generic_web"], ["global", "ko-KR"], 0, "user_controlled", [], ["explicit_user_visible_capture"], ["private_chat_crawling", "account_bypass", "message_sending"]),

  entry(
    "generic",
    "Generic Web",
    ["search", "content_media", "news_media", "knowledge_database"],
    ["generic_web"],
    ["global", "regional"],
    2,
    "planning_only",
    [],
    ["browser_visible_capture", "structured_page_derivatives"],
    ["platform_specific_automation_without_explicit_recipe"],
    ["Fallback entry for unknown browser-visible sources."]
  )
];

export function listSourceRegistryEntries(filter: SourceRegistryFilter = {}): SourceRegistryEntry[] {
  return SOURCE_REGISTRY.filter((entry) => {
    if (filter.category !== undefined && !entry.informationCategories.includes(filter.category)) {
      return false;
    }
    if (filter.locale !== undefined && !entry.localeSegments.includes(filter.locale)) {
      return false;
    }
    if (filter.platform !== undefined && entry.platform !== filter.platform) {
      return false;
    }
    if (filter.sourceFamily !== undefined && !entry.sourceFamilies.includes(filter.sourceFamily)) {
      return false;
    }
    if (filter.minSupportTier !== undefined && entry.supportTier < filter.minSupportTier) {
      return false;
    }
    return true;
  });
}

export function selectSourceRegistryEntriesForIntent(input: { category?: InformationCategory | undefined; locale?: LocaleSegment | undefined; minSupportTier?: SourceSupportTier | undefined }): SourceRegistryMatch {
  const entries = listSourceRegistryEntries({
    category: input.category,
    locale: input.locale,
    minSupportTier: input.minSupportTier
  });
  return {
    schemaVersion: "1.0",
    matchReason: "intent",
    entries,
    warnings: entries.length === 0 ? ["No registry entries matched the requested category/locale intent."] : registryWarnings(entries)
  };
}

export function selectSourceRegistryEntriesForUrl(inputUrl: string): SourceRegistryMatch {
  const strategy = describeSourceStrategy(inputUrl);
  const url = new URL(strategy.inputUrl);
  const exact = listSourceRegistryEntries({ platform: strategy.platform });
  if (exact.length > 0) {
    return {
      schemaVersion: "1.0",
      inputUrl: strategy.inputUrl,
      canonicalHost: url.hostname.toLowerCase(),
      detectedPlatform: strategy.platform,
      detectedSourceFamily: strategy.sourceFamily,
      matchReason: "platform",
      entries: exact,
      warnings: registryWarnings(exact)
    };
  }

  const familyMatches = listSourceRegistryEntries({ sourceFamily: strategy.sourceFamily });
  if (familyMatches.length > 0 && strategy.sourceFamily !== "generic_web") {
    return {
      schemaVersion: "1.0",
      inputUrl: strategy.inputUrl,
      canonicalHost: url.hostname.toLowerCase(),
      detectedPlatform: strategy.platform,
      detectedSourceFamily: strategy.sourceFamily,
      matchReason: "source_family",
      entries: familyMatches,
      warnings: [`No exact registry entry for ${strategy.platform}; matched by source family ${strategy.sourceFamily}.`, ...registryWarnings(familyMatches)]
    };
  }

  const fallback = listSourceRegistryEntries({ platform: "generic" });
  return {
    schemaVersion: "1.0",
    inputUrl: strategy.inputUrl,
    canonicalHost: url.hostname.toLowerCase(),
    detectedPlatform: strategy.platform,
    detectedSourceFamily: strategy.sourceFamily,
    matchReason: "fallback",
    entries: fallback,
    warnings: [`No exact registry entry for ${strategy.platform}; using generic web fallback.`, ...registryWarnings(fallback)]
  };
}

export function summarizeSourceRegistryMatch(match: SourceRegistryMatch): SourceRegistrySummary {
  const tiers = match.entries.map((entry) => entry.supportTier);
  return {
    matchReason: match.matchReason,
    matchedEntryCount: match.entries.length,
    platforms: unique(match.entries.map((entry) => entry.platform)),
    categories: unique(match.entries.flatMap((entry) => entry.informationCategories)),
    localeSegments: unique(match.entries.flatMap((entry) => entry.localeSegments)),
    minSupportTier: tiers.length === 0 ? null : (Math.min(...tiers) as SourceSupportTier),
    maxSupportTier: tiers.length === 0 ? null : (Math.max(...tiers) as SourceSupportTier),
    topSlotCount: match.entries.reduce((total, entry) => total + entry.topSlots.length, 0),
    evidenceRoles: unique(match.entries.map((entry) => entry.evidenceRole)),
    legalBases: unique(match.entries.map((entry) => entry.legalBasis)),
    warnings: match.warnings
  };
}

export function assertRegistryCoverage(registry: SourceRegistryEntry[] = SOURCE_REGISTRY): SourceRegistryCoverageReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const entry of registry) {
    if (entry.informationCategories.length === 0) {
      errors.push(`${entry.platform} has no information categories.`);
    }
    if (entry.sourceFamilies.length === 0) {
      errors.push(`${entry.platform} has no source families.`);
    }
    if (entry.requiredCapabilities.length === 0) {
      errors.push(`${entry.platform} has no required capabilities.`);
    }
    if (entry.unsupportedActions.length === 0) {
      errors.push(`${entry.platform} has no unsupported action policy.`);
    }
    for (const slot of entry.topSlots) {
      if (!entry.informationCategories.includes(slot.category)) {
        errors.push(`${entry.platform} top slot ${slot.category}/${slot.segment} is not included in informationCategories.`);
      }
      if (!entry.localeSegments.includes(slot.segment)) {
        errors.push(`${entry.platform} top slot ${slot.category}/${slot.segment} is not included in localeSegments.`);
      }
      if (slot.sourceUrl.trim() === "" || slot.observedAt.trim() === "") {
        errors.push(`${entry.platform} top slot ${slot.category}/${slot.segment} is missing source metadata.`);
      }
      if (slot.metric !== "strategic_relevance") {
        warnings.push(`${entry.platform} top slot ${slot.category}/${slot.segment} uses ${slot.metric}; refresh source evidence before relying on it.`);
      }
    }
    if (entry.evidenceRole === "derivative" && !entry.unsupportedActions.includes("treating_answer_as_primary_evidence")) {
      errors.push(`${entry.platform} derivative entry must block treating the answer as primary evidence.`);
    }
    if (entry.evidenceRole === "user_controlled" && !entry.requiredCapabilities.includes("explicit_user_visible_capture")) {
      errors.push(`${entry.platform} private-network entry must require explicit user-visible capture.`);
    }
  }

  const checkedRequirements = SOURCE_REGISTRY_COVERAGE_REQUIREMENTS.map((requirement) => {
    const matches = registry.filter((entry) => entry.topSlots.some((slot) => slot.category === requirement.category && slot.segment === requirement.locale));
    const ranks = unique(matches.flatMap((entry) => entry.topSlots.filter((slot) => slot.category === requirement.category && slot.segment === requirement.locale).map((slot) => slot.rank))).sort((left, right) => left - right);
    const platforms = unique(matches.map((entry) => entry.platform));
    const ok = matches.length >= requirement.minEntries && ranks.length >= requirement.minEntries;
    if (!ok) {
      errors.push(`${requirement.category}/${requirement.locale} requires ${requirement.minEntries} top slots but has ${matches.length} entries and ${ranks.length} ranks.`);
    }
    return {
      requirement,
      entryCount: matches.length,
      platforms,
      ranks,
      ok
    };
  });

  return {
    ok: errors.length === 0,
    checkedRequirements,
    errors,
    warnings
  };
}

export function isInformationCategory(value: string): value is InformationCategory {
  return (INFORMATION_CATEGORY_VALUES as readonly string[]).includes(value);
}

export function isLocaleSegment(value: string): value is LocaleSegment {
  return (LOCALE_SEGMENT_VALUES as readonly string[]).includes(value);
}

function entry(
  platform: SourcePlatform,
  displayName: string,
  informationCategories: InformationCategory[],
  sourceFamilies: SourceFamily[],
  localeSegments: LocaleSegment[],
  supportTier: SourceSupportTier,
  evidenceRole: SourceRegistryEvidenceRole,
  topSlots: SourceRegistryTopSlot[],
  requiredCapabilities: string[],
  unsupportedActions: string[],
  notes: string[] = [],
  legalBasis?: SourceLegalBasis
): SourceRegistryEntry {
  return {
    schemaVersion: "1.0",
    platform,
    displayName,
    informationCategories,
    sourceFamilies,
    localeSegments,
    supportTier,
    evidenceRole,
    legalBasis: legalBasis ?? defaultLegalBasis(evidenceRole),
    requiredCapabilities,
    unsupportedActions,
    topSlots,
    notes
  };
}

// Derive the lawful access basis from the evidence role unless an entry overrides it
// (e.g. an official-API-backed source passes "official_api").
function defaultLegalBasis(role: SourceRegistryEvidenceRole): SourceLegalBasis {
  switch (role) {
    case "derivative":
      return "derivative_citation";
    case "user_controlled":
      return "user_provided";
    case "planning_only":
      return "planning_only";
    case "primary":
      return "public_browser_visible";
  }
}

function top(category: InformationCategory, segment: LocaleSegment, rank: number): SourceRegistryTopSlot {
  return {
    category,
    segment,
    rank,
    metric: "strategic_relevance",
    sourceUrl: REGISTRY_SOURCE_URL,
    observedAt: REGISTRY_OBSERVED_AT,
    note: PLANNING_NOTE
  };
}

function requirement(category: InformationCategory, locale: LocaleSegment, minEntries = 3): SourceRegistryCoverageRequirement {
  return {
    category,
    locale,
    minEntries,
    note: "Initial top-slot coverage target from the local taxonomy."
  };
}

function registryWarnings(entries: SourceRegistryEntry[]): string[] {
  const warnings = new Set<string>();
  for (const entry of entries) {
    if (entry.evidenceRole === "derivative") {
      warnings.add("AI answer/search entries are derivative evidence and must be followed to primary source artifacts before final factual claims.");
    }
    if (entry.evidenceRole === "user_controlled") {
      warnings.add("Messenger/private-network entries require explicit user-visible capture; do not crawl or bypass private access.");
    }
    for (const slot of entry.topSlots) {
      if (slot.metric === "strategic_relevance") {
        warnings.add("Top-slot ranks are planning seeds, not refreshed market-share claims.");
        break;
      }
    }
  }
  return [...warnings];
}

function unique<T extends string | number>(values: T[]): T[] {
  return [...new Set(values)];
}
