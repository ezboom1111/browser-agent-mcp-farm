# Product Development Plan

This is the top-level product plan for Browser-Agent MCP Farm after the
portal-native evidence navigation office-hours session and engineering review.

## Product Position

Browser-Agent MCP Farm is not a general autonomous crawler. It is a local,
evidence-first browser research system for agents. It preserves what the browser
could actually see, derives typed artifacts when lawful and deterministic, and
blocks final claims that are not backed by registered evidence.

The product direction is now:

> Turn portal-native research actions into auditable evidence workflows.

The broader coverage direction is:

> Treat Google, Naver, YouTube, Instagram, TikTok, maps, communities, commerce,
> databases, and AI answer engines as information-source categories that map
> down to evidence mechanics, not as one-off scrapers.

The next product gap is deeper destination triage:

> When a portal or search surface points to news articles, blog posts,
> official websites, maps, reviews, videos, or commerce pages, collect those
> destination pages as bounded child evidence runs, score whether they are
> useful for the user's query, and keep portal-display evidence separate from
> destination-content evidence.

The office-hours decision for this gap is:

> A search result is only a lead. The product must preserve the parent search
> or portal surface, follow only bounded and justified destination candidates,
> then judge the child page from browser-visible evidence before any final
> claim can rely on it.

The natural deepening product requirement is:

> When the user starts from Google, Naver, or another portal, the system should
> behave like a careful researcher: preserve the result surface first, identify
> visible news, blog, official-site, map/place, review, community, product, or
> media destinations, open only the bounded candidates that look justified, and
> then decide from the child page whether the destination was actually useful.

Current user-facing answer:

> Partially yes, but not yet as a default autonomous behavior. Evidence-run can
> already execute explicit destination recipes, extract visible candidate links,
> run bounded child evidence workflows, judge child usefulness after capture,
> and optionally execute depth-2 deepening when requested. What is still missing
> is enough provider-maintained selector coverage and QA to make Google/Naver
> style deepening feel natural across arbitrary live result sets.

Current live calibration signal:

> Google Search with the imported Chrome profile can already follow a real
> result destination from a maintained selector. Google Maps can follow a
> visible place destination in the tested map flow. KakaoMap can attempt a
> place follow-up and correctly downgrade weak child evidence. Naver Map is
> still parent-capture ready but destination-extraction not-ready in the latest
> Korean-query run: the maintained action file captured the map viewport/OCR
> scopes, passed final claim-gate, and produced zero child follow-ups. That is
> the right failure mode. It proves the system is not pretending that broad
> provider-shell links are real place/content evidence. A follow-up calibration
> with destination probes confirmed the same boundary: the broad fallback
> exposed provider shell/login links, not place, review, booking, menu, or
> official-site destinations; the probe marked all sampled links
> non-promotable. A later global destination-discovery pass scanned visible
> links outside the planned selectors and found only Naver home/login links and
> map-shell hash anchors such as `#section_content` and `#header`; those are
> now also classified as non-promotable, so the source correctly remains
> capture-ready but not natural-deepening-ready. Catalog, promotion, and
> coverage-readiness reports now carry global destination-discovery summaries,
> so QA can see whether a source has promotable sample targets that need a
> narrower maintained selector, or only low-value/login/provider-shell links
> that should keep the source capture-only. Catalog entries also derive manual
> selector hints from promotable discovery samples, such as host/path-scoped
> anchor or SPA attribute selectors, so the next calibration pass can start
> from observed browser evidence without treating the hint as an executable
> maintained recipe.
> Naver Map recipes now also include first-party path-scoped Naver Place
> restaurant, hospital, generic place, and accommodation destination candidates
> across `data-place-url`, `data-url`, and anchor surfaces. These are still
> calibration candidates until repeated real-site promotion passes, but local
> fixture execution proves scoped Naver Place destination extraction works
> without route/call/reservation/booking actions.
> A newer client-state extraction path now handles the harder Naver Place list
> shape where visible cards expose place names and review/address text but no
> usable `href` or SPA destination attribute. Explicit
> `extract_client_state_destinations` actions can snapshot browser-received
> `window.__APOLLO_STATE__` from accessible frames and derive bounded Naver
> Place child destinations. These now execute through
> `https://map.naver.com/p/entry/place/<id>` while preserving canonical
> `https://place.naver.com/<type>/<id>` provenance as `originalUrl`.
> Optional selectors for this path are now frame-aware, which matches the live
> Naver Map layout where the list surface is inside an accessible result iframe.
> A live `성수 카페` run extracted 2 Place candidates and executed 1 child run,
> but the selected Place page yielded empty visible text, so the next product
> step is Naver Place child evidence density before maintained readiness.
> The latest smoke confirms the selected child now opens the executable Naver
> Map entry URL rather than the DNS-failing Place host. In this environment the
> child page returns a browser-visible Naver service-limit / excessive-access
> message; that page is now classified as `bot_block`, and destination triage
> reports the child as blocked instead of useful.
> If that blocked child still exposes a deeper visible candidate such as a
> `pcmap.place.naver.com/.../home` URL, destination triage now preserves it as
> `blockedChildRecoveryCandidates` and emits `blockedChildRecoveryAdvice` with
> deterministic Chrome persistent-profile setup and headed evidence-run
> commands, plus ordered machine-readable command steps for QA automation.
> This is a reviewed QA recovery handoff, not an automatic depth-2 execution
> path or gate bypass.
> The `destination-recovery-plan --run-dir <evidence-run-dir>` CLI can now
> extract those steps from completed `destination_triage` artifacts and print
> JSON, Markdown, setup-only commands, retry-only commands, or all commands
> without opening a browser. It can also run read-only preflight checks for
> command shape and saved-profile readiness before a headed retry is launched.
> Markdown handoffs include the same preflight summary, so QA can see profile
> readiness and command-shape failures beside the setup/retry commands.
> The client-state route is now part of the manual recipe/catalog/promotion
> system: Naver Map recipes expose `extract_client_state_destinations` as a
> separate `destination-followup` alternative, catalog calibration separates it
> from link-based `extract_destinations`, and promotion can export the
> client-state action when repeated calibration proves it stable.

> The first density hardening pass is now implemented: browser page capture
> aggregates visible text and visible links across accessible frames and records
> `visibleTextFrames` diagnostics. Local workflow coverage proves iframe-only
> child evidence can produce query overlap and a useful destination verdict.
> Child evidence summaries also distinguish successful page-capture artifacts
> from failed/partial child opens, exposing `browserCaptureFailedRecords` and
> `failed_browser_capture` warnings when the destination could not be captured.
> Live Naver Place still needs accessible child-page validation plus OCR/scoped
> capture tuning and provider-throttle retry coverage before it is considered
> maintained useful-evidence ready.

This means the development scope explicitly includes natural search-to-source
deepening, but the product bar is provider-calibrated and evidence-gated rather
than "click everything that looks relevant." A destination is useful only after
the child page produces browser-visible evidence that matches the user's query
and source context. If the child page is thin, off-topic, blocked, private,
paywalled, unsupported, or just a portal shell, the run must say that and keep
the final claim gate from relying on it.

Different destination types answer different user intents. Official sites are
preferred for stable entity facts, publisher/news pages for recent events,
blogs and communities for lived experience, map/place pages for local state,
reviews for reputation, commerce/travel pages for offer and price evidence, and
video/social pages for browser-visible media or public engagement evidence. The
triage layer must therefore score usefulness against the user question, not only
against link rank.

For Korean research, the default entry is Naver-first: Search, Blog, Cafe, Map,
Place, Image, Shopping, Knowledge iN, and visible portal modules. For global
research, the default entry is Chrome/Google-first: Google Search, Google Maps,
then the relevant destination or vertical platform. Agoda and Trip.com are
examples of travel/commerce surfaces, not special product boundaries.
Search calibration now has an explicit supported-platform vertical expansion
mode. Google, Naver, Daum/Kakao, Bing, Yahoo Search, and Yahoo Japan Search can
generate reviewed vertical targets such as News, Images, Videos, local/place,
shopping, blog/cafe, and Q&A where the provider exposes a stable search URL.
This keeps "search page captured" distinct from "that vertical/module is ready
for maintained evidence extraction."
Yahoo Search uses its current vertical hosts for Images, News, and Video
calibration. Those provider vertical links are calibration/navigation surfaces;
they are intentionally not treated as destination evidence unless a narrower
external result, publisher, product, place, or media URL is promoted.
Yahoo Japan follows the same rule. Vertical search URLs for News, Maps,
Shopping, and Chiebukuro/Q&A are not child-destination evidence by themselves,
and broad page-shell containers such as `#contents` are not maintained
extraction recipes. A live Yahoo Japan smoke currently promotes `.sw-Card` as
the narrower explicit result-card extraction surface.
Bing search has a similar provider-specific rule plus an obstruction boundary:
live unattended runs can show delayed result shells or solve-the-task challenge
pages. Those challenge strings are classified as bot-block evidence; broad
  `#b_results` captures are allowed for SERP state, but maintained destination
  extraction should promote narrower card selectors such as `#b_results .b_algo`.
Search-engine redirect links are resolved before destination scoring and child
evidence execution so Bing, Google organic/ad redirects, Naver desktop/mobile
redirects, and Yahoo/Yahoo Japan redirect hosts do not consume the per-domain
follow-up budget in place of the real destination domain.
Google News now has the same narrower-selector treatment for live news
deepening: repeated calibration promotes `a[href^="./read/"]` article links
for explicit destination extraction, while Home, For you, Following, Google
apps, account, support, policy, and other Google utility surfaces are classified
as low-value provider navigation. An explicit bounded evidence-run can now
extract Google News read-link candidates and open a child publisher article
while keeping budget-limited alternatives and child obstruction verdicts
auditable.
The coverage loop also records how each target URL will be detected before the
browser run. That matters because a search-origin vertical can promote under a
different maintained group, such as Naver/Daum news URLs becoming portal-news
calibration rather than generic search readiness.

## What Exists Today

Version `0.3.0` already includes:

- isolated Playwright BrowserContext leases
- MCP, CLI, and local HTTP evidence-run entry points
- browser-visible capture bundles with screenshots, HTML, text, metadata,
  network logs, console logs, and media indexes
- platform capability maps for YouTube, Instagram, TikTok, and generic sources
- source strategy artifacts for search, map, blog, portal/news, travel booking,
  video/social, and generic web sources
- bounded destination triage for explicit `follow_up` and
  `extract_destinations` actions, including top-K and per-domain child-run
  budgets before one-depth destination evidence runs
- recipe catalog, promotion, and coverage-readiness diagnostics for global
  destination discovery, including promotable/non-promotable counts and warning
  pressure when planned selectors miss
- manual selector hints derived from promotable discovery sample targets,
  carried in catalog output, written as promotion-group `selector-hints.tsv`
  handoff files, preserved in coverage readiness/calibration loop reports, and
  counted in promotion/readiness summaries. Hints now include provider/container
  scoped selector suggestions where possible, so a discovered raw attribute
  selector can become the next reviewed calibration candidate without treating
  it as maintained automation. The same TSV handoff can now be supplied to
  `source-navigation-calibrate`, `source-navigation-calibrate-batch`, or
  `source-coverage-calibrate` with `--selector-hints-file` or
  `--selector-hints-files`; this feeds the scoped suggestions back into
  read-only calibration, not direct evidence-run execution. Coverage
  calibration plans, reports, and batch manifests preserve the selector-hint
  input file paths so profile/headed provider retries remain reproducible.
  `source-coverage-readiness --format retry-plan` now turns blocked retry slots
  into an ordered Markdown QA handoff with selector hints, setup commands,
  headed calibration commands, blocked signal pressure, reasons, and next
  actions.
- `extract_destinations` can now read visible non-anchor URL attributes such
  as `data-href`, `data-url`, `data-target-url`, `data-place-url`,
  `data-source-url`, `data-item-url`, `data-product-url`, `data-profile-url`,
  and `data-media-url` from SPA-style result/place/product/media cards when
  the element has visible text. Provider-scoped recipe candidates now expose
  those attributes for Google/Naver search, map, commerce, and video/social
  calibration without clicking the parent card.
- Broad generic SPA URL attributes are calibration evidence only. A repeated
  match on a shell selector such as `#search [data-url]` is not enough for
  maintained export unless the selector is narrowed by provider/path or uses a
  semantic attribute such as product, place, media, or profile URL.
- Destination selector calibration now checks more than visibility for
  `extract_destinations`: matched selectors are read in place to verify that
  they expose usable HTTP(S) destination links. A selector that is visible but
  yields zero usable links stays calibration-required, even if it repeats.
- Destination probes also classify sampled links with the same low-value,
  login/private, unsupported, and source-family-fit concepts used by
  destination triage. A selector that yields only provider shells, login links,
  help/policy pages, or other non-promotable links cannot become a maintained
  destination recipe.
- Selector and destination-link calibration now inspects browser frames, not
  only the top document. This matters for map, portal, media, and embedded
  result surfaces where useful cards can render inside iframes. Frame counts
  and first matched/visible frame URLs are preserved as calibration diagnostics.
- Read-only calibration also records global `destinationDiscovery` diagnostics
  for `extract_destinations` actions. When planned destination selectors miss,
  calibration scans visible links and SPA destination attributes across
  accessible frames to show whether narrower provider-specific selectors should
  be added next. This discovery output is diagnostic only: same-document hash
  links, provider shell anchors, portal home links, login/account links,
  help/policy pages, and unsupported URLs are counted as non-promotable rather
  than becoming child-run candidates.
- Destination probe and discovery samples now preserve classified target
  details, not only URLs: visible text, anchor versus attribute source,
  attribute name, frame URL/name when available, and the warnings that made a
  target non-promotable. This makes repeated Google/Naver calibration more
  actionable because the next selector can be designed from browser-visible
  evidence instead of raw URL counts.
- selected destination child runs now feed browser-visible evidence-density
  signals back into triage: artifact count, claim count, capture count,
  obstruction count, page text length, title/final URL, query-overlap tokens,
  and query/evidence script-family diagnostics can downgrade a selected
  destination to low-value, off-topic, or blocked while preserving why direct
  query overlap may have failed on cross-script pages
- destination candidate scores now preserve deterministic rank, kind, query,
  authority, freshness, source-family fit, external-destination, and warning
  breakdowns before child execution
- destination scoring now uses context-specific profiles for search,
  map/local, blog/content, portal/news, travel booking, commerce, video/social,
  and generic web follow-ups so the same candidate kind is weighted differently
  depending on source family
- destination candidates and final triage now preserve deterministic
  `reasonCodes.positive` and `reasonCodes.negative` values such as
  `query_overlap`, `official_domain_match`, `fresh_publisher_article`,
  `local_place_match`, `price_or_offer_visible`, `transcript_or_ocr_hit`,
  `query_script_mismatch_possible`, `portal_shell`, `thin_content`,
  `blocked_surface`, and `unsupported_destination`
- destination candidates now also preserve `visibleMetadata` derived from the
  browser-visible URL/link text: text snippets, visible years, recent/stale
  year hints, price/offer-like text, rating/review-like text, local/place-like
  text, and publisher/article-like text. This gives real-site Google/Naver
  calibration a compact way to audit why a result-card child candidate looked
  like a news, blog, official, review, map/place, commerce, or media source
  before opening it. Destination triage summaries and final reports aggregate
  the same metadata counts, so QA can compare candidate pressure at the report
  level before drilling into artifact JSON.
- destination candidate-kind and visible-metadata classification now includes
  Korean and Japanese result-card text triggers for news/articles, blogs/posts,
  official homepages, reviews/ratings, local/place surfaces, commerce/booking
  offers, and media/image/video surfaces. This matters for Naver, Google, and
  Japanese portal runs where the destination URL may be generic but the
  browser-visible title/snippet carries the useful source type.
- destination query matching now includes a deterministic cross-script alias
  layer for common local, travel, price, review, booking, media, and official
  terms. This lets an English transliteration query such as `seongsu cafe` or
  `tokyo hotel price` overlap with browser-visible Korean/Japanese evidence
  such as `성수 카페` or `東京 ホテル 価格` before a useful child page is
  downgraded as off-topic.
- destination triage summaries and final reports now aggregate candidate-kind
  distribution for all, selected, useful, and rejected destinations. This makes
  repeated Google/Naver/platform calibration easier to compare because the
  report shows whether a result set is dominated by news, blog, official,
  map/place, review, community, commerce, media, or generic candidates.
- destination scoring now includes deterministic query-intent inference. A
  query can be classified as fresh-news, official-fact, experience/review,
  local/place, commerce/offer, media-content, or general, and candidate scores
  gain intent-fit weight. This directly supports the requirement that the
  preferred child source can change with the user's question instead of always
  favoring the same high-authority result type. Intent detection now includes
  English, Korean, and Japanese keywords so Naver/Google/Japanese portal
  research can distinguish news, 후기/리뷰, 공식, 지도/장소, 가격/예약, and
  video/image-style questions before child runs.
- destination triage summaries and final reports now aggregate positive and
  negative reason-code counts so repeated real-site calibration can compare
  why destinations were selected, rejected, or downgraded across runs
- destination triage summaries and final reports now also expose fallback
  diagnostics. If a selected child destination is downgraded after capture while
  other candidates were left unattempted by the top-K budget, the run reports
  `unattemptedFallbackCount` and `retryRecommended` instead of hiding the fact
  that more candidate sources need a wider follow-up budget or narrower
  selectors. The summary now also preserves concrete fallback candidate IDs,
  kinds, URLs, domains, scores, and the skipped-budget reason
  (`top_k_budget` or `domain_budget`), so QA can inspect or rerun the exact
  lower-ranked source candidates rather than only seeing a count. The summary
  also emits retry advice with recommended `maxFollowUps` and
  `maxFollowUpsPerDomain` values plus copyable CLI flags for the next bounded
  pass. This is the practical QA loop for the Google/Naver deepening question:
  when the first clicked child page is useless but another news, blog,
  official-site, review, place, product, or media candidate was left behind,
  the final report tells the tester whether to widen total follow-ups, widen
  the per-domain budget, or tighten the provider selector.
- promotion summaries and source coverage readiness audits now track
  destination-extraction readiness separately from general page/result capture
  readiness. This matters because a source can be ready for parent evidence
  capture while still not ready to choose and follow many child destinations.
- broad page-shell link selectors are intentionally not enough for natural
  deepening. If calibration only proves a selector such as
  `#root a[href^="http"]`, the source remains destination-extraction not-ready
  until narrower result, place, product, article, profile, or review selectors
  are repeatedly observed.
- path-based map search URLs are normalized for destination QA. Google Maps
  `/maps/search/<query>` and Naver Map `/p/search/<query>` now feed the same
  child-evidence query diagnostics as query-string searches, and Google Maps
  place URLs with benign `authuser=0` parameters are not rejected as login
  surfaces.
- useful child destinations can emit `destination_deepening_proposal` artifacts
  for visible depth-2 candidates. These proposals preserve candidate URLs,
  visible link text, kind, signals, and warnings. Default execution still stops
  at depth 1, but explicit `maxDepth: 2` opt-in can now execute proposed
  deeper candidates under separate depth-2 count, per-domain, timeout, and
  artifact-count controls and records `destination_deepening_run` evidence.
- timestamped frame sampling and dense sampling around transcript, OCR, and
  scene-change hits
- scene-change diagnostics for real media tuning, including unique visual
  fingerprint count, zero-distance adjacent pairs, distance p50/p90/p95, max
  distance, selected hits, and threshold recommendations
- scene-change sampling-density diagnostics that distinguish threshold tuning
  problems from too-sparse adjacent frame sampling before real-media threshold
  changes are trusted
- optional OCR over sampled frames with text profiles for script, digits,
  currency, price-like token counts, percent/discount badges, map labels, and
  travel/commerce context
- per-frame OCR engine failure evidence. Recognition errors and timeouts are
  recorded as partial `ocr_text` metadata artifacts with source frame
  provenance and bounded reasons, while later frames continue unless the run is
  aborted.
- credentials-gated official API metadata attempts for YouTube, Instagram, and
  TikTok
- browser-visible obstruction classification and cautious overlay dismissal
- typed claim, citation, evidence kind, and verification-level gates
- local queued scheduler, cancellation, pruning, and stage timing diagnostics
- GitHub Actions CI and npm pack metadata
- bounded read-only calibration batch concurrency for real-site selector
  calibration loops. `source-navigation-calibrate-batch` and
  `source-coverage-calibrate` can run reviewed calibration attempts in
  concurrent batches up to 5, while persistent-profile retries remain
  sequential.

Implemented in the current local worktree:

- an information-source coverage registry that maps search, social, community,
  content, news, reviews, maps/local, marketplace, knowledge DB, messenger,
  recommendation, and AI-agent categories to concrete platforms by locale
- top-three coverage tracking for important category/locale pairs such as
  Korean search, Korean maps/local, global search, video/social, travel, and
  commerce
- `source_registry` artifacts and `source-registry` CLI inspection commands
- commerce-specific navigation plans and manual-only recipe candidates for
  product-card, seller/return, shipping, and price-badge evidence while cart,
  checkout, purchase, and account-changing actions remain unsupported
- video/social public profile cards, caption/body text, engagement state,
  public comment/reply previews, frame-region, thread-context, and overlay-text
  fixture coverage for Instagram/TikTok-like and X/Twitter public post states,
  while raw stream download, gate bypass, private-message access, and social
  writes remain unsupported. TikTok now also has provider-specific public-post
  fixture selectors for `[data-e2e="browse-video"]` / `[data-e2e="video-desc"]`
  style metadata, frame/overlay scopes, and SPA-style destination attributes
  such as `[data-media-url]` and `[data-profile-url]`.
- Blog/cafe and video/social source navigation plans now include conditional
  destination follow-up work. Naver Blog/Cafe recipe candidates include
  manual-only `extract_destinations` selectors for visible source,
  related-post, profile, official, and external links. YouTube, Instagram,
  TikTok, and X/Twitter recipe candidates include visible profile/channel,
  canonical media, external bio/source, and related-media links. These remain
  calibration candidates and do not click login, join, follow, like, comment,
  share, message, subscribe, raw-stream, or gate-bypass controls.
- Google Maps selected-place sheet, review, photo strip, and map-label fixture
  coverage while route, call, reservation, and booking actions remain outside
  the explicit recipe
- Naver/Daum news module, publisher metadata, destination follow-up, and
  obstruction-state fixture coverage while paywall/login bypass, comment
  writes, and unbounded feed crawling remain unsupported
- Yahoo News now has local portal fixture coverage for global news discovery:
  query state, category/topic navigation, recency/filter state, stream item
  capture, publisher metadata, article follow-up, and obstruction capture
  without paywall/login bypass, comment writes, or unbounded feed crawling.
- Reuters now has local portal/publisher fixture coverage for global news:
  query/search state, section navigation, latest/filter state, story-card and
  article-body capture, publisher metadata, article follow-up, and obstruction
  capture without paywall bypass, comment writes, or unbounded feed crawling.
- first repeated real-site calibration for `news_media` / `global` top slots:
  Google News, Yahoo News, and Reuters all now have ready maintained read-only
  portal action files. Google News and Yahoo News also have maintained
  destination extraction; Reuters now has dated article-link selector
  candidates and provider-shell triage guards, but current unattended live
  calibration is blocked by DataDome before child article extraction can be
  trusted.
- first repeated real-site calibration for `news_media` / `ko-KR` top slots:
  current Naver News and Daum News search targets, read-only article capture
  scopes, publisher follow-up selectors, and obstruction-check scopes are ready
  for explicit opt-in evidence runs
- first repeated real-site calibration for `search` / `ko-KR` top slots:
  Naver Search and Daum Search have ready read-only result-scope capture
  baselines. Google Search was initially blocked by browser-visible
  unusual-traffic / not-a-robot signals in the unattended browser, but a
  user-controlled Chrome CDP import profile now supports authenticated-profile
  result-scope, destination follow-up, knowledge-panel, and first local-pack
  read-only baselines.
- Naver Search recipe candidates now include narrower integrated-result,
  vertical-module, organic-card, Blog/Cafe, news, and map/place destination
  selectors plus broader news, image, video, place/map, shopping, and view
  vertical-tab candidates and shopping/SmartStore/video destination candidates
  for future repeated calibration before falling back to broad `#main_pack` or
  `#search` extraction.
- Naver integrated search now has local executor fixture coverage for the
  natural-deepening shape: capture View/Blog/Cafe, News, Place, Image, Video,
  and Shopping modules separately, preserve visible query/filter/sort/
  pagination state, and extract mixed vertical destinations without clicking
  through the parent search page.
- Daum Search recipe candidates now include broader news, blog, cafe, image,
  video, place/map, and shopping vertical-tab candidates plus Daum News, Daum
  Blog, Tistory, Daum Cafe, KakaoMap, Kakao Shopping, and video destination
  candidates for future repeated calibration before falling back to broad
  `#mArticle`, `#cMain`, or `#daumContent` extraction.
- Google Search recipe candidates now include broader news/image/video module
  selectors, English/Korean/Japanese vertical-tab labels, and video/image/news
  destination extraction candidates for future repeated calibration before
  broad `#search` fallback extraction.
- Google rich search now has local executor fixture coverage for local/map,
  news, image, video, and sponsored module capture, plus mixed organic, news,
  local, image, and video destination extraction without clicking through the
  parent search page.
- Bing, Yahoo Search, and Yahoo Japan Search recipe candidates now include
  provider-specific manual-only query, vertical, filter, pagination,
  result-selection, and `extract_destinations` candidates. This connects the
  global and Japanese search top-three registry slots to real calibration
  surfaces such as Bing `#b_results`, Yahoo `#web` / `.dd.algo`, and Yahoo
  Japan `#contents` / `#WS2m` / `.sw-Card`. They now have local
  fixture-verified executor coverage for query, vertical, filter, pagination,
  result-card capture, context-panel capture, and destination extraction, while
  repeated browser-visible real-site calibration is still required before
  maintained actions are exported.
- Destination triage resolves common search redirect URLs before scoring and
  selected child execution, including Bing `ck/a?u=...`, Google `/url?q=...`,
  Naver redirect params, and Yahoo `/RU=...` paths. The raw extracted redirect
  href remains visible in source-navigation action evidence, while child runs
  and per-domain budgets use the resolved target URL.
- Knowledge/database recipe candidates now cover Google Scholar, Wikipedia,
  Namuwiki, PubMed, data.go.kr, KOSIS, RISS, and KIPRIS with manual-only
  read-only capture and destination extraction surfaces for visible article
  bodies, result cards, abstracts, citations, references, DOI/full-text links,
  dataset records, statistic tables, academic records, and patent details.
  These candidates keep edit, login, restricted-download, paid full-text, and
  institutional-access actions outside maintained automation.
- Google Scholar now has portal-shaped local executor fixture coverage for
  query state, section/filter state, result-card metadata, author/publication
  metadata, snippets, citation/version links, DOI/full-text links, and
  obstruction-state capture.
- Knowledge/database executor fixtures now verify the generic database path for
  Wikipedia, Namuwiki, PubMed, data.go.kr, KOSIS, RISS, and KIPRIS. They cover
  page capture, bounded scroll, and visible citation/source/dataset/record
  destination extraction before any real-site promotion.
- Review/local recipe candidates now cover Yelp and TripAdvisor with
  manual-only query/location, category/filter, pagination, business/listing,
  rating/review, menu/detail/tourism/user-review, and external-site destination
  extraction surfaces. They are now fixture-backed in the safe executor for
  query, category, filter, pagination, capture, destination extraction, and
  obstruction states, while maintained real-site exports still require
  repeated browser-visible calibration for stable selectors and human-check,
  cookie, app-open, login, and security-verification handling.
- first repeated real-site calibration for `map_local` / `ko-KR` top slots:
  Naver Map, KakaoMap, and Google Maps have ready read-only viewport/OCR-scope
  capture baselines that pass explicit evidence-run claim gates
- Map/local recipe candidates now include explicit `destination-followup`
  multi-link extraction for visible place-detail, website, menu, review,
  booking/place, and external website links on Naver Map, KakaoMap, and Google
  Maps. These remain manual-only calibration candidates until repeated
  real-site runs promote stable selectors.
- Apple Maps now has fixture-backed map/local candidates for global
  regional/safety calibration: query, open-now/category filter, viewport,
  selected-place card, OCR label, review context, and website/menu/review
  destination extraction. It remains separate from the current top-three
  readiness audit ordering unless the registry ranking policy changes.
- first repeated real-site calibration for `content_media` / `ko-KR` top slots:
  Naver Blog search pages have ready read-only content/page-shell capture and
  obstruction-check baselines, YouTube search pages have ready read-only
  visible metadata and thumbnail overlay capture baselines, and both pass
  explicit evidence-run claim gates.
- first repeated real-site calibration for `social_feed` / `global` top slots:
  Instagram hashtag search and X/Twitter search now have maintained read-only
  explicit action files that pass evidence-run claim gates. TikTok search is
  currently blocked by a browser-visible server-error/unavailable-media surface
  in the unattended local browser, and readiness emits a profile/headed retry
  command instead of exporting actions from the error page.
- first repeated real-site calibration for `community_forum` / `ko-KR` top
  slots: Naver Cafe, DCInside, and Naver Knowledge iN search pages have ready
  read-only page-shell/thread/content-surface capture, destination follow-up
  where visible, and obstruction-check baselines that pass explicit evidence-run
  claim gates.
- global `community_forum` local fixture coverage for Reddit, Quora, and Stack
  Overflow now exists. Their manual-only portal recipes cover query state,
  community/thread section state, recency/sort state, bounded pagination,
  visible article/thread cards, destination follow-up, destination metadata,
  question bodies, thread bodies, answer bodies, accepted/top-answer markers,
  comment lists, and obstruction-state capture. A first repeated real-site
  calibration attempt now classifies all three as blocked in the current
  unattended browser: Reddit shows a
  browser-visible network-security block, while Quora and Stack Overflow show
  Cloudflare-style security verification. The readiness loop emits
  profile/headed retry commands for all three instead of exporting maintained
  actions from challenge pages.
- first repeated real-site calibration attempt for `marketplace_transaction` /
  `ko-KR` top slots: Coupang, Naver Shopping, and Gmarket currently show
  browser-visible access-denied or bot-check surfaces in the local unattended
  browser. Commerce recipes now include provider-specific product-list and
  price scopes for accessible runs plus Korean commerce block signals, so the
  readiness audit classifies the current state as blocked rather than as a
  missing-selector calibration failure.
- Commerce source navigation plans now include conditional destination
  follow-up work, and commerce recipe candidates now include manual-only
  `extract_destinations` selectors for visible product-detail, review, seller,
  brand/store, and marketplace item links on Amazon, Walmart, eBay, Coupang,
  Naver Shopping, Gmarket, and 11st. Cart, wishlist, purchase, checkout,
  membership, login, and account-changing actions remain unsupported.
- Local safe-executor commerce coverage now exercises Amazon, Coupang, Naver
  Shopping, Gmarket, 11st, Walmart, and eBay with provider-specific fixture
  selectors for query/filter/sort/pagination state, product cards, seller and
  shipping terms, price badges, and anchor plus SPA-style product/seller
  destination extraction.
  This is local proof of the workflow shape; live maintained exports still
  require repeated real-site calibration or profile/headed retry where blocked.
- global travel booking recipe candidates now include provider-specific
  Booking.com, Agoda, Trip.com, and Expedia query, filter, sort, result-scroll,
  pagination, offer-detail, and price/OCR scopes. Global travel access/security
  challenge phrases such as access-denied, security-check, cookie-required, and
  interruption pages, and Expedia's human-or-bot challenge are treated as
  blocked evidence during obstruction classification and read-only calibration.
- first repeated real-site calibration for `marketplace_transaction` /
  `global` top slots now runs with travel stay-window target URLs plus
  provider-specific Tokyo destination hints where needed. Amazon, Booking.com,
  Agoda, and Trip.com produce maintained read-only action files that pass
  explicit evidence-run claim gates. Booking.com and Agoda currently preserve
  offer-card evidence; Trip.com also preserves maintained price/OCR evidence.
  Expedia repeated calibration currently lands on a browser-visible "Bot or
  Not?" challenge in the unattended browser, so it is classified as blocked
  until a profile/headed calibration pass is available. Coverage loop plans,
  calibration manifests, and promotion-review commands now preserve
  profile/headed runtime flags for those retry passes, and coverage readiness
  audits can print blocked-slot `auth-login` setup and profile/headed retry
  commands directly. When a blocked promotion group has a selector-hint
  handoff file, those retry commands now carry `--selector-hints-file` forward
  so headed/profile retries do not lose prior discovery work. The same
  readiness audit can also emit `--format retry-plan` for an ordered Markdown QA
  checklist of blocked profile/headed retries. Promotion now preserves
  aggregated blocked-signal counts such as DataDome/captcha-delivery,
  Cloudflare, or login-wall signals into readiness and retry-plan output, so QA
  can see why a source is blocked without opening the raw catalog first.
  Coverage calibration loop reports also print that blocked-signal pressure in
  the per-source readiness section, keeping plan-only and executed batch
  reports actionable as QA handoffs. The same reports now include a
  `Profile/Headed Retries` section with the generated setup and retry commands
  for blocked slots, and `source-coverage-calibrate` writes the same retry
  handoff as `profile-headed-retry-plan.md` and
  `profile-headed-retry-plan.json` beside the report. The read-only
  `source-coverage-retry-plan` command can validate that JSON and print
  Markdown or setup/retry command subsets for agents and QA scripts. It can
  filter by platform, retry priority, and limit, so a broad blocked-coverage
  handoff can be narrowed to one reviewed provider retry at a time, then
  written to a separate command, Markdown, or JSON file with `--output-file`.
  `--only-check-ok` can then render only the retry items that pass the selected
  preflight checks, such as existing selector-hint files or prepared saved
  browser profiles.
  `--format check --fail-check` provides a preflight gate for required
  headed/profile/browser-channel/persistent-profile and selector-hint command
  handoffs before any browser retry is launched. Adding `--check-files` makes
  that preflight also verify that referenced `selector-hints.tsv` files still
  exist before the retry command is handed to QA. Adding `--check-profiles`
  also verifies that the named saved browser profile has been created before a
  retry command is launched. Coverage calibration bundles now include the same
  command-shape preflight result as
  `profile-headed-retry-plan-check.json`, and both the generated retry-plan
  Markdown and coverage report summary show the check status plus error/warning
  counts. Passing `--check-files` or `--check-profiles` directly to
  `source-coverage-calibrate` carries those disk-state checks into the
  generated check JSON, retry-plan Markdown, and Markdown report. The report
  also includes the check issue codes and affected platforms when warnings or
  errors exist.
- long real-site source-navigation capture IDs are now collision-resistant after
  artifact filename truncation through compact hashed fallbacks

## Product Layers

```text
Agent
  |
  v
MCP / CLI / HTTP evidence-run input
  |
  v
Information source coverage registry       <-- next planning layer
  |  category + locale + top slots + support tier
  v
Source strategy
  |  detects platform + source family
  v
Source navigation plan
  |  records query state, filters, tabs, maps, details, media
  v
Destination triage
  |  bounded candidate links + usefulness scoring + child evidence runs
  |  child-page usefulness verdict + optional explicit depth-2 deepening
  v
Browser-visible evidence capture
  |  screenshot, text, HTML, media index, network, console
  v
Structured derivatives
  |  OCR, transcript cues, official API metadata, frame samples
  v
Claim gate
  |  final claims must cite typed artifacts
  v
Final report
```

## Information Source Coverage

The user-facing source universe is broader than the current source-family enum.
The product categories are search, AI search, social feeds, communities,
content/media, news, reviews, maps/local, marketplaces, knowledge databases,
messengers/private networks, recommendations, and AI agents.

These categories should not become separate browser executors. They should map
to existing evidence mechanics:

| Product category | Likely source families |
|------------------|------------------------|
| search, AI search, recommendation | `search`, `generic_web`, destination follow-up |
| social feed, content media | `video_social`, `blog`, `generic_web` |
| community/forum | `blog`, `generic_web`, later `forum` if needed |
| news/media | `portal`, `search`, `generic_web`, destination follow-up |
| reviews, maps/local | `map`, `portal`, `generic_web` |
| marketplace/transaction | `travel_booking`, `commerce` |
| knowledge database | `generic_web`, later `database` if needed |
| messenger/private | explicit user-visible capture only |

First-class registry support should record support tier, top-slot rank basis,
locale segment, required evidence capabilities, and unsupported actions. The
registry plan is documented in `docs/INFORMATION_SOURCE_TAXONOMY.md`. The
registry now treats `en-US` as an explicit representative locale for public
search, social, content/media, community/forum, news, review/local,
marketplace, and knowledge/database coverage instead of relying only on broad
`global` slots.

## Destination Triage

Current follow-up support is intentionally bounded. Explicit `follow_up`
recipes can resolve a destination link, and explicit `extract_destinations`
recipes can read several visible HTTP(S) links from an already visible
result/module selector without clicking the parent page. Those requests produce
`destination_candidate` and `destination_triage` artifacts, apply deterministic
URL/text scoring, reject obvious low-value or duplicate destinations, and
enforce the max-follow-up and per-domain budgets before child runs. Selected
one-depth child runs default to sequential execution, but can run in bounded
parallel batches when `sourceNavigation.followUpConcurrency` is explicitly set.
Promotion-review and coverage-calibration handoffs can carry those follow-up
budget/concurrency flags into generated ready `evidence-run` commands, so a
reviewed multi-child QA run is reproducible from artifacts rather than shell
history.
Evidence-run can also run an explicit bounded fallback pass with
`sourceNavigation.fallbackFollowUps` when selected child evidence is downgraded
and lower-ranked candidates remain unattempted. This is still opt-in and
budgeted through `sourceNavigation.maxFallbackFollowUps`; it is meant for QA
and reviewed natural-deepening runs, not unbounded crawling.
After a selected child run finishes, triage now also records child-page
evidence-density and query-overlap diagnostics so a destination that was worth
trying can still be marked low-value, off-topic, or blocked.
Each candidate also carries positive and negative reason codes so a reviewer can
see why it was selected, rejected, or downgraded without reverse-engineering the
numeric score.
The summary also aggregates reason-code counts, which is the first calibration
surface for tuning relevance, authority, freshness, obstruction, and thin-page
thresholds on real Google/Naver/portal/map/community/commerce runs.

That is enough to preserve why an explicit or extracted destination was or was
not pursued and why a selected child page was useful or weak. It now supports
explicit opt-in depth-2 execution for proposed useful child links, including
bounded `sourceNavigation.deepeningConcurrency` for deeper child runs, but it
does not yet provide broad maintained provider selectors for arbitrary live
result cards and portal modules. Depth-2 promotion-review commands can also
carry explicit depth/deepening budgets so those QA passes stay reproducible.

### Current Capability Answer

If the agent starts from Google, Naver, Daum, a map surface, or a platform
search page today, it can preserve the parent result surface and, when an
explicit maintained recipe supplies a `follow_up` or `extract_destinations`
action, it can create bounded child evidence runs for selected destination
pages such as news articles, blog posts, official sites, map/place pages,
community threads, media pages, or commerce pages.

It is not yet a natural default that the agent can look at every arbitrary live
result set, decide which results are useful, follow all worthwhile destinations,
discard weak ones, and continue recursively. That broader behavior is now the
product scope, but it must remain bounded and auditable: parent surface first,
visible destination candidates second, deterministic triage third, child
evidence capture fourth, and final claims only when the evidence chain is
cited.

### Deep Destination Boundary

The expected user behavior is natural search deepening: start on Google, Naver,
Daum, YouTube, map search, or another platform, inspect ranked results or
portal modules, open the useful-looking news/blog/official/review/place/product
destinations, and discard the ones that are irrelevant or thin.

The product should model that behavior as an auditable loop, not as an
unbounded crawler:

1. Capture the parent surface first: query, locale, ranking, snippet, module,
   visible filters, sponsored labels, and timestamp.
2. Extract visible destination candidates from calibrated result-card, headline,
   place, product, community-thread, or media-card selectors.
3. Score candidates before following them by source type, rank, query overlap,
   authority, freshness, source-family fit, obstruction risk, duplicate status,
   and domain budget.
4. Run only selected candidates as one-depth child evidence workflows.
5. Judge each child page after capture as useful, low-value, off-topic,
   duplicate, blocked, paywalled, private, or unsupported.
6. Require destination-content claims to cite the child evidence plus the
   parent-surface provenance chain.
7. Treat deeper hops from a useful child page as proposal-only evidence by
   default. Execute depth-2 only when the run explicitly opts in with
   `maxDepth: 2`, bounded count/domain controls, and normal child evidence
   gates.
8. Treat deeper hops exposed by blocked child pages as recovery advice only:
   preserve the sampled URL and profile/headed retry command hints, but do not
   promote or execute it automatically.

This means the agent can eventually say, "Naver showed this blog/news result;
I opened it; the child page was useful/off-topic/blocked; here is the evidence
chain." It should not say it has broadly crawled or verified every result unless
those child runs actually happened and are cited.

### Destination Usefulness Model

The office-hours answer for search-result deepening is that usefulness is not
just whether a link opens. A Google/Naver result can lead to a news article,
blog post, official website, map/place page, review page, community thread,
video/media page, or commerce page, and each destination must be judged against
the user's question after browser-visible capture.

The first useful-child rules are:

- news is useful when title/body/date/publisher evidence matches the query and
  the page is not only a portal snippet or blocked shell
- blog/community content is useful when visible body text or comments contain
  experience/detail signals that match the query, not only SEO navigation
- official sites are useful when the domain, title, body, structured metadata,
  or contact/place/product evidence matches the entity being researched
- map/place and review pages are useful when visible place, address, hours,
  rating/review, map label, or reservation-context evidence matches the query
- video/media pages are useful only for visible metadata, captions, transcript,
  OCR/frame evidence, or obstruction state that was actually captured
- commerce/travel pages are useful when visible price, availability, policy,
  seller, product, rate, or date/guest/currency state is captured

The first low-value rules are:

- duplicate URL or same-domain budget exhaustion
- no meaningful query overlap after child capture
- no query overlap where the query and visible child evidence appear to use
  different dominant scripts, such as a Latin transliteration query leading to a
  Hangul child page; this remains a caution signal rather than proof of
  relevance
- page is mostly boilerplate, portal shell, cookie wall, app interstitial, or
  search-results wrapper
- child page is blocked, paywalled, private, login-only, CAPTCHA-like, or
  unsupported for browser-visible evidence
- destination requires account-changing, payment, booking, posting, raw-media,
  or other unsupported actions

The next destination layer should stay bounded and evidence-first:

- maintain calibrated visible destination selectors for ranked result cards,
  news/blog modules, map place panels, community threads, review cards, and
  commerce result cards
- classify each candidate by source type, rank position, visible snippet,
  domain, likely official/source authority, freshness signals, media type, and
  obstruction risk
- compare each candidate against the user question and current source category
  so news, blogs, official pages, reviews, places, videos, and products are not
  treated as equally useful in every context
- run only the top approved candidates as child evidence workflows under a
  strict depth, count, domain, and timeout budget
- mark each child destination as useful, low-value, duplicate, off-topic,
  blocked, paywalled, private, or unsupported based on browser-visible evidence
- preserve a reason when a destination is skipped, including duplicate URL,
  low query overlap, stale or thin evidence, same-page portal shell, blocked
  access, unsupported action, or domain budget
- keep the provenance chain explicit: portal result artifact -> destination
  candidate artifact -> child run artifact -> final claim citation
- enforce that chain in final claim-gate for destination evidence kinds, so a
  destination claim cannot cite only a portal snippet or final summary
- emit deeper-hop proposals from useful child pages without executing them by
  default; a second hop requires explicit opt-in plus its own count,
  per-domain, timeout, and artifact-count budget

This is not autonomous crawling. It is bounded destination evidence selection,
with a default depth of one and explicit opt-in for deeper hops.

## Source Families

### Korean Portal

Target surfaces:

- Naver Search vertical tabs
- Naver Blog and Cafe public articles
- Naver Map and Place panels
- Naver image/search modules
- portal-owned snippets, cards, filters, sort menus, and visible rankings

Evidence requirement:

- query, locale, timestamp, profile/headed state
- selected vertical tab and filter state
- visible ranking and sponsored/module distinction when rendered
- follow-up evidence run for destination content
- OCR for image-rendered text, labels, badges, and map pins

### Google / Global Search

Target surfaces:

- Google Search result pages
- Google Maps and place panels
- destination pages opened from search results
- Google/Chrome visible browser state

Evidence requirement:

- query, language, locale, safe-search/filter state, timestamp
- visible ranking, snippets, result modules, and ads/organic distinction when
  rendered
- destination follow-up runs for claims about actual page content
- credential-gated Google APIs only as structured supplements

### Video / Social

Target surfaces:

- YouTube
- Instagram
- TikTok
- other browser-visible media and social pages

Evidence requirement:

- visible title/caption/profile/channel/post metadata
- visible comments and engagement only when actually rendered
- timestamped frame screenshots for visual claims
- transcript/caption artifacts only when accessible and preserved
- OCR over visible overlay text
- obstruction classification for login walls, app-open interstitials, region
  gates, age gates, unavailable media, and bot blocks
- no raw stream downloads or access-control bypass

### Travel / Commerce

Target surfaces:

- Agoda, Trip.com, Booking.com, Expedia
- shopping and booking-like list/detail/filter pages

Evidence requirement:

- exact query state: dates, guests, rooms, currency, region, sort, filters
- visible price/availability/tax/fee/cancellation state at capture time
- detail page evidence when a claim depends on room/rate terms
- OCR over image-rendered price cards and badges
- no booking, payment, reservation, or account-changing actions

### Generic Web

Fallback behavior:

- capture the page first
- infer source family from observed shape
- extract deterministic page derivatives
- propose safe next actions
- stop and record obstruction when access is not browser-visible

## Roadmap

### Phase 0: Evidence Core

Status: done.

This is the current `0.3.0` state: evidence-run, source strategy, OCR, dense
sampling, official API metadata, obstruction capture, scheduler, CI, npm pack,
and strict claim gate.

### Phase 1: Navigation Plan Artifact

Status: implemented locally.

Add a typed `SourceNavigationPlan` layer. It should describe what the agent
should do inside a platform without executing risky site-specific automation
yet.

Deliverables:

- `source_navigation_plan` evidence kind
- `SourceNavigationPlan` and `SourceNavigationAction` schemas
- default navigation action templates per source family
- evidence-run assessment/report integration
- unit tests with fixture URLs and expected action plans

### Phase 2: Safe Navigation Executor

Status: core explicit-recipe slice implemented locally.

Execute a bounded subset of navigation actions with Playwright locators and
per-state capture.

Deliverables:

- safe click/fill/select/press/scroll/wait/capture operations for explicit
  action-key recipes
- before/after capture per configured action
- selector/action failure artifacts and skipped/unsupported action artifacts
- action caps and timeout budgets
- evidence-run `source_navigation_execution_plan` artifact and summary
- CLI/MCP/HTTP explicit recipe input with default execution disabled unless
  supplied
- expected visible-state assertions and selected-region captures for map
  panels, price cards, rate policy panels, and galleries
- explicit destination follow-up recipes that create one-depth child evidence
  runs without recursive crawling
- no login, payment, booking, CAPTCHA, age-gate, accept-all, or app-open
  automation

Still needed:

- provider-specific variants beyond the first local coverage for search,
  maps, community, social, travel, and commerce surfaces
- real-site selector calibration after local fixtures are stable
- guarded recipe catalog design before any live defaults execute

### Phase 2.5: Information Source Coverage Registry

Status: implemented locally.

Add a registry that maps product information categories and locales to concrete
platform coverage targets. This makes "top three sources per important
category/locale" explicit without hardcoding a crawler for every site.

Deliverables:

- `InformationCategory`, `LocaleSegment`, `SourceRegistryEntry`, and support
  tier types
- `src/source-registry.ts` with initial mandatory slots
- `source_registry` evidence kind and artifact
- evidence-run assessment/final-report summary for registry match and support
  tier
- tests that fail when a mandatory category/locale slot has fewer than three
  planned entries or lacks support-tier rationale
- CLI inspection such as `source-registry --category search --locale ko-KR`
- package/docs inclusion

This phase now defines which platforms deserve fixture and calibration priority
before expanding real-site recipe defaults.

### Phase 3: Source Family Recipes

Status: after executor foundation and registry.

Tune reusable recipes for:

- Naver Search/Blog/Cafe
- Naver Map/Place
- Google Search/Maps
- YouTube visible video evidence
- Instagram/TikTok visible post/reel evidence
- generic travel/commerce filter-list-detail flows

Recipes are not hardcoded crawlers. They are default action sequences that still
preserve every state as evidence.

### Phase 4: Real-Site Calibration

Status: first Korean news, search, maps/local, content/media, community/forum,
selected global marketplace/travel baselines, global social-feed baselines for
Instagram and X/Twitter, and global community/forum blocked-state calibration
are implemented where the unattended browser can see content or a visible gate.
Expedia, TikTok, Korean commerce, Google Search, Reddit, Quora, and Stack
Overflow currently need profile/headed or credential-aware calibration where
browser-visible gates or error surfaces block unattended runs.

Run real captures with explicit user intent and profile/headed mode when needed.
Tune OCR accuracy, scene-change threshold recommendations against real media,
obstruction rules, overlay dismissal, and official API credential handling.

### Phase 5: Distribution / Remote Service

Status: deferred.

Publish npm only after docs and exported API are stable. Remote shared server
mode remains out of scope until auth, tenancy, artifact retention, storage
roots, quotas, cancellation, and concurrency controls are designed.

## Coverage Definition of Done and Freeze

The per-provider calibration loop (calibrate -> catalog -> promote -> readiness)
is powerful but open-ended: the web is not a finite taxonomy, selectors decay,
and the highest-value targets (Google Search, TikTok, Expedia, Coupang, Reddit,
Quora, Stack Overflow, ...) bot-block the default unattended browser. To keep
effort bounded and the product honest, coverage is now governed by an explicit
definition of done and a freeze policy.

**Coverage is "done"** when, for each prioritized category/locale slot:

1. the top reviewed slots have maintained, narrow, non-mutating recipes that
   pass an explicit `evidence-run` claim gate,
2. those recipes have a recorded last-verified result (a recipe canary), and
3. blocked slots are recorded as blocked with a profile/headed retry plan, not
   as open calibration debt.

Reaching that bar for the already-baselined categories (Korean search, maps,
news, content/media, community; global news; selected global travel/commerce;
global social for Instagram/X) **closes** the calibration effort for those
slots. Adding the 30th provider is explicitly **not** a goal.

**Freeze:** do not start new open-ended provider expansion. A provider is added
only when a concrete user need names it, and then through the same bounded loop
with a canary.

**Descope of bot-hostile autonomous coverage:** categories whose top targets
reliably bot-block the unattended browser are **not** claimed as autonomous
coverage. They are either official-API-only (structured, credential-gated
supplements) or human-headed-only (a user-driven profile/headed retry), and the
docs and readiness audits must not imply the farm can autonomously crawl them.
This applies to much of marketplace/transaction (Coupang, Naver Shopping,
Gmarket, Expedia), parts of community/forum (Reddit, Quora, Stack Overflow), and
TikTok in unattended mode.

**Deferred (documented, not yet executed):** physically quarantining the
calibration/promotion/coverage-readiness modules into `src/research/` and gating
their CLI subcommands behind a single `research` parent command, plus a
`recipe-canary` command and per-recipe `lastVerifiedAt` tags. These are
mechanical refactors that touch ~7,600 lines and the whole CLI surface; they
should land as a focused, separately-reviewed change rather than be bundled with
behavior work. Until then, this section is the binding policy.

## Acceptance Tasks

These five tasks define the first product acceptance set for portal-native
navigation:

1. Naver Search/Blog/Cafe: search a Korean query, switch to a vertical, preserve
   ranking/snippets, and follow one destination as a separate evidence run.
2. Naver Map/Place: search a place/category, preserve map viewport, selected
   place panel, visible review snippets, filters, and OCR-visible map labels.
3. Google Search/Maps: search a global query, preserve result filters and
   ranking, then capture Google Maps place context or destination content.
4. YouTube/TikTok: preserve visible metadata, classify obstructions, sample
   timestamped frames, OCR overlay text, and refuse full video understanding
   without transcript/audio evidence.
5. Travel/commerce: preserve date/guest/currency/filter state, list sorting,
   price cards, fees/taxes visibility, and room/detail terms without performing
   a booking or payment action.
6. Coverage registry: for each top-priority category/locale pair, show the
   selected platform slots, support tiers, source families, and unsupported
   actions before running platform-specific recipes.

## Not In Scope

- arbitrary raw video or audio stream download
- bypassing login, CAPTCHA, age gates, region gates, paywalls, DRM, or app-only
  walls
- automated booking, payment, reservation, account changes, posting, liking, or
  messaging
- claiming full video/audio understanding without transcript/audio evidence
- production remote shared server mode before security and retention design
- unlimited crawling, ranking claims, or durable price/availability claims
  without timestamped evidence

## Source Anchors

The office-hours design checked current official references for Naver Search,
Naver Blog/Cafe/Local Search, Google Programmable Search, Google Places Text
Search, YouTube Data API, and TikTok Research API. Use those official APIs only
as credential-gated structured supplements to browser-visible evidence. The
coverage-registry plan also requires refreshed public ranking references before
claiming that any platform is a current top-three market/share leader.
