# Portal Navigation Implementation Guide

This is the lower-level build guide for the next development pass.

## Build Rule

Do Phase 1 first. Do not jump directly to real-site clicking, filters, or map
automation.

Phase 1 creates durable planning artifacts and is now implemented locally:

- what the agent intends to do
- which evidence targets matter
- which actions are explicitly unsupported
- what follow-up evidence runs are required

Phase 2 can execute a bounded subset only after Phase 1 is typed and tested.
Phase 2.5 adds source-category coverage before broad real-site recipe catalogs
and is now implemented locally.

## Phase 1: Navigation Plan Artifact

Status: implemented locally. Keep this section as the reference for future
maintenance and regression tests.

### Files

Created:

- `src/source-navigation.ts`
- `tests/source-navigation.test.ts`

Modified:

- `src/schemas.ts`
- `src/evidence-runner.ts`
- `src/artifact-writer.ts`
- `src/index.ts`
- `tests/evidence-runner.test.ts`
- `package.json`
- docs listed in `docs/PRODUCT_DEVELOPMENT_PLAN.md`

### Types

Added evidence kind:

```ts
"source_navigation_plan"
```

Recommended exported types:

```ts
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
  | "capture_map_viewport"
  | "open_media_gallery"
  | "sample_video_frames"
  | "run_ocr"
  | "follow_destination"
  | "classify_obstruction";
```

Keep payloads explicit. Avoid `Record<string, unknown>` except for provider
raw metadata that is already safely contained.

### Planner Function

Implemented:

```ts
export function describeSourceNavigationPlan(input: {
  url: string;
  sourceStrategy: SourceStrategy;
}): SourceNavigationPlan
```

The planner should be deterministic. It should not read the network, browser, or
filesystem.

### Action Template Requirements

Search:

- `set_query`
- `open_vertical_tab`
- `apply_filter`
- `apply_sort`
- `select_result`
- `follow_destination`

Map:

- `set_query`
- `apply_filter`
- `capture_map_viewport`
- `select_map_place`
- `run_ocr`

Blog/forum:

- `select_result` or direct article capture
- `open_media_gallery` when images matter
- `run_ocr` for embedded text images
- comments as conditional extraction target

Travel/commerce:

- `set_query`
- `apply_filter`
- `apply_sort`
- `select_result`
- `run_ocr`
- unsupported payment/booking/account actions

Video/social:

- `classify_obstruction`
- `sample_video_frames`
- `run_ocr`
- transcript/caption extraction target when present
- unsupported raw media download and gate bypass

Generic web:

- capture page
- infer likely source shape
- propose conservative follow-up actions

## Phase 1 Evidence-Run Integration

In `runEvidenceWorkflow`:

1. Build source strategy as today.
2. Build navigation plan from URL and source strategy.
3. Write navigation plan artifact after `source_strategy_artifact`.
4. Include records in `EvidenceWorkflowResult`.
5. Include plan summary in `EvidenceWorkflowAssessment`.
6. Include platform/family/action count/unsupported action count in final
   report.

Expected report lines:

```text
- Source strategy: naver_search / search
- Source navigation plan: plan_only, 6 actions, 2 extraction targets, 0 unsupported actions
```

## Phase 1 Tests

### Unit Tests

`tests/source-navigation.test.ts`:

- Naver search URL yields search family actions and Korean portal extraction
  targets.
- Naver map URL yields map viewport and place-panel actions.
- Naver blog URL yields article/media/OCR targets.
- Google search URL yields SERP and destination-follow-up actions.
- Google Maps URL yields map/selected-place actions.
- Agoda/Trip/Booking/Expedia URLs yield travel query-state requirements and
  unsupported booking/payment actions.
- YouTube/Instagram/TikTok/X-Twitter URLs yield video/social actions and
  unsupported raw stream/gate bypass actions.
- Generic URL yields conservative capture/follow-up plan.

### Workflow Tests

`tests/evidence-runner.test.ts`:

- evidence-run writes a `source_navigation_plan` artifact.
- assessment contains the navigation plan summary.
- final report renders the source navigation plan line.
- claim gate still passes on `https://example.com/ --no-frames`.

### Package Test

Run:

```powershell
npm test -- tests/source-navigation.test.ts tests/evidence-runner.test.ts
npm run verify
npm pack --dry-run
```

## Phase 2: Safe Navigation Executor

Phase 2 should add execution only for actions that are safe and bounded.

Status: first browser-backed slice implemented locally.

Implemented files:

- `src/source-navigation-execution.ts`
- `src/source-navigation-executor.ts`
- `tests/source-navigation-execution.test.ts`
- `tests/source-navigation-executor.test.ts`

Evidence kinds added:

```ts
"source_navigation_execution_plan"
"source_navigation_action"
```

### Execution Rules

- Use Playwright locators and built-in actionability checks.
- Record before/after screenshots for every action.
- Record action metadata: kind, selector, visible text, URL before/after,
  timestamp, timeout, status.
- Use max action count.
- Use per-action timeouts.
- Use abort propagation.
- Stop on unsupported gates.
- Never force-click through blocked UI.
- Execute only explicit action-key recipes. The default plan by itself is not
  allowed to guess selectors or click live sites.

### Executor Data Flow

```text
navigation plan
  |
  v
for each planned action
  |
  +--> classify unsupported?
  |      |
  |      +-- yes -> unsupported artifact -> skip/stop
  |
  +--> capture before
  |
  +--> locate target
  |
  +--> perform safe action
  |
  +--> capture after
  |
  +--> extract visible state
  |
  v
action result ledger
```

Current executor operations:

- `click`
- `fill`
- `select`
- `press`
- `scroll`
- `wait_for_selector`
- `capture`

Current evidence-run integration:

- every run writes a `source_navigation_execution_plan` artifact
- assessment/final report include execution-plan step counts and timeout limits
- safe action execution is available through explicit evidence-run
  `sourceNavigation` recipes across CLI/MCP/HTTP
- when enabled, evidence-run uses a read-write lease and runs only supplied
  action-key recipes before final page capture

Recipe input shape:

```json
{
  "sourceNavigation": {
    "enabled": true,
    "actions": [
      {
        "actionKey": "selected-place",
        "operation": "click",
        "selector": "#place-alpha",
        "captureScopes": [
          { "key": "place-panel", "selector": "#place-panel" }
        ],
        "expectedStates": [
          { "selector": "#place-panel", "textIncludes": "Cafe Alpha" }
        ]
      }
    ],
    "perActionTimeoutMs": 10000,
    "captureBeforeAfter": true
  }
}
```

CLI example:

```powershell
node .\dist\cli.js evidence-run --url https://example.com/ --no-frames --source-navigation --source-navigation-actions-json "[{\"actionKey\":\"bounded-scroll\",\"operation\":\"scroll\",\"direction\":\"bottom\"}]"
```

Follow-up scope today:

- explicit `follow_up` recipes can resolve one destination URL from a selector
  or literal URL
- explicit `extract_destinations` recipes can read several visible HTTP(S)
  links from an already visible result/module selector without clicking the
  parent page
- evidence-run can launch bounded one-depth child runs under `runDir/followups`
- the parent page is not clicked through during follow-up resolution
- destination requests are ranked by deterministic URL/text triage before child
  runs, with low-value, duplicate, private/login, and unsupported destinations
  rejected or omitted inside the top-K budget
- selected child runs produce evidence-density summaries after execution, so a
  child page can be downgraded to low-value, off-topic, or blocked even when the
  child run completed

## Phase 2B: Destination Deepening

Status: partially implemented locally. The foundation exists for explicit
one-depth follow-up, multi-link extraction, child usefulness scoring, proposal
artifacts, explicit opt-in depth-2 execution, and separate depth-2 count,
per-domain, timeout, and artifact-count budgets. Broad provider-maintained
destination selectors still need work.

### Implemented Foundation

- `follow_up` resolves a single destination URL without clicking through the
  parent page.
- `extract_destinations` reads multiple visible HTTP(S) links from an explicit
  selector without navigating the parent page.
- `extract_destinations` can read visible non-anchor URL attributes from
  SPA-style cards/buttons, including `data-href`, `data-url`,
  `data-target-url`, `data-place-url`, `data-source-url`, and
  `data-item-url`, plus product/profile/media variants, as long as the element
  has visible text. This is for read-only candidate extraction only; it does
  not click the card.
- Recipe candidates should prefer provider-scoped attribute selectors, such as
  Google/Naver result modules, map place panels, product cards, profile cards,
  or media cards, before broad page-shell selectors. Broad non-anchor
  selectors still need repeated calibration and usefulness QA before export.
- Promotion must reject broad shell-scoped generic URL attributes such as
  `#search [data-url]`, `#rso [data-href]`, `#main_pack [data-url]`, or
  `[role="main"] [data-target-url]` as maintained destination extraction
  selectors. They may remain useful diagnostics, but maintained export needs a
  narrowed provider/path filter or a semantic URL attribute.
- Calibration now also records a diagnostic `destinationDiscovery` pass for
  `extract_destinations` actions. It scans visible anchors and supported SPA
  destination attributes across accessible frames even when planned selectors
  miss, then classifies sampled links as promotable or non-promotable. This
  helps discover the next provider-specific selector without promoting broad
  page scans into maintained recipes.
- Probe and discovery output includes classified sample targets:
  `url`, visible `text`, `source` (`anchor` or `attribute`), `attributeName`,
  frame metadata when available, and warning codes. Use these fields to design
  narrower selectors and to explain why a visible URL did or did not become a
  child evidence candidate.
- Recipe catalog entries now aggregate action-level `destinationDiscovery`
  diagnostics. If global discovery finds promotable sample targets but no
  planned selector is promotable, the catalog remains calibration-required and
  its reason points QA at the sampled targets instead of exporting a broad
  child-run recipe.
- Catalog entries also derive manual-only `selectorHints` from promotable
  sample targets. Anchor samples become host/path-scoped `a[href*="..."]`
  hints, while SPA attribute samples become host/path-scoped attribute hints
  such as `[data-place-url*="place.naver.com/restaurant"]`. Add a provider,
  result-card, panel, or module container scope before retrying calibration.
  The catalog now includes first-pass scoped selector suggestions when the
  platform has a known stable container, for example
  `#root [data-place-url*="place.naver.com/restaurant"]` for Naver Map. These
  suggestions are still `manual_calibration_required`.
- Naver Map recipe candidates also include path-scoped Naver Place selectors
  directly for restaurant, hospital, generic place, and accommodation
  destinations across `data-place-url`, `data-url`, and anchors. Keep treating
  them as calibration candidates until repeated real-site runs prove them; the
  point is to reduce dependence on broad `#root a[href^="http"]` shell scans.
- `source-navigation-catalog --format selector-hints` prints those hints as
  tab-separated lines: platform, source family, action key, selector, scoped
  selector suggestions, sample URL, host, path prefix, anchor/attribute source,
  attribute name, and promotion policy. This is meant for calibration planning,
  not direct evidence-run execution.
- `source-navigation-promote-batch` writes the same hint lines to
  `selector-hints.tsv` inside each promotion group directory. Empty files are
  valid and mean the calibration batch did not expose promotable discovery
  samples for that group.
- The TSV handoff can be fed back into the next calibration pass as additional
  manual candidates. This does not execute destination runs and does not export
  maintained recipes by itself:

```powershell
node .\dist\cli.js source-navigation-calibrate --url <url> --selector-hints-file <promotion-group>\selector-hints.tsv
node .\dist\cli.js source-navigation-calibrate-batch --urls-file <targets> --selector-hints-file <promotion-group>\selector-hints.tsv
node .\dist\cli.js source-coverage-calibrate --category <category> --locale <locale> --selector-hints-file <promotion-group>\selector-hints.tsv
```

`source-coverage-calibrate` records supplied selector-hint input paths in the
loop plan JSON, Markdown report, generated `source-navigation-calibrate-batch`
command, and calibration batch manifest. That makes profile/headed retries
auditable when a provider-specific selector pass depends on a previous
promotion group's handoff file.

- Coverage readiness items and coverage calibration-loop Markdown reports now
  preserve matching `selector-hints.tsv` paths under destination-extraction
  readiness, so QA can open the handoff file for a source slot without reading
  the full catalog JSON.
- `destination_candidate` artifacts preserve candidate URL, visible text, rank,
  source family, platform, signals, warnings, and score breakdown.
- `destination_triage` artifacts preserve selected and rejected candidates,
  top-K budget, per-domain budget, and final child usefulness.
- Child evidence runs are written under `runDir/followups`.
- Child source navigation is disabled by default to prevent recursive crawling.
- Child evidence summaries include artifact count, claim count, browser capture
  count, obstruction count, visible text length, title/final URL, query-overlap
  tokens, query/evidence script families, possible query-script mismatch,
  evidence signals, and evidence warnings.
- Google Maps `/maps/search/<query>` and Naver Map `/p/search/<query>` path
  segments are normalized as destination QA queries. Google Maps place URLs with
  benign `authuser=0` state are not login/private surfaces, and same-host map
  place details are not `portal_shell` reason codes by domain alone.
- Browser page captures now preserve bounded visible links in metadata.
- Browser page captures now aggregate visible text and visible links across
  Playwright-accessible frames. The metadata includes `visibleTextFrames`, so
  child evidence QA can tell whether useful text came from the top document or
  an embedded portal/place/result frame.
- Child evidence summaries must treat successful page-capture artifacts and
  failed/partial child-open artifacts separately. A failed child open should
  emit `browserCaptureFailedRecords` plus `failed_browser_capture` and should
  not count as successful `browser_capture` evidence.
- Useful child destinations can produce `destination_deepening_proposal`
  artifacts with depth-2 candidates.
- `sourceNavigation.maxDepth: 2` and
  `--source-navigation-max-depth 2` execute proposed depth-2 candidates only
  when explicitly requested, record `destination_deepening_run` artifacts, and
  keep source navigation disabled inside those deeper child runs.
- Depth-2 execution has separate controls:
  `sourceNavigation.maxDeepeningRuns`,
  `sourceNavigation.maxDeepeningRunsPerDomain`,
  `sourceNavigation.deepeningTimeoutMs`, and
  `sourceNavigation.maxDeepeningArtifacts`. The CLI exposes the same controls
  as `--source-navigation-max-deepening-runs`,
  `--source-navigation-max-deepening-runs-per-domain`,
  `--source-navigation-deepening-timeout-ms`, and
  `--source-navigation-max-deepening-artifacts`.
- Final claim-gate requires destination evidence claims to cite the relevant
  parent action, destination candidate, child follow-up, and deeper proposal
  artifacts for their evidence kind.

### Next Implementation Slice

The next slice is provider breadth and QA tuning: promote more real-site
destination extraction selectors, tune usefulness scoring for each source
family, and keep depth-2 timeout/artifact budgets tuned against blocked or
low-value pages.

Do not promote a source from parent-capture readiness to natural-deepening
readiness just because scoped screenshots pass. The latest Naver Map Korean
query run is the reference case: the promoted action file captured map
viewport/OCR scopes and passed final claim-gate, but it produced zero
follow-up requests and zero destination triage artifacts. That source remains
capture-ready, not destination-ready, until repeated calibration promotes a
narrow place/detail/website/review selector. A follow-up global discovery run
on the same Naver Map surface found only Naver home/login links and map-shell
hash anchors such as `#section_content` / `#header`; those are now classified
as non-promotable, which is the expected result.

### Provider-Calibrated Natural Deepening

Natural Google/Naver research needs maintained provider selectors before it can
feel automatic. The implementation order should be:

1. Calibrate result-card and module selectors for Google Search, Naver Search,
   Daum Search, Naver Blog, Naver Cafe, Naver/Daum News, maps, reviews,
   community threads, video/social cards, and commerce/travel cards.
2. Promote only stable read-only `extract_destinations` selectors that expose
   visible destination URLs without clicking unsafe controls.
3. Keep parent evidence and child evidence separate: snippets prove only what
   the portal displayed, while child runs prove destination content.
4. Tune source-family usefulness profiles with fixtures where the first result
   is useless but a lower-ranked destination is useful.
5. Add fixtures for official-homepage wins, fresh-news wins, blog/community
   lived-experience wins, duplicate portal shells, thin SEO pages, paywalls,
   login walls, app interstitials, CAPTCHA-like pages, cross-script query
   mismatch diagnostics, and blocked commerce or travel pages.
6. Promote the behavior to default only after repeated calibration shows
   stable selectors, correct selected/rejected reason codes, and final claim
   provenance across Google/Naver-style searches.

User workflow target:

1. Start from a query page such as Google Search, Naver Search, Naver Blog,
   Naver Cafe, Naver/Daum News, Google Maps, Naver Map, KakaoMap, YouTube
   search, or a commerce/travel result page.
2. Capture the parent result surface first.
3. Extract destination candidates only from maintained narrow selectors:
   result cards, headline modules, place panels, official website buttons,
   review/product cards, profile/channel links, or media cards.
4. Score candidates before opening them, using query overlap, source-family
   fit, authority/freshness hints, ranking position, duplicate/domain limits,
   and obstruction risk.
5. Run selected child pages as separate evidence workflows.
6. Re-score after child capture. A page that loads can still be `low_value`,
   `off_topic`, `blocked`, `private`, `paywalled`, or `unsupported`.
7. Allow final claims about destination content only when the report cites the
   parent action, destination candidate, child follow-up, and child evidence.

Implementation gates before default natural deepening:

- `source-coverage-readiness` must show parent capture readiness and
  destination-extraction readiness separately for the source slot.
- Promotion summaries must include at least one maintained
  `extract_destinations` action for the platform/source-family group.
- Real-site calibration must show that selected candidates are not broad portal
  shells, same-page hash links, homepages unrelated to the result, or
  cross-promoted selectors from another platform.
- For `extract_destinations`, real-site calibration must also show that the
  matched selector produces usable HTTP(S) destination URLs. Visibility alone
  is not enough to export a maintained destination recipe.
- Probe output must include at least one promotable sampled destination. Links
  that are only login/account, provider shell, help/policy, or unsupported
  surfaces prove that the selector is too broad even when the URLs are usable.
- Global `destinationDiscovery` output is a debugging aid, not readiness by
  itself. It should be used to design narrower provider selectors. It must not
  create child runs from same-document hash links, skip/header anchors,
  provider home links, login/account links, or portal shell destinations.
- Catalog/promotion/readiness summaries should expose discovery run counts,
  promotable/non-promotable candidate totals, and warning counts. These fields
  are QA handoffs only; they do not make `extract_destinations` ready without a
  repeated stable narrow selector.
- Promotion and readiness summaries count discovery selector hints so QA can
  tell whether the next action is "turn these hints into scoped recipe
  candidates" or "the page exposed only non-promotable shell/login links."
- QA should inspect `samplePromotableTargets` and
  `sampleNonPromotableTargets`, not only `sampleUrls`, before promoting
  destination extraction. A URL count without visible text, source, attribute,
  frame, and warning context is too weak to justify a maintained selector.
- Calibration must inspect accessible frames as well as the top document.
  Store `frameCount`, matched/visible frame counts, and first frame URLs so QA
  can separate "selector not visible anywhere" from "selector visible only in
  an embedded result frame."
- Fixture tests must cover useful and not-useful cases where the first result
  is not necessarily the best child source.
- Final reports must expose selected/rejected reason-code counts and child
  usefulness counts so QA can review the run without opening every artifact.
- A capture-only action file must stay valid for evidence collection, but it
  must not be interpreted as natural deepening readiness. QA should expect
  `sourceNavigationFollowUps.requestedCount: 0` and
  `destinationTriage.status: "no_candidates"` for those runs.
- For Naver Map client-state extraction, selector readiness must be checked
  across accessible frames, not only the top document. A successful extraction
  run can still fail the usefulness bar when the child Place page has empty
  browser-visible text; QA should separate extraction readiness from child
  evidence-density readiness.
- Naver Map recipe plans include `extract_client_state_destinations` as a
  separate `destination-followup` alternative. Repeated calibration can promote
  this action independently from ordinary `extract_destinations`, because the
  recipe catalog groups calibration by `actionKey + operation`. Exported action
  files still deduplicate by executable action key, so evidence-run receives
  only one explicit `destination-followup` recipe.
- Naver Map client-state extraction should execute child runs through
  `https://map.naver.com/p/entry/place/<id>` while preserving canonical
  `https://place.naver.com/<type>/<id>` as `originalUrl` with
  `urlResolutionMethod: "naver_place_entry_fallback"`. This keeps provenance
  intact while avoiding the observed local DNS failure for `place.naver.com`.
- Browser-visible Naver service-limit pages, including excessive-access
  messages, must be treated as `bot_block` obstruction evidence. QA should
  expect these child destinations to count as blocked, not useful, until a
  profile/headed/throttle-aware retry proves usable Place evidence.

Recommended type shape:

```ts
interface DestinationDeepeningProposal {
  schemaVersion: "1.0";
  parentRunId: string;
  childRunId: string;
  sourceCandidateId: string;
  depth: number;
  maxDepth: number;
  proposedCount: number;
  candidates: DestinationCandidate[];
  reason:
    | "child_page_has_relevant_official_link"
    | "child_page_has_source_document"
    | "child_page_has_related_review_or_map_link"
    | "child_page_has_primary_media_link"
    | "manual_review_required";
  executionPolicy: "proposal_only" | "explicit_opt_in_requested";
}
```

Execution rules:

- Default `maxDepth` remains `1`.
- Depth `2` execution is allowed only when input explicitly opts in.
- Each depth level gets its own top-K, per-domain, timeout, and total-artifact
  budget. Depth-2 defaults are intentionally narrower than parent follow-ups:
  one deeper run, one run per domain, `min(parent timeout, 15000)` timeout, and
  100 artifacts before the result is marked `budget_limited`.
- A child page can propose a deeper hop only if its own usefulness is `useful`
  and it has cited parent provenance.
- Final claims about a deeper page must cite the full chain:
  parent source artifact -> destination candidate -> child run -> deeper child
  run.
- Blocked, private, paywalled, checkout, login, CAPTCHA, raw-media, and
  account-changing links are never escalated into deeper execution.

### Tests For Phase 2B

- A search result with three visible links extracts candidates, selects only
  within top-K and per-domain budgets, and runs one child evidence workflow.
- A completed but empty child page is downgraded to `low_value`.
- A completed child page with no query overlap is downgraded to `off_topic`.
- A blocked child page records obstruction evidence and is downgraded to
  `blocked`.
- A useful child page emits a depth-2 proposal when visible deeper candidates
  exist, and default `maxDepth: 1` does not execute it.
- Depth-2 execution requires explicit opt-in and preserves the full provenance
  chain in final report artifacts.
- Depth-2 execution reports max runs, max per-domain, timeout, max artifacts,
  budget-limited count, and timeout count.
- Final claim-gate rejects destination claims that omit required provenance
  citations.

Still missing:

- broader platform recipe catalogs for Naver/Google/travel/video/social flows.
  The first repeated read-only `news_media` / `ko-KR` baseline now covers
  current Naver News and Daum News article capture, publisher follow-up, and
  obstruction-check actions
- Yahoo News now has fixture-verified portal coverage for global news query
  state, category/topic navigation, recency/filter state, stream item capture,
  publisher metadata, article follow-up, and obstruction capture.
- Reuters now has fixture-verified portal/publisher coverage for global news
  query/search state, section navigation, latest/filter state, story-card and
  article-body capture, publisher metadata, article follow-up, and obstruction
  capture.
- The first repeated real-site `news_media` / `global` calibration baseline now
  covers Google News, Yahoo News, and Reuters. All three are ready for explicit
  read-only portal evidence-run actions. Destination extraction is ready for
  Google News and Yahoo News; Reuters now has dated article-link selector
  candidates and provider-shell triage guards, but unattended live calibration
  currently hits DataDome challenge evidence before child article extraction is
  trusted.
- Google News destination extraction uses repeated live-calibrated
  `a[href^="./read/"]` selectors for article-read links. Provider shell links
  such as Home, For you, Following, Google apps, account, support, and policy
  surfaces must remain low-value navigation and must not be promoted as child
  article evidence.
- Reuters destination extraction should prefer dated story-card/article links
  such as `main a[href*="/world/"][href*="-20"]` and
  `[data-testid*="MediaStoryCard"] a[href*="-20"]`. Broad Reuters shell
  selectors such as `main a[href*="reuters.com"]` stay calibration-only and
  must not become maintained extraction exports.
- richer Google/result-card/gallery fixtures before any live defaults
- real-site selector tuning after local fixture coverage is stable
- broader maintained provider selectors for multi-destination extraction and
  richer child-page usefulness analysis after capture
- maintained real-site calibration showing the scoring profiles choose the
  right candidates on live Google/Naver/Daum/map/community/travel/commerce
  pages, plus blog/cafe article pages and video/social media-card pages

## Phase 2.5: Information Source Coverage Registry

Status: implemented locally.

This phase turns the user's broad taxonomy into a typed planning layer. It
should land before broad real-site recipe catalogs so development priority is
driven by category/locale coverage, not by whichever platform was mentioned
most recently.

Reference:

- `docs/INFORMATION_SOURCE_TAXONOMY.md`

### Files

Created:

- `src/source-registry.ts`
- `tests/source-registry.test.ts`

Modified:

- `src/schemas.ts`
- `src/artifact-writer.ts`
- `src/evidence-runner.ts`
- `src/index.ts`
- `src/cli.ts`
- `README.md`
- `package.json`
- `tests/evidence-runner.test.ts`

### Types

Add evidence kind:

```ts
"source_registry"
```

Add product coverage types:

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
```

`SourceRegistryEntry` should include:

- `platform`
- `displayName`
- `informationCategories`
- `sourceFamilies`
- `localeSegments`
- `supportTier`
- `requiredCapabilities`
- `unsupportedActions`
- optional `topSlot` with rank, metric, source URL, and observed date

### Registry Helpers

Implement deterministic helpers:

```ts
listSourceRegistryEntries(filter)
selectSourceRegistryEntriesForUrl(url)
selectSourceRegistryEntriesForIntent({ category, locale })
assertRegistryCoverage(registry)
summarizeSourceRegistryMatch(match)
```

These functions must not browse the web or refresh ranking data. Evidence-run
should be deterministic and should only report the registry metadata that ships
with the package.

### Evidence-Run Integration

In `runEvidenceWorkflow`:

1. Build source strategy as today.
2. Select registry entries from URL and optional future intent metadata.
3. Write a `source_registry` artifact after `source_strategy`.
4. Build the navigation plan as today.
5. Include registry summary in `EvidenceWorkflowAssessment`.
6. Include registry support tier, category, locale, and top-slot line in the
   final report.

Expected report lines:

```text
- Source registry: search/ko-KR, Naver Search, tier 3 planned-navigation
- Source strategy: naver_search / search
- Source navigation plan: plan_only, 6 actions, 2 extraction targets, 0 unsupported actions
```

### CLI Inspection

Add a read-only command:

```powershell
node .\dist\cli.js source-registry --category search --locale ko-KR
node .\dist\cli.js source-registry --platform naver_search
```

The command should print:

- platform
- display name
- categories
- source families
- locale segments
- support tier
- top-slot rank basis when present
- unsupported actions

### Tests

`tests/source-registry.test.ts`:

- mandatory category/locale slots have at least three entries or an explicit
  exception
- each entry maps to at least one source family
- each entry has support tier and unsupported-action rationale
- top slots have metric, source URL, and observed date
- AI search and AI-agent entries are marked as derivative evidence
- messenger/private entries are explicit user-visible capture only

`tests/evidence-runner.test.ts`:

- evidence-run writes a `source_registry` artifact
- assessment includes the registry summary
- final report includes registry category/locale/support tier

### Done Criteria

- [x] `src/source-registry.ts` is exported from `src/index.ts`
- [x] `source_registry` artifacts appear in the ledger
- [x] top-three coverage tests protect the initial mandatory slots
- [x] `source-registry` CLI inspection works after build
- [x] docs/package metadata include
  `docs/INFORMATION_SOURCE_TAXONOMY.md`
- [x] `npm run verify` passes after the current documentation update

## Phase 2.6: Destination Triage

Status: second foundation implemented locally. Explicit follow-up requests and
explicit `extract_destinations` actions now produce `destination_candidate` and
`destination_triage` artifacts and are scored before bounded child evidence
runs. Useful multi-source research still needs maintained, calibrated provider
selectors and richer child-page usefulness analysis before broader
multi-destination execution.

Current answer for Google/Naver-style research: partially yes. A maintained
explicit recipe can follow selected destinations and judge child pages, but the
default evidence-run still does not automatically roam through arbitrary search
results, decide every useful destination, and continue recursively. That is the
next bounded implementation track, not an already solved behavior.

### Goal

When a search engine, portal, map surface, community page, review list, or
commerce page exposes many possible destinations, the farm should decide which
ones are worth child evidence runs and preserve why.

This is bounded evidence selection, not crawling.

### New Evidence Kinds

Added:

```ts
"destination_candidate"
"destination_triage"
```

### Candidate Extraction

Implemented foundation:

- explicit `follow_up` requests become destination candidates
- explicit `extract_destinations` actions read multiple visible HTTP(S) links
  from a result/module selector without clicking the parent page
- candidates record parent URL, action key, resolved URL, domain, visible link
  text, selector, source artifact IDs, candidate kind, score, signals, and
  warnings
- candidates also record `visibleMetadata` from the destination URL and visible
  link text: text snippet, year hints, recent/stale-year flags, price/offer,
  rating/review, local/place, and publisher/article hints
- candidate kind and visible metadata detection use English, Korean, and
  Japanese visible link-text triggers, so generic result URLs can still become
  auditable news, blog, official, review, map/place, commerce, or media
  candidates when the browser-visible title/snippet contains those signals
- query overlap uses deterministic cross-script aliases for common local,
  travel, price, review, booking, media, and official terms. This lets
  transliterated queries such as `seongsu cafe` or `tokyo hotel price` match
  browser-visible Korean/Japanese destination text before the child evidence is
  downgraded as off-topic.
- triage summaries and final reports aggregate visible metadata counts for
  snippets, recent/stale years, price/offer, rating/review, local/place, and
  publisher/article hints
- triage summaries and final reports aggregate candidate-kind counts for all,
  selected, useful, and rejected destinations, so QA can compare whether a run
  leaned toward news, blog, official, map/place, review, community, commerce,
  media, or generic sources
- destination scoring infers query intent and records intent-fit signals. Fresh
  news queries should prefer news candidates, experience/review queries should
  prefer blog/review/community candidates, local queries should prefer
  map/place or review candidates, commerce queries should prefer commerce or
  review candidates, media queries should prefer media candidates, and
  official-fact queries should prefer official candidates. The first pass
  supports English, Korean, and Japanese trigger terms such as news/뉴스/ニュース,
  review/후기/レビュー, official/공식/公式, map/지도/地図, price/가격/価格, and
  video/동영상/動画.
- Naver Search manual-only recipe candidates now cover broader calibration
  surfaces for news, image, video, place/map, shopping, and view vertical tabs,
  plus result and destination selectors for Naver News, Blog, Cafe, Place/Map,
  Shopping, SmartStore, and video modules. These remain calibration candidates,
  not default autonomous traversal.
- Daum Search manual-only recipe candidates now cover broader calibration
  surfaces for news, blog, cafe, image, video, place/map, and shopping vertical
  tabs, plus result and destination selectors for Daum News, Daum Blog,
  Tistory, Daum Cafe, KakaoMap, Kakao Shopping, and video modules.
- obvious low-value, duplicate, login/private, and unsupported destinations are
  rejected before child runs
- selected candidates are capped by `sourceNavigation.maxFollowUps` and
  `sourceNavigation.maxFollowUpsPerDomain`
- selected one-depth child runs default to sequential execution, but
  `sourceNavigation.followUpConcurrency` can execute them in bounded concurrent
  batches while preserving deterministic parent follow-up artifacts
- selected child runs feed artifact count, claim count, browser capture count,
  obstruction count, page text length, title/final URL, query-overlap tokens,
  query/evidence script-family diagnostics, and evidence warnings back into
  final triage
- final triage can downgrade a selected child destination to low-value,
  off-topic, or blocked after browser-visible child evidence review
- `destination_candidate` and `destination_triage` records now preserve
  `reasonCodes.positive` and `reasonCodes.negative` arrays. The first pass
  records deterministic reasons including `query_overlap`,
  `official_domain_match`, `fresh_publisher_article`, `local_place_match`,
  `price_or_offer_visible`, `transcript_or_ocr_hit`, `duplicate`,
  `portal_shell`, `thin_content`, `blocked_surface`,
  `private_or_login_surface`, `paywalled_surface`,
  `unsupported_destination`, `domain_budget`, `top_k_budget`, `off_topic`,
  `query_script_mismatch_possible`, and `stale_or_mismatched_source`.
- `DestinationTriageSummary` and the final report aggregate positive and
  negative reason-code counts. This gives calibration runs a compact way to
  compare whether candidate selection is being driven by useful reasons
  (`query_overlap`, `official_domain_match`, `local_place_match`) or by
  rejection pressure (`portal_shell`, `thin_content`, `blocked_surface`,
  `top_k_budget`).
- `DestinationTriageSummary` and the final report also expose fallback
  diagnostics. If a selected child page is downgraded but budget-limited
  candidates remain unattempted, `unattemptedFallbackCount` and
  `retryRecommended` tell QA that the run needs a wider follow-up budget or
  tighter provider selector calibration before concluding that no useful child
  source exists. The summary also includes `fallbackCandidates` with candidate
  ID, action key, URL, domain, candidate kind, and score so the next retry can
  target the exact lower-ranked sources left out by the previous top-K or
  per-domain budget run. Each fallback candidate records whether it was skipped
  by `top_k_budget` or `domain_budget`. `retryAdvice` then recommends the next
  `maxFollowUps` and `maxFollowUpsPerDomain` values and records whether the
  next pass should increase total follow-ups, increase per-domain follow-ups,
  or narrow destination selectors. It also carries copyable `cliFlags`, so a
  report line can be pasted into the next `evidence-run` command when a Google,
  Naver, portal/news, map, blog, commerce, or media deepening pass needs one
  more bounded attempt.

Still needed: maintained provider selectors and richer extraction signals for
browser-visible regions:

- search result heading links and result cards
- news/blog headline modules
- Naver/Daum/Google portal destination links
- map place website/menu/review links when visible
- community thread/article links
- review and commerce result cards
- official-site candidates from visible domain/title/snippet signals

Destination extraction should be provider-calibrated for these common paths:

- Google/Naver/Daum search result -> official page
- Google/Naver/Daum search result -> news article
- Google/Naver search result -> blog/Cafe/community post
- map/local result -> place panel, visible website/menu/review link
- travel/commerce result -> offer/product/detail page
- video/social result -> public post/video/profile surface

Candidate records should include:

- parent artifact id and parent URL
- candidate URL, visible text, rank, source family, platform, and domain
- candidate kind: news, blog, official, map place, review, community, commerce,
  media, or generic
- visible freshness, publisher/article, rating/review, price/offer, local/place,
  or other metadata snippets when available
- obstruction risk and unsupported-action warnings

### Triage Scoring

Current scoring uses deterministic URL/link-text signals:

- candidate kind
- rank/order
- query overlap from common search query parameters
- visible link text
- selector-resolved status
- external destination status
- low-value/login/private warnings

Next, score candidates with richer browser-visible signals:

- query/snippet/title relevance
- rank and module position
- first-party or official-domain hints
- publisher/source authority hints visible on the page
- freshness and timestamp evidence
- duplicate URL/domain canonicalization
- source-category fit from the registry
- obstruction/paywall/private/login-wall risk
- evidence density after child capture: text length, structured data, media,
  screenshots, OCR/transcript availability, and claim-relevant terms

The first useful-child reason-code implementation is now deterministic:

- candidate records and final triage preserve positive and negative reason code
  arrays, not only the numeric score
- child evidence can add post-follow reasons such as `transcript_or_ocr_hit`,
  `thin_content`, `blocked_surface`, `off_topic`, and
  `query_script_mismatch_possible`
- keep any LLM or semantic reviewer as a later optional second pass that can
  never overwrite the browser-visible artifact record

Implemented scoring now records:

- score breakdowns for scoring profile, base, rank, candidate kind, query
  overlap, authority, freshness, source-family fit, profile adjustment,
  external destination, warnings, and total
- authority signals for official, institutional, publisher, and local/place
  hints visible in URL or link text
- freshness signals from visible year hints, including stale-year penalties
- visible metadata profiling for URL/link-text snippets, year hints,
  price/offer-like text, rating/review-like text, local/place-like text, and
  publisher/article-like text
- query-intent score contribution and `query_intent_match` reason codes for
  cases where the same result set should choose a different child source type
  depending on the user's question
- source-family fit/mismatch signals for search, map, blog, portal, travel,
  commerce, video/social, and generic web follow-ups
- context-specific scoring profiles for `search_general`, `map_local`,
  `blog_content`, `portal_news`, `travel_booking`, `commerce`,
  `video_social`, and `generic_web`. These profiles change rank/query/
  authority/freshness/source-family-fit multipliers and candidate-kind
  adjustments so map runs prefer place/review evidence, travel and commerce
  runs prefer offer/product/review evidence, and general search remains
  conservative.

LLM interpretation can be a later optional reviewer, but the stored triage
artifact should be deterministic enough for tests and audits.

### Execution Policy

- default depth: 1
- default top-K: small and explicit
- per-domain cap: avoid one domain monopolizing the run
- per-child timeout: lower than the parent run
- stop on login, CAPTCHA, payment, private, age-gate, or region-gate surfaces
- preserve blocked/low-value child pages as evidence when encountered
- downgrade selected child pages when the child run has no visible text, no
  claims, browser obstruction artifacts, or no query-overlap tokens
- tune final destination provenance requirements as new maintained provider
  evidence kinds are added

### Tests

Implemented tests:

- a low-value first explicit destination loses to a useful query-matching
  second destination
- duplicate destinations are collapsed
- child errors are reflected in destination usefulness
- evidence-run writes destination candidate/triage artifacts and report lines
  for explicit follow-ups
- executor and workflow fixtures verify multi-link `extract_destinations`,
  low-value rejection, duplicate collapse, bounded top-K selection, and a child
  run for the selected useful destination
- recipe catalog and promotion fixtures verify that repeated calibration can
  export maintained explicit `extract_destinations` actions for
  `destination-followup`
- destination triage unit coverage verifies positive and negative reason codes
  for query overlap, official/local/price evidence, OCR/transcript evidence,
  portal-shell rejection, duplicate rejection, domain budget rejection,
  off-topic child evidence, and blocked child evidence
- destination triage unit coverage verifies fallback diagnostics when the
  selected child page is downgraded while another candidate remains unattempted
  behind the top-K budget
- workflow coverage verifies that written destination triage text artifacts
  include `reasonCodes`, summary reason-code counts, fallback diagnostics, and
  final-report reason/retry lines

Add fixtures where:

- the first visible result is off-topic and the second is useful
- a news module links to both a publisher article and a low-value portal shell
- an official site candidate outranks a generic aggregator for factual claims
- a search result set contains a news article, a blog post, and an official
  site, and the preferred child page changes with the user question
- a parent portal snippet looks relevant but the child page is thin or off-topic
  after capture
- a map/local run prefers visible place evidence over a generic official page
- a travel/booking run prefers fresh offer evidence over stale source-family
  mismatched news evidence
- duplicate URLs are collapsed
- blocked/paywalled/private destinations are classified without bypass
- final claim-gate output rejects destination claims that cite only the portal
  snippet or final summary without the required parent/child provenance chain

### Natural Deepening Implementation Checklist

For Google, Naver, and other portal entry points, a provider recipe is not
natural-deepening ready until all of these are true:

- parent capture has a scoped result/module artifact that shows what the portal
  exposed
- `extract_destinations` uses narrow calibrated selectors for result cards,
  headlines, official links, place cards, product cards, media cards, or thread
  cards; broad page-shell selectors remain calibration evidence only
- each destination candidate records visible text, href, rank/order, candidate
  kind, source family, URL warnings, score breakdown, and positive/negative
  reason codes
- pre-follow triage rejects obvious self links, duplicate links, login/private
  surfaces, unsupported actions, stale source-family mismatches, and
  budget-limited candidates with preserved reasons
- selected candidates run as child evidence workflows under `runDir/followups`
  with source navigation disabled by default
- `sourceNavigation.followUpConcurrency` controls how many selected one-depth
  child workflows can run at once; keep it at `1` for login/profile-heavy or
  fragile sites and raise it only for reviewed read-only targets
- promotion-review QA handoffs can carry the same follow-up budget and
  concurrency flags into generated `evidence-run` commands; use this when a
  promoted action file is intentionally being tested with more than one child
  destination
- `sourceNavigation.fallbackFollowUps` is an explicit opt-in fallback pass, not
  default crawling. Use it when a selected child page is downgraded and triage
  has preserved lower-ranked fallback candidates worth testing under
  `sourceNavigation.maxFallbackFollowUps`
- child summaries preserve artifact count, claim count, browser captures,
  obstruction count, page text length, title/final URL, matched query tokens,
  query/evidence script families, and usefulness warnings
- post-follow verdicts can distinguish useful, low-value, off-topic, blocked,
  paywalled, private, unsupported, and fallback-retry-needed outcomes
- useful child pages may emit `destination_deepening_proposal` artifacts, but
  depth-2 execution stays explicit through `sourceNavigation.maxDepth: 2`
- `sourceNavigation.deepeningConcurrency` controls how many selected depth-2
  child workflows can run at once; keep it at `1` for fragile sites and raise
  it only for reviewed read-only targets
- promotion-review QA handoffs can also carry the explicit depth-2 budget and
  concurrency flags, so `maxDepth: 2` tests are reproducible from calibration
  loop output instead of being local shell history only
- final destination claims cite the parent source-navigation action,
  destination candidate, child follow-up, and deeper proposal/run artifacts
  required by the claim's evidence kind

QA should include at least one case where the top-ranked child page is useless
but a lower-ranked official, news, blog/community, review, map/place, product,
or media destination is useful. That case proves the system can tell "opened a
link" apart from "found evidence worth citing."

## Phase 3: Recipes

Recipes are default action sequences, not hardcoded crawlers.

Status: manual-only candidate planning, read-only selector calibration, and the
first explicit-opt-in catalog proposal layer are implemented locally. These
candidates are calibration aids; evidence-run records the plan, but live-site
actions still require explicit `sourceNavigation.actions` input.

Implemented files:

- `src/source-navigation-recipes.ts`
- `src/source-navigation-calibration.ts`
- `src/source-navigation-recipe-catalog.ts`
- `tests/source-navigation-recipes.test.ts`
- `tests/source-navigation-calibration.test.ts`
- `tests/source-navigation-recipe-catalog.test.ts`

Evidence kind added:

```ts
"source_navigation_recipe_plan"
"source_navigation_calibration"
```

Initial recipe candidates:

- Naver search vertical switch: web/blog/cafe/image/map
- Naver map place panel capture
- Google search result filter and destination follow-up
- Google Maps selected place capture
- Naver/Daum News portal module capture
- YouTube metadata/frame/OCR evidence
- TikTok/Instagram obstruction-aware visible post capture
- provider-specific Booking.com, Agoda, Trip.com, and Expedia travel booking
  query/filter/sort/list/pagination/offer/price candidate scopes
- travel/commerce list-detail price card capture

CLI inspection:

```powershell
node .\dist\cli.js source-navigation-recipes --url https://www.google.com/search?q=tokyo+hotel
node .\dist\cli.js source-navigation-calibration-targets --category search --locale ko-KR --include-search-variants --format lines
node .\dist\cli.js source-navigation-calibrate --url https://example.com/ --timeout-ms 10000 --selector-timeout-ms 1000
node .\dist\cli.js source-navigation-calibrate-batch --urls-file .\calibration-targets.txt --run-root .\evidence-calibration --repeat 2
node .\dist\cli.js source-navigation-catalog --url https://www.google.com/search?q=tokyo+hotel
node .\dist\cli.js source-navigation-catalog --url https://www.google.com/search?q=tokyo+hotel --calibration-run-dir <run-dir>
```

Current recipe-plan rules:

- execution policy is always `manual_opt_in_only`
- local-fixture-backed selectors are marked `fixture_verified`
- real-site selectors are marked `candidate_unverified`
- candidates are not executed unless copied into explicit recipe input
- warnings state that selectors must be manually calibrated before broad live use

Current calibration rules:

- `source-navigation-calibration-targets` generates reviewed calibration target
  files from the source registry and orders category/locale matches by local
  top-slot rank
- `--include-search-variants` expands supported search targets into reviewed
  vertical calibration seeds. Current seeds cover Google, Naver, Daum/Kakao,
  Bing, Yahoo Search, and Yahoo Japan Search variants such as News, Images,
  Videos, local/place, shopping, blog/cafe, and Q&A where the provider exposes a
  stable search URL. Treat these as separate provider-module calibration
  surfaces; do not infer that broad search readiness makes every vertical
  maintained-ready.
- Yahoo Search vertical seeds use `images.search.yahoo.com`,
  `news.search.yahoo.com`, and `video.search.yahoo.com`. Provider vertical
  search URLs are allowed as result-state/capture scopes, but destination
  triage classifies them as low-value navigation surfaces so they cannot become
  maintained destination follow-up selectors by themselves.
- Yahoo Japan vertical seeds follow that same rule for
  `news.yahoo.co.jp/search`, `map.yahoo.co.jp/search`,
  `shopping.yahoo.co.jp/search`, and `chiebukuro.yahoo.co.jp/search`. The
  catalog blocks broad page-shell extraction containers such as `#contents`;
  repeated calibration must promote a narrower result-card/module selector
  such as `.sw-Card` before explicit evidence-run execution.
- Bing live calibration may need a longer post-load wait than the default when
  result cards render after a provider shell. If Bing shows solve-the-task
  challenge copy, the run should be treated as bot-block evidence and retried
  with profile/headed review rather than promoted. Broad `#b_results` selectors
  can remain capture scopes, but maintained `extract_destinations` should use a
  narrower result-card selector such as `#b_results .b_algo`.
- Destination triage resolves search-engine redirect wrappers before scoring,
  de-duplication, per-domain budgeting, and selected child runs. This currently
  covers Bing `ck/a?u=...`, Google `/url?q=...` and `/aclk?adurl=...`, Naver
  desktop/mobile redirect params, and Yahoo/Yahoo Japan `/RU=...` paths; the
  browser-visible raw href is still preserved in the source-navigation
  extraction action metadata.
- Calibration target plans annotate each target with detected platform/source
  family before the browser run. Use the `targetDetectionSummary` and Markdown
  target lines to spot variants that will promote under another group, such as
  `naver_search-news` being detected as `naver_news` / `portal`.
- travel booking target generation includes a future one-night stay window,
  adults, rooms, and currency parameters where supported so Booking.com, Agoda,
  Trip.com, and Expedia calibration starts from hotel-search state rather than
  only a generic home/search shell
- target generation can output JSON for review or `id url` lines for direct
  `source-navigation-calibrate-batch --urls-file` input
- private messenger/user-controlled entries and derivative AI answer entries
  are skipped from unattended batch targets
- opens the page read-only
- captures the page state before writing calibration output
- probes selector and capture-scope candidates for match count and visible count
- records expected text signal hits and blocked text signal hits
- writes `source_navigation_calibration` artifacts
- does not click, fill, scroll, paginate, follow links, log in, dismiss gates,
  or mutate account/platform state
- can run as a standalone CLI command or inside evidence-run through
  `sourceNavigation.calibrate` / `--source-navigation-calibrate`
- `source-navigation-calibrate-batch` runs the same read-only calibration over
  multiple URLs from a line-based or JSON target file
- batch mode writes one run directory per attempt, records failures instead of
  losing the batch, and writes `calibration-batch-manifest.json` with
  catalog/export command hints grouped by platform and source family
- batch manifests record headless/headed mode and storage-state or
  persistent-profile runtime for auditable blocked-platform retries
- `--calibration-concurrency <1-5>` runs reviewed read-only batch attempts in
  bounded concurrent batches. The default is `1`; persistent-profile
  calibration is forced to concurrency `1` because the same browser user-data
  directory must not be opened by parallel attempts.

Current catalog proposal rules:

- catalog entries are proposal metadata, not default automation
- no calibration means `calibration_required`
- read-only capture/follow-up/extract-destinations/wait/scroll actions may
  become `single_run_ready` after a matching calibration report
- read-only capture/follow-up/extract-destinations/wait actions may become
  `maintained_recipe_ready` only after the same selector or capture scope
  appears across the minimum repeated calibration runs and local fixture
  coverage exists
- broad destination fallback selectors such as `#root a[href^="http"]`,
  `body a[href]`, `main a[href]`, `article a[href]`, `#search a[href]`,
  `#main_pack a[href]`, and `[role="main"] a[href^="http"]` are not promotable
  for `extract_destinations`. They often capture navigation, ads, or portal
  shell links rather than useful child evidence candidates.
- click actions remain `manual_review_required`
- fill/select/press actions remain `manual_value_required`
- blocked signals produce `blocked_signal_detected`
- `maintainedDefaultReadyCount` counts repeated-calibrated maintained recipe
  candidates, but those still require explicit opt-in execution
- `source-navigation-export-recipes` exports only `maintained_recipe_ready`
  read-only actions as explicit recipe JSON; all other entries are omitted with
  readiness and reason diagnostics
- `source-navigation-export-recipes --actions-output-file <path>` writes the
  exact JSON array accepted by `evidence-run --source-navigation-actions-file`
- `--export-output-file <path>` writes the full export bundle for audit, and
  `--fail-empty-export` exits non-zero when no maintained actions are ready
- `source-navigation-promote-batch --calibration-batch-manifest <path>` writes
  grouped `catalog.json`, `export.json`, and `actions.json` files for every
  platform/source-family group in a batch manifest, plus
  `promotion-summary.json`
- `source-navigation-promotion-review --promotion-summary <path>` or
  `--promotion-dir <path>` classifies promoted groups as ready, blocked,
  needing repeated calibration, manual-review-required, or empty, and returns
  exact evidence-run argv/PowerShell commands for ready `actions.json` files;
  ready commands carry forward `--headed`, `--profile`, and
  `--persistent-profile` flags from the calibration runtime when present
- promotion groups also include `destinationExtraction` metadata:
  candidate count, ready `extract_destinations` action count, ready action
  keys, maintained/single-run/calibration-required counts, and blocked/manual
  counts. They also include destination-discovery run counts, promotable and
  non-promotable candidate totals, and warning counts when calibration recorded
  global discovery. This keeps parent-page capture readiness separate from
  child-link extraction readiness and selector-discovery handoffs.
- promotion group `files` include `selectorHints` when generated, pointing to
  the group's `selector-hints.tsv` handoff file.
- `source-coverage-readiness --category <name> --locale <segment>` connects
  registry top slots with promotion summaries and classifies category/locale
  coverage as ready, blocked, needing repeated calibration, manual-review-
  required, promoted-empty, not-promoted, derivative-skip, private-skip, or
  planning-only
- readiness items include `destinationExtraction.status`, so QA can flag a
  source as capture-ready but not yet ready for natural search deepening when
  destination selectors still need repeated calibration
- `source-coverage-readiness --format targets` emits calibration target lines
  for actionable not-ready slots, so the next batch can be generated from the
  readiness audit rather than manually selected
- `source-coverage-readiness --format retry-commands` emits exact
  `auth-login` profile setup commands followed by profile/headed
  `source-coverage-calibrate` commands for blocked slots, using a platform-
  named persistent profile so login walls, human/bot checks, access denied
  pages, and other browser-visible gates can be retried without losing the
  category/locale QA loop. When matching promotion groups have
  `selector-hints.tsv` files, those paths are preserved as
  `--selector-hints-file` retry inputs.
- `source-coverage-readiness --format retry-plan` emits the same blocked-slot
  retry work as an ordered Markdown QA handoff, sorted by top-slot rank and
  support tier, with selector hints, setup commands, retry commands, blocked
  signal counts, readiness reasons, next actions, and a preflight check summary.
- `source-coverage-calibrate --category <name> --locale <segment>` turns the
  readiness audit into a loop: write readiness/target/plan files, optionally
  run read-only batch calibration, promote the batch, write promotion review,
  re-audit coverage readiness after promotion, and write a Markdown report
- the Markdown report includes destination-extraction ready/not-ready counts,
  status counts, per-source destination-extraction status, and promotion-level
  ready `extract_destinations` action totals so QA can see whether the next
  bottleneck is parent capture, child-link extraction, or browser obstruction.
  It also carries matched blocked-signal counts into each affected readiness
  line, so DataDome/captcha, Cloudflare, login-wall, or similar retry pressure
  is visible in the loop report itself. A `Profile/Headed Retries` section then
  prints the generated setup and retry commands for blocked slots. The same
  retry handoff is also written as `profile-headed-retry-plan.md` and
  machine-readable `profile-headed-retry-plan.json`.
- `source-coverage-retry-plan --retry-plan <profile-headed-retry-plan.json>`
  reads that JSON handoff without opening a browser and can print validated
  JSON, Markdown, all commands, setup-only commands, or retry-only commands.
  It supports `--platform`, `--priority`, and `--limit` filters so broad
  blocked-platform handoffs can be narrowed before a profile/headed retry.
  `--output-file` writes the rendered filtered handoff to disk instead of
  stdout. `--only-check-ok` drops retry items with check errors before
  rendering output, which lets QA print only prepared retry commands after
  `--check-files` or `--check-profiles`. `--format check --fail-check`
  validates the generated retry commands contain the expected headed/profile/
  browser-channel/persistent-profile flags and selector-hint handoffs before
  QA launches the retry. Add `--check-files`
  when the check should also fail if a referenced `selector-hints.tsv` handoff
  file no longer exists, and `--check-profiles` when it should also fail if
  the referenced saved browser profile has not been prepared locally. Coverage
  calibration output bundles write the same command-shape check result to
  `profile-headed-retry-plan-check.json`, include the preflight summary in
  `profile-headed-retry-plan.md`, and show ok/error/warning counts in the
  report summary. Passing `--check-files` or `--check-profiles` to
  `source-coverage-calibrate` carries those disk-state checks into the
  generated check JSON, retry-plan Markdown, and report. The report also includes a
  `Profile/Headed Retry Check` section with issue-code lines.
- `source-coverage-calibrate --plan-only` or `--dry-run` stops after writing
  the planning files and does not open browsers
- `source-navigation-catalog` and `source-navigation-export-recipes` accept
  raw report files through `--calibration-file` / `--calibration-files` and
  evidence run directories through `--calibration-run-dir` /
  `--calibration-run-dirs`
- catalog/export also accept `--calibration-batch-manifest` and
  `--calibration-batch-manifests` to load succeeded run directories from
  `source-navigation-calibrate-batch` manifests while preserving failed
  attempts as warnings
- run-directory loading reads `artifacts.jsonl` first for
  `source_navigation_calibration` records and falls back to matching
  `raw/*source-navigation-calibration*.txt` or structured metadata files
- calibration reports are used only when their `platform` and `sourceFamily`
  match the current recipe plan; incompatible reports are skipped with warnings
  and cannot promote selectors across Naver, Google, travel, SNS, or generic
  sources

## Verification Baseline

Current baseline after Phase 3 manual-only recipe candidate planning, read-only
calibration, and the first Korean news/search/maps/content-media real-site
calibration passes:

- `npm test`: 31 files, 189 tests passed
- `npm run verify`: passed
- `npm run test:ocr-integration`: skipped unless opt-in env and peer dependency
- `npm run test:official-api`: skipped unless opt-in env and credentials
- `npm pack --dry-run`: passed with package `browser-agent-mcp-farm-0.3.0.tgz`
  and 143 files, including `docs/INFORMATION_SOURCE_TAXONOMY.md`

Focused Phase 2.5 checks:

- `npm run verify`: passed after the Naver Place executable-entry fallback and
  Naver service-limit obstruction pass with build, 33 test files / 330 tests,
  local smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.
- `npm run verify`: passed after the Naver Map client-state recipe promotion
  pass with build, 33 test files / 332 tests, local smoke, public web smoke,
  media smoke, proxy smoke, and 0 npm audit vulnerabilities.
- `npm test -- --run tests/source-coverage-readiness.test.ts`: 1 file /
  10 tests passed after source-coverage readiness started counting
  `extract_client_state_destinations` as a destination-extraction candidate.
  `npm run build` passed, and CLI smoke confirmed Naver Map reports
  `destinationExtraction.candidateCount: 2` for `map_local` / `ko-KR`. Final
  `npm run verify` passed with build, 33 test files / 332 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.
- `npm test -- --run tests/source-navigation-calibration.test.ts
  tests/source-navigation-recipe-catalog.test.ts
  tests/source-navigation-executor.test.ts`: 3 files / 81 tests passed after
  adding read-only client-state probe diagnostics and sharing the Naver Place
  Apollo parser between calibration and executor.
- `npm test -- --run tests/source-navigation-promotion.test.ts
  tests/source-coverage-readiness.test.ts`: 2 files / 17 tests passed after
  requiring successful client-state probes before maintained client-state
  recipe promotion. Final `npm run verify` passed with build, 33 test files /
  334 tests, local smoke, public web smoke, media smoke, proxy smoke, and
  0 npm audit vulnerabilities.
- Live Naver Map `source-coverage-calibrate --platform naver_map --query
  "성수 카페" --repeat 2 --wait-ms 5000 --timeout-ms 60000
  --selector-timeout-ms 5000` passed after client-state probe aggregation.
  Promotion exported `map-viewport`, `map-ocr`, and
  `extract_client_state_destinations` follow-up actions, and readiness
  recorded 2 successful client-state probe runs with 178 unique parsed
  destination candidates.
- The promoted action file passed `evidence-run` final claim-gate. Parent
  extraction produced 10 Naver Place candidates and attempted 1 bounded child
  follow-up; the child was correctly downgraded as blocked by Naver
  service-limit obstruction, so useful-child evidence remains the next Naver
  Place task. Final `npm run verify` passed with build, 33 test files /
  334 tests, local smoke, public web smoke, media smoke, proxy smoke, and
  0 npm audit vulnerabilities.
- Blocked Naver Place children can now preserve recovery candidates without
  executing them. If an obstructed child exposes a deeper visible URL such as
  `pcmap.place.naver.com/.../home`, destination triage records it under
  `blockedChildRecoveryCandidates` and the final report prints a recovery line.
  This is a QA handoff, not a gate-bypass or default depth-2 run. Final
  `npm run verify` passed with build, 33 test files / 335 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.
- Blocked-child recovery handoffs now also include structured
  `blockedChildRecoveryAdvice` with profile/headed command hints, sampled
  recovery URLs, and policy reasons. Workflow fixture coverage proves the
  blocked child can recommend a reviewed profile/headed retry while still
  emitting no default depth-2 proposals. The advice now records a deterministic
  recovery profile name, `persistent-profile` storage, `chrome` browser
  channel, setup URL, recovery URL, and full PowerShell commands for both
  `auth-login` and headed `evidence-run`. It also includes ordered
  machine-readable `profile_setup` and `recovery_evidence_run` steps with
  `argv`, `powershellCommand`, and purpose text, and derives `commandHints`
  from those steps. `npm run build` passed, and
  `npm test -- --run tests/destination-triage.test.ts
  tests/evidence-runner.test.ts` passed with 2 files / 48 tests. Final
  `npm run verify` passed with build, 33 test files / 336 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.
- `destination-recovery-plan --run-dir <evidence-run-dir>` now extracts those
  blocked-child recovery advice steps from completed `destination_triage`
  artifacts and prints JSON, Markdown, all commands, setup-only commands, or
  retry-only commands. It reads `artifacts.jsonl` first and falls back to
  raw/structured artifact discovery, so QA can recover the profile/headed
  command handoff from an evidence bundle without opening raw triage JSON.
  `--format check` validates command shape, `--check-profiles` verifies saved
  browser profile readiness, `--fail-check` can fail on preflight errors, and
  `--only-check-ok` filters command output to passing recovery items.
  `--format markdown` now includes the same preflight result, including
  saved-profile readiness when `--check-profiles` is supplied, so the human QA
  handoff can show setup/retry commands and readiness failures together.
  `npm run build` passed, and
  `npm test -- --run tests/destination-recovery-plan.test.ts
  tests/destination-triage.test.ts tests/evidence-runner.test.ts` passed with
  3 files / 53 tests. CLI smoke confirmed the JSON, check, and retry-command
  read-only empty-plan paths without opening a browser. Final
  `npm run verify` passed with build, 34 test files / 341 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.
- `npm test -- source-navigation-recipes source-navigation-recipe-catalog source-navigation-promotion`:
  3 files / 43 tests passed after adding the client-state destination
  follow-up recipe alternative, operation-aware catalog grouping, and promotion
  export coverage.
- `npm test -- browser-obstructions evidence-runner destination-triage source-navigation-executor`:
  4 files / 97 tests passed after adding `map.naver.com/p/entry/place/<id>`
  child execution, canonical Place `originalUrl` provenance, and Naver
  service-limit `bot_block` classification.
- `npm run build`: passed
- `npm test -- tests/source-registry.test.ts`: 7 tests passed
- `npm test -- tests/evidence-runner.test.ts`: 8 tests passed
- `node .\dist\cli.js source-registry --category search --locale ko-KR`:
  returned Naver, Google, Daum/Kakao, and Bing registry entries with support
  tiers and planning-seed top slots
- `npm test -- tests/source-navigation-executor.test.ts`: 21 tests passed,
  including Google-like SERP filter/result-card/gallery/follow-up coverage,
  Google map/news/ad module scopes, Google Maps selected-place sheets/reviews/
  photos/map-label scopes, Naver/Daum news module and publisher follow-up
  scopes, Naver Cafe public/member-wall states, DCInside and Naver Knowledge
  iN community portal modules/follow-ups/obstruction states, Reddit/Quora/
  Stack Overflow global community portal modules/follow-ups/obstruction states,
  KakaoMap panel scopes, richer travel room/rate-card variants, and commerce
  marketplace product-card/seller/shipping/price-badge scopes,
  long-scoped-capture filename collision coverage, and
  non-login-visible video/social metadata, X/Twitter thread context, frame, and
  overlay scopes
- `npm test -- tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`:
  32 tests passed after adding fixture-backed community/forum destination
  scopes for DCInside, Naver Knowledge iN, Reddit, Quora, and Stack Overflow
  question bodies, thread bodies, answer bodies, accepted/top-answer markers,
  comment lists, metadata, and destination obstruction state.
- `npm test -- tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`:
  32 tests passed after separating video/social public post scopes for profile
  cards, caption/body text, engagement state, public comment/reply previews,
  X/Twitter thread context, frame regions, overlay text, and obstruction state.
- `npx vitest run tests/source-navigation.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`:
  45 tests passed after adding conditional map/local destination follow-up
  planning, manual-only Naver Map/KakaoMap/Google Maps
  `extract_destinations` candidates, and Google Maps fixture extraction of a
  visible official-website follow-up.
- `npx vitest run tests/source-navigation.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`:
  45 tests passed after adding conditional commerce destination follow-up
  planning, manual-only Amazon/Coupang/Naver Shopping/Gmarket/11st
  `extract_destinations` candidates, and commerce fixture extraction of visible
  product/review/seller/brand follow-ups.
- `npm test -- tests/frame-sampler.test.ts tests/evidence-runner.test.ts`:
  19 tests passed after adding scene-change sparse sampling diagnostics for
  adjacent pair gaps, near-threshold counts, selected-hit spacing, and final
  report output.
- `npm test -- tests/source-navigation-recipes.test.ts`: 9 tests passed,
  covering Google Search, Naver/Kakao/Google map, Naver/Daum news, travel,
  TikTok/Instagram, X/Twitter public post/thread candidates, YouTube real-site
  metadata/overlay candidates, DCInside, Naver Knowledge iN, Reddit, Quora,
  and Stack Overflow community portal candidates, provider-specific commerce
  scopes for Coupang/Naver Shopping/Gmarket, Naver Blog obstruction-signal
  tightening, fixture versus real-site candidate status, and manual-only
  warnings
- `npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts tests/browser-obstructions.test.ts`:
  24 tests passed after adding provider-specific Booking.com/Agoda/Trip.com/
  Expedia travel booking candidates, global travel blocked-signal calibration,
  and travel security/access obstruction classification
- `npx vitest run tests/browser-obstructions.test.ts tests/source-navigation-calibration.test.ts tests/source-navigation-recipes.test.ts`:
  27 tests passed after adding Expedia "Bot or Not?" human-or-bot challenge
  obstruction and calibration signals
- `npx vitest run tests/browser-obstructions.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts`:
  40 tests passed after adding Cloudflare/security-verification and
  network-security blocked-signal coverage for global community/forum pages.
- `node .\dist\cli.js source-coverage-calibrate --category community_forum --locale global --top-rank 3 --query "tokyo travel" --repeat 2`:
  classified Reddit, Quora, and Stack Overflow as blocked in the unattended
  browser and produced profile/headed retry commands instead of maintained
  action exports.
- `npm test -- tests/browser-obstructions.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts`:
  31 tests passed after refining video/social login-chrome false positives and
  adding TikTok server-error unavailable-media obstruction coverage.
- `npm test -- tests/frame-sampler.test.ts tests/evidence-runner.test.ts`:
  18 tests passed after adding scene-change distribution diagnostics for unique
  fingerprints, zero-distance pairs, and p50/p90/p95 observed distances.
- `node .\dist\cli.js source-coverage-calibrate --category social_feed --locale global --top-rank 3 --query "tokyo travel" --repeat 2`:
  promoted Instagram hashtag search and X/Twitter search read-only actions as
  ready, while classifying TikTok search as blocked by a browser-visible
  server-error/unavailable-media page.
- `node .\dist\cli.js evidence-run --url https://www.instagram.com/explore/tags/tokyotravel/ --source-navigation --source-navigation-actions-file <instagram-actions.json> --no-frames --wait-ms 1000 --timeout-ms 30000`:
  final claim gate OK with 195 artifacts, 4 claims, 4 citations, and 151
  source-navigation action artifacts.
- `node .\dist\cli.js evidence-run --url "https://x.com/search?q=tokyo+travel&src=typed_query" --source-navigation --source-navigation-actions-file <x-actions.json> --no-frames --wait-ms 1000 --timeout-ms 30000`:
  final claim gate OK with 70 artifacts, 4 claims, 4 citations, and 48
  source-navigation action artifacts.
- `node .\dist\cli.js evidence-run --url "https://www.tiktok.com/search?q=tokyo+travel" --no-frames --wait-ms 1000 --timeout-ms 30000`:
  final claim gate OK with 23 artifacts, 5 claims, 5 citations, and 2
  browser-obstruction artifacts for the unavailable-media state.
- `npm test -- tests/browser-obstructions.test.ts`: 7 tests passed, covering
  social login/app interstitial detection, bot-block challenge detection,
  Korean commerce access/bot-check blocks, normal-content clear state, and the
  stray `robot` token false-positive guard
- `node .\dist\cli.js evidence-run --url "https://cafe.naver.com/ca-fe/home/search/articles?q=%EC%84%B1%EC%88%98+%EC%B9%B4%ED%8E%98" --source-navigation --source-navigation-actions-file <naver-cafe-actions.json> --no-frames --wait-ms 3000 --timeout-ms 25000`:
  final claim gate OK with 127 artifacts, 4 claims, 4 citations, and no
  browser obstruction artifacts after narrowing bot-block matching
- `npm test -- tests/source-navigation-calibration.test.ts`: 8 tests passed,
  covering read-only Google-like selector calibration, calibration artifact
  writing, video/social, search, and Korean commerce blocked-signal detection,
  map shell scope calibration, public Naver Blog header false-positive
  prevention, and Naver Cafe membership-wall blocking
- `npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts tests/source-registry.test.ts tests/source-navigation-calibration-targets.test.ts tests/source-strategy.test.ts`:
  31 tests passed after adding Korean content/media registry coverage, current
  Naver Blog target detection, and Blog/Cafe obstruction-signal refinements
- `npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts`:
  21 tests passed after adding real-site map shell candidates for Naver Map,
  KakaoMap, and Google Maps
- `npm test -- tests/source-navigation-recipe-catalog.test.ts`: 6 tests passed,
  covering calibration-required entries, single-run read-only proposals,
  repeated maintained readiness, manual-review/manual-value classifications,
  fixture-scoped selector export prevention, and blocked-signal blocking
- `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-navigation-recipes.test.ts tests/source-coverage-readiness.test.ts`:
  20 tests passed after making real-site promotion ignore fixture-scoped
  selector collisions and making promotion review classify blocked signals
  before ready action files
- `npx vitest run tests/source-navigation-calibration-batch.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-calibration-loop.test.ts`:
  9 tests passed after preserving profile/headed runtime through coverage loop
  plans, calibration batch manifests, promotion groups, and ready evidence-run
  commands
- `npx vitest run tests/source-navigation-calibration-loader.test.ts
  tests/source-navigation-recipe-catalog.test.ts`: 11 tests passed, covering
  direct calibration files, wrapped metadata, run-directory manifest loading,
  fallback discovery, batch-manifest loading, catalog readiness, incompatible
  report filtering, and maintained export
- `npx vitest run tests/source-navigation-calibration-batch.test.ts`: 4 tests
  passed, covering line/JSON target parsing, repeat expansion, manifest counts,
  grouped catalog hints, and non-web URL rejection
- `npx vitest run tests/source-navigation-calibration-targets.test.ts`: 4
  tests passed, covering Korean search top-slot ordering, map/travel platform
  detection, private/derivative skips, and line output
- `npx vitest run tests/source-navigation-promotion.test.ts`: 2 tests passed,
  covering grouped promotion output, evidence-run action file generation, and
  promotion review classification/command generation
- `npx vitest run tests/source-coverage-readiness.test.ts`: 2 tests passed,
  covering Korean search top-slot readiness, calibration target line output,
  derivative AI search skips, and private-network skips
- `npx vitest run tests/source-coverage-calibration-loop.test.ts`: 2 tests
  passed, covering readiness-guided loop plans and derivative category
  no-target behavior
- `npx vitest run tests/source-navigation-calibration.test.ts tests/browser-obstructions.test.ts tests/source-navigation-recipes.test.ts`:
  21 tests passed after adding a calibration-layer Korean commerce blocked-page
  fixture
- `npx vitest run tests/browser-obstructions.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts`:
  33 tests passed after adding Korean marketplace blocked-state classification
  and provider-specific commerce selector candidates
- `npx vitest run tests/source-navigation-calibration-targets.test.ts`: 7
  tests passed after adding future stay-window parameters to travel booking
  calibration targets
- `node .\dist\cli.js source-coverage-calibrate --category marketplace_transaction --locale global --top-rank 4 --query "Tokyo hotel" --run-root <run-root> --repeat 2 --wait-ms 5000 --timeout-ms 30000 --selector-timeout-ms 1500`:
  promoted maintained read-only action files for Amazon, Booking.com, Agoda,
  and Trip.com after adding travel `offer-card` capture promotion plus
  Booking.com/Agoda Tokyo target hints. Booking.com and Agoda export offer-card
  capture actions; Trip.com exports offer-card and price/OCR capture actions
- explicit evidence-runs with the generated Amazon and Trip.com action files
  passed final claim gates
- explicit evidence-runs with the generated Booking.com and Agoda offer-card
  action files passed final claim gates with no browser obstruction artifacts
  after narrowing generic travel obstruction false positives
- `node .\dist\cli.js source-coverage-calibrate --platform expedia --query "Tokyo hotel" --run-root <run-root> --repeat 2 --wait-ms 5000 --timeout-ms 30000 --selector-timeout-ms 1500`:
  succeeded with two read-only attempts, classified all Expedia travel actions
  as blocked by visible human-or-bot challenge signals, and exported zero
  maintained actions
- `node .\dist\cli.js evidence-run --url "https://www.expedia.com/Hotel-Search?destination=Tokyo+hotel&startDate=<date>&endDate=<date>&rooms=1&adults=2" --no-frames --wait-ms 1000 --timeout-ms 20000`:
  passed final claim gate with 24 artifacts, 5 claims, 5 citations, and 2
  browser obstruction artifacts
- `node .\dist\cli.js source-navigation-recipes --url https://www.google.com/search?q=tokyo+hotel`:
  returned manual-only recipe candidates and summary metadata
- `node .\dist\cli.js source-navigation-calibrate --url https://example.com/ --timeout-ms 10000 --selector-timeout-ms 1000`:
  wrote a page capture and `source_navigation_calibration` artifacts
- `node .\dist\cli.js source-navigation-calibrate-batch --urls-file <targets> --run-root <run-root> --repeat 1 --timeout-ms 10000 --selector-timeout-ms 1000`:
  wrote one per-target calibration run and `calibration-batch-manifest.json`
- `node .\dist\cli.js source-navigation-catalog --url https://example.com/ --calibration-batch-manifest <manifest>`:
  loaded one succeeded calibration report from the batch manifest
- `node .\dist\cli.js source-navigation-export-recipes --url https://example.com/ --calibration-batch-manifest <manifest>`:
  loaded one succeeded calibration report from the batch manifest
- `node .\dist\cli.js source-navigation-export-recipes --url https://www.google.com/search?q=tokyo+hotel --actions-output-file <actions> --export-output-file <bundle>`:
  wrote an empty action array plus full export bundle when no maintained
  actions were ready
- `node .\dist\cli.js source-navigation-export-recipes --url https://www.google.com/search?q=tokyo+hotel --fail-empty-export`:
  exited non-zero with `ok: false` when no maintained actions were ready
- `node .\dist\cli.js source-navigation-promote-batch --calibration-batch-manifest <manifest> --output-dir <promotion-dir>`:
  wrote grouped catalog/export/actions files plus `promotion-summary.json`
- `node .\dist\cli.js source-navigation-promotion-review --promotion-summary <promotion-summary> --format commands`:
  prints exact evidence-run commands for ready promoted action files, or a
  no-ready diagnostic when none are available
- `node .\dist\cli.js source-coverage-readiness --category search --locale ko-KR --format targets`:
  prints Naver, Google, and Daum Korean-search top-slot calibration target
  lines when no promotion summary is supplied
- `node .\dist\cli.js source-coverage-readiness --category ai_search --locale global`:
  classifies AI search top slots as derivative evidence and excludes them from
  actionable unattended calibration failures
- `node .\dist\cli.js source-coverage-calibrate --category search --locale ko-KR --run-root <run-root> --plan-only`:
  writes readiness, target, loop-plan, and Markdown report files without
  opening browsers
- `node .\dist\cli.js source-coverage-calibrate --category marketplace_transaction --locale ko-KR --top-rank 3 --query "wireless earbuds" --run-root <run-root> --repeat 2 --wait-ms 5000 --timeout-ms 30000 --selector-timeout-ms 1500`:
  classified Coupang, Naver Shopping, and Gmarket as browser-visible blocked on
  the current network, with zero maintained commerce action files exported
- `node .\dist\cli.js evidence-run --url "https://shopping.naver.com/search/all?query=%EB%AC%B4%EC%84%A0+%EC%9D%B4%EC%96%B4%ED%8F%B0" --no-frames --wait-ms 1000 --timeout-ms 15000`:
  final claim gate OK with 24 artifacts, 5 claims, 5 citations, and 2
  obstruction artifacts
- `node .\dist\cli.js evidence-run --url "https://browse.gmarket.co.kr/search?keyword=%EB%AC%B4%EC%84%A0+%EC%9D%B4%EC%96%B4%ED%8F%B0" --no-frames --wait-ms 1000 --timeout-ms 15000`:
  final claim gate OK with 25 artifacts, 5 claims, 5 citations, and 2
  obstruction artifacts
- `node .\dist\cli.js source-navigation-calibration-targets --category search --locale ko-KR --min-tier 2 --query "성수 카페" --format lines`:
  returned Naver, Google, Daum, and Bing search calibration targets ordered by
  local top-slot rank first
- `node .\dist\cli.js evidence-run --url https://example.com/ --no-frames --wait-ms 0 --timeout-ms 10000 --source-navigation-calibrate --source-navigation-calibration-timeout-ms 1000`:
  final claim gate OK with calibration summary and artifacts
- `node .\dist\cli.js source-navigation-catalog --url https://www.google.com/search?q=tokyo+hotel`:
  returned explicit-opt-in catalog proposal entries
- `node .\dist\cli.js source-navigation-export-recipes --url https://www.google.com/search?q=tokyo+hotel`:
  returned an empty export because no calibration files were supplied

## Definition Of Done

Phase 1 is done when:

- [x] navigation plan artifact is written for every evidence-run
- [x] plan is included in assessment and final report
- [x] source-family default actions are typed and tested
- [x] unsupported actions are explicit for video/social and travel/commerce
- [x] `npm run verify` passes after final documentation updates
- [x] `npm pack --dry-run` includes the new docs after final documentation
  updates
- [x] `docs/NEXT_TASKS.md` and `AGENTS.md` describe the new status

Phase 2 started after Phase 1 completed.

## Phase 2 Current Status

The first executor foundation and local browser-backed executor slice are
implemented:

- `src/source-navigation-execution.ts`
- `src/source-navigation-executor.ts`
- `tests/source-navigation-execution.test.ts`
- `tests/source-navigation-executor.test.ts`

It creates bounded execution plans with:

- max action caps
- per-action timeout limits
- before/after capture flags
- omitted-action counts
- unsupported non-executable steps

It executes explicit recipes with:

- before/after page captures
- action metadata artifacts
- skipped records for unconfigured planned actions
- unsupported records for blocked actions
- optional timeout and abort propagation through BrowserPool write actions
- CLI/MCP/HTTP recipe input and workflow-level execution summaries
- scoped locator captures for map panels, price cards, rate panels, galleries,
  and other selected browser-visible regions
- expected visible-state assertions using selector visibility and text
  containment
- explicit `follow_up` recipes that resolve destination URLs without parent-page
  click-through and launch bounded one-depth child evidence runs under
  `runDir/followups`
- narrower Naver Search manual-only calibration candidates for integrated
  result modules, Blog/Cafe links, news title links, and map/place links before
  broad `#main_pack` or `#search` fallback extraction
- Naver integrated-search local executor fixture coverage for query state,
  vertical-tab state, visible filter/sort/pagination state, separate View/
  Blog/Cafe, News, Place, Image, Video, and Shopping module captures, and mixed
  anchor plus SPA-style destination extraction before repeated live calibration
- broader Google Search manual-only calibration candidates for news/image/video
  modules, English/Korean/Japanese vertical labels, News links, YouTube/Shorts
  links, Vimeo links, and image anchors before broad `#search` fallback
  extraction
- Google rich-search local executor fixture coverage for local/map, news,
  image, video, sponsored module capture, provider-specific vertical tabs, and
  mixed organic/news/local/image/video destination extraction before repeated
  live calibration
- map/local manual-only destination extraction candidates for Naver Map,
  KakaoMap, and Google Maps. These read visible place-detail, website, menu,
  review, booking/place, and external website links through
  `extract_destinations` without clicking the parent map page. Route, call,
  reservation, booking, login, and account-changing controls remain unsupported
  and extracted links still go through destination triage before child runs.
- explicit client-state destination extraction for Naver Map/Place list states
  where the browser-visible cards do not expose usable `href` or SPA URL
  attributes. BrowserPool provides a generic frame-aware client-state snapshot;
  the source-navigation executor interprets Naver Place `window.__APOLLO_STATE__`
  outside BrowserPool and emits bounded Place follow-up requests through
  `extract_client_state_destinations`. Naver Place child requests execute via
  `map.naver.com/p/entry/place/<id>` and retain canonical `place.naver.com`
  provenance in `originalUrl`.
- commerce manual-only destination extraction candidates for Amazon, Coupang,
  Naver Shopping, Gmarket, and 11st. These read visible product-detail, review,
  seller, brand/store, and marketplace item links through
  `extract_destinations` without clicking the parent marketplace page. Cart,
  wishlist, purchase, checkout, subscribe, membership, login, and
  account-changing controls remain unsupported.
- provider-specific local commerce executor fixtures for Amazon, Coupang,
  Naver Shopping, Gmarket, and 11st. These verify query entry, visible filters,
  visible sort, bounded pagination, product-card capture, seller/return terms,
  shipping panels, price badges, and anchor plus SPA-style destination
  extraction before profile/headed or repeated live calibration is attempted.
- blog/cafe manual-only destination extraction candidates for Naver Blog and
  Naver Cafe. These read visible source, related-post, profile, official, and
  external links through `extract_destinations` without clicking the parent
  article page. Member-only, join, login, comment-write, like, scrape-private,
  and account-changing controls remain unsupported.
- video/social manual-only destination extraction candidates for YouTube,
  Instagram, TikTok, and X/Twitter. These read visible profile/channel,
  canonical media, external bio/source, and related-media links through
  `extract_destinations` without clicking the parent social/media page. Login,
  app-open, follow, like, comment, share, message, subscribe, raw-stream, and
  gate-bypass controls remain unsupported.
- knowledge/database manual-only capture and destination extraction candidates
  for Google Scholar, Wikipedia, Namuwiki, PubMed, data.go.kr, KOSIS, RISS,
  and KIPRIS. These preserve browser-visible article bodies, abstracts,
  citation/reference lists, dataset/statistic metadata, academic records, and
  patent-detail fields while edit, login, restricted-download, paid full-text,
  and institutional-access controls remain unsupported.
- Google Scholar now has portal-shaped local executor fixture coverage for
  query state, section/filter state, result-card metadata, author/publication
  metadata, abstract snippets, citation/version links, DOI/full-text links, and
  visible obstruction-state capture.
- local executor fixtures now mark the generic knowledge/database path
  `fixture_verified` for Wikipedia, Namuwiki, PubMed, data.go.kr, KOSIS, RISS,
  and KIPRIS by verifying page capture, bounded scroll, and visible citation/
  source/dataset/record destination extraction before repeated live
  calibration.

Still missing:

- real-site tuning after fixtures are stable
- promotion of calibrated manual-only candidates into maintained provider
  recipe catalogs
- repeated calibration runs across Naver/Google/travel/social/news fixtures
  before any candidate becomes a default recipe
- broad destination candidate extraction for choosing useful child pages when a
  portal exposes many possible news, blog, official-site, review, community, or
  media destinations; search, portal/news, community, map/local, commerce,
  blog/cafe, video/social, and generic web now have first manual-only provider
  candidates, but still need repeated real-site calibration before maintained
  export
