export type SourceFamily =
  | "search"
  | "map"
  | "blog"
  | "travel_booking"
  | "commerce"
  | "portal"
  | "video_social"
  | "generic_web";

export type SourcePlatform =
  | "naver_search"
  | "naver_map"
  | "naver_blog"
  | "naver_cafe"
  | "naver_kin"
  | "naver_news"
  | "naver_shopping"
  | "google_search"
  | "google_maps"
  | "google_travel"
  | "google_news"
  | "google_scholar"
  | "bing"
  | "yahoo_search"
  | "yahoo_japan_search"
  | "yandex"
  | "daum_search"
  | "daum_news"
  | "kakao_map"
  | "agoda"
  | "trip_com"
  | "booking_com"
  | "expedia"
  | "airbnb"
  | "youtube"
  | "instagram"
  | "tiktok"
  | "x_twitter"
  | "threads"
  | "facebook"
  | "reddit"
  | "quora"
  | "stack_overflow"
  | "dcinside"
  | "blind"
  | "yahoo_news"
  | "reuters"
  | "bloomberg"
  | "bbc"
  | "yonhap_news"
  | "yelp"
  | "tripadvisor"
  | "apple_maps"
  | "amazon"
  | "coupang"
  | "gmarket"
  | "elevenst"
  | "ebay"
  | "walmart"
  | "temu"
  | "shein"
  | "wikipedia"
  | "namuwiki"
  | "pubmed"
  | "data_go_kr"
  | "kosis"
  | "riss"
  | "kipris"
  | "chatgpt_search"
  | "gemini"
  | "perplexity"
  | "kakao_talk"
  | "discord"
  | "telegram"
  | "slack"
  | "teams"
  | "generic";

export type SourceEvidenceStatus = "primary" | "supported" | "conditional" | "unsupported" | "future";

export interface SourceEvidenceStep {
  key: string;
  status: SourceEvidenceStatus;
  artifactKind: "html" | "text" | "screenshot" | "structured" | "media" | "none";
  note: string;
  constraint?: string;
}

export interface SourceStrategy {
  schemaVersion: "1.0";
  inputUrl: string;
  canonicalHost: string;
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  confidence: "high" | "medium" | "low";
  evidencePlan: SourceEvidenceStep[];
  extractionHints: string[];
  requiredAgentWork: string[];
  warnings: string[];
}

export function describeSourceStrategy(inputUrl: string): SourceStrategy {
  const url = new URL(inputUrl);
  const host = url.hostname.toLowerCase();
  const platform = detectSourcePlatform(url);
  const sourceFamily = sourceFamilyFor(platform);

  return {
    schemaVersion: "1.0",
    inputUrl: url.toString(),
    canonicalHost: host,
    platform,
    sourceFamily,
    confidence: platform === "generic" ? "low" : "high",
    evidencePlan: evidencePlanFor(sourceFamily, platform),
    extractionHints: extractionHintsFor(sourceFamily, platform),
    requiredAgentWork: requiredAgentWorkFor(sourceFamily, platform),
    warnings: warningsFor(sourceFamily, platform)
  };
}

function detectSourcePlatform(url: URL): SourcePlatform {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (isNaverHost(host)) {
    if (host.includes("map.") || host.includes("place.") || path.startsWith("/p/") || path.includes("/place/")) {
      return "naver_map";
    }
    if (host.startsWith("blog.") || host.startsWith("m.blog.") || host.startsWith("section.blog.")) {
      return "naver_blog";
    }
    if (host.startsWith("cafe.")) {
      return "naver_cafe";
    }
    if (host.startsWith("kin.")) {
      return "naver_kin";
    }
    if (host.startsWith("news.")) {
      return "naver_news";
    }
    if (host.startsWith("shopping.")) {
      return "naver_shopping";
    }
    if (
      host.startsWith("search.")
      && (url.searchParams.get("where") === "news" || url.searchParams.get("ssc")?.startsWith("tab.news"))
    ) {
      return "naver_news";
    }
    if (host.startsWith("search.") || path.startsWith("/search")) {
      return "naver_search";
    }
    return "naver_search";
  }

  if (isGoogleHost(host)) {
    if (host.startsWith("news.")) {
      return "google_news";
    }
    if (host.startsWith("scholar.")) {
      return "google_scholar";
    }
    if (host.startsWith("maps.") || path.startsWith("/maps")) {
      return "google_maps";
    }
    if (path.startsWith("/travel")) {
      return "google_travel";
    }
    if (path.startsWith("/search")) {
      return "google_search";
    }
  }

  if (isHostOrSubdomain(host, "bing.com")) {
    return "bing";
  }
  if (isHostOrSubdomain(host, "yandex.com") || isHostOrSubdomain(host, "yandex.ru")) {
    return "yandex";
  }
  if (isHostOrSubdomain(host, "search.yahoo.com")) {
    return "yahoo_search";
  }
  if (isHostOrSubdomain(host, "yahoo.co.jp")) {
    return "yahoo_japan_search";
  }
  if (isHostOrSubdomain(host, "daum.net") || isHostOrSubdomain(host, "kakao.com")) {
    if (host.startsWith("map.") || host.startsWith("map.kakao.") || path.includes("/map")) {
      return "kakao_map";
    }
    if (
      host.startsWith("news.")
      || path.startsWith("/news")
      || (host.startsWith("search.") && url.searchParams.get("w") === "news")
    ) {
      return "daum_news";
    }
    return "daum_search";
  }

  if (isHostOrSubdomain(host, "agoda.com")) {
    return "agoda";
  }
  if (isHostOrSubdomain(host, "trip.com") || isHostOrSubdomain(host, "ctrip.com")) {
    return "trip_com";
  }
  if (isHostOrSubdomain(host, "booking.com")) {
    return "booking_com";
  }
  if (isHostOrSubdomain(host, "expedia.com")) {
    return "expedia";
  }
  if (isHostOrSubdomain(host, "airbnb.com")) {
    return "airbnb";
  }
  if (isHostOrSubdomain(host, "youtube.com") || host === "youtu.be") {
    return "youtube";
  }
  if (isHostOrSubdomain(host, "instagram.com")) {
    return "instagram";
  }
  if (isHostOrSubdomain(host, "tiktok.com")) {
    return "tiktok";
  }
  if (host === "x.com" || isHostOrSubdomain(host, "twitter.com")) {
    return "x_twitter";
  }
  if (isHostOrSubdomain(host, "threads.net")) {
    return "threads";
  }
  if (isHostOrSubdomain(host, "facebook.com")) {
    return "facebook";
  }
  if (isHostOrSubdomain(host, "reddit.com")) {
    return "reddit";
  }
  if (isHostOrSubdomain(host, "quora.com")) {
    return "quora";
  }
  if (isHostOrSubdomain(host, "stackoverflow.com") || isHostOrSubdomain(host, "stackexchange.com")) {
    return "stack_overflow";
  }
  if (isHostOrSubdomain(host, "dcinside.com")) {
    return "dcinside";
  }
  if (isHostOrSubdomain(host, "teamblind.com")) {
    return "blind";
  }
  if (isHostOrSubdomain(host, "news.yahoo.com")) {
    return "yahoo_news";
  }
  if (isHostOrSubdomain(host, "reuters.com")) {
    return "reuters";
  }
  if (isHostOrSubdomain(host, "bloomberg.com")) {
    return "bloomberg";
  }
  if (isHostOrSubdomain(host, "bbc.com") || isHostOrSubdomain(host, "bbc.co.uk")) {
    return "bbc";
  }
  if (isHostOrSubdomain(host, "yna.co.kr")) {
    return "yonhap_news";
  }
  if (isHostOrSubdomain(host, "yelp.com")) {
    return "yelp";
  }
  if (isHostOrSubdomain(host, "tripadvisor.com")) {
    return "tripadvisor";
  }
  if (isHostOrSubdomain(host, "maps.apple.com")) {
    return "apple_maps";
  }
  if (isHostOrSubdomain(host, "amazon.com")) {
    return "amazon";
  }
  if (isHostOrSubdomain(host, "coupang.com")) {
    return "coupang";
  }
  if (isHostOrSubdomain(host, "gmarket.co.kr")) {
    return "gmarket";
  }
  if (isHostOrSubdomain(host, "11st.co.kr")) {
    return "elevenst";
  }
  if (isHostOrSubdomain(host, "ebay.com")) {
    return "ebay";
  }
  if (isHostOrSubdomain(host, "walmart.com")) {
    return "walmart";
  }
  if (isHostOrSubdomain(host, "temu.com")) {
    return "temu";
  }
  if (isHostOrSubdomain(host, "shein.com")) {
    return "shein";
  }
  if (isHostOrSubdomain(host, "wikipedia.org")) {
    return "wikipedia";
  }
  if (isHostOrSubdomain(host, "namu.wiki")) {
    return "namuwiki";
  }
  if (isHostOrSubdomain(host, "pubmed.ncbi.nlm.nih.gov")) {
    return "pubmed";
  }
  if (isHostOrSubdomain(host, "data.go.kr")) {
    return "data_go_kr";
  }
  if (isHostOrSubdomain(host, "kosis.kr")) {
    return "kosis";
  }
  if (isHostOrSubdomain(host, "riss.kr")) {
    return "riss";
  }
  if (isHostOrSubdomain(host, "kipris.or.kr")) {
    return "kipris";
  }

  return "generic";
}

function sourceFamilyFor(platform: SourcePlatform): SourceFamily {
  switch (platform) {
    case "naver_map":
    case "google_maps":
    case "kakao_map":
    case "apple_maps":
      return "map";
    case "naver_blog":
    case "naver_cafe":
      return "blog";
    case "naver_search":
    case "google_search":
    case "bing":
    case "yahoo_search":
    case "yahoo_japan_search":
    case "yandex":
    case "daum_search":
      return "search";
    case "google_travel":
    case "agoda":
    case "trip_com":
    case "booking_com":
    case "expedia":
    case "airbnb":
      return "travel_booking";
    case "youtube":
    case "instagram":
    case "tiktok":
    case "x_twitter":
    case "threads":
    case "facebook":
      return "video_social";
    case "amazon":
    case "coupang":
    case "naver_shopping":
    case "gmarket":
    case "elevenst":
    case "ebay":
    case "walmart":
    case "temu":
    case "shein":
      return "commerce";
    case "naver_kin":
    case "naver_news":
    case "daum_news":
    case "google_news":
    case "google_scholar":
    case "reddit":
    case "quora":
    case "stack_overflow":
    case "dcinside":
    case "blind":
    case "yahoo_news":
    case "reuters":
    case "bloomberg":
    case "bbc":
    case "yonhap_news":
    case "yelp":
    case "tripadvisor":
      return "portal";
    default:
      return "generic_web";
  }
}

function evidencePlanFor(sourceFamily: SourceFamily, platform: SourcePlatform): SourceEvidenceStep[] {
  const common: SourceEvidenceStep[] = [
    {
      key: "browser_visible_capture",
      status: "primary",
      artifactKind: "screenshot",
      note: "Preserve browser-visible page state with screenshot, HTML, visible text, network log, and console log."
    },
    {
      key: "structured_page_derivatives",
      status: "supported",
      artifactKind: "structured",
      note: "Extract deterministic page derivatives when present, such as JSON-LD, Open Graph metadata, canonical URL, headings, visible links, and tables."
    }
  ];

  if (sourceFamily === "map") {
    return [
      ...common,
      {
        key: "map_viewport_screenshot",
        status: "primary",
        artifactKind: "screenshot",
        note: "Capture the visible map/listing viewport, selected place panel, rating/review snippets, address, hours, and route/search context exactly as rendered."
      },
      {
        key: "map_ocr",
        status: "conditional",
        artifactKind: "structured",
        note: "Run OCR over map screenshots when visible labels, price badges, or pins are image-rendered.",
        constraint: "OCR is a derivative of screenshots; it does not replace the screenshot artifact."
      },
      {
        key: "official_places_api",
        status: "future",
        artifactKind: "structured",
        note: "Use official place APIs only behind explicit credentials and only for fields the provider allows.",
        constraint: platform === "naver_map" ? "Naver Maps/Place coverage should be added as a credential-gated provider client, not a scraper bypass." : "Google Places/Maps API coverage should be credential-gated and separated from browser-visible evidence."
      }
    ];
  }

  if (sourceFamily === "blog") {
    return [
      ...common,
      {
        key: "article_snapshot",
        status: "primary",
        artifactKind: "text",
        note: "Preserve title, author/date if visible, body text, images, comments if visible, and permalink/canonical URL."
      },
      {
        key: "embedded_media",
        status: "conditional",
        artifactKind: "media",
        note: "Preserve only accessible image-like media and caption files; index but do not bypass protected media streams."
      }
    ];
  }

  if (sourceFamily === "search") {
    return [
      ...common,
      {
        key: "serp_snapshot",
        status: "primary",
        artifactKind: "screenshot",
        note: "Capture query, locale, timestamp, visible result ranking, snippets, ads/organic distinction when visible, and filters."
      },
      {
        key: "result_followup",
        status: "conditional",
        artifactKind: "screenshot",
        note: "Follow selected result URLs as separate evidence runs when the claim depends on the destination, not only the search snippet."
      }
    ];
  }

  if (sourceFamily === "travel_booking") {
    return [
      ...common,
      {
        key: "offer_snapshot",
        status: "primary",
        artifactKind: "screenshot",
        note: "Capture dates, occupancy, currency, taxes/fees visibility, cancellation terms, room/rate name, and visible availability."
      },
      {
        key: "price_terms_ocr",
        status: "conditional",
        artifactKind: "structured",
        note: "Run OCR over screenshots when prices, badges, or terms are rendered in images or canvas-like surfaces."
      },
      {
        key: "booking_actions",
        status: "unsupported",
        artifactKind: "none",
        note: "Do not perform purchase, payment, reservation, or account-changing actions.",
        constraint: "The farm may capture visible evidence, not complete bookings or bypass account gates."
      }
    ];
  }

  if (sourceFamily === "commerce") {
    return [
      ...common,
      {
        key: "product_or_offer_snapshot",
        status: "primary",
        artifactKind: "screenshot",
        note: "Capture query, filters, sort state, visible product/offer cards, price, shipping/fee visibility, and timestamp."
      },
      {
        key: "commerce_terms_ocr",
        status: "conditional",
        artifactKind: "structured",
        note: "Run OCR over screenshots when prices, badges, or terms are image-rendered."
      },
      {
        key: "transaction_actions",
        status: "unsupported",
        artifactKind: "none",
        note: "Do not perform purchase, payment, cart, reservation, or account-changing actions.",
        constraint: "The farm may capture visible evidence, not transact."
      }
    ];
  }

  if (sourceFamily === "video_social") {
    return [
      ...common,
      {
        key: "timestamped_frame_sampling",
        status: "primary",
        artifactKind: "screenshot",
        note: "Use timestamped browser-visible frame screenshots and OCR/transcript derivatives when actually present."
      },
      {
        key: "raw_video_bytes",
        status: "unsupported",
        artifactKind: "none",
        note: "Do not download or bypass raw platform video streams."
      }
    ];
  }

  return [
    ...common,
    {
      key: "generic_followup",
      status: "conditional",
      artifactKind: "structured",
      note: "Add source-specific extraction only after the page shape is observed and the claim requires it."
    }
  ];
}

function extractionHintsFor(sourceFamily: SourceFamily, platform: SourcePlatform): string[] {
  if (sourceFamily === "map") {
    return [
      "Set locale/timezone/profile deliberately before running location-sensitive captures.",
      "Capture both map viewport and selected place/listing panel when available.",
      "Record search query, zoom/viewport, visible filters, and whether results are sponsored."
    ];
  }
  if (sourceFamily === "travel_booking") {
    return [
      "Always record dates, guests, rooms, currency, taxes/fees, cancellation policy, and timestamp.",
      "Treat prices as browser-visible point-in-time evidence, not durable facts.",
      "Use profile/headed mode when login changes price visibility, but do not automate booking/payment."
    ];
  }
  if (sourceFamily === "commerce") {
    return [
      "Always record query, filters, sort, currency, price, shipping/fee visibility, seller context, and timestamp.",
      "Treat prices and availability as browser-visible point-in-time evidence, not durable facts.",
      "Do not automate cart, checkout, purchase, account, or subscription actions."
    ];
  }
  if (sourceFamily === "search") {
    return [
      "Search result snippets are evidence of what the portal displayed, not proof of the destination content.",
      "Use follow-up evidence runs for cited result pages.",
      "Record locale, query, filters, and visible ranking."
    ];
  }
  if (sourceFamily === "blog") {
    return [
      "Preserve visible article text and screenshot before extracting summaries.",
      "Capture author/date/permalink if visible.",
      "Treat comments and embedded media as separate evidence when claims depend on them."
    ];
  }
  if (sourceFamily === "video_social") {
    return [
      "Use timestamped frame screenshots for visual claims.",
      "Use transcript/OCR/audio artifacts only when actually collected and cited.",
      "Preserve browser-visible obstructions instead of claiming content access."
    ];
  }
  return [
    `No specialized strategy is registered for ${platform}; start with browser-visible capture and add focused derivatives only after inspecting the page.`
  ];
}

function requiredAgentWorkFor(sourceFamily: SourceFamily, platform: SourcePlatform): string[] {
  const common = [
    "Choose the exact source URL and query state that the final claim depends on.",
    "Keep generated evidence run output out of git unless a small fixture is explicitly needed."
  ];
  if (sourceFamily === "travel_booking") {
    return [
      ...common,
      "Specify check-in/check-out dates, occupancy, currency, and filters before comparing offers.",
      "Use multiple captures if price or availability changes across sessions or login state."
    ];
  }
  if (sourceFamily === "commerce") {
    return [
      ...common,
      "Specify query, filters, sort, currency, seller context, and shipping/fee visibility before comparing offers.",
      "Use multiple captures if price or availability changes across sessions or login state."
    ];
  }
  if (sourceFamily === "map") {
    return [
      ...common,
      "Specify place/search query, region/viewport, and whether route or listing context matters."
    ];
  }
  if (sourceFamily === "search") {
    return [
      ...common,
      "Separate search-result evidence from destination-page evidence in final claims."
    ];
  }
  return common;
}

function warningsFor(sourceFamily: SourceFamily, platform: SourcePlatform): string[] {
  const warnings = [
    "Browser-visible evidence can change by locale, login state, personalization, date, and anti-automation surfaces.",
    "Do not bypass access controls, payment flows, DRM, or raw media stream protections."
  ];
  if (sourceFamily === "travel_booking") {
    warnings.push("Travel prices and availability are volatile; cite timestamped screenshots and visible search parameters.");
  }
  if (sourceFamily === "commerce") {
    warnings.push("Commerce prices, availability, ranking, and seller terms are volatile; cite timestamped screenshots and visible query/filter parameters.");
  }
  if (sourceFamily === "map") {
    warnings.push("Map rankings, labels, reviews, and place panels are viewport-, locale-, and personalization-sensitive.");
  }
  if (platform === "naver_map" || platform === "naver_blog" || platform === "naver_search") {
    warnings.push("Naver-specific evidence should start from browser-visible capture; official API clients must be added only behind explicit credentials and documented scopes.");
  }
  return warnings;
}

function isNaverHost(host: string): boolean {
  return isHostOrSubdomain(host, "naver.com") || isHostOrSubdomain(host, "naver.me");
}

function isGoogleHost(host: string): boolean {
  return /^(.+\.)?google\.[a-z.]+$/.test(host) || isHostOrSubdomain(host, "google.com");
}

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}
