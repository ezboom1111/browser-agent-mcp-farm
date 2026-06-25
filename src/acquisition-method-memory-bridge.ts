import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { planAcquisitionMethods, type AcquisitionFailureSignal, type AcquisitionMethodPlan } from "./acquisition-method-planner.js";

export type AcquisitionMemoryNoteKind = "system_dna" | "method_recipe" | "frontier_ledger" | "bridge_note" | "operation_log";

export interface AcquisitionMethodMemoryBridgeInput {
  runDir: string;
  vaultRoot: string;
  sourceUrl?: string;
  merkleRoot?: string;
  methodId?: string;
  decisionId?: string;
  now?: string | Date;
  apply?: boolean;
}

export interface AcquisitionMemoryNote {
  kind: AcquisitionMemoryNoteKind;
  path: string;
  relativePath: string;
  content: string;
  changed: boolean;
}

export interface AcquisitionMethodMemoryBridgeResult {
  ok: true;
  applied: boolean;
  written: number;
  runDir: string;
  vaultRoot: string;
  methodId: string;
  sourceUrl: string;
  merkleRoot?: string;
  acquisitionPlanArtifactId?: string;
  obstructionArtifactIds: string[];
  notes: AcquisitionMemoryNote[];
  warnings: string[];
}

interface ArtifactLedgerRow {
  artifact_id?: string;
  path?: string;
  source_url?: string;
  evidence_kind?: string;
  tool_name?: string;
  capture_method?: string;
  sha256?: string;
}

interface BrowserObstructionSummary {
  artifactId: string;
  path: string;
  status: string;
  blockers: string[];
  symptom: string;
}

const DEFAULT_METHOD_ID = "farm-insane-search-method-selection-ladder";
const DEFAULT_DECISION_ID = "2026-06-25-browser-agent-mcp-farm-direct-capture-often";
const SYSTEM_DNA_ROW = "| Insane-search method-selection ladder | local_synthesis | Selector recipes are not the durable asset; public endpoint/feed/http/browser/BYO method selection is. The farm remains the verifier and external bridge bytes stay untrusted until hash-registered and claim-gated. |";

export async function buildAcquisitionMethodMemoryBridge(input: AcquisitionMethodMemoryBridgeInput): Promise<AcquisitionMethodMemoryBridgeResult> {
  const now = normalizeDate(input.now);
  const date = isoDate(now);
  const vaultRoot = resolve(input.vaultRoot);
  const runDir = resolve(input.runDir);
  const methodId = input.methodId ?? DEFAULT_METHOD_ID;
  const decisionId = input.decisionId ?? DEFAULT_DECISION_ID;
  const rows = await readArtifactLedger(runDir);
  const warnings: string[] = [];
  const planInfo = await readAcquisitionPlan(runDir, rows, input.sourceUrl, warnings);
  const sourceUrl = input.sourceUrl ?? planInfo.plan.inputUrl;
  const obstructions = await readObstructionSummaries(runDir, rows);

  const paths = {
    systemDna: resolveInside(vaultRoot, "SYSTEM_DNA.md"),
    recipe: resolveInside(vaultRoot, "vault", "methods", "acquisition", `${methodId}.md`),
    frontier: resolveInside(vaultRoot, "vault", "sessions", `${date}-browser-agent-mcp-farm-acquisition-frontier.md`),
    bridge: resolveInside(vaultRoot, "vault", "sessions", `${date}-browser-agent-mcp-farm-kb-bridge.md`),
    log: resolveInside(vaultRoot, "LOG.md")
  };

  const existingSystemDna = await readOptionalText(paths.systemDna);
  const systemDnaContent = upsertSystemDnaRow(existingSystemDna ?? defaultSystemDna(), SYSTEM_DNA_ROW);
  const recipe = renderMethodRecipe({ now, methodId, decisionId, runDir, sourceUrl, merkleRoot: input.merkleRoot, plan: planInfo.plan, planArtifactId: planInfo.artifact?.artifact_id, obstructions });
  const frontier = renderFrontierLedger({ now, decisionId, runDir, sourceUrl, merkleRoot: input.merkleRoot, plan: planInfo.plan, planArtifactId: planInfo.artifact?.artifact_id, obstructions });
  const bridge = renderBridgeNote({ now, methodId, decisionId, runDir, sourceUrl, merkleRoot: input.merkleRoot, plan: planInfo.plan, planArtifact: planInfo.artifact, obstructions });
  const log = appendOperationLog(await readOptionalText(paths.log), { now, methodId, runDir, merkleRoot: input.merkleRoot });

  const noteInputs: Array<{ kind: AcquisitionMemoryNoteKind; path: string; content: string; existing?: string | undefined }> = [
    { kind: "system_dna", path: paths.systemDna, content: systemDnaContent, existing: existingSystemDna },
    { kind: "method_recipe", path: paths.recipe, content: recipe, existing: await readOptionalText(paths.recipe) },
    { kind: "frontier_ledger", path: paths.frontier, content: frontier, existing: await readOptionalText(paths.frontier) },
    { kind: "bridge_note", path: paths.bridge, content: bridge, existing: await readOptionalText(paths.bridge) },
    { kind: "operation_log", path: paths.log, content: log, existing: await readOptionalText(paths.log) }
  ];

  const notes = noteInputs.map((note) => ({
    kind: note.kind,
    path: note.path,
    relativePath: normalizePath(relative(vaultRoot, note.path)),
    content: note.content,
    changed: note.existing !== note.content
  }));

  return {
    ok: true,
    applied: false,
    written: 0,
    runDir,
    vaultRoot,
    methodId,
    sourceUrl,
    ...(input.merkleRoot === undefined ? {} : { merkleRoot: input.merkleRoot }),
    ...(planInfo.artifact?.artifact_id === undefined ? {} : { acquisitionPlanArtifactId: planInfo.artifact.artifact_id }),
    obstructionArtifactIds: obstructions.map((obstruction) => obstruction.artifactId),
    notes,
    warnings
  };
}

export async function writeAcquisitionMethodMemoryBridge(input: AcquisitionMethodMemoryBridgeInput): Promise<AcquisitionMethodMemoryBridgeResult> {
  const result = await buildAcquisitionMethodMemoryBridge(input);
  if (input.apply !== true) {
    return result;
  }

  let written = 0;
  for (const note of result.notes) {
    if (!note.changed) {
      continue;
    }
    await mkdir(dirname(note.path), { recursive: true });
    await writeFile(note.path, note.content, "utf8");
    written += 1;
  }
  return { ...result, applied: true, written };
}

async function readArtifactLedger(runDir: string): Promise<ArtifactLedgerRow[]> {
  const text = await readOptionalText(join(runDir, "artifacts.jsonl"));
  if (text === undefined) {
    return [];
  }
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ArtifactLedgerRow;
      } catch {
        return undefined;
      }
    })
    .filter((row): row is ArtifactLedgerRow => row !== undefined);
}

async function readAcquisitionPlan(runDir: string, rows: ArtifactLedgerRow[], fallbackUrl: string | undefined, warnings: string[]): Promise<{ plan: AcquisitionMethodPlan; artifact?: ArtifactLedgerRow | undefined }> {
  const artifact = rows.find((row) => row.tool_name === "acquisition_method_plan" && typeof row.path === "string") ?? rows.find((row) => row.capture_method?.includes("acquisition-method-plan") && typeof row.path === "string");
  if (artifact !== undefined && artifact.path !== undefined) {
    const text = await readOptionalText(join(runDir, artifact.path));
    if (text !== undefined) {
      try {
        const parsed = JSON.parse(text) as unknown;
        const plan = parseAcquisitionPlanObject(parsed);
        if (plan !== undefined) {
          return { plan, artifact };
        }
        warnings.push(`invalid_acquisition_plan_shape:${artifact.path}`);
      } catch {
        warnings.push(`failed_to_parse_acquisition_plan:${artifact.path}`);
      }
    }
  }
  if (fallbackUrl === undefined) {
    throw new Error("no acquisition_method_plan artifact found; pass --url to build a provisional plan");
  }
  warnings.push("used_provisional_plan_from_url");
  return { plan: planAcquisitionMethods({ url: fallbackUrl }) };
}

async function readObstructionSummaries(runDir: string, rows: ArtifactLedgerRow[]): Promise<BrowserObstructionSummary[]> {
  const obstructionRows = rows.filter((row) => row.evidence_kind === "browser_obstruction" && typeof row.path === "string");
  const summaries: BrowserObstructionSummary[] = [];
  for (const row of obstructionRows) {
    if (row.path === undefined) {
      continue;
    }
    const text = await readOptionalText(join(runDir, row.path));
    const parsed = parseJsonObject(text);
    const report = parseBrowserObstructionObject(parsed);
    const detections = Array.isArray(report?.detections) ? report.detections : [];
    const blockers = detections.map((detection) => objectString(detection, "kind")).filter((item): item is string => item !== undefined && item.length > 0);
    const symptom = detections
      .map((detection) => arrayStrings(detection, "evidence").join("; "))
      .filter(Boolean)
      .join(" | ");
    summaries.push({
      artifactId: row.artifact_id ?? row.path,
      path: row.path,
      status: objectString(report, "status") ?? "unknown",
      blockers,
      symptom
    });
  }
  return summaries;
}

function parseAcquisitionPlanObject(value: unknown): AcquisitionMethodPlan | undefined {
  const object = objectRecord(value);
  if (object === undefined) {
    return undefined;
  }
  if (isAcquisitionPlanShape(object)) {
    return object as unknown as AcquisitionMethodPlan;
  }
  const wrapped = objectRecord(object.acquisitionPlan);
  return wrapped !== undefined && isAcquisitionPlanShape(wrapped) ? (wrapped as unknown as AcquisitionMethodPlan) : undefined;
}

function isAcquisitionPlanShape(value: Record<string, unknown>): boolean {
  return typeof value.inputUrl === "string" && typeof value.platform === "string" && typeof value.sourceFamily === "string" && typeof value.observedFailure === "string" && Array.isArray(value.methods);
}

function parseBrowserObstructionObject(value: unknown): Record<string, unknown> | undefined {
  const object = objectRecord(value);
  if (object === undefined) {
    return undefined;
  }
  if (Array.isArray(object.detections)) {
    return object;
  }
  return objectRecord(object.browserObstructions);
}

function renderMethodRecipe(input: { now: Date; methodId: string; decisionId: string; runDir: string; sourceUrl: string; merkleRoot?: string | undefined; plan: AcquisitionMethodPlan; planArtifactId?: string | undefined; obstructions: BrowserObstructionSummary[] }): string {
  const date = isoDate(input.now);
  const reviewAfter = addDays(input.now, 45);
  const fallbackChain = input.plan.methods.map((method) => `${method.phase}:${method.tier}:${method.key}`);
  const blockedBy = blockersFor(input.plan.observedFailure, input.obstructions);
  const blockedByYaml = blockedBy.length === 0 ? ["none"] : blockedBy;
  return `---
governed_by:
- "[[CONSTITUTION#^sector-axis]]"
- "[[acquisition-method-evolution]]"
role: rule
continuity_scope: workflow
state_kind: canon
status: active
memory_type: procedural
memory_subject: workflow
importance: 4
freshness: current
volatility: high
half_life_days: 45
review_after: '${reviewAfter}'
evidence_level: single_source
usage_state: used
fit_scope:
- acquisition
- research-method
- browser-agent-mcp-farm
theory_status: local_synthesis
title: "Farm insane-search method-selection ladder"
method_id: "${input.methodId}"
method_family: farm
acquisition_goal: "blocked public-page acquisition without selector recipes"
source_platforms:
${yamlList([input.plan.platform])}
query_strategy: "method-selection ladder"
selection_policy: "cheapest lawful tier first; terminal-refuse on login/paywall/CAPTCHA"
extraction_path: "official_api|feed|http_fetch|browser_visible_capture|byo_capture"
fallback_chain:
${yamlList(fallbackChain)}
failure_modes:
${yamlList(["empty_shell", "browser_blocked", "manual_selector_pressure", "login_or_paywall", "captcha_or_challenge"])}
blocked_by:
${yamlList(blockedByYaml)}
cost_profile: "cheap-to-medium before BYO"
success_metrics:
- yield_rate
- precision_estimate
- blocker_resilience
- citation_quality
- compliance_risk_penalty
last_run_at: '${date}'
last_success_at:
yield_count:
precision_estimate:
novelty_yield:
cross_affordance_yield:
tags:
- r/rule
- acquisition-recipe
- insane-search-dna
---

# Farm insane-search method-selection ladder

> Reusable acquisition recipe promoted from a farm-sealed method investigation. It imports the durable DNA of insane-search as method selection, not as trusted capture.

## When To Use

- task: public-page research where direct farm capture often returns a block, empty shell, or selector pressure.
- good for: choosing the next lawful acquisition tier before asking the operator to hand-pick DOM elements.
- bad for: login-only, paywalled, CAPTCHA, age-gated, payment, booking, account-changing, DRM, or raw media stream surfaces.
- risk boundary: external bridge bytes are untrusted BYO supply until registered and claim-gated by the farm.

## Fallback Chain

| order | phase | tier | key | trust | status |
|---|---:|---|---|---|---|
${input.plan.methods.map((method, index) => `| ${index + 1} | ${method.phase} | ${method.tier} | ${method.key} | ${method.trust} | ${method.status} |`).join("\n")}

## Method Components

- yield_rate: unmeasured; record after live blocked-page retries.
- precision_estimate: unmeasured; claim gate protects anchors, not coverage quality.
- blocker_resilience: expected to improve when obstruction signals trigger re-plan, still pending runtime wiring.
- citation_quality: preserved by farm hash registration and cite-or-fail.
- compliance_risk_penalty: low for official/feed/http/browser-visible tiers; external bridge remains opt-in BYO.

## Failure Log

| date | blocker | symptom | workaround | outcome |
|---|---|---|---|---|
${input.obstructions.length === 0 ? `| ${date} | ${input.plan.observedFailure} | no obstruction artifact in bridge input | keep as frontier assumption | unknown |` : input.obstructions.map((obstruction) => `| ${date} | ${obstruction.blockers.join(", ") || input.plan.observedFailure} | ${escapeTable(obstruction.symptom || obstruction.status)} | re-plan to lawful fallback chain | partial |`).join("\n")}

## Evidence Bridge

- decision: [[${input.decisionId}]]
- source_url: ${input.sourceUrl}
- farm_run: \`${input.runDir}\`
- plan_artifact: ${input.planArtifactId ?? "provisional"}
- merkleRoot: ${input.merkleRoot ?? "not supplied"}

## Next Upgrade

- Expand legal gateway arms beyond the current Jina Reader + Wayback retry: AMP discovery and archive.today-style gateways.
- Add byte-faithful BYO ingest before enabling external bridge bytes for non-text artifacts.
- Update this recipe after at least 20 comparable runs; before that, treat scores as anecdotal.
`;
}

function renderFrontierLedger(input: { now: Date; decisionId: string; runDir: string; sourceUrl: string; merkleRoot?: string | undefined; plan: AcquisitionMethodPlan; planArtifactId?: string | undefined; obstructions: BrowserObstructionSummary[] }): string {
  const date = isoDate(input.now);
  const reviewAfter = addDays(input.now, 30);
  const blockers = blockersFor(input.plan.observedFailure, input.obstructions);
  return `---
governed_by:
- "[[CONSTITUTION#^sector-axis]]"
- "[[acquisition-method-evolution]]"
role: rule
continuity_scope: workflow
state_kind: canon
status: active
memory_type: procedural
memory_subject: workflow
importance: 3
freshness: current
volatility: medium
half_life_days: 30
review_after: '${reviewAfter}'
evidence_level: single_source
usage_state: used
fit_scope:
- research-frontier
- acquisition
title: "browser-agent-mcp-farm acquisition frontier"
project_id: "browser-agent-mcp-farm"
research_goal: "Learn which lawful acquisition methods recover public sources after direct capture fails."
decision_needed: "When should farm-native capture escalate to public endpoints, feeds, browser-visible capture, consented profile, or BYO?"
tags:
- r/rule
- research-frontier
- acquisition
---

# browser-agent-mcp-farm acquisition frontier

## Scope

- project: browser-agent-mcp-farm
- decision_needed: connect method-selection outcomes to future capture routing without reviving selector recipes.
- freshness window: 30 days for blocker observations, 45 days for method recipe review.
- risk boundary: no login, paywall, CAPTCHA, age-gate, payment, booking, account-change, DRM, or raw media stream bypass.
- stop condition: terminal-refuse on access-control boundaries; use consented profile or human BYO only.

## Searched Queries

| date | platform/channel | surface | personalization | query/filter/seed | selection policy | selected sources | result / bias note |
|---|---|---|---|---|---|---|---|
| ${date} | ${input.plan.platform} | ${input.plan.sourceFamily} | unknown | ${escapeTable(input.sourceUrl)} | method ladder | ${input.plan.methods.map((method) => method.key).join(", ")} | planner evidence, not runtime success |

## Visited Sources

| source_id / url | status | reason | falsification evidence | duplicate_of | artifact/hash | next action |
|---|---|---|---|---|---|---|
| ${escapeTable(input.sourceUrl)} | ${input.obstructions.length > 0 ? "blocked" : "deferred"} | observedFailure=${input.plan.observedFailure} | ${input.obstructions.map((item) => item.artifactId).join(", ") || "plan-only"} |  | ${input.merkleRoot ?? input.planArtifactId ?? "none"} | feed obstruction signal back into planner |

## Blocker Checks

| source_id / url | checked_at | cheap test | observed symptom | result | next_probe |
|---|---|---|---|---|---|
${input.obstructions.length === 0 ? `| ${escapeTable(input.sourceUrl)} | ${input.now.toISOString()} | farm evidence-run | ${input.plan.observedFailure} | unknown | run with obstruction feedback wiring |` : input.obstructions.map((obstruction) => `| ${escapeTable(input.sourceUrl)} | ${input.now.toISOString()} | farm evidence-run | ${escapeTable(obstruction.symptom || obstruction.blockers.join(", ") || obstruction.status)} | blocked | retry legal gateway tier before browser |`).join("\n")}

## Unsearched Axes

- source_type: official API / public feed / archive gateway coverage by host.
- actor: user-consented profile and human BYO capture for terminal boundaries.
- contradiction / negative search: cases where browser works but feed/API loses required visible context.
- adjacent domain: platform-specific official endpoints for Naver finance/search/news, YouTube, Reddit, X, Stack Exchange, PubMed.
- time / freshness: blocker observations expire quickly; recheck before turning a blocker into a standing rule.
- platform/channel/surface: ${blockers.join(", ") || "none yet"}.

## Method Outcome

- usable_sources:
- rejected_sources:
- duplicate_sources:
- blockers: ${input.obstructions.length}
- blocker_claims: ${input.obstructions.length}
- overturned_blocker_claims:
- absence_claims:
- overturned_absence_claims:
- novelty_yield:
- personalization_bias: unknown
- surface_diversity:
- route_observation_ttl: 30d
- last_success_at:
- review_after: ${reviewAfter}
- downstream_reuse: [[${input.decisionId}]]
- time_cost: derive from evidence-run stage timings when runtime wiring exists
- lesson: current bridge records the method as memory; it does not prove blocked-page recovery until runtime tiers execute.
`;
}

function renderBridgeNote(input: { now: Date; methodId: string; decisionId: string; runDir: string; sourceUrl: string; merkleRoot?: string | undefined; plan: AcquisitionMethodPlan; planArtifact?: ArtifactLedgerRow | undefined; obstructions: BrowserObstructionSummary[] }): string {
  const date = isoDate(input.now);
  return `---
governed_by:
- "[[CONSTITUTION#^sector-hierarchy]]"
- "[[acquisition-method-evolution]]"
role: inference
continuity_scope: project
state_kind: canon
status: active
memory_type: procedural
memory_subject: project
importance: 3
freshness: current
volatility: medium
half_life_days: 90
review_after: '${addDays(input.now, 90)}'
evidence_level: measured
usage_state: used
fit_scope:
- bridge
- acquisition
- browser-agent-mcp-farm
title: "browser-agent-mcp-farm KB bridge for acquisition method memory"
tags:
- r/inference
- bridge
- acquisition
---

# browser-agent-mcp-farm KB bridge for acquisition method memory

This note bridges a farm evidence bundle into vault method memory. The bundle remains a derived artifact; this note records which method lessons were promoted and where to re-verify them.

## Promoted Items

- SYSTEM_DNA: \`Insane-search method-selection ladder\` local_synthesis row.
- acquisition recipe: [[${input.methodId}]]
- frontier ledger: [[${date}-browser-agent-mcp-farm-acquisition-frontier]]
- decision: [[${input.decisionId}]]

## Evidence Pointers

- source_url: ${input.sourceUrl}
- runDir: \`${input.runDir}\`
- merkleRoot: ${input.merkleRoot ?? "not supplied"}
- acquisition_plan_artifact: ${input.planArtifact?.artifact_id ?? "provisional"}
- acquisition_plan_path: ${input.planArtifact?.path ?? "none"}
- obstruction_artifacts: ${input.obstructions.map((obstruction) => obstruction.artifactId).join(", ") || "none"}

## Method DNA

- durable: method-selection ladder, public endpoint preference, validator/verdict pressure, terminal refusal boundaries.
- not durable: per-site selector recipes, autonomous anti-bot bypass, trusted TLS impersonation in farm TCB.
- current code state: planner artifact exists; runtime capture still needs obstruction -> re-plan -> legal tier execution wiring.

## Farm Plan Snapshot

\`\`\`json
${JSON.stringify(input.plan, null, 2)}
\`\`\`
`;
}

function appendOperationLog(existing: string | undefined, input: { now: Date; methodId: string; runDir: string; merkleRoot?: string | undefined }): string {
  const base = existing ?? "# LOG - operation ledger\n";
  const date = isoDate(input.now);
  const entry = `
## [${date}] mechanism | farm-acquisition-method-memory-bridge

- actor: browser-agent-mcp-farm CLI
- changed: Bridged acquisition method-selection DNA into vault method memory: SYSTEM_DNA row, [[${input.methodId}]], frontier ledger, and bridge note.
- evidence: farm run \`${input.runDir}\`${input.merkleRoot === undefined ? "" : `; merkleRoot=${input.merkleRoot}`}.
- next: Wire runtime obstruction feedback into acquisition planning and measure blocked-page recovery outcomes.
`;
  return `${base.trimEnd()}\n${entry.trimEnd()}\n`;
}

function upsertSystemDnaRow(existing: string, row: string): string {
  if (existing.includes("Insane-search method-selection ladder")) {
    return existing;
  }
  const marker = "## 4. 시스템 장기 구조";
  const insert = `${row}\n\n`;
  const index = existing.indexOf(marker);
  if (index === -1) {
    return `${existing.trimEnd()}\n\n${insert}`;
  }
  return `${existing.slice(0, index).trimEnd()}\n${insert}${existing.slice(index)}`;
}

function defaultSystemDna(): string {
  return `# SYSTEM_DNA v2\n\n## 3. 내부 합성 라벨\n\n| 내부명 | 상태 | 정확한 의미 |\n|---|---|---|\n\n## 4. 시스템 장기 구조\n`;
}

function blockersFor(signal: AcquisitionFailureSignal, obstructions: BrowserObstructionSummary[]): string[] {
  const blockers = obstructions.flatMap((obstruction) => obstruction.blockers);
  if (blockers.length > 0) {
    return unique(blockers);
  }
  return signal === "none" ? [] : [signal];
}

function normalizeDate(value: string | Date | undefined): Date {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid bridge date");
  }
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): string {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return isoDate(next);
}

function yamlList(items: string[]): string {
  if (items.length === 0) {
    return "[]";
  }
  return items.map((item) => `- ${JSON.stringify(item)}`).join("\n");
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function parseJsonObject(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) {
    return undefined;
  }
  try {
    const value = JSON.parse(text) as unknown;
    return objectRecord(value);
  } catch {
    return undefined;
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function objectString(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : undefined;
}

function arrayStrings(value: unknown, key: string): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const raw = (value as Record<string, unknown>)[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function resolveInside(root: string, ...parts: string[]): string {
  const rootPath = resolve(root);
  const target = resolve(rootPath, ...parts);
  const rel = relative(rootPath, target);
  if (rel.startsWith("..") || rel === "" || /^[a-zA-Z]:/.test(rel)) {
    if (rel !== "") {
      throw new Error(`vault path escapes root: ${parts.join("/")}`);
    }
  }
  return target;
}
