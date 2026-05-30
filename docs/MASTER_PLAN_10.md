# Master Development Plan — Path to 10/10

> Produced from a multi-agent coverage diagnosis + completeness critique + synthesis
> (8 domains, evidence-grounded against the committed tree). It integrates the
> **claim-gate-independence moonshot** as the flagship trust workstream.
>
> **Honest current score: 4.6 / 10.** (Lower than a feature-only read because the
> diagnosis surfaced two unowned, near-zero cross-cutting domains: evidence-quality
> evaluation and security/legal/data-lifecycle.) 10/10 is defined as a *measured*
> SCORECARD, not a vibe — see "How 10/10 is measured".

## North Star

A trustworthy, broadly-capable, dual-agent (Codex + Claude) evidence product whose
flagship is a **standalone, model-agnostic anti-hallucination guardrail**: any agent
registers the bytes it actually saw, authors its OWN substantive claims, and each
claim is **cite-or-fail grounded in those hash-verified bytes** — not pipeline
boilerplate. The farm captures every lawful, deterministic layer the browser already
rendered (text/HTML/screenshot, structured JSON-LD/OpenGraph/microdata/tables, typed
semi-structured values, sampled video frames + OCR + WebVTT cues, official-API
metadata, obstruction state) as SHA-256-verified artifacts, with extraction
*correctness* measured against a labeled golden corpus and an honestly-labeled,
self-verifying coverage matrix that **demotes decay rather than lying**. It is honest
about its limits (no bot-bypass / payments / raw-stream / full-video-understanding;
publisher markup is a *site claim*, not ground truth; the gate proves byte-stability
+ grounding, NOT live-page faithfulness), bounds secret-at-rest exposure and data
lifecycle, and ships an offline-verifiable signed Evidence Bundle (`.evb`) one
cooperating second agent can independently verify.

## Domain Scorecard (current → target)

| Domain | Now | Target |
| --- | --- | --- |
| **Trust & integrity — claim-gate moonshot (FLAGSHIP)** | 3.5 | 10 |
| Modality & data types (structured/semi/unstructured; text/image/video/audio) | 5.5 | 10 |
| Platform & source coverage (locales) | 5.5 | 10 |
| Dual-agent parity, MCP ergonomics & routing | 4 | 10 |
| Safety & parallel-execution correctness | 5 | 10 |
| Engineering quality, refactors, packaging, observability | 5 | 10 |
| **Evidence-quality evaluation & measurement** (newly surfaced) | 1 | 10 |
| **Security-at-rest, legal/ToS posture & data lifecycle** (newly surfaced) | 2.5 | 10 |

## How 10/10 is measured (falsifiable exit gates)

A regenerated `SCORECARD.json/md` (rebuilt by the verify/release path like `STATUS.md`)
defines per-domain pass/fail gates; **10/10 == all gates green**:

- **Trust/grounding**: an adversarial corpus makes the gate REJECT (a) a tampered+rehashed
  artifact, (b) a swapped hash, (c) a forged citation graph, (d) a claim whose asserted
  text/value is absent from its cited artifact, (e) a truncated transcript, (f) a
  signature/Merkle mismatch — and ACCEPT a genuinely grounded claim. The gate is provably
  non-tautological (`claim.evidence === claim.artifact_id` is no longer the only check).
- **Trust/authoring**: an external agent flow `register_evidence → farm_read_artifact →
  add_claim` passes final mode ONLY with ≥1 agent-authored *grounded content* claim; the
  manual/headed path also produces a verdict.
- **Trust/portability**: `evidence-gate export` makes a signed, Merkle-rooted `.evb` that
  `evidence-gate verify` re-checks **fully offline** (leaf hashes, Merkle root, ed25519,
  grounding anchors); a `THREAT_MODEL.md` states what it does/doesn't prove (byte-stability +
  grounding, NOT live-page faithfulness). Success = "one cooperating second agent can verify",
  not "the world converges".
- **Data types**: a deterministic structured-extractor emits schema-validated JSON-LD /
  OpenGraph / microdata-RDFa / canonical-hreflang / headings / HTML-table artifacts
  re-derivable byte-for-byte from the registered HTML; `audio_transcription` phantom resolved;
  publisher markup surfaced as a *site claim* cross-checked vs DOM/OCR with disagreement flagged.
- **Evidence quality**: a labeled golden corpus (product/place/review/news × ko/en/ja, incl.
  JSON-LD-vs-DOM conflict fixtures) scores extractors by precision/recall/exact-match against
  named thresholds; CI fails on regression.
- **Platform coverage**: one `coverage-report` labels every category×locale slot as
  autonomous-ready / api-backed / headed-only / blocked / unmaintained, with a recipe-canary
  `lastVerifiedAt` freshness window; "ready" REQUIRES a passing canary (the matrix cannot rot
  silently); an explicit maintenance-budget cap names what is actively canaried vs honestly
  "best-effort unmaintained".
- **Dual-agent parity**: a verify smoke asserts both agents' guidance render from ONE shared
  template, neither leads with the colliding "Evidence-first browser research" phrase, every
  tool has a description, every field across all 22 schemas has `.describe()`, and
  `farm_capabilities` returns server identity/non-goals/optional-deps.
- **Safety**: a REAL two-OS-process win32 test proves exactly one writer wins a shared profile
  lock (loser gets typed `profile_in_use`); a heartbeating lease past TTL is NOT reaped while a
  non-heartbeated stale lock IS; serve-http returns typed `EADDRINUSE`; concurrent ledger appends
  use a per-run write lock; proxy creds + profile paths redacted everywhere (lint-scan green); a
  global context cap yields typed `capacity_exhausted`.
- **Security/legal/lifecycle**: `storage-state.json`/`userDataDir` permission-hardened (0600 /
  DPAPI) and never leaked; documented secret-storage+rotation policy for proxy + official-API
  keys; per-source `legal_basis` field; a retention/purge/max-age lifecycle command; a
  secret-pattern lint over artifacts/reports/ledgers/logs.
- **Engineering/SLO**: PRODUCT-ONLY line AND branch coverage ≥ 80% (research quarantined +
  excluded) enforced by an auto-ratchet that only raises the floor; lint+format gate; structured
  NDJSON logger + per-run `metrics.json` with p95 latency + error-budget targets; full publish
  metadata + `prepublishOnly` + CHANGELOG; a Windows+Linux × node 22/24 CI matrix; an append-only
  tamper-evident gate-verdict decision log.

## Sequenced Roadmap (8 phases, each behind a green `npm run verify`)

**P0 (Phase 0) — Stop the bleeding** *(deps: none)*
Fix what is actively wrong for a real user, before feature work touches that code.
- BLOCKER: rewrite `SKILL.md` frontmatter so it does NOT open with "Evidence-first browser
  research" (collides with `deep-browser-research`/gstack); lead with a unique disambiguator,
  add a tie-breaker + negative trigger, and honestly scope the integrity line.
- BLOCKER (safety): `refreshProfileLock()` on `farm_heartbeat` so a heartbeated lease past the
  1h TTL is never reaped+stolen; replace blind wall-clock staleness with lease-coupled freshness.
- `EADDRINUSE` typed error on serve-http; redact proxy creds + absolute profile paths from
  acquire/list results; permission-harden `storage-state.json`/`userDataDir`; secret-pattern lint.
- Add the Windows+Linux × node 22/24 CI matrix NOW (win32 exercises the O_EXCL lock + path code).
- *QA*: verify green Win+Linux; tests for heartbeat-keeps-lock, EADDRINUSE, zero secret bytes in results.

**P1 (Phase 1) — FLAGSHIP slice 1: a non-tautological gate an agent can drive** *(deps: P0)*
- **M1**: extend the claim schema with a typed `anchor` discriminated by `evidence_kind`
  (`text_span`{quote,normalizedTokens} / `ocr_bbox` / `transcript_cue` / `frame`) + a `grounded`
  verification level + a claim taxonomy (`quote`|`derived`|`aggregated`) so paraphrase/aggregation
  claims are gradeable, not naively substring-rejected. Behind a flag so the 368 tests stay green.
- **M3** (parallel): `service.readArtifact` + `farm_read_artifact(runDir, artifactId|path)` returning
  bytes/text + recorded-vs-recomputed sha256 + `tampered` flag (read-only, no Playwright).
- **M2**: in final mode, after hash-verifying an artifact, OPEN its bytes and verify the claim's
  anchor (token/bbox/cue/timestamp). Adversarial fixtures: tampered-rehashed, claim-text-absent,
  forged-graph, truncated-transcript.
- per-runDir write lock so two agents' `appendClaims`/`add_claim` can't interleave-corrupt the jsonl.
- *QA*: verify green; corpus proves reject/accept; read_artifact re-hashes + flags tamper; concurrent
  two-writer ledger test clean.

**P2 (Phase 2) — FLAGSHIP slice 2: gate the agent's REAL answer + Codex parity + ergonomics** *(deps: P1)*
- **M4**: agent claim-authoring path (`register_evidence` → artifact_id; `add_claim` through the write
  lock; authored claims must pass M2 grounding).
- **M5**: replace the 7 boilerplate pipeline claims with authored grounded content claims; require ≥1
  for a final pass; add a "finalize+gate" step to the manual/headed path; add a "what the gate
  did/didn't verify" report footer.
- ONE shared `src/agent-guidance.ts` template → `renderClaudeSkillMarkdown()` + `renderCodexGuidanceBlock()`;
  `registerCodexSkill()` in `registerAll`; full `.describe()` on all 22 schemas with cross-tool provenance
  hints; `farm_capabilities` + `farm_list_runs`; a parity verify-smoke.
- *QA*: verify green; external-agent E2E `register_evidence→read_artifact→add_claim→gate` passes only with
  a grounded content claim; parity smoke green.

**P3 (Phase 3) — Lawful structured/semi-structured extraction WITH a correctness benchmark** *(deps: P2)*
- `src/structured-extractor.ts`: deterministic JSON-LD / OpenGraph / microdata-RDFa / canonical-hreflang /
  headings / HTML-table parse over the already-registered HTML (no network, byte-reproducible) + an image
  inventory. New structured EvidenceKinds + gate rules (price/rating/metadata claims must cite a
  structured-derivative; surface structured-vs-DOM/OCR disagreement; markup is a *site claim*).
- Evidence-quality **golden corpus** + precision/recall/exact-match thresholds wired into CI.
- OCR text-profile booleans → EXTRACTED typed values ({amount,currency},{value,scale},{open,close},…) with
  bbox/timestamp provenance; prefer DOM, cross-check OCR.
- Resolve the `audio_transcription` phantom (retire OR lawful provider-transcript path).
- Capture-provenance attestation (response digests / HAR) + `THREAT_MODEL.md` caveat (gate proves
  byte-stability + grounding, NOT live-page faithfulness).
- *QA*: verify green; extractor re-derives identical artifacts twice; benchmark meets thresholds; conflict
  fixture surfaces disagreement.

**P4 (Phase 4) — Self-verifying coverage matrix inside an HONEST, budget-capped envelope** *(deps: P3)*
- per-recipe `lastVerifiedAt` + a `recipe-canary` CLI that re-runs a maintained recipe headless, re-checks
  selector/obstruction health vs a stored golden assertion, and auto-demotes a decayed "ready" slot.
- one `coverage-report` surface (autonomous-ready / api-backed / headed-only / blocked / unmaintained) with a
  freshness window; "ready" REQUIRES a passing canary.
- explicit **maintenance-budget cap** (named actively-canaried set; everything else honestly "unmaintained");
  official-API connectors ONLY where free/sustainable (Google PSE/Places quota-limited + behind a paid flag,
  off by default); rate-cap the canary so it never burns paid quota.
- `recover-slot --platform X` (headed calibration loop, no bypass/payment); per-source `legal_basis` field +
  documented robots/ToS/redistribution stance; latency/error budgets feeding auto-demotion.
- *QA*: verify green; a broken-selector fixture flips ready→needs_recalibration; canary respects the quota cap.

**P5 (Phase 5) — Portable, offline-verifiable signed Evidence Bundle (.evb) + standalone gate package** *(deps: P4)*
- **M6**: extract claim-gate + claim/anchor/evidence-kind schemas + ledger reader/writer into
  `packages/evidence-gate` (own exports, versioned `LEDGER_SCHEMA_VERSION`, a `evidence-gate` bin, a tiny MCP
  server). The gate package OWNS the schema types; the farm depends on it. Publish `THREAT_MODEL.md`.
- **M7**: `evidence-gate export <runDir> → bundle.evb` (artifacts + ledgers + Merkle tree over artifact
  sha256 + manifest + detached ed25519 signature) and `evidence-gate verify bundle.evb` re-checking
  everything **fully offline**.
- **M8**: agent-to-agent verifiable exchange (protocol + `verify_bundle` MCP tool + a worked Codex↔Claude
  example where the verifier trusts hashes, not the producer or a browser).
- append-only tamper-evident gate-verdict DECISION LOG; evidence-gate package coverage ≥ 90%.
- *QA*: verify green; `evidence-gate verify` fails a tampered leaf/swapped hash/forged graph/sig mismatch and
  the dual-agent example verifies B's bundle without a browser.

**P6 (Phase 6) — Structural hardening: refactors, quarantine, lifecycle, ratchet to 80% product-only** *(deps: P5)*
- lint+format gate (Biome) + auto-ratchet coverage script (raises the floor on every green run, never lowers);
  consolidate the 5 `uniqueStrings` / 2 `safeUrl` / 3 `stripBom` copies into `src/util/`.
- structured NDJSON logger + per-run `metrics.json` feeding the P4 SLO comparison.
- artifact retention/lifecycle (`purge-run`, max-age sweep, per-run delete) + PII-minimization note + a single
  secret-storage+rotation policy.
- quarantine the ~7,600-line calibration cluster into `src/research/` behind a 2nd boundary rule + a `research`
  parent CLI — but FIRST write direct tests for the product-only surfaces (cli.ts is 0%, farm-service,
  browser-pool) so excluding research doesn't drop product-only coverage below the floor.
- split `evidence-runner.ts` (~3017 lines) along stage seams; drive product-only line AND branch coverage ≥ 80%.
- *QA*: verify green with lint+ratchet; product-only coverage ≥ 80/80; 2nd boundary rule blocks product→research.

**P7 (Phase 7) — Publish, scorecard, and prove the whole thing** *(deps: P6)*
- complete publish metadata + `prepublishOnly` (full verify) + CHANGELOG + release tags; test
  `npx browser-agent-mcp-farm` from the packed tarball; regenerate STATUS in the release path.
- build `SCORECARD.json/md` (every per-domain falsifiable gate above) regenerated like STATUS so progress to
  10/10 is a measured number.
- parallel-safety conformance suite (two processes + same profile, same port, N agents + global context cap →
  `capacity_exhausted` backpressure, crash recovery via background reaper, redaction) + a SAFETY section for
  both agents; opt-in background reaper.
- nightly quota-capped canary + ocr/official-api integration; output accessibility (alt/OCR-as-text on
  screenshots, human-readable `.evb`/coverage-report).
- *QA*: verify green; tarball runs; SCORECARD all-green; conformance suite passes incl. real two-process win32.

## Top Risks (and mitigations baked into the sequencing)

- **Grounding is harder than substring** — paraphrase/aggregation claims aren't literal substrings. → P1
  claim taxonomy (quote/derived/aggregated) + structured-field equality (P3), not one substring rule.
- **Capture fabrication hole** — captures use wall-clock + random UUID, are non-reproducible; the gate proves a
  *stored* artifact is byte-stable, not that bytes are real, and an `.evb` signature only proves who *sealed*
  them. → capture-provenance attestation (HAR/response digests) + `THREAT_MODEL.md` caveat (P3/P5); never
  over-claim "this answer is true".
- **Solo/$0 maintenance & quota overreach** — a canary sweep over ~50 sources + paid Google quotas becomes a
  perpetually-red, quota-burning liability. → explicit maintenance-budget cap, honest "unmaintained" state,
  quota rate-cap, free-tier-only default connectors (P4).
- **Structured-data over-trust** — JSON-LD/OG is marketing-controlled and can disagree with reality. → treat as
  a *site claim* cross-checked vs DOM/OCR with surfaced disagreement, gated behind the golden-corpus benchmark (P3).
- **Coverage-ratchet vs quarantine trap** — the frozen 7,600-line cluster supplies most current coverage;
  excluding it drops product-only coverage. → write product-surface tests BEFORE excluding research (P6 ordering).
- **Secret-at-rest exposure** — `storage-state.json`/`userDataDir` hold live session cookies as plaintext; the
  API expansion multiplies env keys. → permission-harden + redact + documented policy in P0, BEFORE the expansion.
- **Serial flagship chain** — pushes the headline `.evb`/signing to the end where it's most likely cut. → P1-P2
  front-load a thin non-tautological-gate vertical; defer signing/packaging to P5.

## Cross-cutting concerns the diagnosis surfaced (previously unowned)

- **Evidence-quality evaluation (1/10)**: no benchmark measures whether extracted values are *correct* — the
  single biggest missing theme. Owned by P3's golden corpus.
- **Security-at-rest / legal / PII / lifecycle (2.5/10)**: plaintext session creds, no robots/ToS gate, no
  per-source legal basis, no retention/purge/PII story. Owned by P0 (secrets) + P4 (legal_basis) + P6 (lifecycle).
- **How "10/10" is measured**: a single regenerated SCORECARD (P7) makes perfection falsifiable, not rhetorical.
- **Latency/error budgets, gate-verdict decision log, output accessibility**: P4/P6/P7.

## Quick wins (high impact, low effort — pull early)

- Rewrite `SKILL.md` to break the trigger collision (docs-only, stops mis-routing) — **P0**.
- `EADDRINUSE` typed error on serve-http — **P0**.
- `redactProxy()`/`redactLease()` so secrets stop leaking into tool results — **P0**.
- Full field `.describe()` on the 17 schemas that lack it — **P2**.
- Auto-ratchet coverage script + raise the static floor to the measured baseline — **P6 (can pull early)**.
- Resolve the `audio_transcription` phantom — **P3**.

## Flagship first slice (start here)

**M1 + M3 — typed claim-anchor schema + `farm_read_artifact`** (the gate's first non-tautological building
block and the precondition for agent-authored cite-or-fail claims):

1. Extend `src/schemas.ts` with an optional `anchor` discriminated union keyed by `evidence_kind`, a `grounded`
   verification level, and a claim-taxonomy field (quote|derived|aggregated) — behind a flag so all 368 tests stay green.
2. `service.readArtifact(runDir, artifactId|path, {maxBytes?, asText?})` in `src/farm-service.ts` that re-hashes on
   read and returns `{content, recordedSha256, recomputedSha256, tampered, evidence_kind, source_url}` (read-only, no Playwright).
3. Register `farm_read_artifact` in `src/mcp-server.ts` with full `.describe()`; add the CLI subcommand.
4. Unit tests: anchor round-trips per evidence_kind; taxonomy validates; `farm_read_artifact` returns asText vs base64,
   recomputes the hash, and flags a post-registration byte mutation as `tampered`. Do NOT change `runClaimGate` yet (that is M2).
5. `npm run verify` green on Windows AND Linux (existing runs unaffected because `anchor` is optional outside grounding mode).

*QA gate*: verify green Win+Linux; new tests prove the anchor union validates per evidence_kind, the taxonomy is enforced,
and `farm_read_artifact` re-hashes + flags tamper — zero regressions to the existing 368 tests.

---

This plan is intentionally vast. It is **sequenced so the most-wrong, user-visible things (P0) and the flagship's
thin non-tautological vertical (P1-P2) land first**, structured-data depth + a correctness benchmark next (P3),
honest self-verifying coverage (P4), the signed portable bundle (P5), structural hardening (P6), and the published,
scorecard-proven product last (P7). Progress is tracked as a measured SCORECARD, so "10/10" stays falsifiable.
