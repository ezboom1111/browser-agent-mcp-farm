import { describe, expect, it } from "vitest";
import { buildTimestampPlan, formatTimestampForFile, frameCaptureId } from "../src/frame-sampler.js";

describe("frame sampler timestamp planning", () => {
  it("builds bounded default timestamps for short videos", () => {
    expect(buildTimestampPlan({ durationSec: 20 }).timestampsSec).toEqual([0, 10, 20]);
    expect(buildTimestampPlan({ durationSec: 40 }).timestampsSec).toEqual([0, 10, 30, 40]);
  });

  it("caps long-video plans explicitly", () => {
    const plan = buildTimestampPlan({ durationSec: 400, maxFrames: 5 });

    expect(plan.timestampsSec).toEqual([0, 10, 30, 60, 120]);
    expect(plan.capped).toBe(true);
    expect(plan.omittedCount).toBeGreaterThan(0);
  });

  it("normalizes explicit timestamps and formats frame IDs", () => {
    const plan = buildTimestampPlan({ durationSec: 12, timestampsSec: [10, 0, 10, 12.345, 15, -1] });

    expect(plan.source).toBe("explicit");
    expect(plan.timestampsSec).toEqual([0, 10]);
    expect(formatTimestampForFile(12.25)).toBe("000012s250ms");
    expect(frameCaptureId("sample", 2, 10)).toBe("sample-frame-002-000010s");
  });
});
