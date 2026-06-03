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

## Trust And Provenance Docs

| File | Purpose | How to use |
| --- | --- | --- |
| `docs/THREAT_MODEL.md` | Trust model, adversaries, and the deterministic-gate boundary. | Read before changing the claim gate, evidence trust assumptions, or any provenance feature. |
| `docs/CAPTURE_BINDING.md` | Tier-2 capture-binding: what each opt-in provenance piece (TLS identity, same-connection TLS, transparency log, multi-vantage agreement) proves and does NOT prove, plus the deliberately deferred items and why. | Read before changing or relying on `tls-identity`, `timestamp-anchor`, `multi-vantage-*`; it is the honest map of shipped-vs-deferred and the load-bearing "no theater" scope wording. |
| `docs/EXTERNAL_BRIDGE.md` | The opt-in, zero-credential external-bridge (caged executor) tier. | Read before changing the external-bridge lease tier or its fences. |

## History And Release Docs

| File | Purpose | How to use |
| --- | --- | --- |
| `docs/DEVELOPMENT_HISTORY.md` | Full chronological development record. | Search by pass name, module name, or command result when reconstructing why a feature exists. |
| `docs/RELEASE_NOTES.md` | Version/pass summary and rough update size. | Read when explaining what changed per version or preparing a release/changelog. |

## Agent Handoff Docs

| File | Purpose | How to use |
| --- | --- | --- |
| `AGENTS.md` | Primary session memory for coding agents (slim capability map). | First file to read in every new session. Keep concise; the long feature log is archived. |
| `docs/CLAUDE_HANDOFF.md` | Copy/paste handoff for Claude or another coding agent. | Give this to Claude together with `AGENTS.md` when switching agents. |
| `docs/ARCHITECTURE.md` | One-page layering and the build-enforced dependency rule. | Read before changing module boundaries or the core/intelligence split. |
| `STATUS.md` | Generated build/test/coverage status (single source of truth). | Read for current verify state; never hand-edit or copy counts into prose. |
| `skills/browser-agent-mcp-farm/SKILL.md` | Claude skill that drives the farm. | The agent-facing entry point; installed into `~/.claude/skills` by `register-all`. |
| `docs/archive/AGENTS_STATUS_LOG.md` | Archived long implemented-feature log. | Search when reconstructing why a feature exists; not in the read-first path. |

## Current Verification Status

`npm run verify` is green on `main` (the original `claude/handoff-baseline`
handoff has since been merged). The
generated [`STATUS.md`](../STATUS.md) records the exact build/test/coverage
result and the commit it came from — read it instead of relying on counts
written into prose. The gate now also runs a standalone typecheck over src and
tests, a dependency-direction boundary guard, a browser-presence guard, and a
coverage threshold, in addition to build, tests, four smoke captures, and
`npm audit`.

The previously-documented "scene-change verify was interrupted" caveat is
resolved: the full gate was rerun and passes.

## Recommended Resume Prompt

Use this prompt for Codex or Claude:

```text
Read AGENTS.md, docs/DOCUMENTATION_MAP.md, docs/ARCHITECTURE.md,
docs/CLAUDE_HANDOFF.md, STATUS.md, and docs/NEXT_TASKS.md. Continue from the
current worktree on branch main. Do not revert user changes.
Run npm run verify to confirm the gate is green, then continue the next item in
docs/NEXT_TASKS.md.
```
