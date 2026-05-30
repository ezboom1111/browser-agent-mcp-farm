# Documentation Map

This repository is the source of truth for Browser-Agent MCP Farm development.
Use this file as the first stop when handing the project to Codex, Claude, or a
human reviewer.

Repository root:

```text
C:\Users\<user>\Desktop\browser-agent-mcp-farm
```

## Fast Resume Order

For a new Codex or Claude session, read these files in this order:

1. `AGENTS.md`
   - Session recovery context, current package version, core commands, module
     map, implementation status, constraints, and known active caveats.
2. `docs/CLAUDE_HANDOFF.md`
   - Short handoff for Claude/Codex with current state, last completed work,
     paused verification, and exact next action.
3. `docs/NEXT_TASKS.md`
   - Detailed next-work queue, current verification baseline, and remaining
     product gaps.
4. `docs/DEVELOPMENT_HISTORY.md`
   - Full chronological development log. This is long; search within it rather
     than reading end to end unless reconstructing history.
5. `docs/PRODUCT_DEVELOPMENT_PLAN.md`
   - Product-level plan for portal-native, evidence-first browser research.

## Product And Planning Docs

| File | Purpose | How to use |
| --- | --- | --- |
| `docs/PRODUCT_DEVELOPMENT_PLAN.md` | Top-level product plan and scope. | Read when deciding whether a feature belongs in the product, especially source coverage, portal-native navigation, Naver/Google/SNS/platform support, and evidence-first research behavior. |
| `docs/INFORMATION_SOURCE_TAXONOMY.md` | Information-source category registry: search, social, community, content, news, review, map/local, marketplace, DB, messenger/private, recommendation, AI-agent sources. | Read before changing source coverage, top-slot priorities, locale support, or platform category mapping. |
| `docs/SOURCE_STRATEGY.md` | Evidence strategy for different source families. | Read before changing source-strategy artifacts, source family decisions, or claim/evidence expectations by platform type. |

## Portal Navigation Docs

| File | Purpose | How to use |
| --- | --- | --- |
| `docs/PORTAL_NAVIGATION_ARCHITECTURE.md` | Architecture for portal-native navigation, selector calibration, destination follow-up, destination triage, and safe execution. | Read before changing navigation architecture, data flow, failure modes, or evidence boundaries. |
| `docs/PORTAL_NAVIGATION_IMPLEMENTATION_GUIDE.md` | Lower-level implementation guide for source navigation plans, recipes, calibration, promotion, follow-up, deepening, and QA. | Read when implementing or debugging source-navigation code and tests. |
| `docs/NEXT_TASKS.md` | Current prioritized work queue. | Use as the active task board. Update after each meaningful development pass. |

## Evidence Feature Docs

| File | Purpose | How to use |
| --- | --- | --- |
| `docs/OCR.md` | Optional OCR setup, metadata semantics, profile flags, and live OCR harness. | Read before changing OCR fields, OCR claim handling, OCR tests, or live OCR setup. |
| `docs/OFFICIAL_API.md` | Credentials-gated official API setup and readiness checks for supported providers. | Read before changing YouTube/Instagram/TikTok official API collection or credential handling. |
| `docs/QA_QC_PROCESS.md` | Quality gates, smoke tests, opt-in live tests, real-site calibration loop, and current verification caveats. | Read before claiming work is verified or asking another agent to QA. |

## History And Release Docs

| File | Purpose | How to use |
| --- | --- | --- |
| `docs/DEVELOPMENT_HISTORY.md` | Full chronological development record. | Search by pass name, module name, or command result when reconstructing why a feature exists. |
| `docs/RELEASE_NOTES.md` | Version/pass summary and rough update size. | Read when explaining what changed per version or preparing a release/changelog. |

## Agent Handoff Docs

| File | Purpose | How to use |
| --- | --- | --- |
| `AGENTS.md` | Primary session memory for coding agents. | First file to read in every new session. Keep concise but current. |
| `docs/CLAUDE_HANDOFF.md` | Copy/paste handoff for Claude or another coding agent. | Give this to Claude together with `AGENTS.md` when switching agents. |

## Current Verification Caveat

The latest completed full verification before the scene-change hit-cap pass was:

```powershell
npm run verify
```

It passed with build, 34 test files / 351 tests, local smoke, public web smoke,
media smoke, proxy smoke, and 0 npm audit vulnerabilities after the OCR CTA and
policy text-profile pass.

After that, the scene-change hit-cap pass added
`denseSampling.sceneChangeMaxHits` and `--dense-scene-max-hits`. Focused tests
and build passed, but the final full `npm run verify` for that latest change was
interrupted by the user and must be rerun before claiming the whole worktree is
fully verified.

## Recommended Resume Prompt

Use this prompt for Codex or Claude:

```text
Read AGENTS.md, docs/DOCUMENTATION_MAP.md, docs/CLAUDE_HANDOFF.md,
docs/NEXT_TASKS.md, and docs/DEVELOPMENT_HISTORY.md. Continue from the current
worktree. Do not revert user changes. First rerun npm run verify because the
last full verify was interrupted after the scene-change hit-cap pass, then
continue the next item in docs/NEXT_TASKS.md.
```
