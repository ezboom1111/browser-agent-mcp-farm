import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ArtifactWriter, sanitizeFileBase, type ArtifactRecord } from "./artifact-writer.js";
import type { CandidateDeepeningDecision, CandidateDeepeningLedger } from "./candidate-deepening-ledger.js";
import type { EvidenceWorkflowOptions, EvidenceWorkflowResult } from "./evidence-runner-types.js";
import type { EvidenceShape } from "./intent-profile.js";
import type { SearchStrategyArm, SearchStrategyPlan } from "./search-strategy-planner.js";

export type SearchFollowupKind = "search_arm" | "candidate_destination";
export type SearchFollowupNextAction = "run_evidence" | "manual_profile_or_byo" | "skip";
export type SearchFollowupStatus = "ready" | "empty" | "missing_artifacts";
export type SearchFollowupOutcomeStatus = "planned" | "executed" | "skipped" | "failed";

export interface SearchFollowupPlanItem {
  order: number;
  itemId: string;
  kind: SearchFollowupKind;
  sourceUrl: string;
  label: string;
  nextAction: SearchFollowupNextAction;
  risk: "low" | "medium" | "high";
  evidenceShapes: EvidenceShape[];
  parentSignal: string;
  reason: string;
  warnings: string[];
  childRunDir: string;
}

export interface SearchFollowupPlan {
  schemaVersion: "1.0";
  executionPolicy: "bounded_explicit_followup";
  parentRunDir: string;
  status: SearchFollowupStatus;
  budget: {
    maxArms: number;
    maxCandidates: number;
    maxTotal: number;
    selectedArms: number;
    selectedCandidates: number;
  };
  items: SearchFollowupPlanItem[];
  guards: string[];
  warnings: string[];
}

export interface SearchFollowupOutcome {
  order: number;
  itemId: string;
  status: SearchFollowupOutcomeStatus;
  sourceUrl: string;
  childRunDir?: string;
  reportPath?: string;
  ok?: boolean;
  reason?: string;
  error?: string;
}

export interface SearchFollowupOutcomeLedger {
  schemaVersion: "1.0";
  executionPolicy: "bounded_explicit_followup";
  parentRunDir: string;
  status: "planned" | "ok" | "partial" | "empty";
  executedCount: number;
  skippedCount: number;
  failedCount: number;
  outcomes: SearchFollowupOutcome[];
  warnings: string[];
}

export interface BuildSearchFollowupPlanOptions {
  runDir: string;
  maxArms?: number | undefined;
  maxCandidates?: number | undefined;
  maxTotal?: number | undefined;
}

export interface RunSearchFollowupsOptions extends BuildSearchFollowupPlanOptions {
  execute?: boolean | undefined;
  workflowRunner?: ((options: EvidenceWorkflowOptions) => Promise<Pick<EvidenceWorkflowResult, "ok" | "runDir" | "reportPath" | "url">>) | undefined;
  waitMs?: number | undefined;
  navigationTimeoutMs?: number | undefined;
  sampleFrames?: boolean | undefined;
}

export interface RunSearchFollowupsResult {
  ok: boolean;
  plan: SearchFollowupPlan;
  outcomeLedger: SearchFollowupOutcomeLedger;
  planRecords: ArtifactRecord[];
  outcomeRecords: ArtifactRecord[];
}

interface ArtifactLedgerRow {
  path?: string;
  kind?: string;
  evidence_kind?: string;
  source_url?: string;
}

const DEFAULT_MAX_ARMS = 2;
const DEFAULT_MAX_CANDIDATES = 3;
const DEFAULT_MAX_TOTAL = 5;

export async function buildSearchFollowupPlan(options: BuildSearchFollowupPlanOptions): Promise<SearchFollowupPlan> {
  const runDir = resolve(options.runDir);
  const maxArms = boundedInt(options.maxArms, DEFAULT_MAX_ARMS, 0, 10);
  const maxCandidates = boundedInt(options.maxCandidates, DEFAULT_MAX_CANDIDATES, 0, 10);
  const maxTotal = boundedInt(options.maxTotal, DEFAULT_MAX_TOTAL, 0, 20);
  const warnings: string[] = [];
  const artifacts = await readArtifactLedger(runDir);
  const searchStrategyPlan = await readLatestArtifactReport<SearchStrategyPlan>(runDir, artifacts, "search_strategy_plan", "searchStrategyPlan", warnings);
  const candidateDeepeningLedger = await readLatestArtifactReport<CandidateDeepeningLedger>(runDir, artifacts, "candidate_deepening_ledger", "candidateDeepeningLedger", warnings);

  if (searchStrategyPlan === undefined && candidateDeepeningLedger === undefined) {
    return basePlan({
      runDir,
      status: "missing_artifacts",
      maxArms,
      maxCandidates,
      maxTotal,
      warnings: ["Missing search_strategy_plan and candidate_deepening_ledger artifacts; run evidence-run on a search surface first.", ...warnings],
      items: []
    });
  }

  const seenUrls = new Set<string>();
  const armItems = selectArmItems({ runDir, plan: searchStrategyPlan, maxArms, seenUrls });
  const candidateItems = selectCandidateItems({ runDir, ledger: candidateDeepeningLedger, maxCandidates, seenUrls });
  const items = [...armItems, ...candidateItems].slice(0, maxTotal).map((item, index) => ({ ...item, order: index + 1 }));
  return basePlan({
    runDir,
    status: items.length === 0 ? "empty" : "ready",
    maxArms,
    maxCandidates,
    maxTotal,
    warnings,
    items
  });
}

export async function runSearchFollowups(options: RunSearchFollowupsOptions): Promise<RunSearchFollowupsResult> {
  const runDir = resolve(options.runDir);
  const plan = await buildSearchFollowupPlan(options);
  const writer = new ArtifactWriter();
  const parentSourceUrl = plan.items[0]?.sourceUrl ?? "https://example.com/";
  const captureNonce = randomUUID();
  const planRecords = await writer.writeCaptureBundle({
    runDir,
    sourceUrl: parentSourceUrl,
    contextToken: "search-followups",
    pageId: "search-followup-plan",
    captureId: `search-followup-plan-${captureNonce}`,
    metadata: { searchFollowupPlan: plan },
    text: JSON.stringify(plan, null, 2),
    captureMethod: "browser-agent-mcp-farm search-followup-plan",
    toolName: "search_followup_plan",
    evidenceKind: "search_followup_plan",
    note: "bounded follow-up queue derived from search strategy and candidate deepening artifacts; plan-only unless explicitly executed"
  });

  const outcomes = await executePlanItems(plan, options);
  const executedCount = outcomes.filter((outcome) => outcome.status === "executed").length;
  const skippedCount = outcomes.filter((outcome) => outcome.status === "skipped" || outcome.status === "planned").length;
  const failedCount = outcomes.filter((outcome) => outcome.status === "failed").length;
  const outcomeLedger: SearchFollowupOutcomeLedger = {
    schemaVersion: "1.0",
    executionPolicy: "bounded_explicit_followup",
    parentRunDir: runDir,
    status: plan.status === "empty" || plan.status === "missing_artifacts" ? "empty" : options.execute === true ? (failedCount === 0 ? "ok" : executedCount > 0 ? "partial" : "empty") : "planned",
    executedCount,
    skippedCount,
    failedCount,
    outcomes,
    warnings: [...plan.warnings, ...(options.execute === true ? [] : ["Follow-up execution was not requested; use --execute to run the bounded queue."])]
  };
  const outcomeRecords = await writer.writeCaptureBundle({
    runDir,
    sourceUrl: parentSourceUrl,
    contextToken: "search-followups",
    pageId: "search-followup-outcome-ledger",
    captureId: `search-followup-outcome-ledger-${captureNonce}`,
    metadata: { searchFollowupOutcomeLedger: outcomeLedger },
    text: JSON.stringify(outcomeLedger, null, 2),
    captureMethod: "browser-agent-mcp-farm search-followup-outcome-ledger",
    toolName: "search_followup_outcome_ledger",
    evidenceKind: "search_followup_outcome_ledger",
    note: "bounded search follow-up outcomes; skipped manual/BYO items are evidence of refusal boundary, not failures"
  });

  return {
    ok: failedCount === 0,
    plan,
    outcomeLedger,
    planRecords,
    outcomeRecords
  };
}

async function executePlanItems(plan: SearchFollowupPlan, options: RunSearchFollowupsOptions): Promise<SearchFollowupOutcome[]> {
  if (plan.items.length === 0) {
    return [];
  }
  if (options.execute !== true) {
    return plan.items.map((item) => ({
      order: item.order,
      itemId: item.itemId,
      status: "planned",
      sourceUrl: item.sourceUrl,
      childRunDir: item.childRunDir,
      reason: "execution_not_requested"
    }));
  }
  if (options.workflowRunner === undefined) {
    throw new Error("search follow-up execution requires a workflowRunner");
  }
  const outcomes: SearchFollowupOutcome[] = [];
  for (const item of plan.items) {
    if (item.nextAction !== "run_evidence") {
      outcomes.push({
        order: item.order,
        itemId: item.itemId,
        status: "skipped",
        sourceUrl: item.sourceUrl,
        childRunDir: item.childRunDir,
        reason: item.nextAction
      });
      continue;
    }
    try {
      const result = await options.workflowRunner({
        url: item.sourceUrl,
        runDir: item.childRunDir,
        captureId: sanitizeFileBase(`followup-${item.order}-${item.itemId}`),
        sampleFrames: options.sampleFrames ?? item.evidenceShapes.includes("video_frames"),
        finalClaimGate: false,
        waitMs: options.waitMs ?? 800,
        navigationTimeoutMs: options.navigationTimeoutMs ?? 30_000,
        researchIntent: {
          decisionNeeded: `Follow up ${item.kind}: ${item.label}`,
          targetScope: item.sourceUrl,
          evidenceShapes: item.evidenceShapes,
          successCriteria: "Decide whether this follow-up supplies destination evidence worth citing or another obstruction/outcome signal.",
          boundaries: "public only; no login, paywall, CAPTCHA, age-gate, payment, account-change, DRM, or raw media stream bypass"
        }
      });
      outcomes.push({
        order: item.order,
        itemId: item.itemId,
        status: result.ok ? "executed" : "failed",
        sourceUrl: item.sourceUrl,
        childRunDir: result.runDir,
        reportPath: result.reportPath,
        ok: result.ok,
        ...(result.ok ? {} : { reason: "child_evidence_run_failed" })
      });
    } catch (error) {
      outcomes.push({
        order: item.order,
        itemId: item.itemId,
        status: "failed",
        sourceUrl: item.sourceUrl,
        childRunDir: item.childRunDir,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return outcomes;
}

function selectArmItems(input: { runDir: string; plan: SearchStrategyPlan | undefined; maxArms: number; seenUrls: Set<string> }): Omit<SearchFollowupPlanItem, "order">[] {
  if (input.plan === undefined || input.maxArms <= 0) {
    return [];
  }
  return input.plan.arms
    .filter((arm) => isRunnableArm(arm))
    .filter((arm) => markUrlSeen(arm.url, input.seenUrls))
    .slice(0, input.maxArms)
    .map((arm) => ({
      itemId: `arm-${arm.armId}`,
      kind: "search_arm",
      sourceUrl: arm.url!,
      label: arm.query,
      nextAction: "run_evidence",
      risk: arm.risk,
      evidenceShapes: safeEvidenceShapes(arm.evidenceShapes),
      parentSignal: arm.armId,
      reason: arm.rationale,
      warnings: [],
      childRunDir: join(input.runDir, "search-followups", `${sanitizeOrderlessId(`arm-${arm.rank}-${arm.armId}`)}`)
    }));
}

function selectCandidateItems(input: { runDir: string; ledger: CandidateDeepeningLedger | undefined; maxCandidates: number; seenUrls: Set<string> }): Omit<SearchFollowupPlanItem, "order">[] {
  if (input.ledger === undefined || input.ledger.status !== "ok" || input.maxCandidates <= 0) {
    return [];
  }
  return input.ledger.decisions
    .filter((decision) => decision.selected && decision.url !== undefined)
    .filter((decision) => markUrlSeen(decision.url, input.seenUrls))
    .slice(0, input.maxCandidates)
    .map((decision) => candidateDecisionToItem(input.runDir, decision));
}

function candidateDecisionToItem(runDir: string, decision: CandidateDeepeningDecision): Omit<SearchFollowupPlanItem, "order"> {
  const manualBoundary = decision.nextAction === "manual_profile_or_byo" || decision.warnings.includes("possible_login_or_membership_wall");
  return {
    itemId: `candidate-${decision.candidateRank}`,
    kind: "candidate_destination",
    sourceUrl: decision.url!,
    label: decision.title,
    nextAction: manualBoundary ? "manual_profile_or_byo" : decision.nextAction === "open_destination_capture" ? "run_evidence" : "skip",
    risk: decision.risk,
    evidenceShapes: safeEvidenceShapes(decision.recommendedEvidenceShapes),
    parentSignal: `candidate_rank_${decision.candidateRank}`,
    reason: decision.reasons.join(", ") || "selected search-result candidate",
    warnings: decision.warnings,
    childRunDir: join(runDir, "search-followups", `${sanitizeOrderlessId(`candidate-${decision.candidateRank}-${decision.title}`)}`)
  };
}

function isRunnableArm(arm: SearchStrategyArm): boolean {
  return arm.armId !== "current_surface" && arm.status === "try" && arm.risk === "low" && arm.url !== undefined && /^https?:\/\//i.test(arm.url);
}

function markUrlSeen(url: string | undefined, seen: Set<string>): boolean {
  if (url === undefined) {
    return false;
  }
  const normalized = normalizeUrlForDedupe(url);
  if (seen.has(normalized)) {
    return false;
  }
  seen.add(normalized);
  return true;
}

function normalizeUrlForDedupe(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function safeEvidenceShapes(shapes: readonly EvidenceShape[]): EvidenceShape[] {
  const unique = Array.from(new Set(shapes));
  return unique.length === 0 ? ["page_text", "page_html"] : unique;
}

function basePlan(input: { runDir: string; status: SearchFollowupStatus; maxArms: number; maxCandidates: number; maxTotal: number; items: SearchFollowupPlanItem[]; warnings: string[] }): SearchFollowupPlan {
  return {
    schemaVersion: "1.0",
    executionPolicy: "bounded_explicit_followup",
    parentRunDir: input.runDir,
    status: input.status,
    budget: {
      maxArms: input.maxArms,
      maxCandidates: input.maxCandidates,
      maxTotal: input.maxTotal,
      selectedArms: input.items.filter((item) => item.kind === "search_arm").length,
      selectedCandidates: input.items.filter((item) => item.kind === "candidate_destination").length
    },
    items: input.items,
    guards: [
      "This is not a platform crawler or selector harness; it only consumes explicit artifacts from one parent run.",
      "Default mode is plan-only; execution requires an explicit --execute opt-in.",
      "Login, paywall, CAPTCHA, membership, age-gate, payment, account-change, DRM, and raw media protections stay terminal.",
      "Every destination claim still needs its own captured child evidence."
    ],
    warnings: input.warnings
  };
}

async function readArtifactLedger(runDir: string): Promise<ArtifactLedgerRow[]> {
  const raw = await readFile(join(runDir, "artifacts.jsonl"), "utf8").catch(() => "");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ArtifactLedgerRow];
      } catch {
        return [];
      }
    });
}

async function readLatestArtifactReport<T>(runDir: string, artifacts: readonly ArtifactLedgerRow[], evidenceKind: string, metadataKey: string, warnings: string[]): Promise<T | undefined> {
  const candidates = artifacts.filter((artifact) => artifact.evidence_kind === evidenceKind && artifact.path !== undefined && (artifact.kind === "text" || artifact.kind === "structured")).reverse();
  for (const artifact of candidates) {
    try {
      const parsed = JSON.parse(await readFile(join(runDir, artifact.path!), "utf8")) as unknown;
      const extracted = extractReport<T>(parsed, metadataKey);
      if (extracted !== undefined) {
        return extracted;
      }
    } catch (error) {
      warnings.push(`Skipped invalid ${evidenceKind} artifact ${artifact.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  warnings.push(`No readable ${evidenceKind} artifact was found.`);
  return undefined;
}

function extractReport<T>(parsed: unknown, metadataKey: string): T | undefined {
  if (!isRecord(parsed)) {
    return undefined;
  }
  if (typeof parsed.schemaVersion === "string") {
    return parsed as T;
  }
  const direct = parsed[metadataKey];
  if (isRecord(direct) && typeof direct.schemaVersion === "string") {
    return direct as T;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function sanitizeOrderlessId(value: string): string {
  return sanitizeFileBase(value).slice(0, 80);
}
