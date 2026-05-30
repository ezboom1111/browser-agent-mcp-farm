# QA/QC Process

This document defines how Browser-Agent MCP Farm work should be verified before
it is described as complete.

## Main Local Gate

Run this before claiming a code change is fully verified:

```powershell
npm run verify
```

The gate runs:

- TypeScript build
- unit and workflow tests
- local smoke capture
- public web smoke capture
- media smoke capture
- proxy smoke capture
- `npm audit --audit-level=moderate`

## Focused Tests

Use focused tests while developing, then run the full gate.

Examples:

```powershell
npx vitest run tests/source-registry.test.ts --testTimeout 60000
npx vitest run tests/source-navigation-recipes.test.ts tests/source-navigation-recipe-catalog.test.ts --testTimeout 60000
npx vitest run tests/evidence-runner.test.ts tests/mcp-server.test.ts --testTimeout 60000
npx vitest run tests/ocr-text-profile.test.ts tests/ocr.test.ts --testTimeout 60000
npx vitest run tests/frame-sampler.test.ts tests/evidence-runner.test.ts --testTimeout 60000
```

## Optional Live Gates

These are intentionally opt-in because they need external dependencies,
credentials, network access, or language data.

OCR:

```powershell
npm install tesseract.js
$env:FARM_OCR_INTEGRATION="1"
npm run test:ocr-integration
```

Non-English OCR:

```powershell
$env:FARM_OCR_INTEGRATION="1"
$env:FARM_OCR_NON_ENGLISH="1"
npm run test:ocr-integration
```

Official APIs:

```powershell
$env:FARM_OFFICIAL_API_INTEGRATION="1"
npm run test:official-api
```

Use readiness checks before live official API calls:

```powershell
node .\dist\cli.js official-api-readiness --url <provider-url>
```

## Real-Site Calibration Loop

Use this loop for Naver, Google, YouTube, TikTok, Instagram, maps, travel,
commerce, review, community, blog/cafe, and other portal/platform surfaces:

1. Generate or choose calibration targets.
2. Run read-only calibration with repeated observations.
3. Build a recipe catalog from repeated calibration artifacts.
4. Promote only stable, narrow, non-mutating selectors.
5. Review promotion readiness.
6. Run source coverage readiness.
7. Feed not-ready slots back into target generation.
8. Run bounded `evidence-run` with explicit promoted action files.
9. Inspect final reports, artifacts, claim gate, destination triage, and retry
   advice.

Useful commands:

```powershell
node .\dist\cli.js source-navigation-calibration-targets --category <category> --locale <locale> --query "<query>"
node .\dist\cli.js source-navigation-calibrate-batch --targets-file <targets.tsv> --run-root <run-root>
node .\dist\cli.js source-navigation-catalog --calibration-batch-manifest <manifest.json>
node .\dist\cli.js source-navigation-promote-batch --calibration-batch-manifest <manifest.json> --promotion-dir <dir>
node .\dist\cli.js source-navigation-promotion-review --promotion-dir <dir>
node .\dist\cli.js source-coverage-readiness --category <category> --locale <locale> --promotion-dir <dir>
node .\dist\cli.js source-coverage-calibrate --category <category> --locale <locale> --run-root <run-root>
```

## Browser/Profile QA

Use Chrome or a persistent profile when login state, Google/Naver auth, or
anti-bot sensitivity matters:

```powershell
node .\dist\cli.js auth-login --profile google-search-chrome --url https://accounts.google.com/ --persistent-profile --chrome
node .\dist\cli.js auth-cdp-import --profile google-search-cdp --cdp-url http://127.0.0.1:9222
```

Then run evidence collection with:

```powershell
node .\dist\cli.js evidence-run --url <url> --profile <profile> --persistent-profile --chrome --headed
```

## What Counts As Verified

A feature is verified only when the evidence matches the scope:

- schema/input changes: schema tests or MCP/HTTP/CLI acceptance tests
- browser behavior: Playwright-backed workflow tests or smoke runs
- claim gate changes: claim-gate tests plus final evidence-run behavior
- source navigation changes: recipe tests, executor tests, calibration or
  promotion tests, and at least one evidence-run path when behavior reaches the
  workflow
- OCR changes: deterministic unit tests; live OCR harness only when OCR engine
  behavior is claimed
- official API changes: unit readiness/error tests; live harness only when real
  provider behavior is claimed
- docs-only changes: `git diff --check`

## Current QA Caveat

The scene-change hit-cap pass has focused verification and build coverage, but
the final full gate was interrupted by the user:

```powershell
npm run verify
```

Before claiming the whole current worktree is fully verified, rerun
`npm run verify` successfully and record the result in:

- `docs/DEVELOPMENT_HISTORY.md`
- `docs/NEXT_TASKS.md`
- `docs/CLAUDE_HANDOFF.md`

