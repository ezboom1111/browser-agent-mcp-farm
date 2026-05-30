import { describe, expect, it } from "vitest";
import { analyzeSceneChanges, buildDenseTimestampPlan, buildTimestampPlan, detectSceneChangeHits, formatTimestampForFile, frameCaptureId, type FrameSample } from "../src/frame-sampler.js";

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

  it("builds capped dense timestamp plans around hits", () => {
    const plan = buildDenseTimestampPlan({
      baseTimestampsSec: [0, 10],
      hitTimestampsSec: [10, 11],
      durationSec: 20,
      windowSec: 2,
      stepSec: 1,
      maxDenseFrames: 4
    });

    expect(plan.denseTimestampsSec).toEqual([8, 9, 10, 11]);
    expect(plan.timestampsSec).toEqual([0, 8, 9, 10, 11]);
    expect(plan.capped).toBe(true);
    expect(plan.omittedCount).toBeGreaterThan(0);
  });

  it("detects scene-change hit midpoints from visual fingerprints", () => {
    const hits = detectSceneChangeHits({
      frames: [frameWithHash(0, "00000000"), frameWithHash(10, "11111111"), frameWithHash(20, "11111111")],
      minDistance: 4
    });

    expect(hits).toEqual([
      {
        fromTimestampSec: 0,
        toTimestampSec: 10,
        midpointSec: 5,
        distance: 8
      }
    ]);
  });

  it("reports scene-change distance diagnostics for threshold tuning", () => {
    const result = analyzeSceneChanges({
      frames: [frameWithHash(0, "00000000"), frameWithHash(10, "00001111"), frameWithHash(20, "11110000"), frameWithUnavailableFingerprint(30)],
      minDistance: 6,
      maxHits: 1
    });

    expect(result.hits).toEqual([
      expect.objectContaining({
        fromTimestampSec: 10,
        toTimestampSec: 20,
        midpointSec: 15,
        distance: 8
      })
    ]);
    expect(result.diagnostics).toMatchObject({
      threshold: 6,
      maxHits: 1,
      comparableFrameCount: 3,
      ignoredFrameCount: 1,
      uniqueFingerprintCount: 3,
      comparablePairCount: 2,
      zeroDistancePairCount: 0,
      candidateCount: 1,
      selectedHitCount: 1,
      omittedHitCount: 0,
      nearThresholdBand: 2,
      nearThresholdBelowCount: 1,
      nearThresholdAboveCount: 1,
      minObservedDistance: 4,
      maxObservedDistance: 8,
      averageObservedDistance: 6,
      pairGapMinSec: 10,
      pairGapMaxSec: 10,
      pairGapAverageSec: 10,
      distanceP50: 4,
      distanceP90: 8,
      distanceP95: 8,
      selectedDistanceMin: 8,
      selectedDistanceMax: 8,
      thresholdRecommendation: "review_near_miss",
      recommendedThreshold: 4,
      samplingDensityStatus: "ok",
      recommendedMaxPairGapSec: 30,
      nearestBelowThreshold: expect.objectContaining({
        fromTimestampSec: 0,
        toTimestampSec: 10,
        distance: 4
      })
    });
  });

  it("recommends lowering scene-change threshold when no pair currently qualifies", () => {
    const result = analyzeSceneChanges({
      frames: [frameWithHash(0, "00000000"), frameWithHash(10, "00001111"), frameWithHash(20, "00011111")],
      minDistance: 7
    });

    expect(result.hits).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      threshold: 7,
      maxObservedDistance: 4,
      selectedHitCount: 0,
      nearThresholdBand: 2,
      nearThresholdBelowCount: 0,
      nearThresholdAboveCount: 0,
      thresholdRecommendation: "lower_threshold",
      recommendedThreshold: 4
    });
    expect(result.diagnostics.thresholdRecommendationReason).toContain("No adjacent frame pair met");
  });

  it("recommends raising scene-change threshold when candidates exceed max hits", () => {
    const result = analyzeSceneChanges({
      frames: [frameWithHash(0, "00000000"), frameWithHash(10, "11111111"), frameWithHash(20, "00000011"), frameWithHash(30, "11110011")],
      minDistance: 4,
      maxHits: 1
    });

    expect(result.hits).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({
      threshold: 4,
      candidateCount: 3,
      selectedHitCount: 1,
      omittedHitCount: 2,
      nearThresholdBand: 2,
      nearThresholdBelowCount: 0,
      nearThresholdAboveCount: 2,
      thresholdRecommendation: "raise_threshold",
      recommendedThreshold: 7
    });
    expect(result.diagnostics.thresholdRecommendationReason).toContain("More scene-change candidates");
  });

  it("reports pair gaps and selected hit spacing for sparse media sampling", () => {
    const result = analyzeSceneChanges({
      frames: [frameWithHash(0, "00000000"), frameWithHash(10, "11111111"), frameWithHash(20, "00000000"), frameWithHash(60, "11110000"), frameWithHash(90, "11111111")],
      minDistance: 4,
      maxHits: 4
    });

    expect(result.hits.map((hit) => hit.midpointSec)).toEqual([5, 15, 40, 75]);
    expect(result.diagnostics).toMatchObject({
      pairGapMinSec: 10,
      pairGapMaxSec: 40,
      pairGapAverageSec: 22.5,
      selectedHitSpacingMinSec: 10,
      selectedHitSpacingMaxSec: 35,
      nearThresholdAboveCount: 2,
      samplingDensityStatus: "sparse_pairs",
      recommendedMaxPairGapSec: 30
    });
    expect(result.diagnostics.samplingDensityReason).toContain("Largest adjacent frame gap is 40s");
  });

  it("reports stable-frame distribution diagnostics for real media tuning", () => {
    const result = analyzeSceneChanges({
      frames: [frameWithHash(0, "00000000"), frameWithHash(5, "00000000"), frameWithHash(10, "00000001"), frameWithHash(15, "00000011"), frameWithHash(20, "11111111")],
      minDistance: 4,
      maxHits: 3
    });

    expect(result.diagnostics).toMatchObject({
      comparableFrameCount: 5,
      uniqueFingerprintCount: 4,
      comparablePairCount: 4,
      zeroDistancePairCount: 1,
      minObservedDistance: 0,
      maxObservedDistance: 6,
      averageObservedDistance: 2,
      pairGapMinSec: 5,
      pairGapMaxSec: 5,
      pairGapAverageSec: 5,
      nearThresholdBand: 2,
      nearThresholdBelowCount: 0,
      nearThresholdAboveCount: 1,
      distanceP50: 1,
      distanceP90: 6,
      distanceP95: 6,
      samplingDensityStatus: "ok",
      recommendedMaxPairGapSec: 30
    });
  });

  it("reports insufficient scene-change sampling density when too few comparable pairs exist", () => {
    const result = analyzeSceneChanges({
      frames: [frameWithHash(0, "00000000"), frameWithHash(15, "00001111")],
      minDistance: 4
    });

    expect(result.diagnostics).toMatchObject({
      comparablePairCount: 1,
      samplingDensityStatus: "insufficient_data"
    });
    expect(result.diagnostics.samplingDensityReason).toContain("Fewer than two comparable frame pairs");
  });
});

function frameWithHash(timestampSec: number, hash: string): FrameSample {
  return {
    ordinal: timestampSec + 1,
    timestampSec,
    captureId: `frame-${timestampSec}`,
    status: "ok",
    seek: { ok: true, requestedTimestampSec: timestampSec },
    activeCues: [],
    visualFingerprint: {
      status: "ok",
      sampleSize: hash.length,
      hash
    },
    records: []
  };
}

function frameWithUnavailableFingerprint(timestampSec: number): FrameSample {
  return {
    ordinal: timestampSec + 1,
    timestampSec,
    captureId: `frame-${timestampSec}`,
    status: "ok",
    seek: { ok: true, requestedTimestampSec: timestampSec },
    activeCues: [],
    visualFingerprint: {
      status: "unavailable",
      sampleSize: 64,
      reason: "fixture"
    },
    records: []
  };
}
