# Portal Navigation Architecture

This is the middle-level engineering plan for portal-native evidence navigation.
It merges the office-hours design with `/plan-eng-review` findings.

## Step 0: Scope Challenge

### What Already Exists

- `src/source-strategy.ts` detects source family/platform and emits evidence
  plans, extraction hints, warnings, and required agent work.
- `src/evidence-runner.ts` already writes a `source_strategy` artifact before
  browser capture and includes it in the assessment and final report.
- `src/artifact-writer.ts` already writes typed artifacts and infers evidence
  kinds from capture method and artifact shape.
- `src/schemas.ts` already centralizes Zod validation for evidence-run input,
  evidence kinds, claim types, verification levels, OCR metadata, and browser
  operations.
- `src/browser-pool.ts` already provides bounded browser actions, captures,
  frame sampling, overlay dismissal, and abort propagation.
- `src/browser-obstructions.ts`, `src/ocr.ts`, `src/official-api.ts`, and
  `src/frame-sampler.ts` already cover major derivative evidence paths.
- `src/source-navigation.ts`, `src/source-navigation-execution.ts`, and
  `src/source-navigation-executor.ts` now cover typed navigation plans,
  bounded execution plans, explicit local recipes, scoped captures,
  expected-state assertions, one-depth follow-up orchestration, and explicit
  multi-destination extraction.

### Minimum Complete Change

The original complete but right-sized step was not full site automation. It was
a typed navigation plan artifact that describes safe platform-native actions and
threads that plan through evidence-run.

That phase has now shipped locally. The next complete but right-sized step is a
source coverage registry above source strategy:

- add `src/source-registry.ts`
- add `source_registry` to `EvidenceKindSchema`
- write a registry artifact in `src/evidence-runner.ts`
- include registry match/support tier in `EvidenceWorkflowAssessment` and final
  report
- export registry types and helpers from `src/index.ts`
- add category/locale/top-slot tests
- add CLI inspection for registry coverage
- update docs and package file inclusion

The registry now exists locally and does not execute browser actions. It decides
which platforms and evidence capabilities matter for a category/locale before
`SourceStrategy` and `SourceNavigationPlan` choose concrete browser-visible
mechanics.

### Complexity Decision

Implementing the full executor now would touch more than eight files and add
multiple new services. That is a complexity smell for this codebase. Split the
work:

- Phase 1: type and preserve the plan.
- Phase 2: execute a bounded safe subset.
- Phase 2.5: add the information-source coverage registry.
- Phase 3: tune source-family recipes.

This keeps platform-specific strategy outside `BrowserPool`, preserves the
evidence contract, and avoids turning the project into brittle site scraping.

### Search Check

Use built-ins before custom behavior:

- Playwright locators and actionability checks should be the default for Phase 2
  execution. Avoid custom polling unless the page needs a specific stable-state
  condition.
- Playwright locator screenshots should be used for selected panels and focused
  UI regions when the browser-visible target is narrower than the full page.
- Zod discriminated unions are the right fit for typed navigation actions.
- A registry should be plain typed data plus deterministic selectors. Do not add
  network ranking refresh inside evidence-run.

### Distribution Check

No new binary or package artifact is introduced. New docs should be included in
`package.json` `files` so npm consumers get the plan, architecture, and
implementation guide.

`docs/INFORMATION_SOURCE_TAXONOMY.md` is now the coverage-registry reference and
must be included in npm package metadata.

## Architecture Review

### Core Decision

The shipped navigation decision was to add a `SourceNavigationPlan` layer above
browser execution. The next registry decision is to add a
`SourceRegistryEntry` layer above source strategy.

```text
URL
 |
 v
selectSourceRegistryEntries()
 |
+--> source_registry artifact
 |
 v
describeSourceStrategy()
 |
 v
describeSourceNavigationPlan()
 |
 +--> source_navigation_plan artifact
 |
 +--> source_navigation_execution_plan artifact
 |
 +--> destination candidate + triage artifacts
 |
 v
captureBrowserEvidence()
 |
 +--> page/frame/OCR/obstruction/official API artifacts
 |
 v
assessment + claims + final report
```

### Deepening Loop

Search engines and portals are parent evidence surfaces. News articles, blog
posts, official websites, maps, reviews, commerce pages, community threads, and
media pages reached from those surfaces are child evidence surfaces. The system
must keep those two layers separate because the parent proves what was shown in
the result set, while the child proves what the destination actually contained.

```text
parent source-navigation action
 |
 +--> scoped capture of result/module/card
 |
 +--> extract visible destination URLs
 |
 +--> destination_candidate artifacts
 |
 +--> destination_triage artifact
 |      - score before follow-up
 |      - enforce max selected / max per domain / depth / timeout
 |
 +--> selected child evidence-run(s)
 |      - source navigation disabled by default to prevent recursion
 |      - normal capture, OCR, frame, obstruction, API, claim-gate stages
 |
 +--> child evidence summary
 |      - useful / low-value / off-topic / blocked / private / unsupported
 |
 +--> final destination_triage artifact
 |
 +--> destination_deepening_proposal artifact
 |
 +--> optional destination_deepening_run artifact when maxDepth: 2 is explicit
```

Architecture rule: useful child pages can propose a second hop, but they cannot
silently continue. A deeper hop runs only when `sourceNavigation.maxDepth` is
explicitly `2`; it uses separate depth-2 count, per-domain, timeout, and
artifact-count controls, disables source navigation inside the deeper child
run, and records its own provenance chain.

### Search-To-Destination Decision Layer

The deepening loop is the answer to the Google/Naver question: search and portal
pages are lead generators, not final proof. The system should first preserve
what the portal showed, then decide which visible destinations deserve child
evidence runs. It should not silently click every result or claim destination
content from a snippet.

The decision layer has three responsibilities:

- candidate extraction: read visible URLs from calibrated result-card, headline,
  place, product, community-thread, media-card, or official-link selectors
- pre-follow scoring: rank by source context, result position, query/snippet
  overlap, authority hints, freshness hints, duplicate/domain budget, source
  family fit, and obstruction risk
- post-follow verdict: downgrade selected child pages when the child evidence
  is thin, off-topic, blocked, paywalled, private, unsupported, or dominated by
  boilerplate rather than the user's requested subject

This layer should support natural research behavior without becoming an
autonomous crawler. The output is not "we searched the web"; it is "this parent
surface exposed these candidate destinations, these candidates were selected or
rejected for these reasons, and these child pages produced or failed to produce
citeable evidence."

The product-level decision output should be explicit enough for QA and final
claim gates:

- `selected_for_child_run`: the destination looked relevant enough before
  follow-up and fit the count/domain/depth budgets
- `rejected_before_child_run`: the destination was duplicate, unsupported,
  private/login-like, stale, low-overlap, same-page, or budget-limited
- `useful_after_child_run`: browser-visible child evidence matched the query
  and source context strongly enough for possible final claims
- `downgraded_after_child_run`: the child loaded but was thin, off-topic,
  blocked, paywalled, private, unsupported, or dominated by boilerplate
- `deeper_proposal_only`: a useful child exposed another plausible source, but
  execution must wait for explicit `maxDepth: 2`
- `parent_capture_only`: the parent source is ready for evidence capture, but
  maintained destination extraction is not ready yet; this is the expected
  state for sources such as the latest Naver Map Korean-query calibration where
  the viewport/OCR scopes pass final claim-gate but no trustworthy child
  destination selector has been promoted
- `selector_discovery_hint`: planned destination selectors missed or were too
  broad, but global destination discovery preserved promotable or
  non-promotable sample targets for the next provider-specific selector pass

This output must include reason codes and artifact IDs, not just a score. The
same visible link can be useful in one context and low-value in another: an
official homepage may be best for entity facts, a news article may be best for
recent events, a blog/community post may be best for lived experience, and a
commerce/travel page may be best only when the query asks for price or
availability.

The retry loop is part of the architecture, not a manual afterthought. If the
selected child page turns out useless while lower-ranked candidates were
budget-limited, destination triage must report concrete fallback candidates and
copyable CLI flags for the next bounded run. That is how QA distinguishes
"there was no useful source" from "the search-to-source budget was too narrow."

The selector and triage layer should preserve destination intent, because
"deep information" is not one thing:

| Destination type | Useful when | Weak when |
| --- | --- | --- |
| publisher/news article | the query asks for recent events, dates, statements, or reported facts | the child page is a portal shell, paywall, syndication list, or stale duplicate |
| blog/post | the query asks for experience, itinerary, photos, how-to context, or local nuance | the child page is thin, copied, ad-heavy, or unrelated after capture |
| official site | the query asks for entity facts, policy, menu, hours, product specs, or canonical contact data | the page is only a homepage shell and lacks the requested detail |
| map/place detail | the query asks for location, hours, rating, route-adjacent context, visible reviews, or local evidence | the destination does not match the query/place or exposes only a generic map shell |
| review/community thread | the query asks for reputation, user complaints, lived experience, or comparative opinions | content is private, login-only, deleted, unsupported, or boilerplate |
| commerce/travel offer | the query asks for price, availability, room/rate, shipping, seller, return, or booking-adjacent evidence | the child requires cart, checkout, account mutation, or stale unavailable offers |
| video/social/media | the query asks for visible media, caption, profile, public engagement, comments, or timestamped visual evidence | content is behind login/app-open gates, raw stream access, private messaging, or unavailable media |

Architecturally, this means natural deepening needs source-family-specific
candidate profiles plus post-follow child evidence summaries. Rank alone is not
enough; the system must explain why a child source matched or failed the user's
question.

### Natural Deepening Maturity Ladder

The Google/Naver behavior should progress through explicit maturity levels so
QA can tell the difference between "we can capture the parent page" and "we can
trust child source selection."

1. Parent capture ready: search, portal, map, list, feed, or marketplace result
   surfaces can be captured and cited, but destination content is not claimed.
2. Destination extraction candidate: recipe plans include provider-specific
   selectors for visible result links, article links, official links, map/place
   links, review links, product links, profile/channel links, and related-media
   links.
3. Destination extraction ready: repeated calibration promotes narrow
   `extract_destinations` actions, and those matched selectors must also
   probe successfully for usable HTTP(S) destination links. Broad page-shell
   selectors, visible selectors with zero usable links, and selectors whose
   sampled links are all login/provider-shell/unsupported destinations remain
   calibration evidence only and cannot drive child runs.
   Calibration is frame-aware: matches in accessible iframes count, and
   reports preserve which frame first matched so iframe-heavy portals are not
   mistaken for missing selectors.
   If planned destination selectors miss, global `destinationDiscovery`
   diagnostics may scan the visible page and accessible frames for possible
   links or SPA URL attributes, but that output is only a selector-discovery
   hint. Same-document hash links and provider shell anchors such as Naver
    Map `#section_content` / `#header` stay non-promotable.
    Probe and discovery artifacts should include enough classified sample-target
    detail for the next calibration pass: URL, visible text, anchor/attribute
    source, attribute name, frame URL/name, and warning reasons.
    Recipe catalog entries, promotion groups, and coverage-readiness items
    should carry aggregated `destinationDiscovery` counts so QA can distinguish
    "there are promotable targets but no narrow selector yet" from "the visible
    page only exposes low-value, login, or provider-shell links."
    Catalog entries may also derive `selectorHints` from promotable samples,
    for example `a[href*="publisher.example/news"]` or
    `[data-place-url*="place.naver.com/restaurant"]`. These hints are manual
    calibration inputs only; they need a provider/card/container scope and
    repeated read-only calibration before export.
    When the platform has known container scopes, hints should include scoped
    selector suggestions such as
    `#root [data-place-url*="place.naver.com/restaurant"]`; those suggestions
    are still calibration inputs, not maintained recipes.
    Promotion batch output should also write these hints to the group's
    `selector-hints.tsv` file and preserve the path in `files.selectorHints` so
    QA can pick up the next provider-specific selector pass without opening the
    full catalog JSON.
    Coverage readiness and calibration-loop reports should preserve those paths
    beside destination-extraction status, so the next calibration pass can move
    directly from a not-ready source slot to its selector-hint handoff.
    Calibration commands should also be able to consume the same
    `selector-hints.tsv` handoff via `--selector-hints-file` or
    `--selector-hints-files`, appending scoped suggestions as extra read-only
    candidates while keeping them manual-calibration-only until repeated
    promotion gates pass. Loop plans, Markdown reports, and batch manifests
    should preserve the selector-hint input paths so a blocked/headed/provider
    retry can be rerun from the artifact bundle without reconstructing CLI
    arguments from memory.
4. Bounded child evidence ready: selected destinations run as separate child
   workflows under top-K, per-domain, depth, timeout, and artifact budgets.
5. Usefulness verdict ready: child evidence can be marked useful, low-value,
   off-topic, blocked, paywalled, private, or unsupported using browser-visible
   evidence density, query overlap, obstruction, source-family fit, OCR,
   transcript, and metadata signals.
6. Natural default candidate: only after provider-specific QA proves levels 3-5
   on real Google/Naver/Daum/map/blog/community/travel/commerce/social pages
   should a source slot be considered for default natural deepening.

Current placement on the ladder:

- Google Search with the imported user-controlled Chrome profile has reached
  bounded child evidence readiness for at least one maintained result-link
  path.
- Google Maps has reached bounded child evidence readiness for the tested
  place-link path.
- KakaoMap has reached child-run execution plus usefulness downgrade
  diagnostics, but needs more Korean-query/provider selector tuning.
- Naver Map remains parent capture ready and destination extraction
  candidate-only. Its latest maintained action file intentionally produces no
  child follow-up because only map viewport/OCR capture scopes are ready. A
  later global discovery pass found only Naver home/login links and map-shell
  hash anchors, all classified as non-promotable, so the architecture should
  keep Naver Map out of natural default deepening until narrower place/detail
  selectors appear in repeated calibration.

Depth-2 is a separate opt-in capability, not part of the default maturity
ladder. Useful child pages may emit `destination_deepening_proposal` artifacts,
but execution requires explicit `sourceNavigation.maxDepth: 2`.

### Proposed Type Shape

```ts
type SourceNavigationActionKind =
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

interface SourceNavigationPlan {
  schemaVersion: "1.0";
  inputUrl: string;
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  mode: "plan_only" | "safe_execute";
  queryState: SourceQueryState;
  plannedActions: SourceNavigationAction[];
  extractionTargets: SourceExtractionTarget[];
  unsupportedActions: SourceUnsupportedAction[];
  warnings: string[];
}
```

### Destination Triage Type Shape

The current executor can run explicit one-depth `follow_up` requests and
explicit `extract_destinations` actions that read multiple visible HTTP(S)
links from a result/module selector without clicking the parent page. Those
requests produce destination candidate and triage artifacts. The next
architecture layer should maintain calibrated provider selectors and richer
source-specific usefulness analysis before expanding multi-destination
execution. The current child-run feedback loop already records evidence density
and query overlap for selected destinations.

```ts
type DestinationUsefulness =
  | "useful"
  | "low_value"
  | "duplicate"
  | "off_topic"
  | "budget_limited"
  | "blocked"
  | "paywalled"
  | "private"
  | "unsupported";

interface DestinationCandidate {
  schemaVersion: "1.0";
  sourceArtifactId: string;
  parentUrl: string;
  url: string;
  rank?: number;
  sourceFamily: SourceFamily;
  platform: SourcePlatform;
  visibleText: string;
  domain: string;
  candidateKind: "news" | "blog" | "official" | "map_place" | "review" | "community" | "commerce" | "media" | "generic";
  scoreBreakdown: DestinationCandidateScoreBreakdown;
  signals: string[];
  warnings: string[];
}

interface DestinationCandidateScoreBreakdown {
  profile: "search_general" | "map_local" | "blog_content" | "portal_news" | "travel_booking" | "commerce" | "video_social" | "generic_web";
  base: number;
  rank: number;
  kind: number;
  query: number;
  authority: number;
  freshness: number;
  sourceFamilyFit: number;
  profileAdjustment: number;
  externalDestination: number;
  warnings: number;
  total: number;
}

interface DestinationTriageBudget {
  maxSelected: number;
  maxPerDomain: number;
  depth: 1;
}

type DestinationTextScriptFamily = "latin" | "hangul" | "hiragana" | "katakana" | "han" | "digit";

interface DestinationChildEvidenceSummary {
  artifactCount: number;
  claimCount: number;
  browserCaptureRecords: number;
  obstructionCount: number;
  pageTextLength: number;
  queryOverlapTokenCount: number;
  matchedQueryTokens: string[];
  queryScriptFamilies?: DestinationTextScriptFamily[];
  evidenceScriptFamilies?: DestinationTextScriptFamily[];
  queryEvidenceScriptMismatch?: boolean;
  evidenceSignals: string[];
  evidenceWarnings: string[];
  title?: string;
  finalUrl?: string;
  textSnippet?: string;
}

interface DestinationTriageResult {
  schemaVersion: "1.0";
  query?: string;
  parentRunId: string;
  candidates: DestinationCandidate[];
  selected: Array<DestinationCandidate & {
    score: number;
    reason: string;
    maxDepth: number;
  }>;
  rejected: Array<DestinationCandidate & {
    usefulness: DestinationUsefulness;
    reason: string;
  }>;
}

interface DestinationDeepeningExecutionSummary {
  status: "not_requested" | "not_enabled" | "no_proposals" | "ok" | "partial";
  maxDepth: number;
  maxRuns: number;
  maxPerDomain: number;
  timeoutMs: number;
  maxArtifacts: number;
  proposalCount: number;
  candidateCount: number;
  attemptedCount: number;
  completedCount: number;
  failedCount: number;
  omittedCount: number;
  usefulCount: number;
  offTopicCount: number;
  blockedCount: number;
  budgetLimitedCount: number;
  timeoutCount: number;
}
```

Promotion rule: search snippets and portal modules prove only portal display.
Claims about destination content require child-run artifacts, and final
claim-gate now requires the citation chain to preserve parent portal evidence
plus destination evidence for destination evidence kinds.

### Destination Usefulness Signals

The child-run verdict should use browser-visible and artifact-backed signals:

- useful: meaningful page text, captures, claims, and query-overlap evidence
- low-value: boilerplate, empty page, directory shell, or too little visible
  evidence after capture
- off-topic: child evidence exists but does not match the query or parent
  result intent
- query-script mismatch possible: child evidence exists and has visible text,
  but direct query-token overlap is absent while the query and child evidence
  have different dominant scripts; this is surfaced as a QA caution, not as a
  relevance pass
- path-based map query: Google Maps `/maps/search/<query>` and Naver Map
  `/p/search/<query>` paths are treated as query state for child usefulness
  diagnostics, while provider-internal place URLs with benign state parameters
  such as `authuser=0` remain eligible destination evidence
- blocked: login wall, app interstitial, CAPTCHA, bot block, region/age gate, or
  unavailable content
- paywalled/private: visible access limitation that must be recorded, not
  bypassed
- unsupported: non-HTTP(S), account-changing, raw-media, payment, private
  message, or other unsupported destination

This usefulness verdict is advisory for selection but mandatory for final
reporting. A destination that was selected before execution can still be
downgraded after the child evidence run.

Useful-child selection should also record why a page was useful for this
question, not only that it loaded. The minimum useful-child reasons are query
term overlap, visible title/body relevance, official or publisher signal,
freshness signal, local/place/review match, price/offer/product evidence,
caption/transcript/OCR evidence, or structured metadata that matches the source
category. The minimum rejection reasons are duplicate, same-page portal shell,
low evidence density, no query overlap, stale mismatch, blocked/private/
  paywalled access, possible query-script mismatch, unsupported action, or
  exhausted count/domain budget.

### Coverage Registry Type Shape

```ts
type InformationCategory =
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

type LocaleSegment =
  | "global"
  | "ko-KR"
  | "ja-JP"
  | "en-US"
  | "zh-CN"
  | "regional";

interface SourceRegistryEntry {
  platform: SourcePlatform;
  displayName: string;
  informationCategories: InformationCategory[];
  sourceFamilies: SourceFamily[];
  localeSegments: LocaleSegment[];
  supportTier: 0 | 1 | 2 | 3 | 4 | 5;
  requiredCapabilities: string[];
  unsupportedActions: string[];
  topSlot?: {
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
  };
}
```

The registry should expose deterministic helpers:

- `listSourceRegistryEntries(filter)`
- `selectSourceRegistryEntriesForUrl(url)`
- `assertRegistryCoverage(registry)`
- `summarizeSourceRegistryMatch(match)`

It should not fetch live ranking data during evidence-run. Ranking references
must be maintained as explicit metadata and tested for presence/staleness.

### State Machine

```text
planned
  |
  v
capture_before
  |
  v
execute_action? ---- no ----> capture_after
  |                           |
 yes                          v
  |                         extract
  v                           |
action_attempted              v
  |                         citeable_artifacts
  +--> action_succeeded -------+
  |
  +--> action_failed --> failure_artifact --> continue_or_stop
  |
  +--> obstruction_detected --> obstruction_artifact --> stop
```

Phase 1 creates the `planned` state and artifact. Phase 2 now adds a bounded
execution-plan artifact plus a browser-backed executor for explicit local
recipes. Platform-specific recipe catalogs are still future work.

### Source Family Defaults

| Family | Required plan actions | Primary extraction targets |
|--------|------------------------|----------------------------|
| search | set query, vertical/filter/sort, capture SERP, follow destination | ranking, snippets, filters, ads/modules |
| map | set query, capture viewport, select place, capture panel, OCR labels | viewport, pins, place panel, review snippets |
| blog/forum | capture article/thread, comments if visible, OCR images | title, author/date, body, comments, images |
| travel/commerce | set dates/guests/currency, filter/sort, capture list/detail | price cards, fees, policies, availability |
| video/social | capture metadata, sample frames, OCR overlays, classify obstructions | title/caption, frames, captions, comments |
| generic web | capture page, infer shape, propose follow-up actions | JSON-LD, OG, headings, tables, media |

Destination follow-up is not enough by itself. The shared layer can now extract
visible destination candidates from explicit selectors, score them against the
user's query and source context, and execute only bounded child runs for useful
candidates. Selected child runs now feed evidence-density and query-overlap
signals back into triage. Candidate scoring now records source-family profiles
for search, map/local, blog/content, portal/news, travel booking, commerce,
video/social, and generic web contexts. Proposal-only depth-2 artifacts now
exist for useful child pages with visible candidate links, explicit
`maxDepth: 2` can execute those proposals without enabling recursive source
navigation, separate depth-2 timeout/artifact budgets now exist, and final
claim-gate enforces destination provenance citations. The next work is broader
provider-specific destination selector calibration. Promotion and source
coverage readiness now expose destination-extraction readiness separately from
general capture readiness, so QA can distinguish "this source can preserve the
parent page" from "this source can reliably extract child destinations."

### Security Boundary

Unsupported actions must be explicit:

- login automation
- CAPTCHA solving
- accept-all tracking consent
- age-gate bypass
- region-gate bypass
- app-open interstitial acceptance
- payment, booking, reservation, account-changing actions
- raw media stream downloads

The plan may record these as blocked or unsupported, but it must not execute
them.

## Code Quality Review

### Findings

1. `SourceStrategy` is currently doing two jobs: source classification and
   high-level evidence planning. Keep it, but do not add action-level state
   transitions directly into that file. Add `source-navigation.ts` so the
   strategy file stays readable.

2. Avoid a site-specific class hierarchy. A discriminated action list is enough
   for Phase 1. Recipes can be plain data returned by functions.

3. Keep `BrowserPool` platform-agnostic. Execution helpers can call browser
   actions, but Naver/Google/YouTube semantics belong in source-navigation or
   recipe modules.

4. Use typed schemas for action payloads early. Unstructured action metadata
   will make claim gates and fixtures hard to trust later.

## Test Review

### Coverage Diagram

```text
CODE PATHS                                             USER FLOWS
[+] source-registry.ts                                 [+] Korean search coverage
  +-- [TESTED] InformationCategory / LocaleSegment types  +-- [TESTED] Naver, Google, Daum/Kakao slots
  +-- [TESTED] mandatory top-slot registry tests          +-- [TESTED] support tier and family mapping visible
  +-- [TESTED] source_registry artifact

[+] source-navigation.ts                               [+] Naver vertical research
  +-- [TESTED] describeSourceNavigationPlan()             +-- [TESTED] query -> tab -> SERP plan
  |   +-- [TESTED] search family actions                  +-- [TESTED] destination follow-up marked
  |   +-- [TESTED] map family actions
  |   +-- [TESTED] blog/forum family actions            [+] Map/place research
  |   +-- [TESTED] travel/commerce family actions         +-- [TESTED] query -> viewport -> place panel
  |   +-- [TESTED] video/social family actions            +-- [TESTED] OCR target marked for map labels
  |   +-- [TESTED] generic web fallback
  |                                                        [+] Video/social evidence
[+] schemas.ts                                            +-- [TESTED] metadata -> frames -> OCR targets
  +-- [TESTED] source_navigation_plan evidence kind       +-- [TESTED] obstruction is terminal
  +-- [TESTED] source_navigation_execution_plan evidence kind
  +-- [TESTED] source_navigation_action evidence kind

[+] evidence-runner.ts                                  [+] Travel/commerce evidence
  +-- [TESTED] writes navigation-plan artifact            +-- [TESTED] query state includes dates/guests
  +-- [TESTED] writes execution-plan artifact
  +-- [TESTED] assessment includes navigation plan        +-- [TESTED] booking/payment unsupported
  +-- [TESTED] final report summarizes navigation plan

[+] source-navigation-execution.ts
  +-- [TESTED] action caps, timeout limits, unsupported steps

[+] source-navigation-executor.ts
  +-- [TESTED] explicit recipes only
  +-- [TESTED] fill/click/select/wait/capture/scroll operations
  +-- [TESTED] skipped and unsupported action artifacts
  +-- [TESTED] expected visible-state assertions
  +-- [TESTED] scoped region capture artifacts

[+] evidence-run input surfaces
  +-- [TESTED] CLI/MCP/HTTP schema path accepts explicit recipes
  +-- [TESTED] workflow executes configured recipes before final capture

COVERAGE: Phase 1 plan generation, evidence-run execution-plan integration, and
the first local browser-backed executor/input slice are covered by unit and
workflow tests.
```

### Required Tests

- `tests/source-registry.test.ts`
  - asserts mandatory category/locale slots have at least three entries or an
    explicit documented exception
  - asserts each registry entry maps to at least one `SourceFamily`
  - asserts support tiers and unsupported actions are present
  - asserts ranking metadata includes metric, source URL, and observed date when
    a top slot is claimed
  - asserts AI search/agent entries are marked as derivative evidence
- `tests/source-navigation.test.ts`
  - classifies search/map/blog/travel/video/generic actions from representative
    URLs
  - asserts unsupported actions are present for travel/commerce and
    video/social
  - asserts Naver and Google plans include query-state fields
- `tests/evidence-runner.test.ts`
  - asserts evidence-run writes a `source_navigation_plan` artifact
  - asserts evidence-run writes a `source_navigation_execution_plan` artifact
  - asserts assessment includes the navigation plan
  - asserts final report includes platform/family/action count summary
- `tests/artifact-writer.test.ts` or direct evidence-run test
  - asserts `source_navigation_plan` evidence kind is preserved in the ledger
- `tests/source-navigation-execution.test.ts`
  - asserts bounded execution plans cap actions, validate limits, and preserve
    unsupported steps
- `tests/source-navigation-executor.test.ts`
  - asserts explicit local recipes execute browser actions with before/after
    captures and action artifacts
  - asserts unconfigured planned actions are skipped and unsupported actions
    remain visible

## Performance Review

Phase 1 has low runtime risk because it only generates structured planning data.

Phase 2 execution must include:

- max action count
- per-action timeout
- per-state capture cap
- screenshot/OCR frame caps
- abort propagation
- no unbounded infinite scroll
- no recursive destination following by default
- destination triage top-K, depth, timeout, and per-domain caps before any
  child evidence runs

## Failure Modes

| Codepath | Failure mode | Test required | Error handling |
|----------|--------------|---------------|----------------|
| source registry | top-three coverage silently missing | registry coverage test | fail test or mark explicit exception |
| source registry | stale ranking treated as current truth | registry metadata test | show observed date and stale warning |
| source registry | AI answer treated as primary proof | registry category test | mark derivative evidence only |
| source registry | private messenger treated as crawlable | registry unsupported-action test | require explicit user-visible capture only |
| navigation plan generation | unknown source family creates empty plan | generic fallback test | return generic plan with warning |
| evidence-run artifact write | plan artifact missing from ledger | workflow regression test | fail or record partial artifact |
| search family plan | snippets treated as destination proof | search plan test | require follow-up action |
| destination triage | first visible result is low-value or off-topic | triage fixture | score/reject and continue within top-K |
| destination triage | child page claims lose parent result provenance | claim-gate regression test | cite parent action, candidate, follow-up, and deeper proposal artifacts |
| destination triage | traversal becomes crawler-like | budget tests | enforce depth, domain, count, and timeout caps |
| map family plan | viewport/ranking personalization ignored | map plan test | include viewport/profile warnings |
| travel plan | price claim lacks query state | travel plan test | require dates/guests/currency targets |
| video/social plan | full video understanding implied | video plan test | require frame/transcript/audio distinctions |
| Phase 2 executor | action loop runs too long | executor tests later | max actions, timeout, abort |
| Phase 2 executor | click hits login/payment/CAPTCHA | executor tests later | unsupported action classifier |

No silent critical gap is accepted for Phase 1. Any missing plan artifact should
be visible in tests and final report output.

## Worktree Parallelization

Phase 1 should be sequential because the key changes share schemas,
evidence-runner, and tests.

Future Phase 2 can split:

| Step | Modules touched | Depends on |
|------|-----------------|------------|
| source registry | source-registry, schemas, evidence-runner, CLI, tests | existing source strategy |
| navigation action schemas | schemas, source navigation | none |
| safe executor | browser pool, evidence runner | schemas |
| recipe tuning | source navigation, tests | schemas |
| OCR/scene calibration | OCR, frame sampler, fixtures | none |
| docs/package | docs, package metadata | schemas |

Parallel lanes after Phase 1:

- Lane A0: source registry -> category/locale/top-slot coverage
- Lane A: safe executor -> action-state artifacts
- Lane B: OCR/scene real fixture calibration
- Lane C: docs and package polish

Merge A0 before broad platform recipe catalogs so fixture priority follows the
coverage registry. Merge A before platform recipes that execute real actions.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific
finding above.

- [x] **T1 (P1, human: ~2h / CC: ~20min)** — source navigation — add typed
  `SourceNavigationPlan` and default family action templates.
  - Surfaced by: Architecture Review
  - Files: `src/source-navigation.ts`, `src/schemas.ts`, `src/index.ts`
  - Verify: `npm test -- tests/source-navigation.test.ts`
- [x] **T2 (P1, human: ~2h / CC: ~20min)** — evidence workflow — write
  `source_navigation_plan` artifacts and include them in assessment/final
  report output.
  - Surfaced by: Architecture Review and Test Review
  - Files: `src/evidence-runner.ts`, `src/artifact-writer.ts`,
    `tests/evidence-runner.test.ts`
  - Verify: `npm test -- tests/evidence-runner.test.ts`
- [x] **T3 (P1, human: ~1h / CC: ~15min)** — tests — add fixture coverage for
  search, map, blog/forum, portal/news, travel/commerce, video/social, and generic web
  navigation plans.
  - Surfaced by: Test Review
  - Files: `tests/source-navigation.test.ts`
  - Verify: `npm test -- tests/source-navigation.test.ts`
- [x] **T4 (P2, human: ~1h / CC: ~10min)** — docs/package — include the new
  product, architecture, and implementation guide docs in package metadata.
  - Surfaced by: Distribution Check
  - Files: `package.json`, docs
  - Verify: `npm pack --dry-run`
- [x] **T5 (P2, human: ~4h / CC: ~45min)** — executor design follow-up — add a
  safe navigation executor only after Phase 1 lands and passes.
  - Surfaced by: Complexity Decision
  - Files: `src/source-navigation-execution.ts`,
    `src/source-navigation-executor.ts`, `src/browser-pool.ts`,
    `src/evidence-runner.ts`, executor tests
  - Verify: `npm test -- tests/source-navigation-executor.test.ts tests/source-navigation-execution.test.ts`
- [x] **T6 (P2, human: ~4h / CC: ~45min)** — recipe schema — add typed
  executable recipe inputs for CLI/MCP/HTTP and keep real-site defaults
  disabled unless selectors are explicit.
  - Surfaced by: Security Boundary and Failure Modes
  - Files: `src/source-navigation-executor.ts`,
    `src/evidence-run-input.ts`, `src/farm-service.ts`, `src/cli.ts`,
    `tests/source-navigation-executor.test.ts`
  - Verify: focused CLI/MCP input tests plus local browser fixtures
- [ ] **T7 (P2, human: ~4h / CC: ~45min, partial)** — fixture expansion — add
  Naver-like vertical tabs, map panels, Google filters, travel list/detail,
  pagination, media gallery, and video/social obstruction fixtures before any
  real-site recipe defaults execute. Search vertical tabs, bounded pagination,
  blog media galleries, video/social obstruction, map panels, and travel
  offer/rate cards are covered; richer Google-specific filter layouts and
  gallery variants now have first Google-like coverage; Google map/news/ad
  modules, Naver Cafe public/member states, KakaoMap panels, and richer travel
  room/rate cards now have local fixture coverage. Real-site selector
  calibration and broader provider-specific variants remain.
  - Surfaced by: Test Review and Security Boundary
  - Files: `tests/source-navigation-executor.test.ts`,
    `tests/evidence-runner.test.ts`, future recipe modules
  - Verify: focused executor/workflow fixture tests
- [x] **T8 (P2, human: ~3h / CC: ~30min)** — destination follow-up — add
  explicit recipe support for creating separate evidence runs from selected
  destination links without recursive crawling.
  - Surfaced by: Failure Modes and Source Family Defaults
  - Files: `src/source-navigation-executor.ts`, `src/evidence-runner.ts`,
    workflow tests
  - Verify: local destination fixture creates a separate run/artifact record
- [x] **T9 (P1, human: ~3h / CC: ~35min)** source registry - add
  `InformationCategory`, `LocaleSegment`, support-tier types, and initial
  mandatory top-slot entries.
  - Surfaced by: Scope Challenge and Coverage Registry Type Shape
  - Files: `src/source-registry.ts`, `src/index.ts`,
    `tests/source-registry.test.ts`
  - Verify: `npm test -- tests/source-registry.test.ts`
- [x] **T10 (P1, human: ~2h / CC: ~25min)** evidence workflow - write
  `source_registry` artifacts and summarize registry support tiers in
  assessment/final reports.
  - Surfaced by: Architecture Review
  - Files: `src/schemas.ts`, `src/artifact-writer.ts`,
    `src/evidence-runner.ts`, `tests/evidence-runner.test.ts`
  - Verify: `npm test -- tests/evidence-runner.test.ts`
- [x] **T11 (P1, human: ~1.5h / CC: ~20min)** CLI/DX - add a read-only
  registry inspection command for category/locale planning.
  - Surfaced by: Distribution Check and Test Review
  - Files: `src/cli.ts`, `README.md`, `tests/source-registry.test.ts`
  - Verify: `node .\dist\cli.js source-registry --category search --locale ko-KR`
- [ ] **T12 (P2, human: ~2h / CC: ~25min)** fixture priority - use registry
  coverage to choose the next local fixtures for Naver/Google search,
  Naver/Kakao/Google maps, YouTube/Instagram/TikTok/X-Twitter, Naver
  Cafe/Blog, and travel/commerce. The first registry-prioritized follow-up
  batch added Google
  map/news/ad modules, Naver Cafe public/member states, KakaoMap panels, and
  richer travel room/rate cards, followed by commerce product-card,
  seller/return, shipping, and price-badge scopes plus video/social public
  metadata, thread, frame, and overlay scopes, and Google Maps selected-place
  sheet/review/photo/map-label scopes. The next fixture pass added Naver/Daum
  news module, publisher metadata, destination follow-up, and obstruction-state
  scopes. Real-site calibration has since promoted first read-only baselines
  for Naver/Daum News, Naver/Daum Search, Naver/Kakao/Google Maps, Naver Blog,
  YouTube search, Naver Cafe search, DCInside search, and Naver Knowledge iN
  search. Reddit, Quora, and Stack Overflow now have local global
  community/forum fixture coverage for query state, section/filter/pagination,
  thread card capture, destination follow-up, and obstruction-state evidence,
  and a first repeated real-site calibration attempt now classifies all three
  as blocked in the current unattended browser by network-security or
  Cloudflare security-verification pages. The readiness loop emits
  profile/headed retry commands instead of exporting maintained actions from
  those challenge pages. X/Twitter now has local public post/thread/media
  fixture coverage for explicit read-only recipes. A first repeated
  `social_feed` / `global` real-site calibration promotes maintained
  read-only action files for Instagram hashtag search and X/Twitter search,
  while TikTok search is classified as blocked by a visible server-error /
  unavailable-media surface in the unattended browser. Coupang, Naver Shopping,
  and Gmarket
  marketplace calibration has also been attempted; the current unattended
  browser sees access-denied or bot-check surfaces, so those groups are
  classified as blocked and need profile/headed calibration before maintained
  commerce action export. Global travel booking recipes now have
  provider-specific Booking.com, Agoda, Trip.com, and Expedia selector
  candidates for query/filter/sort/list/pagination/offer/price scopes plus
  blocked-signal handling for access-denied, security-check, interruption, and
  cookie-required pages. The first global marketplace/travel calibration pass
  promoted maintained read-only action files for Amazon and Trip.com. The
  follow-up pass added travel `offer-card` capture promotion and provider-
  specific Booking.com/Agoda Tokyo target hints, so Amazon, Booking.com, Agoda,
  and Trip.com now have maintained read-only action files. Booking.com and
  Agoda are offer-card baselines; Trip.com also has maintained price/OCR
  capture. Expedia repeated calibration currently lands on a browser-visible
  "Bot or Not?" human/bot challenge in the unattended browser, and the
  calibration/promotion path now classifies that group as blocked rather than
  missing selectors. Profile/headed calibration runtime is now recorded in
  coverage plans, batch manifests, promotion groups, and ready evidence-run
  commands so retry runs are reproducible. Coverage readiness can also print
  `auth-login` setup plus profile/headed retry commands for blocked slots,
  keeping the QA loop actionable when top sources require login, consent, or
  human/bot challenge handling.
  - Surfaced by: Failure Modes and Worktree Parallelization
  - Files: `tests/source-navigation-executor.test.ts`,
    `tests/evidence-runner.test.ts`, future fixture helpers
  - Verify: focused fixture tests plus `npm test`
- [x] **T13 (P2, human: ~1h / CC: ~10min)** docs/package - keep
  `docs/INFORMATION_SOURCE_TAXONOMY.md` in package metadata and link it from
  top/middle/lower development docs.
  - Surfaced by: Distribution Check
  - Files: `package.json`, `docs/*`, `AGENTS.md`
  - Verify: `npm pack --dry-run`
- [ ] **T14 (P2, human: ~5h / CC: ~60min, partial)** destination triage - add
  bounded candidate extraction and usefulness classification before broader
  multi-destination follow-up. The first foundations now record
  `destination_candidate` and `destination_triage` artifacts for explicit
  follow-up requests and explicit `extract_destinations` multi-link actions,
  and apply deterministic top-K plus per-domain scoring budgets before child
  runs. Child-page evidence-density feedback, authority/freshness signals,
  context-specific scoring profiles, proposal artifacts, explicit
  `maxDepth: 2` depth-2 execution, separate depth-2 timeout/artifact budgets,
  final provenance checks, first map/local destination extraction candidates,
  first commerce product/review/seller/brand extraction candidates, first
  blog/cafe source/related/profile/official extraction candidates, and first
  video/social profile/channel/canonical-media/external-link extraction
  candidates now exist; broad maintained provider selectors still remain.
  - Surfaced by: Office-hours destination-deepening review and Failure Modes
  - Files: `src/source-navigation.ts`, `src/source-navigation-recipes.ts`,
    future `src/destination-triage.ts`, `src/evidence-runner.ts`,
    `src/schemas.ts`, `tests/source-navigation.test.ts`,
    `tests/source-navigation-recipes.test.ts`,
    `tests/source-navigation-executor.test.ts`, `tests/evidence-runner.test.ts`,
    docs
  - Verify: fixtures where the first search result is off-topic, the second is
    useful, blocked/paywalled/private destinations are preserved as evidence,
    and final claims cite both parent portal candidate artifacts and child
    destination artifacts

## NOT In Scope

- full real-site Naver/Google/YouTube/Instagram/TikTok automation in Phase 1
- autonomous recursive crawling or unbounded multi-hop traversal
- CAPTCHA, login, payment, booking, app-open, age-gate, or region-gate bypass
- raw media stream download
- remote shared server mode
- npm publish
- durable ranking, price, or availability claims without timestamped browser
  evidence
- claiming current market-share/top-three status without refreshed ranking
  evidence in the registry metadata

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | Not required for this backend/product-plan pass |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | not run | Not run in this pass |
| Eng Review | `/plan-eng-review` | Architecture & tests | 2 | clear with next tasks | Source coverage registry accepted and implemented as Phase 2.5; fixture-priority T12 remains |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not applicable | No UI scope |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | Could be useful before npm publish |

- **UNRESOLVED:** Interactive AskUserQuestion gates were unavailable in this
  environment, so recommendations were auto-applied as plan text. No blocking
  architecture decision remains open.
- **VERDICT:** PHASE 1 SHIPPED LOCALLY. PHASE 2 SAFE EXECUTOR, EXPLICIT
  RECIPE INPUTS, EXPECTED-STATE ASSERTIONS, SCOPED CAPTURES, ONE-DEPTH
  DESTINATION FOLLOW-UP ORCHESTRATION, AND EXPLICIT MULTI-LINK DESTINATION
  EXTRACTION SHIPPED LOCALLY. PHASE 2.5 SOURCE COVERAGE REGISTRY SHIPPED
  LOCALLY. DESTINATION TRIAGE ARTIFACTS, SOURCE-FAMILY SCORING PROFILES,
  PROPOSAL-ONLY DEPTH-2 ARTIFACTS, EXPLICIT `maxDepth: 2` DEPTH-2
  EXECUTION, AND SEPARATE DEPTH-2 TIMEOUT/ARTIFACT BUDGETS NOW EXIST FOR
  FOLLOW-UP AND EXTRACTED-DESTINATION REQUESTS; NEXT, CALIBRATE BROADER
  GOOGLE/NAVER RESULT DESTINATION SELECTORS WITHOUT BECOMING AN AUTONOMOUS
  CRAWLER.
