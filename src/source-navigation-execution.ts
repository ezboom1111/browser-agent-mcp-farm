import type { SourceNavigationActionKind, SourceNavigationPlan } from "./source-navigation.js";

export type SourceNavigationExecutionStatus = "pending" | "unsupported";

export interface SourceNavigationExecutionLimits {
  maxActions: number;
  perActionTimeoutMs: number;
  captureBeforeAfter: boolean;
  stopOnUnsupported: boolean;
}

export interface SourceNavigationExecutionStep {
  key: string;
  status: SourceNavigationExecutionStatus;
  reason: string;
  timeoutMs: number;
  captureBefore: boolean;
  captureAfter: boolean;
  actionKey?: string;
  kind?: SourceNavigationActionKind;
}

export interface SourceNavigationExecutionPlan {
  schemaVersion: "1.0";
  sourcePlan: {
    platform: SourceNavigationPlan["platform"];
    sourceFamily: SourceNavigationPlan["sourceFamily"];
    mode: SourceNavigationPlan["mode"];
  };
  limits: SourceNavigationExecutionLimits;
  steps: SourceNavigationExecutionStep[];
  unsupportedSteps: SourceNavigationExecutionStep[];
  omittedActionCount: number;
}

export const DEFAULT_SOURCE_NAVIGATION_EXECUTION_LIMITS: SourceNavigationExecutionLimits = {
  maxActions: 12,
  perActionTimeoutMs: 10_000,
  captureBeforeAfter: true,
  stopOnUnsupported: true
};

export function buildSourceNavigationExecutionPlan(plan: SourceNavigationPlan, limits: Partial<SourceNavigationExecutionLimits> = {}): SourceNavigationExecutionPlan {
  const normalizedLimits = normalizeExecutionLimits(limits);
  const executableActions = plan.plannedActions.slice(0, normalizedLimits.maxActions);
  const omittedActionCount = Math.max(0, plan.plannedActions.length - executableActions.length);

  return {
    schemaVersion: "1.0",
    sourcePlan: {
      platform: plan.platform,
      sourceFamily: plan.sourceFamily,
      mode: plan.mode
    },
    limits: normalizedLimits,
    steps: executableActions.map((action) => ({
      key: `action:${action.key}`,
      actionKey: action.key,
      kind: action.kind,
      status: "pending",
      reason: action.reason,
      timeoutMs: normalizedLimits.perActionTimeoutMs,
      captureBefore: normalizedLimits.captureBeforeAfter && action.requiresCapture,
      captureAfter: normalizedLimits.captureBeforeAfter && action.requiresCapture
    })),
    unsupportedSteps: plan.unsupportedActions.map((action) => ({
      key: `unsupported:${action.key}`,
      status: "unsupported",
      reason: action.reason,
      timeoutMs: 0,
      captureBefore: false,
      captureAfter: false
    })),
    omittedActionCount
  };
}

function normalizeExecutionLimits(limits: Partial<SourceNavigationExecutionLimits>): SourceNavigationExecutionLimits {
  return {
    maxActions: normalizePositiveInteger("maxActions", limits.maxActions, DEFAULT_SOURCE_NAVIGATION_EXECUTION_LIMITS.maxActions, 50),
    perActionTimeoutMs: normalizePositiveInteger("perActionTimeoutMs", limits.perActionTimeoutMs, DEFAULT_SOURCE_NAVIGATION_EXECUTION_LIMITS.perActionTimeoutMs, 120_000),
    captureBeforeAfter: limits.captureBeforeAfter ?? DEFAULT_SOURCE_NAVIGATION_EXECUTION_LIMITS.captureBeforeAfter,
    stopOnUnsupported: limits.stopOnUnsupported ?? DEFAULT_SOURCE_NAVIGATION_EXECUTION_LIMITS.stopOnUnsupported
  };
}

function normalizePositiveInteger(name: string, value: number | undefined, fallback: number, max: number): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate <= 0 || candidate > max) {
    throw new RangeError(`${name} must be an integer between 1 and ${max}`);
  }
  return candidate;
}
