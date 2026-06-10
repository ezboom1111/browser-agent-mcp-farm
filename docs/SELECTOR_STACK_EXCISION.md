# Selector / source-navigation stack excision plan

> Status: **EXECUTED 2026-06-10** (P1 freeze → P2 CLI sever → P3/P4 delete → P5 re-baseline, all
> landed green under the full verify gate in one session; net −25,956 lines + README 956→~510).
> Deviations from the plan, discovered during the coupling map: `coverage-report.ts` +
> `acquisition-router.ts` were kept as tested libraries (canary ledger types inlined; honest
> degradation — nothing new becomes `autonomous_ready` without a runner); the `coverage-report`
> and `recipe-canary` CLI commands died with the readiness audit they were built on; destination
> triage survives as a library but is no longer wired into `evidence_run` (destination candidates
> were only ever authored by the navigation follow-up path). Coverage floors re-baselined
> 80/80/82/74 → 74/74/76/68 (the deleted subsystem was covered above the repo average).
> Decision basis: the 2026-06-10 Fable-era 3-agent audit + the earlier durability analysis both
> ruled this subsystem **STOP**: model vision + consented-browser capture solved the problem
> site-specific selector recipes were built for, and recipes rot permanently. The deterministic
> core (hash registration, claim gate, judge cage, bundles) is NOT part of this excision.

## Measured scope (2026-06-10)

- `src`: 20 files, **13,052 LOC** (~40% of the 33k-LOC src tree)
- `tests`: 23 files, **13,815 LOC**
- README: the majority of its 956 lines describe this subsystem's calibration/promotion loops.

## What is actually rot vs. what to keep (not all 13k dies)

| Subsystem | Files (approx LOC) | Verdict |
|---|---|---|
| Selector recipe farm | source-navigation-recipes (2,303), -recipe-catalog (1,124), recipe-canary (94) | **DELETE** — per-site CSS selectors, permanent rot |
| Calibration/promotion loops | -calibration (505), -calibration-batch (342), -calibration-loader (252), -calibration-targets (608), -promotion (701), source-coverage-calibration-loop (516), source-coverage-readiness (1,014) | **DELETE** — machinery that exists to keep the rot green |
| Recipe executor | -executor (832), -execution (84), source-navigation.ts (414) | **DELETE** after callers are severed |
| Destination triage | destination-triage (2,198), destination-url (139), destination-recovery-plan (523), client-state-destinations (184) | **KEEP (trim)** — bounded depth-1 triage is part of the gate's destination-provenance chain (`claim-gate.ts requiredDestinationProvenanceKinds`), not selector rot |
| Source strategy/registry | source-strategy (569), source-registry (588), acquisition-router (62) | **KEEP** — tier routing (`official_api → … → byo_capture`) is the lawful-acquisition policy, independently valuable |

Net deletable: roughly **8.5k src LOC + their tests**.

## Coupling points to sever (in order)

1. `evidence-runner.ts` — sourceNavigation stages + ~8 result fields (`sourceNavigationPlan/ExecutionPlan/RecipePlan/Calibration/Execution/FollowUps`).
2. `farm-service.ts evidenceRun()` — result shape mirrors those fields (consumer-visible: deprecate, then remove).
3. `cli.ts` — calibration/promotion commands (incl. the recipe export at ~line 1882) and their flags.
4. `schemas.ts` — `sourceNavigation` input on EvidenceRunInput; evidence kinds `source_navigation_*` stay as *historical* ledger vocabulary (old runs must still verify) but stop being produced.
5. README — rewrite around the core gate; move selector-era docs to `docs/archive/`.
6. Coverage ratchet — re-baseline after deletion (floors were computed over the dead weight).

## Phases (each lands green under `npm run verify`)

- **P1 freeze**: mark the subsystem deprecated in README + tool descriptions; no new recipes/calibrations. (Cheap, do anytime.)
- **P2 sever CLI**: remove calibration/promotion commands + tests.
- **P3 default-off**: make sourceNavigation execution opt-in in evidence-runner (flag), prove smokes green without it.
- **P4 delete**: remove the DELETE rows above + their tests; keep triage + strategy/registry.
- **P5 re-baseline**: coverage ratchet, STATUS, README rewrite, CHANGELOG `removed`.

Risk note: `farm_evidence_run`'s MCP result shape changes at P4 — ship as a **minor version with a
deprecation note** (personal project, Apache-2.0, but Codex + teammates consume the result fields).
