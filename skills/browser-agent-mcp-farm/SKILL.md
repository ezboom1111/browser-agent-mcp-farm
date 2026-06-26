---
name: browser-agent-mcp-farm
description: >-
  SHA-256-registered, claim-gated browser evidence via the browser-agent-mcp-farm
  MCP tools (mcp__browser-agent-mcp-farm__farm_*). Use when you need a
  re-verifiable, tamper-evident evidence bundle of a web page, search result,
  video, dashboard, map/place, product, or social post — screenshots, page
  text/HTML, sampled video frames, OCR, WebVTT transcripts, official-API metadata
  — where every cited claim must reference a registered, hash-verified artifact
  and the run fails on uncited claims. Also covers market/competitor research
  (competitor_price, market_figure, review_sentiment claim types) and
  product/requirement research (user_pain, feature_gap, adoption_figure) — see
  "Lens claim types" below. Gather with generic browse / native deep-research;
  SEAL the load-bearing claims here when auditability and tamper-evidence
  matter: this farm is the one that hash-registers artifacts and runs a
  cite-or-fail claim gate. Do NOT use it for a trivial text fetch; it refuses
  login/CAPTCHA/paywall/age-gate bypass and payments/bookings. Requires the
  browser-agent-mcp-farm MCP server (mcp__browser-agent-mcp-farm__* tools).
---

# Browser-Agent MCP Farm

A local Playwright BrowserContext farm exposed as MCP tools
(`mcp__browser-agent-mcp-farm__farm_*`). It preserves what the browser actually
saw, derives typed artifacts when lawful and deterministic, and **fails the
final report unless every claim cites a registered, hash-verified artifact.**
Both Codex and Claude can drive it in parallel; named profile leases take a
best-effort cross-process lock (on local filesystems) so two agents avoid
clobbering the same cookie jar.

**Scope of the integrity guarantee (be honest):** the claim gate verifies that
the run's *registered* claims cite hash-verified artifacts and that the
provenance chain is present — it proves the evidence bundle is byte-stable and
internally consistent, not that the bytes faithfully represent the live page or
that your free-text answer is true. Cite artifacts; don't overstate.

## When to use this skill

- "Research / capture / verify / audit this page (or search result, video,
  dashboard, map/place, product, review, social post)."
- The answer depends on **rendered** state: images, charts, video frames,
  OCR-only prices/labels, timestamps, or whether the page is bot-blocked.
- You need an auditable evidence trail, not just scraped text.

Do **not** use it for a trivial plain-text fetch where a simple HTTP GET is
enough, and never to bypass authentication/paywalls or perform transactions.

## Fast path (recommended): one-shot evidence run

For most research, a single tool call does everything — capture, derive
evidence, run source/acquisition strategy, and produce a claim-gated report:

1. Call `mcp__browser-agent-mcp-farm__farm_evidence_run` with `{ "url": "<page>" }`.
   - The result includes `runDir`, `reportPath`, `claims`, and `claimGate`.
   - The MCP result is flagged `isError` if the final claim gate fails.
2. Read the report with `mcp__browser-agent-mcp-farm__farm_read_report`
   using `{ "reportPath": "<reportPath from step 1>" }`.
3. (Optional) Inspect evidence with `farm_list_artifacts` (`{ "runDir": ... }`,
   optional `evidenceKind` filter) and re-validate with `farm_run_claim_gate`.

Useful `farm_evidence_run` options:
- `researchIntent` — a soft intent lock for focused/alpha/trend/price/design
  work. Provide `decisionNeeded`, `targetScope`, `evidenceShapes`,
  `successCriteria`, and `boundaries` when the answer depends on what kind of
  evidence should be captured. The run records an `intent_profile` artifact with
  inferred modalities, missing questions, assumptions, and recommended capture
  options; it does not block autonomous capture.
  - Evidence shapes: `page_text`, `page_html`, `structured_data`,
    `semi_structured_dom`, `ui_screenshot`, `ocr_image_text`, `video_frames`,
    `captions_transcript`, `stt_asr`, `tts_detection`, `audio_events`,
    `map_place_state`, `byte_faithful_byo`.
  - Ask the user only when the missing intent changes capture modality, source
    universe, or refusal boundary. Otherwise proceed and label assumptions as
    provisional.
  - The soft lock is consumed by the runner: `ui_screenshot`,
    `ocr_image_text`, and `map_place_state` force browser full capture instead
    of tier-0 HTTP/cache replay; OCR falls back to the registered page
    screenshot when no frame screenshots exist.
  - STT/ASR, TTS detection, music/sound-event analysis, and raw audio claims are
    not farm-native. Route them to `leesearch-video-heavy` or another lawful
    heavy/BYO path, then register exact transcript/diagnostic bytes here.
- `captureRouting: "auto"` — try tier-0 browserless HTTP first, then escalate to
  browser capture when the HTTP path declines. This is the preferred default for
  text-heavy public pages when you do not need an initial screenshot.
- `ocr: { "enabled": true }` — OCR over sampled frames for image-rendered
  prices/labels/map pins. The `tesseract.js` engine auto-installs as an optional
  dependency; if a lean/offline install skipped it (`farm_capabilities` →
  `optionalDeps.tesseractAvailable: false`), run `npm install tesseract.js`.
- `denseSampling: { "enabled": true }` — denser frames around transcript / OCR /
  scene-change hits for video evidence.
- `profileName` + `storagePolicy` — drive an authenticated/anti-bot-sensitive
  page with a saved profile (headed login is CLI-only).

Acquisition behavior to rely on:
- Every evidence run writes an `acquisition_method_plan` artifact. Supported
  official API readiness is evaluated before browser capture without calling
  provider APIs; live provider calls still require explicit `officialApi.enabled`.
- Every evidence run writes an `intent_profile` artifact. With no explicit
  intent, it stays `underspecified` and records provisional assumptions plus the
  questions an agent should ask before stamping focused alpha/trend/price/design
  conclusions. With explicit intent, it locks the decision scope softly and
  maps evidence shapes to capture modalities without reviving selector recipes.
- Every evidence run writes a `trend_analysis` artifact derived from captured
  page text/title. It extracts deterministic trend signals such as recurring
  terms, recency markers, engagement words, local/commerce/finance indicators,
  and search-result surfaces. Treat it as a signal summary; cite the underlying
  `page_text`/`page_html` for load-bearing facts.
- Search-result surfaces can also write a `search_result_candidates` artifact:
  ranked candidate titles, URLs, source hosts, matched query terms, review/detail
  signals, and whether a page screenshot exists for UI/thumbnail grounding. It is
  a lead index; cite the original `page_text`, `page_screenshot`, destination
  page, or `ocr_text` for load-bearing claims.
- Every evidence run writes a `search_strategy_plan` artifact. It converts the
  current URL, intent profile, and trend terms into explicit search arms (current
  surface, portal-specific review/image arms, cross-check, official-source,
  community/video leads, dissent probe) with risk, success metric, and failure
  mode. Treat these arms as hypotheses, not a hardcoded scraping harness.
- Search-result surfaces with candidates also write a
  `candidate_deepening_ledger` artifact. It scores candidates by query fit,
  review/detail intent, screenshot/OCR usefulness, source type, promotion risk,
  and login/member-wall risk, then recommends a small follow-up queue such as
  `open_destination_capture` or `manual_profile_or_byo`.
- To deepen a completed search run without creating a broad crawler, use the CLI
  `search-followups --run-dir <runDir>`. It is plan-only by default and writes
  `search_followup_plan` plus `search_followup_outcome_ledger` artifacts. Add
  `--execute` only for an explicit bounded sequential run under
  `<runDir>/search-followups`; manual/profile/BYO items are recorded as skipped,
  not bypassed.
- If browser-visible obstruction is detected, the run writes an
  `acquisition_method_runtime_plan` artifact from the obstruction signal.
- For non-terminal public-page failures such as app interstitial or unavailable
  media, the run may try lawful public gateway capture (Jina Reader first,
  then Wayback latest snapshot) and register returned bytes as normal evidence.
- For public Naver Blog post text, prefer `captureRouting: "auto"` with
  `captureProfile: "text"` (`--auto-capture --text-only` in the CLI). The
  browserless tier rejects thin desktop iframe shells and escalates to the
  browser-visible frame text instead of falsely accepting the title-only shell.
- Login, paywall, CAPTCHA/challenge, age gate, and region gate stay terminal:
  record the obstruction or use consented profile/headed/human BYO, do not
  bypass.

(The per-site `sourceNavigation` selector recipes were removed 2026-06-10 —
selector recipes rot, and a consented browser + model vision reads portal pages
without them; see `docs/SELECTOR_STACK_EXCISION.md`. Navigate with your own
browser or the manual farm tools, then capture/register the bytes.)

## Manual path: step-by-step capture

When you need fine control:

1. `farm_acquire_context` → returns a lease `contextToken` (use
   `capability: "read-only"` unless you must act; `read-write` enables
   click/fill/press but payment/booking is still refused).
2. `farm_open_page` `{ contextToken, url }` → returns a `pageId`.
3. Settle/dynamic content: `farm_wait_for_selector` or `farm_capture_after_idle`;
   `farm_scroll` to reveal lazy content.
4. `farm_capture` → screenshot + text + HTML + metadata + visible links into the
   artifact ledger; `farm_sample_frames` for timestamped video frames (required
   to support any visual claim).
5. `farm_release_context` when done (frees the profile lock and resources).
   Call `farm_heartbeat` periodically during long work so the lease is not
   reaped.

## Verify, author, and portability (the trust loop)

- **Read back / re-verify a run:** `farm_list_runs` to find a runDir; then
  `farm_read_report`, `farm_list_artifacts`, `farm_read_artifact` (re-hashes on
  read to flag tampering), or `farm_run_claim_gate` to re-validate.
- **Make your OWN answer cite-or-fail:** `farm_register_evidence { text,
  evidenceKind, sourceUrl }` → an artifactId, then `farm_add_claim { claim,
  artifactId, anchor: { type: "text_span", quote } }`. The gate rejects a claim
  whose quote is not present in the cited bytes.
- **Byte-faithful BYO:** when an external bridge, human capture, HAR, image, or
  other non-text supplier gives exact bytes, use
  `farm_register_evidence { bytesBase64, mime, format, evidenceKind, sourceUrl,
  captureMethod }` instead of retyping the content as `text`.
- **Structured provenance:** the gate distinguishes farm-DERIVED structured_data
  (deterministic extraction from witnessed pages) from AGENT-AUTHORED structured_data
  (self-asserted JSON — the measured "news repackaged as JSON" failure mode, ~36%
  genuine in QA). Default: warning. `farm_run_claim_gate { strictProvenance: true }`
  makes an agent-authored structured citation a hard error — use it for audits.
- **Portable attestation:** `farm_export_bundle { runDir }` produces a
  Merkle-rooted (optionally Ed25519-signed) manifest, **auto-verifies it on export**
  (a tampered-at-export run fails instead of shipping a poisoned bundle), and returns
  the verification; another agent runs `farm_verify_bundle` to re-check it, fully offline.
- **Structured facts:** `farm_extract_structured { html }` parses JSON-LD /
  Open Graph from a page_html artifact — treat publisher markup as a site claim
  and cross-check it.

See [`docs/THREAT_MODEL.md`](../../docs/THREAT_MODEL.md) for exactly what these
prove and do not prove.

## Lee-vault method memory bridge

When a run changes how future acquisition should work — for example a new
blocked-page fallback, a reusable public endpoint, or a method-selection lesson
like the insane-search ladder — do not leave it only as a farm bundle. The farm
bundle is a derived artifact; reusable method memory lives in the vault.

After exporting or recording the bundle root, run the repo CLI:

```powershell
node .\dist\cli.js kb-acquisition-bridge `
  --run-dir <evidence-run-dir> `
  --url <source-url> `
  --vault-root C:\lee-vault `
  --merkle-root <bundle-root> `
  --apply
```

This writes/updates `SYSTEM_DNA.md`, an acquisition recipe, a frontier ledger, a
bridge note, and `LOG.md`. `--url` is needed only for older sealed runs that
predate `acquisition_method_plan` artifacts. It is dry-run without `--apply`.
The farm core does not depend on the vault; this is a personal KB adapter over
completed evidence runs.

## Pattern: be the verification layer for a "deep research" answer

Deep-research / agentic-browse tools — and ever-larger base models — are strong
at **breadth**, but their **citations are frequently unreliable**: independent
testing of AI search answers has found the wrong or broken source cited a
majority of the time. This farm's job is the complementary half — turn the few
**load-bearing** claims of any such answer into cite-or-fail, tamper-evident
evidence a third party can re-check. Use it when the gathering happened elsewhere
and you must not ship an uncited or misquoted claim:

1. Pick the claims a decision actually rests on (the load-bearing few, not every
   sentence).
2. Get the bytes: with only a URL, `farm_evidence_run { url }` (or `farm_capture`)
   captures and hash-registers the page; if you already hold the exact text you
   read, `farm_register_evidence { text, evidenceKind, sourceUrl }`.
3. `farm_add_claim { claim, artifactId, anchor: { type: "text_span", quote } }` —
   the gate **rejects** a claim whose `quote` is not present in the cited bytes,
   so a hallucinated citation cannot pass.
4. `farm_run_claim_gate` — uncited / unregistered / misquoted claims fail the run
   (non-zero exit).
5. `farm_export_bundle { runDir }` → a Merkle-rooted `.evb` a teammate
   re-verifies fully offline with `farm_verify_bundle`, trusting hashes, not you.

Honest boundary: this proves your answer is **grounded in the captured bytes**
(no invented quotes, no dangling citations) and that the bundle is byte-stable —
it does **not** redo the research's coverage, and it does not prove the captured
page equals live-origin truth to a distrusting adversary (see
`docs/THREAT_MODEL.md`). It is the cheapest way to stop a fast, broad, but
loosely-cited answer from becoming an unverifiable one.

## Lens claim types (market scan / product planning)

These typed-claim recipes used to live in two separate wrapper skills
(`market-scan`, `product-planning`); they are sections here because the
enforcement lives in the gate, not in the wrapper. (`farm_lens
{ "lensId": "market_scan" | "product_planning" }` returns the same templates,
report sections, and prioritized sources as a tool result, if you prefer.)

**Market scan** — competitor pricing, review sentiment, market sizing:
- `competitor_price` (metadata) — cite the `structured_data` / `page_text` /
  `ocr_text` artifact; anchor the exact price text (`anchor.text_span`).
- `review_sentiment` (text) — each supporting quote grounded in a captured
  review's bytes.
- `market_figure` (metadata) — **corroborate** across ≥2 independent sources:
  `corroboration: { sources: [{ artifactId, quote }], minIndependentSources: 2 }`.
  The gate verifies each source is registered, checks each quote against that
  source's bytes, and counts distinct registrable domains.
- Report sections: Executive summary · Competitor pricing · Review sentiment ·
  Market sizing · Sources.

**Product planning** — user pains, feature gaps, adoption signals:
- `user_pain` (text) — a user-reported pain point, grounded in a forum/review
  quote (`anchor.text_span` on the quoted bytes).
- `feature_gap` (text) — a missing/requested feature vs an alternative,
  grounded in a quote.
- `adoption_figure` (metadata) — an adoption/usage/demand figure; corroborate
  an important one across ≥2 independent sources (same `corroboration` shape).
- Report sections: Summary · User pains · Feature gaps · Opportunities · Sources.

Shared rules: a price/figure/user quote is a **site claim** — cite the bytes;
corroborate the numbers a decision rests on; never state a number you cannot
cite. A blocked/login-walled page is recorded as an obstruction, not faked.

## Evidence rules to respect

- A claim is only as good as its citation: visual claims require a timestamped
  frame screenshot; transcript/audio claims require the matching artifact.
- A search result is only a lead — open and capture the destination page itself
  (judge its usefulness against the user's question) before citing anything from it.
- If a page is blocked/paywalled/login-only/CAPTCHA, the run records that
  obstruction instead of faking evidence. Report it; do not bypass it.

## Setup

If the MCP tools are not present, the user can register the server (and this
skill) from the repo with `node ./dist/cli.js register-all`, then restart the
agent. The server name is `browser-agent-mcp-farm`; tools appear as
`mcp__browser-agent-mcp-farm__farm_*`.
