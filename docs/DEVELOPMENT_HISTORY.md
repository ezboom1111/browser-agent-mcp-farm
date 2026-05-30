# Development History

This document records why the project exists, what was built, and what future
agents should know before continuing.

## Origin

The project started while researching a Japan travel plan. The browser research
workflow raised a broader need: a reusable local browser farm that can collect
evidence rigorously across normal web pages and media-heavy platforms such as
YouTube, Instagram, and TikTok.

The code was first developed inside:

```text
C:\Users\이지범\Desktop\일본 여행 플랜!\.gstack\tools\browser-agent-mcp-farm
```

It was then split into this independent side-project repository:

```text
C:\Users\이지범\Desktop\browser-agent-mcp-farm
```

## Product Problem

The core question was whether an agent can honestly "watch" or analyze videos.
The answer is nuanced:

- It can inspect page HTML/text/screenshots/network logs.
- It can preserve image-like media and accessible caption files.
- It can sample browser-visible video frames with timestamps.
- It can parse legitimately captured WebVTT into structured transcript cues.
- It can run optional OCR over sampled frame screenshots when the dependency is
  available.
- It can collect official platform metadata only through explicit credentials.
- It cannot honestly claim full audio/video understanding if no authorized
  transcript, audio transcription, or sampled visual evidence exists.
- It must not download or bypass raw platform video streams.

The design goal became an evidence workflow that separates:

- confirmed transcript/text evidence
- timestamped visual frame evidence
- platform metadata/capability evidence
- official API evidence
- OCR-extracted visible text
- inferred observations
- explicitly unverified audio or missing transcript access

## Major Implementation Stages

### C-IMPL-01 to C-IMPL-15: Base Farm

Implemented the initial TypeScript package:

- package skeleton
- lease schemas
- lease manager
- Playwright BrowserContext pool
- capture pipeline
- MCP stdio server
- smoke CLI
- claim gate
- HTML evidence preview
- host adapter docs
- authenticated profile storage
- proxy/fingerprint policy
- Codex/Claude registration
- review-driven hardening

### C-IMPL-16: First-Class Media Artifacts

Added media awareness to the capture pipeline:

- image-like media bytes captured as `media/` artifacts
- VTT files captured when accessible
- video/audio/stream resources indexed in `structured/*.media-index.json`
- raw video/audio stream bytes intentionally skipped by default

### C-IMPL-17: Final Claim Gate

Strengthened `claim-gate`:

- smoke mode can pass zero-claim runs with a warning
- final mode fails zero-claim reports
- claims must cite registered artifact IDs or paths
- citations must match claim IDs
- artifact hashes are verified on disk

### C-IMPL-18: Visible Browser Reuse Policy

Documented and hardened the visible browser workflow so that headed sessions
are status-checked before reuse. Current independent repo keeps the farm package
side; visible browser orchestration lives in the wider gstack environment.

### C-IMPL-19: Browser Helper Tools

Added:

- wait
- wait for selector
- scroll
- capture after idle

These are exposed through MCP and used by smoke/media workflows.

### C-IMPL-20: MCP Version Sync

Kept package and MCP server version aligned during tool/schema changes.

### C-IMPL-21: Sequential Critique Runner

Implemented a queue runner for 10-round critical analysis:

- `critique-next`
- `critique-complete`
- validates configured output files
- advances exactly one task at a time
- prevents a multi-round critique from being collapsed into an untracked answer

### C-IMPL-22: Platform Capability Maps

Added `src/platform-adapters/`:

- YouTube
- Instagram
- TikTok
- generic fallback

The adapter contract records:

- platform
- canonical URL
- media ID/account hint where available
- confidence
- source docs
- warnings
- capability status for metadata, thumbnail, caption track list, caption body,
  visible frame sampling, and raw video bytes

The CLI command:

```powershell
node .\dist\cli.js platform-capabilities --url <url>
```

prints the map without fetching the URL.

Important official-source assumptions:

- YouTube metadata/thumbnails through Data API; caption body access is OAuth and
  rights-gated.
- Instagram IG Media is account/token/permission constrained.
- TikTok Display API covers authorized user videos; Research API can expose
  research fields such as voice-to-text only with approval.

### C-IMPL-23: Timestamped Frame Sampling

Added `farm_sample_frames` and supporting code:

- `src/frame-sampler.ts`
- `BrowserPool.sampleFrames`
- `FarmService.sampleFrames`
- `SampleFramesInputSchema`
- MCP tool registration

Behavior:

- default plan: `0s`, `10s`, `30s`, then every `60s`, capped at 120 frames
- explicit timestamps are normalized and deduped
- each frame writes screenshot and metadata
- metadata includes requested timestamp, seek result, active cues, and track
  info when the browser exposes it
- failed seek/screenshot becomes partial evidence, not a false success

### C-IMPL-24: MCP Re-Registration

After schema/tool changes, re-ran:

```powershell
node .\dist\cli.js register-all
```

In the original environment this updated Codex and Claude user MCP configs to
point at the then-current local package path. In this independent repo, run it
again if this folder should become the active MCP server path.

### C-IMPL-25: Real YouTube Evidence Run

Ran a real YouTube URL through the workflow:

```text
https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

The run produced:

- platform capability artifact
- browser page capture artifacts
- timestamped frame samples at `0s` and `10s`
- run assessment marking audio/transcript as unverified
- `claims.jsonl`
- `citations.jsonl`
- final report
- final claim gate pass

Key result:

- 68 artifacts
- 4 claims
- 4 citations
- final claim gate OK

### C-IMPL-26: First-Class Evidence Runner

The real URL run had initially been a one-off script. It was productized as:

- `src/evidence-runner.ts`
- `runEvidenceWorkflow(options)`
- CLI command:

```powershell
node .\dist\cli.js evidence-run --url <url> [--run-dir <path>] [--timestamps-sec 0,10]
```

The workflow now handles:

- platform capability artifact
- browser page capture
- optional timestamp frame sampling
- assessment artifact
- claims/citations ledgers
- final markdown report
- final claim gate

CLI sanity check:

```powershell
node .\dist\cli.js evidence-run --url https://example.com/ --no-frames --wait-ms 0 --timeout-ms 10000
```

Expected result:

- final claim gate OK
- 4 claims
- 4 citations

### C-IMPL-27: Structured WebVTT Transcripts

Added:

- `src/transcript-parser.ts`
- `parseWebVtt(input)`
- ArtifactWriter integration

When a captured media artifact has MIME `text/vtt`, the farm now:

- preserves the raw VTT under `media/`
- parses cues into structured JSON under `structured/*.transcripts/*.json`

The structured transcript includes:

- source URL
- MIME type
- resource type
- format
- cue count
- flattened text
- cue start/end timestamps

### C-IMPL-28: v0.3 Evidence Workflow Expansion

Implemented the accepted plan after the 0.2.6 evidence-run hardening pass:

- added `farm_evidence_run` MCP tool
- added shared `EvidenceRunInputSchema` and CLI/MCP/HTTP normalization
- added typed claim fields:
  - `schema_version`
  - `claim_type`
  - `artifact_id`
  - `evidence_kind`
  - `verification_level`
  - `timestampSec`
- extended final `claim-gate` so visual claims require timestamped frame
  screenshot artifacts, transcript cue evidence must support text claims, and
  audio claims require audio transcription artifacts
- added evidence kind inference to artifact ledger rows
- added optional OCR over sampled frame screenshots
- added dense timestamp planning around browser-exposed transcript cue hits
- added `evidence-run --profile <name>`
- added `evidence-run --headed`
- added explicit-credential official API metadata collection:
  - YouTube Data API `videos.list`
  - YouTube Data API `captions.list`
  - Instagram Graph media fields
  - TikTok Display API video query
  - TikTok Research API video query
- added per-run official API cache artifacts
- added local HTTP queue endpoints for evidence-run jobs
- added npm package metadata and `prepack`
- added GitHub Actions CI for `npm ci` and `npm run verify`
- added focused tests for typed claim gate, MCP evidence-run registration,
  official API credential redaction, and dense sampling

Important caveats for v0.3:

- OCR is implemented as an optional `tesseract.js` integration. If the
  dependency is not installed or cannot initialize, the workflow writes an
  OCR-unavailable artifact instead of pretending extraction happened.
- Dense sampling currently follows transcript cue hits exposed by the browser.
  OCR-hit and scene-change dense sampling remain future work.
- Official API clients only run when explicit credential env var references are
  supplied. Tokens are read from env and are not written to artifacts.
- The HTTP queue is local orchestration, not a production shared server.

### C-IMPL-29: Local HTTP Queue Lifecycle Controls

Hardened the local evidence-run queue so it can be operated without unbounded
job accumulation:

- added scheduler status `canceled`
- added scheduler stats with per-status counts
- added queued-job cancellation
- added terminal-job deletion
- added terminal-job pruning by age or max retained terminal jobs
- added `--concurrency` and `--max-terminal-jobs` to `serve-http`
- added HTTP endpoints:
  - `GET /health`
  - `POST /evidence-run`
  - `GET /jobs`
  - `GET /jobs?status=queued|running|completed|failed|canceled`
  - `GET /jobs/:id`
  - `POST /jobs/:id/cancel`
  - `DELETE /jobs/:id`
  - `POST /jobs/prune`
- added scheduler and HTTP lifecycle tests

Important caveat:

- running jobs were still not cancellable at this stage.

### C-IMPL-30: Cooperative Running Job Cancellation

Added abort propagation for running local HTTP scheduler jobs:

- added shared abort helpers in `src/abort.ts`
- scheduler now creates one `AbortController` per running job
- `POST /jobs/:id/cancel` now cancels queued jobs immediately or requests abort
  for running jobs
- `runEvidenceWorkflow` accepts `abortSignal`
- evidence workflow checks abort between major stages
- browser open/wait/capture/frame-sampling calls are wrapped so the workflow can
  reject promptly and cleanup owned browser pools
- official API fetch calls receive the abort signal
- OCR loops and OCR recognition waits receive the abort signal
- scheduler marks abort-requested running jobs as `canceled` when the executor
  unwinds
- scheduler and HTTP tests cover running cancellation

Important caveat:

- cancellation is cooperative. A low-level Playwright operation that ignores
  external cancellation may still take until its own timeout or until the owned
  browser pool shutdown interrupts it.

### C-IMPL-31: BrowserPool Abort Hardening

Pushed abort handling one layer deeper into BrowserPool:

- `openPage` accepts an optional `AbortSignal`
- `capturePage` accepts an optional `AbortSignal`
- `waitForPage` uses an abortable delay instead of Playwright timeout sleep
- `waitForSelector` races selector wait against abort
- `captureAfterIdle` accepts an optional `AbortSignal`
- `sampleFrames` accepts `abortSignal` and checks it between timestamp samples
- frame seek, settle delay, cue read, screenshot, and artifact writes are raced
  against abort where practical
- media capture draining is abortable
- evidence-runner passes the workflow abort signal directly into BrowserPool
- BrowserPool regression test covers aborting a low-level wait

Important caveat:

- this is stronger than workflow-only cancellation, but it is still cooperative.
  Some Playwright internals do not expose native abort handles and are interrupted
  by promise racing plus context/pool cleanup.

### C-IMPL-32: Scheduler Abort Diagnostics

Added job lifecycle timing diagnostics to the local scheduler:

- `startedAt`
- `finishedAt`
- `queueDurationMs`
- `runDurationMs`
- `totalDurationMs`
- `abortLatencyMs`

These fields are returned through `GET /jobs`, `GET /jobs/:id`, cancel
responses, and prune responses because they live on the persisted in-memory job
record. This makes it possible to see whether a canceled job stopped promptly or
waited on a long browser/OCR/API operation before reaching `canceled`.

Tests now cover:

- completed job duration fields
- queued cancellation diagnostics
- running cancellation abort latency over HTTP

### C-IMPL-33: Evidence Workflow Stage Timing

Added per-stage evidence-run timing so slow or canceled jobs can identify the
stage that dominated latency:

- `setup`
- `platform_capability_artifact`
- `browser_acquire_context`
- `browser_open_page`
- `browser_wait`
- `browser_page_capture`
- `frame_wait_for_selector`
- `frame_sampling`
- `dense_frame_sampling`
- `official_api`
- `ocr`
- `assessment_artifact`
- `claims_citations`
- `claim_gate`
- `final_report`

Each stage timing records:

- `stage`
- `startedAt`
- `finishedAt`
- `durationMs`
- `status: ok|error|aborted`
- optional `error`

The timings are returned from `runEvidenceWorkflow`, included in CLI/MCP service
summaries, included in scheduler job result summaries, written into the
assessment object, and rendered in the final markdown report.

The public package export now includes the evidence-runner types through
`src/index.ts`.

## Preserved Pre-v0.3 Plan Snapshot

The following block is preserved verbatim from the user request that defined the
implementation direction before C-IMPL-28:

```text
현재 안 된 것
  가장 중요한 미해결은 이겁니다.

  1. evidence-run은 CLI/service-level workflow만 있고 MCP tool로는 아직 없음.
  2. visual/video claim schema가 아직 충분히 typed하지 않음.
  3. claim-gate가 “visual claim이면 timestamp frame artifact 필수”까지 강제하지 않음.
  4. OCR 없음. 프레임 안의 visible overlay text를 자동 추출하지 못함.
  5. transcript hit 주변 dense sampling 없음.
  6. evidence-run --profile <name> 없음.
  7. evidence-run --headed 없음.
  8. 공식 API client 없음.
      - YouTube Data API
      - Instagram Graph
      - TikTok Display/Research API
  9. Instagram/TikTok 로그인/인터스티셜/봇 차단 robustness 미흡.
  10. remote shared server / production scheduler / npm distribution / GitHub Actions CI 없음.

  다음 개발 우선순위
  내 판단으로는 이 순서가 맞습니다.

  1. evidence-run MCP tool 추가
     지금 CLI로만 되는 핵심 workflow를 agent가 MCP로 직접 호출할 수 있어야 합니다.
  2. typed claim schema 추가
     claim_type: visual | text | metadata | audio | inference, timestampSec, verification_level,
     artifact_id 같은 필드가 필요합니다.
  3. claim-gate 강화
     visual/video claim은 frame screenshot artifact 없으면 실패, transcript claim은 transcript cue
     artifact 없으면 실패, audio claim은 transcription artifact 없으면 실패.
  4. OCR over sampled frames
     영상/이미지에서 visible text를 구조화해야 “화면에서 보임” claim 품질이 올라갑니다.
  5. dense sampling
     transcript/OCR hit 주변을 더 촘촘히 캡처해야 “중요 구간만 정밀 확인”이 됩니다.
  6. profile/headed evidence-run
     로그인 필요한 YouTube/Instagram/TikTok/Trip/Agoda류를 현실적으로 다루려면 --profile, --headed가 필
     요합니다.
  7. official API clients
     단, 명시 credentials가 있을 때만. 없으면 capability map에서 unavailable/credential-required로 남기
     는 현재 원칙 유지.

  한 줄 결론: 지금 0.2.6은 “증거를 보존하고, 가능한 범위와 불가능한 범위를 정직하게 분리하는 local
  BrowserContext farm”까지는 왔습니다. 다음 단계는 “agent가 MCP로 evidence-run 전체를 실행하고, final
  claim gate가 visual/transcript/audio claim을 더 엄격하게 막는 것”입니다.
   한계:

  - 진짜 autonomous crawler는 아님
  - agent가 직접 source 선택, browser state 관리, 복잡한 extractor 작성 필요
  - YouTube는 제목/설명/눈에 보이는 일부만 가능, “영상 내용을 봤다”는 수준 아님
  - map/image는 OCR/vision 없이 스크린샷만 저장하는 수준

  v2.1은 hardening release였습니다. 이걸 해결하기 위해서 어떻게 해야될지 플랜을 생각해봐 $office-hours 진행
```

## OCR Productization Pass

Added a typed OCR metadata layer without making `tesseract.js` a hard package
dependency:

- `EvidenceRunInputSchema.ocr` now includes `language` and `minConfidence`.
- OCR artifacts record source frame `timestampSec`, `language`,
  `minConfidence`, reported confidence, `confidenceMet`, word counts, and
  bounded word bounding boxes.
- Empty OCR output is recorded as `partial` with `ocr.status = empty_text`.
- Low-confidence OCR output is recorded as `partial` with
  `ocr.status = low_confidence`.
- `buildClaims` only treats OCR text as verified when the OCR text artifact has
  `status = ok`, so empty or low-confidence OCR cannot silently become a
  verified OCR claim.
- OCR now records a `no_frames` artifact without initializing a worker when no
  sampled frame screenshots exist.
- Tests use an injected OCR worker so the regression suite can verify OCR
  metadata, source timestamps, confidence, word boxes, cache hits, and
  low-confidence behavior without installing `tesseract.js`.

## OCR-Hit Dense Sampling Pass

Added OCR-hit dense sampling while the browser lease is still open:

- the workflow now runs the first OCR pass before releasing the browser context
- verified OCR metadata with `status = ok` and `timestampSec` can become dense
  sampling hit windows
- `--dense-sampling --ocr` captures extra frames around OCR text hits when OCR
  is enabled and available
- dense OCR-hit frames are passed through OCR again so the run preserves both
  the visual frame evidence and text evidence for the tighter window
- OCR dense sampling is query-aware through the existing dense query option
- duplicate already-sampled timestamps are skipped before the OCR-hit dense pass
- stage timings now include `ocr_hit_dense_frame_sampling` and
  `ocr_dense_sampling` when those passes run
- regression coverage verifies that an injected OCR hit at 10s triggers dense
  sampling around 9s and 11s

## Scene-Change Dense Sampling Pass

Added browser-visible scene-change dense sampling:

- `farm_sample_frames` now records a small visual fingerprint for each sampled
  video frame when canvas reads are available.
- The fingerprint is derived from the browser-rendered video element. It does
  not download or bypass raw platform video streams.
- `detectSceneChangeHits` compares adjacent sampled-frame fingerprints using
  hamming distance and produces midpoint hits for large visual changes.
- `evidence-run --dense-sampling` can now trigger dense windows around
  transcript cue hits, OCR text hits, and scene-change hits.
- CLI options added:
  - `--dense-scene-threshold <1-64>`
  - `--no-dense-scene-change`
- Scene-change dense sampling records the stage
  `scene_change_dense_frame_sampling` when it runs.
- Regression coverage verifies the scene-change midpoint plan and a workflow
  pass that captures additional frames around a browser-visible scene change.

## Official API Integration Harness Pass

Added official API setup and live integration scaffolding:

- `docs/OFFICIAL_API.md` documents YouTube, Instagram, and TikTok credential
  env vars, example commands, and platform-specific caveats.
- `npm run test:official-api` runs `tests/official-api.integration.ts` through
  a separate Vitest config so the live harness stays out of normal `npm test`.
- The live integration harness is opt-in and skips unless
  `FARM_OFFICIAL_API_INTEGRATION=1` is set.
- Each provider test is skipped unless its required provider env vars are also
  present.
- The harness verifies that live metadata is registered as
  `official_api_metadata` and that raw token values are not written to
  `artifacts.jsonl`.
- `collectOfficialApiEvidence` now recursively redacts raw credential values
  from successful API response data and API error messages before writing
  metadata, text artifacts, warnings, and cache entries.
- Unit coverage now verifies redaction for both successful echoed-token
  responses and error artifacts.

## Browser Obstruction Classification Pass

Added browser-visible obstruction classification to evidence-run:

- `src/browser-obstructions.ts` classifies login walls, app-open interstitials,
  bot blocks, region gates, age gates, and unavailable-media pages from
  captured title, final URL, visible body text, and HTML.
- `evidence-run` now runs a `browser_obstruction_classification` stage after
  browser capture and official API collection.
- Detected obstructions are written as structured `browser_obstruction`
  artifacts with the raw classification report preserved as text.
- The run assessment and final markdown report now include obstruction status
  and detection kinds.
- `buildClaims` adds a typed metadata claim for obstruction evidence only when
  an obstruction artifact exists.
- Regression coverage verifies the pure classifier and the full workflow path
  for a browser-visible login wall fixture.

## Browser Overlay Dismissal Pass

Added a cautious pre-capture overlay dismissal pass:

- `BrowserPool.dismissBenignOverlays` can dismiss ordinary browser-visible
  overlays when the visible action is close/dismiss/not-now/no-thanks/maybe
  later/skip/reject/decline/necessary-only.
- The dismissal pass is intentionally conservative. It skips login, sign-in,
  account creation, CAPTCHA/human verification, age gates, payment/checkout,
  accept-all consent, and app-open/download actions.
- `evidence-run` runs `browser_overlay_dismissal` before the page capture stage.
- When a dismissal happens or the pass records a partial failure, the workflow
  writes `browser_overlay_dismissal` artifacts with the structured action log.
- The pass is configurable across CLI/MCP/HTTP input through
  `overlayDismissal.enabled`, `overlayDismissal.maxActions`,
  `--no-overlay-dismissal`, and `--overlay-dismissal-max-actions`.
- The run assessment and final markdown report include overlay dismissal status
  and dismissed/skipped counts.
- CLI and MCP summaries include overlay dismissal and obstruction artifact
  counts.
- Regression coverage verifies that a dismissible newsletter-style overlay is
  removed before evidence page capture while the dismissal action is preserved
  as an artifact.

## Source Strategy Pass

Added generic source strategy planning for non-video platforms:

- `src/source-strategy.ts` classifies URLs into source families such as search,
  map, blog, portal/news, travel booking, video/social, and generic web.
- It recognizes common source platforms including Naver Map, Naver Blog, Naver
  Search, Google Search, Google Maps, Google Travel, Agoda, Trip.com,
  Booking.com, Expedia, YouTube, Instagram, and TikTok.
- `evidence-run` writes a `source_strategy` artifact before browser capture so
  each run preserves the planned evidence model.
- Source strategy is included in the run assessment, final report, CLI summary,
  MCP/service summary, and package exports.
- `docs/SOURCE_STRATEGY.md` records the generic plan for Naver, Google, travel
  booking, and similar portals.
- Regression coverage verifies Naver, Google, travel booking, and generic
  source classification.

## OCR Optional Peer Dependency Pass

Finished the OCR distribution decision:

- `tesseract.js` is declared as an optional peer dependency instead of a bundled
  dependency.
- Normal `npm test` and `npm run verify` do not install or require OCR engine
  assets.
- Added `npm run test:ocr-integration`, backed by `vitest.ocr.config.ts`.
- The OCR integration harness skips unless `FARM_OCR_INTEGRATION=1`; when
  enabled it requires `tesseract.js`, renders a real local screenshot with
  Playwright, and runs the normal OCR pipeline against that screenshot.
- Added `docs/OCR.md` with install steps, evidence semantics, and integration
  harness instructions.

## Dense Sampling Diagnostics Pass

Added typed diagnostics for dense frame sampling:

- `FrameSampleRunResult` can now carry `denseSamplingEvents`.
- Each dense sampling event records the trigger source:
  `transcript_cue`, `ocr_text`, or `scene_change`.
- Events preserve hit timestamps, planned dense timestamps, actually captured
  timestamps, cap/omission metadata, and scene-change distances when applicable.
- The evidence-run assessment includes dense sampling diagnostics, so CLI, MCP,
  HTTP, assessment artifacts, and final reports can explain why extra frames
  were captured.
- Regression coverage verifies OCR-hit dense sampling diagnostics and
  scene-change dense sampling diagnostics.

## Scene-Change Threshold Diagnostics Pass

Added threshold-tuning diagnostics for browser-visible scene changes:

- added `analyzeSceneChanges` in `src/frame-sampler.ts`
- diagnostics now report comparable frame count, ignored frame count,
  comparable pair count, candidate count, selected/omitted hits, observed
  fingerprint distance min/max/average, and nearest below-threshold pair
- scene-change dense sampling events carry the diagnostics, and evidence-run
  frame sampling assessment/final reports surface the latest threshold summary
- focused coverage verifies diagnostics in `tests/frame-sampler.test.ts` and
  `tests/evidence-runner.test.ts`

## Official API Failure Classification Pass

Added local provider-error fixtures without requiring real credentials:

- official API error artifacts now include `failureKind`
- API cache entries preserve the same failure classification
- supported failure kinds are `permission_denied`, `ownership_required`,
  `quota_exceeded`, `rate_limited`, `not_found`, and `unknown`
- unit fixtures cover YouTube quota errors, Instagram ownership/media access
  failures, TikTok permission errors, and TikTok rate-limit failures while
  verifying raw token redaction
- the opt-in live harness still skips unless
  `FARM_OFFICIAL_API_INTEGRATION=1` and provider credentials are set

## OCR Text Profile Pass

Added deterministic OCR text-profile metadata for map and travel-card style
screenshots:

- Added `src/ocr-text-profile.ts`.
- OCR metadata now includes line count, non-whitespace character count, detected
  script families, digit/currency presence, and price-like text detection.
- Script detection covers Latin, Hangul, Hiragana, Katakana, CJK, digits, and
  currency markers.
- Unit fixtures now cover Naver/Map-style Korean text, Japanese station text,
  Agoda/Trip.com-style price text, and numeric non-price overlays.
- The opt-in OCR integration harness now includes an English travel-price
  screenshot and can include a Korean/Japanese map-text screenshot when
  `FARM_OCR_NON_ENGLISH=1` is set.

## Current Verification

Last full verification on version `0.3.0`:

```powershell
npm run verify
```

Passed:

- build
- 22 test files
- 123 tests
- 1 OCR integration file skipped unless enabled
- local smoke
- public web smoke
- media smoke
- proxy smoke
- `npm audit --audit-level=moderate`

Additional v0.3.0 evidence-run sanity check:

```powershell
node .\dist\cli.js evidence-run --url https://example.com/ --no-frames --wait-ms 0 --timeout-ms 10000
```

Passed with:

- final claim gate OK
- 16 artifacts
- 4 claims
- 4 citations

Package dry-run:

```powershell
npm pack --dry-run
```

Passed with package `browser-agent-mcp-farm-0.3.0.tgz`, 116 files, and expected
`dist/`, README, host docs, AGENTS, `docs/OFFICIAL_API.md`,
`docs/OCR.md`, `docs/SOURCE_STRATEGY.md`,
`docs/INFORMATION_SOURCE_TAXONOMY.md`, portal navigation docs, and package
metadata included.

MCP registration from the independent repo:

```powershell
node .\dist\cli.js register-all
```

Passed on 2026-05-26 and updated:

- `C:\Users\이지범\.codex\config.toml`
- `C:\Users\이지범\.claude.json`

Backups:

- `C:\Users\이지범\.codex\config.toml.bak-browser-agent-mcp-farm-20260526014724`
- `C:\Users\이지범\.claude.json.bak-browser-agent-mcp-farm-20260526014724`

## Repository Split

The independent repo was created at:

```text
C:\Users\이지범\Desktop\browser-agent-mcp-farm
```

Process:

- copied source/test/package/docs from the travel workspace package
- excluded `node_modules`, `dist`, `coverage`, and `tmp`
- ran `npm ci`
- ran `npm run verify`
- initialized git
- committed the split-out package

Initial commit:

```text
6af672f Initial browser agent MCP farm
```

## 2026-05-26 Portal-Native Evidence Navigation Plan

The latest office-hours pass clarified that Agoda and Trip.com are examples,
not special product boundaries. The actual product direction is portal-native
evidence navigation:

- Korea: Naver-first research across Search, Blog, Cafe, Map, Place, Image, and
  visible portal modules.
- Global: Chrome/Google-first research across Google Search, Google Maps, and
  destination pages.
- Core media/social: YouTube, Instagram, TikTok, and similar visible media
  surfaces with strict frame/transcript/OCR/obstruction evidence boundaries.
- Generic platforms: reusable query, filter, sort, list, detail, gallery,
  comment, OCR, frame, and follow-up-run patterns.

New docs:

- `docs/PRODUCT_DEVELOPMENT_PLAN.md`
- `docs/PORTAL_NAVIGATION_ARCHITECTURE.md`
- `docs/PORTAL_NAVIGATION_IMPLEMENTATION_GUIDE.md`

Engineering decision:

- Do not jump straight to real-site automation.
- A typed `SourceNavigationPlan` and `source_navigation_plan` evidence artifact
  now exist.
- The navigation plan is threaded through evidence-run assessment and final
  reports.
- Local fixture tests now cover Naver-like, Google-like, travel/commerce,
  video/social, and generic web source families.
- The first Phase 2 execution-state model now exists in
  `src/source-navigation-execution.ts`, covering action caps, timeouts,
  before/after capture flags, omitted-action counts, and unsupported
  non-executable steps.
- The first browser-backed Phase 2 safe executor now exists in
  `src/source-navigation-executor.ts`. It executes only explicit action-key
  recipes, records before/after captures, writes `source_navigation_action`
  artifacts, preserves skipped/unsupported records, and is covered by local
  browser fixtures.
- Every evidence-run now writes a `source_navigation_execution_plan` artifact
  and includes the execution-plan summary in assessment, CLI/MCP/HTTP output,
  and final reports.
- Explicit source navigation recipe input now exists across CLI/MCP/HTTP
  evidence-run paths. When `sourceNavigation.enabled` is true, the workflow
  opens a read-write lease, executes only supplied action-key recipes before
  final page capture, records `source_navigation_action` artifacts, and
  summarizes executed/skipped/unsupported/failed counts.
- Source navigation recipes now support `expectedStates` and `captureScopes`.
  The executor can assert browser-visible selector/text state and capture
  scoped locator evidence such as map viewports, place panels, travel offer
  cards, and rate policy panels. Local fixtures cover success and assertion
  failure behavior.
- Search and travel/commerce plans now include explicit `paginate` actions.
  Local executor fixtures cover Naver-like vertical tabs, filters, sort,
  bounded pagination, blog media galleries, and video/social obstruction
  capture without touching live sites.
- Explicit source navigation recipes now support `operation: "follow_up"`.
  The executor resolves a destination URL from a selector or literal URL
  without clicking through in the parent page, records the typed follow-up
  request, and evidence-run can run bounded one-depth child evidence captures
  under `runDir/followups` with parent `source_navigation_followup` artifacts.

## 2026-05-26 Information Source Coverage Registry Plan

The follow-up office-hours and plan-eng-review pass broadened the product view
from "Naver/Google/Agoda/Trip examples" to a source-category coverage model.

The planned categories are:

- search and AI search
- social feeds and recommendation systems
- communities/forums
- content/media platforms
- news/media
- reviews/reputation
- maps/local
- marketplaces and transaction platforms
- knowledge databases
- messengers/private networks
- AI agents

Engineering decision:

- Add a source coverage registry above `SourceStrategy`.
- Keep `SourceFamily` as the implementation mechanism.
- Use `InformationCategory`, `LocaleSegment`, `SourceRegistryEntry`, support
  tiers, and top-slot ranking metadata to decide what must be covered.
- Require at least three registry slots for important category/locale pairs, or
  an explicit documented exception.
- Treat AI search/agent answers as derivative evidence, not primary proof.
- Treat messenger/private networks as explicit user-visible capture only.
- Add `source_registry` artifacts and CLI inspection before broad real-site
  recipe catalogs.

New doc:

- `docs/INFORMATION_SOURCE_TAXONOMY.md`

This was implemented in the next pass as `src/source-registry.ts`.

## Source Registry Implementation Pass

Implemented the information source coverage registry:

- added `src/source-registry.ts`
- added category values, locale segments, support tiers, evidence roles,
  top-slot metadata, coverage requirements, URL matching, intent matching, and
  registry summaries
- added initial top-slot coverage for Korean/global/Japanese search, AI search,
  social/content, communities, news, reviews, maps/local, marketplace,
  knowledge DB, and messenger/private categories
- extended source platform detection for additional search, portal, social,
  community, news, map, commerce, knowledge, and private-network platforms
- added `source_registry` evidence kind and artifact inference
- threaded registry artifacts through evidence-run assessment/final report,
  CLI output, MCP/FarmService output, and package exports
- added `source-registry` CLI inspection
- added `tests/source-registry.test.ts`

Focused checks passed:

- `npm run build`
- `npm test -- tests/source-registry.test.ts`
- `npm test -- tests/evidence-runner.test.ts`
- `node .\dist\cli.js source-registry --category search --locale ko-KR`
- `npm run verify`
- `npm pack --dry-run`

## Google-Like SERP Fixture Expansion Pass

Expanded local safe-executor fixture coverage after the registry pass:

- added a Google-like SERP fixture to `tests/source-navigation-executor.test.ts`
- covered query state, image vertical tab, tools/filter panel, sort state,
  bounded more-results expansion, result-card scoped capture, gallery scoped
  capture, and explicit destination follow-up extraction
- kept the parent page from navigating during follow-up extraction
- verified with `npm test -- tests/source-navigation-executor.test.ts`

## Platform Fixture Expansion Pass

Continued the registry-prioritized fixture batch:

- added local Google map/news/ad module scopes to
  `tests/source-navigation-executor.test.ts`
- added Naver Cafe public article/comment/gallery capture plus explicit
  member-wall obstruction capture without bypass
- added KakaoMap viewport, place list, selected place detail, and review panel
  scoped captures
- added richer travel room/rate-card variants covering filters, sort, bounded
  scroll, more-rates pagination, rate terms, price-card OCR targets, and
  unsupported booking/payment/account actions
- verified the focused executor suite with
  `npm test -- tests/source-navigation-executor.test.ts` passing 14 tests

## OCR Text Profile Tuning Pass

Tuned OCR deterministic diagnostics before live engine calibration:

- changed `hasPriceLikeText` so currency and amount must appear together as a
  price-like token instead of independently anywhere in the OCR text
- added unit coverage for separated currency/route numbers, Korean won prices,
  and Japanese yen prices
- added an `empty_text` OCR failure-mode test that records partial text output
  plus an empty text profile
- verified with `npm test -- tests/ocr-text-profile.test.ts` and
  `npm test -- tests/ocr.test.ts`

## Source Navigation Recipe Candidate Plan Pass

Added a manual-only bridge from local fixture coverage to real-site selector
calibration:

- added `src/source-navigation-recipes.ts`
- added `source_navigation_recipe_plan` evidence artifacts to evidence-run
- added CLI inspection with `source-navigation-recipes --url <url>`
- exposed recipe-plan summaries through CLI/MCP/FarmService workflow output
- covered search, map, blog/forum, portal/news, travel/commerce, video/social,
  and generic web source families
- marked local fixture candidates as `fixture_verified` and real-site selector
  ideas as `candidate_unverified`
- kept execution policy as `manual_opt_in_only` so candidates cannot silently
  become live-site automation
- verified with `npm test -- tests/source-navigation-recipes.test.ts`,
  `npm test -- tests/evidence-runner.test.ts`, `npm run build`, and
  `npm run verify`

## Source Navigation Read-Only Calibration Pass

Started real-site selector calibration without adding live-site automation:

- added `src/source-navigation-calibration.ts`
- added `BrowserPool.inspectSelector` for read-only selector probes
- added `source_navigation_calibration` evidence artifacts
- added `source-navigation-calibrate --url <url>`
- added evidence-run integration through `sourceNavigation.calibrate`,
  `sourceNavigation.calibrationSelectorTimeoutMs`,
  `--source-navigation-calibrate`, and
  `--source-navigation-calibration-timeout-ms`
- calibration opens a page read-only, captures the page, then probes manual-only
  recipe selector and capture-scope candidates for match count, visible count,
  snippets, expected text signals, and blocked text signals
- calibration does not click, fill, scroll, paginate, follow links, dismiss
  gates, or mutate account/platform state
- added `tests/source-navigation-calibration.test.ts` covering Google-like
  selector visibility, calibration artifact writing, and TikTok-like blocked
  signal detection
- added workflow coverage showing calibration runs inside evidence-run while
  the source navigation plan remains `plan_only`
- smoke-checked the standalone CLI and evidence-run CLI against
  `https://example.com/`

## Source Navigation Recipe Catalog Proposal Pass

Added the first promotion-control layer between calibration and execution:

- added `src/source-navigation-recipe-catalog.ts`
- added `source-navigation-catalog --url <url> [--calibration-file <path>]`
- catalog entries classify readiness as `calibration_required`,
  `single_run_ready`, `manual_review_required`, `manual_value_required`,
  `blocked_signal_detected`, or `not_supported`
- read-only capture/follow-up/wait/scroll actions can produce recommended
  explicit recipe snippets after calibration
- click actions remain manual-review and fill/select/press actions remain
  manual-value, even when selectors match
- blocked signals prevent proposal promotion
- `maintainedDefaultReadyCount` remains `0` until repeated calibration and
  provider-specific fixtures exist
- added `tests/source-navigation-recipe-catalog.test.ts`
- smoke-checked `source-navigation-catalog` against a Google Search URL

## Source Navigation Repeated Calibration Gate Pass

Extended catalog proposals so repeated calibration can be evaluated before
provider recipe promotion:

- `source-navigation-catalog` now accepts `--calibration-files <a,b>`
- catalog input supports multiple calibration reports
- stable selector and capture-scope matching is counted across calibration runs
- read-only capture/follow-up/wait actions can become `maintained_recipe_ready`
  only when the same selector or capture scope is observed across the minimum
  repeated calibration runs and fixture coverage exists
- click actions remain `manual_review_required`
- fill/select/press actions remain `manual_value_required`
- blocked signals still prevent promotion
- focused catalog tests now cover repeated maintained readiness

## Source Navigation Maintained Recipe Export Pass

Added the final safe handoff from repeated calibration proposals to explicit
recipe JSON:

- added `exportMaintainedSourceNavigationRecipes`
- added `source-navigation-export-recipes --url <url>
  [--calibration-file <path> | --calibration-files <a,b>]`
- exports only entries with `readiness = maintained_recipe_ready` and a
  recommended read-only action
- omits every non-ready entry with readiness and reason diagnostics
- intentionally omits click, fill, select, press, login, payment, booking,
  CAPTCHA, gate-bypass, and account-changing actions
- focused catalog tests now verify ready and empty export bundles

## Source Navigation Calibration Run Directory Loader Pass

Removed the manual raw-path handoff between calibration and catalog/export:

- added `src/source-navigation-calibration-loader.ts`
- added parsing for direct calibration report JSON and wrapped
  `sourceNavigationCalibration` metadata JSON
- added evidence run directory loading through `--calibration-run-dir` and
  `--calibration-run-dirs`
- run directory loading reads `artifacts.jsonl` for
  `source_navigation_calibration` artifact records first
- when the ledger is missing, loading falls back to
  `raw/*source-navigation-calibration*.txt` and matching structured metadata
  files
- `source-navigation-catalog` and `source-navigation-export-recipes` now share
  the loader and report loaded source/warning metadata in CLI output
- added unit coverage for direct files, wrapped metadata, manifest loading,
  fallback discovery, and invalid JSON rejection
- smoke-checked a real `source-navigation-calibrate` run directory with both
  catalog and maintained recipe export commands

## Source Navigation Catalog Compatibility Gate Pass

Added a safety check before repeated calibration can promote recipe entries:

- catalog generation now filters calibration reports by exact `platform` and
  `sourceFamily` match with the current recipe plan
- incompatible reports are skipped with warnings and counted in the catalog
  summary
- this prevents Naver, Google, travel, SNS, and generic calibration run
  directories from accidentally cross-promoting selectors with the same action
  key
- focused catalog tests now cover incompatible report filtering

## Source Navigation Calibration Batch Pass

Added the first repeatable real-site calibration loop:

- added `src/source-navigation-calibration-batch.ts`
- added `source-navigation-calibrate-batch --urls-file <path>
  [--run-root <path>] [--repeat <n>]`
- target files can be line-based, `id url` line-based, JSON arrays, or
  `{ "targets": [...] }`
- each target/repeat attempt writes its own read-only calibration run directory
- the batch writes `calibration-batch-manifest.json` incrementally so partial
  results survive later failures
- manifest output records succeeded/failed attempts, artifact paths, per-run
  calibration summaries, and grouped catalog/export command hints using
  `--calibration-run-dirs`
- single-target calibration now reuses the same internal runner as batch mode
- focused tests cover target parsing, duplicate IDs, repeat expansion,
  manifest summaries, catalog hints, and non-web URL rejection
- CLI smoke checked a one-target batch against `https://example.com/`

## Source Navigation Calibration Target Generator Pass

Added the handoff from the source registry to batch calibration:

- added `src/source-navigation-calibration-targets.ts`
- added `source-navigation-calibration-targets [--category <name>]
  [--locale <segment>] [--platform <id>] [--family <name>] [--query <text>]
  [--limit <n>] [--format json|lines]`
- target generation uses registry filters and platform URL templates for search,
  maps, blogs/forums, news, video/social, travel, commerce, and knowledge
  sources
- category/locale target output is ordered by local top-slot rank before support
  tier, so Korean search starts with Naver, Google, and Daum before lower-ranked
  fallback slots
- private messenger/user-controlled entries and derivative AI answer/search
  entries are skipped from unattended batch target plans
- `--format lines` writes `id url` lines directly consumable by
  `source-navigation-calibrate-batch --urls-file`
- focused tests cover top-slot ordering, map/travel URL platform detection,
  skip policy, and line formatting
- CLI smoke checked Korean search line output and travel target JSON output

## Source Navigation Batch Manifest Loader Pass

Removed the copy/paste step between batch calibration and catalog/export:

- `loadSourceNavigationCalibrationReports` now accepts
  `batchManifests`
- `source-navigation-catalog` and `source-navigation-export-recipes` now accept
  `--calibration-batch-manifest <path>` and
  `--calibration-batch-manifests <a,b>`
- succeeded attempts in a `source-navigation-calibrate-batch` manifest are
  loaded as run directories
- failed or non-succeeded attempts are preserved as warnings instead of being
  silently ignored
- `source-navigation-calibrate-batch` now stores an absolute run root, so
  manifest run directories can be consumed reliably later
- focused loader tests cover batch manifest ingestion with two succeeded runs
  and one failed attempt
- CLI smoke checked `calibrate-batch -> catalog --calibration-batch-manifest`
  and `calibrate-batch -> export --calibration-batch-manifest`

## Source Navigation Maintained Actions File Output Pass

Removed the final copy/paste step between maintained recipe export and
evidence-run execution:

- `source-navigation-export-recipes --actions-output-file <path>` writes only
  the maintained action array, matching the format accepted by
  `evidence-run --source-navigation-actions-file`
- `--export-output-file <path>` writes the full maintained recipe export bundle
  for audit
- `--fail-empty-export` exits non-zero and returns `ok: false` when no
  maintained actions are ready, preventing automation from silently continuing
  with an empty action file
- CLI smoke checked empty action file writing, full bundle writing, and
  fail-empty behavior

## Source Navigation Batch Promotion Pass

Added a grouped promotion workflow on top of calibration batch manifests:

- added `src/source-navigation-promotion.ts`
- added `source-navigation-promote-batch --calibration-batch-manifest <path>
  [--output-dir <path>]`
- the command iterates every platform/source-family group in the batch
  manifest's catalog hints
- each group gets `catalog.json`, `export.json`, and `actions.json`
- `promotion-summary.json` records group status, action counts, output files,
  and warnings
- generated `actions.json` files are ready for
  `evidence-run --source-navigation-actions-file`
- `--fail-empty-export` can fail automation if any group produces no maintained
  actions
- focused tests cover grouped promotion and action-file generation
- CLI smoke checked `calibrate-batch -> promote-batch`

## Source Navigation Promotion Review Pass

Closed the inspection gap between batch promotion output and evidence-run
execution:

- added promotion summary parsing and review helpers in
  `src/source-navigation-promotion.ts`
- added `source-navigation-promotion-review --promotion-summary <path>` and
  `--promotion-dir <path>`
- review output classifies groups as `ready`, `blocked`,
  `needs_repeated_calibration`, `manual_review_required`, or `empty`
- ready groups now include exact `evidence-run --source-navigation-actions-file`
  argv and PowerShell commands
- `--format commands` prints only runnable evidence-run commands
- `--fail-no-ready` exits non-zero when a promotion summary has no usable
  action files
- focused tests cover review classification and command generation

## Source Coverage Readiness Audit Pass

Added a QA/QC layer that connects the information-source registry to promoted
recipe outputs:

- added `src/source-coverage-readiness.ts`
- added `source-coverage-readiness --category <name> --locale <segment>`
- category/locale audits default to the local top-three planning slots unless
  `--top-rank <n>` is supplied
- audits can load promotion results from `--promotion-summary`,
  `--promotion-summaries`, `--promotion-dir`, or `--promotion-dirs`
- each registry slot is classified as `ready`, `blocked`,
  `needs_repeated_calibration`, `manual_review_required`, `promoted_empty`,
  `not_promoted`, `skipped_derivative`, `skipped_private`, or `planning_only`
- `--format targets` prints calibration target lines for actionable not-ready
  slots, so the next `source-navigation-calibrate-batch` input can be generated
  from the readiness audit
- `--fail-not-ready` exits non-zero when any actionable slot is not ready
- focused tests cover Korean search top-slot readiness, target-line output,
  derivative AI search skips, and private-network skips

## Source Coverage Calibration Loop Pass

Added the next handoff layer for real-site calibration:

- added `src/source-coverage-calibration-loop.ts`
- added `source-coverage-calibrate --category <name> --locale <segment>`
- the command writes `coverage-readiness-before.json`,
  `calibration-targets.txt`, `coverage-calibration-plan.json`, and
  `coverage-calibration-report.md` under the selected run root
- `--plan-only` / `--dry-run` stops after the planning files and does not open
  browsers
- without plan-only, the command runs read-only source-navigation calibration
  over actionable not-ready targets, writes `calibration-batch-manifest.json`,
  promotes the batch, writes `promotion-review.json`, and writes
  `coverage-readiness-after.json`
- the Markdown report summarizes readiness counts, target lines, generated
  files, recommended commands, promotion counts, and warnings
- promoted actions still remain explicit opt-in; the loop does not execute
  source-navigation actions against live platforms
- focused tests cover readiness-guided loop plans and derivative-category
  no-target behavior
- CLI smoke checked the plan-only Korean search top-slot loop

## Commerce Navigation Fixture Pass

Added commerce-specific portal navigation coverage:

- `src/source-navigation.ts` now has a dedicated `commerce` template instead of
  falling back to generic web planning
- commerce plans track query, currency, filters, sort, seller, shipping/fee
  visibility, product cards, seller context, shipping terms, and price terms
- cart, purchase/checkout, and account-changing actions are explicit
  unsupported actions
- `src/source-navigation-recipes.ts` now proposes manual-only commerce selector
  candidates for product-card, seller/return, shipping, and price-badge capture
- local executor fixtures cover a marketplace product card, bounded product
  list expansion, seller/return terms, shipping panel, and price-badge scoped
  captures without submitting cart or checkout actions
- focused checks passed:
  `npx vitest run tests/source-navigation.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  with 27 tests passing

## Video/Social Visible State Fixture Pass

Added non-login-visible SNS/video fixture coverage:

- `src/source-navigation-recipes.ts` now includes fixture-backed selectors and
  capture scopes for visible post metadata, browser-visible frame regions, and
  overlay text
- added `overlay-ocr` to the video/social recipe candidates so the recipe plan
  matches the existing `SourceNavigationPlan` action
- local executor fixtures now cover a public Instagram/TikTok-like post shell
  with obstruction-state, creator/profile metadata, caption, engagement text,
  a browser-visible frame region, and overlay text
- raw stream download, gate bypass, and social writes remain unsupported action
  records
- focused checks passed:
  `npx vitest run tests/source-navigation.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-calibration.test.ts`
  with 36 tests passing after one transient generic fixture file check passed
  on rerun

## Google Maps Selected Place Fixture Pass

Added Google Maps selected-place fixture coverage:

- `src/source-navigation-recipes.ts` now includes Google Maps fixture-backed
  selectors and capture scopes for map query, open-now filters, map viewport,
  place list, selected place sheet, review list, photo strip, and map-label OCR
  targets
- local executor fixtures now cover selecting a Google Maps-like place row and
  preserving the selected place sheet, address/hours/rating context, visible
  review snippet, photo strip, and map label
- route, call, reservation, booking, and other mutating place actions remain
  outside the explicit recipe and are not clicked
- focused checks passed:
  `npx vitest run tests/source-navigation.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  with 29 tests passing

## Naver/Daum News Portal Fixture Pass

Added portal/news navigation and fixture coverage:

- `src/source-navigation.ts` now has a dedicated `portal` navigation template
  for news-like source families instead of falling back to generic web planning
- portal/news plans now track query/topic, locale, section, publisher,
  visible timestamp, recency/sort state, headline modules, publisher context,
  destination article follow-up, and obstruction state
- paywall/login/subscription bypass, comment/reaction/write actions, and
  unbounded feed crawling are explicit unsupported actions
- `src/source-navigation-recipes.ts` now proposes manual-only fixture-backed
  recipe candidates for Naver News and Daum News query, section, latest filter,
  bounded pagination, article module capture, publisher follow-up, and
  obstruction-state capture
- local executor fixtures cover Naver and Daum news modules, publisher metadata,
  bounded second-page headline expansion, follow-up URL extraction, and
  no-paywall/no-login obstruction-state preservation
- focused checks passed:
  `npx vitest run tests/source-navigation.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  with 32 tests passing

## Naver/Daum News Real-Site Calibration Pass

Ran the first repeated read-only real-site calibration for
`news_media` / `ko-KR` top slots:

- deprecated Naver News and Daum News search seed URLs returned live 404 pages,
  so calibration targets now use
  `https://search.naver.com/search.naver?where=news&query=...` and
  `https://search.daum.net/search?w=news&q=...`
- source strategy detection now recognizes those current Naver/Daum news search
  URLs as `naver_news` and `daum_news`
- portal blocked-signal matching was tightened so generic visible "login" or
  "subscribe" words do not falsely mark ordinary result pages as blocked
- Daum destination follow-up selectors were narrowed to `v.daum.net` article
  links, preventing related-search or privacy links from being promoted
- repeated calibration promoted read-only article capture, destination
  follow-up, and obstruction-check action files for Naver News and Daum News
- real evidence-run checks with the promoted action files completed one-depth
  follow-up runs to `n.news.naver.com` and `v.daum.net`
- long source-navigation scoped capture IDs now use compact hashed fallbacks
  when the artifact filename limit would otherwise truncate distinct captures
  to the same path
- focused checks passed:
  `npx vitest run tests/source-navigation-executor.test.ts tests/source-navigation-calibration-targets.test.ts tests/source-navigation-recipes.test.ts`
  with 29 tests passing, and `npm run build` passed

## Korean Search Real-Site Calibration Pass

Ran the first repeated read-only real-site calibration for
`search` / `ko-KR` top slots:

- Naver Search promoted a stable read-only result-scope capture over
  `#main_pack`
- Daum Search now has provider fixture coverage and real-site result-scope
  candidates for `#mArticle`, `#cMain`, and `#daumContent`; repeated
  calibration promoted a maintained read-only result-scope capture action
- Google Search showed a browser-visible unusual-traffic / not-a-robot page on
  the current network, so search recipes now classify those bot-check texts as
  blocked signals instead of treating the run as merely missing selectors
- the recipe catalog no longer proposes a scoped capture action when
  calibration found no visible capture scope, preventing empty full-page capture
  recipes from being counted as ready for scoped evidence
- explicit evidence-run checks with the promoted Naver and Daum Search action
  files passed final claim gates
- focused checks passed:
  `npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-executor.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts`
  with 40 tests passing, and `npm run build` passed

## Korean Maps/Local Real-Site Calibration Pass

Ran the first repeated read-only real-site calibration for
`map_local` / `ko-KR` top slots:

- the registry-backed target loop covered Naver Map, KakaoMap, and Google Maps
  for the Korean query `성수 카페`
- map recipe candidates now include real-site browser shell scopes for Naver
  Map `#root`, KakaoMap `#view\\.mapContainer` / `#view\\.map` / `#view`, and
  Google Maps `.lbMcOd` / `.UL7Qtf`
- repeated calibration promoted maintained read-only `map-viewport` and
  `map-ocr` capture actions for all three map platforms
- explicit evidence-run checks with the promoted Naver Map, KakaoMap, and
  Google Maps action files passed final claim gates
- focused checks passed:
  `npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts`
  with 21 tests passing, and `npm run build` passed

## Korean Content/Blog Real-Site Calibration Pass

Ran the first repeated read-only real-site calibration for
`content_media` / `ko-KR` rank 1:

- added Korean content/media registry slots for Naver Blog, YouTube, and
  Instagram
- fixed the Naver Blog calibration target to
  `https://section.blog.naver.com/Search/Post.naver?keyword=...`
- source strategy detection now recognizes `section.blog.naver.com` as
  `naver_blog`
- blog/forum blocked-signal matching was tightened so ordinary visible Naver
  header login/join links do not falsely classify public Blog search pages as
  blocked
- specific private/member/access-right phrases still classify Blog/Cafe member
  walls as blocked
- repeated calibration promoted maintained read-only content/page-shell capture
  and obstruction-check action files for Naver Blog
- an explicit evidence-run with the promoted Naver Blog action file passed the
  final claim gate with 168 artifacts, 5 claims, and 5 citations
- `content_media` / `ko-KR` top-three readiness is now 1 of 3: Naver Blog is
  ready, while YouTube and Instagram remain not-promoted
- focused checks passed:
  `npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts tests/source-registry.test.ts tests/source-navigation-calibration-targets.test.ts tests/source-strategy.test.ts`
  with 31 tests passing, and `npm run build` passed

## Korean Content/YouTube Real-Site Calibration Pass

Continued the `content_media` / `ko-KR` top-three calibration after Naver Blog:

- discovered that YouTube's live DOM can expose `#overlay-text`, which was
  previously labeled only as a local fixture selector
- fixed catalog promotion so fixture-scoped selectors are never exported as
  maintained real-site actions unless a promotable real-site selector is
  repeatedly observed
- stable selector grouping now includes selector source, preventing
  local-fixture and real-site candidates with the same CSS selector from being
  collapsed into one promotion key
- fixed promotion review so blocked browser-visible signals take precedence
  over exported generic read-only capture actions
- added YouTube real-site candidate scopes for search-result metadata and
  thumbnail overlay evidence: `ytd-video-renderer`, `ytd-rich-item-renderer`,
  `#video-title`, `#contents`, `ytd-thumbnail`,
  `ytd-thumbnail-overlay-time-status-renderer`, and `#overlay-text`
- repeated calibration promoted maintained read-only visible-metadata and
  overlay capture actions for YouTube search results
- Instagram hashtag exploration was classified as blocked because the
  unauthenticated browser saw visible login-wall signals
- an explicit evidence-run with the promoted YouTube action file passed the
  final claim gate with 184 artifacts, 5 claims, and 5 citations
- `content_media` / `ko-KR` top-three readiness is now: Naver Blog ready,
  YouTube ready, Instagram blocked
- focused checks passed:
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-navigation-recipes.test.ts tests/source-coverage-readiness.test.ts`
  with 20 tests passing, and `npm run build` passed

## Korean Community/Forum Real-Site Calibration Pass

Ran the first repeated read-only real-site calibration for
`community_forum` / `ko-KR` top slots:

- Naver Cafe search promoted maintained read-only page-shell/content-surface
  capture plus obstruction-check action files for explicit opt-in evidence-run
  use.
- An explicit Naver Cafe evidence-run with the promoted action file passed the
  final claim gate with 127 artifacts, 4 claims, and 4 citations.
- tightened browser obstruction classification so a stray `robot` token in a
  normal document shell does not become a high-confidence bot-block. Specific
  challenge phrases such as `not a robot`, unusual traffic, CAPTCHA, browser
  checks, and verify-human text are still detected.
- added fixture-backed community portal recipe candidates for DCInside and
  Naver Knowledge iN, covering community query state, section/filter/
  pagination state, thread/question module capture, destination follow-up, and
  obstruction-state capture.
- re-ran the `community_forum` / `ko-KR` top-three calibration loop. Naver
  Cafe, DCInside, and Naver Knowledge iN are now all ready with maintained
  explicit read-only action files.
- explicit DCInside and Naver Knowledge iN evidence-runs with promoted action
  files both passed final claim gates and completed one-depth follow-up runs to
  browser-visible destination pages.
- focused checks passed:
  `npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-coverage-readiness.test.ts`
  with 39 tests passing, `npx vitest run tests/browser-obstructions.test.ts`
  with 5 tests passing, and `npm run build` passed.

## Korean Marketplace/Commerce Blocked-State Calibration Pass

Continued the registry-prioritized calibration sequence with
`marketplace_transaction` / `ko-KR` top slots:

- added provider-specific commerce read-only capture candidates for Coupang,
  Naver Shopping, and Gmarket product-list/product-card/price surfaces while
  keeping cart, purchase, checkout, and account-changing actions unsupported
- added Korean commerce access and bot-check signals to both browser
  obstruction classification and commerce recipe calibration, including Naver
  Shopping temporary access restriction text and Gmarket simple bot-check text
- re-ran repeated read-only calibration for Coupang, Naver Shopping, and
  Gmarket with the query `무선 이어폰`
- all three platforms are currently classified as browser-visible blocked on
  this unattended local network, so no maintained commerce action file was
  exported
- explicit Naver Shopping and Gmarket evidence-runs on those blocked pages
  preserved `browser_obstruction` artifacts and passed final claim gates
- focused checks passed:
  `npx vitest run tests/browser-obstructions.test.ts tests/source-navigation-recipes.test.ts`
  with 14 tests passing, `npx vitest run tests/source-navigation-calibration.test.ts tests/browser-obstructions.test.ts tests/source-navigation-recipes.test.ts`
  with 21 tests passing after adding the calibration-layer commerce blocked
  fixture, the broader focused source-navigation/readiness suite with 33 tests
  passing, and `npm run build` passed.

## X/Twitter Video/Social Fixture Pass

Continued the SNS/video-social fixture expansion:

- promoted `x_twitter` from generic video/social planning to fixture-backed
  manual-only recipe candidates
- added X/Twitter public post selectors for visible metadata, author/handle,
  timestamp, post text, thread context, media frame, overlay text, and
  obstruction-state capture
- added safe executor fixture coverage for a public X/Twitter post surface,
  preserving post metadata, visible thread context, media frame, and overlay
  text without clicking like/repost/reply/share, opening DMs, bypassing gates,
  or downloading raw media streams
- verified `source-navigation-recipes --url https://x.com/example/status/1234567890`
  returns fixture-verified X/Twitter recipe candidates
- focused checks passed:
  `npx vitest run tests/source-navigation.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  with 39 tests passing, and `npm run build` passed.

## Global Travel Booking Recipe Pass

Continued the registry-prioritized travel/commerce tuning sequence:

- added provider-specific global travel booking selector candidates for
  Booking.com, Agoda, Trip.com, and Expedia
- travel recipes now cover query-state, visible filters, visible sort, bounded
  result-scroll, bounded result-pagination, offer-detail, and price/OCR
  candidate scopes
- added global travel security/access challenge signals to browser obstruction
  classification and read-only calibration, including access-denied,
  security-check, cookie-required, interruption, CAPTCHA, and login-required
  pages
- deduplicated recipe selector and capture-scope candidates so provider-specific
  candidates can be merged with generic family fallbacks without noisy catalog
  output
- verified `source-navigation-recipes` for Booking.com and Expedia returns
  fixture-verified 7-action travel booking plans with provider-specific
  selectors
- focused checks passed:
  `npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts tests/browser-obstructions.test.ts`
  with 24 tests passing, and `npm run build` passed.

## Global Marketplace/Travel Calibration Pass

Ran the first repeated read-only real-site calibration for
`marketplace_transaction` / `global` top slots:

- updated travel calibration target generation so Booking.com, Agoda, Trip.com,
  and Expedia seed URLs include a future one-night stay window, adults, rooms,
  and currency where supported
- re-ran the global top-four calibration loop for Amazon, Booking.com, Agoda,
  and Trip.com with the query `Tokyo hotel`
- Amazon promoted maintained read-only `product-card` and `price-ocr` scoped
  capture actions, and an explicit evidence-run with those actions passed the
  final claim gate
- Trip.com promoted a maintained read-only `price-ocr` scoped capture action,
  and an explicit evidence-run with that action passed the final claim gate
- Booking.com and Agoda were reachable and not blocked, but the current
  browser-visible pages still did not expose stable result-card or price scopes
  for maintained export
- focused checks passed:
  `npx vitest run tests/source-navigation-calibration-targets.test.ts` with 7
  tests passing, the global coverage calibration loop completed successfully,
  and both ready generated action files passed explicit evidence-run claim
  gates.

## Global Travel Offer-Card Promotion Pass

Continued the global marketplace/travel calibration path after the first
Booking.com and Agoda runs stayed short of maintained export:

- added provider-specific Tokyo target hints for travel calibration:
  Booking.com now adds `dest_id=-246227&dest_type=city`, and Agoda uses the
  Tokyo city page when the calibration seed is a Tokyo travel query
- added a travel `offer-card` planned action and manual-only recipe candidate
  so stable read-only list/card scopes can be promoted independently from
  price/OCR scopes
- constrained travel `price-ocr` promotion to price-specific scopes instead of
  generic list cards, so a hotel card without visible price text does not
  become price evidence
- added Agoda city-page selectors for geo carousel/base-card offer evidence
- narrowed obstruction classification so generic/travel pages are not falsely
  marked blocked by hidden HTML login strings, footer app prompts, or weak
  generic "could not load" text
- re-ran `marketplace_transaction` / `global` top-four calibration for Amazon,
  Booking.com, Agoda, and Trip.com; all four now have maintained read-only
  action files
- explicit Booking.com and Agoda evidence-runs with the promoted offer-card
  action files passed final claim gates with no browser obstruction artifacts
- focused verification passed:
  `npx vitest run tests/browser-obstructions.test.ts tests/source-navigation.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-calibration-targets.test.ts tests/source-navigation-recipe-catalog.test.ts`
  with 41 tests passing, plus `npm run build`

## Expedia Blocked-State Calibration Pass

Followed up on the remaining Expedia travel calibration path:

- ran `source-coverage-calibrate --platform expedia --query "Tokyo hotel"`
  with two repeated read-only attempts
- observed that the current unattended browser lands on Expedia's visible
  "Bot or Not?" / "Show us your human side" human-or-bot challenge page
- added those challenge phrases to browser obstruction classification and
  travel recipe blocked signals
- reran the Expedia platform calibration; both attempts succeeded as captured
  evidence, all 8 travel actions were classified as blocked, promotion review
  marked the Expedia group `blocked`, and no maintained action file was
  exported
- verified a direct Expedia evidence-run preserves `browser_obstruction`
  artifacts and passes the final claim gate
- focused verification passed:
  `npx vitest run tests/browser-obstructions.test.ts tests/source-navigation-calibration.test.ts tests/source-navigation-recipes.test.ts`
  with 27 tests passing, plus `npm run build`

## Profile/Headed Calibration Runtime Handoff Pass

Prepared the blocked-platform retry path for Expedia, Korean commerce, Google
Search, and social platforms:

- added a typed calibration runtime to coverage loop plans and calibration
  batch manifests: headless/headed mode, storage policy, and optional profile
  name
- `source-coverage-calibrate --plan-only --headed --profile <name>
  --persistent-profile` now writes a reproducible `calibrateBatch` command
  containing those runtime flags
- `source-navigation-promote-batch` preserves the runtime on promotion groups
- `source-navigation-promotion-review` carries the runtime into ready
  evidence-run argv and PowerShell commands, so promoted actions can be run
  under the same profile/headed assumptions used during calibration
- focused verification passed:
  `npx vitest run tests/source-navigation-calibration-batch.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-calibration-loop.test.ts`
  with 9 tests passing
- CLI smoke checked plan-only Expedia handoff:
  `source-coverage-calibrate --platform expedia --query "Tokyo hotel"
  --plan-only --headed --profile expedia-login --persistent-profile`
  generated a batch command with `--headed --profile 'expedia-login'
  --persistent-profile`

## What To Do Next

Recommended next implementation sequence:

1. Continue real-site selector calibration and provider-specific fixture
   variants. Manual-only recipe candidates, read-only calibration,
   explicit-opt-in catalog proposals, repeated-calibration promotion gates,
   maintained read-only recipe export, and run-directory calibration loading now
   exist. Maintained provider recipe catalogs still need richer community/forum
   destination article/thread variants, Instagram/TikTok content-media,
   X/Twitter real-site calibration, broader Google Search query/result-card
   variants,
   profile/headed commerce, travel, and SNS calibration runs. Naver-like
   tabs, Google-like
   filters/result cards/
   gallery, Google map/news/ad modules, Google Maps selected-place
   sheets/reviews/photos/map labels, Naver/Daum news modules, Naver Cafe
   public/member states, KakaoMap panels, pagination, media galleries,
   video/social obstruction, map panels, travel list/detail panels, richer
   room/rate cards, commerce
   product/seller/shipping/price scopes, video/social public metadata/thread/
   frame/overlay scopes, and one-depth destination follow-up have first local
   coverage. Naver/Daum News, Naver/Daum Search, Naver/Kakao/Google Maps,
   Naver Blog, YouTube search, Naver Cafe search, DCInside search, and Naver
   Knowledge iN search have first repeated read-only real-site baselines;
   Instagram is currently blocked by visible login-wall signals. Coupang, Naver
   Shopping, and Gmarket are currently blocked by visible access-denied or
   bot-check signals in the unattended local browser. Booking.com, Agoda,
   Trip.com, and Expedia now have provider-specific travel booking candidate
   scopes and blocked-signal handling. Amazon, Booking.com, Agoda, and Trip.com
   have first repeated global marketplace/travel read-only baselines that pass
   explicit evidence-run claim gates. Booking.com and Agoda are currently
   offer-card baselines; Trip.com also has maintained price/OCR evidence.
   Expedia is currently classified as blocked by a visible human/bot challenge
   in unattended runs, so profile/headed calibration is the next Expedia path.
2. Expand live OCR accuracy coverage with `tesseract.js` screenshots for maps,
   travel price cards, Korean/Japanese visible text, and engine failure modes.
3. Tune scene-change dense sampling thresholds on real media fixtures using the
   new threshold diagnostics.
4. Run real-account official API integration checks; local provider failure
   fixtures now cover permission, ownership, quota, and rate-limit
   classification.
5. Tune source strategies and navigation action templates on richer community/
   forum destination pages, TikTok with profile/headed state where appropriate,
   broader Google Search result-card variants, richer travel room/rate detail
   and price-scope tuning, and profile/headed Expedia calibration.
6. Add real screenshot OCR fixture coverage with the selected OCR distribution
   path; current regression tests use an injected worker to avoid a hard
   dependency.
7. Design production remote shared server mode only after auth, tenancy,
   concurrency, and artifact retention are specified.
8. Publish npm distribution after package metadata, docs, and CI settle.
9. Re-run `node .\dist\cli.js register-all` only after moving the repo or
   rebuilding agent host config from scratch.

## Known Limits

- Raw YouTube/Instagram/TikTok video download is intentionally unsupported.
- Caption body access is platform/credential/rights-gated.
- TikTok/Instagram browser visibility can be affected by login, region, app
  interstitials, and anti-automation. The workflow now records likely
  browser-visible obstructions and can dismiss cautious ordinary overlays, but
  real-site popup handling still needs tuning.
- Frame sampling verifies only sampled timestamps, not unseen intervals.
- OCR is optional through peer dependency `tesseract.js`; source timestamp,
  language, confidence, empty-text, and word-box metadata are typed, but real
  OCR accuracy still depends on the installed engine and language data.
- Dense sampling follows transcript, OCR text, and scene-change hits. The
  scene-change threshold still needs real media tuning.
- Source strategy, typed portal-native navigation plans, execution-plan
  artifacts, explicit-recipe executor, and CLI/MCP/HTTP recipe input exist.
  Manual-only recipe candidate plans and read-only selector calibration also
  exist, plus an explicit-opt-in catalog proposal layer and repeated-calibration
  promotion gate. Maintained real platform recipe catalogs, richer Google/
  gallery fixtures, map viewport tuning, and repeated real-site destination
  selector calibration are still incomplete.
- The information source coverage registry is implemented as planning metadata.
  It uses planning-seed top slots, not refreshed live market-share claims.
- Official API live checks are opt-in and depend on external credentials,
  provider permissions, media ownership, and API quota.
- The local HTTP queue is not production multi-user infrastructure.
- WebVTT parsing is intentionally minimal and deterministic; it is not a full
  subtitle styling/rendering engine.
- This repo does not include the original travel research reports.

## Useful Files

- `README.md`: user-facing commands and scope
- `AGENTS.md`: short context for coding agents
- `HOST-ADAPTERS.md`: host registration notes
- `src/evidence-runner.ts`: main workflow orchestration
- `src/evidence-run-input.ts`: CLI/MCP/HTTP evidence-run input normalization
- `src/browser-obstructions.ts`: browser-visible obstruction classifier
- `src/source-strategy.ts`: generic source family and platform strategy
- `src/source-navigation.ts`: typed portal-native navigation plans
- `src/source-navigation-execution.ts`: bounded execution-plan state model for
  safe navigation execution
- `src/source-navigation-executor.ts`: explicit-recipe browser-backed safe
  navigation executor
- `src/source-navigation-recipes.ts`: manual-only recipe candidate planner for
  real-site selector calibration
- `src/source-navigation-calibration.ts`: read-only selector calibration over
  manual-only recipe candidates
- `src/source-navigation-recipe-catalog.ts`: explicit-opt-in recipe proposal
  catalog builder from candidates plus calibration reports
- `docs/SOURCE_STRATEGY.md`: Naver/Google/travel platform source plan
- `docs/PRODUCT_DEVELOPMENT_PLAN.md`: top-level portal-native roadmap
- `docs/PORTAL_NAVIGATION_ARCHITECTURE.md`: engineering review and diagrams
- `docs/PORTAL_NAVIGATION_IMPLEMENTATION_GUIDE.md`: next implementation guide
- `docs/INFORMATION_SOURCE_TAXONOMY.md`: implemented category/locale/top-slot
  source coverage registry
- `docs/OCR.md`: optional OCR setup and integration harness notes
- `src/browser-pool.ts`: Playwright/browser implementation
- `src/artifact-writer.ts`: artifact persistence
- `src/official-api.ts`: explicit-credential platform API metadata capture
- `docs/OFFICIAL_API.md`: official API setup and opt-in integration harness
- `src/ocr.ts`: optional OCR over frame screenshots
- `src/http-server.ts`: local evidence-run queue endpoints
- `src/platform-adapters/`: platform capability maps
- `tests/evidence-runner.test.ts`: workflow regression test
- `tests/ocr.test.ts`: OCR metadata and confidence regression tests
- `tests/official-api.integration.ts`: opt-in live official API harness
## Official API Credential Readiness Pass

- Added `buildOfficialApiReadiness` in `src/official-api.ts`.
- Added `official-api-readiness --url <url>` CLI support. The command reports
  supported provider lookups, credential env var references, ready/missing env
  counts, and unsupported generic cases without making provider API calls.
- Readiness reports never include raw token values. They only report env var
  names and whether those names are set.
- Verification:
  `npx vitest run tests/official-api.test.ts` passed with 8 tests,
  `official-api-readiness` returned a YouTube readiness report with one ready
  lookup and one missing env lookup without printing the test token, and
  `npm run test:official-api` skipped cleanly when
  `FARM_OFFICIAL_API_INTEGRATION` was unset.

## Scene-Change Threshold Recommendation Pass

- Extended `analyzeSceneChanges` diagnostics with selected distance min/max,
  `thresholdRecommendation`, `recommendedThreshold`, and a recommendation
  reason.
- Recommendations distinguish insufficient data, keeping the current threshold,
  lowering when no pair qualifies, raising when too many candidates exceed
  `maxHits`, and reviewing a near miss just below the threshold.
- Evidence-run final reports now include the latest scene-change threshold
  recommendation alongside threshold, comparable pair count, max distance, and
  selected hit count.
- Verification:
  `npx vitest run tests/frame-sampler.test.ts tests/evidence-runner.test.ts`
  passed with 17 tests.

## OCR Text-Profile Context Diagnostics Pass

- Extended deterministic OCR text profiles with `priceLikeTokenCount`,
  `hasPercentLikeText`, `hasMapLikeText`, and
  `hasTravelOrCommerceLikeText`.
- Updated OCR metadata schema so these fields are typed on OCR artifacts.
- Added unit coverage for map/travel screenshots, Korean/Japanese unit prices,
  numeric non-price overlays, and coupon/discount badges that should not become
  price claims without a currency+amount token.
- Expanded the opt-in OCR integration harness so real local screenshots cover
  English OCR text, map labels, travel price cards, coupon/discount badges, and
  optional Korean/Japanese map text, with assertions against OCR text-profile
  metadata.
- Verification:
  `npx vitest run tests/ocr-text-profile.test.ts tests/ocr.test.ts` passed with
  9 tests, and `npm run test:ocr-integration` skipped cleanly when
  `FARM_OCR_INTEGRATION` was unset.

## Blocked-Slot Profile/Headed Retry Handoff Pass

- Added profile/headed retry commands to source coverage readiness audits.
  Blocked actionable slots now include a `profileHeadedRetry` command object
  with an exact `auth-login --profile <platform-profile> --url <target>`
  setup command plus a `source-coverage-calibrate --platform <id> --repeat 2
  --headed --profile <platform-profile> --persistent-profile` argv and
  PowerShell command.
- Added `source-coverage-readiness --format retry-commands` so QA/QC can print
  blocked-slot profile setup and retry commands directly from promotion
  summaries instead of reconstructing the coverage loop by hand.
- Updated docs so profile/headed retry is the next path for Google Search,
  Instagram/TikTok/X, Korean commerce, Expedia, and other browser-visible gated
  platforms after blocked calibration artifacts have been inspected.
- Verification:
  `npx vitest run tests/source-coverage-readiness.test.ts
  tests/source-coverage-calibration-loop.test.ts
  tests/source-navigation-promotion.test.ts` passed with 8 tests, and a CLI
  smoke with a blocked Google Search promotion summary printed the expected
  retry command.

## Global Community Fixture Coverage Pass

- Added fixture-verified manual-only portal recipe candidates for Reddit,
  Quora, and Stack Overflow.
- Global community/forum recipes now include provider-specific candidate
  selectors for visible query state, section/community state, recency/sort
  state, bounded pagination, article/thread card capture, destination
  follow-up, and obstruction-state capture.
- Recipe expected-text, blocked-signal, and risk-note strings are now
  deduplicated after provider-specific candidates merge with generic family
  fallbacks.
- Quora and Stack Overflow registry entries now include the detected `portal`
  source family so later promotion/readiness checks can match maintained
  community recipe groups.
- Expanded local browser executor fixtures so Reddit, Quora, and Stack
  Overflow preserve community thread cards, metadata, follow-up targets, and
  public obstruction state without login/private-community bypass, deleted
  content bypass, comment writes, or unbounded feed crawling.
- Verification:
  `npx vitest run tests/source-navigation.test.ts
  tests/source-navigation-recipes.test.ts` passed with 19 tests, and
  `npx vitest run tests/source-navigation-executor.test.ts` passed with 22
  tests. The full `npm test` suite passed with 31 files / 197 tests, and
  `npm run verify` passed with build, full tests, local smoke, public web
  smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Global Community Security-Block Calibration Pass

- Added Cloudflare/security-verification and network-security phrases to
  browser obstruction classification and portal recipe blocked-signal
  calibration.
- Portal recipe candidates now propagate paywall/login/unavailable/community
  and security-challenge blocked signals to every portal action, preventing
  article/thread capture actions from being promoted when the visible page is a
  challenge surface.
- Re-ran repeated real `community_forum` / `global` calibration for Reddit,
  Quora, and Stack Overflow. The current unattended browser is blocked by
  Reddit network security and Cloudflare-style security verification on Quora
  and Stack Overflow, so promotion exports zero maintained action files and
  readiness marks all three slots as blocked.
- Confirmed `source-coverage-readiness --format retry-commands` emits
  `auth-login` setup plus profile/headed retry commands for each blocked
  global community slot.
- Direct evidence-runs against the blocked Reddit, Quora, and Stack Overflow
  pages preserve `browser_obstruction` artifacts and pass final claim gates.
- Verification:
  `npx vitest run tests/browser-obstructions.test.ts
  tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts
  tests/source-navigation-recipe-catalog.test.ts
  tests/source-navigation-promotion.test.ts` passed with 40 tests. The full
  `npm test` suite passed with 31 files / 199 tests, and `npm run verify`
  passed with build, full tests, local smoke, public web smoke, media smoke,
  proxy smoke, and 0 npm audit vulnerabilities.

## Global Social-Feed Calibration Pass

- Refined video/social blocked-signal calibration so generic login chrome does
  not block public visible content. Standalone "Log In" / "Sign Up" links on
  an Instagram hashtag page no longer turn all video/social candidates into
  blocked actions, while stronger login-wall phrases, CAPTCHA/security
  challenges, app-open prompts, unavailable text, and server-error phrases
  still block promotion.
- Added browser obstruction coverage for TikTok-style unavailable/server-error
  pages. "Something went wrong" and "something wrong with the server" now
  produce `media_unavailable` browser obstruction evidence.
- Re-ran repeated real `social_feed` / `global` calibration for Instagram,
  TikTok, and X/Twitter. Instagram hashtag search now promotes four maintained
  read-only capture actions, X/Twitter search promotes three maintained
  read-only capture actions, and TikTok remains blocked in the unattended
  browser by a visible server-error/unavailable surface.
- Ran explicit evidence-runs with the promoted Instagram and X/Twitter action
  files. Instagram passed the final claim gate with 195 artifacts, 4 claims,
  4 citations, and 151 `source_navigation_action` artifacts. X/Twitter passed
  the final claim gate with 70 artifacts, 4 claims, 4 citations, and 48
  `source_navigation_action` artifacts.
- Ran a direct TikTok evidence-run against the blocked search page. It
  preserved 2 `browser_obstruction` artifacts, produced 5 claims with 5
  citations, and passed the final claim gate.
- Verification:
  `npm test -- tests/browser-obstructions.test.ts
  tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts`
  passed with 31 tests, `npm run build` passed before rerunning the CLI
  calibration/evidence-run checks, the full `npm test` suite passed with 31
  files / 201 tests, and `npm run verify` passed with build, full tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## OCR Korean/Japanese Context Fixture Pass

- Expanded deterministic OCR text-profile context matching for Korean and
  Japanese map/place and travel/commerce screenshots.
- Map-like context now recognizes Korean/Japanese business-hours, review,
  phone, and parking terms, so place cards can be flagged as map/local evidence
  without turning visible ratings into price claims.
- Travel/commerce context now recognizes Korean lowest-price/rate terms and
  Japanese fee, tax-included, cheapest, and free-cancellation terms, improving
  QA hints for travel price cards.
- Added unit fixtures for a Korean Naver Map-like place card and a Japanese
  travel price card. The Korean place-card fixture stays non-price despite
  route, minutes, and rating numbers; the Japanese travel fixture records one
  price-like token from `JPY`/yen plus amount and travel context.
- Verification:
  `npm test -- tests/ocr-text-profile.test.ts tests/ocr.test.ts` passed with
  11 tests. The full `npm test` suite passed with 31 files / 203 tests, and
  `npm run verify` passed with build, full tests, local smoke, public web
  smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Scene-Change Distribution Diagnostics Pass

- Expanded scene-change diagnostics with distribution fields for real media
  threshold tuning:
  `uniqueFingerprintCount`, `zeroDistancePairCount`, `distanceP50`,
  `distanceP90`, and `distanceP95`.
- Evidence-run final reports now surface unique fingerprint count,
  zero-distance adjacent pair count, and p90 distance alongside threshold,
  comparable-pair count, max distance, selected hit count, and recommendation.
- Added a stable-frame distribution fixture so repeated identical frames,
  low-motion transitions, and a larger cut produce deterministic diagnostics.
- Verification:
  `npm test -- tests/frame-sampler.test.ts tests/evidence-runner.test.ts`
  passed with 18 tests. The full `npm test` suite passed with 31 files / 204
  tests, and `npm run verify` passed with build, full tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Official API Missing-Media-ID Readiness Pass

- Added `missing_media_id` official API readiness status for supported
  platforms when the URL does not contain a stable media ID.
- YouTube search, Instagram hashtag/profile, TikTok search, and similar
  listing URLs can now be distinguished from generic unsupported URLs:
  readiness reports the provider lookups that would exist for a direct media
  URL, but marks them blocked by missing media ID before any provider API call.
- `collectOfficialApiEvidence` now warns when official API metadata is
  requested on a supported platform URL without a media ID, instead of silently
  producing only an empty API cache.
- Updated README and official API docs to direct agents toward browser-visible
  evidence and destination follow-up before official API collection on listing
  pages.
- Verification:
  `npm test -- tests/official-api.test.ts` passed with 9 tests, `npm run build`
  passed, and
  `node .\dist\cli.js official-api-readiness --url "https://www.youtube.com/results?search_query=tokyo+travel" --youtube-api-key-env FARM_YOUTUBE_API_KEY --youtube-oauth-token-env FARM_YOUTUBE_OAUTH_TOKEN`
  reported two `missing_media_id` lookup items without printing token values.
  The full `npm test` suite passed with 31 files / 205 tests, and
  `npm run verify` passed with build, full tests, local smoke, public web
  smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Community Destination Fixture Coverage Pass

- Expanded global and Korean community/forum recipe candidates beyond portal
  result cards into destination thread/article evidence scopes.
- Portal recipes now include fixture-backed scopes for community destination
  shells, destination metadata, question bodies, thread bodies, answer bodies,
  accepted/top-answer markers, comment lists, and destination obstruction state.
- Added local executor coverage for DCInside, Naver Knowledge iN, Reddit,
  Quora, and Stack Overflow destination pages. The fixture verifies
  browser-visible question, answer, thread, comment, and access-state evidence
  without posting, joining, private-community bypass, deleted-content bypass, or
  unbounded crawling.
- Verification:
  `npm test -- tests/source-navigation-recipes.test.ts
  tests/source-navigation-executor.test.ts` passed with 32 tests. The full
  `npm test` suite passed with 31 files / 206 tests, `npm run verify` passed
  with build, full tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities, and `npm pack --dry-run` passed with
  143 files.

## Video/Social Public Post Scope Pass

- Expanded video/social manual-only recipe candidates so public post evidence
  is not limited to one metadata block.
- Instagram/TikTok-like public post fixtures now expose separate profile-card,
  caption/body, engagement-state, comment-preview, frame-region, overlay-text,
  and obstruction-state scopes.
- X/Twitter fixtures now expose separate post metadata, profile-card,
  engagement-state, reply-list, thread-context, media-frame, overlay-text, and
  obstruction-state scopes.
- The executor verifies these scopes without raw stream download, gate bypass,
  private-message access, likes, follows, comments, shares, or other social
  writes.
- Verification:
  `npm test -- tests/source-navigation-recipes.test.ts
  tests/source-navigation-executor.test.ts` passed with 32 tests. The full
  `npm run verify` gate passed with build, 31 test files / 206 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities, and `npm pack --dry-run` passed with 143 files.

## OCR Map/Local Numeric Context Pass

- Expanded deterministic OCR text-profile metadata for map/local screenshots.
- OCR artifacts now distinguish rating-like text, distance/duration text,
  business-hours text, and contact/address text from price-like text.
- Added Japanese local place-card fixture coverage with address, phone,
  business hours, walking time, and rating context, while keeping price-like
  evidence false unless a currency+amount token is visible.
- Tightened distance detection so route labels such as `Route 2` do not become
  distance evidence without an actual distance or duration unit.
- Verification:
  `npm test -- tests/ocr-text-profile.test.ts tests/ocr.test.ts` passed with
  12 tests, `npm run build` passed, and `npm run test:ocr-integration` skipped
  cleanly with `FARM_OCR_INTEGRATION` unset. The full `npm test` suite passed
  with 31 files / 207 tests, and `npm run verify` passed with build, full
  tests, local smoke, public web smoke, media smoke, proxy smoke, and 0 npm
  audit vulnerabilities. `npm pack --dry-run` passed with 143 files.

## Scene-Change Sparse Sampling Diagnostics Pass

- Expanded scene-change diagnostics for real-media threshold tuning.
- Diagnostics now record adjacent pair gap min/max/average seconds, near-
  threshold below/above counts, and selected-hit spacing min/max seconds.
- Added a sparse media fixture so threshold review can distinguish wide sample
  gaps from clustered scene-change hits and brittle near-threshold distances.
- Evidence-run final reports now surface pair-gap max seconds and near-
  threshold counts alongside threshold, pair count, unique fingerprints, p90,
  selected hit count, and threshold recommendation.
- Verification:
  `npm test -- tests/frame-sampler.test.ts tests/evidence-runner.test.ts`
  passed with 19 tests. The full `npm test` suite passed with 31 files / 208
  tests, and `npm run verify` passed with build, full tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.
  `npm pack --dry-run` passed with 143 files.

## Official API Missing-Media-ID Artifact Pass

- Extended official API readiness diagnostics so credential readiness is
  reported separately from lookup readiness. A listing/search URL can now show
  `status = missing_media_id` while also showing whether the referenced
  credential is ready, missing, or not supplied.
- Added `nextAction` hints to readiness items and API cache entries, including
  `use_direct_media_url_or_followup` for supported platform URLs that need a
  stable media/item URL before official API collection can run.
- Added readiness counts for ready credentials, missing credential references,
  missing env vars, and ready credentials blocked only by missing media IDs.
- When official API collection is enabled on a supported listing/search URL,
  the collector now writes partial `official_api_metadata` artifacts and
  per-run API cache entries with `missing_media_id` status without making a
  provider API call or leaking raw credential values.
- Verification:
  `npm test -- tests/official-api.test.ts` passed with 11 tests. The full
  `npm test` suite passed with 31 files / 210 tests, and `npm run verify`
  passed with build, full tests, local smoke, public web smoke, media smoke,
  proxy smoke, and 0 npm audit vulnerabilities.

## Login Runtime Channel And CDP Import Pass

- Added `browserChannel` runtime support to BrowserPool and evidence-run so
  CLI runs can use installed Playwright channels such as Chrome or Edge instead
  of the bundled Chromium.
- Added CLI `--browser-channel <channel>` and `--chrome` support for
  `auth-login`, `evidence-run`, `source-navigation-calibrate`,
  `source-navigation-calibrate-batch`, and the source-coverage calibration
  loop.
- Propagated browser-channel runtime metadata through calibration manifests,
  coverage loop plans, promotion review evidence-run commands, and blocked-slot
  retry commands. Profile/headed retry commands now default to Chrome channel
  because account-login and bot-check pages often reject generic automation
  browser builds.
- Added `auth-cdp-import`, which attaches to a user-controlled Chrome DevTools
  session and saves cookies/storage state into a farm profile without reading
  or storing password values. This gives blocked login flows a second path:
  the user logs in in Chrome, then the farm imports the resulting browser
  storage state.
- Added `auth-cdp-launch` for opening a user-controlled Chrome DevTools
  session with a farm profile user-data directory, plus `auth-cdp-import
  --save-now` and `--cookie-domains <a,b>` so imports can skip the Enter prompt
  and save only target-platform cookies/origins from an attached Chrome
  session.
- Verification:
  `npm test -- tests/source-coverage-readiness.test.ts
  tests/source-coverage-calibration-loop.test.ts
  tests/source-navigation-calibration-batch.test.ts
  tests/source-navigation-promotion.test.ts tests/mcp-server.test.ts` passed
  with 16 tests, and `node .\dist\cli.js evidence-run --url
  https://example.com/ --no-frames --wait-ms 0 --timeout-ms 10000
  --browser-channel chrome` passed with final claim gate OK.

## Google CDP Login Calibration Pass

- Confirmed the direct Google account login path is blocked in both bundled
  Playwright Chromium and Playwright-launched Chrome-channel windows with an
  unsafe/unsupported browser message.
- Opened a user-controlled Chrome CDP session, completed Google login there,
  and imported a domain-filtered farm profile with
  `auth-cdp-import --save-now --cookie-domains google.com,youtube.com`.
  The resulting `google-search-cdp` storage-state profile saved 29 Google/
  YouTube cookies without reading password values.
- Verified `evidence-run` against `https://www.google.com/search?q=seoul+hotel`
  using `--headed --browser-channel chrome --profile google-search-cdp`.
  The run passed the final claim gate, recorded Google Search as the source
  strategy, and produced zero browser obstruction artifacts.
- Re-ran `source-coverage-calibrate --platform google_search --query "seoul
  hotel" --repeat 2 --headed --chrome --profile google-search-cdp`. Both
  repeated calibration attempts succeeded, blocked-signal hits were zero,
  promotion exported two maintained read-only action recipes, and final source
  coverage readiness marked Google Search `ready`.
- Verified the promoted Google Search actions with `evidence-run
  --source-navigation`. The run passed the final claim gate with 103 artifacts,
  4 claims, 4 citations, 67 source-navigation action artifacts, and zero
  obstruction artifacts.
- Remaining tuning: the first promoted Google Search destination follow-up
  resolved a hash-only Google search URL, so Google result-link follow-up
  selectors need refinement before follow-up evidence is treated as high
  quality destination evidence.

## Google Search Follow-Up Selector Pass

- Tightened follow-up link resolution so broad selectors skip same-page
  hash-only/self targets and choose the first visible HTTP(S) link whose
  origin/path/query differs from the current page.
- Prioritized Google Search result anchors that contain result headings
  (`#search a[href]:has(h3)`) before broader `data-ved` link fallbacks in the
  manual-only search recipe candidates.
- Added local executor coverage where a hash-only candidate appears before the
  real destination link, proving follow-up extraction still resolves the real
  destination without navigating the parent page.
- Re-ran authenticated-profile Google Search calibration using
  `--headed --chrome --profile google-search-cdp`. Two repeated calibration
  attempts succeeded, promotion exported two maintained read-only actions, and
  readiness remained `ready`.
- Verified the new promoted Google Search action file with `evidence-run
  --source-navigation`. The final claim gate passed with 103 artifacts, 4
  claims, 4 citations, 67 source-navigation action artifacts, and zero
  obstruction artifacts. The destination follow-up resolved to
  `https://www.booking.com/city/kr/seoul.html` instead of a Google Search
  hash-only URL.
- Verification:
  `npm test -- tests/source-navigation-recipes.test.ts
  tests/source-navigation-executor.test.ts` passed with 33 tests. Full
  verification is the next gate after this documentation update.

## Google Search Result Module Scope Pass

- Expanded Google Search manual-only result capture candidates beyond the full
  `#search` container. The recipe now proposes `#rso`, first result heading
  links, visible `#search a[href]:has(h3)` links, top and bottom ad blocks,
  right-side panels, section modules, and knowledge/local attribute rows as
  separately calibrated capture scopes.
- Re-ran `source-coverage-calibrate --platform google_search --query "seoul
  hotel" --repeat 2 --headed --chrome --profile google-search-cdp`. Both
  attempts succeeded with 0 blocked-signal hits. Calibration now saw 23
  selector candidates, 22 capture-scope candidates, 10 matched selectors, and
  7 matched scopes.
- Promotion exported a maintained read-only Google Search action file with
  capture scopes for `#rso`, `#rso a[href]:has(h3)`,
  `#search a[href]:has(h3)`, visible `#tads`, and fallback `#search`, plus a
  `#rso a[href]:has(h3)` destination follow-up selector.
- Verified the promoted action file through `evidence-run --source-navigation`.
  The final claim gate passed with 195 artifacts, 4 claims, 4 citations, 133
  source-navigation action artifacts, and zero obstruction artifacts. The
  follow-up again resolved to `https://www.booking.com/city/kr/seoul.html`.
- Verification:
  `npm run build` passed, and
  `npm test -- tests/source-navigation-recipes.test.ts
  tests/source-navigation-executor.test.ts` passed with 33 tests.

## Google Search Knowledge Panel Calibration Pass

- Ran an authenticated-profile Google Search calibration for `Eiffel Tower` to
  exercise knowledge/right-panel SERP variants, not just hotel/result-list
  pages.
- A first repeat-2 run produced one successful calibration and one transient
  `page.goto` `net::ERR_ABORTED`, which was not treated as readiness. Re-ran
  with repeat 3 to require at least two stable successful calibration reports.
- The repeat-3 run succeeded on all three attempts with 0 blocked-signal hits,
  23 selector candidates, 22 capture-scope candidates, 10 matched selectors,
  and 7-8 matched scopes across runs.
- Promotion exported a maintained Google Search action file that captures
  `#rso`, first result heading links, the `#rhs` right-side knowledge panel,
  and fallback `#search`, plus a `#rso a[href]:has(h3)` follow-up selector.
- Verified the promoted action file through `evidence-run --source-navigation`.
  The final claim gate passed with 169 artifacts, 4 claims, 4 citations, 121
  source-navigation action artifacts, zero obstruction artifacts, and a
  follow-up to `https://www.toureiffel.paris/en`.

## Google Search Local Pack Calibration Pass

- Added real Google Search local-pack capture-scope candidates for `#Odp5De`,
  `#Odp5De .VkpGBb`, `#Odp5De .rllt__details`,
  `#Odp5De [aria-label*="Places"]`, `#Odp5De [data-test-id="moc"]`, and
  `#Odp5De img[src*="googleusercontent.com"]`.
- Re-ran authenticated-profile Google Search calibration for `coffee near
  Seoul Station` through headed Chrome and the `google-search-cdp` profile.
  All three repeated attempts succeeded with 0 blocked-signal hits, 23 selector
  candidates, 39 capture-scope candidates, 10 matched selectors, and 13 matched
  capture scopes.
- Promotion exported a maintained read-only Google Search action file that
  captures `#rso`, result heading links, `#Odp5De` local-pack container,
  local place cards, local place detail text, local map canvas, local
  thumbnails, `#search img`, and fallback `#search`, plus a
  `#rso a[href]:has(h3)` follow-up selector.
- Verified the promoted local-pack action file through
  `evidence-run --source-navigation`. The final claim gate passed with 194
  artifacts, 4 claims, 4 citations, 145 source-navigation action artifacts,
  zero obstruction artifacts, and one destination follow-up.

## Destination Triage Office-Hours Pass

- Clarified the current search-result deepening boundary: explicit `follow_up`
  recipes can create one-depth child evidence runs, but the system does not yet
  choose among many destinations or classify whether a followed news, blog,
  official-site, map, review, community, commerce, or media page is useful.
- Added bounded destination triage to the product, architecture, implementation,
  and next-task docs. The intended next layer extracts visible destination
  candidates, scores relevance/authority/freshness/obstruction risk, caps
  top-K/depth/domain/timeout budgets, records candidate and triage artifacts,
  and preserves parent-result -> child-destination provenance for final claims.
- Kept the scope explicitly non-crawler: no recursive traversal by default, no
  login/CAPTCHA/paywall/private bypass, and destination claims must cite child
  evidence instead of relying only on portal snippets.

## Destination Triage Artifact Foundation Pass

- Added `src/destination-triage.ts` with typed destination candidate kinds,
  usefulness states, deterministic scoring, duplicate/low-value/private/
  unsupported rejection, selected-request extraction, and summary helpers.
- Added `destination_candidate` and `destination_triage` evidence kinds.
  Explicit source-navigation `follow_up` requests now become destination
  candidates before child runs, are capped by `maxFollowUps` through triage
  selection, and produce final triage artifacts after child run results are
  known.
- Threaded destination triage summaries through evidence-run assessment, final
  reports, CLI output, FarmService/MCP/HTTP summaries, and exported package
  types.
- Added unit coverage for useful-second-result selection, duplicate
  destination collapse, and child-error usefulness classification. Extended the
  workflow follow-up fixture so the parent run writes candidate and triage
  artifacts and the final report includes the destination triage summary.
- Verification:
  `npm test -- tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 11 tests, `npm run build` passed, and `npm run verify` passed
  with build, 32 test files / 213 tests, local smoke, public web smoke, media
  smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Multi-Destination Extraction Foundation Pass

- Added `BrowserPool.readLinkTargets`, a read-only helper that collects multiple
  visible usable HTTP(S) links from an explicit selector while skipping
  hash-only self links and leaving the parent page in place.
- Added `operation: "extract_destinations"` to explicit source-navigation
  recipes. The executor now emits multiple follow-up requests from one
  result/module selector, records them on `source_navigation_action` metadata,
  and passes them into the same bounded destination triage path as explicit
  `follow_up` requests.
- Extended evidence-run workflow coverage so extracted candidates include a
  low-value policy link, a useful official destination, a useful blog
  destination, and a duplicate URL. Triage selects the official destination
  within `maxFollowUps: 1`, rejects/omits the rest, and creates only the
  selected child evidence run.
- Updated the product, architecture, implementation, README, AGENTS, and next
  task docs to distinguish what now exists from what remains: broad maintained
  provider selectors and richer child-page usefulness analysis.
- Verification:
  `npm test -- tests/source-navigation-executor.test.ts tests/evidence-runner.test.ts`
  passed with 35 tests, `npm run build` passed, and `npm run verify` passed
  with build, 32 test files / 215 tests, local smoke, public web smoke, media
  smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Extract-Destinations Recipe Catalog Pass

- Changed search, portal/news/community, and generic `destination-followup`
  recipe candidates from single-link `follow_up` proposals to explicit
  `extract_destinations` proposals while keeping the action key compatible with
  the existing source navigation plan.
- Added recipe catalog export support for `extract_destinations`: matching or
  repeatedly stable selectors now produce recommended actions with
  `operation: "extract_destinations"` and `maxLinks: 10`.
- Updated recipe, catalog, and promotion tests so repeated calibration can
  promote maintained multi-link destination extraction actions instead of only
  single-link follow-up actions.
- Verification:
  `npm test -- tests/source-navigation-recipes.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts`
  passed with 20 tests, and `npm run build` passed.

## Destination Per-Domain Budget Pass

- Added `sourceNavigation.maxFollowUpsPerDomain` and
  `--source-navigation-max-followups-per-domain` to destination triage input
  so selected child evidence runs can be capped per destination domain.
- Destination triage now marks omitted same-domain candidates as
  `budget_limited`, records `maxPerDomain` and `budgetLimitedCount` in
  summaries, and keeps the default bounded to `min(2, maxFollowUps)`.
- Added unit coverage where two high-scoring candidates share a domain and a
  lower-scoring candidate from another domain is selected to preserve source
  diversity within the bounded follow-up budget.
- Verification:
  `npm test -- tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 13 tests, and `npm run build` passed.

## Child Destination Evidence-Density Pass

- Added `DestinationChildEvidenceSummary` to selected destination follow-up
  results. Child runs now report artifact count, claim count, browser capture
  count, obstruction count, page text length, title/final URL, query-overlap
  tokens, evidence signals, evidence warnings, and a short visible-text snippet
  back into destination triage.
- Destination triage now uses child evidence feedback to downgrade selected
  destinations to `low_value`, `off_topic`, or `blocked` after the child run
  finishes, instead of treating every successful child claim gate as useful.
- Added unit coverage for off-topic child evidence and useful child evidence,
  plus workflow coverage that verifies extracted child destinations preserve
  matched query tokens inside the written triage artifact.
- Verification:
  `npm test -- tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 15 tests, `npm run build` passed, and `npm run verify` passed
  with build, 32 test files / 218 tests, local smoke, public web smoke, media
  smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Destination Authority/Freshness Scoring Pass

- Added deterministic destination score breakdowns for base score, rank,
  candidate kind, query overlap, authority, freshness, source-family fit,
  external-destination bonus, warning penalties, and total score.
- Destination candidate artifacts now preserve official, institutional,
  publisher, local/place, freshness, stale-year, and source-family fit/mismatch
  signals so candidate selection can be audited before child execution.
- Added unit coverage that verifies an authoritative fresh destination can beat
  a higher-ranked stale directory result, and a travel/booking candidate beats a
  stale source-family-mismatched news result.
- Verification:
  `npm test -- tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 17 tests, `npm run build` passed, and `npm run verify` passed
  with build, 32 test files / 220 tests, local smoke, public web smoke, media
  smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Destination Deepening Office-Hours Pass

- Re-clarified the Google/Naver deep research boundary. Search results, portal
  modules, map panels, review cards, product cards, and media cards are parent
  evidence surfaces; news articles, blog posts, official pages, map places,
  reviews, community threads, commerce pages, and media pages reached from them
  are child evidence surfaces.
- Updated the top-level product plan so natural research deepening is modeled
  as an auditable loop: parent capture -> visible destination extraction ->
  candidate triage -> bounded child evidence run -> child usefulness verdict ->
  optional proposal-only deeper hop.
- Updated the architecture plan with the parent/child evidence separation,
  child usefulness states, and the rule that useful child pages may propose but
  must not silently execute depth-2 traversal.
- Updated the implementation guide with a Phase 2B destination-deepening slice,
  including a proposed `DestinationDeepeningProposal` shape, depth/budget
  rules, and focused tests for low-value, off-topic, blocked, useful, and
  explicit depth-2 cases.
- Verification:
  `npm run build` passed, and `git diff --check` reported only existing CRLF
  normalization warnings.

## Destination Scoring Profiles Pass

- Added source-family destination scoring profiles to `src/destination-triage.ts`.
  Candidate score breakdowns now preserve the active profile name and profile
  adjustment alongside base, rank, kind, query, authority, freshness,
  source-family fit, external-destination, warning, and total scores.
- Search remains conservative, while map/local emphasizes place/review
  evidence, blog/content emphasizes blog/community/media evidence, portal/news
  emphasizes news/community/review evidence, travel booking and commerce
  emphasize offer/product/review evidence, and video/social emphasizes public
  media/community evidence.
- Added regression coverage proving a travel booking context prefers a fresh
  offer over stale source-family-mismatched news evidence, and a map/local
  context prefers browser-visible place evidence over a generic official page.
- Verification:
  `npm test -- tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 18 tests, and `npm run verify` passed with build, 32 test files /
  221 tests, local smoke, public web smoke, media smoke, proxy smoke, and 0 npm
  audit vulnerabilities.

## Destination Deepening Proposal Artifact Pass

- Added `destination_deepening_proposal` as a typed evidence kind.
- Browser page capture now preserves a bounded list of visible usable HTTP(S)
  links in page metadata. This gives child evidence runs a deterministic source
  for proposal-only deeper candidates without clicking or recursively
  navigating.
- Selected useful child destinations now summarize visible depth-2 candidates
  with URL, normalized URL, domain, visible text, rank, candidate kind, signals,
  and warnings. Low-value, login/account, duplicate, and self-link candidates
  are filtered out before proposal creation.
- Parent follow-up runs now write `destination_deepening_proposal` artifacts
  when useful child evidence exposes deeper candidates. The artifact is
  explicitly `proposal_only`; depth-2 execution remains future explicit opt-in.
- Added unit and workflow coverage for source-document depth-2 proposals,
  child evidence summaries, final report lines, ledger entries, and the new
  evidence kind.
- Verification:
  `npm test -- tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 19 tests, and `npm run verify` passed with build, 32 test files /
  222 tests, local smoke, public web smoke, media smoke, proxy smoke, and 0 npm
  audit vulnerabilities.

## Destination Depth-2 Execution Opt-In Pass

- Added `sourceNavigation.maxDepth` and
  `--source-navigation-max-depth <1-2>`. The default remains depth 1, which
  records visible depth-2 proposals without continuing traversal.
- Added `destination_deepening_run` as a typed evidence kind. When `maxDepth`
  is explicitly `2`, parent follow-up runs execute proposed depth-2 candidates
  under bounded count and per-domain controls, then record attempted,
  completed, failed, omitted, useful, off-topic, and blocked counts.
- Deeper child evidence runs reuse the normal evidence workflow but keep source
  navigation disabled inside the deeper run, preventing recursive crawling.
- Threaded destination deepening execution summaries through assessment, final
  reports, CLI output, FarmService/MCP/HTTP output, artifact counts, and
  focused workflow tests.
- Updated the top, middle, and lower development docs so the Google/Naver
  natural deepening boundary is now: parent capture -> destination extraction
  -> bounded child run -> child usefulness verdict -> proposal-only deeper hop
  by default -> explicit `maxDepth: 2` deeper child run when requested.
- Verification:
  `npm test -- tests/destination-triage.test.ts tests/evidence-runner.test.ts
  tests/mcp-server.test.ts tests/http-server.test.ts` passed with 28 tests, and
  `npm run verify` passed with build, 32 test files / 223 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Destination Claim Provenance Gate Pass

- Strengthened final claim-gate for destination evidence kinds. Claims citing
  `destination_candidate`, `source_navigation_followup`, `destination_triage`,
  `destination_deepening_proposal`, or `destination_deepening_run` now require
  same-claim citation rows for the parent/source provenance chain appropriate
  to that evidence kind.
- Citation validation now accepts either `evidence` or `artifact_id` as the
  citation reference, resolves cited artifact kinds from the ledger, and fails
  final validation when a citation points at an unregistered artifact.
- Added focused claim-gate coverage for a valid destination triage provenance
  chain, a missing child follow-up provenance failure, and a valid depth-2
  destination deepening provenance chain.
- Verification:
  `npm test -- tests/claim-gate.test.ts tests/evidence-runner.test.ts
  tests/mcp-server.test.ts tests/http-server.test.ts` passed with 30 tests, and
  `npm run verify` passed with build, 32 test files / 226 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Destination Depth-2 Budget Hardening Pass

- Added depth-2-specific destination execution budgets:
  `sourceNavigation.maxDeepeningRuns`,
  `sourceNavigation.maxDeepeningRunsPerDomain`,
  `sourceNavigation.deepeningTimeoutMs`, and
  `sourceNavigation.maxDeepeningArtifacts`.
- Added matching CLI flags:
  `--source-navigation-max-deepening-runs`,
  `--source-navigation-max-deepening-runs-per-domain`,
  `--source-navigation-deepening-timeout-ms`, and
  `--source-navigation-max-deepening-artifacts`.
- Depth-2 execution now uses a whole-run child abort signal, defaults to one
  deeper run, one deeper run per domain, `min(parent timeout, 15000)` timeout,
  and 100 artifacts before the result is marked `budget_limited`.
- `destination_deepening_run` summaries now preserve max runs, max per-domain,
  timeout, max artifacts, budget-limited count, timeout count, and per-result
  duration/artifact-budget metadata.
- MCP/HTTP evidence-run input schemas now accept the new depth-2 budget fields.
- Verification:
  `npm run build` passed, and
  `npm test -- tests\evidence-runner.test.ts tests\mcp-server.test.ts
  tests\http-server.test.ts tests\claim-gate.test.ts` passed with 4 files /
  31 tests. Final `npm run verify` passed after the follow-up recipe-candidate
  slice with build, 32 test files / 228 tests, local smoke, public web smoke,
  media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Naver Search Destination Selector Candidate Pass

- Added narrower Naver Search calibration candidates for integrated result
  modules, vertical module containers, organic cards, Blog/Cafe destination
  links, news title links, and map/place links before falling back to broad
  `#main_pack` or `#search` extraction.
- Added recipe coverage proving Naver Search result-selection and
  `extract_destinations` candidates include the module-level scopes needed for
  future repeated real-site calibration.
- Verification:
  `npm test -- tests\source-navigation-recipes.test.ts` passed with 1 file /
  10 tests. Final `npm run verify` passed with build, 32 test files /
  228 tests, local smoke, public web smoke, media smoke, proxy smoke, and
  0 npm audit vulnerabilities.

## Google Search Vertical Module Candidate Pass

- Added broader manual-only Google Search calibration candidates for news,
  image, and video modules before broad `#search` fallback extraction.
- Added English/Korean/Japanese vertical-tab label candidates, legacy
  `tbm=isch` / `tbm=nws` / `tbm=vid` parameters, and newer `udm=2` /
  `udm=7` vertical parameters as calibration candidates.
- Added Google destination extraction candidates for News links, YouTube watch
  and Shorts links, shortened YouTube links, Vimeo links, image anchors, and
  image-result links. These remain manual-only and must pass repeated
  browser-visible calibration before maintained export.
- Verification:
  `npm run build` passed,
  `npm test -- tests\source-navigation-recipes.test.ts` passed with 1 file /
  10 tests, and final `npm run verify` passed with build, 32 test files /
  228 tests, local smoke, public web smoke, media smoke, proxy smoke, and
  0 npm audit vulnerabilities.

## Search-To-Destination Scope Clarification Pass

- Ran an office-hours product clarification for the Google/Naver deepening
  question. The documented answer is now explicit: maintained recipes can
  follow selected destinations and judge child pages, but arbitrary natural
  traversal across every live result set is not a default behavior yet.
- Updated the top-level product plan with the current capability boundary and
  the target loop: parent surface capture, calibrated visible destination
  extraction, deterministic triage, bounded child evidence run, child
  usefulness verdict, and cited provenance.
- Updated the architecture plan with a search-to-destination decision layer
  covering candidate extraction, pre-follow scoring, and post-follow verdicts.
- Updated the implementation guide and next-task handoff with provider paths
  and explicit useful-child reason codes for the next implementation slice.
- Verification:
  docs-only change; `git diff --check` is the relevant local check.

## Destination Reason Codes Pass

- Added typed deterministic destination decision reason codes to
  `src/destination-triage.ts`.
- `destination_candidate` and `destination_triage` artifacts now preserve
  `reasonCodes.positive` and `reasonCodes.negative` arrays alongside numeric
  scores, signals, and warnings.
- Candidate scoring records positive reasons such as `query_overlap`,
  `official_domain_match`, `fresh_publisher_article`, `local_place_match`,
  `price_or_offer_visible`, and `source_family_fit`.
- Child evidence review can add `transcript_or_ocr_hit`, `thin_content`,
  `blocked_surface`, and `off_topic` reason codes after a selected destination
  is captured.
- Rejections now record explicit negative reasons such as `duplicate`,
  `portal_shell`, `private_or_login_surface`, `unsupported_destination`,
  `domain_budget`, and `top_k_budget`.
- Destination child evidence summaries now flag OCR and transcript evidence
  signals when present so child-usefulness reason codes can cite those
  derivative evidence paths.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 21 tests. `npm run verify` passed with build,
  32 test files / 228 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Destination Reason Summary Pass

- Added positive and negative reason-code aggregation to
  `DestinationTriageSummary`.
- Final reports now include a compact destination reason summary line, making
  repeated calibration runs easier to compare without opening every triage JSON
  artifact.
- Focused tests now verify summary reason counts in unit output and reason
  count fields in written workflow triage artifacts.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 21 tests. `npm run verify` passed with build,
  32 test files / 228 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Map/Local Destination Extraction Candidate Pass

- Added conditional map/local destination follow-up planning to
  `src/source-navigation.ts`.
- Added Naver Map, KakaoMap, and Google Maps manual-only
  `extract_destinations` recipe candidates for visible place-detail, website,
  menu, review, booking/place, and external website links.
- Kept execution bounded and non-clicking: route, call, reservation, booking,
  login, and account-changing controls remain unsupported, and extracted links
  still pass through destination triage before child evidence runs.
- Updated the top/middle/lower development docs plus `README.md`, `AGENTS.md`,
  and `docs/NEXT_TASKS.md` so the next step is repeated real-site calibration
  and promotion review for map/local destination selectors.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  passed with 3 files / 45 tests. `npm run verify` passed with build,
  32 test files / 228 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Commerce Destination Extraction Candidate Pass

- Added conditional commerce destination follow-up planning to
  `src/source-navigation.ts`.
- Added Amazon, Coupang, Naver Shopping, Gmarket, and 11st manual-only
  `extract_destinations` recipe candidates for visible product-detail, review,
  seller, brand/store, and marketplace item links.
- Kept execution bounded and non-clicking: cart, wishlist, purchase, checkout,
  subscribe, membership, login, and account-changing controls remain
  unsupported, and extracted links still pass through destination triage before
  child evidence runs.
- Expanded the commerce executor fixture so visible product/review/seller/brand
  links produce bounded follow-up requests without entering transaction flows.
- Updated the top/middle/lower development docs plus `README.md`, `AGENTS.md`,
  and `docs/NEXT_TASKS.md` so the next step is repeated real-site calibration
  and promotion review for map/local and commerce destination selectors.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  passed with 3 files / 45 tests. `npm run verify` passed with build,
  32 test files / 228 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Blog And Video/Social Destination Extraction Candidate Pass

- Added conditional blog/cafe destination follow-up planning to
  `src/source-navigation.ts`.
- Added Naver Blog and Naver Cafe manual-only `extract_destinations` recipe
  candidates for visible source, related-post, profile, official, and external
  links.
- Added conditional video/social destination follow-up planning to
  `src/source-navigation.ts`.
- Added YouTube, Instagram, TikTok, and X/Twitter manual-only
  `extract_destinations` recipe candidates for visible profile/channel,
  canonical media, external bio/source, and related-media links.
- Kept execution bounded and non-clicking: login, join, follow, like, comment,
  share, message, subscribe, raw-stream, gate-bypass, private-message, and
  account-changing controls remain unsupported, and extracted links still pass
  through destination triage before child evidence runs.
- Expanded blog/cafe and video/social executor fixtures so visible source,
  related, profile/channel, external, and canonical-media links produce bounded
  follow-up requests without navigating the parent page.
- Verification:
  `npx vitest run tests/source-navigation.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  passed with 3 files / 45 tests. `npm run verify` passed with build,
  32 test files / 228 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Destination Extraction Readiness QA Pass

- Added destination-extraction readiness metadata to source-navigation
  promotion summaries and reviews.
- Promotion groups now preserve `extract_destinations` candidate counts, ready
  action counts, ready action keys, maintained/single-run/calibration-required
  counts, and blocked/manual counts.
- Source coverage readiness now reports `destinationExtraction.status`
  separately from overall source readiness. This lets QA mark a platform as
  ready for parent page/result capture while still requiring repeated
  destination-selector calibration before natural Google/Naver deepening is
  trusted.
- Kept old promotion summary compatibility by defaulting missing
  `destinationExtraction` fields to zero-count readiness metadata.
- Updated the top/middle/lower development docs plus `README.md`, `AGENTS.md`,
  and `docs/NEXT_TASKS.md`.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-coverage-readiness.test.ts tests/source-navigation-promotion.test.ts tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 4 files / 28 tests. `npm run verify` passed with build,
  32 test files / 229 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Destination Extraction Report QA Pass

- Extended `formatSourceCoverageCalibrationLoopReport` so the generated
  Markdown report includes destination-extraction ready/not-ready counts,
  status counts, and per-source destination-extraction status in the readiness
  section.
- Promotion report lines now include ready `extract_destinations` action totals
  against promoted destination-extraction candidates.
- This makes the calibration loop report distinguish parent result/page capture
  readiness from child-link extraction readiness without requiring a reviewer
  to open the raw JSON audit.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-coverage-calibration-loop.test.ts tests/source-coverage-readiness.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 10 tests. `npm run verify` passed with build,
  32 test files / 230 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Broad Destination Fallback Promotion Gate Pass

- Ran a live Naver Map `map_local` / `ko-KR` top-rank-1 calibration loop for
  `seongsu cafe`. The first promotion exported `destination-followup` from the
  broad selector `#root a[href^="http"]`.
- Verified that the broad selector was unsafe for natural deepening: explicit
  evidence-run followed `https://www.naver.com/`, produced a child run against
  the portal home, and did not reach useful map/place evidence.
- Hardened `src/source-navigation-recipe-catalog.ts` so broad page-shell
  destination selectors such as `#root a[href^="http"]`, `body a[href]`,
  `main a[href]`, `article a[href]`, `#search a[href]`, `#main_pack a[href]`,
  and `[role="main"] a[href^="http"]` are not promotable for
  `extract_destinations`.
- Added regression coverage proving repeated broad fallback matches remain
  `calibration_required` and are omitted from maintained exports.
- Re-promoted the same live Naver Map calibration manifest after the fix:
  Naver Map remained ready for parent map capture with 2 maintained capture
  actions, while `destinationExtraction.readyActionCount` became `0` and the
  coverage readiness audit reported `needs_repeated_calibration` for
  destination extraction.
- Verified the regated Naver Map action file with `evidence-run`; final claim
  gate passed, follow-up requested count was `0`, and no destination triage
  artifacts were created from portal-home links.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts`
  passed with 4 files / 19 tests. `npm run verify` passed with build,
  32 test files / 231 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Natural Search-To-Source Deepening Scope Pass

- Re-ran the office-hours product clarification for the user's Google/Naver
  deepening question.
- Current answer is now explicit: the system can already execute
  recipe-gated destination extraction, bounded child evidence runs, child
  usefulness verdicts, and explicit depth-2 deepening, but default-autonomous
  search-to-source traversal still waits on provider-maintained selectors,
  repeated calibration, and QA.
- Saved the office-hours design note to
  `C:\Users\이지범\.gstack\projects\browser-agent-mcp-farm\codex-main-design-20260527-133637.md`.
- Updated the top-level product plan with the current user-facing answer:
  "partially yes, not default autonomous."
- Updated the architecture plan with a natural deepening maturity ladder that
  separates parent capture readiness, destination extraction readiness,
  bounded child evidence readiness, usefulness verdict readiness, and default
  natural-deepening candidacy.
- Updated the implementation guide and next-task handoff with the concrete
  user workflow target and QA gates for useful versus useless destinations.
- Verification:
  docs-only change; `git diff --check` is the relevant local check.

## Destination Triage Fallback Diagnostics Pass

- Added fallback diagnostics to `DestinationTriageSummary`:
  `unattemptedFallbackCount` and `retryRecommended`.
- The diagnostics turn on when a selected child destination is downgraded after
  browser-visible evidence review while other candidates remain unattempted
  behind the top-K budget.
- Final reports now include fallback candidate counts and retry recommendation
  status in the destination triage line.
- Added unit and workflow coverage for natural search-deepening QA cases where
  the selected official child page is low-value or off-topic and a lower-ranked
  blog candidate remains unattempted due to `maxFollowUps: 1`.
- Updated README, AGENTS, product, implementation, and next-task docs so QA can
  distinguish "no useful child evidence exists" from "the follow-up budget or
  selector was too narrow."
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 23 tests.

## Destination Triage Fallback Candidate Pass

- Added fallback candidate recommendations to destination triage.
- When selected child evidence is downgraded and top-K-limited candidates
  remain unattempted, `DestinationTriageSummary.fallbackCandidates` now
  preserves the candidate ID, action key, URL, domain, candidate kind, and score
  for the lower-ranked destination(s) QA should retry with a wider follow-up
  budget.
- Final reports now include a `Destination triage fallback candidates` line
  that lists the first fallback candidate IDs, kinds, and URLs instead of only
  reporting the fallback count.
- Fallback candidates now include `budgetReason`, distinguishing candidates
  skipped by the total top-K budget from candidates skipped by the per-domain
  budget. This lets QA choose whether the next pass needs a higher
  `maxFollowUps`, a higher `maxFollowUpsPerDomain`, or narrower provider
  selectors.
- Added `DestinationTriageSummary.retryAdvice`. When fallback candidates
  remain, the summary recommends the next `maxFollowUps` and
  `maxFollowUpsPerDomain` values and records whether the retry should increase
  total follow-ups, increase per-domain follow-ups, or narrow destination
  selectors. Final reports include the same retry-advice line.
- Added copyable retry CLI flags to destination triage advice. The summary and
  final report now include `--source-navigation-max-followups` and
  `--source-navigation-max-followups-per-domain` values for the next bounded
  source-deepening pass when a Google/Naver/news/blog/official-site style run
  selected a weak child page but left fallback candidates unattempted.
- Added destination visible metadata profiling. Destination candidates now
  preserve URL/link-text metadata for text snippets, visible years,
  recent/stale year hints, price/offer-like text, rating/review-like text,
  local/place-like text, and publisher/article-like text, giving Google/Naver
  result-card QA a compact pre-child-run evidence profile.
- Added visible metadata aggregation to destination triage summaries and final
  reports. Reports now show candidate snippet coverage and recent/stale-year,
  price/offer, rating/review, local/place, and publisher/article counts, so QA
  can compare candidate pressure without opening every destination candidate
  artifact.
- Added candidate-kind aggregation to destination triage summaries and final
  reports. Reports now show all, selected, useful, and rejected destination
  kind counts across news, blog, official, map/place, review, community,
  commerce, media, and generic candidates for repeated calibration comparison.
- Added deterministic query-intent scoring for destination candidates.
  Candidate artifacts now preserve `queryIntent`, score breakdowns include a
  `queryIntent` contribution, query-intent matches add positive reason codes,
  and final reports aggregate query-intent counts. This lets the same result
  set prefer news, blog/review/community, commerce, map/place, media, or
  official child sources depending on the user's question.
- Extended query-intent detection with Korean and Japanese triggers. Korean
  `뉴스`, `후기`, `공식`, `지도`, `가격`, `예약`, `동영상` and Japanese
  `ニュース`, `レビュー`, `公式`, `地図`, `価格`, `予約`, `動画` style
  queries now feed the same deterministic intent scoring used by English
  Google-style queries.
- Tightened price/offer visible metadata matching so the `fee` keyword is
  matched as a word and does not fire on terms such as `coffee`.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 30 tests. Final `npm run verify` passed with build,
  32 test files / 260 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Follow-up verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 31 tests after adding top-K versus per-domain fallback
  budget reasons. Final `npm run verify` passed with build, 32 test files /
  261 tests, local smoke, public web smoke, media smoke, proxy smoke, and 0 npm
  audit vulnerabilities.
- Retry-advice verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 31 tests. Final `npm run verify` passed with build,
  32 test files / 261 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Retry-advice CLI flag verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 31 tests. Final `npm run verify` passed with build,
  32 test files / 261 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Visible-metadata profiling verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts` passed with 1 file /
  17 tests. `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 31 tests. Final `npm run verify` passed with build,
  32 test files / 261 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Visible-metadata summary/report verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 31 tests. Final `npm run verify` passed with build,
  32 test files / 261 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Candidate-kind summary/report verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 31 tests. Final `npm run verify` passed with build,
  32 test files / 261 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Query-intent scoring verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 32 tests. Final `npm run verify` passed with build,
  32 test files / 262 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Multilingual query-intent verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 33 tests. Final `npm run verify` passed with build,
  32 test files / 263 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Destination Query Script Diagnostics Pass

- Added destination child evidence script-family diagnostics for natural
  Google/Naver/map deepening QA.
- `DestinationChildEvidenceSummary` can now preserve `queryScriptFamilies`,
  `evidenceScriptFamilies`, and `queryEvidenceScriptMismatch`.
- Evidence-run now emits the `query_script_mismatch_possible` warning when a
  query has no child-page token overlap but the query and visible child text
  have different dominant scripts, such as a Latin transliteration query
  landing on Hangul visible evidence.
- Destination triage reason-code aggregation now preserves
  `query_script_mismatch_possible` as a negative/caution reason. The selected
  child destination is still downgraded to `off_topic` unless actual
  query/supporting evidence is present; this avoids turning transliteration
  uncertainty into a useful claim.
- Added unit and workflow coverage for a Latin `seongsu cafe` query reaching a
  Hangul child place page, verifying the diagnostic fields, warning, and
  reason-code summary.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 25 tests.

## Google Maps Destination QA Hardening Pass

- Re-ran the promoted `map_local` / `ko-KR` Google Maps action file against
  `https://www.google.com/maps/search/seongsu%20cafe`.
- The first live run after script diagnostics still attempted zero child
  follow-ups because every Google Maps place URL included `authuser=0`, and the
  older login-surface regex treated the `auth` substring as private/account
  evidence.
- Replaced the broad login/account regex with a token-boundary detector so
  `authuser=0` remains allowed while real `login`, `signin`, `account`,
  `accounts`, `auth`, `oauth`, and `private` surfaces are still rejected.
- Added path-query extraction for Google Maps `/maps/search/<query>` and Naver
  Map `/p/search/<query>` URLs in both pre-follow destination triage and
  post-follow child evidence summaries.
- Stopped converting `same_host_as_parent` alone into a `portal_shell` reason
  code. Same-host still applies a small score warning, but Google Maps
  provider-internal place-detail URLs are not marked as portal shells by domain
  alone.
- Added regression tests for Google Maps `authuser=0` place URLs, path-based
  Naver Map queries, and path-based workflow query diagnostics.
- Re-ran the promoted Google Maps action after the fixes. The run passed final
  claim gate, executed one child place follow-up, preserved
  `matchedQueryTokens: ["seongsu"]`, stored query/evidence script families,
  produced one proposal-only Instagram depth-2 candidate, and removed the false
  `private_or_login_surface` and `portal_shell` reason counts.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 27 tests.

## Natural Deepening Documentation and Map QA Pass

- Reframed the Google/Naver deepening question as a first-class product
  requirement across the top/middle/lower development docs.
- The product plan now states the user-facing behavior: preserve the parent
  portal/search surface, extract bounded candidate child destinations such as
  news, blog, official, map/place, review, community, commerce, and media
  links, then judge the child page before final claims rely on it.
- The architecture doc now separates destination intent by source type, because
  a useful official site, news article, blog post, map place, review thread,
  product page, or video/social page depends on the user's question.
- The implementation guide now has a natural deepening checklist for provider
  recipes: scoped parent capture, narrow calibrated `extract_destinations`
  selectors, candidate score/reason artifacts, bounded child evidence runs,
  child usefulness summaries, explicit depth-2 controls, and final provenance
  checks.
- Re-ran promoted map/local action files after the Google Maps fixes:
  - Google Maps selected one child place page for `seongsu cafe`, passed final
    claim gate, matched `seongsu`, and produced a proposal-only Instagram
    depth-2 candidate.
  - KakaoMap selected a child place page but downgraded it as off-topic for the
    English query, preserving `query_script_mismatch_possible`,
    `unattemptedFallbackCount`, and `retryRecommended` diagnostics.
  - Naver Map remained capture-only with no extracted child candidates from the
    current maintained action file.
- Product implication: natural deepening now has the right evidence contract,
  but provider-maintained destination selectors still need Korean-query and
  source-specific calibration before it can become a default behavior.
- Verification:
  `git diff --check` reported only CRLF normalization warnings,
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 27 tests, and `npm run verify` passed with build,
  32 test files / 237 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Unique-First Destination Extraction Pass

- Hardened `BrowserPool.readLinkTargets` for natural deepening QA.
- When an `extract_destinations` action asks for `maxLinks`, the browser layer
  now fills that budget with unique normalized destination URLs first. Duplicate
  hash variants are still kept if there are not enough unique visible links, so
  duplicate evidence is preserved without letting repeated links crowd out
  lower-ranked candidate sources.
- Source-navigation action metadata now records raw candidate count, usable
  candidate count, unique destination candidate count, duplicate destination
  candidate count, and omitted duplicate count for each extraction action.
- Added executor fixture coverage with a crowded destination list:
  privacy, official, official hash duplicate, blog, and community links. With
  `maxLinks: 4`, extraction now returns privacy, official, blog, and community,
  and omits the duplicate hash variant.
- Existing duplicate-preservation coverage still passes when the page exposes
  too few unique links to fill the requested budget.
- Verification:
  `npx vitest run tests/source-navigation-executor.test.ts` passed with 1 file
  / 26 tests, `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 2 files / 27 tests, `npm run build` passed, and final
  `npm run verify` passed with build, 32 test files / 238 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Map Provider Boilerplate Filtering Pass

- Added map/provider shell filtering to destination triage and depth-2 proposal
  generation.
- Naver Map contexts now treat `www.naver.com` portal-home links, Naver help
  links, policy links, and Naver corporate links as low-value provider shell
  evidence while keeping Naver Place, Booking, and SmartPlace destinations
  eligible.
- Kakao Map/Place contexts now filter Kakao corporate/support/policy/service
  links such as `kakaocorp.com` and `cs.kakao.com` from deeper-hop proposals
  while keeping `place.map.kakao.com` destinations eligible.
- Google Maps contexts now filter Google support, policy, account, preferences,
  and service links while keeping `/maps/place` URLs eligible.
- Added triage coverage proving Naver provider-home/help links are rejected as
  `portal_shell` while a Naver Place URL is selected as `map_place`.
- Added deeper-hop coverage proving Kakao provider boilerplate is omitted and a
  visible Instagram place/profile link remains as the only proposal candidate.
- Verification:
  `npx vitest run tests/destination-triage.test.ts` passed with 1 file /
  15 tests, `npx vitest run tests/evidence-runner.test.ts tests/source-navigation-executor.test.ts`
  passed with 2 files / 40 tests, `npx vitest run tests/source-navigation-recipes.test.ts`
  passed with 1 file / 10 tests, `npm run build` passed, and `npm run verify`
  passed with build, 32 test files / 240 tests, local smoke, public web smoke,
  media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Scoped Naver Place Selector Promotion Pass

- Fixed an over-broad promotion guard in `source-navigation-recipe-catalog`.
  The previous broad-fallback detector treated every `#root a[href...]`
  destination selector as too broad, which also blocked scoped selectors such as
  `#root a[href*="place.naver.com"]`.
- The promotion gate now blocks only unqualified broad anchor selectors such as
  `#root a[href]` and `#root a[href^="http"]`, while allowing scoped href
  filters after repeated calibration.
- Added Naver Map recipe candidates for narrower entry-place links:
  `#root a[href*="map.naver.com/p/entry/place"]` and
  `#root a[href*="map.naver.com/v5/entry/place"]`.
- Kept generic `#root a[href*="map.naver.com"]` blocked as a broad
  provider-shell selector, because it can still point at map/search shell
  surfaces instead of concrete place evidence.
- Added catalog tests proving scoped Naver Place selectors can become
  `maintained_recipe_ready` and generic Naver Map-domain selectors cannot.
- Verification:
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-recipes.test.ts`
  passed with 2 files / 21 tests,
  `npx vitest run tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts`
  passed with 3 files / 10 tests,
  `npx vitest run tests/source-navigation-calibration.test.ts tests/source-navigation-calibration-batch.test.ts`
  passed with 2 files / 15 tests, `npm run build` passed, and `npm run verify`
  passed with build, 32 test files / 242 tests, local smoke, public web smoke,
  media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Naver Map Natural Deepening Reality Check

- Re-ran the latest Korean-query Naver Map maintained action file against
  `https://map.naver.com/p/search/%EC%84%B1%EC%88%98%20%EC%B9%B4%ED%8E%98`.
- Final claim gate passed with 187 artifacts, 4 claims, 4 citations, and 120
  source-navigation action artifacts.
- The run produced 0 follow-up requests, 0 destination candidates, 0
  destination triage artifacts, and `destinationTriage.status:
  "no_candidates"`.
- Interpretation: this is correct behavior. Naver Map is parent-capture ready
  for viewport/OCR evidence, but not yet destination-extraction ready. It must
  not pretend that provider-home, help, policy, or broad map shell links are
  useful place, review, official-site, or booking evidence.
- Checked the generated promotion catalog with Node `JSON.parse`; it is valid
  JSON. The earlier PowerShell `ConvertFrom-Json` failure is likely a
  PowerShell encoding/control-character fragility around live Naver snippets,
  not an invalid catalog writer issue.
- Product implication: the natural Google/Naver research loop is in scope, but
  the readiness bar stays split into parent capture, destination extraction,
  child evidence, usefulness verdict, and default-natural-deepening maturity.

## SPA-Style Destination Attribute Extraction Pass

- Extended `BrowserPool.readLinkTargets` so explicit `extract_destinations`
  actions can read visible non-anchor URL attributes from SPA-style
  cards/buttons, not only `<a href>` links.
- Supported attributes include `data-href`, `data-url`, `data-link`,
  `data-link-url`, `data-target-url`, `data-destination-url`,
  `data-original-url`, `data-canonical-url`, `data-place-url`,
  `data-source-url`, and `data-item-url`.
- Attribute candidates must be browser-visible, resolve to HTTP(S), differ from
  the current page without only a hash change, and contain visible text. The
  executor still does not click the parent card.
- Source-navigation action metadata now reports anchor versus attribute
  destination candidate counts.
- Page capture `visibleLinks` metadata now also includes these visible
  destination attributes, which improves proposal-only depth-2 candidate
  discovery from child pages.
- Added an executor fixture where a visible place card, official card, and blog
  card expose destinations only through `data-url`, `data-target-url`, and
  `data-source-url`, while a hash-only self card is rejected.
- Verification:
  `npm run build` passed,
  `npx vitest run tests/source-navigation-executor.test.ts` passed with 1 file
  / 27 tests,
  `npx vitest run tests/source-navigation-executor.test.ts tests/destination-triage.test.ts tests/evidence-runner.test.ts`
  passed with 3 files / 56 tests, and `npm run verify` passed with build,
  32 test files / 243 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Provider-Scoped SPA Destination Selector Candidate Pass

- Added provider-scoped non-anchor destination selector candidates so the new
  attribute extraction capability can be calibrated and promoted through the
  normal recipe flow.
- Google Search candidates now include result/module selectors such as
  `#rso [data-url]`, `#search [data-url]`, and
  `#search [data-target-url]`.
- Naver Search candidates now include `#main_pack`-scoped `data-url`,
  `data-href`, `data-link-url`, and `data-target-url` variants, plus
  provider-specific Blog/Cafe/Map URL attribute filters.
- Naver Map, KakaoMap, and Google Maps candidates now include map/place scoped
  URL attribute selectors for SPA place cards and selected-place panels.
- Commerce candidates now include product/item/seller/brand URL attributes for
  Amazon, Coupang, Naver Shopping, Gmarket, and 11st.
- Video/social candidates now include media/profile/channel URL attributes for
  YouTube, Instagram, TikTok, and X/Twitter.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  passed with 2 files / 37 tests.
  `npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts`
  passed with 5 files / 39 tests, and `npm run verify` passed with build,
  32 test files / 243 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Broad SPA Attribute Promotion Gate Pass

- Hardened `source-navigation-recipe-catalog` so broad shell-scoped SPA
  destination attributes such as `#search [data-url]`, `#rso [data-href]`,
  `#main_pack [data-url]`, `[role="main"] [data-target-url]`, and similar
  unqualified `data-url`/`data-href`/`data-link` selectors are not promotable
  for maintained `extract_destinations` export.
- Kept narrowed or semantic provider attributes promotable after repeated
  calibration, such as `#root [data-url*="place.naver.com"]`,
  `data-product-url`, `data-profile-url`, or `data-media-url`.
- Added catalog tests proving repeated broad SPA attribute matches remain
  `calibration_required`, while a repeated provider-specific Naver Place
  attribute selector can become `maintained_recipe_ready`.
- Ran one live read-only Naver Map calibration against
  `https://map.naver.com/p/search/%EC%84%B1%EC%88%98%20%EC%B9%B4%ED%8E%98`.
  It succeeded with 51 selector candidates, 5 matched selectors, 3 matched
  capture scopes, 8 expected-signal hits, 0 blocked signals, and 0 matched
  Naver Place `data-*` destination selectors.
- The destination-followup action still matched only broad
  `#root a[href^="http"]` as a visible fallback, plus a hidden generic
  `#root a[href*="map.naver.com"]`; narrower anchor and SPA attribute
  destination selectors did not match. This confirms current Naver Map remains
  parent-capture ready but destination-extraction not-ready.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-navigation-recipes.test.ts`
  passed with 3 files / 26 tests.
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts`
  passed with 4 files / 37 tests, and `npm run verify` passed with build,
  32 test files / 245 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Destination Probe Calibration Pass

- Added destination-probe diagnostics to read-only source-navigation
  calibration for `extract_destinations`.
- When a destination selector is browser-visible, calibration now calls the
  same read-only link-target extraction path used by explicit execution and
  records raw, usable, unique, duplicate, omitted-duplicate, anchor, attribute,
  and sample-URL counts in `destinationProbe`.
- A visible selector with zero usable HTTP(S) destination links remains
  observed for calibration purposes, but recipe catalog promotion now rejects
  it for `single_run_ready` and `maintained_recipe_ready` export.
- Preserved backward compatibility for older calibration reports that do not
  contain `destinationProbe`, while new reports provide the stricter readiness
  signal.
- Added Playwright fixture coverage for a Google-like result card with a real
  destination link and a visible result card with no usable follow-up links.
- Added catalog coverage proving repeated provider-specific destination
  selectors with zero usable probe links stay `calibration_required`, while
  repeated selectors with usable probe links can still promote.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-calibration.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 30 tests. Final `npm run verify` passed with build,
  32 test files / 248 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Live Naver Map probe check:
  `node .\dist\cli.js source-navigation-calibrate --url 'https://map.naver.com/p/search/%EC%84%B1%EC%88%98%20%EC%B9%B4%ED%8E%98' --timeout-ms 25000 --wait-ms 3000 --selector-timeout-ms 1000`
  passed. The run produced 51 selector candidates, 5 matched selectors, 3
  matched capture scopes, 8 expected-signal hits, and 0 blocked signals.
  Destination follow-up still only matched the broad
  `#root a[href^="http"]` fallback. The new probe found 2 usable links, but
  the sample URLs were provider shell/login URLs rather than Naver Place,
  review, booking, menu, or official-site destinations. That confirms the
  stricter readiness interpretation: Naver Map remains capture-ready but not
  destination-extraction-ready.

## Destination Probe Sample Classification Pass

- Exported a destination-probe candidate classifier from the destination triage
  layer so calibration can reuse the same low-value, login/account,
  unsupported, and source-family-fit concepts before recipe promotion.
- `source_navigation_calibration` artifacts now include
  `promotableCandidateCount`, `nonPromotableCandidateCount`, `warningCounts`,
  `samplePromotableUrls`, and `sampleNonPromotableUrls` for matched
  `extract_destinations` selectors.
- Recipe catalog promotion now rejects destination selectors when the probe
  finds usable HTTP(S) URLs but every sampled URL is non-promotable, such as
  provider shell, login/account, help/policy, or unsupported destinations.
- Added Playwright calibration coverage for a Naver Map-like provider shell
  where a broad HTTP fallback exposes Naver home and login URLs. The probe
  records 2 usable URLs, 0 promotable URLs, and the expected low-value/login
  warning counts.
- Added catalog coverage proving repeated destination selectors with only
  non-promotable probe links stay `calibration_required`, while repeated
  selectors with promotable probe links can still promote.
- Live Naver Map calibration after this pass:
  `node .\dist\cli.js source-navigation-calibrate --url 'https://map.naver.com/p/search/%EC%84%B1%EC%88%98%20%EC%B9%B4%ED%8E%98' --timeout-ms 25000 --wait-ms 3000 --selector-timeout-ms 1000`
  passed. The broad `#root a[href^="http"]` fallback found 2 usable links, but
  `promotableCandidateCount` was 0 with `login_or_account_surface`,
  `low_value_navigation_surface`, and `source_family_weak_fit` warning counts.
  Naver Map therefore remains parent-capture-ready but not
  destination-extraction-ready.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-calibration.test.ts tests/source-navigation-recipe-catalog.test.ts tests/destination-triage.test.ts`
  passed with 3 files / 44 tests. Final `npm run verify` passed with build,
  32 test files / 250 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Frame-Aware Calibration Pass

- Made read-only selector calibration frame-aware.
- `BrowserPool.inspectSelector` now inspects every Playwright-accessible frame
  instead of only the top document, catches per-frame detach/evaluation
  failures as zero-match frame results, and returns `frameCount`,
  `matchedFrameCount`, `visibleFrameCount`, `firstMatchedFrameUrl`, and
  `firstVisibleFrameUrl` diagnostics through calibration artifacts.
- `BrowserPool.readLinkTargets` can now extract destination links from visible
  selectors inside accessible frames. Returned links and destination probes
  preserve frame index/URL/name metadata plus matched frame counts.
- Added a Playwright fixture where a Google-like result card and destination
  link render inside an iframe. Calibration now marks the result selector as
  matched, records the iframe URL, and extracts the child destination link from
  inside the frame.
- Re-ran live Naver Map calibration against
  `https://map.naver.com/p/search/%EC%84%B1%EC%88%98%20%EC%B9%B4%ED%8E%98`.
  The report saw 5 frames and preserved first matched frame URLs for broad
  `#root` and `#root a[href^="http"]` matches. Narrow Naver Place,
  entry-place, booking, and SmartPlace selectors still did not match in any
  frame, so the current Naver Map limitation is not just top-frame-only
  blindness.
- Verification:
  `npm run build` passed,
  `npx vitest run tests/source-navigation-calibration.test.ts --testNamePattern "iframes"`
  passed with 1 test, `npx vitest run tests/source-navigation-calibration.test.ts`
  passed with 14 tests,
  `npx vitest run tests/source-navigation-calibration.test.ts tests/source-navigation-recipe-catalog.test.ts`
  passed with 2 files / 30 tests, and
  `npx vitest run tests/source-navigation-executor.test.ts` passed with 1 file
  / 27 tests. Final `npm run verify` passed with build, 32 test files / 251
  tests, local smoke, public web smoke, media smoke, proxy smoke, and 0 npm
  audit vulnerabilities.

## Global Destination Discovery Diagnostics Pass

- Added a diagnostic `destinationDiscovery` pass to read-only calibration for
  `extract_destinations` actions.
- When planned destination selectors miss, calibration now scans visible
  anchors and supported SPA destination attributes across accessible frames,
  then classifies sampled URLs with the destination-probe classifier. This is
  for provider selector discovery only; it does not make broad page scans
  maintained recipes or child-run inputs.
- Hardened the probe classifier so same-document hash anchors and Naver Map
  shell anchors such as `https://map.naver.com/p/#section_content` and
  `https://map.naver.com/p/#header` are low-value provider shell surfaces, not
  promotable destinations.
- Added regression coverage for:
  - direct probe classification of same-page and Naver Map shell hash anchors
  - global discovery finding a real Naver Place URL outside the planned
    selectors
  - global discovery finding only shell/hash/login links and marking all of
    them non-promotable
- Re-ran live Naver Map calibration against
  `https://map.naver.com/p/search/%EC%84%B1%EC%88%98%20%EC%B9%B4%ED%8E%98`.
  Planned narrow Naver Place, entry-place, booking, and SmartPlace selectors
  still did not match. The broad fallback probe still found only Naver home and
  login links. The new global `destinationDiscovery` scan found 57 raw
  candidates, 4 usable URLs, 0 promotable URLs, and 4 non-promotable URLs:
  Naver home/login plus the map-shell hash anchors `#section_content` and
  `#header`.
- Interpretation: this is the correct natural-deepening failure mode. Naver Map
  remains parent-capture-ready but not destination-extraction-ready, and the
  next work is provider-specific selector discovery for real place/detail,
  review, menu, booking, or official-site destinations.
- Verification:
  `npm run build` passed,
  `npx vitest run tests/destination-triage.test.ts` passed with 16 tests,
  `npx vitest run tests/source-navigation-calibration.test.ts` passed with
  16 tests, and
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts`
  passed with 3 files / 23 tests. Final `npm run verify` passed with build,
  32 test files / 254 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Classified Destination Discovery Sample Target Pass

- Extended destination probe and global discovery artifacts with classified
  sample target metadata.
- `source_navigation_calibration` now includes `samplePromotableTargets` and
  `sampleNonPromotableTargets` alongside the existing sample URL arrays. Each
  target preserves URL, visible text, anchor versus attribute source,
  attribute name for SPA URL attributes, frame metadata when available, and the
  warning codes that made a sampled target non-promotable.
- Added calibration fixture coverage for:
  - ordinary anchor destinations preserving visible text and `source: anchor`
  - iframe-rendered destinations preserving `frameUrl`
  - SPA-style `data-place-url` discovery preserving
    `source: attribute` and `attributeName: data-place-url`
  - non-promotable Naver home/login/hash anchors preserving warning reasons
- Re-ran live Naver Map calibration against
  `https://map.naver.com/p/search/%EC%84%B1%EC%88%98%20%EC%B9%B4%ED%8E%98`.
  The broad fallback probe still found 2 usable, 0 promotable links, and the
  global discovery scan found 57 raw candidates, 4 usable URLs, 0 promotable
  URLs, and 4 non-promotable URLs. The new sample target metadata records why
  the visible URLs are only Naver home/login/hash shell surfaces, without
  exposing personal page snippets.
- Verification:
  `npm run build` passed,
  `npx vitest run tests/source-navigation-calibration.test.ts --testNamePattern "destination|iframe|provider shell"`
  passed with 4 focused tests,
  `npx vitest run tests/source-navigation-calibration.test.ts` passed with
  16 tests, and
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts tests/destination-triage.test.ts`
  passed with 4 files / 39 tests. Final `npm run verify` passed with build,
  32 test files / 254 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Destination Discovery Catalog/Readiness Handoff Pass

- Threaded global `destinationDiscovery` diagnostics from calibration into
  recipe catalog entries for `extract_destinations`.
- Catalog entries now aggregate discovery run counts, status counts, total raw
  and usable candidates, promotable and non-promotable candidate totals,
  warning counts, and sampled promotable/non-promotable target metadata.
- When global discovery finds promotable sample targets but no planned selector
  is promotable, catalog readiness remains `calibration_required` and the
  reason explicitly tells QA to add a narrower provider selector from the
  samples rather than exporting a broad child-run recipe.
- Promotion summaries now include destination-discovery pressure under
  `destinationExtraction`: discovery run count, promotable/non-promotable
  candidate totals, and warning counts.
- Promotion review and source coverage readiness now surface those diagnostics
  in reasons and next actions, so QA can distinguish "promotable targets exist
  but no maintained selector is ready" from "only low-value, login, or
  provider-shell destinations are visible."
- Source coverage readiness treats missing discovery fields in older
  promotion summaries as zero-count diagnostics, preserving backward
  compatibility for existing summary fixtures and JSON artifacts.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts`
  passed with 3 files / 27 tests. After the compatibility fix,
  `npx vitest run tests/source-coverage-calibration-loop.test.ts tests/source-coverage-readiness.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 12 tests. Final `npm run verify` passed with build,
  32 test files / 258 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Destination Discovery Selector Hint Pass

- Added manual-only selector hints derived from promotable global
  `destinationDiscovery` sample targets.
- Catalog entries now turn promotable anchor samples into host/path-scoped
  `a[href*="..."]` hints and promotable SPA attribute samples into
  host/path-scoped attribute hints, for example
  `[data-place-url*="place.naver.com/restaurant"]`.
- Selector hints include the sample URL, host, path prefix, source,
  attribute name when applicable, `basis: "promotable_sample_target"`,
  `promotionPolicy: "manual_calibration_required"`, and a note requiring
  provider/card/container scoping plus repeated calibration before export.
- Promotion summaries and source coverage readiness now carry
  `discoverySelectorHintCount` so QA can tell whether the next step is to turn
  observed hints into scoped provider candidates or to first find promotable
  destinations.
- Added `source-navigation-catalog --format selector-hints`, which prints
  tab-separated manual calibration hint lines with platform, source family,
  action key, selector, sample URL, host, path prefix, source, attribute name,
  and promotion policy.
- Added promotion-batch selector-hint handoff files. Each
  `source-navigation-promote-batch` group now writes `selector-hints.tsv`
  beside `catalog.json`, `export.json`, and `actions.json`, and promotion
  summary `files.selectorHints` preserves the generated path for QA and
  downstream readiness workflows.
- Coverage readiness now preserves matching selector-hint handoff paths as
  `destinationExtraction.selectorHintFiles`, and coverage calibration-loop
  Markdown reports include a `Selector Hints` section. This connects a
  not-ready source slot directly to the TSV handoff for the next
  provider-specific selector calibration pass.
- Selector hints now include provider/container scoped selector suggestions
  when the platform has a known stable container. A Naver Map sample such as
  `[data-place-url*="place.naver.com/restaurant"]` now carries
  `#root [data-place-url*="place.naver.com/restaurant"]` as a reviewed next
  calibration candidate while still remaining `manual_calibration_required`.
- Added the selector-hint calibration input loop. `--selector-hints-file` and
  `--selector-hints-files` now load TSV handoff rows and append scoped
  suggestions to matching recipe action selector candidates for read-only
  calibration. This is wired through `source-navigation-calibrate`,
  `source-navigation-calibrate-batch`, and `source-coverage-calibrate`; loaded
  hints remain manual calibration inputs and cannot become evidence-run actions
  without repeated calibration and promotion.
- Added selector-hint input provenance to the coverage calibration loop.
  `source-coverage-calibrate` now records supplied hint file paths in the loop
  plan, Markdown report, generated `source-navigation-calibrate-batch` command,
  and calibration batch manifest. This keeps profile/headed provider retries
  reproducible when a later Google/Naver/platform calibration pass starts from
  a previous `selector-hints.tsv` handoff.
- Verification for selector-hint calibration input:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts`
  passed with 4 files / 32 tests. Final `npm run verify` passed with build,
  32 test files / 260 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Verification for selector-hint input provenance:
  `npm run build` passed, and
  `npx vitest run tests/source-coverage-calibration-loop.test.ts tests/source-navigation-calibration-batch.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 12 tests. A plan-only CLI smoke for
  `source-coverage-calibrate --selector-hints-file` wrote
  `selectorHintFiles`, generated a calibrate-batch command containing
  `--selector-hints-file`, and included the TSV path in the Markdown report.
  Final `npm run verify` passed with build, 32 test files / 260 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts`
  passed with 4 files / 30 tests. Final `npm run verify` passed with build,
  32 test files / 258 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Follow-up verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts`
  passed with 3 files / 27 tests after adding selector-hint line formatting.
  Final `npm run verify` passed with build, 32 test files / 258 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.
- Promotion handoff verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-promotion.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-coverage-readiness.test.ts`
  passed with 3 files / 28 tests after adding per-group `selector-hints.tsv`
  output. Final `npm run verify` passed with build, 32 test files / 259 tests,
  local smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.
- Readiness/report propagation verification:
  `npm run build` passed, and
  `npx vitest run tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 13 tests after adding `selectorHintFiles` and the
  report `Selector Hints` section. Final `npm run verify` passed with build,
  32 test files / 259 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Scoped selector suggestion verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts`
  passed with 4 files / 31 tests after adding scoped selector suggestions to
  selector-hint catalog and TSV output. Final `npm run verify` passed with
  build, 32 test files / 259 tests, local smoke, public web smoke, media smoke,
  proxy smoke, and 0 npm audit vulnerabilities.

## Multilingual Destination Text Classification Pass

- Extended destination candidate-kind classification with Korean and Japanese
  visible link-text triggers for news/articles, blogs/posts, community Q&A,
  commerce/price/booking, media/image/video, official homepages, review/rating,
  and local/place candidates.
- Extended visible metadata profiling with Korean and Japanese price/offer,
  rating/review, local/place, and publisher/article patterns, including common
  Naver/Google/Japanese portal result-card terms.
- Extended authority signals so Korean/Japanese official, publisher, and
  local/place text contributes to the same deterministic destination scoring
  and reason-code path as English result text.
- Added regression coverage proving Korean and Japanese visible destination
  text can classify generic URLs before child evidence runs.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/destination-triage.test.ts` passed with 1 file /
  20 tests. A focused provider-shell regression check also passed with
  `npx vitest run tests/source-navigation-calibration.test.ts --testNamePattern "provider shell"`.
  Final `npm run verify` passed with build, 32 test files / 264 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## Naver Search Vertical/Destination Recipe Expansion Pass

- Expanded Naver Search manual-only vertical-tab selector candidates beyond
  Blog/Cafe to include News, Image, Video, Place/Map, Shopping, and View
  URL/text-label variants.
- Expanded Naver Search result capture scopes for news, video, image,
  shopping, SmartStore, Place, Map, and YouTube-linked modules while keeping
  broad `#main_pack` and `#search` selectors as fallback calibration surfaces.
- Expanded Naver Search `extract_destinations` candidates for Naver News,
  Blog, Cafe, Place/Map, Shopping, SmartStore, and video links. These remain
  manual-only calibration candidates and still need repeated real-site
  promotion before maintained evidence-run execution.
- Verification:
  `npm run build` passed,
  `npx vitest run tests/source-navigation-recipes.test.ts --testNamePattern "Naver search"`
  passed, `npx vitest run tests/source-navigation-recipes.test.ts` passed with
  1 file / 10 tests, and
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts`
  passed with 3 files / 29 tests. Final `npm run verify` passed with build,
  32 test files / 264 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Daum Search Vertical/Destination Recipe Expansion Pass

- Expanded Daum Search manual-only vertical-tab selector candidates beyond the
  generic tab list to include News, Blog, Cafe, Image, Video, Place/Map, and
  Shopping URL/text-label variants.
- Expanded Daum Search result capture scopes for Daum/Kakao wrappers, result
  cards, title rows, news items, thumbnail modules, Daum News, Daum Blog,
  Tistory, Daum Cafe, KakaoMap, Kakao Shopping, and video links.
- Expanded Daum Search `extract_destinations` candidates for Daum News, Daum
  Blog, Tistory, Daum Cafe, KakaoMap, Kakao Shopping, YouTube, and shortened
  video links. These remain manual-only calibration candidates until repeated
  real-site promotion proves them stable.
- Verification:
  `npm run build` passed,
  `npx vitest run tests/source-navigation-recipes.test.ts --testNamePattern "Daum search"`
  passed, `npx vitest run tests/source-navigation-recipes.test.ts` passed with
  1 file / 10 tests, and
  `npx vitest run tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts`
  passed with 3 files / 29 tests. Final `npm run verify` passed with build,
  32 test files / 264 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Cross-Script Query Alias Pass

- Added deterministic cross-script query aliases for common local, travel,
  commerce, review, booking, media, official, and food terms.
- Destination candidate scoring now matches aliases such as `seongsu`/`성수`,
  `cafe`/`카페`/`カフェ`, `tokyo`/`東京`, `hotel`/`ホテル`, and
  `price`/`가격`/`価格` when computing `query_overlap` signals.
- Destination child-evidence summaries now use the same alias matching, so
  browser-visible Korean/Japanese child pages can remain useful for English
  transliteration queries instead of being downgraded as off-topic solely
  because scripts differ. Truly unmatched cross-script pages still preserve
  query-script mismatch diagnostics.
- Updated workflow coverage so `/maps/search/seongsu%20cafe` followed to a
  Korean `성수 카페` child page records `matchedQueryTokens: ["seongsu",
  "cafe"]`, `query_overlap`, and a useful selected destination.
- Verification:
  `npm run build` passed,
  `npx vitest run tests/destination-triage.test.ts tests/evidence-runner.test.ts --testNamePattern "transliterated|transliteration|query alias|Korean and Japanese visible"`
  passed with 2 files / 3 focused tests,
  `npx vitest run tests/destination-triage.test.ts` passed with 1 file /
  21 tests, and `npx vitest run tests/evidence-runner.test.ts` passed with
  1 file / 14 tests. Final `npm run verify` passed with build, 32 test files
  / 265 tests, local smoke, public web smoke, media smoke, proxy smoke, and 0
  npm audit vulnerabilities.

## OCR Engine Failure Artifact Pass

- Added `engine_error` and `timeout` OCR statuses to the typed OCR metadata
  schema.
- `runOcrForFrameArtifacts` now catches per-frame OCR recognition errors and
  timeouts, writes partial `ocr_text` metadata artifacts with source frame
  provenance, timestamp when available, empty text profile, empty word list,
  and bounded reason text, then continues processing later frames. Abort
  signals still stop the OCR pass.
- Added OCR unit coverage for an engine error on the first frame followed by a
  successful second frame, and for a per-frame timeout artifact.
- Verification:
  `npm run build` passed, `npx vitest run tests/ocr.test.ts` passed with
  1 file / 7 tests,
  `npx vitest run tests/ocr.test.ts tests/ocr-text-profile.test.ts tests/evidence-runner.test.ts`
  passed with 3 files / 28 tests, and `npm run test:ocr-integration` skipped
  as expected with `FARM_OCR_INTEGRATION` unset. Final `npm run verify` passed
  with build, 32 test files / 267 tests, local smoke, public web smoke, media
  smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Scene-Change Sampling Density Diagnostics Pass

- Added `samplingDensityStatus`, `samplingDensityReason`, and
  `recommendedMaxPairGapSec` to scene-change diagnostics.
- Sampling density is now classified as `ok`, `sparse_pairs`,
  `sparse_selected_hits`, or `insufficient_data`, so real-media QA can tell
  whether a threshold recommendation is trustworthy or the base frame sampling
  needs to be denser first.
- Final reports now include `sampling=<status>` in the scene-change
  diagnostics line.
- Verification:
  `npm run build` passed,
  `npx vitest run tests/frame-sampler.test.ts tests/evidence-runner.test.ts --testNamePattern "scene-change|Scene-change|sampling density"`
  passed with focused scene-change tests, `npx vitest run tests/frame-sampler.test.ts`
  passed with 1 file / 11 tests, and `npx vitest run tests/evidence-runner.test.ts`
  passed with 1 file / 14 tests. Final `npm run verify` passed with build,
  32 test files / 268 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Bing/Yahoo Search Recipe Candidate Pass

- Added provider-specific manual-only search recipe candidates for Bing, Yahoo
  Search, and Yahoo Japan Search.
- Bing now exposes query, vertical, filter, pagination, result capture, and
  destination extraction candidates around `#b_results`, `.b_algo`,
  `#b_context`, news/image/video vertical links, result-title links, and
  context-panel destinations.
- Yahoo Search now exposes candidates around `#web`, `#results`, `#main`,
  `ol.searchCenterMiddle`, `.dd.algo`, `.compTitle`, news/image/video/local
  verticals, Yahoo News links, and Yahoo redirect links as calibration evidence.
- Yahoo Japan Search now exposes candidates around `#contents`, `#web`,
  `#results`, `#WS2m`, `.sw-Card`, news, image, video, map, shopping, and
  Chiebukuro/Q&A surfaces. These cover the `search.ja-JP` registry top slots
  without treating them as maintained recipes before repeated calibration.
- Recipe-catalog selector hints now use provider container scopes for Bing,
  Yahoo Search, and Yahoo Japan Search so discovery handoffs can be narrowed
  before repeated read-only calibration.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts tests/source-navigation-calibration-targets.test.ts tests/source-registry.test.ts`
  passed with 7 files / 61 tests. Final `npm run verify` passed with build,
  32 test files / 271 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Knowledge Database Recipe Candidate Pass

- Added provider-specific manual-only read-only recipe candidates for Google
  Scholar, Wikipedia, Namuwiki, PubMed, data.go.kr, KOSIS, RISS, and KIPRIS.
- Google Scholar now exposes query, year/sort/filter, result-card, metadata,
  full-text/PDF, cited-by, versions/cluster, and obstruction candidates around
  `#gs_res_ccl_mid`, `.gs_r`, `.gs_rt`, `.gs_a`, `.gs_rs`, `.gs_fl`, and
  `.gs_or_ggsm`.
- Wikipedia and Namuwiki now expose article/body/table/reference capture
  candidates plus citation/source destination extraction candidates.
- PubMed now exposes result-summary, abstract, citation, article-detail,
  PubMed Central, and DOI destination candidates.
- Korean public/academic/IP databases now expose provider-specific visible
  list/detail/table surfaces for data.go.kr, KOSIS, RISS, and KIPRIS while
  restricted downloads, paid full text, login, edit, and institutional-access
  controls remain unsupported.
- Recipe-catalog selector hints now use provider container scopes for those
  knowledge/database platforms so discovery handoffs can be narrowed before
  repeated read-only calibration.
- Verification:
  `npm run build` passed, and
  `npx vitest run tests/source-navigation-recipes.test.ts tests/source-strategy.test.ts tests/source-navigation-calibration-targets.test.ts tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts tests/source-registry.test.ts`
  passed with 8 files / 68 tests. Final `npm run verify` passed with build,
  32 test files / 274 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Yelp/TripAdvisor Review Local Recipe Candidate Pass

- Added a Yelp calibration target URL template so `review_reputation.global`
  and `map_local.global` top-slot planning can seed Yelp alongside Google Maps
  and TripAdvisor instead of skipping it for lack of a target URL.
- Added provider-specific manual-only Yelp portal candidates for query/location
  state, category/filter controls, bounded pagination, business-card/rating/
  review capture, menu/review/business-detail destination extraction, external
  website redirect links, and visible obstruction classification.
- Added provider-specific manual-only TripAdvisor portal candidates for search,
  restaurant/hotel/attraction/tourism verticals, sort/filter controls, listing/
  rating/review capture, restaurant/hotel/attraction/user-review destination
  extraction, and visible obstruction classification.
- Recipe-catalog selector hints now scope Yelp discovery to `#main-content`,
  `main`, and `[data-testid*="serp"]`, and TripAdvisor discovery to
  `#BODYCON`, `main`, `[data-automation*="searchResults"]`, and
  `[data-test-target*="search-results"]`.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/source-navigation-recipes.test.ts tests/source-navigation-calibration-targets.test.ts`
  passed with 2 files / 23 tests. Final `npm run verify` passed with build,
  32 test files / 276 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Review Portal Executor Fixture Pass

- Added shared review-portal fixture selectors for Yelp and TripAdvisor recipe
  plans: `#review-query`, `#review-location`, `#review-category`,
  `#review-filter`, `#review-more`, `#review-module`, `#review-card`,
  `#review-meta`, `#review-destination-links`, and
  `#review-obstruction-state`.
- Yelp and TripAdvisor portal recipe plans now report `fixture_verified`
  locally, while their real-site selectors still require repeated calibration
  before maintained export.
- Added safe executor coverage for a Yelp-style and TripAdvisor-style review
  portal flow. The test fills the query, records category/filter state, runs
  bounded pagination, captures listing/rating/review metadata, extracts
  listing/menu/external/review destinations without navigating the parent page,
  and captures obstruction state proving no human-check, login, app-open, or
  bypass action was taken.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts tests/source-navigation-calibration-targets.test.ts`
  passed with 3 files / 51 tests. Final `npm run verify` passed with build,
  32 test files / 277 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Apple Maps Map Local Recipe Fixture Pass

- Added Apple Maps-specific manual-only map/local recipe candidates for search
  query state, open-now/category filter state, map viewport capture,
  selected-place card capture, OCR label capture, and website/menu/review
  destination extraction.
- Added Apple Maps selector-hint container scopes for future discovery
  handoffs: `[role="main"]`, `#maps-app`, and `[data-testid*="map"]`.
- Added explicit Apple Maps calibration-target coverage while keeping the
  current `map_local.global` top-three ordering as Google Maps, Yelp, and
  TripAdvisor.
- Added a safe executor fixture that fills an Apple Maps query, applies an
  open-now filter, captures the viewport and map label, selects a place card,
  captures review context, and extracts website/menu/review destinations
  without clicking route, call, reservation, app-open, login, or account
  controls.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts tests/source-navigation-calibration-targets.test.ts`
  passed with 3 files / 53 tests. Final `npm run verify` passed with build,
  32 test files / 279 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Profile Headed Retry Selector Hint Propagation Pass

- Extended `SourceCoverageReadinessProfileHeadedRetryCommand` with
  `selectorHintFiles` so blocked profile/headed retries preserve selector-hint
  handoffs from matching promotion groups.
- `source-coverage-readiness --format retry-commands` now appends
  `--selector-hints-file <path>` to generated
  `source-coverage-calibrate --headed --browser-channel chrome --profile ...`
  retry commands when the blocked promotion group already produced a
  `selector-hints.tsv` file.
- This keeps TikTok, global community/forum, Korean commerce, Expedia, Google
  Search, and other blocked profile/headed retry batches reproducible from
  prior destination-discovery handoffs instead of dropping selector hints when
  switching to a logged-in or headed browser.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 13 tests.

## Source Coverage Retry Plan Output Pass

- Added `source-coverage-readiness --format retry-plan`, a Markdown QA handoff
  for blocked profile/headed retries.
- The retry plan is ordered by top-slot rank and support tier, preserves
  selector-hint files from matching promotion groups, and prints the profile
  setup command, headed calibration retry command, readiness reasons, and next
  actions for each blocked slot.
- This turns blocked Expedia, TikTok, Korean commerce, Google Search,
  community/forum, and other login/human-check/browser-gated slots into a
  reviewable retry checklist rather than only raw JSON or command lines.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 14 tests. Final `npm run verify` passed with build,
  32 test files / 280 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Bing/Yahoo Search Fixture Executor Pass

- Promoted Bing, Yahoo Search, and Yahoo Japan Search recipe plans from
  `candidate_unverified` to local `fixture_verified` by adding fixture
  selectors for query state, news/image/video vertical tabs, visible filters,
  bounded pagination, result cards, context panels, and destination extraction.
- Added safe executor coverage for all three search providers. The fixture
  fills a query, switches to a news vertical, applies a recent filter, paginates
  once, captures the result card, and extracts visible destination links without
  navigating the parent search page.
- This gives global and Japanese search top-slot work the same local execution
  safety baseline that Naver, Google, and Daum search already had, while
  repeated real-site calibration is still required before maintained live
  action exports.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts tests/source-navigation-calibration-targets.test.ts`
  passed with 3 files / 54 tests. Final `npm run verify` passed with build,
  32 test files / 281 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## TikTok Public Visible Fixture Pass

- Added TikTok-specific public-visible recipe fixture selectors for post
  metadata, profile cards, caption bodies, engagement state, public comment
  previews, video frame capture, overlay text, and destination extraction.
- The TikTok recipe plan now carries fixture selectors beside real-site
  candidates such as `[data-e2e="browse-video"]`, `[data-e2e="video-desc"]`,
  `[data-media-url]`, and `[data-profile-url]`, so public-visible TikTok flows
  are not only covered by the generic Instagram-like fixture.
- Added executor coverage for a public TikTok post fixture. It records that no
  obstruction is present, captures metadata/comment/frame/overlay scopes,
  extracts both anchor and SPA-style destination attributes without navigating
  the parent page, and keeps raw-stream download and social-write actions
  unsupported.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  passed with 2 files / 44 tests. Final `npm run verify` passed with build,
  32 test files / 282 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Provider-Specific Commerce Fixture Pass

- Added provider-specific local commerce fixture selectors for Amazon, Coupang,
  Naver Shopping, Gmarket, and 11st recipe plans.
- Expanded commerce candidates beyond the generic marketplace fixture with
  provider-specific query, filter, sort, pagination, product-list, product-card,
  seller/return, shipping, price-badge, and destination selectors.
- Added Amazon price/list candidates such as `.a-price`, `.a-price-whole`,
  `[data-a-color="price"]`, `[data-component-type*="s-search-result"]`, and
  `.s-result-item`.
- Added 11st list/price candidates such as `[class*="search_content"]`,
  `[class*="c_prd"]`, `[class*="salePrice"]`, and
  `[class*="c_prd_price"]`.
- Added safe executor coverage that runs Amazon, Coupang, Naver Shopping,
  Gmarket, and 11st fixture pages through query entry, visible shipping
  filters, visible sort, bounded pagination, product-card capture,
  seller/return capture, shipping-panel capture, price-badge capture, and
  `extract_destinations` for product/review/seller/brand links.
- The executor test also verifies cart, checkout, purchase, and
  account-changing actions remain unsupported while both anchor and SPA-style
  destination attributes can be preserved for bounded child evidence triage.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-navigation-recipes.test.ts` passed with
  1 file / 13 tests, and
  `npm test -- --run tests/source-navigation-executor.test.ts` passed with
  1 file / 32 tests. Final `npm run verify` passed with build, 32 test files /
  283 tests, local smoke, public web smoke, media smoke, proxy smoke, and 0 npm
  audit vulnerabilities.

## Naver Integrated Search Fixture Pass

- Added Naver integrated-search fixture selectors to the search recipe plan:
  `#naver-integrated-main`, vertical modules for View/Blog/Cafe, News, Place,
  Image, Video, and Shopping, Naver-specific vertical-tab fixture selectors,
  and mixed destination selectors for anchors plus SPA-style destination
  attributes.
- Added a browser-backed executor fixture for the Naver integrated-search shape.
  The test fills query state, switches the News vertical, applies a visible
  recent filter, selects date sort, paginates once, captures each module
  separately, and extracts Blog, Cafe, News, Place, Image, Video, and Shopping
  destinations without clicking through the parent page.
- This gives Naver Search a local regression harness for the exact
  "search-result surface to deeper source candidates" flow before repeated
  real-site calibration promotes maintained actions.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  passed with 2 files / 46 tests, and final `npm run verify` passed with build,
  32 test files / 284 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Google Rich Search Fixture Pass

- Added Google rich-search fixture selectors to the search recipe plan:
  `#google-rich-main`, local/map, news, image, video, mixed destination-link
  modules, and provider-specific News/Images/Videos/Maps vertical-tab fixture
  selectors.
- Extended the browser-backed Google module fixture from map/news/ad-only
  capture to local, map-pack, news, image, video, and sponsored module capture.
- Changed the module destination action to `extract_destinations`, preserving
  organic, news, local, image, and video follow-up candidates without
  navigating the parent search page.
- This gives Google Search local regression coverage for rich SERP module
  evidence and multi-destination extraction before repeated real-site
  calibration promotes maintained actions.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  passed with 2 files / 46 tests, and final `npm run verify` passed with build,
  32 test files / 284 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Bounded Follow-Up Concurrency Pass

- Added `sourceNavigation.followUpConcurrency` and
  `--source-navigation-followup-concurrency` for selected one-depth destination
  child evidence runs.
- The default remains `1`. When explicitly raised, evidence-run executes
  selected follow-up child workflows in bounded batches, then writes parent
  `source_navigation_followup` artifacts in deterministic selected-candidate
  order.
- Final reports now include the effective follow-up concurrency on the source
  navigation follow-up assessment line.
- Added workflow coverage with two delayed child pages and a fixture-side
  concurrency counter, proving that selected child page requests overlap when
  `followUpConcurrency: 2`.
- Verification:
  `npm test -- --run tests/evidence-runner.test.ts tests/mcp-server.test.ts`
  passed with 2 files / 19 tests, and final `npm run verify` passed with build,
  32 test files / 285 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Bounded Depth-2 Deepening Concurrency Pass

- Added `sourceNavigation.deepeningConcurrency` and
  `--source-navigation-deepening-concurrency` for explicit `maxDepth: 2`
  deeper child evidence runs.
- The default remains `1`. When explicitly raised, evidence-run executes
  selected depth-2 child workflows in bounded concurrent batches under the
  existing depth-2 count, per-domain, timeout, and artifact budgets.
- Destination deepening summaries and final reports now include effective
  concurrency.
- Added workflow coverage where one selected child page exposes two delayed
  deeper source-document links; the fixture-side concurrency counter proves the
  two depth-2 child requests overlap when `deepeningConcurrency: 2`.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/evidence-runner.test.ts tests/mcp-server.test.ts`
  passed with 2 files / 20 tests, and final `npm run verify` passed with build,
  32 test files / 286 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Promotion Review Budget Propagation Pass

- Extended `source-navigation-promotion-review` so ready action-file commands
  can include explicit source-navigation follow-up/deepening execution budgets:
  `--source-navigation-max-followups`,
  `--source-navigation-max-followups-per-domain`,
  `--source-navigation-followup-concurrency`, `--source-navigation-max-depth`,
  `--source-navigation-max-deepening-runs`,
  `--source-navigation-max-deepening-runs-per-domain`,
  `--source-navigation-deepening-concurrency`,
  `--source-navigation-deepening-timeout-ms`, and
  `--source-navigation-max-deepening-artifacts`.
- The generated review JSON preserves those options on both the review object
  and ready `evidenceRun` command records, while PowerShell command output
  carries the same flags directly into `evidence-run`.
- `source-coverage-calibrate` now passes the same optional budget flags into
  the coverage loop plan, the generated promotion-review command, and the
  executed promotion-review JSON. This keeps calibration-to-QA handoffs
  reproducible when a reviewed run intentionally uses bounded parallel child
  exploration.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts`
  passed with 3 files / 15 tests. Final `npm run verify` passed with build,
  32 test files / 287 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Bounded Fallback Follow-Up Execution Pass

- Added explicit `sourceNavigation.fallbackFollowUps` and
  `sourceNavigation.maxFallbackFollowUps` workflow options, plus CLI/MCP input
  support through `--source-navigation-fallback-followups` and
  `--source-navigation-max-fallback-followups`.
- The default remains disabled. When enabled, evidence-run uses existing
  destination triage fallback candidates after selected child evidence is
  downgraded, executes a bounded fallback pass for lower-ranked unattempted
  destinations, writes normal `source_navigation_followup` artifacts, expands
  only the effective final top-K/per-domain budgets needed to evaluate the
  attempted fallback candidates, and rebuilds final destination triage with all
  child results.
- Promotion-review and source-coverage calibration-loop handoffs can carry the
  new fallback flags into generated ready `evidence-run` commands.
- Added workflow coverage for the natural-deepening QA case where the first
  selected destination is off-topic/thin and a lower-ranked blog destination
  becomes useful after explicit fallback execution.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/evidence-runner.test.ts tests/mcp-server.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-calibration-loop.test.ts`
  passed with 4 files / 30 tests. Final `npm run verify` passed with build,
  32 test files / 288 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Google/Naver Search Variant Calibration Target Pass

- Added `includeSearchVariants` support to registry-backed calibration target
  generation and the coverage calibration loop.
- `source-navigation-calibration-targets --include-search-variants` now expands
  Google Search into separate News, Images, Videos, and local result targets.
- The same flag expands Naver Search into separate View, News, Images, Videos,
  Place, and Shopping targets.
- `source-coverage-calibrate --include-search-variants` carries those expanded
  targets into readiness-guided plan files and reports a search-variant warning
  so broad search capture readiness stays separate from per-vertical selector
  promotion.
- Hardened the helper expansion path so already variant-suffixed target IDs are
  not expanded again.
- Updated README, AGENTS, the product plan, and the implementation guide with
  the new calibration flag and product boundary.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-navigation-calibration-targets.test.ts tests/source-coverage-calibration-loop.test.ts`
  passed with 2 files / 17 tests, CLI smoke printed Google `tbm=nws`,
  `tbm=isch`, `tbm=vid`, and `tbm=lcl` target lines, plan-only
  `source-coverage-calibrate --include-search-variants` generated 13 Korean
  search calibration targets, and final `npm run verify` passed with build,
  32 test files / 290 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Bounded Calibration Batch Concurrency Pass

- Added `--calibration-concurrency <1-5>` to
  `source-navigation-calibrate-batch` and `source-coverage-calibrate`.
- Batch calibration now runs reviewed read-only calibration attempts in bounded
  concurrent batches while preserving deterministic manifest attempt ordering.
- `calibration-batch-manifest.json` records the effective concurrency, and
  coverage calibration loop plans/reports preserve the same value plus the
  generated `source-navigation-calibrate-batch --calibration-concurrency`
  handoff command.
- `persistent-profile` calibration is kept sequential because parallel attempts
  would reuse the same browser user-data directory. Storage-state and
  ephemeral read-only calibration can opt into bounded concurrency.
- Added batch-helper tests that prove max concurrency is honored and
  `--stop-on-error` stops after the current concurrent batch instead of
  starting the next one.
- Updated README, AGENTS, the product plan, and the implementation guide with
  the new calibration concurrency behavior and profile safety boundary.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-navigation-calibration-batch.test.ts tests/source-coverage-calibration-loop.test.ts`
  passed with 2 files / 13 tests, CLI smoke confirmed a plan-only coverage
  calibration command emits `--calibration-concurrency '2'`, a live two-target
  calibration batch against `example.com` and `example.org` wrote a manifest
  with `concurrency: 2` and 2 succeeded attempts, and final `npm run verify`
  passed with build, 32 test files / 294 tests, local smoke, public web smoke,
  media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Supported Search Variant Coverage Pass

- Extended `--include-search-variants` beyond the first Google/Naver pass.
- Daum/Kakao Search now generates separate News, Blog, Cafe, Images, Videos,
  Place, and Shopping calibration targets.
- Bing now generates Images, Videos, News, and Maps calibration targets.
- Yahoo Search now generates Images, News, and Video calibration targets.
- Yahoo Japan Search now generates Images, Videos, News, Map, Shopping, and
  Chiebukuro/Q&A calibration targets.
- `source-coverage-calibrate --include-search-variants` carries the expanded
  supported-platform targets into readiness-guided calibration plans while
  keeping every vertical as a separate reviewed seed before promotion.
- Updated README, AGENTS, the product plan, and the implementation guide so the
  search-variant boundary is no longer described as Google/Naver-only.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-navigation-calibration-targets.test.ts tests/source-coverage-calibration-loop.test.ts`
  passed with 2 files / 19 tests, CLI smoke printed expected ko-KR, global, and
  ja-JP variant target lines, and plan-only
  `source-coverage-calibrate --include-search-variants --calibration-concurrency 2`
  generated 20 Korean top-slot search targets: 7 Naver, 5 Google, and 8
  Daum/Kakao targets. Final `npm run verify` passed with build, 32 test files /
  294 tests, local smoke, public web smoke, media smoke, proxy smoke, and 0 npm
  audit vulnerabilities.

## Calibration Target Detection Diagnostics Pass

- Added target-level detection metadata to registry-backed calibration plans.
  Targets now preserve parent platform, parent source families, variant ID when
  present, detected platform, and detected source family.
- `source-coverage-calibrate` plans and Markdown reports now summarize detected
  platform counts, detected source-family counts, and cross-platform variant
  targets before any browser run starts.
- This makes vertical target drift explicit. For the Korean search top-slot
  variant plan, `naver_search-news` is detected as `naver_news` / `portal`, and
  `daum_search-news` is detected as `daum_news` / `portal`; promotion/review
  should therefore group those runs under the detected portal-news groups, not
  silently treat them as broad search readiness.
- Updated README, AGENTS, the product plan, and the implementation guide with
  the new detection-diagnostics boundary.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-navigation-calibration-targets.test.ts tests/source-coverage-calibration-loop.test.ts`
  passed with 2 files / 19 tests, and plan-only
  `source-coverage-calibrate --include-search-variants --calibration-concurrency 2`
  wrote target detection counts
  `naver_search=6, naver_news=1, google_search=5, daum_search=7,
  daum_news=1` plus cross-platform variant targets `naver_search-news` and
  `daum_search-news`. Final `npm run verify` passed with build, 32 test files /
  294 tests, local smoke, public web smoke, media smoke, proxy smoke, and 0 npm
  audit vulnerabilities.

## Yahoo Search Vertical Calibration Target Pass

- Corrected Yahoo Search vertical calibration target generation from the stale
  `search.yahoo.com/search/news` style URL to the provider's current vertical
  hosts:
  `images.search.yahoo.com/search/images`,
  `news.search.yahoo.com/search`, and
  `video.search.yahoo.com/search/video`.
- Updated Yahoo Search recipe candidates so those vertical URLs can be captured
  as result-state/vertical evidence without being treated as destination
  follow-up selectors.
- Hardened destination triage so provider vertical search URLs from Yahoo
  Search and Bing are classified as low-value navigation surfaces. This keeps
  result-module calibration separate from genuine external/publisher/product/
  place/media destination evidence.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/destination-triage.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-calibration-targets.test.ts tests/source-strategy.test.ts`
  passed with 4 files / 53 tests, CLI target smoke printed the corrected Yahoo
  Images/News/Videos hosts, and a live read-only Yahoo vertical calibration
  batch with `--calibration-concurrency 2` succeeded for all 3 targets.
  Promotion produced one ready result capture action, while
  `destinationExtraction.readyActionCount` stayed 0 so provider vertical search
  links were not promoted as child destinations. Final `npm run verify` passed
  with build, 32 test files / 296 tests, local smoke, public web smoke, media
  smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Yahoo Japan Vertical Destination Hardening Pass

- Hardened destination triage so Yahoo Japan vertical search URLs for News,
  Maps, Shopping, and Chiebukuro/Q&A are classified as low-value navigation
  surfaces when they appear as extraction candidates from Yahoo Japan search
  pages.
- Hardened recipe catalog promotion so broad page-shell extraction containers
  such as `#contents` cannot become maintained `extract_destinations` recipes.
  Repeated calibration must promote a narrower result-card/module selector
  before child evidence runs are generated.
- Live Yahoo Japan calibration smoke generated 7 targets
  (`search`, Images, Videos, News, Map, Shopping, and Chiebukuro/Q&A) and all
  7 read-only calibration attempts succeeded with `--calibration-concurrency 2`.
- Re-promotion after the broad-container guard exported `.sw-Card` rather than
  broad `#contents` for destination extraction.
- An explicit evidence-run using the promoted action file passed final claim
  gate. The selected Yahoo Travel redirect child page was preserved as evidence
  but downgraded as off-topic/access-denied with fallback retry diagnostics,
  which keeps the run honest instead of claiming useful child evidence.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/destination-triage.test.ts tests/source-navigation-recipe-catalog.test.ts`
  passed with 2 files / 43 tests. Final `npm run verify` passed with build,
  32 test files / 298 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Bing Search Wait, Challenge, And Redirect Hardening Pass

- Ran a live Bing five-target vertical calibration smoke for Search, Images,
  Videos, News, and Maps with `--calibration-concurrency 2`. The batch
  completed, but the 1s wait was too short for stable maintained search-result
  promotion.
- Re-ran base Bing repeated calibration with a 5s wait. That produced stable
  result selectors and a promoted explicit action file. Promotion now blocks
  broad `#b_results` extraction and exports `#b_results .b_algo` for
  destination extraction while keeping broader result containers as capture
  scopes only.
- Added Bing/Microsoft solve-the-task challenge phrases to both browser
  obstruction classification and source-navigation blocked-signal recipes. A
  later live explicit Bing evidence-run hit that challenge surface, recorded
  `bot_block:high`, produced no destination candidates, and passed final claim
  gate with 5 claims / 117 artifacts.
- Added `src/destination-url.ts` search redirect normalization. Destination
  triage now resolves Bing `ck/a?u=...`, Google `/url?q=...` and
  `/aclk?adurl=...`, Naver desktop/mobile redirect params, and Yahoo/Yahoo
  Japan `/RU=...` paths before scoring, de-duplication, selected follow-up
  execution, and per-domain budgeting. The raw redirect href remains preserved
  in source-navigation action metadata.
- Verification so far:
  `npm run build` passed, and
  `npm test -- --run tests/destination-triage.test.ts tests/source-navigation-recipe-catalog.test.ts tests/browser-obstructions.test.ts tests/source-navigation-recipes.test.ts`
  passed with 4 files / 70 tests. Final `npm run verify` passed with build, 32
  test files / 301 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.
- Expanded direct redirect-resolution coverage in `tests/destination-url.test.ts`
  for Bing, Google organic/ad redirects, Naver desktop/mobile redirect params,
  Yahoo/Yahoo Japan RU-path redirects, and bounded nested redirect unwrapping.
  `npm run build` passed, and
  `npm test -- --run tests/destination-url.test.ts tests/destination-triage.test.ts`
  passed with 2 files / 29 tests. Final `npm run verify` passed with build, 33
  test files / 306 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Knowledge Database Executor Fixture Pass

- Added browser-backed executor fixture coverage for Wikipedia, Namuwiki,
  PubMed, data.go.kr, KOSIS, RISS, and KIPRIS knowledge/database surfaces.
- The fixture executes explicit `page-capture`, bounded scroll, and
  `extract_destinations` actions, preserving article bodies, reference lists,
  citation/source links, abstracts, dataset metadata, statistic table metadata,
  academic record metadata, and patent-detail metadata.
- Generic knowledge/database recipe candidates are now marked
  `fixture_verified`, while still keeping edit, login, restricted-download,
  paid full-text, and institutional-access controls out of maintained
  automation.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-navigation-executor.test.ts --testNamePattern "knowledge database"`
  passed with 1 test and 33 skipped in that file, and
  `npm test -- --run tests/source-navigation-recipes.test.ts --testNamePattern "knowledge database"`
  passed with 1 test and 12 skipped in that file.
  `npm test -- --run tests/source-navigation-executor.test.ts tests/source-navigation-recipes.test.ts`
  passed with 2 files / 47 tests. Final `npm run verify` passed with build,
  33 test files / 307 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Google Scholar Knowledge Portal Fixture Pass

- Added local safe-executor fixture coverage for Google Scholar as the portal-
  shaped global knowledge database top-three source.
- The fixture verifies query-state capture, section/filter capture, Scholar
  result-card capture, author/publication metadata, abstract snippets,
  citation/version links, DOI/full-text links, and visible obstruction-state
  capture.
- Google Scholar portal recipe candidates are now marked `fixture_verified`.
  Publisher pages, DOI/full-text pages, cited-by pages, and version clusters
  still require bounded destination evidence before final claims can rely on
  them.
- Verification:
  `npm test -- --run tests/source-navigation-executor.test.ts tests/source-navigation-recipes.test.ts --testNamePattern "Google Scholar|knowledge database"`
  passed with 2 files / 3 tests, and
  `npm test -- --run tests/source-navigation-executor.test.ts tests/source-navigation-recipes.test.ts`
  passed with 2 files / 48 tests. Final `npm run verify` passed with build,
  33 test files / 308 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Yahoo News Portal Fixture Pass

- Added local safe-executor fixture coverage for Yahoo News as the second
  global `news_media` top-slot after Google News.
- Yahoo News portal recipes now include provider-specific query, category/topic
  navigation, recency/filter, main stream, stream item, article-link, and
  obstruction-state selector candidates.
- The fixture verifies query capture, section/filter state, bounded more-
  results capture, headline card and publisher metadata capture, publisher
  follow-up, and obstruction capture without paywall/login bypass, comment
  writes, or unbounded feed crawling.
- Yahoo News portal recipe candidates are now marked `fixture_verified`.
- Verification:
  `npm test -- --run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts --testNamePattern "news portal|Korean and global news"`
  passed with 2 files / 2 tests, and
  `npm test -- --run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  passed with 2 files / 48 tests. Final `npm run verify` passed with build,
  33 test files / 308 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Reuters News Portal Fixture Pass

- Added local safe-executor fixture coverage for Reuters as the third global
  `news_media` top-slot.
- Reuters portal recipes now include provider-specific query/search,
  World/Business/Technology section, latest/filter, app-shell, story-card,
  article-body, related article-link, and obstruction-state selector
  candidates.
- The fixture verifies query capture, section/filter state, bounded more-
  results capture, publisher metadata, headline/body capture, article
  follow-up, and obstruction capture without paywall bypass, comment writes, or
  unbounded feed crawling.
- Reuters portal recipe candidates are now marked `fixture_verified`.
- Verification:
  `npm test -- --run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts --testNamePattern "news portal|Korean and global news"`
  passed with 2 files / 2 tests, and
  `npm test -- --run tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  passed with 2 files / 48 tests. Final `npm run verify` passed with build,
  33 test files / 308 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Global News Real-Site Calibration Pass

- Ran the first repeated read-only real-site calibration for
  `news_media.global` top-three sources using query `AI policy`: Google News,
  Yahoo News, and Reuters.
- The calibration batch used repeat 2 and calibration concurrency 2; all 6
  attempts succeeded.
- Promotion exported maintained read-only action files for all three portals.
  Yahoo News also promoted a maintained `destination-followup`
  `extract_destinations` action.
- Fixed the publisher-news registry/source-family mismatch found by this run:
  Reuters, Bloomberg, BBC, and Yonhap now list `portal` plus `generic_web`, so
  readiness audits match promotion groups detected by `describeSourceStrategy`.
- Re-running source coverage readiness with the live promotion summary returned
  `ok: true`, readyCount 3/3, and destinationExtractionReadyCount 1. Google
  News and Reuters remain capture-ready but destination-extraction not-ready
  until narrower repeated destination selectors are promoted.
- Verification:
  `npm run build` passed,
  `source-coverage-readiness --category news_media --locale global --top-rank 3 --query "AI policy" --promotion-summary <promotion-summary>`
  returned `ok: true`, readyCount 3, and destinationExtractionReadyCount 1, and
  `npm test -- --run tests/source-registry.test.ts tests/source-coverage-readiness.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts`
  passed with 4 files / 65 tests. Final `npm run verify` passed with build,
  33 test files / 309 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Google News Read-Link Destination Extraction Pass

- Added Google News-specific portal recipe candidates for visible search input,
  section/filter state, main result capture, article-card capture, and
  `./read/` article destination extraction.
- Hardened destination triage so Google News provider shell links such as
  Home, For you, Following, Google apps, account, support, policy, and Google
  utility links are non-promotable navigation surfaces, while `/read/` and
  `/articles/` URLs remain promotable news destinations.
- Added fixture coverage proving Google News shell links stay non-promotable
  and read links stay promotable during read-only calibration.
- Live single calibration for `https://news.google.com/search?q=AI+policy`
  matched `main a[href^="./read/"]` and `a[href^="./read/"]` with 200 matches,
  10 visible links, and 10 promotable destinations. Global discovery now
  reports 10 promotable article-read links and 15 non-promotable
  provider/navigation links instead of treating shell navigation as useful.
- Live repeated `source-coverage-calibrate --platform google_news --query
  "AI policy" --repeat 2 --calibration-concurrency 2` succeeded twice and
  promoted maintained explicit actions for `article-capture`,
  `destination-followup`, and `obstruction-check`. Final readiness for
  `google_news` returned `ok: true` with destination extraction ready.
- Explicit Google News `evidence-run` with the promoted action file extracted
  10 article-read destinations, attempted 1 bounded child article run, kept
  retry diagnostics for the 9 budget-limited alternatives, and passed final
  claim gate with 287 artifacts, 4 claims, and 4 citations. The selected child
  article had query overlap but was classified as blocked because the publisher
  page produced browser obstruction evidence.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/destination-triage.test.ts tests/source-navigation-recipes.test.ts tests/source-navigation-calibration.test.ts`
  passed with 3 files / 55 tests. Final `npm run verify` passed with build,
  33 test files / 311 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Reuters Dated-Link And DataDome Hardening Pass

- Added narrower Reuters destination selector candidates for dated article
  links, including story-card, search-result, and `main` path/date selectors.
  Broad Reuters link selectors remain fallback calibration candidates.
- Hardened destination triage so Reuters section, search, privacy, Thomson
  Reuters, and provider utility links are non-promotable navigation surfaces,
  while dated Reuters article paths remain promotable news destinations.
- Hardened recipe promotion so broad selectors such as
  `main a[href*="reuters.com"]` and `article a[href*="reuters.com"]` do not
  become maintained `extract_destinations` exports when narrower dated
  selectors are available.
- Added DataDome/captcha-delivery challenge signals to browser obstruction and
  source-navigation blocked-signal detection. Calibration now evaluates a
  bounded `body.textContent` snapshot as well as visible text so script-only
  challenge shells such as Reuters `var dd={...}` are detected.
- Live Reuters calibration for
  `https://www.reuters.com/site-search/?query=AI%20policy` currently reaches a
  DataDome/captcha-delivery challenge in the unattended browser. After this
  pass it is correctly classified with blockedSignalHits 28 and
  blockedActionCount 7, so Reuters stays not-ready for child article
  extraction until a compliant profile/headed calibration succeeds.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/browser-obstructions.test.ts tests/source-navigation-calibration.test.ts tests/source-navigation-recipes.test.ts tests/destination-triage.test.ts tests/source-navigation-recipe-catalog.test.ts`
  passed with 5 files / 93 tests. Final `npm run verify` passed with build,
  33 test files / 316 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Blocked-Signal Retry Handoff Pass

- Added blocked-signal aggregation to source-navigation promotion summaries.
  Catalog entries with present blocked signals now produce
  `blockedSignalCounts` grouped by signal and action key.
- Promotion review reasons now include blocked signal pressure, so a blocked
  group can state whether it was caused by signals such as
  `captcha-delivery.com`, `var dd=`, Cloudflare, login-wall text, or other
  browser-visible blockers.
- Source coverage readiness and `--format retry-plan` now carry those blocked
  signal counts into profile/headed retry QA handoffs beside selector hints,
  setup commands, retry commands, reasons, and next actions.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts`
  passed with 2 files / 12 tests, and
  `npm test -- --run tests/source-coverage-calibration-loop.test.ts tests/source-navigation-promotion.test.ts tests/source-coverage-readiness.test.ts`
  passed with 3 files / 19 tests. Final `npm run verify` passed with build,
  33 test files / 317 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Coverage-Loop Blocked-Signal Reporting Pass

- Extended `formatSourceCoverageCalibrationLoopReport` so per-source readiness
  lines include matched blocked-signal pressure from coverage readiness items.
  A blocked source now shows signals such as `captcha-delivery.com` or
  `var dd=` directly beside its destination-extraction status in the generated
  Markdown loop report.
- Added regression coverage proving blocked promotion groups propagate those
  counts through the readiness audit into the calibration loop report. This
  keeps plan-only and executed coverage calibration handoffs useful for
  profile/headed retry QA without requiring a reviewer to open raw catalog or
  readiness JSON first.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/source-coverage-calibration-loop.test.ts tests/source-coverage-readiness.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 20 tests. Final `npm run verify` passed with build,
  33 test files / 318 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Coverage-Loop Profile/Headed Retry Report Pass

- Added a `Profile/Headed Retries` section to the coverage calibration Markdown
  report. Blocked source slots now print priority, top-slot rank when present,
  profile name, selector-hint files, blocked-signal pressure, setup command,
  and headed/profile retry command directly in the loop report.
- The report reuses the same readiness retry-plan builder as
  `source-coverage-readiness --format retry-plan`, keeping plan-only and
  executed coverage calibration handoffs aligned with the standalone retry QA
  output.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/source-coverage-calibration-loop.test.ts tests/source-coverage-readiness.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 20 tests. Final `npm run verify` passed with build,
  33 test files / 318 tests, local smoke, public web smoke, media smoke, proxy
  smoke, and 0 npm audit vulnerabilities.

## Coverage Retry-Plan Artifact Pass

- Added `profile-headed-retry-plan.md` to the
  `source-coverage-calibrate` output bundle. Plan-only runs write the retry
  plan from the initial readiness audit, and executed runs overwrite it from
  the final readiness audit after promotion and re-audit.
- Added the retry-plan path to `sourceCoverageCalibrationLoopOutputPaths`, CLI
  JSON output, and the coverage calibration report Files section, so the report
  and machine-readable command output both point at the standalone QA handoff.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-coverage-calibration-loop.test.ts tests/source-coverage-readiness.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 20 tests, and a plan-only
  `source-coverage-calibrate --platform google_search --query "seoul hotel"`
  CLI smoke wrote `profile-headed-retry-plan.md` and referenced it from the
  report. Final `npm run verify` passed with build, 33 test files / 318 tests,
  local smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## Coverage Retry-Plan JSON Artifact Pass

- Added `profile-headed-retry-plan.json` beside the Markdown retry-plan
  artifact in `source-coverage-calibrate` output bundles.
- The JSON file is generated from `buildSourceCoverageReadinessRetryPlan`, so
  future agents and QA scripts can read retry item counts, platforms, profiles,
  selector hints, blocked-signal counts, setup commands, and retry commands
  without scraping Markdown.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-coverage-calibration-loop.test.ts tests/source-coverage-readiness.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 20 tests, and a plan-only
  `source-coverage-calibrate --platform google_search --query "seoul hotel"`
  CLI smoke wrote both retry-plan artifacts, parsed
  `profile-headed-retry-plan.json`, and confirmed the report points at the JSON
  file. Final `npm run verify` passed with build, 33 test files / 318 tests,
  local smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## Coverage Retry-Plan Consumer CLI Pass

- Added `parseSourceCoverageReadinessRetryPlan` and retry-plan command
  formatters so generated `profile-headed-retry-plan.json` files can be
  validated and consumed without custom script parsing.
- Added the read-only `source-coverage-retry-plan --retry-plan <path>` CLI.
  It can print validated JSON, Markdown, all commands, setup-only commands, or
  retry-only commands from the retry-plan handoff without opening browsers.
- Added regression coverage for JSON parse and command subset formatting.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 21 tests, and a CLI smoke confirmed
  `source-coverage-retry-plan --format commands|markdown|json` can read a
  generated-style retry-plan JSON and print setup/retry commands. Final
  `npm run verify` passed with build, 33 test files / 319 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Coverage Retry-Plan Filter Pass

- Added `filterSourceCoverageReadinessRetryPlan` for selecting retry-plan
  items by platform, retry priority, and limit while renumbering the filtered
  handoff.
- Extended `source-coverage-retry-plan` with `--platform`, `--priority`, and
  `--limit`, so a broad blocked coverage plan can emit only the next reviewed
  provider retry, such as Expedia, TikTok, Google Search, or one top-slot item.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 22 tests, and a CLI smoke confirmed
  `--platform expedia` emits only Expedia retry commands while
  `--priority top_slot_blocked --limit 1 --format json` returns one renumbered
  top-slot retry item. Final `npm run verify` passed with build, 33 test files
  / 320 tests, local smoke, public web smoke, media smoke, proxy smoke, and 0
  npm audit vulnerabilities.

## Coverage Retry-Plan Output-File Pass

- Added `--output-file` to `source-coverage-retry-plan`. The command now writes
  the rendered filtered JSON, Markdown, commands, setup-only commands, or
  retry-only commands to disk instead of stdout.
- This lets QA create a small provider-specific retry handoff, such as only
  Expedia retry commands, from a larger `profile-headed-retry-plan.json`
  without copying terminal output.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 22 tests, and a CLI smoke confirmed
  `source-coverage-retry-plan --format retry-commands --output-file <path>`
  writes only the filtered retry command to disk and leaves stdout empty. Final
  `npm run verify` passed with build, 33 test files / 320 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Coverage Retry-Plan Preflight Check Pass

- Added `checkSourceCoverageReadinessRetryPlan` to validate retry-plan command
  handoffs before QA launches profile/headed browser retries.
- Added `source-coverage-retry-plan --format check --fail-check`. The check
  verifies that retry commands include source-coverage-calibrate, platform,
  headed, browser-channel, profile, persistent-profile, selector-hint file
  handoffs, and that setup commands keep auth-login/profile/browser-channel
  shape. It is read-only and does not open browsers.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-coverage-readiness.test.ts tests/source-coverage-calibration-loop.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 23 tests, and CLI smoke confirmed a valid retry-plan
  returns `ok: true` while a broken retry command exits 1 with missing
  headed/browser-channel/profile/persistent-profile/selector-hint issue codes.
  Final `npm run verify` passed with build, 33 test files / 321 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## Coverage Retry-Plan Check Artifact Pass

- Added `profile-headed-retry-plan-check.json` to
  `source-coverage-calibrate` output bundles. Plan-only and executed runs now
  write the preflight check result beside the Markdown/JSON retry-plan
  artifacts.
- The check path is exposed in the command JSON output and the coverage
  calibration report Files section.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-coverage-calibration-loop.test.ts tests/source-coverage-readiness.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 23 tests, and a plan-only
  `source-coverage-calibrate --platform google_search --query "seoul hotel"`
  CLI smoke wrote `profile-headed-retry-plan-check.json`, returned the path in
  command JSON output, and referenced it from the Markdown report. Final
  `npm run verify` passed with build, 33 test files / 321 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Coverage Retry-Plan Check Summary Pass

- Added retry-plan check status to the coverage calibration Markdown Summary.
  Reports now show `Profile/headed retry check: ok|failed` plus error and
  warning counts before the Files section, so QA can see handoff health without
  opening `profile-headed-retry-plan-check.json`.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-coverage-calibration-loop.test.ts tests/source-coverage-readiness.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 23 tests, and a plan-only
  `source-coverage-calibrate --platform google_search --query "seoul hotel"`
  CLI smoke confirmed the report Summary includes the retry-plan check
  ok/error/warning line. Final `npm run verify` passed with build, 33 test
  files / 321 tests, local smoke, public web smoke, media smoke, proxy smoke,
  and 0 npm audit vulnerabilities.

## Coverage Retry-Plan Check Report Detail Pass

- Added a `Profile/Headed Retry Check` section to the coverage calibration
  Markdown report. It lists retry-plan check issue severity, code, item order,
  platform, and message, or states that no retry-plan check issues were found.
- This keeps the Markdown handoff self-contained: reviewers can see both the
  aggregate check status and the exact issue code without opening the JSON
  artifact first.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-coverage-calibration-loop.test.ts tests/source-coverage-readiness.test.ts tests/source-navigation-promotion.test.ts`
  passed with 3 files / 23 tests, and a plan-only
  `source-coverage-calibrate --platform google_search --query "seoul hotel"`
  CLI smoke confirmed the report includes a `Profile/Headed Retry Check`
  section and the `empty_retry_plan` warning line. Final `npm run verify`
  passed with build, 33 test files / 321 tests, local smoke, public web smoke,
  media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Coverage Retry-Plan Selector-Hint File Check Pass

- Added optional selector-hint file existence validation to
  `checkSourceCoverageReadinessRetryPlan`.
- Added `source-coverage-retry-plan --check-files`; when combined with
  `--format check`, the CLI now reports `selector_hint_file_missing` for stale
  `selector-hints.tsv` handoff paths. `--fail-check` exits non-zero for the
  same missing-file condition.
- Updated README, AGENTS, product, implementation, and task docs so retry-plan
  consumers know the default check is command-shape only and `--check-files`
  adds disk existence validation.
- Verification:
  `npm run build` passed,
  `npm test -- source-coverage-readiness` passed with 1 file / 9 tests, CLI
  smoke confirmed missing selector-hint paths fail, existing paths pass, and
  `--fail-check` exits 1 on missing files. Final `npm run verify` passed with
  build, 33 test files / 321 tests, local smoke, public web smoke, media smoke,
  proxy smoke, and 0 npm audit vulnerabilities.

## Coverage Retry-Plan Saved-Profile Check Pass

- Added optional saved browser profile existence validation to
  `checkSourceCoverageReadinessRetryPlan`.
- Added `source-coverage-retry-plan --check-profiles`; when combined with
  `--format check`, the CLI now reports `profile_missing` when a profile/headed
  retry references a local browser profile that has not been created yet.
  `--fail-check` exits non-zero for that missing-profile condition.
- Updated README, AGENTS, product, implementation, and task docs so QA can
  distinguish command-shape checks from disk checks for selector-hint files and
  saved browser profiles.
- Verification:
  `npm run build` passed,
  `npm test -- source-coverage-readiness` passed with 1 file / 9 tests, and
  CLI smoke confirmed the default command-shape check passes for a missing
  profile while `--check-profiles` reports `profile_missing` and
  `--fail-check` exits 1. Final `npm run verify` passed with build, 33 test
  files / 321 tests, local smoke, public web smoke, media smoke, proxy smoke,
  and 0 npm audit vulnerabilities.

## Coverage Calibration Retry-Plan Disk-State Check Pass

- Connected retry-plan disk-state check options to
  `source-coverage-calibrate` output generation.
- Passing `--check-files` or `--check-profiles` to
  `source-coverage-calibrate` now affects both
  `profile-headed-retry-plan-check.json` and the Markdown report's
  `Profile/headed retry check` summary plus issue lines.
- This keeps generated coverage calibration bundles aligned with the
  standalone `source-coverage-retry-plan --format check` behavior, so QA can
  see stale selector-hint paths or missing saved profiles before launching a
  headed/profile retry.
- Verification:
  `npm run build` passed,
  `npm test -- source-coverage-calibration-loop source-coverage-readiness`
  passed with 2 files / 18 tests, and CLI smoke confirmed
  `source-coverage-calibrate --plan-only --check-profiles` writes
  `profile_missing` to the generated check JSON and Markdown report for a
  blocked retry plan referencing a missing saved browser profile. Final
  `npm run verify` passed with build, 33 test files / 322 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Coverage Retry-Plan Check-Passing Filter Pass

- Added `filterSourceCoverageReadinessRetryPlanByCheck` for keeping only retry
  plan items that have no preflight check errors.
- Added `source-coverage-retry-plan --only-check-ok`. The flag applies after
  platform/priority/limit filtering and before rendering JSON, Markdown,
  all-command, setup-command, or retry-command output.
- The filter uses the selected `--check-files` and `--check-profiles` options,
  so QA can print only blocked-provider retry commands whose selector-hint
  files and saved browser profiles are currently prepared.
- Verification:
  `npm run build` passed,
  `npm test -- source-coverage-readiness` passed with 1 file / 10 tests, and
  CLI smoke confirmed `source-coverage-retry-plan --format retry-commands
  --check-profiles --only-check-ok` keeps an item with an existing saved
  profile while dropping another item with a missing profile. Final
  `npm run verify` passed with build, 33 test files / 323 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Naver Map Path-Scoped Destination Candidate Pass

- Added narrower Naver Map destination extraction recipe candidates for
  Naver Place restaurant, hospital, generic place, and accommodation paths.
  Candidates cover `data-place-url`, `data-url`, and anchor surfaces before
  broad `place.naver.com` / `map.naver.com` fallbacks.
- Extended the local map executor fixture with Naver Place destination
  attributes and anchors. The fixture now verifies
  `#root [data-place-url*="place.naver.com/restaurant"]` can extract a
  `https://place.naver.com/restaurant/...` child destination without clicking
  route, call, reservation, or booking controls.
- Real-site Naver Map remains capture-ready but not maintained
  natural-deepening-ready until repeated browser-visible calibration promotes
  these narrower selectors.
- Verification:
  `npm run build` passed,
  `npm test -- source-navigation-recipe-catalog source-navigation-recipes
  source-navigation-executor` passed with 3 files / 70 tests, and CLI smoke
  confirmed
  `source-navigation-recipes --url <naver-map-search-url>` emits the new
  restaurant, hospital, and accommodation scoped selectors. Final
  `npm run verify` passed with build, 33 test files / 323 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Naver Place Client-State Destination Extraction Pass

- Added a generic frame-aware BrowserPool client-state snapshot API. It reads a
  plain `window.<property>` value from each Playwright-accessible frame without
  embedding provider-specific parsing in BrowserPool.
- Added explicit `extract_client_state_destinations` source-navigation actions.
  The first extractor, `naver_place_apollo`, parses browser-received
  `window.__APOLLO_STATE__` and derives bounded Naver Place child destinations
  from structured place records containing IDs, names, category/address, and
  map/review signals.
- This addresses the latest Naver Map live finding: the Place list iframe can
  render place cards, reviews, categories, and addresses while visible anchors
  remain shell `#` buttons and no usable `data-place-url` / `data-url`
  attributes are present.
- Added local executor fixture coverage. The map fixture now includes
  Naver Place-like Apollo records and verifies that an explicit action can emit
  `https://place.naver.com/restaurant/<id>` follow-up requests without clicking
  route, call, reservation, booking, login, or account-changing controls.
- Next: wire this action into Naver Map recipe/catalog/promotion readiness so
  repeated live calibration can promote state-bearing `#app-root` /
  `#_pcmap_list_scroll_container` frames separately from ordinary
  `extract_destinations` link selectors.
- Verification:
  `npm run build` passed, and `npm test -- source-navigation-executor` passed
  with 1 file / 36 tests.

## Naver Place Client-State Live Iframe Hardening Pass

- Re-ran the explicit Naver Map client-state action against the live Korean
  query `성수 카페`. The first live run failed because `#app-root` lives inside
  the Naver Map result iframe and the optional selector wait was top-frame-only.
- Changed `extract_client_state_destinations` selector validation to use
  frame-aware `BrowserPool.inspectSelector`, matching the calibration path and
  avoiding false failures on iframe-rendered portal result panels.
- Added executor fixture coverage where `window.__APOLLO_STATE__` exists only
  inside a visible iframe. The test verifies that the explicit action extracts
  two `https://place.naver.com/restaurant/<id>` follow-up destinations from the
  iframe state.
- Live verification after the fix extracted 2 Naver Place restaurant
  candidates from `window.__APOLLO_STATE__`, executed 1 bounded child follow-up,
  and passed final claim-gate. Destination triage still reported 0 useful child
  destinations because the selected Place child page produced empty
  browser-visible text, with one unattempted fallback candidate and retry advice
  to increase `--source-navigation-max-followups` to 2.
- Next: improve Naver Place child evidence density through scoped child
  captures, OCR over rendered Place pages, or provider-specific visible text
  extraction before promoting this path as maintained useful-evidence ready.
- Verification:
  `npm run build` passed, `npm test -- source-navigation-executor` passed with
  1 file / 37 tests, and the live Naver Map evidence-run passed final
  claim-gate with 2 destination candidates and 1 completed child follow-up.
  Final `npm run verify` passed with build, 33 test files / 325 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## Frame-Aware Child Evidence Density Pass

- Changed browser page capture to aggregate visible text from every
  Playwright-accessible frame instead of relying only on top-document
  `body.innerText()`.
- Page-capture metadata now records `visibleTextFrames` with frame counts,
  text-bearing frame counts, frame URLs, text lengths, truncation flags, and
  text snippets. This gives QA a direct signal when useful child evidence lives
  in an embedded portal/place/result frame.
- Page-capture visible-link metadata is now frame-aware as well, so destination
  deepening proposals can see accessible iframe links instead of only
  top-document anchors.
- Added BrowserPool fixture coverage for iframe-only visible text and iframe
  destination links.
- Added evidence-runner workflow coverage proving that a selected child
  destination whose query-matching text is rendered only inside an iframe gets
  `visible_text`, `query_overlap`, and a useful destination triage verdict.
- This is the first Naver Place child evidence-density hardening step. Live
  Naver Place still needs accessible child-page validation, OCR over rendered
  pages, and scoped capture tuning before maintained useful-evidence readiness.
- Verification:
  `npm run build` passed, `npm test -- browser-pool` passed with 1 file /
  14 tests, and `npm test -- evidence-runner` passed with 1 file / 18 tests.
  Final `npm run verify` passed with build, 33 test files / 327 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## Child Capture Failure Signal Pass

- Tightened destination child evidence summaries so `browserCaptureRecords`
  counts only successful page-capture artifacts.
- Failed or partial child page opens are now reported separately through
  `browserCaptureFailedRecords`, `browser_capture_failed`, and
  `failed_browser_capture`.
- Added workflow coverage for a selected child destination whose page open
  fails. The test verifies that the failed child is downgraded, receives
  `missing_browser_capture` / `failed_browser_capture`, and does not receive
  the successful `browser_capture` signal.
- This keeps Naver Place, portal, commerce, and community child destinations
  from looking evidence-ready when the workflow only produced a failed capture
  artifact.
- Verification:
  `npm run build` passed, `npm test -- evidence-runner` passed with 1 file /
  19 tests, `npm test -- destination-triage evidence-runner` passed with
  2 files / 45 tests, and `npm test -- browser-pool` passed with 1 file /
  14 tests. Final `npm run verify` passed with build, 33 test files / 328
  tests, local smoke, public web smoke, media smoke, proxy smoke, and 0 npm
  audit vulnerabilities.

## Naver Place Entry Fallback And Service-Limit Obstruction Pass

- Changed Naver Place client-state destination extraction so child evidence
  runs use executable `https://map.naver.com/p/entry/place/<id>` URLs while
  preserving canonical `https://place.naver.com/<type>/<id>` provenance as
  `originalUrl` with `urlResolutionMethod: "naver_place_entry_fallback"`.
- Destination candidate artifacts now preserve request-level
  `originalUrl/urlResolutionMethod` even when the executable URL is not a
  search redirect. Source-navigation action metadata also records
  `extractedOriginalDestinationUrls` for client-state extraction.
- Added destination-triage coverage proving Naver Map entry fallback
  destinations stay `map_place` evidence and are not treated as provider shell
  links.
- Added Naver Map/Place service-limit obstruction signals. Browser-visible
  service-use restriction and excessive-access messages are now classified as
  `bot_block`, so Naver throttling downgrades selected child destinations as
  blocked instead of weak or off-topic evidence.
- Live verification against the Korean Naver Map `seongsu cafe` query extracted
  2 client-state candidates, attempted 1 child run at
  `https://map.naver.com/p/entry/place/1790076538`, recorded successful child
  browser captures, detected 2 obstruction artifacts from the visible Naver
  service-limit page, and passed final claim-gate. The run still produced 0
  useful child destinations, so Naver Place remains explicit extraction-ready
  but not maintained useful-evidence-ready.
- Verification:
  `npm run build` passed,
  `npm test -- source-navigation-executor destination-triage` passed with
  2 files / 64 tests,
  `npm test -- evidence-runner destination-url` passed with 2 files / 24 tests,
  and `npm test -- browser-obstructions evidence-runner destination-triage
  source-navigation-executor` passed with 4 files / 97 tests. Final
  `npm run verify` passed with build, 33 test files / 330 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Naver Map Client-State Recipe Promotion Pass

- Added a manual-only Naver Map `extract_client_state_destinations` recipe
  candidate under the existing `destination-followup` planned action. It uses
  reviewed `#app-root`, `#_pcmap_list_scroll_container`, and `#root` selectors
  plus `__APOLLO_STATE__`, `naver_place_apollo`, `restaurant`, and `maxLinks:
  10` defaults.
- This turns the previously manual action JSON path into a calibratable recipe
  candidate, while keeping execution explicit and opt-in.
- Changed recipe-catalog calibration grouping from action key only to
  `actionKey + operation`, so Naver Map link extraction and client-state
  extraction can be calibrated independently even though both map to
  `destination-followup` at execution time.
- Maintained recipe export now deduplicates executable actions by action key.
  If both alternatives are maintained, only the first maintained executable
  action is exported; if link extraction is not ready but client-state
  extraction is ready, the client-state action file is exported.
- Promotion destination-extraction summaries now include both
  `extract_destinations` and `extract_client_state_destinations`, so readiness
  audits can count client-state destination extraction as a destination
  follow-up path.
- Verification:
  `npm run build` passed,
  `npm test -- source-navigation-recipes source-navigation-recipe-catalog
  source-navigation-promotion` passed with 3 files / 43 tests, and CLI smoke
  confirmed `source-navigation-recipes --url https://map.naver.com/p/search/cafe`
  emits `extract_client_state_destinations`, `#app-root`, and
  `__APOLLO_STATE__`. Final `npm run verify` passed with build, 33 test files
  / 332 tests, local smoke, public web smoke, media smoke, proxy smoke, and
  0 npm audit vulnerabilities.

## Source Coverage Client-State Destination Readiness Pass

- Connected source-coverage destination-extraction readiness to the same
  operation family used by recipe promotion. Planned candidate counts now
  include both `extract_destinations` and
  `extract_client_state_destinations`.
- This closes the QA handoff gap for Naver Map: coverage readiness now sees
  the newly added client-state destination extraction candidate in addition to
  ordinary link extraction, so the `map_local` / `ko-KR` Naver Map audit shows
  2 planned destination-extraction candidates before promotion.
- Updated readiness reasons, warnings, and next actions to say
  destination-extraction actions instead of only `extract_destinations`
  actions. That wording now covers Naver Map client-state extraction and later
  non-link extraction operations.
- Verification:
  `npm test -- --run tests/source-coverage-readiness.test.ts` passed with
  1 file / 10 tests, `npm run build` passed, and CLI smoke confirmed
  `source-coverage-readiness --category map_local --locale ko-KR --query
  "seongsu cafe" --format json` reports Naver Map
  `destinationExtraction.candidateCount: 2`. Final `npm run verify` passed
  with build, 33 test files / 332 tests, local smoke, public web smoke, media
  smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Client-State Calibration Probe Pass

- Added read-only client-state destination probe diagnostics to source
  navigation calibration. For `extract_client_state_destinations`, calibration
  now reads the configured browser client-state key, runs the shared
  `naver_place_apollo` extractor, and records whether unique destination
  candidates were actually derived.
- The calibration report now preserves client-state probe status, state key,
  extractor, destination path, frame counts, matched frame counts,
  parsed/truncated frame counts, raw/unique candidate counts, sample executable
  URLs, canonical original URLs, sample texts, and sample frame URLs.
- Moved Naver Place client-state destination parsing into
  `src/client-state-destinations.ts`, so source-navigation executor and
  read-only calibration use the same parser and URL fallback rules.
- Hardened recipe catalog promotion for client-state extraction. Repeated
  visible selector matches alone no longer promote a maintained
  `extract_client_state_destinations` action; repeated successful
  client-state probes with unique destination candidates are required for
  maintained export. A single successful probe may still be copied as
  `single_run_ready`, while zero successful probes remain
  `calibration_required`.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-navigation-calibration.test.ts
  tests/source-navigation-recipe-catalog.test.ts
  tests/source-navigation-executor.test.ts` passed with 3 files / 81 tests,
  and `npm test -- --run tests/source-navigation-promotion.test.ts
  tests/source-coverage-readiness.test.ts` passed with 2 files / 17 tests.
  Final `npm run verify` passed with build, 33 test files / 334 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## Naver Map Client-State Live Promotion QA Pass

- Added client-state probe aggregate counts to promotion and coverage
  readiness summaries:
  `clientStateProbeRunCount`, `clientStateProbeOkRunCount`, and
  `clientStateProbeUniqueCandidateCount`.
- Coverage calibration Markdown readiness lines now include client-state probe
  counts when present, so QA can see whether a maintained client-state
  destination route was backed by actual parsed browser state rather than only
  selector visibility.
- Re-ran live Naver Map coverage calibration for the Korean query `성수 카페`
  with repeat 2, 5s page wait, 60s navigation timeout, and 5s selector timeout.
  Both calibration attempts succeeded.
- Promotion marked the Naver Map group `ready` and exported 3 maintained
  actions: `map-viewport`, `map-ocr`, and `destination-followup`.
  Destination extraction was `ready` with 1 ready action out of 2 candidates.
- The client-state probe aggregate showed 2 successful probe runs and 178
  unique parsed destination candidates in the latest live run.
- Ran the promoted action file through `evidence-run`. The parent run extracted
  10 Naver Place candidates from client state and attempted 1 child follow-up.
  The child reached the Naver Map entry page, but Naver returned a visible
  service-limit page; destination triage reported `partial`, `blockedCount: 1`,
  `usefulCount: 0`, fallback candidates, retry advice, and final claim-gate
  `ok: true`.
- Interpretation: Naver Map client-state natural deepening is now maintained
  extraction-ready, but unattended useful-child evidence still needs Naver
  Place child-page density/obstruction handling.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-navigation-promotion.test.ts
  tests/source-coverage-readiness.test.ts
  tests/source-coverage-calibration-loop.test.ts` passed with 3 files /
  26 tests, both live Naver Map coverage calibration and promoted
  `evidence-run` passed, and final `npm run verify` passed with build,
  33 test files / 334 tests, local smoke, public web smoke, media smoke,
  proxy smoke, and 0 npm audit vulnerabilities.

## Blocked Child Recovery Candidate Summary Pass

- Added blocked-child recovery candidate summaries to destination triage.
  When a selected child destination is downgraded as blocked, paywalled, or
  private, or has browser-obstruction warnings, triage now preserves any
  visible deeper candidates as QA recovery hints.
- These recovery hints are recorded as
  `blockedChildRecoveryCandidateCount` and
  `blockedChildRecoveryCandidates`. They are not promoted into
  `destination_deepening_proposal` artifacts and are not executed by default,
  preserving the gate/bot-block boundary.
- Added a final report line so blocked child recovery candidates are visible
  without opening raw triage JSON.
- Re-ran the promoted Naver Map client-state action file through
  `evidence-run`. The run extracted 10 parent Place candidates, attempted 1
  child, detected the visible Naver service-limit page, and reported
  `blockedChildRecoveryCandidateCount: 1` with a
  `pcmap.place.naver.com/restaurant/.../home` recovery candidate. Final
  claim-gate remained `ok: true`.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/destination-triage.test.ts
  tests/evidence-runner.test.ts` passed with 2 files / 47 tests. Final
  `npm run verify` passed with build, 33 test files / 335 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Blocked Child Recovery Advice Pass

- Added structured `blockedChildRecoveryAdvice` to destination triage. When an
  obstructed selected child exposes deeper visible candidates, the summary now
  records profile/headed retry command hints, sampled recovery URLs, and
  reasons that make the policy explicit.
- The advice deliberately keeps default depth-2 execution disabled. A blocked
  child recovery candidate is a QA handoff for user-controlled profile/headed
  validation or direct reviewed URL capture, not an automatic gate bypass.
- Added a final report line for blocked-child recovery advice, so QA can see
  the command hints and policy reasons from the Markdown report.
- Added workflow fixture coverage where a bounded destination reaches a
  visible login-wall child, preserves a deeper recovery URL, marks the child
  blocked, reports `retryRecommended: true`, and emits no default depth-2
  proposal.
- Hardened the generated recovery commands to use a deterministic recovery
  profile name, `persistent-profile` storage, `chrome` browser channel, setup
  URL, recovery URL, and complete PowerShell commands for both `auth-login`
  and headed `evidence-run`. This keeps the user-controlled profile used for
  setup aligned with the browser used for replay.
- Added ordered machine-readable recovery steps to
  `blockedChildRecoveryAdvice`: `profile_setup` and
  `recovery_evidence_run`, each with `argv`, `powershellCommand`, and purpose
  text. `commandHints` is derived from these steps, so report text and JSON
  automation cannot drift.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/destination-triage.test.ts
  tests/evidence-runner.test.ts` passed with 2 files / 48 tests. Final
  `npm run verify` passed with build, 33 test files / 336 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Destination Recovery Plan Consumer Pass

- Added `src/destination-recovery-plan.ts`, a read-only consumer for completed
  evidence-run directories.
- The consumer scans `artifacts.jsonl` for `destination_triage` artifacts,
  falls back to raw/structured artifact discovery when the ledger is missing,
  extracts `blockedChildRecoveryAdvice`, deduplicates repeated retry commands,
  and returns a `destination_blocked_child_recovery_plan_only` JSON plan.
- Added formatters for JSON consumers, Markdown QA handoffs, all commands,
  setup-only commands, and retry-only commands.
- Added `destination-recovery-plan --run-dir <evidence-run-dir>` to the CLI,
  with `--format json|markdown|commands|setup-commands|retry-commands`,
  `--output-file`, and `--fail-empty`.
- Added `destination-recovery-plan --format check` with command-shape
  validation, `--check-profiles` saved-profile readiness checks, `--fail-check`
  for non-zero exit on check errors, and `--only-check-ok` filtering for
  command output.
- Exported the recovery-plan helpers from `src/index.ts` and documented the
  command in README, AGENTS, product, task, and implementation docs.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/destination-recovery-plan.test.ts
  tests/destination-triage.test.ts tests/evidence-runner.test.ts` passed with
  3 files / 53 tests. CLI smoke confirmed
  `destination-recovery-plan --run-dir <missing-dir> --format json`,
  `--format check --check-profiles`, and
  `--format retry-commands --only-check-ok --check-profiles` return read-only
  empty-plan outputs without opening a browser. Final `npm run verify` passed
  with build, 34 test files / 341 tests, local smoke, public web smoke, media
  smoke, proxy smoke, and 0 npm audit vulnerabilities.

## Destination Recovery Markdown Preflight Pass

- Updated `formatDestinationRecoveryPlanMarkdown` so Markdown handoffs can
  include the same read-only preflight result as `--format check`.
- `destination-recovery-plan --format markdown` now renders a `Preflight Check`
  section with ok/error/warning counts, issue codes, affected item/profile
  names, and command/profile readiness notes. Passing checks explicitly say no
  preflight issues were found.
- With `--check-profiles`, Markdown output now shows missing saved Chrome
  persistent profiles inline beside the setup/retry commands, so QA does not
  need to run a separate check command before deciding whether to run setup
  first.
- Verification:
  `npm run build` passed, and
  `npm test -- --run tests/destination-recovery-plan.test.ts` passed with 1
  file / 5 tests.

## Source Coverage Retry Markdown Preflight Pass

- Updated `formatSourceCoverageReadinessRetryPlanMarkdown` so source-coverage
  profile/headed retry Markdown handoffs can include the same read-only
  preflight result as `source-coverage-retry-plan --format check`.
- `source-coverage-readiness --format retry-plan`,
  `source-coverage-retry-plan --format markdown`, and generated
  `profile-headed-retry-plan.md` files now render a `Preflight Check` section
  with ok/error/warning counts, issue codes, affected retry item/platform, and
  command/profile/selector-hint readiness notes.
- `source-coverage-calibrate` now writes `profile-headed-retry-plan.md` with
  the same check result that it writes to `profile-headed-retry-plan-check.json`,
  so generated QA bundles keep commands and disk-state readiness together.
- Verification:
  `npm run build` passed,
  `npm test -- --run tests/source-coverage-readiness.test.ts` passed with 1
  file / 10 tests, and CLI smoke confirmed
  `source-coverage-readiness --category search --locale ko-KR --format
  retry-plan` renders a `Preflight Check` section. Plan-only
  `source-coverage-calibrate --check-profiles` smoke confirmed generated
  `profile-headed-retry-plan.md` includes the same preflight section. Final
  `npm run verify` passed with build, 34 test files / 341 tests, local smoke,
  public web smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## English-Language Source Registry Expansion Pass

- Expanded `SOURCE_REGISTRY_COVERAGE_REQUIREMENTS` with mandatory `en-US`
  representative coverage for public search, social feed, content/media,
  community/forum, news/media, review/reputation, map/local, marketplace/
  transaction, and knowledge/database categories.
- Added `en-US` top slots to existing Google, Bing, Yahoo Search, Instagram,
  TikTok, X/Twitter, Reddit, YouTube, Quora, Stack Overflow, Google News,
  Yahoo News, Reuters, Google Maps, Yelp, TripAdvisor, Apple Maps, Amazon,
  Wikipedia, Google Scholar, and PubMed registry entries.
- Added Walmart and eBay as explicit English-language commerce registry entries
  with calibration target support already available through
  `source-navigation-calibration-targets`.
- Added source-registry test coverage proving representative `en-US` top-three
  slots for search, news, map/local, marketplace, and knowledge/database
  categories. These remain strategic calibration seeds, not refreshed
  market-share claims.
- Verification:
  `npm test -- --run tests/source-registry.test.ts
  tests/source-navigation-calibration-targets.test.ts
  tests/source-coverage-readiness.test.ts` passed with 3 files / 35 tests,
  `npm run build` passed, and CLI smoke confirmed
  `source-navigation-calibration-targets --category marketplace_transaction
  --locale en-US --query "wireless earbuds" --format lines` emits Amazon,
  Walmart, and eBay calibration targets first. Final `npm run verify` passed
  with build, 34 test files / 343 tests, local smoke, public web smoke, media
  smoke, proxy smoke, and 0 npm audit vulnerabilities.

## English Commerce Fixture Coverage Pass

Extended the `en-US` marketplace registry work into executable local workflow
coverage:

- added Walmart and eBay to provider-specific commerce recipe fixture
  verification alongside Amazon, Coupang, Naver Shopping, Gmarket, and 11st
- added Walmart product/list, price, seller, and destination extraction
  candidates including visible `/ip/` product links and product/item/seller URL
  attributes
- added eBay result/list, price, seller, and destination extraction candidates
  including `.srp-results`, `.s-item`, `/itm/` links, and item/product/seller
  URL attributes
- expanded the safe executor commerce fixture to run Walmart and eBay through
  query entry, visible filter/sort/pagination state, product-card capture,
  seller/shipping capture, price-badge capture, and product/review/seller/brand
  destination extraction without cart, checkout, purchase, or account mutation

Verification:

- `npx vitest run tests/source-navigation-recipes.test.ts
  tests/source-navigation-calibration-targets.test.ts
  tests/source-registry.test.ts` passed with 3 files / 38 tests.
- `npx vitest run tests/source-navigation-executor.test.ts --testTimeout
  60000` passed with 1 file / 37 tests.
- CLI smoke confirmed `source-navigation-recipes --url
  "https://www.walmart.com/search?q=laptop"` and
  `source-navigation-recipes --url
  "https://www.ebay.com/sch/i.html?_nkw=laptop"` both return
  `verificationStatus: "fixture_verified"`.
- Final `npm run verify` passed with build, 34 test files / 343 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## English Search Live Calibration Pass

Moved the `search.en-US` top-slot work from registry planning into live
read-only calibration evidence:

- ran repeated `source-coverage-calibrate` for Google Search, Bing, and Yahoo
  Search with query `tokyo hotel`
- Google Search was blocked by browser-visible unusual-traffic / CAPTCHA / not-
  a-robot signals in the unattended browser
- Bing was blocked by browser-visible solve-the-task challenge signals in the
  unattended browser
- Yahoo Search completed two read-only calibration runs and promoted one
  maintained `result-selection:capture` action for explicit evidence-run usage
- the first Yahoo pass exposed a destination discovery false positive:
  `www.yahoo.com` home and `yahoo.uservoice.com` feedback links were being
  surfaced as promotable selector hints
- hardened `providerBoilerplateSurface` so Yahoo Search home, settings/help/
  support/account/search utility surfaces, and Yahoo UserVoice feedback links
  are classified as low-value provider-shell destinations
- re-ran Yahoo Search calibration after the fix; the read-only capture action
  remained ready, while destination discovery reported 0 promotable candidates,
  22 non-promotable candidates, and 0 selector hints
- ran the generated Yahoo Search action file through `evidence-run`; final
  claim gate passed with 57 artifacts and 4 claims

Verification:

- `npx vitest run tests/destination-triage.test.ts
  tests/source-navigation-calibration.test.ts
  tests/source-navigation-recipe-catalog.test.ts` passed with 3 files / 72
  tests.
- `npm run build` passed.
- Final `npm run verify` passed with build, 34 test files / 343 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## Google Search Profile Calibration Regating Pass

Recovered the English Search Google slot through the authenticated Chrome
profile instead of the unattended browser:

- re-ran repeated Google Search calibration for `tokyo hotel` with
  `google-search-cdp`, `--persistent-profile`, and Chrome channel; both
  attempts completed with 0 blocked-signal hits
- promotion exported maintained `result-selection:capture` and
  `destination-followup:extract_destinations` actions for explicit opt-in
  evidence-run usage
- the first profile-backed pass exposed Google utility false positives:
  WebHP/Home links, Labs Search, Google apps/products pages, Search verticals,
  and Maps vertical navigation links were appearing as destination selector
  hints
- hardened `providerBoilerplateSurface` so those Google utility/navigation
  surfaces are classified as low-value provider-shell destinations when they
  are discovered from Google Search
- preserved actual result destinations as promotable discovery hints, including
  Wikipedia, Booking.com, Expedia, TokioHotel.com, TripAdvisor, and Google
  Travel candidates
- re-ran the profile-backed calibration after the hardening; the Google utility
  and Maps-vertical false positives disappeared from selector hints
- ran the generated Google Search action file through profile-backed
  `evidence-run`; final claim gate passed with 138 artifacts and 4 claims
- a wider Google follow-up retry exposed a profile-lock bug: parent Google
  Search held the `google-search-cdp` profile while child destination runs
  tried to acquire the same profile, producing failed/empty child captures
- fixed child evidence runs so they use an ephemeral context when the parent
  workflow already holds a saved profile or storage-state lock
- added regression coverage proving a profiled parent source-navigation run can
  execute a child destination follow-up without `profile_in_use`
- the corrected wide Google retry produced browser-visible child captures for
  5 destinations; destination triage reported 3 useful child destinations and
  2 blocked child destinations
- hardened Korean travel bot/access-limit obstruction classification after
  TripAdvisor returned Korean "access temporarily limited", "additional
  verification required", and "suspected robot" text; that child is now
  blocked evidence instead of useful evidence
- the first corrected wide Google retry passed final claim gate, but exposed a
  destination intent false positive: the `tokyo hotel` hotel-commerce query
  still treated the `Tokio Hotel` Wikipedia/music entity result as useful child
  evidence because visible result text and URLs contained a bare `hotel` token
- hardened destination query-intent child usefulness so specialized intents
  require matching child evidence. A singular `hotel` token or `Tokio_Hotel`
  entity URL no longer makes Wikipedia, YouTube, or artist-homepage candidates
  commerce evidence, and price/offer reason codes now use the same commerce
  evidence pattern instead of broad substring matching
- the latest corrected Google wide run passed final claim gate with 130
  artifacts and 4 claims, selected Booking.com, Expedia, TripAdvisor, Agoda,
  and Google Travel for bounded child capture, marked Booking.com, Agoda, and
  Google Travel as useful commerce evidence, marked TripAdvisor plus Expedia as
  blocked travel evidence, and rejected Wikipedia/TokioHotel/YouTube candidates
  as generic or media fallback candidates rather than useful hotel evidence
- extended Google Search manual recipe candidates with travel/hotel module
  coverage after Google Travel proved useful in the live `tokyo hotel` run.
  Search recipes now include Google travel/hotel capture scopes,
  `/travel/hotels` and `/travel/search` extraction selectors, Google Travel
  fixture links, and SPA-style hotel/travel/offer destination attributes
- extended browser-visible destination extraction so `data-travel-url`,
  `data-hotel-url`, and `data-offer-url` are first-class supported destination
  attributes for SPA-style travel/search cards
- re-ran profile-backed Google Search calibration for `tokyo hotel` after
  adding the travel/hotel selectors. The live pass showed that broad
  `div:has(... ) a[href]` extraction selectors can over-select unrelated
  Google results, so broad Google news/video/travel extraction candidates were
  removed while direct module links and capture scopes remain
- added maintained-export selector preference for `extract_destinations`.
  Repeated calibration now treats `#rso` as a broad shell and prefers
  destination-specific selectors such as `#search a[href*="/travel/hotels"]`
  over generic organic heading/video links when both are stable
- the regated repeated Google calibration passed with 0 blocked-signal hits, 72
  selector candidates, 23 matched selectors, 125 capture-scope candidates, and
  21 matched capture scopes. The direct `/travel/hotels` selector extracted a
  single Google Travel hotel URL
- exported maintained actions from those two calibration runs now use
  `destination-followup:extract_destinations` with
  `#search a[href*="/travel/hotels"]`
- the focused profile-backed Google Travel `evidence-run` passed final claim
  gate with 154 artifacts and 5 claims. It requested exactly 1 follow-up to
  `https://www.google.com/travel/hotels/Tokyo`; destination triage reported 1
  commerce candidate, 1 selected, 1 useful, 0 blocked, 0 off-topic, and no
  retry recommendation

Verification so far:

- `npx vitest run tests/destination-triage.test.ts
  tests/source-navigation-calibration.test.ts
  tests/source-navigation-recipe-catalog.test.ts` passed with 3 files / 72
  tests.
- `npx vitest run tests/browser-obstructions.test.ts
  tests/evidence-runner.test.ts --testNamePattern "Korean travel|active parent
  profile"` passed with 2 tests.
- `npx vitest run tests/browser-obstructions.test.ts
  tests/evidence-runner.test.ts` passed with 2 files / 36 tests.
- `npx vitest run tests/destination-triage.test.ts` passed with 1 file / 29
  tests after the destination intent refinement.
- `npx vitest run tests/source-navigation-recipes.test.ts
  tests/source-navigation-executor.test.ts --testTimeout 60000` passed with 2
  files / 50 tests after the Google travel/hotel extraction fixture pass.
- `npx vitest run tests/source-navigation-recipe-catalog.test.ts
  tests/source-navigation-recipes.test.ts` passed with 2 files / 38 tests after
  the maintained-export selector preference pass.
- `npx vitest run tests/source-navigation-recipe-catalog.test.ts
  tests/source-navigation-recipes.test.ts tests/source-navigation-executor.test.ts
  --testTimeout 60000` passed with 3 files / 75 tests after the focused Google
  Travel export/evidence-run pass.
- `npm run build` passed.
- Final `npm run verify` passed with build, 34 test files / 346 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.
- CLI smoke confirmed `source-navigation-recipes --url
  "https://www.google.com/search?q=tokyo+hotel"` reports Google Search as
  `fixture_verified` with 70 selector candidates and 125 capture-scope
  candidates after broad news/video/travel extraction selectors were removed.
- Final `npm run verify` passed again after the Google travel/hotel extraction
  fixture pass with build, 34 test files / 346 tests, local smoke, public web
  smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.
- Final `npm run verify` passed after the Google Travel maintained-export
  regating pass with build, 34 test files / 347 tests, local smoke, public web
  smoke, media smoke, proxy smoke, and 0 npm audit vulnerabilities.

## YouTube Destination Extraction Regating Pass

Applied the same maintained-export discipline to YouTube search/video evidence:

- added precise YouTube destination selector candidates for search-result watch
  titles, Shorts titles, rich-grid title/thumbnail links, channel-name links,
  and channel-thumbnail links
- treated broad YouTube renderer links such as `ytd-video-renderer a[href]` and
  `ytd-rich-item-renderer a[href]` as broad fallback selectors so they do not
  win maintained `extract_destinations` export
- reweighted destination selector preference so direct media title/thumbnail
  watch/Shorts selectors outrank duplicate-heavy channel thumbnail selectors
  when both are stable in repeated calibration
- added a YouTube safe-executor fixture that captures public search metadata,
  extracts an exact watch-title destination, captures a thumbnail frame and
  overlay text, and preserves unsupported raw-stream/social-write guards
- ran two profile-backed Chrome calibrations for
  `https://www.youtube.com/results?search_query=seoul+cafe` through the
  `google-search-cdp` persistent profile. Both completed with 0 blocked-signal
  hits, 51 selector candidates, 17 matched selectors, 19 capture-scope
  candidates, and 6 matched capture scopes
- exported maintained actions from those two runs; the destination follow-up
  action now uses `ytd-video-renderer a#video-title[href*="/watch"]`
- ran the exported YouTube action file through profile-backed `evidence-run`.
  Final claim gate passed with 154 artifacts and 4 claims, one bounded child
  video follow-up was useful, 5 depth-2 candidates remained proposal-only, and
  destination triage reported no retry recommendation

Verification so far:

- `npx vitest run tests/source-navigation-recipes.test.ts
  tests/source-navigation-recipe-catalog.test.ts tests/source-navigation-executor.test.ts
  --testTimeout 60000` passed with 3 files / 77 tests.
- `npx vitest run tests/source-navigation-recipe-catalog.test.ts
  tests/source-navigation-recipes.test.ts --testTimeout 60000` passed with 2
  files / 39 tests after the live-channel selector priority adjustment.
- `npm run build` passed.
- Final `npm run verify` passed with build, 34 test files / 349 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## Destination Recovery Plan Compatibility Pass

Made the Naver Map blocked-child recovery handoff more tolerant of existing
artifacts:

- `destination-recovery-plan` now synthesizes full
  `blockedChildRecoveryAdvice` when a destination-triage artifact has
  `blockedChildRecoveryCandidates` but was produced before advice fields were
  added
- recovery plan items now expose `adviceSource` and `synthesized` so QA can
  tell original artifact advice from compatibility handoffs synthesized from
  recovery candidates
- synthesized advice keeps the same guarded policy: Chrome persistent profile
  setup, headed profile-backed recovery `evidence-run`, no automatic depth-2
  execution, and no gate bypass
- artifact parsing now strips a leading UTF-8 BOM before JSON parsing, which
  keeps PowerShell/Windows handoff files usable
- CLI smoke against a BOM-prefixed candidate-only artifact produced the expected
  headed `pcmap.place.naver.com` retry command

Verification so far:

- `npx vitest run tests/destination-recovery-plan.test.ts
  tests/destination-triage.test.ts --testTimeout 60000` passed with 2 files /
  35 tests.
- `npx vitest run tests/destination-recovery-plan.test.ts --testTimeout
  60000` passed with 1 file / 6 tests after advice-source visibility was
  added.
- `npm run build` passed.
- Final `npm run verify` passed with build, 34 test files / 350 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.
- Final `npm run verify` passed again after advice-source visibility with
  build, 34 test files / 350 tests, local smoke, public web smoke, media smoke,
  proxy smoke, and 0 npm audit vulnerabilities.

## OCR CTA and Policy Text-Profile Pass

Extended deterministic OCR text-profile metadata for visible local/travel/
commerce screenshots:

- added `hasReservationLikeText`, `hasMenuLikeText`, and
  `hasCommercePolicyLikeText` to OCR metadata and schema validation
- reservation/menu signals cover English, Korean, and Japanese visible CTA text
  such as reserve/book-now, Naver-style reservation, and menu labels
- commerce policy signals cover cancellation, refund, return, exchange,
  shipping, tax, fee, seller, warranty, and terms text without turning those
  signals into price claims
- added deterministic OCR profile coverage for Korean place-card and Japanese
  hotel/policy text, keeping route numbers, ratings, and policy text separate
  from currency+amount price evidence

Verification so far:

- `npx vitest run tests/ocr-text-profile.test.ts tests/ocr.test.ts
  --testTimeout 60000` passed with 2 files / 15 tests.
- `npm run build` passed.
- Final `npm run verify` passed with build, 34 test files / 351 tests, local
  smoke, public web smoke, media smoke, proxy smoke, and 0 npm audit
  vulnerabilities.

## Scene-Change Hit-Cap Tuning Pass

Separated scene-change midpoint selection from dense-frame capture caps:

- added `denseSampling.sceneChangeMaxHits` to evidence-run input validation,
  MCP input, and HTTP/scheduler-normalized workflow options
- added CLI flag `--dense-scene-max-hits <1-120>` for real-media threshold
  tuning
- `analyzeSceneChanges` now receives `sceneChangeMaxHits` when provided,
  while `maxDenseFrames` continues to bound the actual dense screenshots
- this lets QA reduce false-positive scene-change expansions without shrinking
  each dense window around a selected midpoint

Verification so far:

- `npx vitest run tests/frame-sampler.test.ts tests/evidence-runner.test.ts
  tests/mcp-server.test.ts --testTimeout 60000` passed with 3 files / 36
  tests.
- `npm run build` passed.

## Documentation Map and Claude Handoff Pass

Paused sequential development and normalized the handoff/documentation surface:

- added `docs/DOCUMENTATION_MAP.md` as the first-stop map for all development
  docs, reading order, QA/QC references, release notes, and current verification
  caveat
- added `docs/CLAUDE_HANDOFF.md` with current repo state, latest completed
  scene-change work, interrupted full-verify caveat, exact next action, and a
  copyable prompt for Claude
- added `docs/QA_QC_PROCESS.md` to define local gates, focused tests, opt-in
  OCR/API tests, real-site calibration loops, browser/profile QA, and what
  counts as verified by feature class
- added `docs/RELEASE_NOTES.md` with version/pass-level summaries and rough
  update-size categories
- updated `AGENTS.md`, `README.md`, and `docs/NEXT_TASKS.md` to point future
  Codex/Claude sessions to the new documentation entry points

Verification note:

- This was a docs-only pass. Run `git diff --check` before committing these
  documentation changes.
- The full `npm run verify` caveat from the scene-change hit-cap pass remains:
  focused tests and build passed, but the final full verify was interrupted by
  the user and must be rerun before claiming the current worktree is fully
  verified.
