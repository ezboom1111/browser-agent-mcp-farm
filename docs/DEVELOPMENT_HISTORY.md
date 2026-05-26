# Development History

This document records why the project exists, what was built, and what future
agents should know before continuing.

## Origin

The project started while researching a Japan travel plan. The browser research
workflow raised a broader need: a reusable local browser farm that can collect
evidence rigorously across normal web pages and media-heavy platforms such as
YouTube, Instagram, and TikTok.

The code was first developed inside:

```text
C:\Users\이지범\Desktop\일본 여행 플랜!\.gstack\tools\browser-agent-mcp-farm
```

It was then split into this independent side-project repository:

```text
C:\Users\이지범\Desktop\browser-agent-mcp-farm
```

## Product Problem

The core question was whether an agent can honestly "watch" or analyze videos.
The answer is nuanced:

- It can inspect page HTML/text/screenshots/network logs.
- It can preserve image-like media and accessible caption files.
- It can sample browser-visible video frames with timestamps.
- It can parse legitimately captured WebVTT into structured transcript cues.
- It cannot honestly claim full audio/video understanding if no authorized
  transcript, audio transcription, or sampled visual evidence exists.
- It must not download or bypass raw platform video streams.

The design goal became an evidence workflow that separates:

- confirmed transcript/text evidence
- timestamped visual frame evidence
- platform metadata/capability evidence
- inferred observations
- explicitly unverified audio or missing transcript access

## Major Implementation Stages

### C-IMPL-01 to C-IMPL-15: Base Farm

Implemented the initial TypeScript package:

- package skeleton
- lease schemas
- lease manager
- Playwright BrowserContext pool
- capture pipeline
- MCP stdio server
- smoke CLI
- claim gate
- HTML evidence preview
- host adapter docs
- authenticated profile storage
- proxy/fingerprint policy
- Codex/Claude registration
- review-driven hardening

### C-IMPL-16: First-Class Media Artifacts

Added media awareness to the capture pipeline:

- image-like media bytes captured as `media/` artifacts
- VTT files captured when accessible
- video/audio/stream resources indexed in `structured/*.media-index.json`
- raw video/audio stream bytes intentionally skipped by default

### C-IMPL-17: Final Claim Gate

Strengthened `claim-gate`:

- smoke mode can pass zero-claim runs with a warning
- final mode fails zero-claim reports
- claims must cite registered artifact IDs or paths
- citations must match claim IDs
- artifact hashes are verified on disk

### C-IMPL-18: Visible Browser Reuse Policy

Documented and hardened the visible browser workflow so that headed sessions
are status-checked before reuse. Current independent repo keeps the farm package
side; visible browser orchestration lives in the wider gstack environment.

### C-IMPL-19: Browser Helper Tools

Added:

- wait
- wait for selector
- scroll
- capture after idle

These are exposed through MCP and used by smoke/media workflows.

### C-IMPL-20: MCP Version Sync

Kept package and MCP server version aligned during tool/schema changes.

### C-IMPL-21: Sequential Critique Runner

Implemented a queue runner for 10-round critical analysis:

- `critique-next`
- `critique-complete`
- validates configured output files
- advances exactly one task at a time
- prevents a multi-round critique from being collapsed into an untracked answer

### C-IMPL-22: Platform Capability Maps

Added `src/platform-adapters/`:

- YouTube
- Instagram
- TikTok
- generic fallback

The adapter contract records:

- platform
- canonical URL
- media ID/account hint where available
- confidence
- source docs
- warnings
- capability status for metadata, thumbnail, caption track list, caption body,
  visible frame sampling, and raw video bytes

The CLI command:

```powershell
node .\dist\cli.js platform-capabilities --url <url>
```

prints the map without fetching the URL.

Important official-source assumptions:

- YouTube metadata/thumbnails through Data API; caption body access is OAuth and
  rights-gated.
- Instagram IG Media is account/token/permission constrained.
- TikTok Display API covers authorized user videos; Research API can expose
  research fields such as voice-to-text only with approval.

### C-IMPL-23: Timestamped Frame Sampling

Added `farm_sample_frames` and supporting code:

- `src/frame-sampler.ts`
- `BrowserPool.sampleFrames`
- `FarmService.sampleFrames`
- `SampleFramesInputSchema`
- MCP tool registration

Behavior:

- default plan: `0s`, `10s`, `30s`, then every `60s`, capped at 120 frames
- explicit timestamps are normalized and deduped
- each frame writes screenshot and metadata
- metadata includes requested timestamp, seek result, active cues, and track
  info when the browser exposes it
- failed seek/screenshot becomes partial evidence, not a false success

### C-IMPL-24: MCP Re-Registration

After schema/tool changes, re-ran:

```powershell
node .\dist\cli.js register-all
```

In the original environment this updated Codex and Claude user MCP configs to
point at the then-current local package path. In this independent repo, run it
again if this folder should become the active MCP server path.

### C-IMPL-25: Real YouTube Evidence Run

Ran a real YouTube URL through the workflow:

```text
https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

The run produced:

- platform capability artifact
- browser page capture artifacts
- timestamped frame samples at `0s` and `10s`
- run assessment marking audio/transcript as unverified
- `claims.jsonl`
- `citations.jsonl`
- final report
- final claim gate pass

Key result:

- 68 artifacts
- 4 claims
- 4 citations
- final claim gate OK

### C-IMPL-26: First-Class Evidence Runner

The real URL run had initially been a one-off script. It was productized as:

- `src/evidence-runner.ts`
- `runEvidenceWorkflow(options)`
- CLI command:

```powershell
node .\dist\cli.js evidence-run --url <url> [--run-dir <path>] [--timestamps-sec 0,10]
```

The workflow now handles:

- platform capability artifact
- browser page capture
- optional timestamp frame sampling
- assessment artifact
- claims/citations ledgers
- final markdown report
- final claim gate

CLI sanity check:

```powershell
node .\dist\cli.js evidence-run --url https://example.com/ --no-frames --wait-ms 0 --timeout-ms 10000
```

Expected result:

- final claim gate OK
- 4 claims
- 4 citations

### C-IMPL-27: Structured WebVTT Transcripts

Added:

- `src/transcript-parser.ts`
- `parseWebVtt(input)`
- ArtifactWriter integration

When a captured media artifact has MIME `text/vtt`, the farm now:

- preserves the raw VTT under `media/`
- parses cues into structured JSON under `structured/*.transcripts/*.json`

The structured transcript includes:

- source URL
- MIME type
- resource type
- format
- cue count
- flattened text
- cue start/end timestamps

## Current Verification

Last full verification on version `0.2.6`:

```powershell
npm run verify
```

Passed:

- build
- 10 test files
- 42 tests
- local smoke
- public web smoke
- media smoke
- proxy smoke
- `npm audit --audit-level=moderate`

## Repository Split

The independent repo was created at:

```text
C:\Users\이지범\Desktop\browser-agent-mcp-farm
```

Process:

- copied source/test/package/docs from the travel workspace package
- excluded `node_modules`, `dist`, `coverage`, and `tmp`
- ran `npm ci`
- ran `npm run verify`
- initialized git
- committed the split-out package

Initial commit:

```text
6af672f Initial browser agent MCP farm
```

## What To Do Next

Recommended next implementation sequence:

1. Add MCP tool wrapper for `runEvidenceWorkflow`.
2. Add timestamp-aware claim schema:
   - `claim_type: visual|text|metadata|audio|inference`
   - `timestampSec`
   - `artifact_id`
   - `verification_level`
3. Extend `claim-gate`:
   - visual/video claims must cite screenshot frame artifacts
   - transcript claims must cite transcript cue artifacts
   - audio claims fail unless an audio transcription artifact exists
4. Add OCR over sampled frame screenshots.
5. Add dense sampling around transcript cue hits or OCR scene changes.
6. Add profile support to `evidence-run`:

```powershell
node .\dist\cli.js evidence-run --url <url> --profile youtube-login
```

7. Add headed debug mode:

```powershell
node .\dist\cli.js evidence-run --url <url> --headed
```

8. Add official API client modules behind explicit credentials.
9. Add GitHub Actions CI.
10. Decide package/distribution story.

## Known Limits

- Raw YouTube/Instagram/TikTok video download is intentionally unsupported.
- Caption body access is platform/credential/rights-gated.
- TikTok/Instagram browser visibility can be affected by login, region, app
  interstitials, and anti-automation.
- Frame sampling verifies only sampled timestamps, not unseen intervals.
- WebVTT parsing is intentionally minimal and deterministic; it is not a full
  subtitle styling/rendering engine.
- This repo does not include the original travel research reports.

## Useful Files

- `README.md`: user-facing commands and scope
- `AGENTS.md`: short context for coding agents
- `HOST-ADAPTERS.md`: host registration notes
- `src/evidence-runner.ts`: main workflow orchestration
- `src/browser-pool.ts`: Playwright/browser implementation
- `src/artifact-writer.ts`: artifact persistence
- `src/platform-adapters/`: platform capability maps
- `tests/evidence-runner.test.ts`: workflow regression test
