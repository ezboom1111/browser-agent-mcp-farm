# Changelog

All notable changes to `browser-agent-mcp-farm` are documented here. This project
adheres to semantic versioning. Build/test status is tracked in
[STATUS.md](STATUS.md) and progress-to-10/10 in [SCORECARD.md](SCORECARD.md).

## [Unreleased]

## [0.6.0] — 2026-06-02 — team distribution, research lenses + the caged-judge

> Distribution + verification-engine + transcendence. Portable `npx`/team distribution with first-run
> Chromium auto-install and tag-driven release CI; storage-retention discipline; declarative research
> lenses (research / market_scan / product_planning) reachable as an MCP tool + skills; cross-source
> corroboration, visible-text typed-fact extraction, and the **caged-judge** (`farm_judge_claim`) — a
> deterministically-caged semantic verification layer that lets an untrusted LLM judge propose a verdict
> while the gate verifies every cited span — plus content-aware source independence (syndication-echo
> collapse) and a CI-enforced, property-based anti-hallucination gate (0 leaks across 1,200 trials).

### Added

- **QA harnesses as enforcing regression gates** (transcendence Tier 4, `npm run qa`,
  `.github/workflows/qa.yml`): the sector QA and the property-based fuzzer now exit non-zero on ANY
  failure — a span-mode hallucination leak, a fabrication passing the cite-or-fail gate, a false-reject of
  a real fact, recall below 99% on the generated formats, or a sector/adversarial failure — and a CI
  workflow runs them on every push/PR (deterministic + offline, no browser). So the 0-leak
  anti-hallucination guarantee is regression-proofed: any future change that reintroduces a leak fails CI.
- **Content-aware source independence** (`source-independence.ts`, transcendence Tier 3): the
  corroboration and caged-judge quorums now collapse a syndicated wire story echoed across domains to ONE
  independent source, closing the fake-independence hole. Two sources are independent only if they have
  distinct registrable domains AND their content is not a near-duplicate (k-word shingles + Jaccard >
  0.6, union-find grouped). So a `supported` judgment or a corroborated claim cannot reach its 2-source
  quorum by citing two outlets running the same AP wire copy.
- **Caged-judge protocol** (`farm_judge_claim`, `judgments.jsonl`): the deliberate "strong head, caged
  hand" applied to the SEMANTIC layer, and the fix for the aggregated-token recombination weakness the
  fuzzer surfaced. An external judge (an LLM agent) submits a verdict — `supported` | `refuted` |
  `insufficient` — over a claim, citing the SUPPORTING and/or REFUTING spans it relies on. The
  deterministic gate verifies every cited span literally appears in its source's bytes and enforces a
  structural quorum: a `supported` verdict needs ≥ `minIndependentSources` (default 2) verified
  supporting spans from distinct registrable domains and **no** verified refuting span (an inconsistency
  the judge itself surfaced); a `refuted` verdict needs a verified refuting span. The verdict is
  untrusted and the gate does **not** judge its semantic correctness (that is NLU) — but an untrusted
  judge **cannot** make `supported` stand on a fabricated/recombined span (the contiguous quote does not
  exist) or below the independence quorum. So you get NLU-level cross-source synthesis WITHOUT trusting
  the LLM: it proposes, the deterministic gate disposes. The gate re-verifies `judgments.jsonl` on
  `farm_run_claim_gate`, clamps a hand-written `min` to the default (direct-ledger defence), warns on a
  single-source `supported`, and tolerates a corrupt ledger line instead of crashing. Reviewed by the
  code-reviewer agent (no bypass).
- **Property-based fuzz QA** (`scripts/qa-fuzz.mjs`, `npm run qa:fuzz`): a seed-deterministic fuzzer that
  generates thousands of randomized pages with KNOWN injected facts and KNOWN fabrications, then measures
  the gate's hallucination-leak rate and extraction recall — the randomized generator is the oracle, so
  it has none of the hand-written suite's self-authorship bias. Baseline: **0 hallucination leaks across
  1,200 fabrication / near-miss / recombination trials in the default text_span (quote) mode**, 100%
  typed-fact recall on the generated formats. It also quantifies a real weakness: an `aggregated`/`derived`
  claim grounds on TOKEN PRESENCE (to allow paraphrase), so a recombination of real tokens across
  unrelated content passes — 100% in the fuzzer. (The default span mode does not have this; see hardening.)
- **Sector QA/QC harness** (`scripts/qa-sectors.mjs`, `npm run qa:sectors`): a deterministic, offline,
  end-to-end QA run across 12 sectors × {structured, semi-structured, unstructured} local fixtures plus
  an adversarial/edge battery. Per sector it tier-0-captures, checks structured + typed-fact extraction,
  and verifies the cite-or-fail gate (a grounded claim PASSES, a fabricated one is BLOCKED). The
  adversarial battery exercises off-domain-redirect (SSRF) decline, non-HTML decline, client-shell
  decline-to-escalate, contradictory-markup flagging, near-miss fabrication blocking, post-registration
  byte-tamper detection, cross-source corroboration (independent vs same-domain), Korean/non-ASCII, and
  the zero-claim final gate. Baseline result: 97/97 checks — every hallucination/integrity case caught.
- **`farm_lens` MCP tool + lens skills** (makes the lenses agent-usable): the declarative research
  lenses (engine #3) are now reachable over MCP — `farm_lens { lensId? }` lists the lenses or describes
  one (claim templates + report sections + prioritized sources), and `farm_capabilities` already
  advertises them. Two thin lens skills ship: `skills/market-scan/SKILL.md` (competitor pricing /
  review sentiment / market sizing, high-stakes numbers corroborated across independent sources) and
  `skills/product-planning/SKILL.md` (user pains / feature gaps / adoption signals). `register-all` now
  installs EVERY in-repo skill (the main farm skill plus the lens skills), each version-stamped. So
  "research the market with cited, corroborated evidence" is a first-class agent flow, not just a CLI.
- **Typed-fact extraction from visible text** (`typed-facts.ts`): a deterministic, domain-neutral layer
  that extracts prices, ratings, percentages, and dates from the RENDERED visible text — the facts a
  page shows without any structured markup, complementing the JSON-LD/OG summary. Each fact's `raw` is a
  verbatim substring of the page text, so a claim citing it carries a groundable text_span anchor; pure
  regex, byte-reproducible. The facts ride in the existing `structured_data` artifact (`typedFacts`)
  wherever visible text is available (browser capture, tier-0, cache replay), so a lens (market_scan
  prices, product_planning percentages, …) can query the same typed layer. A SITE CLAIM, like the
  JSON-LD summary — it says the value is on the page, not that it is true.
- **Declarative research lenses** (`lens.ts`, CLI `lens`, `farm_capabilities.lenses`): the core —
  capture + the cite-or-fail gate — is domain-neutral, so a "lens" is a config (not forked code) that
  points the same engine at a domain: which source-registry categories to prioritize, what typed claims
  to author (and which high-stakes ones should be corroborated across independent sources, engine #2),
  and how to shape the cited report. Ships `research` (general), `market_scan` (marketing), and
  `product_planning` lenses; `lens --lens <id>` describes a lens + its prioritized sources, and
  `farm_capabilities` advertises the lens summaries. So marketing/planning/etc. are data over one
  engine — the gstack "many skills" model done as config — and no domain semantics leak into the core
  (the dependency-boundary guard still holds). The lens claim templates are validated against the real
  claim-type / evidence-kind enums.
- **Cross-source corroboration** (`source-independence.ts`, `farm_add_claim` `corroboration`): a claim
  can now assert support from multiple **independent** sources. `farm_add_claim` accepts
  `corroboration: { sources: [{ artifactId, quote? }], minIndependentSources }`; the final-mode gate
  verifies each cited source is registered, verifies any per-source `quote` against THAT source's actual
  bytes, and counts distinct **registrable domains** across the primary + supporting sources — failing
  the claim below `minIndependentSources` (default 2). Independence uses a deterministic registrable-
  domain heuristic (www-stripped, a small known two-level-suffix set, else last two labels) that
  deliberately UNDER-counts (a subdomain of one site is not independent). It proves N independent,
  hash-verified sources are cited (and any quoted support is present in each) — **not** that the sources
  semantically agree (beyond a deterministic gate), and source provenance stays self-asserted. A claim
  with no `corroboration` block is unaffected. This is the trust backbone for marketing/planning
  conclusions where a single-source claim is not enough.
- **Storage retention discipline**: evidence runs accumulate page bytes, screenshots, and (for video)
  sampled frames — a real content page is ~1–5 MB and a media/video run 5–100 MB — and nothing bounded
  that growth automatically. `prune-runs` now takes `--max-bytes 5GB` (after the age pass it deletes the
  oldest remaining runs until the total fits the disk budget), a new `archive-run` does **tiered
  retention** (reclaim a run's bulky screenshot/media bytes while keeping the ledger/claims/report/raw
  index, so the run stays searchable and its text claims stay re-verifiable; a `.retention.json` marker
  records what was stripped so a re-verify reports honest archival, not tampering), and setting
  `FARM_RUNS_ROOT` (+ optional `FARM_RUNS_MAX_AGE_DAYS` / `FARM_RUNS_MAX_BYTES`) auto-sweeps that root
  on every `serve` startup (best-effort, opt-in, stderr-logged). Builds on the existing
  `purge-run` / `pruneRuns` primitives.

- **Portable `npx` registration + `serve` skill self-heal**: `register-all` / `register-codex` /
  `register-claude` now accept `--npx` (and `--package-spec <spec>`) to register an
  `npx -y <spec> serve` invocation instead of an absolute path to this local build. The host config
  then carries no build directory, so a published-package install is portable across machines and
  upgrades flow through the package manager — no path re-register. The default stays the absolute local
  path (correct for a git-clone dev install). Because the Claude skill is installed as a **copy** (not
  a path reference), `serve` now **self-heals a stale snapshot**: when an installed skill's version
  marker differs from the running package version it re-copies the skill on startup (best-effort, only
  when a snapshot already exists), removing the "server upgraded but the routed skill text is stale"
  drift. Foundation for distributing the farm to a team via a (private or public) npm package.
- **First-run Chromium auto-install**: `serve` provisions the Playwright Chromium binary on first run
  (`browser-install.ts`) — the npm package does not bundle it — logging only to stderr (safe for the
  MCP stdio protocol) and opt-out-able via `FARM_SKIP_BROWSER_AUTOINSTALL=1`. Removes the most common
  first-capture failure for a freshly-installed teammate.
- **Install-mode-aware `upgrade`**: the `upgrade` command now detects a git-clone vs a published-package
  install and prints the correct steps (the old hint always assumed a global npm install, which did not
  exist). `upgrade --run` performs the one always-safe in-process step — re-register (refresh the MCP
  config + self-heal the skill); git pull / npm update stay printed since they are environment-specific.
- **Tag-driven release CI + team bootstrap scripts**: `.github/workflows/release.yml` runs the full
  verify gate on a `v*` tag, creates a GitHub Release with generated notes, and publishes to npm only
  when an `NPM_TOKEN` secret is configured (safe to merge before deciding to publish). `install.ps1` /
  `install.sh` are one-command onboarding bootstraps (deps + Chromium + build + register) for a cloned
  repo. So the maintainer release loop becomes `npm version <bump> && git push --follow-tags`.

## [0.5.0] — 2026-06-01 — validated engine, browserless capture tiers + at-rest credential encryption

> The v0.5.0 capture-tier / security / engine release: a deterministic engine-provenance and
> content-cache spine, browserless + text + auto capture tiers that invert the render budget, and a
> tightened security boundary (credentialed-lease domain fence, owner-only credential dirs, opt-in
> DPAPI at-rest encryption, a caged external-bridge tier). The security boundary stays the
> deterministic claim gate, never an AI.

### Security

- **Owner-only profile/credential directories** (B1b): the profile directory that holds a saved
  session — the persistent-profile `userDataDir` (Chromium's cookie/login DBs) and
  `storage-state.json` — is now created owner-only. POSIX: `chmod 0700`. Windows: it already lives
  under `%USERPROFILE%\.gstack` (inherited owner-only ACL), and a best-effort `icacls` grant (current
  user) followed by inheritance removal is applied grant-first so a failure can never lock the
  directory. Hardening is best-effort and never breaks login/capture. This is directory-level
  protection sufficient for a single-user machine; per-file encryption (e.g. DPAPI) was deliberately
  not added at this layer — directory ACLs are the floor; per-file encryption is now available
  opt-in as D3 below. Complements the B1a credentialed-lease domain fence.
- **Opt-in DPAPI at-rest encryption for storage-state** (D3, `secret-store.ts`,
  `FARM_ENCRYPT_STORAGE_STATE=1`): closes the remaining B1b gap — the farm's own credential file
  (`storage-state.json`) can be DPAPI-encrypted at rest on Windows. The secret crosses only the
  PowerShell **stdin/stdout** pipes as base64 — never argv (kept out of the 4688 audit log and
  PSReadline) — and the `-Command` script is a closed two-constant enum (no injection surface).
  Decrypt-on-use hands Playwright an **in-memory object**, so no plaintext temp is ever written to
  disk, and encrypt-in-place uses an atomic temp+rename. Encryption is **opt-in** (so it never
  silently changes a credential-file format) while decryption is always attempted; everything is
  best-effort and falls back to the 0700/ACL hardening (never throwing) off Windows or on any
  failure. The persistent-profile `userDataDir` stays Chromium's own (already DPAPI-encrypted) store.
  Reviewed by the security-reviewer agent (atomic write, fail-closed on a corrupt file, content-free
  failure logging).

### Changed

- **Aggregated/derived claim grounding now warns on scatter** (fuzzer-motivated hardening): token-presence
  grounding (which exists to allow paraphrase) can be satisfied by a recombination of real tokens across
  unrelated content. The gate now computes the smallest window covering all of an aggregated claim's
  tokens and emits a WARNING (not a block — legitimate cross-page synthesis exists) when it is far larger
  than the claim, surfacing a likely recombination. The default `quote`/text_span mode is unaffected (it
  is contiguous-match and had 0 fuzzer leaks). Deterministic distance is only a partial mitigation — the
  full fix is a semantic check (an LLM judge whose supporting spans are themselves cite-or-fail verified);
  for a high-assurance claim, prefer a text_span quote or cross-source corroboration.

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
  eligible (the gate lives at the call site). The hot-path replay wiring is shipped opt-in as D1 below.
- **Capture-cache hot-path replay** (D1, opt-in `captureCache` / CLI `--capture-cache`): wires the C4
  cache into the evidence run. A bare ephemeral run on the bundled Chromium engine can replay a fresh
  (≤ 1 h) prior capture by content hash instead of launching — the identical bytes are re-registered
  (same sha256), the page claim is labelled **`cached_capture`** with its staleness age (never
  `browser_visible`), and `structured_data` is re-derived. Pre-launch engine resolution is made safe
  by persisting the resolved engine identity stamped with the installed Playwright version; a version
  mismatch, a missing source run, or a re-hash that fails the stored sha256 each force a real launch
  rather than serving stale/altered bytes. Credentialed / fingerprinted / named-profile /
  branded-channel runs are never cached, and the default path is unchanged (opt-in only).
- **Tier-0 SPA-shell decline gate + auto routing** (D2): the browserless tier-0 path now **declines a
  client-rendered shell** (thin server-rendered visible text plus a hydration / empty-mount marker),
  so it never registers an incomplete capture as evidence — the caller escalates to a real browser.
  This also hardens the existing `--http-fetch` path. A new `captureRouting: "auto"` (CLI
  `--auto-capture`) tries tier-0 first and escalates on any decline, so it is **never a worse capture
  than the browser**; the default stays `"browser"`, leaving the default capture method, screenshot,
  and provenance unchanged. `httpFetch` / `captureProfile` / `captureRouting` are now forwarded
  through the MCP/HTTP evidence-run normalizer (previously dropped on that path), so non-CLI callers
  can use the tier-0 / text / auto controls.
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
