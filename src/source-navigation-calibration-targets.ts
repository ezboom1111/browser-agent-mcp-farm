import { sanitizeFileBase } from "./artifact-writer.js";
import {
  listSourceRegistryEntries,
  type InformationCategory,
  type LocaleSegment,
  type SourceRegistryEntry,
  type SourceRegistryFilter,
  type SourceSupportTier
} from "./source-registry.js";
import type { SourceNavigationCalibrationBatchTarget } from "./source-navigation-calibration-batch.js";
import { describeSourceStrategy, type SourceFamily, type SourcePlatform } from "./source-strategy.js";

export interface SourceNavigationCalibrationTargetPlanInput {
  category?: InformationCategory | undefined;
  locale?: LocaleSegment | undefined;
  platform?: SourcePlatform | undefined;
  sourceFamily?: SourceFamily | undefined;
  minSupportTier?: SourceSupportTier | undefined;
  query?: string | undefined;
  limit?: number | undefined;
  includeSearchVariants?: boolean | undefined;
}

export interface SourceNavigationCalibrationSkippedEntry {
  platform: SourcePlatform;
  displayName: string;
  reason: string;
}

export interface SourceNavigationCalibrationTargetPlan {
  schemaVersion: "1.0";
  executionPolicy: "read_only_selector_probe_targets";
  query: string;
  filter: SourceRegistryFilter;
  targetCount: number;
  targetDetectionSummary: SourceNavigationCalibrationTargetDetectionSummary;
  skippedCount: number;
  targets: SourceNavigationCalibrationBatchTarget[];
  skippedEntries: SourceNavigationCalibrationSkippedEntry[];
  warnings: string[];
}

export interface SourceNavigationCalibrationTargetDetectionSummary {
  targetCount: number;
  platformCounts: Array<{ platform: SourcePlatform; count: number }>;
  sourceFamilyCounts: Array<{ sourceFamily: SourceFamily; count: number }>;
  crossPlatformVariantCount: number;
  crossPlatformVariantTargets: string[];
}

type UrlTemplate = (query: string) => string;

interface SearchCalibrationVariant {
  id: string;
  url: string;
  note: string;
}

interface TravelDestinationHint {
  agodaCityUrl?: string | undefined;
  bookingDestId?: string | undefined;
  bookingDestType?: string | undefined;
}

const TRAVEL_DESTINATION_HINTS: Array<{ pattern: RegExp; hint: TravelDestinationHint }> = [
  {
    pattern: /\btokyo\b/i,
    hint: {
      agodaCityUrl: "https://www.agoda.com/city/tokyo-jp.html",
      bookingDestId: "-246227",
      bookingDestType: "city"
    }
  }
];

const PLATFORM_TARGET_URLS: Partial<Record<SourcePlatform, UrlTemplate>> = {
  google_search: (query) => withQuery("https://www.google.com/search", "q", query),
  bing: (query) => withQuery("https://www.bing.com/search", "q", query),
  yahoo_search: (query) => withQuery("https://search.yahoo.com/search", "p", query),
  yahoo_japan_search: (query) => withQuery("https://search.yahoo.co.jp/search", "p", query),
  naver_search: (query) => withQuery("https://search.naver.com/search.naver", "query", query),
  daum_search: (query) => withQuery("https://search.daum.net/search", "q", query),

  google_maps: (query) => `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
  naver_map: (query) => `https://map.naver.com/p/search/${encodeURIComponent(query)}`,
  kakao_map: (query) => withQuery("https://map.kakao.com/", "q", query),
  apple_maps: (query) => withQuery("https://maps.apple.com/", "q", query),

  naver_blog: (query) => withQuery("https://section.blog.naver.com/Search/Post.naver", "keyword", query),
  naver_cafe: (query) => withQuery("https://cafe.naver.com/ca-fe/home/search/articles", "q", query),
  naver_kin: (query) => withQuery("https://kin.naver.com/search/list.naver", "query", query),
  naver_news: (query) => withQuery("https://search.naver.com/search.naver", { where: "news", query }),
  daum_news: (query) => withQuery("https://search.daum.net/search", { w: "news", q: query }),
  google_news: (query) => withQuery("https://news.google.com/search", "q", query),
  google_scholar: (query) => withQuery("https://scholar.google.com/scholar", "q", query),
  google_travel: (query) => withQuery("https://www.google.com/travel/search", "q", query),
  yahoo_news: (query) => withQuery("https://news.yahoo.com/search", "p", query),
  yandex: (query) => withQuery("https://yandex.com/search/", "text", query),

  youtube: (query) => withQuery("https://www.youtube.com/results", "search_query", query),
  tiktok: (query) => withQuery("https://www.tiktok.com/search", "q", query),
  instagram: (query) => `https://www.instagram.com/explore/tags/${tagQuery(query)}/`,
  x_twitter: (query) => withQuery("https://x.com/search", { q: query, src: "typed_query" }),
  reddit: (query) => withQuery("https://www.reddit.com/search/", "q", query),
  facebook: (query) => withQuery("https://www.facebook.com/search/top/", "q", query),
  threads: (query) => withQuery("https://www.threads.net/search", "q", query),

  quora: (query) => withQuery("https://www.quora.com/search", "q", query),
  stack_overflow: (query) => withQuery("https://stackoverflow.com/search", "q", query),
  dcinside: (query) => withQuery("https://search.dcinside.com/post", "keyword", query),

  yelp: (query) => withQuery("https://www.yelp.com/search", "find_desc", query),
  tripadvisor: (query) => withQuery("https://www.tripadvisor.com/Search", "q", query),
  booking_com: (query) => bookingTargetUrl(query),
  agoda: (query) => agodaTargetUrl(query),
  trip_com: (query) => tripComTargetUrl(query),
  expedia: (query) => expediaTargetUrl(query),
  airbnb: (query) => withQuery("https://www.airbnb.com/s/all", "query", query),

  amazon: (query) => withQuery("https://www.amazon.com/s", "k", query),
  coupang: (query) => withQuery("https://www.coupang.com/np/search", "q", query),
  naver_shopping: (query) => withQuery("https://shopping.naver.com/search/all", "query", query),
  gmarket: (query) => withQuery("https://browse.gmarket.co.kr/search", "keyword", query),
  elevenst: (query) => withQuery("https://search.11st.co.kr/Search.tmall", "kwd", query),
  ebay: (query) => withQuery("https://www.ebay.com/sch/i.html", "_nkw", query),
  walmart: (query) => withQuery("https://www.walmart.com/search", "q", query),

  wikipedia: (query) => `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`,
  namuwiki: (query) => `https://namu.wiki/w/${encodeURIComponent(query)}`,
  pubmed: (query) => withQuery("https://pubmed.ncbi.nlm.nih.gov/", "term", query),
  data_go_kr: (query) => withQuery("https://www.data.go.kr/tcs/dss/selectDataSetList.do", "keyword", query),
  kosis: (query) => withQuery("https://kosis.kr/search/search.do", "query", query),
  riss: (query) => withQuery("https://www.riss.kr/search/Search.do", "queryText", query),
  kipris: (query) => withQuery("https://www.kipris.or.kr/khome/search/search.do", "queryText", query),

  reuters: (query) => withQuery("https://www.reuters.com/site-search/", "query", query),
  bbc: (query) => withQuery("https://www.bbc.co.uk/search", "q", query),
  yonhap_news: (query) => withQuery("https://www.yna.co.kr/search/index", "query", query),
  generic: (query) => withQuery("https://example.com/search", "q", query)
};

export function buildSourceNavigationCalibrationTargetPlan(
  input: SourceNavigationCalibrationTargetPlanInput = {}
): SourceNavigationCalibrationTargetPlan {
  const query = normalizedQuery(input.query, input.category, input.locale, input.sourceFamily);
  const filter: SourceRegistryFilter = {
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    ...(input.platform === undefined ? {} : { platform: input.platform }),
    ...(input.sourceFamily === undefined ? {} : { sourceFamily: input.sourceFamily }),
    ...(input.minSupportTier === undefined ? {} : { minSupportTier: input.minSupportTier })
  };
  const entries = sortEntriesForCalibration(listSourceRegistryEntries(filter), input.category, input.locale);
  const targets: SourceNavigationCalibrationBatchTarget[] = [];
  const skippedEntries: SourceNavigationCalibrationSkippedEntry[] = [];

  for (const entry of entries) {
    const skipReason = skipReasonFor(entry);
    const template = PLATFORM_TARGET_URLS[entry.platform];
    if (skipReason !== undefined) {
      skippedEntries.push(skippedEntry(entry, skipReason));
      continue;
    }
    if (template === undefined) {
      skippedEntries.push(skippedEntry(entry, "No calibration target URL template is defined for this platform."));
      continue;
    }
    targets.push(...calibrationTargetsForEntry(entry, query, template(query), input.includeSearchVariants === true));
  }

  const limitedTargets = input.limit === undefined ? targets : targets.slice(0, normalizeLimit(input.limit));
  const targetDetectionSummary = summarizeSourceNavigationCalibrationTargetDetections(limitedTargets);
  return {
    schemaVersion: "1.0",
    executionPolicy: "read_only_selector_probe_targets",
    query,
    filter,
    targetCount: limitedTargets.length,
    targetDetectionSummary,
    skippedCount: skippedEntries.length + Math.max(0, targets.length - limitedTargets.length),
    targets: limitedTargets,
    skippedEntries: [
      ...skippedEntries,
      ...targets.slice(limitedTargets.length).map((target) => ({
        platform: target.id as SourcePlatform,
        displayName: target.id,
        reason: "Omitted by target limit."
      }))
    ],
    warnings: [
      "Generated targets are calibration seeds, not a claim that the platform is currently reachable or ranked.",
      "Run targets through source-navigation-calibrate-batch and review captured evidence before catalog promotion.",
      "Private messenger and derivative AI answer entries are skipped unless a user-controlled capture workflow is designed.",
      ...(input.includeSearchVariants === true
        ? ["Search variants are vertical calibration seeds; promote them separately from broad search-page readiness."]
        : []),
      ...(targetDetectionSummary.crossPlatformVariantCount > 0
        ? ["Some variant target URLs are detected as a different platform; promotion and review will group by detected browser-visible platform/source family."]
        : [])
    ]
  };
}

export function expandSearchCalibrationTargetVariants(
  targets: SourceNavigationCalibrationBatchTarget[],
  options: { query: string; includeSearchVariants?: boolean | undefined }
): SourceNavigationCalibrationBatchTarget[] {
  if (options.includeSearchVariants !== true) {
    return targets;
  }
  return targets.flatMap((target) => {
    const platform = platformFromTargetId(target.id);
    if (platform === undefined) {
      return [target];
    }
    const variants = searchCalibrationVariants(platform, options.query);
    if (variants.length === 0) {
      return [target];
    }
    return [
      annotateSourceNavigationCalibrationTarget(target),
      ...variants.map((variant) => ({
        id: sanitizeFileBase(`${platform}-${variant.id}`),
        url: variant.url,
        note: `${target.note ?? platform}; variant=${variant.id}; ${variant.note}`,
        parentPlatform: target.parentPlatform ?? platform,
        ...(target.parentSourceFamilies === undefined ? {} : { parentSourceFamilies: target.parentSourceFamilies }),
        variantId: variant.id
      })).map(annotateSourceNavigationCalibrationTarget)
    ];
  });
}

export function formatSourceNavigationCalibrationTargetsAsLines(plan: SourceNavigationCalibrationTargetPlan): string {
  return plan.targets.map((target) => `${target.id} ${target.url}`).join("\n") + (plan.targets.length > 0 ? "\n" : "");
}

export function annotateSourceNavigationCalibrationTargets(
  targets: SourceNavigationCalibrationBatchTarget[]
): SourceNavigationCalibrationBatchTarget[] {
  return targets.map(annotateSourceNavigationCalibrationTarget);
}

export function summarizeSourceNavigationCalibrationTargetDetections(
  targets: SourceNavigationCalibrationBatchTarget[]
): SourceNavigationCalibrationTargetDetectionSummary {
  const platformCounts = new Map<SourcePlatform, number>();
  const sourceFamilyCounts = new Map<SourceFamily, number>();
  const crossPlatformVariantTargets: string[] = [];
  for (const target of targets) {
    const detectedPlatform = target.detectedPlatform ?? describeSourceStrategy(target.url).platform;
    const detectedSourceFamily = target.detectedSourceFamily ?? describeSourceStrategy(target.url).sourceFamily;
    platformCounts.set(detectedPlatform, (platformCounts.get(detectedPlatform) ?? 0) + 1);
    sourceFamilyCounts.set(detectedSourceFamily, (sourceFamilyCounts.get(detectedSourceFamily) ?? 0) + 1);
    if (target.variantId !== undefined && target.parentPlatform !== undefined && target.parentPlatform !== detectedPlatform) {
      crossPlatformVariantTargets.push(target.id);
    }
  }
  return {
    targetCount: targets.length,
    platformCounts: [...platformCounts.entries()].map(([platform, count]) => ({ platform, count })),
    sourceFamilyCounts: [...sourceFamilyCounts.entries()].map(([sourceFamily, count]) => ({ sourceFamily, count })),
    crossPlatformVariantCount: crossPlatformVariantTargets.length,
    crossPlatformVariantTargets
  };
}

function skipReasonFor(entry: SourceRegistryEntry): string | undefined {
  if (entry.evidenceRole === "user_controlled") {
    return "Private or messenger-like sources require explicit user-visible capture, not unattended batch calibration.";
  }
  if (entry.evidenceRole === "derivative") {
    return "Derivative AI answer/search sources are not primary evidence calibration targets.";
  }
  if (entry.supportTier === 0) {
    return "Support tier 0 entries are planning-only until a user-controlled workflow exists.";
  }
  return undefined;
}

function skippedEntry(entry: SourceRegistryEntry, reason: string): SourceNavigationCalibrationSkippedEntry {
  return {
    platform: entry.platform,
    displayName: entry.displayName,
    reason
  };
}

function calibrationTargetsForEntry(
  entry: SourceRegistryEntry,
  query: string,
  defaultUrl: string,
  includeSearchVariants: boolean
): SourceNavigationCalibrationBatchTarget[] {
  const note = `${entry.displayName}; categories=${entry.informationCategories.join(",")}; supportTier=${entry.supportTier}`;
  const defaultTarget = annotateSourceNavigationCalibrationTarget({
    id: sanitizeFileBase(entry.platform),
    url: defaultUrl,
    note,
    parentPlatform: entry.platform,
    parentSourceFamilies: entry.sourceFamilies
  });
  if (!includeSearchVariants) {
    return [defaultTarget];
  }
  const variants = searchCalibrationVariants(entry.platform, query);
  if (variants.length === 0) {
    return [defaultTarget];
  }
  return [
    defaultTarget,
    ...variants.map((variant) => ({
      id: sanitizeFileBase(`${entry.platform}-${variant.id}`),
      url: variant.url,
      note: `${note}; variant=${variant.id}; ${variant.note}`,
      parentPlatform: entry.platform,
      parentSourceFamilies: entry.sourceFamilies,
      variantId: variant.id
    })).map(annotateSourceNavigationCalibrationTarget)
  ];
}

function annotateSourceNavigationCalibrationTarget(target: SourceNavigationCalibrationBatchTarget): SourceNavigationCalibrationBatchTarget {
  const strategy = describeSourceStrategy(target.url);
  return {
    ...target,
    detectedPlatform: strategy.platform,
    detectedSourceFamily: strategy.sourceFamily
  };
}

function searchCalibrationVariants(platform: SourcePlatform, query: string): SearchCalibrationVariant[] {
  if (platform === "google_search") {
    return [
      {
        id: "news",
        url: withQuery("https://www.google.com/search", { q: query, tbm: "nws" }),
        note: "Google News vertical search results."
      },
      {
        id: "images",
        url: withQuery("https://www.google.com/search", { q: query, tbm: "isch" }),
        note: "Google Images vertical search results."
      },
      {
        id: "videos",
        url: withQuery("https://www.google.com/search", { q: query, tbm: "vid" }),
        note: "Google Videos vertical search results."
      },
      {
        id: "local",
        url: withQuery("https://www.google.com/search", { q: query, tbm: "lcl" }),
        note: "Google local/places result surface."
      }
    ];
  }
  if (platform === "naver_search") {
    return [
      {
        id: "view",
        url: withQuery("https://search.naver.com/search.naver", { where: "view", query }),
        note: "Naver View vertical for blog/cafe style results."
      },
      {
        id: "news",
        url: withQuery("https://search.naver.com/search.naver", { where: "news", query }),
        note: "Naver News vertical search results."
      },
      {
        id: "images",
        url: withQuery("https://search.naver.com/search.naver", { where: "image", query }),
        note: "Naver Image vertical search results."
      },
      {
        id: "videos",
        url: withQuery("https://search.naver.com/search.naver", { where: "video", query }),
        note: "Naver Video vertical search results."
      },
      {
        id: "place",
        url: withQuery("https://search.naver.com/search.naver", { where: "place", query }),
        note: "Naver Place/local search result surface."
      },
      {
        id: "shopping",
        url: withQuery("https://search.naver.com/search.naver", { where: "shopping", query }),
        note: "Naver Shopping result surface."
      }
    ];
  }
  if (platform === "daum_search") {
    return [
      {
        id: "news",
        url: withQuery("https://search.daum.net/search", { w: "news", q: query }),
        note: "Daum News vertical search results."
      },
      {
        id: "blog",
        url: withQuery("https://search.daum.net/search", { w: "blog", q: query }),
        note: "Daum Blog vertical search results."
      },
      {
        id: "cafe",
        url: withQuery("https://search.daum.net/search", { w: "cafe", q: query }),
        note: "Daum Cafe vertical search results."
      },
      {
        id: "images",
        url: withQuery("https://search.daum.net/search", { w: "img", q: query }),
        note: "Daum Image vertical search results."
      },
      {
        id: "videos",
        url: withQuery("https://search.daum.net/search", { w: "vclip", q: query }),
        note: "Daum Video vertical search results."
      },
      {
        id: "place",
        url: withQuery("https://search.daum.net/search", { w: "place", q: query }),
        note: "Daum/Kakao place result surface."
      },
      {
        id: "shopping",
        url: withQuery("https://search.daum.net/search", { w: "shopping", q: query }),
        note: "Daum Shopping result surface."
      }
    ];
  }
  if (platform === "bing") {
    return [
      {
        id: "images",
        url: withQuery("https://www.bing.com/images/search", "q", query),
        note: "Bing Images vertical search results."
      },
      {
        id: "videos",
        url: withQuery("https://www.bing.com/videos/search", "q", query),
        note: "Bing Videos vertical search results."
      },
      {
        id: "news",
        url: withQuery("https://www.bing.com/news/search", "q", query),
        note: "Bing News vertical search results."
      },
      {
        id: "maps",
        url: withQuery("https://www.bing.com/maps", "q", query),
        note: "Bing Maps/local result surface."
      }
    ];
  }
  if (platform === "yahoo_search") {
    return [
      {
        id: "images",
        url: withQuery("https://images.search.yahoo.com/search/images", "p", query),
        note: "Yahoo Images vertical search results."
      },
      {
        id: "news",
        url: withQuery("https://news.search.yahoo.com/search", "p", query),
        note: "Yahoo News vertical search results."
      },
      {
        id: "videos",
        url: withQuery("https://video.search.yahoo.com/search/video", "p", query),
        note: "Yahoo Video vertical search results."
      }
    ];
  }
  if (platform === "yahoo_japan_search") {
    return [
      {
        id: "images",
        url: withQuery("https://search.yahoo.co.jp/image/search", "p", query),
        note: "Yahoo Japan Images vertical search results."
      },
      {
        id: "videos",
        url: withQuery("https://search.yahoo.co.jp/video/search", "p", query),
        note: "Yahoo Japan Videos vertical search results."
      },
      {
        id: "news",
        url: withQuery("https://news.yahoo.co.jp/search", "p", query),
        note: "Yahoo Japan News vertical search results."
      },
      {
        id: "map",
        url: withQuery("https://map.yahoo.co.jp/search", "p", query),
        note: "Yahoo Japan Map/local result surface."
      },
      {
        id: "shopping",
        url: withQuery("https://shopping.yahoo.co.jp/search", "p", query),
        note: "Yahoo Japan Shopping result surface."
      },
      {
        id: "qna",
        url: withQuery("https://chiebukuro.yahoo.co.jp/search", "p", query),
        note: "Yahoo Japan Chiebukuro/Q&A result surface."
      }
    ];
  }
  return [];
}

function platformFromTargetId(id: string): SourcePlatform | undefined {
  if (id === "google_search") {
    return "google_search";
  }
  if (id === "naver_search") {
    return "naver_search";
  }
  if (id === "daum_search") {
    return "daum_search";
  }
  if (id === "bing") {
    return "bing";
  }
  if (id === "yahoo_search") {
    return "yahoo_search";
  }
  if (id === "yahoo_japan_search") {
    return "yahoo_japan_search";
  }
  return undefined;
}

function sortEntriesForCalibration(
  entries: SourceRegistryEntry[],
  category: InformationCategory | undefined,
  locale: LocaleSegment | undefined
): SourceRegistryEntry[] {
  return [...entries].sort((left, right) => {
    const leftRank = rankingScore(left, category, locale);
    const rightRank = rankingScore(right, category, locale);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    if (left.supportTier !== right.supportTier) {
      return right.supportTier - left.supportTier;
    }
    return left.platform.localeCompare(right.platform);
  });
}

function rankingScore(
  entry: SourceRegistryEntry,
  category: InformationCategory | undefined,
  locale: LocaleSegment | undefined
): number {
  const matchingSlots = entry.topSlots.filter((slot) =>
    (category === undefined || slot.category === category)
    && (locale === undefined || slot.segment === locale)
  );
  if (matchingSlots.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.min(...matchingSlots.map((slot) => slot.rank));
}

function normalizedQuery(
  query: string | undefined,
  category: InformationCategory | undefined,
  locale: LocaleSegment | undefined,
  sourceFamily: SourceFamily | undefined
): string {
  if (query !== undefined && query.trim().length > 0) {
    return query.trim();
  }
  if (locale === "ko-KR" && (category === "map_local" || category === "review_reputation" || sourceFamily === "map")) {
    return "성수 카페";
  }
  if (category === "marketplace_transaction" || sourceFamily === "travel_booking") {
    return locale === "ko-KR" ? "서울 호텔" : "Seoul hotel";
  }
  if (category === "social_feed" || category === "content_media" || sourceFamily === "video_social") {
    return "tokyo travel";
  }
  if (locale === "ko-KR") {
    return "도쿄 호텔";
  }
  if (locale === "ja-JP") {
    return "東京 ホテル";
  }
  return "tokyo hotel";
}

function withQuery(baseUrl: string, keyOrParams: string | Record<string, string>, value?: string): string {
  const url = new URL(baseUrl);
  const params = typeof keyOrParams === "string" ? { [keyOrParams]: value ?? "" } : keyOrParams;
  for (const [key, paramValue] of Object.entries(params)) {
    url.searchParams.set(key, paramValue);
  }
  return url.toString();
}

function bookingTargetUrl(query: string): string {
  const stay = futureStayWindow();
  const destination = travelDestinationHint(query);
  return withQuery("https://www.booking.com/searchresults.html", {
    ss: query,
    ...(destination?.bookingDestId === undefined ? {} : { dest_id: destination.bookingDestId }),
    ...(destination?.bookingDestType === undefined ? {} : { dest_type: destination.bookingDestType }),
    checkin: stay.checkIn,
    checkout: stay.checkOut,
    group_adults: "2",
    no_rooms: "1",
    group_children: "0",
    selected_currency: "USD"
  });
}

function agodaTargetUrl(query: string): string {
  const stay = futureStayWindow();
  const destination = travelDestinationHint(query);
  return withQuery(destination?.agodaCityUrl ?? "https://www.agoda.com/search", {
    ...(destination?.agodaCityUrl === undefined ? { text: query } : {}),
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    rooms: "1",
    adults: "2",
    children: "0",
    currency: "USD",
    locale: "en-us"
  });
}

function travelDestinationHint(query: string): TravelDestinationHint | undefined {
  return TRAVEL_DESTINATION_HINTS.find((entry) => entry.pattern.test(query))?.hint;
}

function tripComTargetUrl(query: string): string {
  const stay = futureStayWindow();
  return withQuery("https://www.trip.com/hotels/list", {
    searchword: query,
    checkin: stay.checkIn,
    checkout: stay.checkOut,
    rooms: "1",
    adults: "2",
    children: "0",
    curr: "USD"
  });
}

function expediaTargetUrl(query: string): string {
  const stay = futureStayWindow();
  return withQuery("https://www.expedia.com/Hotel-Search", {
    destination: query,
    startDate: stay.checkIn,
    endDate: stay.checkOut,
    rooms: "1",
    adults: "2"
  });
}

function futureStayWindow(): { checkIn: string; checkOut: string } {
  const checkIn = new Date();
  checkIn.setUTCDate(checkIn.getUTCDate() + 30);
  const checkOut = new Date(checkIn);
  checkOut.setUTCDate(checkOut.getUTCDate() + 1);
  return {
    checkIn: formatDate(checkIn),
    checkOut: formatDate(checkOut)
  };
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function tagQuery(query: string): string {
  const compact = query.replace(/[^A-Za-z0-9가-힣ぁ-んァ-ヶ一-龠]+/g, "").trim();
  return encodeURIComponent(compact || "travel");
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("Calibration target limit must be an integer between 1 and 200.");
  }
  return limit;
}
