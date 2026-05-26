# Agent Context

This repository is a side project split out from a Japan travel planning
workspace. Treat this folder as the source of truth for the Browser-Agent MCP
Farm code. Do not assume the original travel workspace is present.

## Project Summary

Browser-Agent MCP Farm is a local Playwright BrowserContext farm exposed through
an MCP stdio server and a CLI. It is built for evidence-first browser research:
isolated leases, page capture, media artifact capture, claim/citation gates,
platform capability mapping, and bounded timestamped frame sampling.

Current package version: `0.2.6`.

## Core Commands

```powershell
npm ci
npm run build
npm test
npm run verify
node .\dist\cli.js evidence-run --url https://example.com/ --no-frames --wait-ms 0 --timeout-ms 10000
node .\dist\cli.js register-all
```

`npm run verify` is the main local quality gate. It runs build, unit tests,
local smoke, public web smoke, media smoke, proxy smoke, and `npm audit`.

## Git State

This repository was initialized from:

```text
C:\Users\이지범\Desktop\일본 여행 플랜!\.gstack\tools\browser-agent-mcp-farm
```

Current independent repo path:

```text
C:\Users\이지범\Desktop\browser-agent-mcp-farm
```

The initial split-out commit is:

```text
6af672f Initial browser agent MCP farm
```

Note: the first commit author was auto-detected as `unknown <ezboom@syuin.ac.kr>`.
If author identity matters, set local git config and amend:

```powershell
git config user.name "이지범"
git config user.email "desired@example.com"
git commit --amend --reset-author --no-edit
```

## Engineering Principles

- Do not download or bypass raw platform video streams.
- Keep platform-specific logic outside `BrowserPool`.
- Claims must cite registered artifacts.
- Final reports must fail when there are zero claims or uncited claims.
- Distinguish confirmed transcript evidence, visual frame evidence, inferred
  observations, and unverified audio.
- Use browser-visible frame sampling for visual evidence.
- Preserve raw accessible artifacts and add structured derivatives when lawful
  and deterministic, such as WebVTT parsing.
- Keep all generated evidence run output out of git unless a small fixture is
  explicitly needed for tests.

## Main Modules

- `src/browser-pool.ts`: Playwright context/page lifecycle, capture, actions,
  media indexing, frame sampling entry point.
- `src/artifact-writer.ts`: artifact bundles, ledgers, media files, transcript
  derivatives.
- `src/evidence-runner.ts`: first-class workflow for platform capability,
  capture, frame sampling, assessment, claims/citations, and final claim gate.
- `src/platform-adapters/`: YouTube, Instagram, TikTok, and generic capability
  maps.
- `src/frame-sampler.ts`: timestamp planning and frame metadata types.
- `src/transcript-parser.ts`: WebVTT cue parser.
- `src/claim-gate.ts`: artifact/claim/citation validation.
- `src/mcp-server.ts`: MCP tool registration.
- `src/cli.ts`: smoke tests, registration, profile login, evidence workflow,
  claim gate, critique runner.

## Current Status

Implemented:

- isolated BrowserContext leases
- read-only capture
- guarded read-write browser actions
- profile persistence and profile locks
- proxy/fingerprint options
- image-like media capture and stream indexing
- WebVTT raw preservation and structured transcript JSON
- wait/selector/scroll/capture-after-idle helpers
- final-mode claim gate
- HTML evidence preview
- Codex/Claude MCP registration
- platform capability maps for YouTube/Instagram/TikTok
- timestamped browser-visible frame sampling
- first-class `evidence-run` workflow
- unit and smoke tests

Not fully solved:

- arbitrary third-party transcript extraction without official credentials
- arbitrary audio transcription from platform video
- Instagram/TikTok anti-automation/login/app interstitial robustness
- production multi-agent scheduling
- packaged npm distribution
- remote shared server mode

## Next Work Candidates

1. Add an MCP tool for `evidence-run`, not only CLI/service-level workflow.
2. Add per-run cache for platform capability maps and metadata lookups.
3. Add a typed claim schema that supports timestamp-specific visual claims.
4. Extend `claim-gate` to require timestamp artifacts for visual/video claims.
5. Add official API clients behind explicit credentials:
   - YouTube Data API metadata and owned caption access
   - Instagram Graph IG Media fields
   - TikTok Display/Research API fields
6. Add OCR over sampled frames for visible overlay text.
7. Add dense sampling windows around transcript hits.
8. Add `evidence-run --profile <name>` to reuse logged-in browser profiles.
9. Add `evidence-run --headed` for visible debugging.
10. Add GitHub Actions CI for `npm ci && npm run verify`.

## Important Caveat

This project can honestly preserve and analyze browser-visible evidence, public
HTML/text, accessible media artifacts, WebVTT captions, and sampled frames. It
must not claim full video/audio understanding unless transcript/audio evidence
is actually present and cited.
