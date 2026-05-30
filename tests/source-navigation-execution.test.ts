import { describe, expect, it } from "vitest";
import {
  buildSourceNavigationExecutionPlan,
  DEFAULT_SOURCE_NAVIGATION_EXECUTION_LIMITS
} from "../src/source-navigation-execution.js";
import { describeSourceNavigationPlan } from "../src/source-navigation.js";
import { describeSourceStrategy } from "../src/source-strategy.js";

describe("buildSourceNavigationExecutionPlan", () => {
  it("turns a navigation plan into bounded pending action steps", () => {
    const navigationPlan = planFor("https://www.google.com/search?q=ramen");
    const executionPlan = buildSourceNavigationExecutionPlan(navigationPlan);

    expect(executionPlan).toMatchObject({
      schemaVersion: "1.0",
      sourcePlan: {
        platform: "google_search",
        sourceFamily: "search",
        mode: "plan_only"
      },
      limits: DEFAULT_SOURCE_NAVIGATION_EXECUTION_LIMITS,
      omittedActionCount: 0
    });
    expect(executionPlan.steps).toHaveLength(navigationPlan.plannedActions.length);
    expect(executionPlan.steps[0]).toMatchObject({
      key: "action:query-state",
      actionKey: "query-state",
      kind: "set_query",
      status: "pending",
      captureBefore: true,
      captureAfter: true,
      timeoutMs: 10_000
    });
  });

  it("caps planned actions before execution", () => {
    const navigationPlan = planFor("https://www.agoda.com/hotel/example.html");
    const executionPlan = buildSourceNavigationExecutionPlan(navigationPlan, { maxActions: 2, perActionTimeoutMs: 1_500 });

    expect(executionPlan.steps).toHaveLength(2);
    expect(executionPlan.omittedActionCount).toBe(navigationPlan.plannedActions.length - 2);
    expect(executionPlan.steps.every((step) => step.timeoutMs === 1_500)).toBe(true);
  });

  it("preserves unsupported actions as non-executable steps", () => {
    const navigationPlan = planFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const executionPlan = buildSourceNavigationExecutionPlan(navigationPlan);

    expect(executionPlan.unsupportedSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "unsupported:raw-stream-download", status: "unsupported" }),
      expect.objectContaining({ key: "unsupported:gate-bypass", status: "unsupported" }),
      expect.objectContaining({ key: "unsupported:social-write", status: "unsupported" })
    ]));
    expect(executionPlan.unsupportedSteps.every((step) => !step.captureBefore && !step.captureAfter)).toBe(true);
  });

  it("validates execution limits", () => {
    const navigationPlan = planFor("https://example.com/");

    expect(() => buildSourceNavigationExecutionPlan(navigationPlan, { maxActions: 0 })).toThrow(/maxActions/);
    expect(() => buildSourceNavigationExecutionPlan(navigationPlan, { perActionTimeoutMs: 120_001 })).toThrow(/perActionTimeoutMs/);
  });
});

function planFor(url: string) {
  return describeSourceNavigationPlan({ sourceStrategy: describeSourceStrategy(url) });
}
