# Acquisition Method Planner

`src/acquisition-method-planner.ts` is the narrow integration point for the
useful DNA from method-selection tools such as `insane-search`.

It does not vendor or trust an external crawler. It records a safe, ordered
acquisition plan that an evidence run can carry as a `source_strategy` artifact:

1. public official endpoints or feeds when available
2. feed, sitemap, JSON-LD, Open Graph, and canonical metadata discovery
3. tier-0 HTTP fetch with content validation
4. deterministic extraction from already captured bytes
5. browser-visible capture in the farm
6. consented profile/headed or caged external BYO capture when direct capture is
   blocked
7. universal BYO registration through the same cite-or-fail gate

## Why This Exists

The removed selector stack tried to keep per-site CSS recipes alive. That was
the wrong durability point: selectors rot. The durable part of the idea is
method selection:

- do not stop at the first HTTP 200
- try public API/feed/syndication paths before browser work
- classify empty shells, challenge pages, and obstructions as acquisition
  states
- treat provider shells, such as Naver Blog desktop iframe pages with only
  title-level text, as tier-0 declines so auto routing reaches the public
  browser-visible article text
- when a direct farm capture cannot reach a public page, let a lawful external
  capturer supply exact bytes, but tag it as BYO/external provenance and make
  the claim gate verify the anchors

## Boundaries

The planner keeps the farm's existing refusal line:

- no login, paywall, CAPTCHA, age-gate, booking, payment, account-change, DRM,
  or raw media stream bypass
- external captures are untrusted byte suppliers, not trusted browser-visible
  farm captures
- selector pressure does not revive per-site selector recipes

`external_bridge` remains opt-in, zero-credential, domain-fenced, read-only, and
short-lived. If a page is login/paywall/CAPTCHA-gated, the planner routes to
consented profile/headed/human BYO only and does not recommend an autonomous
external bridge.

## Evidence Runner Link

Every `runEvidenceWorkflow` now writes an `acquisition_method_plan` artifact
before browser capture. It also evaluates official API credential readiness for
supported platforms before the browser opens; this is a no-provider-call
planning artifact unless live official API collection is explicitly enabled.
When the browser-obstruction classifier later detects a login wall, challenge,
app interstitial, region/age gate, or unavailable media, the runner maps those
obstruction kinds into an `observedFailure` signal and writes an
`acquisition_method_runtime_plan` artifact. This closes the first
`classify-but-don't-act` gap: obstruction evidence now drives a second method
plan instead of remaining only a partial-status note.

The runtime plan is still planning context, not proof, and it currently records
the next legal tier before any recovered bytes can be cited. For non-terminal
public-page failures such as app interstitial or unavailable-media surfaces, the
runner can now execute farm-native public gateway capture through Jina Reader
(`https://r.jina.ai/<url>`) and then the Internet Archive Wayback availability
API/latest snapshot fallback. Returned gateway bytes are registered and cited
through the normal claim gate. Local, private, localhost,
login/paywall/CAPTCHA, age-gate, and region-gate targets are not sent to
third-party readers.

AMP discovery and archive.today-style gateways are still separate future arms.
Final claims still need page text, HTML, screenshots, OCR, transcript cues,
official API metadata, gateway text, or BYO bytes registered in the artifact
ledger.

Every run also writes a deterministic `trend_analysis` artifact after page
capture. It summarizes recurring terms, surface type, recency markers,
engagement words, and local/commerce/finance indicators from captured text. It
is a method/navigation signal, not independent proof of popularity; cite the
underlying `page_text` or other source artifacts for factual claims.

Search-result surfaces also write a deterministic `search_result_candidates`
artifact when captured text/link metadata yields candidates. It preserves ranked
candidate titles, URLs, source hosts, matched query terms, review/detail
signals, and whether a page screenshot exists for thumbnail/UI grounding. This
is an index over witnessed bytes, not a factual claim by itself; cite the
original `page_text`/`page_screenshot`/`ocr_text` artifacts for load-bearing
claims.

Every run now also writes a `search_strategy_plan` artifact. It turns the
captured URL, soft intent, and trend terms into explicit search arms such as
current surface, Naver VIEW/image, Google cross-check, official-source probe,
community review, video/social leads, and dissent probe. These arms are
hypotheses with risk, success metric, and failure mode fields; they are not a
maintained per-platform scraping harness.

When search candidates exist, the run writes a `candidate_deepening_ledger`
artifact. It scores each candidate by query fit, review/detail intent, visual or
OCR evidence availability, source type, promotion risk, and membership/login
wall risk. The ledger selects a small follow-up queue and records the next
action (`open_destination_capture`, `manual_profile_or_byo`, or skip), so agents
can deepen deliberately instead of blindly opening every result.

To close the next loop without turning the farm into a crawler, use the
`search-followups` CLI on a finished parent run:

```powershell
node .\dist\cli.js search-followups `
  --run-dir <parent-evidence-run-dir> `
  --max-arms 2 `
  --max-candidates 3
```

The default is plan-only. It writes `search_followup_plan` and
`search_followup_outcome_ledger` artifacts back into the parent run. Add
`--execute` only when you deliberately want the bounded queue to run
sequentially under `<runDir>/search-followups`. Deferred/manual/profile/BYO
items are recorded as skipped; they are not bypassed. Child runs are
exploratory by default. Add `--child-final-claim-gate` when the generated child
claims should be final-gated for use as proof rather than merely collected as
follow-up evidence.

## Intent / Modality Soft Lock

`src/intent-profile.ts` is the companion wiring for the user's "what exactly
should we inspect?" question. It is deliberately a soft lock, not a blocking
approval gate:

- with no explicit intent, the run still proceeds and records an
  `intent_profile` artifact as `underspecified`
- with partial intent, it records provisional assumptions and only asks the
  missing questions that would change capture modality, source universe, or
  refusal boundaries
- with complete intent, it records the decision scope, evidence shapes, success
  criteria, boundaries, and recommended capture options

This preserves autonomy and efficiency while preventing a text-only capture from
silently standing in for UI, image/OCR, video-frame, map/place, STT/ASR,
TTS/audio, or byte-faithful BYO evidence. The supported shape vocabulary is:
`page_text`, `page_html`, `structured_data`, `semi_structured_dom`,
`ui_screenshot`, `ocr_image_text`, `video_frames`, `captions_transcript`,
`stt_asr`, `tts_detection`, `audio_events`, `map_place_state`, and
`byte_faithful_byo`.

The soft lock now drives capture options, not just documentation. If the intent
needs `ui_screenshot`, `ocr_image_text`, or `map_place_state`, the runner skips
tier-0 HTTP/cache replay, uses full browser capture, and enables OCR. OCR first
uses timestamped frame screenshots when video/frame evidence exists; otherwise
it falls back to the registered page screenshot. Korean/Naver URLs default to
`kor+eng` OCR when OCR was enabled by intent rather than by an explicit CLI
flag.

The farm-native side covers page text/HTML, structured extraction, screenshots,
OCR, frame sampling, captions when lawfully served, map/place browser surfaces,
and exact BYO byte registration. STT/ASR, TTS detection, music/sound-event
analysis, and raw audio understanding remain outside the trusted farm capture
path. Those must come from `leesearch-video-heavy` or another lawful heavy/BYO
extractor and then be registered as exact bytes with clear provenance.

## Knowledge-Base Bridge

`kb-acquisition-bridge` is the Lee-vault wiring layer for method memory. It
reads a completed evidence run's `acquisition_method_plan` artifact plus any
`browser_obstruction` artifacts and generates the vault markdown that makes the
method reusable:

```powershell
node .\dist\cli.js kb-acquisition-bridge `
  --run-dir <evidence-run-dir> `
  --url <source-url> `
  --vault-root C:\lee-vault `
  --merkle-root <bundle-root> `
  --apply
```

`--url` is optional for new runs that already contain an
`acquisition_method_plan` artifact. Use it for older sealed runs that predate
the planner artifact; the bridge will mark the plan as provisional.

Generated targets:

- `SYSTEM_DNA.md`: a local-synthesis row for the method-selection ladder.
- `vault/methods/acquisition/farm-insane-search-method-selection-ladder.md`:
  acquisition recipe, fallback chain, risk boundary, and next upgrade hooks.
- `vault/sessions/<date>-browser-agent-mcp-farm-acquisition-frontier.md`:
  frontier ledger and blocked-source checks.
- `vault/sessions/<date>-browser-agent-mcp-farm-kb-bridge.md`: bridge note
  pointing back to `runDir`, Merkle root, plan artifact, and obstruction
  artifacts.
- `LOG.md`: append-only operation entry.

The command is dry-run by default and writes only with `--apply`. The farm core
does not import the vault; this bridge is a personal knowledge-base adapter over
finished run artifacts.
