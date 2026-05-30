---
name: browser-agent-mcp-farm
description: >-
  Evidence-first browser research/capture driven by the browser-agent-mcp-farm
  MCP tools. Use when the user asks to research, capture, verify, audit, or
  extract from a web page, search result, video, dashboard, map/place, product,
  or social/media page AND wants the result backed by auditable, registered
  evidence (screenshots, page text/HTML, sampled video frames, OCR, transcripts,
  official-API metadata) rather than plain text scraping that would miss
  rendered state, images, charts, prices, or bot-block walls. The farm refuses
  to bypass logins/CAPTCHAs/paywalls/age gates or to perform payments/bookings,
  and final claims must cite registered artifacts.
---

# Browser-Agent MCP Farm

A local Playwright BrowserContext farm exposed as MCP tools
(`mcp__browser-agent-mcp-farm__farm_*`). It preserves what the browser actually
saw, derives typed artifacts when lawful and deterministic, and **fails the
final report unless every claim cites a registered, hash-verified artifact.**
Both Codex and Claude can drive it in parallel; profile leases are locked across
processes so two agents never clobber the same cookie jar.

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
evidence, run source strategy + bounded destination triage, and produce a
claim-gated report:

1. Call `mcp__browser-agent-mcp-farm__farm_evidence_run` with `{ "url": "<page>" }`.
   - The result includes `runDir`, `reportPath`, `claims`, and `claimGate`.
   - The MCP result is flagged `isError` if the final claim gate fails.
2. Read the report with `mcp__browser-agent-mcp-farm__farm_read_report`
   using `{ "reportPath": "<reportPath from step 1>" }`.
3. (Optional) Inspect evidence with `farm_list_artifacts` (`{ "runDir": ... }`,
   optional `evidenceKind` filter) and re-validate with `farm_run_claim_gate`.

Useful `farm_evidence_run` options:
- `ocr: { "enabled": true }` — OCR over sampled frames (needs the optional
  `tesseract.js` peer dep) for image-rendered prices/labels/map pins.
- `denseSampling: { "enabled": true }` — denser frames around transcript / OCR /
  scene-change hits for video evidence.
- `sourceNavigation` — an explicit, bounded, read-only recipe for portal pages
  (Naver/Google/maps/etc.): only the supplied action-key steps run, and only
  non-mutating operations are allowed.
- `profileName` + `storagePolicy` — drive an authenticated/anti-bot-sensitive
  page with a saved profile (headed login is CLI-only).

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

## Evidence rules to respect

- A claim is only as good as its citation: visual claims require a timestamped
  frame screenshot; transcript/audio claims require the matching artifact.
- A search result is only a lead — destination triage follows bounded depth-1
  child runs and judges usefulness against the user's question before relying on
  a child page.
- If a page is blocked/paywalled/login-only/CAPTCHA, the run records that
  obstruction instead of faking evidence. Report it; do not bypass it.

## Setup

If the MCP tools are not present, the user can register the server (and this
skill) from the repo with `node ./dist/cli.js register-all`, then restart the
agent. The server name is `browser-agent-mcp-farm`; tools appear as
`mcp__browser-agent-mcp-farm__farm_*`.
