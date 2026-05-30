import { describe, expect, it } from "vitest";

import { summarizeStageTimings } from "../src/run-metrics.js";

describe("summarizeStageTimings", () => {
  it("returns zeros and a null slowest stage for no timings", () => {
    expect(summarizeStageTimings([])).toEqual({
      stageCount: 0,
      okCount: 0,
      failedCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      p50DurationMs: 0,
      p95DurationMs: 0,
      slowestStage: null
    });
  });

  it("aggregates counts, total, percentiles, and the slowest stage", () => {
    const metrics = summarizeStageTimings([
      { stage: "setup", durationMs: 10, status: "ok" },
      { stage: "capture", durationMs: 100, status: "ok" },
      { stage: "ocr", durationMs: 40, status: "ok" },
      { stage: "claim_gate", durationMs: 25, status: "error" }
    ]);
    expect(metrics.stageCount).toBe(4);
    expect(metrics.okCount).toBe(3);
    expect(metrics.failedCount).toBe(1);
    expect(metrics.totalDurationMs).toBe(175);
    expect(metrics.maxDurationMs).toBe(100);
    expect(metrics.slowestStage).toEqual({ stage: "capture", durationMs: 100 });
    // sorted durations: [10, 25, 40, 100] -> p50 nearest-rank index ceil(.5*4)-1=1 -> 25
    expect(metrics.p50DurationMs).toBe(25);
    // p95 nearest-rank index ceil(.95*4)-1=3 -> 100
    expect(metrics.p95DurationMs).toBe(100);
  });

  it("clamps negative durations to zero", () => {
    const metrics = summarizeStageTimings([{ stage: "x", durationMs: -5, status: "ok" }]);
    expect(metrics.totalDurationMs).toBe(0);
    expect(metrics.slowestStage).toEqual({ stage: "x", durationMs: 0 });
  });
});
