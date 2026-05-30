import { describe, expect, it } from "vitest";

import { formatAcquisitionRoutesAsLines, routeAcquisition, routeCoverageReport } from "../src/acquisition-router.js";
import type { CoverageClass, CoverageReport, CoverageReportEntry } from "../src/coverage-report.js";

function entry(coverageClass: CoverageClass, platform = "p"): CoverageReportEntry {
  return { platform, displayName: platform, coverageClass, inMaintenanceSet: false, fresh: false, reasons: [] };
}

describe("routeAcquisition", () => {
  it("routes api_backed to official_api first", () => {
    const route = routeAcquisition(entry("api_backed", "youtube"));
    expect(route.recommended).toBe("official_api");
    expect(route.tiers[0]).toBe("official_api");
  });

  it("routes autonomous_ready to feed first", () => {
    expect(routeAcquisition(entry("autonomous_ready")).recommended).toBe("feed");
  });

  it("routes headed_only to profile then headed", () => {
    const route = routeAcquisition(entry("headed_only"));
    expect(route.recommended).toBe("profile");
    expect(route.tiers).toContain("headed");
  });

  it("routes a blocked source to byo_capture as the only resort", () => {
    const route = routeAcquisition(entry("blocked"));
    expect(route.recommended).toBe("byo_capture");
    expect(route.tiers).toEqual(["byo_capture"]);
  });

  it("ends every route in byo_capture (the universal fallback)", () => {
    const classes: CoverageClass[] = ["api_backed", "autonomous_ready", "headed_only", "unmaintained", "blocked"];
    for (const coverageClass of classes) {
      expect(routeAcquisition(entry(coverageClass)).tiers.at(-1)).toBe("byo_capture");
    }
  });
});

describe("routeCoverageReport + formatter", () => {
  it("maps a report to routes and renders lines", () => {
    const report = {
      schemaVersion: "1.0",
      generatedAt: "t",
      freshnessWindowMs: 0,
      maintenanceBudget: 0,
      classCounts: {},
      autonomousReadyCount: 0,
      entries: [entry("blocked", "instagram"), entry("api_backed", "youtube")]
    } as unknown as CoverageReport;

    const routes = routeCoverageReport(report);
    expect(routes).toHaveLength(2);
    const out = formatAcquisitionRoutesAsLines(routes);
    expect(out).toContain("acquisition routes");
    expect(out).toContain("byo_capture");
    expect(out).toContain("youtube");
  });
});
