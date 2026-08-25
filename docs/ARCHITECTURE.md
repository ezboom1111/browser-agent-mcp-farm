# Architecture

One page on how Browser-Agent MCP Farm is layered and the rules that keep it
maintainable while two agents (Codex and Claude) co-edit it.

## Layers (top to bottom)

```text
Transports        mcp-server.ts · cli.ts · http-server.ts        (thin; parse + route only)
      |
Facade            farm-service.ts                                (one entry point per capability)
      |
Primitives        lease-manager.ts · browser-pool.ts             (generic, platform-agnostic)
      |           + abort.ts · artifact-writer.ts · profile-store.ts · profile-lock.ts · frame-sampler.ts
      |
Intelligence      source-strategy · source-registry · acquisition-* · search-followups
(platform logic)  destination-* · platform-adapters/ · ocr* · official-api · browser-obstructions
      |
Orchestration     evidence-runner.ts                             (composes the stages of one run)
      |
Integrity         claim-gate.ts                                  (final claims must cite artifacts)
```

A run flows: transport → FarmService → (LeaseManager + BrowserPool) for capture
→ intelligence modules derive typed artifacts → evidence-runner sequences the
stages → claim gate validates → final report.

## The one hard rule (build-enforced)

**The primitive layer must not import the platform/intelligence/orchestration
layer.** `browser-pool.ts` and `lease-manager.ts` expose only generic browser
operations (open, capture, read client state, click/fill/press, sample frames);
all site/platform knowledge lives above them. This keeps the core small, safe,
and reusable.

This is not a convention — it is enforced by `scripts/check-boundaries.mjs`
(`npm run boundaries`), which fails the build if a core file imports
`source-*`, `destination-*`, `platform-adapters`, `evidence-runner`, or other
upper-layer modules. Add forbidden targets to that script's `FORBIDDEN` list if
the core grows new neighbors.

## The evidence contract

- Every artifact is written with a SHA-256 hash; the claim gate re-hashes on disk
  and fails on missing/changed bytes.
- Final claims must cite a registered, typed artifact; the report fails on zero
  or uncited claims. Visual claims require a timestamped frame screenshot;
  transcript/audio claims require the matching artifact.
- Destination evidence claims must cite the full provenance chain
  (search-result evidence → destination candidate → child follow-up → run).

## Safety boundaries (also enforced in code)

- No raw platform video/audio stream download.
- No login / CAPTCHA / paywall / age-gate bypass.
- No payment / booking / account-changing automation (`assertNotPaymentAction`).
- One active lease per profile, enforced **across processes** by an on-disk lock
  (`profile-lock.ts`), so parallel agents never clobber a shared cookie jar.

## Quality gate

`npm run verify` = build → typecheck (src **and** tests) → boundary guard →
browser-presence guard → tests + coverage (ratcheting threshold) → 4 smoke
captures → `npm audit` → STATUS generation. CI (`.github/workflows/verify.yml`)
runs the same command. The generated `STATUS.md` is the single source of truth
for build/test/coverage numbers — do not restate them in narrative docs.

## Where to change things

| To change... | Edit | Guarded by |
| --- | --- | --- |
| a browser primitive | `browser-pool.ts` (no platform logic!) | boundary guard, browser-pool tests |
| a tool's shape | `schemas.ts` + `farm-service.ts` + `mcp-server.ts`/`cli.ts` | mcp-server tests, typecheck |
| evidence integrity | `claim-gate.ts` | claim-gate tests |
| a run's stages | `evidence-runner.ts` | evidence-runner tests |
| platform/site behavior | `source-*` / `acquisition-*` / `destination-*` / `platform-adapters/` | strategy, routing, and triage tests |
| how agents discover the farm | `skills/browser-agent-mcp-farm/SKILL.md`, `registration.ts` | registration tests |
