# Changelog

All notable changes to `browser-agent-mcp-farm` are documented here. This project
adheres to semantic versioning. Build/test status is tracked in
[STATUS.md](STATUS.md) and progress-to-10/10 in [SCORECARD.md](SCORECARD.md).

## [Unreleased]

## [0.4.1] — reproducibility launch hardening

### Changed

- **Curated Chromium launch args**: the BrowserPool now launches the default bundled Chromium
  engine with a small, frozen set of stability + deterministic-scheduling flags
  (`--disable-dev-shm-usage`, `--no-first-run`, `--no-default-browser-check`,
  `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`,
  `--disable-renderer-backgrounding`, `--mute-audio`). The set is deliberately conservative —
  **no stealth / anti-detection / sandbox / web-security-downgrading flags** (the absence is
  asserted by test) — and none of the flags alter DOM/page-text bytes (they affect process and
  timing, not rendering). Args are applied **only** to the default engine, never to a named
  `chrome`/`msedge` channel, whose branded build is itself the reproducibility signal. A new
  optional `launchArgsProfile: "default" | "minimal"` selects the full curated set or the single
  highest-value flag. `launchOptions()` now returns `{ headless, channel?, args? }`, establishing
  the launch-options shape that later engine-provenance and capture-cache work build on.

## [0.4.0] — flexible acquisition

> Not yet published. Licensed **Apache-2.0** (`LICENSE` + `package.json` set, `repository`
> pointed at the GitHub remote). `prepublishOnly` runs the full verify gate.

### Added — bring-your-own-capture (BYO) acquisition

- **BYO-capture provenance**: `register_evidence` (MCP `farm_register_evidence`) now accepts
  caller-supplied `captureMethod` / `capturedBy` / `capturedAt`, persisted on every artifact
  record. Bytes from ANY external capturer — Firecrawl, an operator agent, a human paste, a
  mobile mitmproxy session — are hash-registered with recorded (self-asserted) provenance and
  still pass the same cite-or-fail gate. The farm verifies; it need not capture.
- **Verifiable generic-extraction loop** (`FarmService.groundExtractedClaims`): deterministically
  extracts typed values (name / price / rating) from a captured HTML artifact and authors a
  `text_span`-anchored claim, citing the VISIBLE-TEXT artifact, for each value that literally
  appears on the rendered page. The gate re-verifies every quote against the bytes, so a value the
  extractor invented — or a publisher (JSON-LD) value that disagrees with the page — is never
  grounded: extraction proposes, the gate decides. Sector-agnostic, no per-site selectors, no LLM.
- **Acquisition tier router** (`acquisition-router.ts`, `coverage-report --format routes`): a
  deterministic routing brain that maps each source's coverage class to the cheapest viable
  acquisition tier (`official_api` → `feed` → `model_extract` → `profile` → `headed` →
  `byo_capture`). `byo_capture` closes every route as the universal fallback, so the farm never
  implies it can autonomously capture everything — a hard source is still acquirable by an external
  capture that feeds the gate.
- **`upgrade` CLI command**: prints the installed version + how to upgrade and re-register
  (`register-all`); the `recipe-canary` / `coverage-report` freshness layer + CI gate cover the rest
  of the maintenance loop.
- **Transcript intake** (`FarmService.registerTranscript`): ingest a video's spoken/caption track
  from ANY lawful source (a YouTube auto-caption fetch, yt-dlp, a transcript service, a human
  paste) — WebVTT is parsed into timed cues, registered as a `transcript_cue` artifact, and a
  spoken-content claim then cites it with a `text_span` anchor so **what was said becomes
  cite-or-fail**. The farm still performs no speech-to-text; the transcript is the platform's own
  caption, supplied with BYO-capture provenance.

### Changed

- `.gitattributes` (`* text=auto eol=lf`) pins LF line endings cross-platform so the Biome
  format gate stays consistent regardless of git autocrlf.

### Added — self-verifying coverage (P4)

- **`recipe-canary`**: re-verifies a maintained recipe's required selectors against a stored
  golden (offline replay via `--observation-file`, or a read-only headless probe via `--url`),
  auto-demoting a decayed slot to `needs_recalibration`; appends to a hash-free canary ledger.
- **`coverage-report`**: classifies every source as `autonomous_ready` / `api_backed` /
  `headed_only` / `blocked` / `unmaintained`, where `autonomous_ready` REQUIRES a passing
  canary inside a freshness window and anything outside the named maintenance budget is
  honestly `unmaintained`.

### Added — release readiness

- **Global context cap + backpressure**: `LeaseManager` accepts `maxContexts` (env
  `FARM_MAX_CONTEXTS` for a deployed `serve`/`serve-http`); past the cap, `acquire` rejects
  with a typed `capacity_exhausted` instead of overloading the host. Capacity auto-recovers
  on release/expiry.
- **Parallel-safety conformance suite** (`tests/conformance.test.ts`): proves the cap +
  backpressure recovery, reaper crash-recovery, secret redaction, same-port `EADDRINUSE`
  refusal, and **real two-process** profile mutual-exclusion (O_EXCL lock contention).
- **Apache-2.0 license** + `author`, and a `LICENSE` file shipped in the package.
- **Packaged-artifact gate** (`test:tarball`, wired into `verify`): asserts the published
  tarball ships the bin + `LICENSE` + skill, and that the packed `dist/cli.js` runs
  end-to-end with real deps.
- **Product line coverage ≥ 80%** (80.06%), closing the last SCORECARD gate
  (build-completeness **10/10**); coverage floor ratcheted to 80.

### Added — evidence-first trust & data-coverage workstream

- **Structured extraction** (deterministic, byte-reproducible): JSON-LD / Open Graph /
  Twitter / canonical / title, typed price+rating summary (incl. `reviewRating`), HTML
  tables, and an h1–h6 outline — registered as a `structured_data` artifact by the
  evidence-run pipeline, with a structured-vs-DOM disagreement cross-check.
- **Evidence-quality benchmark**: a labeled golden corpus (product/place/review/news ×
  ko/en/ja) scored by precision/recall/exact-match against named thresholds, gated in CI.
- **Claim grounding**: claims are groundable against `structured_data` typed values; the
  cite-or-fail authoring loop (`register_evidence → read_artifact → add_claim`) is
  validated at the service level.
- **Portable evidence bundle**: a self-contained, Ed25519-signed, Merkle-rooted `.evb`
  archive that verifies **fully offline** (no run directory), with a worked agent-to-agent
  A→B exchange example.
- **Tamper-evident decision log**: hash-chained gate-verdict log + `verify-decision-log`.
- **Security & lifecycle**: secret-at-rest scanner (`scan-secrets`), evidence-run
  retention (`purge-run` / `prune-runs`), per-source `legalBasis` posture.
- **Observability**: per-run `metrics.json` (p50/p95 stage latency).
- **Measurement**: a `SCORECARD.md/json` regenerated by the verify gate (build-completeness).
- `audio_transcription` formalized as lawful provider-supplied only (no farm-side ASR).

### Changed

- **Biome lint + format gate** (`npm run lint`, wired into `verify`): formats the codebase
  (space indent, double quotes, semicolons, no trailing commas, 320 col) and lints with the
  recommended rules (non-null-assertion / regex-exec-assignment / test-cookie exceptions
  documented in `biome.json`). `lint:fix` applies safe fixes.
- **Split `evidence-runner.ts`** (3064 → 2689 lines) along stage seams: the pure
  text-script/destination-query helpers moved to `evidence-runner-text.ts` and the public
  option/result/assessment/claim data model to `evidence-runner-types.ts` (re-exported, so
  importers are unchanged).
- Consolidated duplicated url/text/collection helpers into `src/util/`.
- `cli.ts` is testable in-process (exported `main` behind an ESM entry-point guard).

## [0.3.0]

- Initial evidence-first browser-research MCP farm (CLI + MCP stdio + HTTP queue),
  claim gate, source registry/strategy/navigation, and the verify quality gate.
