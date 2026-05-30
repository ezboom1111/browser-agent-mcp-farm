import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildSourceCoverageReadinessAudit,
  buildSourceCoverageReadinessRetryPlan
} from "../src/source-coverage-readiness.js";
import type { SourceNavigationPromotionSummary } from "../src/source-navigation-promotion.js";
import type { SourceFamily, SourcePlatform } from "../src/source-strategy.js";
import { runCli, trackTempDirs } from "./helpers/cli-harness.js";

const { dirs, cleanup, makeTempDir } = trackTempDirs();
afterEach(cleanup);

// --- Local offline fixtures (replicated from tests/source-coverage-readiness.test.ts;
// self-contained per the harness contract — never import from another *.test.ts). ---

function promotionSummary(groups: SourceNavigationPromotionSummary["groups"]): SourceNavigationPromotionSummary {
  return {
    schemaVersion: "1.0",
    executionPolicy: "explicit_opt_in_only",
    outputDir: "C:\\promotion",
    groupCount: groups.length,
    readyGroupCount: groups.filter((group) => group.status === "ready").length,
    emptyGroupCount: groups.filter((group) => group.status === "empty").length,
    actionFileCount: groups.length,
    groups,
    warnings: []
  };
}

function promotionGroup(
  platform: SourcePlatform,
  sourceFamily: SourceFamily,
  status: SourceNavigationPromotionSummary["groups"][number]["status"],
  actionCount: number,
  summary: Partial<SourceNavigationPromotionSummary["groups"][number]["catalogSummary"]>
): SourceNavigationPromotionSummary["groups"][number] {
  return {
    platform,
    sourceFamily,
    url: `https://example.test/${platform}`,
    runDirs: [],
    status,
    actionCount,
    catalogSummary: {
      entryCount: 4,
      calibrationReportCount: 0,
      skippedCalibrationReportCount: 0,
      maintainedRecipeReadyCount: 0,
      singleRunReadyCount: 0,
      manualReviewCount: 0,
      manualValueCount: 0,
      calibrationRequiredCount: 4,
      blockedCount: 0,
      notSupportedCount: 0,
      recommendedActionCount: 0,
      maintainedDefaultReadyCount: 0,
      minimumCalibrationRunsRequired: 2,
      ...summary
    },
    files: {
      catalog: `C:\\promotion\\${platform}\\catalog.json`,
      export: `C:\\promotion\\${platform}\\export.json`,
      actions: `C:\\promotion\\${platform}\\actions.json`
    },
    warnings: []
  };
}

// Builds a non-empty profile/headed retry plan offline (no Chromium, no network, no
// promotion-summary parsing) and writes its JSON to a temp file. A single blocked
// google_search/search group in the ko-KR top-slot scope yields exactly one retry item
// with priority "top_slot_blocked". An optional selectorHints path is attached so the
// --check-files / --only-check-ok cases can exercise selector-hint existence checks.
async function writeRetryPlanFile(options?: { selectorHints?: string }): Promise<string> {
  const googleGroup = promotionGroup("google_search", "search", "empty", 0, {
    calibrationReportCount: 2,
    calibrationRequiredCount: 0,
    blockedCount: 1
  });
  if (options?.selectorHints !== undefined) {
    googleGroup.files.selectorHints = options.selectorHints;
  }
  googleGroup.blockedSignalCounts = [
    { signal: "captcha-delivery.com", count: 7, actionKeys: ["result-selection"] }
  ];
  const audit = buildSourceCoverageReadinessAudit({
    category: "search",
    locale: "ko-KR",
    query: "seoul hotel",
    promotionSummaries: [promotionSummary([googleGroup])]
  });
  const plan = buildSourceCoverageReadinessRetryPlan(audit);
  const dir = await makeTempDir("farm-cli-retry-plan-");
  const file = join(dir, "profile-headed-retry-plan.json");
  await writeFile(file, JSON.stringify(plan, null, 2), "utf8");
  return file;
}

describe("source-coverage-calibrate (in-process, plan-only / dry-run / arg validation)", () => {
  it("--plan-only writes offline plan files and reports plan_only mode (ok=true)", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "farm-cli-calib-"));
    dirs.push(runRoot);
    const { out, exitCode } = await runCli([
      "source-coverage-calibrate",
      "--category", "search",
      "--locale", "ko-KR",
      "--query", "seoul hotel",
      "--plan-only",
      "--run-root", runRoot
    ]);
    expect(out).toContain('"mode": "plan_only"');
    expect(out).toContain('"ok": true');
    expect(out).toContain('"executionPolicy": "readiness_guided_read_only_calibration_loop"');
    expect(out).toContain('"executionPolicy": "coverage_readiness_audit_only"');
    expect(out).toContain('"query": "seoul hotel"');
    expect(out).toContain('"targetCount": 3');
    expect(out).toContain("profile-headed-retry-plan.json");
    expect(exitCode).toBeFalsy();
  });

  it("--plan-only --fail-not-ready exits 1 when actionable slots are not ready", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "farm-cli-calib-fnr-"));
    dirs.push(runRoot);
    const { out, exitCode } = await runCli([
      "source-coverage-calibrate",
      "--category", "search",
      "--locale", "ko-KR",
      "--plan-only",
      "--fail-not-ready",
      "--run-root", runRoot
    ]);
    expect(out).toContain('"mode": "plan_only"');
    expect(out).toContain('"ok": false');
    expect(exitCode).toBe(1);
  });

  it("--dry-run produces the same offline plan_only output as --plan-only", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "farm-cli-calib-dry-"));
    dirs.push(runRoot);
    const { out, exitCode } = await runCli([
      "source-coverage-calibrate",
      "--platform", "naver_search",
      "--dry-run",
      "--run-root", runRoot
    ]);
    expect(out).toContain('"mode": "plan_only"');
    expect(exitCode).toBeFalsy();
  });

  it("rejects --calibration-concurrency > 1 with --persistent-profile (arg validation throw)", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-calibrate",
      "--category", "search",
      "--calibration-concurrency", "2",
      "--profile", "p1",
      "--persistent-profile",
      "--plan-only"
    ]);
    expect(out).toContain("--calibration-concurrency must be 1 when --persistent-profile is used");
    expect(exitCode).toBe(1);
  });
});

describe("source-coverage-retry-plan (in-process render/check/command branches)", () => {
  let rp: string;

  beforeEach(async () => {
    rp = await writeRetryPlanFile();
  });

  it("default json format round-trips a generated retry-plan file", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp,
      "--format", "json"
    ]);
    expect(out).toContain('"ok": true');
    expect(out).toContain('"executionPolicy": "profile_headed_retry_plan_only"');
    expect(out).toContain('"itemCount": 1');
    expect(out).toContain('"platform": "google_search"');
    expect(out).toContain('"priority": "top_slot_blocked"');
    expect(exitCode).toBeFalsy();
  });

  it("renders markdown with the retry-plan header and the first item heading", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp,
      "--format", "markdown"
    ]);
    expect(out).toContain("# Source Coverage Profile/Headed Retry Plan");
    expect(out).toContain("## 1. Google Search (google_search)");
    expect(exitCode).toBeFalsy();
  });

  it("--format check reports ok with zero errors for a clean plan", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp,
      "--format", "check"
    ]);
    expect(out).toContain('"ok": true');
    expect(out).toContain('"errorCount": 0');
    expect(out).toContain('"itemCount": 1');
    expect(exitCode).toBeFalsy();
  });

  it("--format retry-commands emits only the calibrate retry command (no setup)", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp,
      "--format", "retry-commands"
    ]);
    expect(out).toContain("source-coverage-calibrate --platform 'google_search'");
    expect(out).not.toContain("auth-login");
    expect(exitCode).toBeFalsy();
  });

  it("--format setup-commands emits only the auth-login setup command (no retry)", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp,
      "--format", "setup-commands"
    ]);
    expect(out).toContain("auth-login --profile");
    expect(out).not.toContain("source-coverage-calibrate --platform");
    expect(exitCode).toBeFalsy();
  });

  it("--format commands emits both setup and retry commands", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp,
      "--format", "commands"
    ]);
    expect(out).toContain("auth-login");
    expect(out).toContain("source-coverage-calibrate --platform 'google_search'");
    expect(exitCode).toBeFalsy();
  });

  it("--platform filter + --fail-empty exits 1 on empty result", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp,
      "--platform", "daum_search",
      "--fail-empty",
      "--format", "json"
    ]);
    expect(out).toContain('"itemCount": 0');
    expect(exitCode).toBe(1);
  });

  it("--format check --check-profiles --fail-check exits 1 when the saved profile is absent", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp,
      "--format", "check",
      "--check-profiles",
      "--fail-check"
    ]);
    expect(out).toContain('"ok": false');
    expect(out).toContain("profile_missing");
    expect(exitCode).toBe(1);
  });

  it("errors when --retry-plan is missing", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--format", "json"
    ]);
    expect(out).toContain("source-coverage-retry-plan requires --retry-plan");
    expect(exitCode).toBe(1);
  });

  it("rejects an unknown --format", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp,
      "--format", "bogus"
    ]);
    expect(out).toContain(
      "--format must be json, check, markdown, commands, setup-commands, or retry-commands for source-coverage-retry-plan"
    );
    expect(exitCode).toBe(1);
  });

  it("rejects an invalid --priority value", async () => {
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp,
      "--priority", "nope"
    ]);
    expect(out).toContain("--priority must be top_slot_blocked or blocked for source-coverage-retry-plan");
    expect(exitCode).toBe(1);
  });

  it("--output-file writes rendered output to disk instead of stdout", async () => {
    const outDir = await makeTempDir("farm-cli-retry-out-");
    const outFile = join(outDir, "handoff.md");
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp,
      "--format", "markdown",
      "--output-file", outFile
    ]);
    const written = await readFile(outFile, "utf8");
    expect(written).toContain("# Source Coverage Profile/Headed Retry Plan");
    expect(out).not.toContain("# Source Coverage Profile/Headed Retry Plan");
    expect(exitCode).toBeFalsy();
  });
});

describe("source-coverage-retry-plan selector-hint file checks (read-only existsSync)", () => {
  it("--check-files reports selector_hint_file_missing for an absent hint file", async () => {
    const missingHints = join(await makeTempDir("farm-cli-hints-"), "missing-selector-hints.tsv");
    const rp2 = await writeRetryPlanFile({ selectorHints: missingHints });
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp2,
      "--format", "check",
      "--check-files"
    ]);
    expect(out).toContain('"ok": false');
    expect(out).toContain("selector_hint_file_missing");
    expect(exitCode).toBeFalsy();
  });

  it("--only-check-ok drops the failing item before render", async () => {
    const missingHints = join(await makeTempDir("farm-cli-hints-"), "missing-selector-hints.tsv");
    const rp2 = await writeRetryPlanFile({ selectorHints: missingHints });
    const { out, exitCode } = await runCli([
      "source-coverage-retry-plan",
      "--retry-plan", rp2,
      "--only-check-ok",
      "--check-files",
      "--format", "json"
    ]);
    expect(out).toContain('"itemCount": 0');
    expect(out).toContain("Retry plan check filter removed 1 item(s) with preflight errors.");
    expect(exitCode).toBeFalsy();
  });
});
