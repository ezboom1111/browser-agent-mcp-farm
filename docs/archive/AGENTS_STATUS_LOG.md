# Archived: AGENTS.md Implemented-Feature Log

This is the long, append-only "Current Status / Implemented" and
"Next Work Candidates" log that used to live inline in AGENTS.md. It was
moved here to keep AGENTS.md a slim capability map for agent handoff.
Build/test/coverage status is in STATUS.md; the living capability map is
docs/PRODUCT_DEVELOPMENT_PLAN.md; the work board is docs/NEXT_TASKS.md.

---

## Current Status

Implemented:

- isolated BrowserContext leases
- read-only capture
- guarded read-write browser actions
- profile persistence and profile locks
- proxy/fingerprint options
- image-like media capture and stream indexing
- WebVTT raw preservation and structured transcript JSON
- wait/selector/scroll/capture-after-idle helpers
- final-mode claim gate
- typed evidence kinds, claim types, and verification levels
- visual claims require timestamped frame screenshot artifacts in final mode
- transcript cue evidence and audio transcription evidence are semantically
  checked in final mode
- HTML evidence preview
- Codex/Claude MCP registration
- platform capability maps for YouTube/Instagram/TikTok
- source strategy artifacts for Naver Map, Naver Blog, Naver/Daum News,
  Google Search/Maps, Agoda, Trip.com, Booking.com, Expedia, video/social, and
  generic web sources
- source registry artifacts for category/locale/top-slot source coverage,
  support tiers, AI derivative evidence warnings, and private-network
  user-controlled capture policy
- source navigation plan artifacts for portal-native query state, tabs,
  filters, sort menus, map viewports, detail pages, OCR targets, video frame
  targets, destination follow-ups, and unsupported actions
- source navigation execution-plan state model for bounded future executor work
- source navigation execution-plan artifacts in evidence-run assessment,
  CLI/MCP/HTTP summaries, and final reports
- browser-backed safe source navigation executor for explicit local recipes,
  with `source_navigation_action` artifacts and fixture coverage
- explicit source navigation recipe input across CLI/MCP/HTTP evidence-run
  paths; when enabled, evidence-run executes only supplied action-key recipes
  before final page capture and records execution summaries
- explicit `follow_up` source navigation recipes that resolve destination URLs
  from a selector or literal URL, record `source_navigation_followup` artifacts,
  and run bounded one-depth child evidence runs under `runDir/followups`
- bounded destination triage for explicit follow-up requests. Evidence-run now
  records `destination_candidate` and `destination_triage` artifacts, scores
  explicit destinations with deterministic browser-visible URL/text signals,
  applies the max-follow-up budget before child runs, and summarizes useful,
  low-value, duplicate, blocked, private, and unsupported destinations.
- explicit `extract_destinations` source-navigation actions that read multiple
  visible usable HTTP(S) destination links from a selector without clicking the
  parent page. Extracted links become normal destination candidates, are ranked
  by bounded triage, and only selected top-K candidates create one-depth child
  evidence runs.
- explicit `extract_client_state_destinations` source-navigation actions that
  read browser-received client state from accessible frames through a generic
  BrowserPool client-state snapshot and derive Naver Place follow-up
  destinations from `window.__APOLLO_STATE__`. This covers Naver Map/Place
  result lists where visible cards expose place text but no usable destination
  `href` or SPA URL attribute.
- Naver Place client-state follow-ups now use executable
  `https://map.naver.com/p/entry/place/<id>` child URLs while preserving the
  canonical `https://place.naver.com/<type>/<id>` URL as `originalUrl` with
  `urlResolutionMethod: "naver_place_entry_fallback"`. This avoids local DNS
  failures for `place.naver.com` while keeping canonical provenance visible in
  action, candidate, and triage artifacts.
- client-state destination extraction validates optional selectors with the
  same frame-aware selector inspection used by calibration, so Naver Map list
  iframes such as `#app-root` do not fail through top-frame-only waiting.
- Naver Map manual-only recipe plans now include `extract_client_state_destinations`
  as an alternative `destination-followup` candidate with `#app-root`,
  `#_pcmap_list_scroll_container`, and `#root` selectors. Recipe catalog and
  promotion group calibration by `actionKey + operation`, so this client-state
  route can become a maintained explicit action file when repeated calibration
  proves it stable, without colliding with ordinary `extract_destinations`
  link-based follow-up recipes.
- Source coverage readiness now treats `extract_destinations` and
  `extract_client_state_destinations` as the same destination-extraction
  operation family when deriving planned candidate counts and readiness copy.
  This keeps Naver Map coverage QA aligned with the client-state route instead
  of reporting only ordinary link extraction.
- Read-only calibration now probes `extract_client_state_destinations` actions
  by reading the configured browser client-state key and running the shared
  Naver Place Apollo extractor. Recipe catalog promotion requires successful
  client-state probes with unique destination candidates before a client-state
  action can become maintained-ready.
- Promotion and coverage readiness summaries preserve client-state probe
  aggregate counts. The latest live Naver Map `성수 카페` repeated calibration
  promoted the client-state destination route as ready with 2 successful probe
  runs and 178 unique parsed destination candidates; the promoted evidence-run
  extracted 10 parent candidates but the selected child page was blocked by a
  visible Naver service-limit page.
- Destination triage preserves blocked-child recovery candidates when a
  selected child is obstructed but exposes deeper visible links such as
  `pcmap.place.naver.com/.../home`. These are QA hints only and are not
  promoted or executed as depth-2 proposals by default.
- Blocked-child recovery candidates now include structured
  `blockedChildRecoveryAdvice` with a deterministic recovery profile name,
  Chrome persistent-profile setup/retry commands, ordered machine-readable
  command steps, and policy reasons, so QA can retry with a user-controlled
  profile without treating the recovery URL as an automatic gate bypass.
- `destination-recovery-plan --run-dir <evidence-run-dir>` can now extract
  those recovery advice steps from a completed run and print JSON, Markdown,
  setup-only commands, retry-only commands, or all commands without opening a
  browser. It also supports `--format check`, `--check-profiles`,
  `--fail-check`, and `--only-check-ok` for read-only command/profile
  preflight checks before headed retry execution. Markdown output includes the
  same preflight summary, including saved-profile readiness when
  `--check-profiles` is supplied. If an older triage artifact only has
  `blockedChildRecoveryCandidates`, the CLI synthesizes equivalent
  profile/headed recovery advice from those candidates and accepts UTF-8
  BOM-prefixed JSON handoff files. Recovery plan items expose
  `adviceSource` and `synthesized` so QA can tell original triage advice from
  compatibility handoffs.
- browser page capture now collects visible text from all Playwright-accessible
  frames, not only the top document body, and records `visibleTextFrames`
  metadata. Page-capture visible link metadata is also frame-aware, so child
  evidence density can include iframe-rendered place, portal, and destination
  surfaces.
- destination extraction now also reads visible non-anchor destination
  attributes such as `data-href`, `data-url`, `data-target-url`,
  `data-place-url`, `data-source-url`, `data-item-url`, `data-product-url`,
  `data-profile-url`, and `data-media-url` from SPA-style cards/buttons when
  they contain visible text. This keeps Google/Naver/map deepening moving
  beyond anchor-only pages without clicking unsafe controls.
- source navigation recipe candidates now include provider-scoped SPA
  destination attribute selectors for Google Search, Naver Search, Naver Map,
  KakaoMap, Google Maps, commerce product cards, and video/social cards, so
  repeated calibration can promote those non-anchor surfaces when stable.
- broad generic SPA destination attributes such as `#search [data-url]` or
  `#main_pack [data-url]` are treated like broad anchor fallbacks for
  promotion: useful for calibration evidence, but not enough for maintained
  `extract_destinations` export unless narrowed by domain/path or a semantic
  attribute such as product/place/media/profile URL.
- read-only source-navigation calibration now probes matched
  `extract_destinations` selectors for actual usable HTTP(S) destination
  links. Calibration artifacts preserve raw, usable, unique, duplicate,
  anchor, and non-anchor attribute candidate counts plus sample URLs. Probe
  diagnostics also classify sampled links as promotable or non-promotable using
  destination-triage low-value/login/unsupported checks, and recipe catalog
  promotion rejects matched destination selectors whose probe finds zero
  usable links or only non-promotable links.
- read-only selector calibration is now frame-aware. `inspectSelector` and
  `readLinkTargets` inspect same-origin and Playwright-accessible frames, and
  calibration results preserve frame counts plus first matched/visible frame
  URLs. This prevents iframe-rendered result cards or map panels from being
  misclassified as not matched.
- read-only calibration now records global `destinationDiscovery` diagnostics
  for `extract_destinations` actions. When planned selectors miss, calibration
  scans visible anchors and supported SPA destination attributes across
  accessible frames, then classifies sampled URLs as promotable or
  non-promotable. This is a selector-discovery aid only, not a maintained
  child-run input.
- destination probe/discovery samples now include classified target metadata:
  URL, visible text, anchor/attribute source, attribute name, frame metadata
  when available, and warning reasons. Use these details to design narrower
  provider selectors instead of promoting broad scans.
- recipe catalog, promotion, and source coverage readiness outputs now carry
  aggregated `destinationDiscovery` diagnostics for `extract_destinations`
  actions, including discovery run counts, promotable/non-promotable candidate
  totals, warning counts, and sampled targets. This keeps global discovery as a
  QA handoff for narrower selector design, not as a maintained child-run input.
- catalog entries now derive manual-only destination selector hints from
  promotable discovery sample targets. Anchor samples become host/path-scoped
  `a[href*="..."]` hints, and SPA attribute samples become host/path-scoped
  attribute hints such as `[data-place-url*="place.naver.com/restaurant"]`.
  Hints also include scoped selector suggestions such as
  `#root [data-place-url*="place.naver.com/restaurant"]` when the platform has
  a known container scope. Hints remain `manual_calibration_required` and need
  repeated calibration before maintained export.
- `source-navigation-catalog --format selector-hints` prints those hints as
  tab-separated manual calibration planning lines. Use this for QA handoff, not
  as direct evidence-run input.
- `source-navigation-promote-batch` writes those same manual calibration hint
  lines to a per-group `selector-hints.tsv` handoff file, and promotion summary
  `files.selectorHints` points at that file when generated.
- `source-navigation-calibrate`, `source-navigation-calibrate-batch`, and
  `source-coverage-calibrate` can now load those handoff rows with
  `--selector-hints-file` or `--selector-hints-files`. Loaded hints append
  scoped suggestions to matching read-only selector candidates for the next
  calibration pass; they still do not become maintained evidence-run recipes
  until repeated calibration and promotion pass.
- source coverage calibration plans, Markdown reports, and calibration batch
  manifests preserve selector-hint input file paths, so profile/headed
  provider retries can be reproduced with the same manual selector handoff.
- source coverage readiness and coverage calibration loop reports preserve
  matching `selector-hints.tsv` paths under destination-extraction readiness,
  so QA can jump from a not-ready source slot to the next provider-specific
  selector calibration handoff.
- destination probe/discovery classification treats same-document hash links
  and Naver Map shell anchors such as `#section_content` and `#header` as
  low-value provider shell surfaces. They must not be promoted or counted as
  useful child destinations.
- destination extraction now prefers unique normalized destination URLs before
  duplicate hash variants when filling `maxLinks`, while still preserving
  duplicates if there are not enough unique visible links. This prevents
  repeated links from crowding out lower-ranked candidate sources during
  natural deepening QA. Source-navigation action metadata records raw, usable,
  unique, duplicate, and omitted duplicate destination candidate counts.
- map/local source navigation plans now include conditional destination
  follow-up work, and Naver Map, KakaoMap, and Google Maps recipe candidates
  propose `extract_destinations` selectors for visible place-detail, website,
  menu, review, booking/place, and external website links without clicking
  route, call, reservation, booking, login, or account-changing controls.
- commerce source navigation plans now include conditional destination
  follow-up work, and Amazon, Walmart, eBay, Coupang, Naver Shopping, Gmarket,
  and 11st recipe candidates propose `extract_destinations` selectors for visible
  product-detail, review, seller, brand/store, and marketplace item links
  without clicking cart, wishlist, purchase, checkout, subscribe, membership,
  login, or account-changing controls.
- blog/cafe and video/social source navigation plans now include conditional
  destination follow-up work. Naver Blog/Cafe recipe candidates propose
  `extract_destinations` selectors for visible source, related-post, profile,
  official, and external links; YouTube, Instagram, TikTok, and X/Twitter
  recipe candidates propose visible profile/channel, canonical media, external
  bio/source, and related-media links. These remain manual-only and do not click
  login, join, follow, like, comment, share, message, subscribe, raw-stream, or
  gate-bypass controls.
- YouTube destination extraction promotion now prefers precise media evidence
  selectors such as `ytd-video-renderer a#video-title[href*="/watch"]` over
  broad renderer links or duplicate-heavy channel thumbnail selectors after
  repeated profile-backed calibration.
- destination triage per-domain child-run budgets through
  `sourceNavigation.maxFollowUpsPerDomain` and
  `--source-navigation-max-followups-per-domain`, so one search/result domain
  cannot consume the whole bounded follow-up budget unless explicitly allowed.
- bounded follow-up concurrency through `sourceNavigation.followUpConcurrency`
  and `--source-navigation-followup-concurrency`. The default is sequential;
  explicit higher values run selected one-depth child evidence workflows in
  bounded batches while preserving deterministic parent follow-up artifacts.
- Supported search calibration can opt into vertical target expansion with
  `--include-search-variants`. Current reviewed seeds cover Google, Naver,
  Daum/Kakao, Bing, Yahoo Search, and Yahoo Japan Search variants such as News,
  Images, Videos, local/place, shopping, blog/cafe, and Q&A where the provider
  exposes a stable search URL. These are calibration seeds only and must be
  promoted separately from broad search-page readiness.
- Yahoo Search vertical calibration uses `images.search.yahoo.com`,
  `news.search.yahoo.com`, and `video.search.yahoo.com`. Provider vertical
  search links remain calibration/navigation surfaces and are classified as
  low-value destination probes so they do not become maintained child
  follow-up evidence.
- The latest unattended `search.en-US` live calibration with query
  `tokyo hotel` promoted one Yahoo Search read-only result capture action.
  Google Search was blocked by unusual-traffic/CAPTCHA/not-a-robot signals in
  the unattended browser, and Bing was blocked by solve-the-task challenge
  signals. Yahoo Search destination discovery now treats Yahoo home and
  UserVoice feedback links as low-value provider shell surfaces, producing 0
  promotable destination hints on the follow-up calibration pass.
- The latest profile-backed Google Search `search.en-US` calibration with
  query `tokyo hotel` used `google-search-cdp`, `--persistent-profile`, and
  Chrome channel to recover from the unattended challenge. It promoted
  maintained result capture plus destination extraction actions, filtered
  Google WebHP/Home, Labs, apps/products, Search vertical, and Maps vertical
  utility links as provider-shell surfaces, and passed explicit profile-backed
  `evidence-run` final claim gate with 138 artifacts and 4 claims. The
  corrected bounded 5-follow-up retry avoids reusing the still-leased parent
  profile for child evidence. The first wide retry exposed an intent false
  positive where `Tokio Hotel` Wikipedia/music results looked useful for a
  hotel-commerce query. Destination query-intent hardening now rejects those
  generic/media candidates unless the child evidence supports the commerce
  intent. The latest wide retry passed final claim gate with 130 artifacts and
  4 claims, produced useful child captures for Booking.com, Agoda, and Google
  Travel, and classified TripAdvisor Korean access limitation plus Expedia
  human/bot challenge pages as blocked child evidence. Google Search recipe
  candidates now include explicit travel/hotel module capture and destination
  extraction selectors for `/travel/hotels`, `/travel/search`, and SPA-style
  `data-travel-url`, `data-hotel-url`, and `data-offer-url` attributes.
  Profile-backed repeated calibration removed broad Google news/video/travel
  `div:has(... ) a[href]` extraction candidates from maintained export and now
  prefers the direct `#search a[href*="/travel/hotels"]` selector. A focused
  exported action file followed only `https://www.google.com/travel/hotels/Tokyo`
  and passed final claim gate with 154 artifacts, 5 claims, and one useful
  commerce child destination.
- Yahoo Japan vertical search URLs for News, Maps, Shopping, and
  Chiebukuro/Q&A are also low-value navigation surfaces. Broad page-shell
  extraction containers such as `#contents` are blocked from maintained
  `extract_destinations` export; narrower repeated result-card selectors such
  as `.sw-Card` may be exported for explicit review.
- Bing unattended search may require a longer wait before result selectors are
  visible and can also show solve-the-task challenge pages. Those challenge
  phrases are classified as bot-block evidence. Broad `#b_results` selectors
  are capture scopes only; maintained destination extraction should use narrower
  result-card selectors such as `#b_results .b_algo`.
- Destination triage resolves common search redirect URLs before scoring,
  selected child execution, and per-domain budgeting. Bing `ck/a?u=...`,
  Google `/url?q=...` and `/aclk?adurl=...`, Naver desktop/mobile redirect
  params, and Yahoo/Yahoo Japan `/RU=...` paths keep the raw browser-visible
  href in source-navigation action evidence, but child runs use the resolved
  target URL.
- source coverage calibration plans record target detection metadata for each
  reviewed seed, including detected platform/source family and cross-platform
  variant counts. This makes search-origin news verticals that promote under
  `naver_news` or `daum_news` portal groups explicit before batch calibration.
- explicit bounded fallback follow-up execution through
  `sourceNavigation.fallbackFollowUps`,
  `sourceNavigation.maxFallbackFollowUps`,
  `--source-navigation-fallback-followups`, and
  `--source-navigation-max-fallback-followups`. The default remains disabled;
  when enabled, downgraded selected child evidence can trigger a bounded pass
  over unattempted fallback candidates and rebuild final destination triage
  with effective follow-up/per-domain budgets.
- child-page evidence-density summaries for selected destination follow-ups.
  Evidence-run now records selected child artifact count, claim count, browser
  capture count, obstruction count, page text length, title/final URL, query
  overlap tokens, query/evidence script-family diagnostics, and evidence
  warnings in destination triage, then downgrades selected child destinations
  to low-value, off-topic, or blocked when the browser-visible child evidence
  does not support the query.
- deterministic destination score breakdowns for rank, kind, query overlap,
  authority, freshness, source-family fit, source-family scoring profile,
  profile adjustment, external destination, and warning penalties.
  Authority/freshness/source-family signals are recorded in
  `destination_candidate` and `destination_triage` artifacts so search,
  map/local, blog/content, portal/news, travel booking, commerce,
  video/social, and generic follow-ups can be audited with context-specific
  weights.
- deterministic destination decision reason codes. Destination candidate and
  triage artifacts preserve `reasonCodes.positive` and
  `reasonCodes.negative` arrays for selection, rejection, and child-evidence
  verdicts, including query overlap, official-domain match, fresh publisher
  article, local place match, visible price/offer, transcript/OCR evidence,
  duplicate, portal shell, thin content, blocked surface, private/login,
  paywall, unsupported destination, domain budget, top-K budget, off-topic,
  possible query-script mismatch, and stale/mismatched source reasons.
- destination visible metadata profiling. Destination candidates now preserve
  deterministic browser-visible URL/link-text metadata including text snippet,
  visible years, recent/stale year hints, price/offer-like text,
  rating/review-like text, local/place-like text, and publisher/article-like
  text. These metadata fields make Google/Naver result-card QA more auditable
  before child evidence runs. Destination triage summaries and final reports
  aggregate the same metadata pressure so QA can compare source candidates
  without opening every candidate artifact.
- destination candidate-kind aggregation. Destination triage summaries and
  final reports now aggregate all, selected, useful, and rejected candidate
  kinds so QA can see whether a run was dominated by news, blog, official,
  map/place, review, community, commerce, media, or generic destinations.
- destination query-intent scoring. Destination candidates now preserve a
  deterministic query intent (`fresh_news`, `official_fact`,
  `experience_review`, `local_place`, `commerce_offer`, `media_content`, or
  `general`) and add query-intent score/reason signals so the preferred child
  source can change with the user's question. Query-intent detection includes
  English, Korean, and Japanese keywords for news, official facts, reviews,
  local places, commerce/offers, and media. Final reports aggregate query
  intent counts.
- destination candidate kind and visible metadata classification now include
  Korean and Japanese visible link-text triggers for news/article, blog/post,
  official/homepage, review/rating, local/place, commerce/price/booking, and
  media/image/video candidates. This improves Naver, Google, and Japanese
  portal destination triage when URLs are generic but result-card text is
  browser-visible.
- deterministic cross-script query aliases for common local/travel/commerce/
  media terms. Candidate scoring and child-evidence summaries can match
  queries such as `seongsu cafe` or `tokyo hotel price` against browser-visible
  Korean/Japanese text such as `성수 카페` or `東京 ホテル 価格`, while unmatched
  cross-script evidence remains flagged as possible query-script mismatch.
- destination triage reason-code aggregation in `DestinationTriageSummary` and
  final reports, so repeated real-site calibration can compare positive and
  negative reason pressure without opening every detailed triage artifact.
- map/search destination QA hardening. Google Maps `/maps/search/<query>` and
  Naver Map `/p/search/<query>` path queries are now normalized into child
  evidence query diagnostics, benign Google Maps place URL parameters such as
  `authuser=0` are no longer treated as login/private surfaces, and same-host
  place-detail URLs are not counted as `portal_shell` reason codes merely for
  staying on the map provider domain.
- map/local promoted-action QA now distinguishes useful, weak, and capture-only
  cases: Google Maps can run one useful child place follow-up for `seongsu
  cafe`; KakaoMap can run a child follow-up but downgrades a mismatched result
  with script-mismatch and retry diagnostics; Naver Map remains capture-only
  until narrower destination selectors are calibrated.
- the latest Korean-query Naver Map maintained action verification passed final
  claim-gate with parent map/OCR captures but produced 0 follow-up requests,
  0 destination candidates, and `destinationTriage.status: "no_candidates"`.
  Treat this as capture-ready, not natural-deepening-ready.
- a later explicit Naver Map client-state verification against the same
  Korean query extracted 2 Naver Place restaurant destination candidates from
  `window.__APOLLO_STATE__`, selected 1 bounded child follow-up, and passed
  final claim-gate. A follow-up live smoke now opens the selected child as
  `map.naver.com/p/entry/place/<id>` instead of `place.naver.com/<type>/<id>`.
  The child run reached the Naver Map entry page, but Naver returned a visible
  service-limit page for excessive access; this is now classified as
  `bot_block` obstruction evidence, destination triage reports
  `blockedCount: 1`, and the run still recommends a wider follow-up budget.
  Treat this as natural-deepening extraction ready for explicit recipes, but
  not yet maintained useful-evidence ready for Naver Place pages.
- child evidence density has a first frame-aware page-capture pass. Local
  workflow coverage now proves a selected child destination whose useful text
  appears only inside an accessible iframe is counted as visible text and query
  overlap, allowing destination triage to mark it useful. Live Naver Place still
  needs accessible child-page validation, OCR/scoped capture tuning, and
  network/profile retry handling before maintained useful-evidence readiness.
- child evidence summaries now distinguish successful browser page-capture
  records from failed/partial page-capture artifacts. Failed child opens expose
  `browserCaptureFailedRecords`, `browser_capture_failed`, and
  `failed_browser_capture` instead of being counted as successful browser
  capture evidence.
- browser-visible Naver Map/Place service-limit text such as "service use is
  restricted" and "excessive access request" is classified as `bot_block`, so
  child Place runs blocked by provider throttling are not mistaken for weak or
  off-topic evidence.
- the latest single read-only Naver Map calibration with SPA attribute
  candidates found 51 selector candidates, 5 matched selectors, 0 blocked
  signals, no matched `data-*` place selectors, and only broad visible
  `#root a[href^="http"]` destination fallback. The new destination probe
  reported 2 usable links for that broad fallback, but
  `promotableCandidateCount` was 0 because the sample URLs were provider
  shell/login URLs rather than place/review/official-site destinations. The
  frame-aware pass saw 5 frames and still found no narrow Naver Place/entry
  destination selector matches. The follow-up global `destinationDiscovery`
  pass found 57 raw candidates, 4 usable URLs, 0 promotable URLs, and 4
  non-promotable URLs consisting of Naver home/login links plus map-shell hash
  anchors. This is now stronger evidence that Naver Map still needs narrower
  provider-specific destination discovery.
- map-provider boilerplate filtering now treats Naver portal/help links, Kakao
  corporate/support links, and Google support/policy links from map/place
  contexts as low-value provider shell evidence instead of useful place
  destinations or depth-2 proposals.
- destination selector promotion now distinguishes broad provider shells from
  scoped provider destinations: Naver `#root a[href*="place.naver.com"]` and
  `/p/entry/place` selectors can be promoted after repeated calibration, while
  generic `#root a[href*="map.naver.com"]` remains blocked as too broad.
- Naver Map recipe candidates now include narrower path-scoped Naver Place
  selectors for restaurant, hospital, generic place, and accommodation
  destinations across `data-place-url`, `data-url`, and anchor surfaces. Local
  executor fixture coverage verifies a scoped restaurant selector can extract a
  Naver Place child destination without clicking route, call, reservation, or
  booking controls. Real-site Naver Map remains capture-ready but still needs
  repeated calibration before natural deepening is maintained.
- destination triage fallback diagnostics. When a selected child destination is
  downgraded after browser-visible evidence review while other candidates were
  left unattempted by the top-K budget, `DestinationTriageSummary` and final
  reports expose `unattemptedFallbackCount` and `retryRecommended` so QA can
  distinguish "no useful child evidence exists" from "the follow-up budget or
  selector was too narrow."
- destination triage fallback candidates. When retry is recommended,
  `DestinationTriageSummary.fallbackCandidates` and final reports preserve the
  unattempted fallback candidate IDs, action keys, URLs, domains, kinds, and
  scores, plus whether the candidate was skipped by `top_k_budget` or
  `domain_budget`, so QA can rerun with a wider follow-up or per-domain budget
  against the specific lower-ranked sources that were not attempted.
- destination triage retry advice. When fallback candidates remain,
  `DestinationTriageSummary.retryAdvice` recommends the next
  `maxFollowUps`/`maxFollowUpsPerDomain` values and whether to increase total
  follow-ups, increase per-domain follow-ups, or narrow destination selectors.
  The advice also includes copyable CLI flags such as
  `--source-navigation-max-followups` and
  `--source-navigation-max-followups-per-domain`, so QA can rerun the same
  Google/Naver/source-deepening scenario with a wider bounded budget instead
  of guessing the next command.
- recipe catalog and promotion support for `extract_destinations`: search,
  map/local, commerce, portal/news/community, and generic destination-followup
  recipe candidates now propose multi-link extraction selectors, and repeated
  calibration can export maintained explicit `extract_destinations` actions.
- proposal-only destination deepening artifacts. Browser page capture now
  preserves bounded visible links in metadata, selected useful child
  destinations summarize depth-2 candidates, and parent runs can write
  `destination_deepening_proposal` evidence without executing recursive
  traversal.
- explicit opt-in destination deepening execution. When
  `sourceNavigation.maxDepth` or `--source-navigation-max-depth` is set to `2`,
  evidence-run executes proposed depth-2 candidates under separate depth-2
  count, per-domain, concurrency, timeout, and artifact-count budgets, records
  `destination_deepening_run` evidence, and disables source navigation inside
  deeper child runs to avoid recursion.
- bounded depth-2 deepening concurrency through
  `sourceNavigation.deepeningConcurrency` and
  `--source-navigation-deepening-concurrency`. The default remains sequential;
  explicit higher values run selected depth-2 child evidence workflows in
  bounded batches.
- final destination claim provenance checks. In final mode, claim-gate now
  requires destination evidence claims to cite the parent source-navigation
  action, destination candidate, child follow-up, and deeper proposal artifacts
  required for the destination evidence kind.
- source navigation recipe `expectedStates` and `captureScopes` for verifying
  browser-visible postconditions and capturing selected regions such as map
  viewports, place panels, Google Maps selected-place sheets/reviews/photos,
  portal headline modules, publisher metadata, travel price cards, rate policy
  panels, commerce product cards, seller terms, shipping panels, price badges,
  video/social profile cards, captions, engagement state, public comment/reply
  previews, X/Twitter thread context, frame regions, and overlay text
- provider-specific commerce fixture coverage for Amazon, Walmart, eBay,
  Coupang, Naver Shopping, Gmarket, and 11st. The safe executor now verifies query/filter/
  sort/pagination state, product-card capture, seller/return terms, shipping
  panels, price badges, and anchor plus SPA-style destination extraction
  without cart, checkout, purchase, or account-changing actions.
- TikTok public-visible fixture coverage now has provider-specific selectors
  for post metadata, profile cards, captions, engagement state, public comment
  previews, video frames, overlay text, and anchor plus SPA-style destination
  extraction through `[data-media-url]` and `[data-profile-url]`.
- source navigation recipe candidate plans as `source_navigation_recipe_plan`
  artifacts, with fixture-verified and real-site-candidate selector metadata
  under a `manual_opt_in_only` execution policy
- commerce-specific source navigation plans and manual-only recipe candidates
  for marketplace product-card, seller/return, shipping, and price-badge
  evidence while cart, checkout, purchase, and account-changing actions remain
  unsupported
- provider-specific travel booking manual-only recipe candidates for
  Booking.com, Agoda, Trip.com, and Expedia query/filter/sort/list/pagination/
  offer/price scopes, plus travel security/access challenge signals that
  classify blocked pages, including Expedia human-or-bot challenge pages,
  instead of treating them as missing-selector failures
- portal/news source navigation plans and manual-only recipe candidates for
  Naver/Daum news query, section, recency, headline module, publisher metadata,
  destination follow-up, and obstruction-state evidence while paywall/login
  bypass, comment writes, and unbounded feed crawling remain unsupported
- global community/forum manual-only recipe candidates and local fixture
  coverage for Reddit, Quora, and Stack Overflow query state, section/filter/
  pagination state, article/thread card capture, destination follow-up, and
  destination thread evidence, including destination metadata, question bodies,
  thread bodies, answer bodies, accepted/top-answer markers, comment lists, and
  obstruction-state evidence while login/private community bypass,
  deleted-content bypass, comment writes, and unbounded feed crawling remain
  unsupported
- Cloudflare/security-verification and network-security block phrases are
  classified as browser-visible bot blocks and portal recipe blocked signals.
  Reddit, Quora, and Stack Overflow currently classify as blocked in the
  unattended local browser and require profile/headed retry before maintained
  global community action export.
- first repeated real-site `news_media` / `ko-KR` calibration baseline for
  current Naver News and Daum News search URLs, with promoted read-only article
  capture, destination follow-up, and obstruction-check action files for
  explicit opt-in evidence-run use
- Yahoo News portal recipes now have local safe-executor fixture coverage for
  global news discovery: query state, category/topic navigation, recency/filter
  state, stream item and publisher metadata capture, article follow-up, and
  obstruction capture without paywall/login bypass, comment writes, or
  unbounded feed crawling.
- Reuters portal/publisher recipes now have local safe-executor fixture
  coverage for global news: query/search state, section navigation,
  latest/filter state, story-card and article-body capture, publisher metadata,
  article follow-up, and obstruction capture without paywall bypass, comment
  writes, or unbounded feed crawling.
- first repeated real-site `news_media` / `global` calibration baseline for
  Google News, Yahoo News, and Reuters. All three now have maintained read-only
  portal action files; Google News and Yahoo News also have maintained
  destination extraction, while Reuters has dated article-link selector
  candidates but is currently blocked by DataDome in unattended live
  calibration before child article extraction can be trusted.
- Google News read-link destination extraction now promotes
  `a[href^="./read/"]` after repeated live calibration, and provider shell
  links such as Home, For you, Following, Google apps, account, support, and
  policy surfaces are classified as low-value navigation instead of useful
  child destinations.
- Reuters destination hardening now classifies section/search/privacy/provider
  utility links as low-value, preserves dated Reuters article paths as
  promotable, blocks broad `main a[href*="reuters.com"]` extraction from
  maintained export, and detects DataDome `captcha-delivery.com` challenge
  shells as bot-block evidence during calibration.
- first repeated real-site `search` / `ko-KR` calibration baseline for Naver
  Search and Daum Search result-scope capture, plus authenticated-profile
  Google Search result-scope capture, local-pack capture, right-side
  knowledge-panel capture, and destination follow-up through
  `google-search-cdp`. Manual-only recipe candidates now also cover broader
  Google news/image/video modules, English/Korean/Japanese vertical labels,
  and broader Naver Search news, image, video, place/map, shopping, and view
  vertical labels plus integrated-result, Blog/Cafe, news, map/place,
  shopping/SmartStore, and video destination selectors. Daum Search candidates
  now also cover news, blog, cafe, image, video, place/map, and shopping
  vertical labels plus Daum News, Daum Blog, Tistory, Daum Cafe, KakaoMap,
  Kakao Shopping, and video destination selectors for future repeated
  calibration.
- Naver integrated-search local fixture coverage now verifies query, vertical
  tab, filter, sort, pagination, separate View/Blog/Cafe, News, Place, Image,
  Video, and Shopping module capture, and mixed anchor plus SPA-style
  destination extraction without parent-page click-through.
- Google rich-search local fixture coverage now verifies local/map, news,
  image, video, sponsored module capture, provider-specific vertical tabs, and
  mixed organic/news/local/image/video destination extraction without
  parent-page click-through.
- global/Japanese search top-slot recipe candidates for Bing, Yahoo Search,
  and Yahoo Japan Search. These now cover provider-specific query, vertical,
  filter, pagination, result-selection, and `extract_destinations` candidates
  around Bing `#b_results` / `#b_context`, Yahoo `#web` / `.dd.algo`, and
  Yahoo Japan `#contents` / `#WS2m` / `.sw-Card` surfaces. They now have local
  fixture-verified executor coverage for query, vertical, filter, pagination,
  result-card capture, context-panel capture, and destination extraction, while
  repeated real-site calibration is still required before maintained action
  export.
- knowledge/database recipe candidates for Google Scholar, Wikipedia,
  Namuwiki, PubMed, data.go.kr, KOSIS, RISS, and KIPRIS. These cover
  browser-visible article bodies, result cards, abstracts, citations,
  references, DOI/full-text links, dataset records, statistic tables, academic
  records, and patent details while edit, login, restricted-download, paid
  full-text, and institutional-access controls remain unsupported.
- local safe-executor fixture coverage for Google Scholar as a portal-shaped
  knowledge DB source, covering query state, section/filter state, result-card
  metadata, author/publication metadata, snippets, citation/version links, DOI/
  full-text links, and obstruction-state capture.
- local safe-executor fixture coverage for generic knowledge/database paths on
  Wikipedia, Namuwiki, PubMed, data.go.kr, KOSIS, RISS, and KIPRIS. These
  fixture-verified candidates cover page capture, bounded scroll, and visible
  citation/source/dataset/record destination extraction before repeated
  real-site calibration or maintained export.
- review/local recipe candidates for Yelp and TripAdvisor. These cover
  browser-visible query/location fields, category and filter state, bounded
  pagination, business/listing/rating/review capture, listing/detail/menu/
  review/tourism/user-review destination extraction, external-site redirect
  candidates, and visible obstruction handling for human-check, cookie,
  app-open, login, and security-verification surfaces. They now have local
  safe-executor fixture coverage for query, category, filter, pagination,
  capture, multi-link extraction, and obstruction states, while real-site
  maintained export still requires repeated browser-visible calibration.
- Apple Maps map/local recipe candidates and local safe-executor fixture
  coverage for global regional/safety calibration. Apple Maps now covers query,
  open-now/category filter, viewport, selected-place card, OCR label, review
  context, website/menu/review destination extraction, selector-hint scopes,
  and explicit calibration target generation without route, call, reservation,
  app-open, login, or account-changing automation.
- first repeated real-site `map_local` / `ko-KR` calibration baseline for
  Naver Map, KakaoMap, and Google Maps viewport/OCR-scope capture, with
  promoted read-only action files that pass explicit evidence-run claim gates
- first repeated real-site `content_media` / `ko-KR` calibration baseline for
  Naver Blog and YouTube search pages. Naver Blog has promoted read-only
  content/page-shell capture and obstruction-check action files; YouTube has
  promoted read-only visible metadata and thumbnail overlay capture action
  files. The latest profile-backed YouTube search pass also promotes precise
  watch-title destination extraction with
  `ytd-video-renderer a#video-title[href*="/watch"]` after blocking broad
  renderer links and duplicate-heavy channel thumbnail selectors from winning
  maintained export. Both pass explicit evidence-run claim gates.
- first repeated real-site `social_feed` / `global` calibration baseline for
  Instagram hashtag search and X/Twitter search. Both have maintained
  read-only action files that pass explicit evidence-run claim gates. TikTok
  search currently shows a browser-visible server-error/unavailable-media page
  in the unattended local browser, so readiness classifies it as blocked and
  emits a profile/headed retry command.
- first repeated real-site `community_forum` / `ko-KR` calibration baseline for
  Naver Cafe, DCInside, and Naver Knowledge iN search pages. They have promoted
  read-only page-shell/thread/content-surface capture, destination follow-up
  where visible, and obstruction-check action files that pass explicit
  evidence-run claim gates.
- first repeated real-site `marketplace_transaction` / `ko-KR` calibration
  attempt for Coupang, Naver Shopping, and Gmarket. On the current network all
  three show browser-visible access or bot-check blocks, so the readiness audit
  now reports them as blocked instead of needing repeated calibration. Naver
  Shopping and Gmarket evidence-runs preserve `browser_obstruction` artifacts
  and pass final claim gates.
- first repeated real-site `marketplace_transaction` / `global` calibration
  baseline for Amazon, Booking.com, Agoda, and Trip.com using future
  stay-window travel target URLs. Amazon, Booking.com, Agoda, and Trip.com
  currently have maintained read-only action files that pass explicit
  evidence-run claim gates. Booking.com and Agoda are offer-card capture
  baselines, while Trip.com also has a maintained price/OCR scope.
- collision-resistant long source-navigation scoped capture IDs using compact
  hashed fallbacks when artifact filename truncation would otherwise merge
  distinct real-site captures
- read-only source navigation calibration as `source_navigation_calibration`
  artifacts, with selector match counts, visible counts, text snippets,
  expected text signals, and blocked text signals
- evidence-run `sourceNavigation.calibrate` and CLI
  `--source-navigation-calibrate` support for recording calibration artifacts
  inside the normal workflow
- source navigation recipe catalog proposals from candidates plus optional
  calibration output, with fixture-scoped selectors excluded from real-site
  maintained exports unless a promotable real-site selector was repeatedly
  observed
- repeated-calibration promotion gates for catalog proposals; read-only
  capture/follow-up/extract-destinations/wait actions can become
  `maintained_recipe_ready` only when stable promotable selectors recur across
  the required runs and fixture coverage exists. Promotion review treats
  blocked signals as blocking even when another read-only capture action was
  exported.
- broad page-shell destination selectors such as `#root a[href^="http"]`,
  `body a[href]`, and `[role="main"] a[href^="http"]` are excluded from
  maintained `extract_destinations` export. They are kept as calibration
  evidence but cannot drive trusted child follow-up runs.
- promotion summaries and source coverage readiness audits now track
  `extract_destinations` readiness separately from general capture readiness,
  so a platform can be ready for result/page capture while still needing
  repeated destination-selector calibration before natural search deepening is
  trusted.
- timestamped browser-visible frame sampling
- dense sampling windows around browser-exposed transcript cue hits
- dense sampling windows around OCR text hits when OCR is enabled and available
- dense sampling windows around browser-visible scene-change hits using
  sampled-frame visual fingerprints
- typed dense sampling diagnostics in assessments, covering transcript/OCR/
  scene-change trigger source, hit timestamps, captured timestamps, caps, and
  scene-change distances
- scene-change threshold diagnostics covering comparable/ignored frames,
  unique visual fingerprint count, zero-distance adjacent pairs, fingerprint
  distance min/max/average, p50/p90/p95 distance distribution,
  adjacent pair gap min/max/average seconds, near-threshold below/above counts,
  selected-hit spacing min/max seconds, candidate/selected/omitted hits, and
  nearest below-threshold pairs
- scene-change sampling-density diagnostics classify whether threshold tuning
  is supported by dense enough adjacent frame pairs or whether sparse base
  sampling should be fixed first.
- scene-change threshold recommendations covering keep/lower/raise/review
  decisions, recommended threshold values, selected distance ranges, and
  recommendation reasons
- `--dense-scene-max-hits` / `denseSampling.sceneChangeMaxHits` separates the
  number of scene-change midpoints to expand from the dense-frame capture cap,
  so false-positive tuning can lower hit count without shrinking each dense
  window
- first-class `evidence-run` workflow
- MCP `farm_evidence_run` workflow tool
- `evidence-run --profile <name>`
- `evidence-run --headed`
- optional OCR pass over sampled frame screenshots
- OCR language/min-confidence options plus structured timestamp, confidence,
  word-box, script, price-like token, percent/discount badge, map-label, and
  travel/commerce, rating, distance/duration, business-hours, and
  contact/address, reservation, menu, and commerce-policy text-profile
  metadata for extracted visible text
- per-frame OCR engine failure artifacts. Recognition errors and timeouts are
  preserved as partial `ocr_text` metadata with source frame provenance and
  bounded reasons, and later frames continue unless the run is aborted.
- OCR text-profile price detection requires adjacent currency/amount tokens and
  records empty-text failure metadata
- credentials-gated official API metadata attempts for YouTube, Instagram, and
  TikTok
- opt-in official API integration harness that skips unless explicit env vars
  are set
- recursive redaction of raw credential values from official API response and
  error artifacts
- typed official API provider failure classification for permission,
  ownership, quota, rate-limit, not-found, and unknown failures
- official API credential readiness diagnostics that report ready/missing env
  var references and supported-platform `missing_media_id` cases without
  calling provider APIs or printing token values
- official API readiness and cache diagnostics that separate credential
  readiness from missing-media-ID lookup readiness and provide `nextAction`
  hints for direct media URL or destination follow-up recovery
- partial `official_api_metadata` artifacts for supported listing/search URLs
  where official API collection is requested but a stable media ID is not
  available, written without provider API calls
- per-run official API cache artifacts
- browser-visible obstruction classifier with `browser_obstruction` artifacts,
  assessment status, final report lines, and typed claims when obstruction is
  detected
- configurable cautious overlay dismissal with `browser_overlay_dismissal`
  artifacts when ordinary close/not-now/reject/necessary-only UI is dismissed
  or the pass is explicitly skipped before capture
- local HTTP queue for evidence-run jobs
- HTTP scheduler stats, queued-job cancellation, terminal-job deletion, and
  terminal-job retention/pruning controls
- cooperative running-job cancellation through `AbortController`
- BrowserPool abort handling for open/capture/wait/selector/frame sampling
- scheduler job lifecycle diagnostics including queue/run/total duration and
  abort latency
- evidence-run stage timings for setup, browser work, frame sampling, OCR,
  official API, claim gate, and final report generation
- CLI browser-channel selection for headed login, evidence-run, and calibration
  flows, including `--chrome` as a shortcut for installed Chrome
- `auth-cdp-launch` and `auth-cdp-import` for saving cookies/storage state from
  a user-controlled Chrome DevTools session when direct automated login is
  rejected, including immediate and domain-filtered imports
- first authenticated-profile Google Search calibration recovery using
  `google-search-cdp`: CDP-imported Google/YouTube cookies, headed Chrome
  evidence-run with zero obstruction artifacts, repeated read-only Google
  Search calibration, promoted maintained read-only actions that pass final
  claim gates, narrower result/module scopes such as `#rso` and top-ad capture
  when present, right-side knowledge panel capture through `#rhs`, and
  destination follow-up resolution that skips hash-only self links
- profile-backed English Google Search calibration now exports result capture
  and destination extraction for `tokyo hotel`, while destination triage filters
  Google WebHP/Home, Labs Search, apps/products, Search vertical, and Maps
  vertical utility links as provider-shell surfaces. Child destination evidence
  runs no longer inherit an active parent saved-profile lock; the current
  bounded retry captures useful child pages and preserves travel bot/access
  challenges as blocked evidence.
- package metadata for npm packing
- GitHub Actions CI for `npm ci && npm run verify`
- unit and smoke tests
- portal-native evidence navigation product/architecture/implementation docs
  that merge the latest office-hours and plan-eng-review pass
- information-source coverage registry code and design docs covering
  category/locale top-three planning, explicit ko-KR/en-US/ja-JP representative
  slots, support tiers, and next implementation priorities
- manual-only source navigation recipe candidate planner and CLI inspection for
  real-site calibration work
- read-only source navigation calibration CLI for probing candidates before
  promoting them to maintained provider recipes
- registry-backed source navigation calibration target generator for creating
  reviewed JSON or batch-compatible line target files ordered by local top-slot
  rank
- read-only source navigation calibration batch CLI that runs many target URLs,
  creates per-target run directories, and writes a manifest with
  `--calibration-run-dirs` catalog/export hints
- bounded calibration-batch concurrency through `--calibration-concurrency`
  on `source-navigation-calibrate-batch` and `source-coverage-calibrate`. The
  default remains sequential, concurrency is capped at 5, manifests and loop
  reports preserve the effective value, and persistent-profile calibration must
  stay at concurrency 1.
- search redirect destination normalization through `src/destination-url.ts`,
  used by destination triage so search-portal redirect hosts do not crowd out
  real destination domains in child-run selection.
- evidence-run integrated calibration summaries across CLI/MCP/HTTP workflow
  output
- explicit-opt-in recipe catalog proposal CLI for separating read-only recipe
  snippets from click/fill/select actions that still require human review or
  values
- `source-navigation-catalog --calibration-files <a,b>` support for evaluating
  repeated selector stability before recipe promotion
- `source-navigation-catalog` and `source-navigation-export-recipes` can load
  calibration reports directly from evidence run directories through
  `--calibration-run-dir` / `--calibration-run-dirs`, using `artifacts.jsonl`
  first and raw/structured artifact discovery as fallback
- `source-navigation-catalog` and `source-navigation-export-recipes` can also
  load succeeded run directories directly from `source-navigation-calibrate-
  batch` manifests through `--calibration-batch-manifest` /
  `--calibration-batch-manifests`, preserving failed attempts as warnings
- catalog promotion ignores calibration reports whose platform or source family
  differs from the current recipe plan, preventing Naver/Google/travel/SNS run
  directories from accidentally cross-promoting selectors
- `source-navigation-export-recipes` support for exporting only maintained
  read-only recipes as explicit action JSON while omitting unsafe/manual entries
- `source-navigation-export-recipes --actions-output-file <path>` writes the
  exact action array accepted by `evidence-run --source-navigation-actions-file`;
  `--export-output-file` writes the full bundle and `--fail-empty-export` makes
  automation fail when no maintained actions are ready
- `source-navigation-promote-batch --calibration-batch-manifest <path>` writes
  grouped `catalog.json`, `export.json`, `actions.json`, and
  `promotion-summary.json` files for every platform/source-family group in a
  batch manifest
- `source-navigation-promotion-review --promotion-summary <path>` or
  `--promotion-dir <path>` classifies promoted groups as ready, blocked,
  needing repeated calibration, manual-review-required, or empty, and prints
  evidence-run commands for ready action files
- promotion review preserves destination-extraction readiness metadata for
  each group, including candidate count, ready action count, ready action keys,
  and repeated-calibration/blocking counts
- source coverage calibration plans, batch manifests, promotion groups, and
  ready evidence-run commands preserve profile/headed runtime state so blocked
  platform retry batches can be reproduced with the same `--headed`,
  `--profile`, and `--persistent-profile` flags
- `source-navigation-promotion-review` and `source-coverage-calibrate` can
  carry evidence-run source-navigation budget flags into generated ready
  action-file commands, including `--source-navigation-max-followups`,
  `--source-navigation-followup-concurrency`,
  `--source-navigation-fallback-followups`, `--source-navigation-max-depth`,
  and `--source-navigation-deepening-concurrency`
- `source-coverage-readiness --category <name> --locale <segment>` audits
  registry top slots against promotion summaries and can print calibration
  target lines for actionable not-ready slots, plus `auth-login` setup and
  profile/headed retry commands for blocked promoted slots through
  `--format retry-commands`. Blocked retry commands preserve matching
  `selector-hints.tsv` handoffs by appending `--selector-hints-file <path>` to
  the generated headed/profile calibration command.
- `source-coverage-readiness --format retry-plan` prints those blocked
  profile/headed retries as an ordered Markdown QA handoff with top-slot rank,
  support tier, selector hints, setup commands, retry commands, blocked signal
  counts, reasons, next actions, and a preflight check summary.
- source coverage readiness reports destination-extraction status counts
  (`ready`, `blocked`, `needs_repeated_calibration`, `not_promoted`, or
  `not_applicable`) separately from the overall source readiness status
- `source-coverage-calibrate --category <name> --locale <segment>` writes
  readiness-guided target/plan files and, unless `--plan-only` is supplied,
  runs read-only batch calibration, promotion, promotion review, final coverage
  re-audit, and Markdown report generation. The Markdown report includes
  destination-extraction counts, per-source extraction status, and matched
  blocked-signal pressure so QA can tell capture readiness, child-link
  extraction readiness, and profile/headed retry blockers apart. It also
  includes a `Profile/Headed Retries` section with generated setup/retry
  commands for blocked slots and writes the same handoff to
  `profile-headed-retry-plan.md` plus machine-readable
  `profile-headed-retry-plan.json`. `source-coverage-retry-plan` can read that
  JSON handoff and print validated JSON, Markdown, all commands, setup-only
  commands, or retry-only commands without opening a browser. It can also
  filter by platform, retry priority, and limit so QA can run only the next
  blocked provider retry, and `--output-file` writes the filtered handoff to
  disk for the next session or reviewer. `--format check --fail-check`
  validates the generated retry commands before any profile/headed run. Add
  `--check-files` when the consumer should also fail if referenced
  `selector-hints.tsv` files are missing from disk, and `--check-profiles`
  when it should also fail if the referenced saved browser profile does not
  exist locally yet. `--only-check-ok` filters rendered retry-plan output to
  only the items with no check errors under the selected check options.
  `source-coverage-calibrate` also writes
  `profile-headed-retry-plan-check.json` beside the retry-plan artifacts and
  includes the same preflight summary in `profile-headed-retry-plan.md` plus
  the check status/counts and issue-code lines in the coverage report. Passing
  `--check-files` or `--check-profiles` to `source-coverage-calibrate` makes
  those generated artifacts include the same selector-hint/profile disk-state
  checks.

See `docs/NEXT_TASKS.md` for the current "what was done / what to do next"
handoff list.

Not fully solved:

- safe portal-native navigation execution is still recipe-limited: the
  browser-backed executor, CLI/MCP/HTTP explicit recipe input, expected-state
  assertions, scoped captures, and one-depth follow-up orchestration exist, but
  broad platform recipe catalogs, real-site selector calibration, and provider-
  specific variants are not fully implemented yet. The first Naver/Daum News,
  Naver/Daum Search, Naver/Kakao/Google Maps, Naver Blog, YouTube search,
  Naver Cafe search, DCInside search, and Naver Knowledge iN search real-site
  baselines exist, and manual-only recipe candidates, read-only calibration,
  and catalog proposals exist, but they are not live defaults.
- destination follow-up is still provider-catalog-limited: explicit
  `follow_up` and `extract_destinations` recipes now get bounded destination
  triage with top-K, per-domain, and first child-page evidence-density checks,
  but the system does not yet have broad maintained selectors for arbitrary
  live result cards, portal modules, blog/cafe articles, or video/social pages.
  Explicit depth-2 execution now exists only as opt-in `maxDepth: 2`, not as a
  live default. Provider-specific calibration remains the next step before any
  crawler-like behavior.
- information-source coverage registry top slots are planning seeds, not
  refreshed live market-share claims
- arbitrary third-party transcript extraction without official credentials
- arbitrary audio transcription from platform video
- OCR engine accuracy tuning and broader non-English validation beyond the
  deterministic OCR text-profile fixtures and opt-in integration harness
- scene-change detection tuning against real media pages
- real-site strategy tuning for Naver, Google, travel booking, Instagram/TikTok,
  and anti-automation robustness
- Google account login can reject direct Playwright-controlled browser windows;
  retry with installed Chrome channel first, then with a user-controlled CDP
  import flow rather than asking for credentials in chat. The first
  `google-search-cdp` profile works for Google Search capture/calibration and
  promoted follow-up execution, including first hotel/result-card and
  right-side knowledge-panel variants. The first local-pack variant is also
  promoted and evidence-run verified for `coffee near Seoul Station`, including
  `#Odp5De` place cards, detail text, map canvas, and local thumbnails.
  Broader locale, news, and image/video variants still need calibration.
- production multi-agent scheduling and hard interruption of stuck low-level
  browser operations
- published npm distribution
- remote shared server mode

## Next Work Candidates

1. Continue real-site selector calibration and provider-specific fixture
   variants. Naver-like tabs, Google-like filters/result-card/gallery flows,
   Google map/news/ad modules, Google Maps selected-place sheets/reviews/photos
   and map labels, Naver/Daum news modules, Naver Cafe public/member states,
   KakaoMap panels, pagination, media galleries, video/social obstruction, map
   panels, travel/commerce detail flows, richer room/rate cards, commerce
   product/seller/shipping/price-badge scopes, blog/cafe source and related
   link extraction, and video/social public
   profile/caption/engagement/comment/thread/frame/overlay/destination scopes
   have first local fixture coverage.
   X/Twitter public post state is now fixture-backed for explicit read-only
   recipes. Naver/Daum
   News, Naver/Daum Search, Naver/Kakao/Google Maps, Naver Blog, YouTube
   search, Naver Cafe search, DCInside search, and Naver Knowledge iN search
   also have first repeated read-only real-site baselines. Instagram hashtag
   search and X/Twitter search have first repeated global social-feed read-only
   baselines; TikTok search is blocked by a visible server-error/
   unavailable-media surface in the unattended browser. Expedia repeated
   calibration is blocked by a visible "Bot or Not?" human/bot challenge in
   the unattended browser. Use
   `source-navigation-calibration-targets` to generate
   reviewed target files, `source-navigation-calibrate-batch` for repeated
   read-only runs, or `source-navigation-calibrate` / evidence-run calibration
   outputs for single runs, then pass the resulting run directories to
   `source-navigation-catalog --calibration-run-dirs` before promoting any
   maintained provider recipes. After `source-navigation-promote-batch`, run
   `source-navigation-promotion-review` to identify ready action files versus
   groups needing repeated calibration or manual review. Run
   `source-coverage-readiness` by category/locale to see which top slots still
   need calibration before the next batch. Use
   `source-coverage-readiness --format retry-commands` with promotion output to
   generate `auth-login` setup plus profile/headed retry commands for blocked
   slots such as TikTok, Korean commerce, global community, or Expedia, or use
   `source-coverage-readiness --format retry-plan` when a ranked Markdown QA
   checklist is easier to review. Use
   `source-coverage-calibrate --plan-only` to create the next reviewed batch
   handoff without opening browsers, or omit `--plan-only` to run the full
   read-only calibration loop.
2. Harden destination extraction fixtures with richer Google/result-card,
   blog/cafe article, video/social media-card, and provider-specific
   `extract_destinations` selectors, then run additional real-site selector
   calibration while keeping execution recipe-gated.
3. Expand destination triage beyond deterministic URL/text scoring: the first
   browser-visible child-page evidence-density and query-overlap pass exists,
   deterministic authority/freshness/source-family scoring exists, and
   source-family scoring profiles now weight search/map/blog/portal/travel/
   commerce/video/generic contexts differently. Deterministic positive/negative
   reason codes now preserve and summarize why a destination was selected,
   rejected, or downgraded after child capture. Proposal-only deeper-hop
   artifacts, explicit depth-2 execution opt-in, separate depth-2
   timeout/artifact budgets, and final destination claim provenance checks now
   exist, but broader provider selector calibration and real-site reason
   threshold tuning still need work.
4. Tune OCR engine accuracy with real screenshots and non-English fixtures now
   that `tesseract.js` is an optional peer dependency.
5. Tune scene-change dense sampling thresholds with the new recommendation
   diagnostics and add broader real media fixtures.
6. Run and tune real-account official API integration checks with explicit
   credentials.
7. Tune source strategies and navigation action templates on real Naver Cafe,
   TikTok with profile/headed state where appropriate, Google Search with
   profile/headed state, video/social, and travel/commerce pages.
8. Add broader real screenshot OCR fixture coverage for maps, travel price
   screenshots, and Korean/Japanese text.
9. Turn the local HTTP scheduler into a production-safe remote service only if
   auth, storage retention, cancellation, and concurrency controls are designed.
10. Publish npm distribution after package metadata, docs, and CI are stable.
11. Re-run `node .\dist\cli.js register-all` only after moving the repo or
   rebuilding agent host config from scratch.
