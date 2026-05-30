# Claude Handoff

This file is a concise handoff for Claude Code or any other coding agent.

## Source Of Truth

Work from this repository:

```text
C:\Users\<user>\Desktop\browser-agent-mcp-farm
```

Do not use the older Japan travel planning workspace as the source of truth.
The current repo is independent.

## Read First

Read these files before making changes:

1. `AGENTS.md`
2. `docs/DOCUMENTATION_MAP.md`
3. `docs/NEXT_TASKS.md`
4. `docs/PRODUCT_DEVELOPMENT_PLAN.md`
5. `docs/PORTAL_NAVIGATION_ARCHITECTURE.md`
6. `docs/PORTAL_NAVIGATION_IMPLEMENTATION_GUIDE.md`

Use `docs/DEVELOPMENT_HISTORY.md` as the full chronological log. It is long;
search for the relevant pass instead of reading every line.

## Current Product State

Browser-Agent MCP Farm is a local Playwright BrowserContext farm exposed through
MCP stdio, CLI, and a local HTTP queue. It supports evidence-first browser
research with:

- isolated browser leases
- page capture, screenshots, media indexing, transcript preservation, frame
  sampling, dense sampling, OCR, official API metadata, and obstruction
  classification
- final claim/citation gates with typed claim and evidence kinds
- source strategy and source coverage registry
- portal-native source navigation plans, explicit safe recipes, read-only
  calibration, promotion, readiness audits, and calibration-loop handoffs
- bounded destination extraction, destination triage, one-depth follow-ups,
  proposal-only depth-2 candidates, and explicit opt-in depth-2 execution
- profile/headed browser workflows for authenticated or anti-bot-sensitive
  pages

Current package version: `0.3.0`.

## Last Completed Work

The last code implementation pass added scene-change hit-cap tuning:

- `denseSampling.sceneChangeMaxHits` in evidence-run input schema
- `--dense-scene-max-hits <1-120>` CLI flag
- evidence-run now passes `sceneChangeMaxHits` to scene-change analysis when
  provided
- `maxDenseFrames` still bounds dense screenshots, while `sceneChangeMaxHits`
  bounds how many scene-change midpoints are expanded
- docs were updated in `README.md`, `AGENTS.md`, `docs/NEXT_TASKS.md`, and
  `docs/DEVELOPMENT_HISTORY.md`

Focused verification for that pass:

```powershell
npx vitest run tests/frame-sampler.test.ts tests/evidence-runner.test.ts tests/mcp-server.test.ts --testTimeout 60000
npm run build
```

Both passed.

The latest docs-only handoff pass added:

- `docs/DOCUMENTATION_MAP.md`
- `docs/CLAUDE_HANDOFF.md`
- `docs/QA_QC_PROCESS.md`
- `docs/RELEASE_NOTES.md`

It also updated `AGENTS.md`, `README.md`, `docs/NEXT_TASKS.md`, and
`docs/DEVELOPMENT_HISTORY.md` to point future Codex/Claude sessions to the new
documentation entry points.

## Important Verification Caveat

The final full verification after the scene-change hit-cap pass was interrupted
by the user:

```powershell
npm run verify
```

Do not claim the current worktree is fully verified until `npm run verify` is
rerun successfully.

The previous completed full verification passed after the OCR CTA/policy
text-profile pass:

- build passed
- 34 test files / 351 tests passed
- local smoke passed
- public web smoke passed
- media smoke passed
- proxy smoke passed
- `npm audit` found 0 vulnerabilities

## Current Next Action

When development resumes:

1. Check for any leftover `npm`, `node`, `vitest`, or Playwright processes if a
   previous run may have been interrupted.
2. Run `npm run verify`.
3. If it passes, update `docs/DEVELOPMENT_HISTORY.md`,
   `docs/NEXT_TASKS.md`, and this file with the final verification result.
4. Continue the next item in `docs/NEXT_TASKS.md`.

The next documented work areas are:

- Official API real-account validation, which requires explicit provider
  credentials.
- Source strategy and navigation real-site tuning for richer community/forum,
  TikTok, Google Search/Maps, Agoda, Trip.com, Booking.com, Expedia, and other
  real platform surfaces.
- Broader live OCR and scene-change calibration against real screenshots/media.

## Development Rules

- Do not revert unrelated dirty worktree changes.
- Keep platform-specific logic outside `BrowserPool`.
- Claims must cite registered artifacts.
- Final reports must fail on zero claims or uncited claims.
- Official API clients must use env var credential references and must not write
  raw token values into artifacts.
- Do not bypass or download raw platform video streams.
- For docs-only changes, run at least `git diff --check`.
- For code changes, run focused tests first, then `npm run verify`.

## Claude Prompt

Give Claude this prompt:

```text
You are working in C:\Users\<user>\Desktop\browser-agent-mcp-farm.
Read AGENTS.md, docs/DOCUMENTATION_MAP.md, docs/CLAUDE_HANDOFF.md,
docs/NEXT_TASKS.md, and docs/DEVELOPMENT_HISTORY.md. The latest code change is
scene-change hit-cap tuning. Focused tests and build passed, but the full
npm run verify was interrupted. Do not claim full verification until you rerun
npm run verify successfully. Do not revert unrelated worktree changes. Continue
from docs/NEXT_TASKS.md after verification.
```
