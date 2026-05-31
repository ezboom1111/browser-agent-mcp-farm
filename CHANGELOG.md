# Changelog

All notable changes to `browser-agent-mcp-farm` are documented here. This project
adheres to semantic versioning. Build/test status is tracked in
[STATUS.md](STATUS.md) and progress-to-10/10 in [SCORECARD.md](SCORECARD.md).

## [Unreleased]

## [0.5.0] — validated engine + provenance (in progress)

> Accumulates the v0.5.0 capture-tier / security / engine work. Entries land incrementally.

### Security

- **Owner-only profile/credential directories** (B1b): the profile directory that holds a saved
  session — the persistent-profile `userDataDir` (Chromium's cookie/login DBs) and
  `storage-state.json` — is now created owner-only. POSIX: `chmod 0700`. Windows: it already lives
  under `%USERPROFILE%\.gstack` (inherited owner-only ACL), and a best-effort `icacls` grant (current
  user) followed by inheritance removal is applied grant-first so a failure can never lock the
  directory. Hardening is best-effort and never breaks login/capture. This is directory-level
  protection sufficient for a single-user machine; per-file encryption (e.g. DPAPI) was deliberately
  not added — the PowerShell bridge would put a plaintext key in transit and DPAPI CurrentUser is
  same-user-decryptable, so the marginal benefit did not justify that secret-handling path (tracked
  as a follow-up). Complements the B1a credentialed-lease domain fence.

### Changed

- **Refusal codification + version-drift fix** (B2): the live browser-extension / attach-and-drive of
  the user's real logged-in browser is now an explicit `nonGoal` with a neutral technical
  `REFUSAL_RATIONALE` (session-hijack surface + non-isolated/non-reproducible — incompatible with
  cite-or-fail; the CDP cookie import stays export-only and is never exposed over MCP). `capabilities()`
  now reads the real package version (a new `version.ts`, fixing the stale `0.3.0`) and shares the
  single `AGENT_GUIDANCE.nonGoals` instead of a drifting duplicate. A new `registeredToolNames()` lets
  a test assert the MCP negative surface — no `cdp` / `auth-login` / `attach` tool is ever registered.
- **`browserChannel` is a closed enum** (`chromium` | `chrome` | `msedge` | `msedge-beta` |
  `msedge-dev`), replacing the previous free string. Unsupported engines (`firefox`, `webkit`,
  `msedge-canary`, …) are now rejected at the evidence-run input boundary, and the CLI
  `--browser-channel` / `--chrome` flag validates and **fails fast before any browser launch**.
  `chromium` remains valid and maps to the bundled default engine. **Breaking (minor)** for any
  caller that passed an out-of-enum channel; all in-tree callers already use chrome/chromium/msedge.
- **Credentialed leases fail closed on an empty domain allow-list**: a `storage-state` or
  `persistent-profile` lease (which carries a real cookie jar / saved session) may no longer
  navigate with an empty `allowedDomains` — an empty allow-list on a credentialed session is an
  exfiltration path, so it now throws `domain_not_allowed` at navigation. An `ephemeral` lease is
  unchanged (empty = allow-all). `assertDomainAllowed` is exported so other capture paths reuse the
  identical allow-list logic. **Breaking (minor)** for any credentialed lease that relied on
  empty = allow-all; in-tree navigating credentialed leases already pass a domain allow-list.

### Added

- **Content-addressed capture-cache core** (C4, `capture-cache.ts`): a deterministic cache keyed by
  every byte-affecting input (url, capture/launch profile, resolved channel + browser version,
  sampleFrames, viewport/locale/timezone/userAgent, wait/settle) plus a coarse time bucket, so two
  runs that would capture identical bytes could replay a prior registered capture (keeping its
  original sha256). Conservative-by-design for a verification tool, per the adversarial review: an
  **unresolved engine is non-cacheable** (the key is `null` when `browserVersion` is `"unknown"`, so
  two binaries never collide on one key); freshness is **clamped to ≤ 1 hour** (a longer TTL is
  ignored) with numeric staleness recorded; the cache directory is **per-run-root** (not a global
  dir), so one agent never serves another's bytes as first-party; and only a bare ephemeral lease is
  eligible (the gate lives at the call site). The hot-path replay wiring (re-register a fresh hit and
  label the page claim `cached_capture` with its staleness age) is intentionally a separate,
  opt-in follow-up — for a verification tool, serving cached bytes as current evidence is the most
  freshness-sensitive change and is kept off the default path.
- **External-bridge caged tier** (B3, `storagePolicy: "external-bridge"`, `docs/EXTERNAL_BRIDGE.md`):
  an off-by-default lease tier for a powerful-but-untrusted external capturer, so that capability can
  be used without weakening the trust model — its bytes flow through `register_evidence`
  (`captureMethod: "byo-bridge"`) and are re-verified by the same deterministic claim gate. The cage
  is enforced at `acquire()`: enabled only when `FARM_ENABLE_EXTERNAL_BRIDGE` is exactly `"1"`
  (default-off is the failure mode), forced `read-only`, a non-empty `allowedDomains` allow-list
  required, every credential/identity field rejected (`proxy`/`profileName`/`storageStatePath`/
  `userDataDir`/`fingerprint`), TTL clamped to ≤ 5 min, and no profile lock (disposable, isolated
  ephemeral context). `farm_capabilities` reports `externalBridgeEnabled`. It never attaches to or
  drives the user's real browser — the security boundary remains the deterministic gate, not an AI.
- **Browser pre-warm + cost metrics** (C3): the evidence run pre-launches the shared Browser as a
  measured `browser_prewarm` stage so the launch cost is visible in `metrics.json` and the first
  `openPage` does not pay it synchronously. `metrics.json` now also carries `blockedResourceCount`
  (subrequests aborted by the text profile), making the A3 win measurable per run. A shared
  `isBareEphemeralLease` predicate (storagePolicy ephemeral with no proxy/fingerprint/storage-state/
  profile/user-data — not "options object empty") is added for warm-eligibility and reused by the
  capture cache. (A context-reuse ring was deliberately not added: a warmed context is safe to use
  at most once, so reuse would risk cross-lease state bleed for no real gain — the Browser, not the
  context, is the expensive resource.)
- **Resource-blocking text capture profile** (`resource-blocking.ts`, evidence-run `captureProfile`,
  CLI `--text-only`): on a `text` profile the BrowserPool aborts image/media/font subrequests and
  known ad/tracker hosts (via `context.route`) before they are fetched, and skips the page
  screenshot. This never touches the document/script bytes `page_html`/`page_text` are derived from
  — so cite-or-fail is unaffected and captures become more reproducible (fewer third-party requests)
  — and the aborted-request count is tracked per context. `full` (default) is unchanged. Use it for
  text/structure-only browser runs (JS-rendered pages that tier-0 can't fetch but that need no
  visual evidence).
- **Tier-0 browserless capture** (`http-tier0-capture.ts`, acquisition tier `http_fetch`): for a
  source whose needed bytes are server-rendered, `httpTier0Capture` performs a plain HTTP GET and
  registers the SAME artifact contract as the browser path — `page_html`, `page_text` (derived
  deterministically from the HTML), and a `structured_data` derivative — without launching Chromium.
  It is read-only and credential-free, fences **every redirect hop** against the lease domain
  allow-list (the exported `assertDomainAllowed`, an SSRF guard), enforces an http(s)-only +
  `text/html` content-type guard + byte cap, and **declines** (`ok:false`, so the caller escalates
  to the browser) on non-HTML / off-domain / bot-blocked responses. Determinism is improved over a
  rendered DOM (no JS, ads, or timing). The `http_fetch` tier sits after `feed` and before any
  browser tier in the acquisition router.
- **Tier-0 wired into the evidence run** (opt-in `httpFetch`, CLI `--http-fetch`): when enabled, the
  evidence run attempts the browserless capture first and, on success, skips the browser entirely
  (no lease, no Chromium, no frames) and authors claims from the fetched bytes; on decline it
  escalates to the full browser path. The page-capture claim is labelled with a new `http_fetch`
  verification level (never `browser_visible`) so provenance tracks reality — the claim gate does
  not trust the label, but a reader sees the bytes were not browser-rendered. No engine sidecar is
  written for a tier-0 run (no engine was used).
- **SSR hydration extraction**: `extractStructuredData` now parses inline `application/json`
  hydration payloads (Next.js `__NEXT_DATA__`, Nuxt `__NUXT_DATA__`, and other framework SSR
  state) into `StructuredData.hydration`, and a page that exposes only hydration (no JSON-LD)
  now registers a `structured_data` artifact. This is the structured data a client-rendered page
  commits to the HTML before JS runs — often readable without a browser. Pure `JSON.parse` (no
  eval, the `window.__NUXT__ = {…}` JS-assignment form is deliberately not executed),
  byte-reproducible, and `application/ld+json` is excluded (it stays in `jsonLd`). Like JSON-LD, a
  hydration value is a site claim that only grounds a claim when it also appears in the visible text.
- **Engine provenance in the bundle manifest**: each evidence run records the resolved capture
  engine (channel + browser version) into a `run-meta.json` sidecar, and `buildBundleManifest`
  attaches it as `manifest.engine`. It is recorded **beside** the bytes — deliberately **outside**
  the Merkle root and signature — so a verifier can see which engine produced the bytes while the
  engine label never affects the hash verdict. `browserVersion` is `"unknown"` until a browser has
  launched (e.g. a persistent-profile context that does not expose its Browser), a non-authoritative
  marker rather than a pinned version.

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
