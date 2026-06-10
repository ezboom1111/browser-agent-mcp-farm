import { describe, expect, it } from "vitest";

import { buildCoverageReport, formatCoverageReportAsLines, formatCoverageReportAsMarkdown, type CoverageReportInput, type CoverageReportSource, type RecipeCanaryResult } from "../src/coverage-report.js";

const NOW = "2026-05-30T00:00:00.000Z";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function source(partial: Partial<CoverageReportSource> & { platform: string }): CoverageReportSource {
  return {
    displayName: partial.platform,
    readinessStatus: "ready",
    requiresHeadedProfile: false,
    ...partial
  };
}

function canary(recipeKey: string, verdict: RecipeCanaryResult["verdict"], verifiedAt: string, missing: string[] = []): RecipeCanaryResult {
  return { recipeKey, verdict, verifiedAt, missingSelectors: missing, unexpectedObstructions: [] };
}

function report(overrides: Partial<CoverageReportInput>): ReturnType<typeof buildCoverageReport> {
  return buildCoverageReport({
    sources: [],
    maintenanceSet: [],
    freshnessWindowMs: WEEK_MS,
    now: NOW,
    ...overrides
  });
}

describe("buildCoverageReport classification", () => {
  it("classifies an official-API-backed source as api_backed (even if maintained)", () => {
    const r = report({
      sources: [source({ platform: "youtube" })],
      maintenanceSet: ["youtube"],
      apiBackedPlatforms: ["youtube"]
    });
    expect(r.entries[0]?.coverageClass).toBe("api_backed");
  });

  it("classifies a maintained source with a fresh passing canary as autonomous_ready", () => {
    const r = report({
      sources: [source({ platform: "google_search" })],
      maintenanceSet: ["google_search"],
      canaryLedger: [canary("google_search", "pass", "2026-05-29T00:00:00.000Z")]
    });
    expect(r.entries[0]?.coverageClass).toBe("autonomous_ready");
    expect(r.entries[0]?.fresh).toBe(true);
    expect(r.autonomousReadyCount).toBe(1);
  });

  it("auto-demotes a maintained source with a needs_recalibration canary to headed_only", () => {
    const r = report({
      sources: [source({ platform: "google_search" })],
      maintenanceSet: ["google_search"],
      canaryLedger: [canary("google_search", "needs_recalibration", "2026-05-29T00:00:00.000Z", ["div.g h3"])]
    });
    expect(r.entries[0]?.coverageClass).toBe("headed_only");
    expect(r.entries[0]?.reasons.join(" ")).toContain("needs_recalibration");
  });

  it("auto-demotes a maintained source with a STALE passing canary to headed_only", () => {
    const r = report({
      sources: [source({ platform: "google_search" })],
      maintenanceSet: ["google_search"],
      canaryLedger: [canary("google_search", "pass", "2026-05-01T00:00:00.000Z")]
    });
    expect(r.entries[0]?.coverageClass).toBe("headed_only");
    expect(r.entries[0]?.fresh).toBe(false);
    expect(r.entries[0]?.reasons.join(" ")).toContain("stale");
  });

  it("treats a maintained but never-canaried source as headed_only (recalibration required)", () => {
    const r = report({ sources: [source({ platform: "naver_search" })], maintenanceSet: ["naver_search"] });
    expect(r.entries[0]?.coverageClass).toBe("headed_only");
    expect(r.entries[0]?.reasons.join(" ")).toContain("never canaried");
  });

  it("classifies an unmaintained blocked source as blocked", () => {
    const r = report({ sources: [source({ platform: "x", readinessStatus: "blocked" })] });
    expect(r.entries[0]?.coverageClass).toBe("blocked");
  });

  it("classifies an unmaintained headed-profile source as headed_only", () => {
    const r = report({ sources: [source({ platform: "instagram", requiresHeadedProfile: true })] });
    expect(r.entries[0]?.coverageClass).toBe("headed_only");
  });

  it("classifies everything else as honestly unmaintained", () => {
    const r = report({ sources: [source({ platform: "some_blog" })] });
    expect(r.entries[0]?.coverageClass).toBe("unmaintained");
  });

  it("uses recipeKey (not platform) to look up the canary when provided", () => {
    const r = report({
      sources: [source({ platform: "google_search", recipeKey: "google_search/result_links" })],
      maintenanceSet: ["google_search"],
      canaryLedger: [canary("google_search/result_links", "pass", "2026-05-29T00:00:00.000Z")]
    });
    expect(r.entries[0]?.coverageClass).toBe("autonomous_ready");
  });

  it("aggregates per-class counts and the maintenance budget", () => {
    const r = report({
      sources: [source({ platform: "youtube" }), source({ platform: "google_search" }), source({ platform: "blocked_site", readinessStatus: "blocked" }), source({ platform: "blog" })],
      maintenanceSet: ["youtube", "google_search"],
      apiBackedPlatforms: ["youtube"],
      canaryLedger: [canary("google_search", "pass", "2026-05-29T00:00:00.000Z")]
    });
    expect(r.classCounts).toMatchObject({ api_backed: 1, autonomous_ready: 1, blocked: 1, unmaintained: 1 });
    expect(r.maintenanceBudget).toBe(2);
  });
});

describe("coverage report formatters", () => {
  const r = report({
    sources: [source({ platform: "google_search", displayName: "Google" })],
    maintenanceSet: ["google_search"],
    canaryLedger: [canary("google_search", "pass", "2026-05-29T00:00:00.000Z")]
  });

  it("renders a lines summary with class counts", () => {
    const out = formatCoverageReportAsLines(r);
    expect(out).toContain("coverage-report");
    expect(out).toContain("autonomous_ready=1");
    expect(out).toContain("google_search");
  });

  it("renders a markdown table", () => {
    const out = formatCoverageReportAsMarkdown(r);
    expect(out).toContain("# Coverage Report");
    expect(out).toContain("| autonomous_ready | 1 |");
    expect(out).toContain("Google");
  });
});
