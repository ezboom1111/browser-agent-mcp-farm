import { describe, expect, it } from "vitest";
import { isBareEphemeralLease } from "../src/lease-manager.js";
import { summarizeStageTimings } from "../src/run-metrics.js";

// C3 (v0.5.0): the shared isBareEphemeralLease predicate (reused by the capture cache), and the
// cost dimension (blockedResourceCount) folded into run metrics. prewarm()/blockedResourceCount()
// on the pool are exercised by the A3 + browser-pool real-Chromium suites.

describe("isBareEphemeralLease (C3)", () => {
  const base = { storagePolicy: "ephemeral" as const, proxy: undefined, fingerprint: undefined, storageStatePath: undefined, profileName: undefined, userDataDir: undefined };

  it("is true only for a plain ephemeral lease with no identity/byte-affecting fields", () => {
    expect(isBareEphemeralLease(base)).toBe(true);
  });

  it("is false for any credentialed or customized lease (NOT 'options object empty')", () => {
    expect(isBareEphemeralLease({ ...base, storagePolicy: "storage-state" })).toBe(false);
    expect(isBareEphemeralLease({ ...base, storagePolicy: "persistent-profile" })).toBe(false);
    expect(isBareEphemeralLease({ ...base, profileName: "p" })).toBe(false);
    expect(isBareEphemeralLease({ ...base, storageStatePath: "/x" })).toBe(false);
    expect(isBareEphemeralLease({ ...base, proxy: { server: "http://p:1" } })).toBe(false);
    // a fingerprinted ephemeral lease has a non-empty options object but is NOT bare:
    expect(isBareEphemeralLease({ ...base, fingerprint: { userAgent: "UA" } })).toBe(false);
  });
});

describe("run metrics cost dimension (C3)", () => {
  const timings = [
    { stage: "browser_prewarm", durationMs: 120, status: "ok" },
    { stage: "browser_page_capture", durationMs: 40, status: "ok" }
  ];

  it("folds blockedResourceCount into the summary when provided", () => {
    const metrics = summarizeStageTimings(timings, { blockedResourceCount: 7 });
    expect(metrics.blockedResourceCount).toBe(7);
    expect(metrics.slowestStage).toEqual({ stage: "browser_prewarm", durationMs: 120 });
  });

  it("omits blockedResourceCount when not provided (back-compatible)", () => {
    const metrics = summarizeStageTimings(timings);
    expect("blockedResourceCount" in metrics).toBe(false);
  });
});
