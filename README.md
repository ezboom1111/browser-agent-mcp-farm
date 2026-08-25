# Browser-Agent MCP Farm

[![CI](https://github.com/ezboom1111/browser-agent-mcp-farm/actions/workflows/ci.yml/badge.svg)](https://github.com/ezboom1111/browser-agent-mcp-farm/actions/workflows/ci.yml)
[![qa (anti-hallucination fuzz)](https://github.com/ezboom1111/browser-agent-mcp-farm/actions/workflows/qa.yml/badge.svg)](https://github.com/ezboom1111/browser-agent-mcp-farm/actions/workflows/qa.yml)
[![npm](https://img.shields.io/npm/v/browser-agent-mcp-farm.svg)](https://www.npmjs.com/package/browser-agent-mcp-farm)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

> 한국어 README: [README.ko.md](./README.ko.md)

**Tamper-evident web evidence for AI agents.** An MCP server (plus CLI) that
captures what the browser actually saw, SHA-256-registers every artifact, and
**fails any cited claim that doesn't re-match the registered bytes**
(cite-or-fail) — then exports a Merkle-rooted, optionally Ed25519-signed bundle
that a second agent re-verifies **fully offline**.

This is **not another browser driver.** Playwright MCP, Chrome DevTools MCP,
and consented in-browser agents already drive the web well. The farm is the
**verification layer beside them**: gather anywhere, then seal the load-bearing
few claims here, so "the model said it saw it" becomes "here are the bytes, the
hash, the quote inside them, and a bundle you can re-check without trusting me."

## 30-second code review

| Review question | Start here |
| --- | --- |
| Does a fabricated quote fail? | [`src/claim-gate.ts`](src/claim-gate.ts) and [`tests/claim-gate.test.ts`](tests/claim-gate.test.ts) |
| Can another agent verify the hand-off offline? | [`src/evidence-bundle.ts`](src/evidence-bundle.ts) and [`tests/evidence-exchange.test.ts`](tests/evidence-exchange.test.ts) |
| Are browser actions bounded? | [`src/browser-pool.ts`](src/browser-pool.ts), [`src/lease-manager.ts`](src/lease-manager.ts), and their tests |
| Are the limits explicit? | [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) and [`SECURITY.md`](SECURITY.md) |
| Is the repository reproducibly green? | `npm ci && npm run verify`; the same gate runs on Ubuntu/Windows and Node 22/24 |

The project was built as a solo engineering system, so the public evidence is
the implementation, adversarial fixtures, generated status, and reproducible CI
rather than claims of team-scale production usage.

## Why

Agents browse, then assert. When the output feeds a real decision, document, or
dispute, three failure modes matter:

1. **Hallucinated citations** — the quoted page never said that.
2. **Silent tampering** — the saved evidence changed after capture.
3. **Unverifiable hand-offs** — a second agent (or a human reviewer) has no way
   to re-check the first agent's evidence without redoing the work.

The farm closes these with a deterministic floor: every artifact is
hash-registered at capture; a claim must cite a registered, typed artifact and
(for anchored claims) its quoted `text_span` must actually exist in the cited
bytes; the run **fails** on uncited or misquoted claims; the exported bundle is
re-verified at export time and again, offline, by whoever receives it.

Adjacent tools solve adjacent problems: C2PA / Content Credentials signs media
assets at creation; WACZ / signed web archives seal page archives; zkTLS /
TLSNotary proves TLS sessions. The farm sits in the gap those leave —
**claim-level, agent-integrated (MCP), locally verifiable web evidence** — and
is designed to interoperate with them rather than replace them.

## What it proves — and what it doesn't

This project treats its own limits as a feature. The short version
(full detail: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)):

| | Proves | Does NOT prove |
| --- | --- | --- |
| **Claim gate** | Every registered artifact's bytes still match their recorded SHA-256 (re-hashed at gate time); every final claim cites a registered, typed artifact; an anchored claim's quote is present in the cited bytes | That the captured bytes faithfully represent the live page (a malicious *producer* could register fabricated bytes); that an un-anchored claim is true; anything about free-text prose outside the ledger |
| **Evidence bundle** | Offline: every manifest artifact present and hash-matching; Merkle root recomputes; with a public key, the root was signed by the matching private-key holder | That the sealed bytes are a faithful record of the live web — the signature attests *who sealed*, not *what was true* |

Read a green gate as *"this evidence is internally consistent, byte-stable, and
the claims are grounded in it"* — never as *"this answer is true."* For truth,
corroborate the highest-stakes numbers across independent sources; for
origin-binding (proving bytes came from the origin server), see the opt-in
capture-binding tiers below and their honest limits.

## Install & 60-second quickstart

Requires Node.js **22+** (CI tests 22 and 24). Chromium is auto-installed on
first `serve` if missing (opt out with `FARM_SKIP_BROWSER_AUTOINSTALL=1`).

**From npm (recommended):** register a portable `npx`-resolved invocation with
Claude Code and/or Codex — the host config carries no build path, and upgrades
flow through the package manager:

```sh
npx -y browser-agent-mcp-farm@latest register-all --npx
# or pin / use a scope:  ... register-all --npx --package-spec browser-agent-mcp-farm@0.8.0
```

**From a clone (development):**

```sh
npm ci
npx playwright install --with-deps chromium
npm run build
node ./dist/cli.js register-all        # registers the absolute path of this build
```

(`./install.ps1` on Windows or `sh install.sh` on macOS/Linux runs those steps
plus `register-all` in one go, with timestamped config backups.)

Restart your agent, then verify: `claude mcp get browser-agent-mcp-farm`. The
tools appear as `mcp__browser-agent-mcp-farm__farm_*`.

Run one auditable, claim-gated capture from the CLI:

```sh
node ./dist/cli.js evidence-run --url https://example.com/ --no-frames --wait-ms 0 --timeout-ms 10000
```

From an agent, call `farm_evidence_run` with `{ "url": "https://example.com/" }`,
then `farm_read_report` with the returned `reportPath`. The full agent playbook
lives in [`skills/browser-agent-mcp-farm/SKILL.md`](skills/browser-agent-mcp-farm/SKILL.md)
(installed for Claude automatically by `register-all`; the copy self-heals on
`serve` after upgrades).

## The core loop: cite-or-fail

The strongest way to use the farm is as a **verification layer over research
you gathered any way you like**:

```text
1. capture / register bytes      farm_evidence_run { url }                    (farm captures)
                                 farm_register_evidence { text | bytesBase64 } (you captured — BYO)
2. author claims against them    farm_add_claim { claim, artifactId,
                                                  anchor: { type: "text_span", quote } }
3. gate                          farm_run_claim_gate { strictProvenance: true }
                                 → a claim whose quote is NOT in the cited bytes FAILS the run
4. seal                          farm_export_bundle { runDir }  (auto-verifies before shipping)
5. hand off                      farm_verify_bundle — anyone re-checks offline
```

A hallucinated citation cannot pass step 3: the gate re-reads the registered
bytes and rejects the claim. `strictProvenance` additionally hard-fails claims
that cite agent-authored "structured data" (self-asserted JSON) instead of
farm-derived extraction — closing the measured "news retyped as JSON" hole.

### Worked agent-to-agent verifiable exchange

The self-contained `.evb` archive lets one agent trust another's evidence by
trusting hashes, not the producer:

```sh
# Agent A (captured the evidence, holds a private signing key)
node dist/cli.js export-bundle --run-dir <A-run> --archive-file bundle.evb \
  --private-key-env A_SIGNING_KEY

# Agent B receives only bundle.evb + A's PUBLIC key — no run dir, no browser
node dist/cli.js verify-bundle --archive-file bundle.evb --public-key-env A_PUBLIC_KEY
# -> { ok: true, complete: true, merkleMatches: true, signatureValid: true }
```

B re-hashes the embedded bytes, recomputes the Merkle root, and checks A's
signature **fully offline**. Altered bytes → `tamperedArtifacts`; an impostor
key → `signatureValid: false`. The success criterion is "one cooperating second
agent can verify," not "the world converges" — see
`tests/evidence-exchange.test.ts` for the worked A→B example.

## MCP tool surface (32 tools)

| Group | Tools |
| --- | --- |
| One-shot workflow | `farm_evidence_run`, `farm_read_report` |
| Manual capture | `farm_acquire_context`, `farm_open_page`, `farm_capture`, `farm_capture_after_idle`, `farm_wait`, `farm_wait_for_selector`, `farm_scroll`, `farm_sample_frames`, `farm_close_page`, `farm_release_context`, `farm_heartbeat` |
| Write actions (lease `capability: "read-write"`; payment pages always refused) | `farm_click`, `farm_fill`, `farm_press`, `farm_select_option` |
| Cite-or-fail authoring | `farm_register_evidence`, `farm_register_transcript`, `farm_add_claim`, `farm_judge_claim` |
| Verification (no browser) | `farm_run_claim_gate`, `farm_list_runs`, `farm_list_artifacts`, `farm_read_artifact` (re-hashes on read), `farm_capabilities` |
| Sealing & structure | `farm_export_bundle`, `farm_verify_bundle`, `farm_extract_structured` |
| Research lenses & ops | `farm_lens`, `farm_list_leases`, `farm_reap_expired` |

`farm_lens` ships declarative claim-type lenses: `market_scan`
(`competitor_price`, `review_sentiment`, and `market_figure` — the latter
requires corroboration across ≥2 independent registered domains, verified
against each source's bytes) and `product_planning` (`user_pain`,
`feature_gap`, `adoption_figure`).

## CLI

The same engine, scriptable. Highlights (full list: `browser-agent-mcp-farm help`):

| Command | Purpose |
| --- | --- |
| `serve` / `serve-http` | MCP stdio server / local HTTP job queue (`/health`, `/evidence-run`, `/jobs`) |
| `evidence-run` | Full capture → typed artifacts → claims → final gate, one command |
| `claim-gate` | Re-validate a run; `--strict-provenance`, `--mode final`, non-zero exit on failure |
| `export-bundle` / `verify-bundle` | Merkle manifest or self-contained signed `.evb`; `--anchor-log` appends the root to a hash-chained transparency log |
| `verify-decision-log` / `verify-timestamp-log` | Verify gate-verdict / transparency-log hash chains |
| `scan-secrets` | Scan a finished run for secrets-at-rest (non-zero exit if found) |
| `purge-run` / `prune-runs` / `archive-run` | Retention: delete, sweep by age/byte budget, or tier-archive runs |
| `auth-login` / `auth-cdp-launch` / `auth-cdp-import` | Consented login profiles (visible browser; or import cookies from your own Chrome via DevTools port) |
| `profile-list` / `profile-remove` | Manage saved profiles |
| `smoke` / `smoke-web` / `smoke-media` / `smoke-proxy` | Fixture and public-page smoke captures |
| `html-preview` | Human-browsable preview of a run's evidence |
| `platform-capabilities` / `official-api-readiness` | What evidence paths exist for a platform URL; are the needed credential env vars set (never prints token values) |
| `register-claude` / `register-codex` / `register-all` | Host registration (with `--npx` for published-package installs); timestamped config backups |
| `upgrade` | Show installed version + upgrade/re-register instructions |

Useful `evidence-run` options: `--http-fetch` (browserless tier-0 GET) and
`--auto-capture` (tier-0 first, escalate to the browser on *any* decline);
`--capture-cache` (replay a ≤1h prior capture by content hash, labelled
`cached_capture` with staleness age); `--text-only`; `--headed`; `--profile
<name>` / `--persistent-profile`; `--ocr` (+`--ocr-language`,
`--ocr-min-confidence`); `--dense-sampling` (extra frame windows around
transcript-cue / OCR / scene-change hits); `--official-api` (credentials via
env-var *names* only); `--intent` / `--intent-scope` / `--intent-shapes` /
`--success-criteria` (soft intent lock recorded as an `intent_profile`
artifact). Non-terminal public-page failures fall back to legal public gateways
(Wayback latest snapshot); login/paywall/CAPTCHA/age/region gates stay terminal.

## What a run records

`evidence-run` writes typed, hash-registered artifacts for everything it
derives: page text/HTML/screenshot, timestamped media frame samples (never raw
stream downloads), WebVTT transcript cues, OCR passes (as *derivatives* of a
registered screenshot, with language/confidence/text-profile metadata),
structured extraction (JSON-LD / Open Graph / typed price+rating), acquisition
method plans, official-API readiness, source strategy, obstruction
classifications (login walls, bot blocks, region/age gates — recorded as
obstructions, **not** treated as content), overlay-dismissal evidence, and
stage timings. Claims and citations land in append-only ledgers; the final
claim gate runs last and fails the run on any uncited or misquoted claim.

## Authenticated capture — consent-first

For sites that need login, the operator logs in **manually, once**, in a
visible browser (`auth-login`, or `auth-cdp-launch`/`auth-cdp-import` to import
cookies from your own Chrome). Saved profiles live under
`~/.gstack/browser-profiles/<profile>/`, created owner-only (POSIX `0700` /
Windows ACL). On Windows, `FARM_ENCRYPT_STORAGE_STATE=1` wraps the storage
state with DPAPI (CurrentUser) — protecting at-rest/offline copies, not code
running as the same user. One active lease per profile is enforced across
processes by an on-disk lock, so parallel workers never clobber a cookie jar.

## Safety boundaries (enforced in code, not prose)

- **No login / CAPTCHA / paywall / age-gate bypass.** Walls are classified and
  recorded as obstructions; consented profiles are the only authenticated path.
- **No payment / booking / account-change automation** — write actions are
  blocked on payment-like URLs, selectors, and element text
  (`checkout`, `cvv`, `pay now`, `결제`, …).
- **No raw platform video/audio stream download**, and no claim of audio/video
  understanding without a matching transcript/frame artifact. The farm performs
  no speech-to-text; captured captions are registered as `transcript_cue`,
  never a fabricated transcription.
- Every source-registry entry carries a `legalBasis`
  (`public_browser_visible`, `official_api`, `user_provided`,
  `derivative_citation`, `planning_only`) recording the intended lawful-access
  posture.

## Security posture

- **Least privilege by default**: leases are read-only unless `read-write` is
  requested; domain allowlists per lease; payment guard on all write paths.
- **HTTP mode is authenticated**: `serve-http` refuses to start on a
  non-loopback host without a token; with `FARM_HTTP_TOKEN` (or `--token`) set,
  every request needs `Authorization: Bearer <token>` (401 before any route
  logic). Intended for local orchestration, not as a shared production service.
- **Small supply chain**: three runtime dependencies
  (`@modelcontextprotocol/sdk`, `playwright`, `zod`) plus optional
  `tesseract.js`; `npm audit` runs inside the release gate.
- Secrets: credentials are passed as env-var *names*, never values, through
  CLI/MCP/HTTP inputs; `scan-secrets` checks finished runs for leaked tokens.
- Vulnerability reports: see [`SECURITY.md`](SECURITY.md).

## Opt-in capture-binding tiers

Default captures are plain and unchanged. Opt-in pieces bind a capture closer
to its origin — each documented with what it does **and does not** prove
([`docs/CAPTURE_BINDING.md`](docs/CAPTURE_BINDING.md)):

- `FARM_BIND_TLS=1` — record the TLS certificate the final host presents
  (separate probe): cert pinning / issuer-change detection.
- `FARM_BIND_TLS_SAMECONN=1` — record the certificate on the **same socket**
  that delivered the bytes (tier-0 HTTP path).
- `export-bundle --anchor-log` — append verified Merkle roots to a
  hash-chained transparency log (proves relative *order*, not wall-clock time;
  an RFC-3161 TSA seam is in place for real timestamps).

None of these upgrade trust by themselves — the deterministic gate stays the
trust boundary. Full origin-binding (proving bytes came from the origin server
against a malicious local producer) requires a neutral notary (zkTLS-class);
that boundary is documented, not papered over
([`docs/ORIGIN_BINDING_DESIGN.md`](docs/ORIGIN_BINDING_DESIGN.md)).

## Quality gates

`npm run verify` = build → typecheck → lint → **dependency-boundary guard**
(the browser/lease primitives may never import platform logic — build-enforced)
→ tests + coverage (ratcheting floor) → 4 smoke captures → packaged-tarball
test → `npm audit` → generated status. CI runs the same gate on Ubuntu and
Windows, Node 22 and 24. Current numbers live in the generated
[`STATUS.md`](STATUS.md) / [`SCORECARD.md`](SCORECARD.md) — they are not
restated here by design.

The cite-or-fail boundary itself is regression-tested by a versioned,
seed-deterministic fuzz corpus (`npm run qa:fuzz`, a hard CI gate): currently
**0 hallucination leaks across 1,200 fabrication / near-miss / recombination
trials**. New hard cases are added by appending seeds, never removing one.

## Architecture (one paragraph)

Thin transports (`mcp-server` / `cli` / `http-server`) → a single facade
(`farm-service`) → generic browser primitives (`lease-manager`,
`browser-pool`) → platform intelligence (source strategy, adapters, OCR,
official API) → run orchestration (`evidence-runner`) → integrity
(`claim-gate`). One hard, build-enforced rule: **primitives never import the
layers above them** (`npm run boundaries` fails the build otherwise). Details:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Host integration

Two modes, documented in [`HOST-ADAPTERS.md`](HOST-ADAPTERS.md):

- **Mode A — parent-driven** (default, safest): the parent agent holds the farm
  tools, captures, and hands saved artifacts to analyzer subagents.
- **Mode B — browser-worker subagents**: only when the host can grant farm MCP
  tools to a worker; one task + domain allowlist per worker, own `agentId`,
  release in a `finally` block, never reuse another worker's context token.

## Documentation

| Doc | What's in it |
| --- | --- |
| [`skills/browser-agent-mcp-farm/SKILL.md`](skills/browser-agent-mcp-farm/SKILL.md) | The agent-facing playbook (tool flow, lens claim types, refusal lines) |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | Exactly what the gate/bundle prove and do not prove |
| [`docs/CAPTURE_BINDING.md`](docs/CAPTURE_BINDING.md) | Opt-in provenance pieces, shipped vs deliberately deferred |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layering + the build-enforced boundary rule |
| [`docs/OFFICIAL_API.md`](docs/OFFICIAL_API.md) / [`docs/OCR.md`](docs/OCR.md) | Optional credentialed-API and OCR surfaces |
| [`docs/QA_QC_PROCESS.md`](docs/QA_QC_PROCESS.md) | The quality gates and how "verified" is defined |
| [`docs/DOCUMENTATION_MAP.md`](docs/DOCUMENTATION_MAP.md) | Full doc index (including development history) |
| [`CHANGELOG.md`](CHANGELOG.md) | Versioned changes (semver) |

## Scope & non-goals

In scope: the local capture-and-verify slice — leases, consented capture,
hash-registered typed artifacts, claim gating, sealed bundles, host
registration, and a local HTTP queue.

Out of scope, permanently: payment actions; DRM bypass or raw platform
video/audio download; login/CAPTCHA/paywall bypass; a production multi-tenant
remote service. (Historical note: a per-site selector/recipe subsystem was
deliberately excised in 2026-06 — selector recipes rot; model vision + a
consented browser replaced them. `docs/SELECTOR_STACK_EXCISION.md` records the
decision.)

## License

[Apache-2.0](./LICENSE) © 2026 이지범 — with an explicit patent grant, no
copyleft, and a [`NOTICE`](./NOTICE) file covering attribution. Runtime
dependencies are MIT/Apache-2.0 only. Release/licensing details for
redistributors: [`docs/PUBLIC_RELEASE.md`](docs/PUBLIC_RELEASE.md).
