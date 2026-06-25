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
before browser capture. When the browser-obstruction classifier later detects a
login wall, challenge, app interstitial, region/age gate, or unavailable media,
the runner maps those obstruction kinds into an `observedFailure` signal and
writes an `acquisition_method_runtime_plan` artifact. This closes the first
`classify-but-don't-act` gap: obstruction evidence now drives a second method
plan instead of remaining only a partial-status note.

The runtime plan is still planning context, not proof, and it currently records
the next legal tier rather than executing new gateway fetchers. Final claims
still need page text, HTML, screenshots, OCR, transcript cues, official API
metadata, or BYO bytes registered in the artifact ledger.

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
