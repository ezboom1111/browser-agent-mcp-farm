# Browser-Agent MCP Farm

Local generic browser research farm exposed as an MCP stdio server.

## Scope

This package implements the local v0.3 slice:

- Playwright BrowserContext per lease
- lease ownership, TTL, heartbeat, max page, and domain checks
- read-only page open/capture
- read-write browser actions except payment-like pages
- storage-state and persistent-profile modes
- profile lock to prevent concurrent writes to the same saved login state
- proxy and fingerprint options per lease
- artifact bundle writer with hashes, including image-like media artifacts and media indexes
- structured transcript artifacts parsed from legitimately captured WebVTT files
- MCP stdio server wrapper
- MCP `farm_evidence_run` workflow tool
- Codex and Claude MCP auto-registration
- wait, selector wait, scroll, and capture-after-idle tools
- timestamped browser-visible frame sampling for media elements
- typed evidence kinds, claim types, and verification levels
- final claim-gate checks for visual frame, transcript cue, and audio transcription evidence
- optional OCR pass over sampled frames with timestamp, language, confidence,
  word-box, script, and price-like text-profile metadata when `tesseract.js` is
  installed
- dense frame sampling windows around browser-exposed transcript cue hits, OCR
  text hits, and browser-visible scene-change hits, with typed per-source
  diagnostics in run assessments
- explicit-credential official API metadata attempts and per-run API cache artifacts
- source strategy classification for search, map, blog, portal/news, travel
  booking, commerce, video/social, and generic web sources
- source coverage registry for category/locale/top-slot planning, including
  explicit ko-KR, en-US, ja-JP search, and global representative slots, support
  tiers, AI derivative evidence, and private-network capture policy
- manual-only source navigation recipe candidate plans for search, map,
  blog/forum, portal/news, travel/commerce, video/social, and generic web
  calibration
- commerce product-card, seller/return, shipping, price-badge, and destination
  planning with provider-specific Amazon/Walmart/eBay/Coupang/Naver Shopping/
  Gmarket/11st fixture coverage, without cart, checkout, or purchase actions
- provider-specific travel booking recipe candidates for Booking.com, Agoda,
  Trip.com, and Expedia query/filter/sort/list/pagination/offer/price scopes,
  with travel security/access and Expedia human-or-bot challenges classified as
  blocked evidence instead of selector failures
- video/social public metadata, frame-region, thread-context, and overlay-text
  fixture coverage for Instagram/TikTok-like and X/Twitter public post states,
  without raw stream download, gate bypass, or social write actions
- blog/cafe and video/social manual-only destination extraction candidates.
  Naver Blog/Cafe can extract visible source, related-post, profile, official,
  and external links; YouTube, Instagram, TikTok, and X/Twitter can extract
  visible profile/channel, canonical media, external bio/source, and
  related-media links without login, join, follow, like, comment, share,
  message, subscribe, raw-stream, or gate-bypass actions.
- Google Maps selected-place sheet, review, photo strip, and map-label fixture
  coverage without route, call, reservation, or booking actions
- Naver/Daum news module, publisher metadata, destination follow-up, and
  obstruction-state fixture coverage without paywall/login bypass, comment
  writes, or unbounded feed crawling
- Yahoo News portal fixture coverage for global news query state, category/
  topic navigation, recency/filter state, stream item capture, publisher
  metadata, article follow-up, and obstruction capture
- Reuters portal/publisher fixture coverage for global news query/search
  state, section navigation, latest/filter state, story-card and article-body
  capture, publisher metadata, article follow-up, and obstruction capture
- first repeated real-site `news_media` / `global` calibration baseline for
  Google News, Yahoo News, and Reuters. All three have maintained read-only
  portal actions; Google News and Yahoo News also have maintained destination
  extraction, while Reuters has dated article-link selector candidates but is
  currently blocked by DataDome in unattended live calibration
- Google News read-link destination extraction: repeated live calibration
  promotes `a[href^="./read/"]` for explicit `extract_destinations` actions,
  while Google News Home/For you/Following/Google apps/account/support/policy
  links are classified as low-value provider navigation
- Reuters destination hardening: section/search/privacy/provider utility links
  are non-promotable, dated Reuters article paths remain promotable, broad
  `main a[href*="reuters.com"]` extraction is blocked from maintained export,
  and DataDome `captcha-delivery.com` challenge shells are classified as
  bot-block evidence
- first repeated real-site `news_media` / `ko-KR` calibration baseline for
  current Naver News and Daum News search pages, producing explicit opt-in
  read-only action files for article capture, publisher follow-up, and
  obstruction checks
- first repeated real-site `search` / `ko-KR` calibration baseline for Naver
  Search and Daum Search result-scope capture, plus authenticated-profile
  Google Search calibration through a CDP-imported Chrome profile. The Google
  Search action file passes explicit evidence-run claim gates, captures
  narrower result/module scopes such as `#rso`, visible top ads, right-side
  knowledge panels, and repeated local-pack scopes such as `#Odp5De`, place
  cards, place detail text, map canvas, and local thumbnails when present, and
  resolves destination follow-up links without selecting hash-only self links.
  The latest profile-backed English Google Search calibration also promotes
  result capture plus destination extraction for `tokyo hotel`, filters Google
  Home/WebHP, Labs, apps/products, Search vertical, and Maps vertical utility
  links as provider-shell surfaces, and runs external child follow-ups without
  reusing the still-leased parent profile. Destination query-intent hardening
  now keeps `Tokio Hotel` Wikipedia/YouTube/music results from being accepted
  as hotel-commerce evidence unless the child page itself supports that intent.
  The latest bounded 5-follow-up retry produced useful child captures for
  Booking.com, Agoda, and Google Travel while preserving TripAdvisor Korean
  access limits and Expedia human/bot challenges as blocked evidence. Google
  Search recipe candidates now include explicit travel/hotel module capture and
  extraction selectors for `/travel/hotels`, `/travel/search`, and SPA-style
  hotel/travel/offer URL attributes. Repeated profile-backed calibration now
  prefers the direct `#search a[href*="/travel/hotels"]` maintained extraction
  selector over broad Google result containers; the focused export follows only
  Google Travel and produces one useful commerce child destination.
  Manual-only recipe candidates now also cover broader Google news/image/video
  module and English/Korean/Japanese vertical-label calibration paths.
- Naver integrated-search local fixture coverage for separate View/Blog/Cafe,
  News, Place, Image, Video, and Shopping module capture, provider-specific
  vertical tabs, visible filter/sort/pagination state, and mixed
  anchor/SPA-style destination extraction without parent-page click-through.
- Google rich-search local fixture coverage for local/map, news, image, video,
  sponsored module capture, provider-specific vertical tabs, and mixed
  organic/news/local/image/video destination extraction without parent-page
  click-through.
- first repeated real-site `map_local` / `ko-KR` calibration baseline for
  Naver Map, KakaoMap, and Google Maps viewport/OCR-scope capture, producing
  explicit opt-in read-only action files that pass evidence-run claim gates
- map/local manual-only destination extraction candidates for Naver Map,
  KakaoMap, and Google Maps place-detail, website, menu, review, booking/place,
  and external website links. These use `extract_destinations` without clicking
  the parent map page and still require repeated calibration before maintained
  export.
- destination extraction supports visible SPA-style URL attributes such as
  `data-href`, `data-url`, `data-target-url`, `data-place-url`,
  `data-source-url`, `data-item-url`, `data-product-url`, `data-profile-url`,
  and `data-media-url`, so calibrated result/place/product/media cards do not
  have to expose every destination as an `<a href>`.
- recipe candidates include provider-scoped non-anchor destination selectors
  for Google/Naver search, maps, commerce, and video/social surfaces, but they
  still require repeated read-only calibration before maintained export.
- broad generic SPA URL attributes are treated as calibration diagnostics, not
  maintained destination extraction recipes, unless narrowed by provider/path or
  a semantic product/place/profile/media URL attribute.
- first repeated real-site `content_media` / `ko-KR` calibration baseline for
  Naver Blog and YouTube search pages. Naver Blog produces explicit opt-in
  read-only content/page-shell capture and obstruction-check action files;
  YouTube produces explicit opt-in read-only visible metadata and thumbnail
  overlay capture action files, and the latest profile-backed YouTube search
  calibration also exports precise watch-title destination extraction with
  `ytd-video-renderer a#video-title[href*="/watch"]` after filtering broad
  renderer links and duplicate-heavy channel thumbnail selectors. Both Naver
  Blog and YouTube pass evidence-run claim gates. Instagram hashtag
  exploration is currently classified as browser-visible login-wall blocked in
  the unauthenticated local browser.
- first repeated real-site `community_forum` / `ko-KR` calibration baseline for
  Naver Cafe, DCInside, and Naver Knowledge iN search pages. These produce
  explicit opt-in read-only page-shell/thread/content-surface capture,
  destination follow-up where visible, and obstruction-check action files that
  pass evidence-run claim gates.
- first repeated real-site `marketplace_transaction` / `ko-KR` calibration
  attempt for Coupang, Naver Shopping, and Gmarket. The current local browser
  sees browser-visible access/bot-check blocks for all three on this network;
  these are now classified as blocked instead of misleading selector failures,
  and Naver Shopping/Gmarket evidence-runs preserve `browser_obstruction`
  artifacts that pass the final claim gate.
- commerce manual-only destination extraction candidates for Amazon, Walmart,
  eBay, Coupang, Naver Shopping, Gmarket, and 11st product-detail, review, seller,
  brand/store, and marketplace item links. These use `extract_destinations`
  without clicking the parent marketplace page and still require repeated
  calibration before maintained export.
- first repeated real-site `marketplace_transaction` / `global` calibration
  baseline for Amazon, Booking.com, Agoda, and Trip.com using travel stay-window
  target URLs. Amazon, Booking.com, Agoda, and Trip.com now produce maintained
  read-only action files that pass explicit evidence-run claim gates.
  Booking.com and Agoda are currently offer-card capture baselines, while
  Trip.com also has a maintained price/OCR scope. Expedia repeated calibration
  currently lands on a visible "Bot or Not?" challenge in the unattended
  browser, so it is classified as blocked pending profile/headed retry.
- blocked profile/headed QA handoffs preserve matched blocked-signal pressure
  from promotion into readiness and retry plans, so DataDome, captcha,
  Cloudflare, login-wall, and similar blocker reasons are visible beside the
  generated setup/retry commands. Coverage calibration Markdown reports also
  print the same blocked-signal pressure in per-source readiness lines, so a
  QA reviewer can see why a slot needs profile/headed retry without opening
  the raw catalog or readiness JSON. Those loop reports now include a
  `Profile/Headed Retries` section with the generated setup and retry commands,
  and `source-coverage-calibrate` writes the same handoff to
  `profile-headed-retry-plan.md` plus machine-readable
  `profile-headed-retry-plan.json`.
- read-only source navigation selector calibration with artifact output before
  any candidate is promoted into an explicit recipe
- explicit-opt-in source navigation recipe catalog proposals from candidates
  plus optional calibration reports
- browser-visible obstruction classification for login walls, app interstitials,
  bot blocks, region gates, age gates, and unavailable media pages
- cautious browser overlay dismissal before evidence capture for ordinary
  close/not-now/reject/necessary-only surfaces, without clicking login, CAPTCHA,
  age-gate, payment, or app-open actions
- local HTTP queue for evidence-run jobs
- package metadata and GitHub Actions verification workflow
- unit and smoke tests

Out of scope:

- payment actions
- DRM bypass or raw platform video download
- production remote multi-user server
- published npm distribution

## Commands

```powershell
npm ci
npm test
npm run test:ocr-integration
npm run test:official-api
npm run build
npm run verify
node .\dist\cli.js serve
node .\dist\cli.js serve-http --port 3333
node .\dist\cli.js smoke
node .\dist\cli.js smoke-web --timeout-ms 10000
node .\dist\cli.js smoke-media
node .\dist\cli.js smoke-proxy
node .\dist\cli.js claim-gate --run-dir <path> --mode final --min-claims 1
node .\dist\cli.js html-preview --run-dir <path>
node .\dist\cli.js critique-next --queue <path>
node .\dist\cli.js critique-complete --queue <path> --task-id MEDIA-CRIT-01
node .\dist\cli.js platform-capabilities --url https://www.youtube.com/watch?v=dQw4w9WgXcQ
node .\dist\cli.js official-api-readiness --url https://www.youtube.com/watch?v=dQw4w9WgXcQ --youtube-api-key-env FARM_YOUTUBE_API_KEY
node .\dist\cli.js source-registry --category search --locale ko-KR
node .\dist\cli.js source-coverage-readiness --category search --locale ko-KR --format targets
node .\dist\cli.js source-coverage-readiness --category search --locale ko-KR --promotion-summary <promotion-summary> --format retry-commands
node .\dist\cli.js source-coverage-calibrate --category search --locale ko-KR --run-root .\coverage-calibration --include-search-variants --plan-only
node .\dist\cli.js source-coverage-retry-plan --retry-plan .\coverage-calibration\profile-headed-retry-plan.json --format commands
node .\dist\cli.js destination-recovery-plan --run-dir <evidence-run-dir> --format commands
node .\dist\cli.js source-coverage-calibrate --category news_media --locale ko-KR --top-rank 2 --query "AI policy" --run-root .\news-calibration --repeat 2 --calibration-concurrency 2
node .\dist\cli.js source-navigation-recipes --url https://www.google.com/search?q=tokyo+hotel
node .\dist\cli.js source-navigation-calibration-targets --category search --locale ko-KR --include-search-variants --format lines
node .\dist\cli.js source-navigation-calibrate --url https://example.com/ --timeout-ms 10000 --selector-timeout-ms 1000
node .\dist\cli.js source-navigation-calibrate-batch --urls-file .\calibration-targets.txt --run-root .\evidence-calibration --repeat 2 --calibration-concurrency 2
node .\dist\cli.js source-navigation-catalog --url https://www.google.com/search?q=tokyo+hotel
node .\dist\cli.js source-navigation-catalog --url https://www.google.com/search?q=tokyo+hotel --calibration-run-dir <evidence-run-dir>
node .\dist\cli.js source-navigation-catalog --url https://www.google.com/search?q=tokyo+hotel --calibration-batch-manifest <batch-manifest>
node .\dist\cli.js source-navigation-export-recipes --url https://www.google.com/search?q=tokyo+hotel
node .\dist\cli.js source-navigation-export-recipes --url https://www.google.com/search?q=tokyo+hotel --calibration-batch-manifest <batch-manifest> --actions-output-file .\source-navigation-actions.json --fail-empty-export
node .\dist\cli.js source-navigation-promote-batch --calibration-batch-manifest <batch-manifest> --output-dir .\promotion
node .\dist\cli.js source-navigation-promotion-review --promotion-dir .\promotion --format commands
node .\dist\cli.js evidence-run --url https://www.youtube.com/watch?v=dQw4w9WgXcQ --timestamps-sec 0,10 --dense-sampling
node .\dist\cli.js evidence-run --url https://example.com/ --profile my-site --headed --official-api
node .\dist\cli.js auth-login --profile my-site --url https://example.com/login --wait-ms 120000 --chrome
node .\dist\cli.js auth-cdp-launch --profile my-site --url https://accounts.google.com/ --port 9222
node .\dist\cli.js auth-cdp-import --profile my-site --cdp-url http://127.0.0.1:9222 --save-now --cookie-domains google.com,youtube.com
node .\dist\cli.js profile-list
node .\dist\cli.js register-all
```

`claim-gate` exits non-zero when a claim cites missing or unregistered
evidence. In `--mode final`, it also fails zero-claim reports by default.

`smoke-media` serves a local page with PNG, SVG, poster, VTT, and video
resources. Image-like resources and VTT files are written under `media/`;
captured VTT files are also parsed into `structured/*.transcripts/*.json`.
Video/audio/stream resources are indexed in `structured/*.media-index.json`
unless a legitimate byte source is captured without bypassing platform limits.

`html-preview` writes `html/farm-evidence-preview.html` with screenshot
thumbnails and links to raw artifacts.

`critique-next` prints exactly one next media critical review task. It does not
mutate the queue. `critique-complete` advances the queue only when that task's
configured output file exists and is non-empty, so a 10-round review cannot be
collapsed into one untracked response.

`platform-capabilities` prints a static, source-linked capability map for
YouTube, Instagram, TikTok, or a generic browser fallback. It does not fetch the
URL; it labels each evidence path as `available`, `unavailable`, or
`not_attempted` with credential and legal constraints.

`official-api-readiness --url <url>` checks official API credential readiness
without calling provider APIs. It reports which supported lookups exist for the
URL, which credential env var references were supplied, and whether those env
vars are set, while never printing raw token values. Search, hashtag, profile,
or listing URLs on supported platforms report `missing_media_id` until a direct
media/item URL or destination follow-up provides a stable media ID. Add
`--fail-not-ready` in automation when any missing reference/env/media ID should
exit non-zero.

`evidence-run` is the first-class workflow wrapper: it writes platform
capability artifacts, writes a source strategy artifact, attempts a browser
page capture, samples timestamped browser-visible frames unless `--no-frames`
is set, writes source navigation plan and execution-plan artifacts, writes an
assessment report, optionally calibrates source-navigation selector candidates
read-only, optionally runs explicit safe source-navigation recipes,
optionally runs OCR over sampled frames, optionally collects
credentials-gated official API metadata, classifies
browser-visible obstructions, adds typed claim/citation ledgers, and runs the
final claim gate. Dense sampling can
trigger from browser-exposed transcript cues, OCR text hits, and browser-visible
scene changes detected through a small canvas fingerprint of sampled video
frames. Run assessments preserve dense sampling events with the trigger source,
hit timestamps, planned timestamps, captured timestamps, caps, and scene-change
distances when available. Scene-change diagnostics also include threshold
recommendations when the sampled distance distribution suggests keeping,
lowering, raising, or manually reviewing the current threshold, and
scene-change hit expansion can be capped independently from the dense frame
capture budget. When
`--dense-sampling` and `--ocr` are both enabled, verified OCR text
hits can trigger additional browser-visible frame sampling around the hit
timestamp, followed by OCR over those dense frames. Before capture, the workflow
also attempts a bounded dismissal pass for ordinary overlays such as close
buttons, not-now prompts, newsletter modals, and reject/necessary-only cookie
banners. It records that pass as `browser_overlay_dismissal` evidence when an
action occurs, and it intentionally skips login, CAPTCHA, age-gate, payment,
accept-all, and app-open buttons. The pass is configurable through
`overlayDismissal` in MCP/HTTP input and through CLI flags. Login walls, app-open
interstitials, bot blocks, region/age gates, and unavailable-media pages are
recorded as structured `browser_obstruction` evidence instead of being treated
as successful content access. Audio and transcript understanding remain marked
unverified unless an authorized caption body, transcript cue, or audio
transcription artifact exists in the run. The workflow also reports stage
timings for setup, browser open/capture/frame sampling, official API, OCR,
OCR-hit dense sampling, scene-change dense sampling, overlay dismissal,
obstruction classification, claim gate, and final report generation.

Source navigation execution is disabled by default. When `sourceNavigation` is
enabled through MCP/HTTP input or CLI flags, the workflow opens a read-write
lease and runs only the supplied action-key recipes before final page capture.
It records `source_navigation_action` artifacts for executed, skipped,
unsupported, or failed actions. It does not infer live-site selectors on its own.
Recipes can include `expectedStates` to assert visible selector/text state and
`captureScopes` to preserve selected regions such as a map viewport, place
panel, travel price card, or rate policy panel as separate evidence artifacts.
Recipes can also use `operation: "follow_up"` with either a selector or literal
URL, or `operation: "extract_destinations"` to read several visible HTTP(S)
links from an already visible result/module selector without clicking the parent
page. Follow-up and extracted-destination requests do not click through in the
parent page; they resolve destinations, record `source_navigation_followup`
artifacts for selected child runs, and run bounded one-depth child evidence
runs under `runDir/followups`. Extracted destination lists prefer unique
normalized URLs before duplicate hash variants when filling `maxLinks`, while
still preserving duplicates if the page does not expose enough unique links.
Action metadata records raw, usable, unique, duplicate, and omitted duplicate
destination candidate counts for QA.
Destination requests pass through bounded
destination triage: candidates are recorded as `destination_candidate` evidence,
scored with deterministic browser-visible URL/text signals, capped by top-K and
per-domain follow-up budgets, then re-checked with child-page evidence density,
  obstruction, query-overlap, and possible query/evidence script mismatch
  signals after selected child runs finish. The candidate score also records
  authority, freshness, and source-family fit
breakdowns using source-family scoring profiles for search, map/local,
blog/content, portal/news, travel booking, commerce, video/social, and generic
web contexts. Candidate and triage artifacts also preserve
`reasonCodes.positive` and `reasonCodes.negative` arrays so reviewers can see
deterministic selection, rejection, and child-usefulness reasons such as
  `query_overlap`, `official_domain_match`, `price_or_offer_visible`,
  `transcript_or_ocr_hit`, `query_script_mismatch_possible`, `portal_shell`,
  `thin_content`, `blocked_surface`, and `unsupported_destination`.
  Destination triage summaries and final reports also
aggregate those positive and negative reason codes so calibration runs can be
  compared without opening every artifact. When a selected child page is
  downgraded while other candidates were left unattempted by the top-K budget,
  the summary reports fallback candidate counts and whether a retry with a higher
  `maxFollowUps` value or narrower selector set is recommended. The result is
  summarized as `destination_triage` evidence. This is not autonomous crawling.
  Path-based map queries such as Google Maps `/maps/search/<query>` and Naver
  Map `/p/search/<query>` are normalized into the same child-evidence query
  diagnostics, and benign Google Maps place parameters such as `authuser=0` are
  not treated as login surfaces. Map-provider boilerplate links such as Naver
  portal/help links, Kakao corporate/support links, and Google support/policy
  links are treated as low-value provider shell evidence rather than useful
  place destinations or depth-2 proposals.
Useful child pages emit
`destination_deepening_proposal` artifacts for visible depth-2 candidates.
By default those candidates are not executed. When `sourceNavigation.maxDepth`
or `--source-navigation-max-depth` is explicitly set to `2`, evidence-run can
execute the proposed depth-2 candidates under separate depth-2 count,
per-domain, timeout, and artifact-count budgets, record
`destination_deepening_run` evidence, and keep source navigation disabled
inside the deeper child run to prevent recursion.
Final claim-gate validation also treats destination evidence as provenance-
sensitive: destination claims must cite the parent source-navigation action,
destination candidate, child follow-up, and deeper proposal artifacts required
for the claimed evidence kind, not only a portal snippet or a final summary.
Broader maintained provider selectors still require calibration.

`source-navigation-recipes --url <url>` prints manual-only selector/action and
capture-scope candidates for calibration. It is not a live crawler and does not
execute those candidates by default; copied recipes still have to be supplied
explicitly through `sourceNavigation.actions`.

`source-navigation-calibrate --url <url>` opens the page read-only, captures the
page, probes those manual-only candidates for match/visibility/signal
diagnostics, and writes `source_navigation_calibration` artifacts. It does not
click, fill, scroll, follow links, or dismiss gates.

`source-navigation-calibration-targets` turns the source registry into starter
target files for calibration batch runs. Filter by category, locale, platform,
source family, support tier, query, or limit; output JSON for review or
`--format lines` for direct use as a `source-navigation-calibrate-batch`
`--urls-file`. Targets are ordered by local top-slot rank when category/locale
are supplied. Private messenger and derivative AI-answer entries are skipped.

`source-coverage-readiness --category <name> --locale <segment>` audits source
registry slots against one or more promotion summaries. It classifies each
slot as ready, blocked, needing repeated calibration, manual-review-required,
promoted-empty, not-promoted, derivative-skip, private-skip, or planning-only.
When both category and locale are supplied, it defaults to the local top-three
planning slots; override with `--top-rank <n>`. Use
`--promotion-summary <path>`, `--promotion-summaries <a,b>`,
`--promotion-dir <path>`, or `--promotion-dirs <a,b>` to include promotion
results. `--format targets` prints calibration target lines only for actionable
not-ready slots. `--format retry-commands` prints an `auth-login` profile setup
command followed by a profile/headed `source-coverage-calibrate` command for
blocked slots, so login walls, human/bot checks, and access-denied surfaces can
be retried through an explicit saved profile. Complete the visible login,
consent, or challenge step in the `auth-login` window only when that is lawful
and user-controlled. `--fail-not-ready` exits non-zero when any actionable slot
is not ready.

`source-coverage-calibrate --category <name> --locale <segment>` closes the
readiness-to-calibration loop. It writes `coverage-readiness-before.json`,
`calibration-targets.txt`, `coverage-calibration-plan.json`, and
`coverage-calibration-report.md` under `--run-root`; with `--plan-only` or
`--dry-run` it stops there. Without plan-only, it runs read-only
`source-navigation-calibrate-batch` over the actionable not-ready targets,
writes `calibration-batch-manifest.json`, promotes the batch into grouped
catalog/export/actions files, writes `promotion-review.json`, writes
`coverage-readiness-after.json`, and refreshes the Markdown report. It still
does not execute promoted source-navigation actions; use the promotion review
output for explicit evidence-run execution after inspection. When
`--headed`, `--profile <name>`, or `--persistent-profile` are supplied, the
loop plan records that runtime and includes it in the generated calibration
command so blocked-platform retry batches are reproducible.
`source-coverage-retry-plan --retry-plan <profile-headed-retry-plan.json>` is
a read-only handoff inspector. It validates the generated JSON and can print
the plan as JSON, Markdown, all commands, setup-only commands, or retry-only
commands without opening a browser. Use `--platform <id>`,
`--priority top_slot_blocked|blocked`, and `--limit <n>` to select a smaller
retry batch such as only Expedia or the highest-priority blocked top slot. Add
`--output-file <path>` to write that filtered handoff to a command, Markdown,
or JSON file instead of stdout. `--format check --fail-check` validates that
retry commands still include the required headed/profile/browser-channel/
persistent-profile flags and selector-hint handoffs before QA runs them.
Add `--check-files` to the same check when the consumer should also fail on
missing `selector-hints.tsv` handoff files, and `--check-profiles` when it
should fail before retry execution if the referenced local browser profile has
not been created by the setup command yet. Add `--only-check-ok` when printing
commands or JSON to keep only retry items with no check errors under the
selected check options. Markdown retry-plan output includes the same preflight
summary, so command handoffs and selector-hint/profile readiness are visible in
one QA artifact.
`destination-recovery-plan --run-dir <evidence-run-dir>` is a read-only
handoff inspector for `destination_triage` artifacts. It extracts
`blockedChildRecoveryAdvice` from a completed evidence run and can print JSON,
Markdown, all commands, setup-only commands, retry-only commands, or a
preflight check without opening a browser. Use this after a run reports blocked
child recovery candidates to copy the Chrome persistent-profile setup and
headed evidence-run commands from the artifact bundle instead of re-opening raw
triage JSON. If an older triage artifact only contains
`blockedChildRecoveryCandidates`, the CLI synthesizes equivalent
profile/headed recovery advice from those candidates, and it tolerates UTF-8
BOM-prefixed JSON artifacts written by Windows handoff scripts. JSON and
Markdown output mark whether each item came from original artifact advice or
synthesized recovery candidates. Markdown output includes the same preflight
summary, and `--check-profiles` adds saved-profile readiness to that handoff. Add
`--format check --check-profiles --fail-check` when QA should confirm the
deterministic recovery profile already exists before retry execution, or
`--only-check-ok` when rendering only passing recovery commands.
`source-coverage-calibrate` writes the same preflight result as
`profile-headed-retry-plan-check.json` beside the retry-plan artifacts, and the
coverage report summary includes its ok/error/warning counts. The generated
`profile-headed-retry-plan.md` also includes that preflight summary beside the
setup/retry commands. The report includes a `Profile/Headed Retry Check`
section listing issue codes and target platforms when the check reports
warnings or errors. The same `--check-files` and `--check-profiles` flags can
be passed to `source-coverage-calibrate` so the generated check JSON, retry plan
Markdown, and report reflect current selector-hint/profile disk state, not just
command shape.
Add `--include-search-variants` when the calibration pass should expand
supported search targets into reviewed vertical surfaces. Current reviewed
seeds cover Google, Naver, Daum/Kakao, Bing, Yahoo Search, and Yahoo Japan
Search variants such as news, images, videos, local/place, shopping, blog/cafe,
and Q&A where the provider exposes a stable search URL. This keeps broad
search-page readiness separate from per-module selector promotion.
Yahoo Search vertical calibration uses the provider's current vertical hosts
(`images.search.yahoo.com`, `news.search.yahoo.com`, and
`video.search.yahoo.com`). Provider vertical search links are treated as
navigation/calibration surfaces, not as maintained destination follow-up
evidence.
Yahoo Japan vertical calibration applies the same boundary: vertical search
URLs for Yahoo Japan News, Maps, Shopping, and Chiebukuro/Q&A are low-value
navigation surfaces, while narrower result-card selectors such as `.sw-Card`
can be promoted only after repeated calibration and explicit evidence-run
review.
Bing search result extraction has one extra live-site caveat: unattended Bing
may render a solve-the-task challenge or a delayed shell before result cards are
visible. Challenge phrases are classified as bot-block evidence, and repeated
calibration should use a longer wait before promoting search result selectors.
Broad `#b_results` containers may be captured as SERP evidence, but maintained
destination extraction must use narrower result-card scopes such as
`#b_results .b_algo`. Search redirect URLs such as Bing `ck/a?u=...`, Google
`/url?q=...` and `/aclk?adurl=...`, Naver desktop/mobile redirect params, and
Yahoo/Yahoo Japan `/RU=...` paths are resolved before destination scoring and
child evidence execution so per-domain budgets apply to the real target domain,
not the search portal redirect host.
Coverage calibration plans also record each target's detected platform/source
family before the browser run. For example, Naver/Daum news vertical URLs may
be planned from a search slot but promote under `naver_news` or `daum_news`
portal groups after detection.
Use `--calibration-concurrency <1-5>` to run reviewed read-only calibration
attempts in bounded parallel batches. The default is `1`; keep
profile-heavy, login/challenge, persistent-profile, or fragile provider retries
at `1`.

`source-navigation-calibrate-batch --urls-file <path>` runs that same read-only
calibration over many URLs. The target file can be one URL per line, `id url`
per line, a JSON array, or `{ "targets": [...] }`. Each attempt gets its own
run directory under `--run-root`, and the command writes
`calibration-batch-manifest.json` with succeeded/failed attempts plus
`source-navigation-catalog --calibration-run-dirs` and
`source-navigation-export-recipes --calibration-run-dirs` command hints. Use
`--repeat <n>` to collect repeated calibration runs before promotion. The
manifest records whether the batch ran headless/headed and whether it used no
profile, a storage-state profile, or a persistent Chromium profile. It also
records the effective calibration concurrency; `--persistent-profile` requires
concurrency `1`.

`source-navigation-catalog --url <url>` builds explicit-opt-in recipe proposals.
Without calibration every action remains `calibration_required`. With
calibration, read-only capture/follow-up/extract-destinations/wait/scroll actions can become
`single_run_ready`; click actions stay `manual_review_required`,
fill/select/press stay `manual_value_required`, and blocked signals prevent
promotion.

Calibration input can come from raw report files or from evidence run
directories. Use `--calibration-file <path>` or `--calibration-files <a,b>` for
raw `source_navigation_calibration` JSON/text artifacts. Use
`--calibration-run-dir <path>` or `--calibration-run-dirs <a,b>` to load
calibration artifacts from a run directory's `artifacts.jsonl`, with a
`raw/` and `structured/` fallback when the ledger is missing. Use
`--calibration-batch-manifest <path>` or `--calibration-batch-manifests <a,b>`
to load all succeeded run directories from a
`source-navigation-calibrate-batch` manifest while preserving failed attempts
as warnings. Repeated calibration reports are compared before promotion: a
read-only capture/follow-up/extract-destinations/wait action becomes `maintained_recipe_ready` only
when the same selector or capture scope is observed across the required runs
and fixture coverage exists. Maintained entries still execute only through
explicit opt-in recipes. Calibration reports whose platform or source family
differs from the current recipe plan are skipped with warnings, so selectors
from Naver, Google, travel, and SNS runs cannot cross-promote each other
accidentally. Broad page-shell destination selectors such as
`#root a[href^="http"]`, `body a[href]`, or `[role="main"] a[href^="http"]`
are also excluded from maintained `extract_destinations` export; they can prove
that links exist, but they are too broad for trusted child-page selection.

`source-navigation-export-recipes --url <url>` accepts the same calibration
file/run-directory flags and exports only `maintained_recipe_ready` read-only
actions as explicit `sourceNavigation.actions` JSON. Non-ready, mutating,
login, payment, booking, CAPTCHA, gate-bypass, and account-changing entries are
omitted with reasons. Use `--actions-output-file <path>` to write the exact
JSON array accepted by `evidence-run --source-navigation-actions-file`; use
`--export-output-file <path>` to write the full export bundle. Add
`--fail-empty-export` in automation so an empty maintained recipe export exits
non-zero instead of silently creating an empty action file.

`source-navigation-promote-batch --calibration-batch-manifest <path>` processes
every platform/source-family group in a batch manifest. It writes grouped
`catalog.json`, `export.json`, and `actions.json` files under `--output-dir`,
plus `promotion-summary.json`. The generated `actions.json` files are the
direct input for `evidence-run --source-navigation-actions-file`. Add
`--fail-empty-export` when automation should fail if any group has no
maintained actions.

`source-navigation-promotion-review --promotion-summary <path>` or
`--promotion-dir <path>` classifies each promoted group as ready, blocked,
needing repeated calibration, manual-review-required, or empty. It returns the
ready `actions.json` files plus exact `evidence-run` argv and PowerShell
commands. If the calibration batch used a profile/headed runtime, ready
evidence-run commands include the same runtime flags. Use `--format commands`
to print only the runnable commands and
`--fail-no-ready` when automation should stop unless at least one promoted
action file is usable. Promotion review also accepts the source-navigation
follow-up/deepening budget flags, including
`--source-navigation-max-followups`,
`--source-navigation-followup-concurrency`, `--source-navigation-max-depth`,
`--source-navigation-fallback-followups`, and
`--source-navigation-deepening-concurrency`, and copies them into generated
`evidence-run` commands so QA runs can reproduce the intended fallback,
parallel, and depth-2 exploration budget. Promotion summaries and review output also preserve
destination-extraction readiness separately from general capture readiness:
`candidateCount`, `readyActionCount`, `readyActionKeys`, and blocked/repeated-
calibration counts show whether `extract_destinations` is ready for bounded
child evidence runs.

`source-coverage-readiness` carries that same split into registry QA. A source
slot can be `ready` for page/result capture while its
`destinationExtraction.status` is still `needs_repeated_calibration` or
`not_promoted`, which is the expected state before natural Google/Naver
deepening is trusted across arbitrary live result modules. The
`source-coverage-calibrate` Markdown report also prints destination-extraction
ready/not-ready counts, status counts, per-source extraction status, and
promotion-level ready `extract_destinations` totals. Promotion keeps scoped
provider destinations separate from provider shells: Naver Place and Naver
`/p/entry/place` selectors can become maintained after repeated calibration,
while generic Naver Map-domain selectors remain calibration-required because
they can still point at map shell surfaces.

Useful `evidence-run` options:

- `--profile <name>` reuses a saved profile from `auth-login`.
- `--persistent-profile` uses a full Chromium user data directory.
- `--headed` opens a visible Chromium window for CLI debugging.
- `--no-overlay-dismissal` disables the cautious pre-capture overlay dismissal
  pass.
- `--overlay-dismissal-max-actions <0-10>` changes how many ordinary overlay
  dismissals can happen before capture; the default is `3`.
- `--ocr` runs bounded OCR over sampled frame screenshots when optional
  `tesseract.js` peer dependency is installed; otherwise it records an
  OCR-unavailable artifact. Empty text and low-confidence text are recorded as
  partial status so they do not become verified OCR evidence. OCR text-profile
  metadata distinguishes price, percent/discount, map/local, travel/commerce,
  rating, distance, hours, contact/address, reservation, menu, and commerce
  policy text.
- `--ocr-language <lang>` passes a language code such as `eng` or `eng+kor` to
  `tesseract.js`.
- `--ocr-min-confidence <0-100>` marks OCR text partial when reported
  confidence is below the threshold.
- `--dense-sampling` captures additional frame windows around browser-exposed
  transcript cue hits, browser-visible scene changes, and, when OCR is enabled
  and available, OCR text hits.
- `--dense-scene-threshold <1-64>` sets the 8x8 visual fingerprint hamming
  distance needed to treat adjacent sampled frames as a scene-change hit.
- `--dense-scene-max-hits <1-120>` caps how many scene-change midpoints are
  expanded before the dense frame cap is applied; by default it follows
  `--dense-max-frames`.
- `--no-dense-scene-change` disables scene-change dense sampling while leaving
  transcript/OCR dense sampling enabled.
- `--official-api` attempts supported platform APIs only through explicit env var
  credential references such as `--youtube-api-key-env YOUTUBE_API_KEY`.
- `--source-navigation` enables explicit source-navigation recipe execution.
- `--source-navigation-calibrate` probes manual-only selector candidates
  read-only during `evidence-run` and records `source_navigation_calibration`
  artifacts.
- `--source-navigation-calibration-timeout-ms <ms>` sets the calibration body
  text read timeout.
- `--source-navigation-actions-json <json>` or
  `--source-navigation-actions-file <path>` supplies action recipes such as
  `[{"actionKey":"bounded-scroll","operation":"scroll","direction":"bottom"}]`.
- `--source-navigation-timeout-ms <ms>` and
  `--source-navigation-max-actions <n>` bound recipe execution.
- `--source-navigation-max-followups <0-5>` bounds explicit follow-up or
  extracted-destination child evidence runs; the default is `1`.
- `--source-navigation-max-followups-per-domain <0-5>` bounds how many selected
  child evidence runs can target the same destination domain; the default is
  `min(2, max-followups)`.
- `--source-navigation-followup-concurrency <1-5>` bounds how many selected
  follow-up child evidence runs can execute at the same time; the default is
  `1`.
- `--source-navigation-fallback-followups` explicitly allows a bounded fallback
  pass when selected child evidence is downgraded and lower-ranked candidates
  remain unattempted.
- `--source-navigation-max-fallback-followups <0-5>` bounds that fallback pass;
  the default is `1` when fallback follow-ups are enabled.
- `--source-navigation-max-depth <1-2>` defaults to `1`, which records depth-2
  proposals only. Set it to `2` to execute proposed deeper child evidence runs
  explicitly.
- `--source-navigation-max-deepening-runs <0-5>` bounds depth-2 child runs;
  the default is `min(1, max-followups)`.
- `--source-navigation-max-deepening-runs-per-domain <0-5>` bounds depth-2
  runs per destination domain; the default is `min(1, max-deepening-runs)`.
- `--source-navigation-deepening-concurrency <1-5>` bounds how many selected
  depth-2 child evidence runs can execute at the same time; the default is `1`.
- `--source-navigation-deepening-timeout-ms <ms>` sets a whole-run timeout for
  each depth-2 child evidence run; the default is `min(parent timeout, 15000)`.
- `--source-navigation-max-deepening-artifacts <1-1000>` marks a depth-2 child
  result as `budget_limited` when its artifact count exceeds the cap; the
  default is `100`.

See `docs/OFFICIAL_API.md` for YouTube, Instagram, TikTok credential setup and
the opt-in live integration harness. Normal `npm test` runs do not call live
official APIs.

See `docs/OCR.md` for optional `tesseract.js` setup and the opt-in OCR
integration harness. Normal `npm test` does not require the OCR engine.

See `docs/DOCUMENTATION_MAP.md` for the complete development documentation map,
including the recommended Codex/Claude reading order, QA/QC process, release
notes, and the current verification caveat. See `docs/CLAUDE_HANDOFF.md` for a
copyable handoff prompt for Claude.

See `docs/SOURCE_STRATEGY.md` for the generic plan for Naver Map, Naver Blog,
Google Search/Maps, Agoda, Trip.com, Booking.com, Expedia, and similar sources.
See `docs/INFORMATION_SOURCE_TAXONOMY.md` for the category/locale coverage
registry that prioritizes top platform slots across search, social, community,
content, news, review, map/local, commerce, knowledge, private network,
recommendation, and AI-agent sources.

`serve-http` starts a local JSON queue. Use `--concurrency <n>` to run multiple
evidence jobs and `--max-terminal-jobs <n>` to bound retained completed,
failed, and canceled jobs. Endpoints:

- `GET /health`
- `POST /evidence-run`
- `GET /jobs`
- `GET /jobs?status=queued|running|completed|failed|canceled`
- `GET /jobs/:id`
- `POST /jobs/:id/cancel`
- `DELETE /jobs/:id`
- `POST /jobs/prune`

Queued jobs are canceled immediately. Running jobs receive an abort signal and
unwind at workflow and BrowserPool abort checkpoints; owned browser pools are
released/shut down during cleanup. This server is intended for local
orchestration, not a production shared service. Job responses include lifecycle
diagnostics such as `startedAt`, `finishedAt`, `queueDurationMs`,
`runDurationMs`, `totalDurationMs`, and `abortLatencyMs` when applicable.

`auth-login` opens a visible browser and saves storage state under
`~/.gstack/browser-profiles/<profile>/storage-state.json`. Use it for normal
service login flows: the site opens its login/consent popup, the user finishes
login manually, then the saved profile can be reused by farm leases. Add
`--persistent-profile` when the site needs a full Chromium user data directory
instead of storage-state only. Add `--chrome` or
`--browser-channel chrome` to use the installed Chrome channel instead of the
bundled Playwright Chromium for sites that reject automation-oriented browser
builds.

`auth-cdp-launch` opens a user-controlled Chrome window with a local DevTools
port and a farm profile user-data directory. `auth-cdp-import` then attaches to
that Chrome session and saves cookies/storage state into the farm profile
without reading passwords. Use this pair when a platform rejects direct
Playwright login: launch Chrome, complete login in that Chrome window, then run
`auth-cdp-import --profile <name> --cdp-url http://127.0.0.1:9222`. Add
`--save-now` to skip the Enter prompt and `--cookie-domains <a,b>` to save only
the target platform's cookies/origins from the attached Chrome session.

Only one active lease may use a given saved profile at a time. This prevents two
browser workers from overwriting the same cookies, localStorage, or IndexedDB
snapshot.

Payment pages remain blocked for write actions.

`register-all` installs the MCP server into the local Codex and Claude user
configs and creates timestamped backups before editing config files.

## GStack Upgrade Safety

This farm is an independent local package. It runs from the absolute path
registered in Codex/Claude config. A normal gstack skill upgrade updates
`~/.codex/skills/gstack*`; it should not overwrite this local package or the
MCP config marker block.

After any gstack or agent-host upgrade, run:

```powershell
npm run verify
node .\dist\cli.js register-all
claude mcp get browser-agent-mcp-farm
```

If Codex does not expose `mcp__browser_agent_mcp_farm__*` tools after an
upgrade, restart Codex once and run `register-all` again.

## MCP Write Tools

Write tools require a lease with `capability: "read-write"`:

- `farm_click`
- `farm_fill`
- `farm_press`
- `farm_select_option`

Read/navigation helpers are available for slower dynamic pages and long-scroll
research pages:

- `farm_evidence_run`
- `farm_wait`
- `farm_wait_for_selector`
- `farm_scroll`
- `farm_capture_after_idle`
- `farm_sample_frames`

`farm_sample_frames` seeks a browser-visible media element to timestamped
positions and writes one screenshot bundle per frame. It does not download raw
video bytes. Each frame metadata includes timestamp, seek result, active
caption cues when the page exposes them, and a small browser-visible visual
fingerprint when the page allows canvas reads. It also records available
`<track>` elements and text-track metadata in the summary artifact.

`farm_evidence_run` exposes the same evidence workflow through MCP. It uses the
server BrowserPool lifecycle, so visible headed debugging remains a CLI-only
option.

The payment guard blocks write actions on URLs, selectors, and target element
text/attributes containing payment-like terms such as `checkout`, `payment`,
`billing`, `credit-card`, `card number`, `cvv`, `pay now`, or `결제`.
