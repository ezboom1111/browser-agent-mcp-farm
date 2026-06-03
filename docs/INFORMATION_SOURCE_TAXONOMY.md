# Information Source Taxonomy And Coverage Registry

This document converts the broad information-service taxonomy into an
engineering plan for Browser-Agent MCP Farm.

Status: implemented locally as `src/source-registry.ts`.

The goal is not to build a universal crawler. The goal is to make the farm know
which source categories matter, which top platforms must be covered per locale,
what evidence standard applies to each platform, and which existing source
strategy/navigation mechanics should be used.

## Layering Decision

Add a product-level source coverage registry above the existing source-family
strategy layer.

```text
user research intent
  |
  v
InformationCategory + LocaleSegment
  |
  v
SourceRegistryEntry
  |  chooses platform candidates, support tier, required capabilities
  v
SourceStrategy
  |  existing source family/platform evidence model
  v
SourceNavigationPlan
  |  existing tabs, filters, map panels, media, follow-up targets
  v
explicit safe recipes
  |
  v
browser-visible artifacts + structured derivatives
  |
  v
typed claim gate
```

`SourceFamily` remains the implementation mechanism. `InformationCategory` is a
product coverage map.

Example: Naver can appear in search, blog/content, community, map/local, review,
commerce, and knowledge categories. The registry records that product coverage;
`SourceStrategy` still chooses concrete families such as `search`, `map`,
`blog`, `commerce`, or `generic_web`.

## Categories

| Category | User behavior | Example platforms | Evidence emphasis |
|----------|---------------|-------------------|-------------------|
| `search` | I search for information | Google, Naver, Bing, Daum, Yahoo Japan | query, locale, ranking, snippets, filters, destination follow-up |
| `ai_search` | AI searches and answers | ChatGPT Search, Perplexity, Gemini | answer provenance, cited sources, answer as derivative evidence |
| `social_feed` | I discover through feeds | Instagram, TikTok, X/Twitter, Threads | visible post metadata, author, engagement, comments, obstruction state |
| `community_forum` | I ask or read communities | Reddit, Naver Cafe, DCInside, Quora, Stack Overflow | thread context, author/date, comments, vote/rank context |
| `content_media` | I learn from content | YouTube, blogs, Medium, Naver Blog, podcasts | title/body/caption, frame samples, OCR, transcript distinction |
| `news_media` | I check current issues | Google News, Naver News, Reuters, BBC, NYT | publisher, timestamp, article body, syndication/citation context |
| `review_reputation` | I inspect reviews/ratings | Google Maps, Naver Map, KakaoMap, Yelp, TripAdvisor | rating, review snippets, recency, filters, reviewer context when visible |
| `map_local` | I find places and routes | Google Maps, Naver Map, KakaoMap, T Map | viewport, selected place panel, pins, hours, address, OCR map labels |
| `marketplace_transaction` | I compare before purchase/reservation | Amazon, Coupang, Booking.com, Agoda, Trip.com | query state, filters, price, fees, availability, no transaction actions |
| `knowledge_database` | I query structured knowledge | Wikipedia, Namuwiki, PubMed, Google Scholar, data.go.kr | source fields, update date, structured records, citation chain |
| `messenger_private` | I use private or semi-private networks | KakaoTalk, Discord, Slack, Telegram | user-controlled visible capture only, no crawling/private bypass |
| `recommendation_curation` | A system or editor recommends | YouTube recommendations, TikTok For You, Wirecutter | recommendation context, personalization warning, visible rank/module |
| `ai_agent` | AI finds, interprets, and acts | ChatGPT, Claude, Gemini, Copilot-style agents | agent output is secondary; primary claims still need cited artifacts |

## Support Tiers

Use support tiers so docs and tests can state exactly where a platform stands.

| Tier | Meaning |
|------|---------|
| 0 | Unsupported. Record that the category/platform is out of scope. |
| 1 | Detect only. Can identify platform/family and classify obstructions. |
| 2 | Browser capture. Can preserve visible page state and basic artifacts. |
| 3 | Planned navigation. Has source strategy and `SourceNavigationPlan` coverage. |
| 4 | Explicit recipes. Has fixture-backed safe recipes for filters, panels, media, or follow-up. |
| 5 | Calibrated. Has real-site tuning and optional official API integration where credentials permit. |

Current status is strongest at tiers 2-4 for generic browser-visible
evidence, source strategy, source navigation plans, and explicit local recipes.
It is not tier 5 for Naver/Google/travel/social real-site defaults yet.

## Top-3 Coverage Rule

For each important category/locale pair, maintain at least three registry slots:

- primary local/global market leader
- second major platform
- third major or safety platform
- optional fourth "safety slot" when platform rankings are volatile or regional

The registry must store the observed ranking basis instead of hardcoding
permanent truth:

- metric: `market_share`, `monthly_visits`, `active_users`, or
  `strategic_relevance`
- source URL or citation note
- observed date
- locale segment
- category

Do not claim the top three are current unless the ranking evidence is refreshed.
When rankings are stale, the registry should still drive coverage planning but
label the ranking basis as stale.

## Initial Mandatory Slots

These slots define the first registry target. They are planning targets, not a
claim that all are already implemented.

| Category/segment | Mandatory slots |
|------------------|-----------------|
| `search.global` | Google, Bing, Yahoo/Yandex regional slot |
| `search.en-US` | Google, Bing, Yahoo Search |
| `search.ko-KR` | Naver, Google, Daum/Kakao, Bing safety slot |
| `search.ja-JP` | Google, Yahoo Japan, Bing |
| `ai_search.global` | ChatGPT Search, Gemini, Perplexity |
| `social_feed.global` | Instagram, TikTok, X/Twitter, Reddit safety slot |
| `social_feed.en-US` | Instagram, TikTok, X/Twitter |
| `content_media.global` | YouTube, TikTok, Instagram Reels/Shorts |
| `content_media.en-US` | YouTube, TikTok, Instagram Reels/Shorts |
| `content_media.ko-KR` | Naver Blog, YouTube, Instagram/Reels safety slot |
| `community_forum.global` | Reddit, Quora, Stack Overflow/Stack Exchange |
| `community_forum.en-US` | Reddit, Quora, Stack Overflow/Stack Exchange |
| `community_forum.ko-KR` | Naver Cafe, DCInside, Knowledge iN, Blind safety slot |
| `news_media.global` | Google News, Yahoo News, Reuters/Bloomberg/major outlet slot |
| `news_media.en-US` | Google News, Yahoo News, Reuters |
| `news_media.ko-KR` | Naver News, Daum News, major outlet slot |
| `review_reputation.ko-KR` | Naver Map, KakaoMap, Google Maps safety slot |
| `review_reputation.global` | Google Maps, Yelp, TripAdvisor |
| `review_reputation.en-US` | Google Maps, Yelp, TripAdvisor |
| `map_local.ko-KR` | Naver Map, KakaoMap, Google Maps safety slot |
| `map_local.global` | Google Maps, Apple Maps/Yelp regional slot, TripAdvisor local slot |
| `map_local.en-US` | Google Maps, Apple Maps, Yelp |
| `marketplace_transaction.global` | Amazon, Booking.com/Expedia travel slot, Agoda/Trip regional slot |
| `marketplace_transaction.en-US` | Amazon, Walmart, eBay |
| `marketplace_transaction.ko-KR` | Coupang, Naver Shopping, 11st/Gmarket |
| `knowledge_database.global` | Wikipedia, Google Scholar, PubMed/domain DB slot |
| `knowledge_database.en-US` | Wikipedia, Google Scholar, PubMed |
| `knowledge_database.ko-KR` | Namuwiki, data.go.kr/KOSIS, RISS/KIPRIS/domain DB slot |
| `messenger_private.ko-KR` | KakaoTalk/KakaoChannel, Discord/Telegram, Slack/Teams by use case |

## Planned Type Shape

```ts
export type InformationCategory =
  | "search"
  | "ai_search"
  | "social_feed"
  | "community_forum"
  | "content_media"
  | "news_media"
  | "review_reputation"
  | "map_local"
  | "marketplace_transaction"
  | "knowledge_database"
  | "messenger_private"
  | "recommendation_curation"
  | "ai_agent";

export type LocaleSegment =
  | "global"
  | "ko-KR"
  | "ja-JP"
  | "en-US"
  | "zh-CN"
  | "regional";

export interface SourceRegistryEntry {
  platform: SourcePlatform;
  displayName: string;
  informationCategories: InformationCategory[];
  sourceFamilies: SourceFamily[];
  localeSegments: LocaleSegment[];
  topSlots: Array<{
    segment: LocaleSegment;
    category: InformationCategory;
    rank: number;
    metric:
      | "market_share"
      | "monthly_visits"
      | "active_users"
      | "strategic_relevance";
    sourceUrl: string;
    observedAt: string;
    note: string;
  }>;
  evidenceRole: "primary" | "derivative" | "user_controlled" | "planning_only";
  supportTier: 0 | 1 | 2 | 3 | 4 | 5;
  requiredCapabilities: string[];
  unsupportedActions: string[];
}
```

## Engineering Review Decisions

1. Put the registry in `src/source-registry.ts`, not in `BrowserPool`.
   Platform/category coverage is planning metadata; browser mechanics must stay
   platform-agnostic.

2. Emit a `source_registry` artifact during evidence-run after `source_strategy`
   and before `source_navigation_plan`.

3. Keep AI search and AI agent outputs as derivative evidence. They can help
   discover sources, but final factual claims still need primary artifacts.

4. Treat messenger/private-network sources as explicit user-controlled capture
   only. No crawling, private bypass, or hidden extraction belongs in this
   project.

5. Add tests that fail when a mandatory category/locale slot has fewer than
   three registry entries or lacks a support-tier explanation.

6. Do not block current portal navigation work. The registry is the next layer
   to add before expanding real-site recipe catalogs.

## Implementation Tasks

- [x] Add `src/source-registry.ts` with category, locale, support tier, and
  top-slot types plus initial registry entries.
- [x] Add `source_registry` to evidence-kind schemas and artifact inference.
- [x] Thread registry selection through evidence-run assessment, final report,
  CLI/MCP/HTTP summaries, and package exports.
- [x] Add a CLI inspection command such as
  `source-registry --category search --locale ko-KR`.
- [x] Add tests for category coverage, top-slot count, source-family mapping,
  support-tier semantics, and stale ranking metadata.
- [x] Expand mandatory English-language (`en-US`) representative coverage for
  public search, social, content/media, community/forum, news, review/local,
  marketplace, and knowledge/database categories. These are strategic
  calibration slots, not refreshed market-share claims.
- [x] Use the registry to prioritize the first real-site calibration sets:
  Korean news, search, maps/local, Naver Blog content/media, and YouTube search
  now have repeated read-only baselines where browser-visible access permitted.
  Korean community/forum coverage now has first read-only baselines for Naver
  Cafe, DCInside, and Naver Knowledge iN. Korean marketplace/transaction
  top-slot calibration has also been attempted for Coupang, Naver Shopping,
  and Gmarket; the current unattended browser/network state exposes
  access-denied or bot-check surfaces for all three, now classified as blocked
  instead of selector-missing failures.
- [x] Add provider-specific global travel booking candidate scopes for
  Booking.com, Agoda, Trip.com, and Expedia, covering query/filter/sort/list/
  pagination/offer/price evidence and blocked-signal handling for access-
  denied, security-check, cookie-required, interruption, CAPTCHA, and
  login-required pages.
- [x] Run the first repeated `marketplace_transaction.global` calibration loop.
  Amazon, Booking.com, Agoda, and Trip.com now have maintained read-only action
  files that pass explicit evidence-run claim gates. Booking.com and Agoda
  currently preserve offer-card evidence; Trip.com also has maintained
  price/OCR evidence. Expedia repeated calibration currently reaches a visible
  human/bot challenge and is classified as blocked in the unattended browser.
- [x] Add local safe-executor commerce fixture coverage for the `en-US`
  marketplace top slots. Walmart and eBay now join Amazon in provider-specific
  query/filter/sort/pagination, product-card, seller/shipping, price-badge, and
  destination-extraction fixture coverage. This is local workflow proof; live
  maintained exports still require repeated real-site calibration.
- [x] Add provider-specific manual-only search recipe candidates for global and
  Japanese search top slots beyond Google/Naver/Daum. Bing, Yahoo Search, and
  Yahoo Japan Search now have query, vertical, filter, pagination,
  result-selection, and destination-follow-up calibration candidates tied to
  their provider containers. They remain candidate-unverified until repeated
  real-site calibration promotes maintained actions.
- [x] Add provider-specific manual-only knowledge/database recipe candidates
  for Google Scholar, Wikipedia, Namuwiki, PubMed, data.go.kr, KOSIS, RISS,
  and KIPRIS. These cover browser-visible article, result, abstract, citation,
  reference, dataset, statistic, academic record, and patent-detail surfaces
  while keeping restricted downloads, paid full text, login, edit, and
  institutional-access controls unsupported.
- [x] Add provider-specific manual-only review/local recipe candidates for
  Yelp and TripAdvisor. These cover query/location fields, category and filter
  state, bounded pagination, business/listing/rating/review capture,
  destination extraction for listing/detail/menu/review/tourism/external
  website links, and visible obstruction classification for human-check,
  cookie, app-open, login, and security-verification surfaces.
- [x] Add local safe-executor fixture coverage for Yelp/TripAdvisor-style
  review portals, including query, category, filter, pagination, listing
  capture, multi-link destination extraction, and obstruction capture. These
  recipes are fixture-verified locally but still need repeated real-site
  calibration before maintained export.
- [x] Add Apple Maps map/local recipe and safe-executor fixture coverage for
  global regional/safety calibration, including query, open-now filter,
  viewport, selected place, OCR label, review context, website/menu/review
  destination extraction, and explicit calibration target generation.
- [x] Run the first repeated `news_media.global` calibration loop. Google News,
  Yahoo News, and Reuters now have maintained read-only portal action files.
  Google News and Yahoo News also have maintained destination extraction.
  Reuters has dated article-link selector candidates and provider-shell triage
  guards, but current unattended live calibration hits DataDome challenge
  evidence before child article extraction can be trusted.
- [ ] Continue registry-prioritized calibration for Instagram/TikTok/X-Twitter
  with profile/headed state where appropriate, richer community article/thread
  destination variants, travel/commerce with profile/headed state where
  appropriate, Google Search with profile/headed state, and Korean/Japanese OCR
  fixtures. The first browser-executor batch
  covers Google map/news/ad modules, Naver Cafe public/member states, DCInside
  and Naver Knowledge iN community modules, KakaoMap panels, and richer travel
  room/rate cards; live OCR accuracy and broader real-site calibration remain.
  The first repeated `social_feed.global` calibration now promotes Instagram
  hashtag search and X/Twitter search read-only action files; TikTok remains
  blocked by a browser-visible server-error/unavailable-media surface and needs
  profile/headed retry before maintained action export.

## Not In Scope

- autonomous crawling across every platform
- private chat scraping or account bypass
- CAPTCHA, login, age, region, paywall, or app-only bypass
- automatic payments, bookings, reservations, posting, liking, or messaging
- claiming live market-share rankings without refreshed ranking evidence
