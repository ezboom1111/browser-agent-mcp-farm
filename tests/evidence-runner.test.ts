import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { runEvidenceWorkflow } from "../src/evidence-runner.js";
import type { OcrWorker } from "../src/ocr.js";
import { profilePaths } from "../src/profile-store.js";

let runDirs: string[] = [];

describe("runEvidenceWorkflow", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("registers a structured_data artifact when the page exposes JSON-LD", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);
    if (!executableAvailable) {
      console.warn("Skipping structured extraction test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-structured-run-"));
    runDirs.push(runDir);
    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/structured`,
        runDir,
        captureId: "structured-evidence",
        sampleFrames: false,
        waitMs: 0,
        finalClaimGate: false
      });
      expect(result.ok).toBe(true);

      const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
      const rows = ledger
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as { evidence_kind?: string; kind?: string; path?: string });
      const structured = rows.find((row) => row.evidence_kind === "structured_data" && row.kind === "text");
      expect(structured).toBeDefined();
      if (structured?.path !== undefined) {
        const parsed = JSON.parse(await readFile(join(runDir, structured.path), "utf8")) as {
          summary?: { price?: { value?: string } };
          crossCheck?: Array<{ field?: string; corroborated?: boolean }>;
        };
        expect(parsed.summary?.price?.value).toBe("4500");
        // The runner cross-checks the site-claim price against the captured visible
        // text; the fixture body has no visible price, so it must flag uncorroborated.
        const priceCheck = parsed.crossCheck?.find((entry) => entry.field === "price.value");
        expect(priceCheck?.corroborated).toBe(false);
      }

      // The run persists a per-run metrics.json observability sidecar.
      const metrics = JSON.parse(await readFile(join(runDir, "metrics.json"), "utf8")) as {
        stageCount?: number;
        slowestStage?: { stage?: string } | null;
      };
      expect(metrics.stageCount ?? 0).toBeGreaterThan(0);
      expect(metrics.slowestStage?.stage).toBeTruthy();
    } finally {
      await fixture.close();
    }
  });

  it("creates page, frame, claim, citation, report, and final gate artifacts", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping evidence workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-run-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/video`,
        runDir,
        captureId: "fixture-evidence",
        timestampsSec: [0, 10],
        maxFrames: 2,
        waitMs: 0,
        seekTimeoutMs: 1_000,
        settleMs: 10
      });

      expect(result.ok).toBe(true);
      expect(result.claimGate?.ok).toBe(true);
      expect(result.claims).toHaveLength(4);
      expect(result.sourceStrategy).toMatchObject({ platform: "generic", sourceFamily: "generic_web" });
      expect(result.sourceStrategyRecords.some((record) => record.evidence_kind === "source_strategy")).toBe(true);
      expect(result.sourceRegistry).toMatchObject({ matchReason: "platform" });
      expect(result.sourceRegistryRecords.some((record) => record.evidence_kind === "source_registry")).toBe(true);
      expect(result.assessment.sourceRegistry).toMatchObject({
        matchReason: "platform",
        matchedEntryCount: 1,
        platforms: ["generic"]
      });
      expect(result.sourceNavigationPlan).toMatchObject({ platform: "generic", sourceFamily: "generic_web", mode: "plan_only" });
      expect(result.sourceNavigationPlanRecords.some((record) => record.evidence_kind === "source_navigation_plan")).toBe(true);
      expect(result.sourceNavigationExecutionPlan).toMatchObject({
        sourcePlan: { platform: "generic", sourceFamily: "generic_web", mode: "plan_only" }
      });
      expect(result.sourceNavigationExecutionPlanRecords.some((record) => record.evidence_kind === "source_navigation_execution_plan")).toBe(true);
      expect(result.sourceNavigationRecipePlan).toMatchObject({
        platform: "generic",
        sourceFamily: "generic_web",
        executionPolicy: "manual_opt_in_only"
      });
      expect(result.sourceNavigationRecipePlanRecords.some((record) => record.evidence_kind === "source_navigation_recipe_plan")).toBe(true);
      expect(result.assessment.sourceNavigationPlan).toMatchObject({
        mode: "plan_only",
        platform: "generic",
        sourceFamily: "generic_web",
        unsupportedActionCount: 1
      });
      expect(result.assessment.sourceNavigationExecutionPlan).toMatchObject({
        platform: "generic",
        sourceFamily: "generic_web",
        actionStepCount: 4,
        unsupportedStepCount: 1
      });
      expect(result.assessment.sourceNavigationRecipePlan).toMatchObject({
        executionPolicy: "manual_opt_in_only",
        manualOnly: true
      });
      expect(result.assessment.frameSampling.status).toBe("ok");
      expect(result.frameRecords.some((record) => record.kind === "screenshot")).toBe(true);
      expect(result.stageTimings.map((timing) => timing.stage)).toEqual(expect.arrayContaining([
        "setup",
        "platform_capability_artifact",
        "source_registry_artifact",
        "source_navigation_plan_artifact",
        "source_navigation_execution_plan_artifact",
        "source_navigation_recipe_plan_artifact",
        "browser_open_page",
        "browser_page_capture",
        "frame_sampling",
        "claim_gate"
      ]));
      expect(result.stageTimings.every((timing) => timing.durationMs >= 0)).toBe(true);

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Transcript verified in this run: false");
      expect(report).toContain("Audio verified: false");
      expect(report).toContain("Source registry: platform");
      expect(report).toContain("Source navigation plan: plan_only");
      expect(report).toContain("Source navigation execution plan: 4 action steps");
      expect(report).toContain("Source navigation recipe plan: manual_opt_in_only");
      expect(report).toContain("## Stage Timings");
      expect(report).toContain("browser_page_capture");

      const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
      expect(ledger).toContain("\"tool_name\":\"platform_capabilities\"");
      expect(ledger).toContain("\"tool_name\":\"source_registry\"");
      expect(ledger).toContain("\"tool_name\":\"source_navigation_plan\"");
      expect(ledger).toContain("\"tool_name\":\"source_navigation_execution_plan\"");
      expect(ledger).toContain("\"tool_name\":\"source_navigation_recipe_plan\"");
      expect(ledger).toContain("\"tool_name\":\"farm_sample_frames\"");
      expect(ledger).toContain("\"tool_name\":\"evidence_run\"");

      const claims = await readFile(join(runDir, "claims.jsonl"), "utf8");
      const citations = await readFile(join(runDir, "citations.jsonl"), "utf8");
      expect(claims.split(/\r?\n/).filter(Boolean)).toHaveLength(4);
      expect(citations.split(/\r?\n/).filter(Boolean)).toHaveLength(4);
    } finally {
      await fixture.close();
    }
  });

  it("executes explicit source navigation recipes before final page capture", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping source navigation workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-source-nav-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation`,
        runDir,
        captureId: "fixture-source-nav",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            { actionKey: "page-capture", operation: "capture" },
            { actionKey: "bounded-scroll", operation: "scroll", direction: "bottom" }
          ],
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.sourceNavigationPlan.mode).toBe("safe_execute");
      expect(result.assessment.sourceNavigationExecution).toMatchObject({
        enabled: true,
        status: "partial",
        executedActionCount: 2,
        skippedActionCount: 2,
        unsupportedActionCount: 1,
        failedActionCount: 0
      });
      expect(result.sourceNavigationActionRecords.some((record) => record.evidence_kind === "source_navigation_action")).toBe(true);
      expect(result.stageTimings.map((timing) => timing.stage)).toContain("source_navigation_execution");

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Source navigation plan: safe_execute");
      expect(report).toContain("Source navigation execution: partial, executed 2");

      const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
      expect(ledger).toContain("\"tool_name\":\"farm_source_navigation_execute\"");
      const textRecord = result.pageCaptureRecords.find((record) => record.kind === "text");
      expect(textRecord).toBeDefined();
      const text = await readFile(join(runDir, textRecord?.path ?? ""), "utf8");
      expect(text).toContain("navigation fixture");
      expect(text).toContain("bottom marker");
    } finally {
      await fixture.close();
    }
  });

  it("runs read-only source navigation calibration during evidence-run when requested", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping source navigation calibration workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-source-nav-calibration-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation`,
        runDir,
        captureId: "fixture-source-nav-calibration",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: false,
          calibrate: true,
          calibrationSelectorTimeoutMs: 1_000,
          actions: []
        }
      });

      expect(result.ok).toBe(true);
      expect(result.sourceNavigationPlan.mode).toBe("plan_only");
      expect(result.assessment.sourceNavigationCalibration).toMatchObject({
        enabled: true,
        status: "ok",
        calibrationArtifactRecords: 2
      });
      expect(result.assessment.sourceNavigationCalibration.summary?.matchedSelectorCount).toBeGreaterThanOrEqual(2);
      expect(result.sourceNavigationCalibrationRecords.some((record) => record.evidence_kind === "source_navigation_calibration")).toBe(true);
      expect(result.stageTimings.map((timing) => timing.stage)).toEqual(expect.arrayContaining([
        "source_navigation_calibration",
        "source_navigation_calibration_artifact"
      ]));

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Source navigation calibration: ok");

      const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
      expect(ledger).toContain("\"tool_name\":\"source_navigation_calibration\"");
    } finally {
      await fixture.close();
    }
  });

  it("runs explicit source navigation destination follow-ups as child evidence runs", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping source navigation follow-up workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-source-nav-followup-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation`,
        runDir,
        captureId: "fixture-source-nav-followup",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            { actionKey: "destination-followup", operation: "follow_up", selector: "#destination-link", captureId: "fixture-destination" }
          ],
          maxFollowUps: 1,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.sourceNavigationFollowUps).toMatchObject({
        requestedCount: 1,
        attemptedCount: 1,
        completedCount: 1,
        failedCount: 0,
        omittedCount: 0
      });
      expect(result.sourceNavigationActionRecords.some((record) => record.evidence_kind === "source_navigation_action")).toBe(true);
      expect(result.sourceNavigationFollowUpRecords.some((record) => record.evidence_kind === "source_navigation_followup")).toBe(true);
      expect(result.destinationCandidateRecords.some((record) => record.evidence_kind === "destination_candidate")).toBe(true);
      expect(result.destinationTriageRecords.some((record) => record.evidence_kind === "destination_triage")).toBe(true);
      expect(result.assessment.destinationTriage).toMatchObject({
        status: "selected",
        candidateCount: 1,
        selectedCount: 1,
        rejectedCount: 0,
        usefulCount: 1
      });
      expect(result.stageTimings.map((timing) => timing.stage)).toContain("source_navigation_followups");

      const followUp = result.assessment.sourceNavigationFollowUps.results[0];
      expect(followUp?.url).toBe(`${fixture.baseUrl}/destination`);
      expect(followUp?.reportPath).toBeDefined();
      const followUpReport = await readFile(followUp?.reportPath ?? "", "utf8");
      expect(followUpReport).toContain(`${fixture.baseUrl}/destination`);

      const followUpLedger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
      expect(followUpLedger).toContain("\"tool_name\":\"source_navigation_followup\"");
      expect(followUpLedger).toContain("\"tool_name\":\"destination_candidate\"");
      expect(followUpLedger).toContain("\"tool_name\":\"destination_triage\"");
      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Source navigation follow-ups: requested 1, attempted 1, completed 1, failed 0, omitted 0");
      expect(report).toContain("Destination triage: selected, candidates 1, selected 1, rejected 0");
    } finally {
      await fixture.close();
    }
  });

  it("does not reuse an active parent profile for child destination follow-ups", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping profiled source navigation follow-up workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-profiled-followup-"));
    const profileName = `test-followup-profile-${process.pid}-${Date.now()}`;
    runDirs.push(runDir, profilePaths(profileName).root);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation`,
        runDir,
        captureId: "fixture-profiled-followup",
        waitMs: 0,
        sampleFrames: false,
        profileName,
        storagePolicy: "storage-state",
        sourceNavigation: {
          enabled: true,
          actions: [
            { actionKey: "destination-followup", operation: "follow_up", selector: "#destination-link", captureId: "fixture-profiled-destination" }
          ],
          maxFollowUps: 1,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      const followUp = result.assessment.sourceNavigationFollowUps.results[0];
      expect(result.ok).toBe(true);
      expect(followUp?.status).toBe("ok");
      expect(followUp?.childEvidence?.browserCaptureRecords).toBeGreaterThan(0);
      expect(followUp?.childEvidence?.browserCaptureFailedRecords ?? 0).toBe(0);
      expect(followUp?.childEvidence?.pageTextLength).toBeGreaterThan(0);
      expect(followUp?.childEvidence?.evidenceWarnings).not.toContain("failed_browser_capture");
      const followUpReport = await readFile(followUp?.reportPath ?? "", "utf8");
      expect(followUpReport).toContain(`${fixture.baseUrl}/destination`);
      expect(followUpReport).not.toContain("already leased");
    } finally {
      await fixture.close();
    }
  });

  it("uses iframe-visible child text for destination usefulness", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping iframe child evidence workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-frame-child-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation-frame-child?query=ramen`,
        runDir,
        captureId: "fixture-frame-child",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            { actionKey: "destination-followup", operation: "follow_up", selector: "#frame-destination-link", captureId: "fixture-frame-destination" }
          ],
          maxFollowUps: 1,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.destinationTriage).toMatchObject({
        status: "selected",
        candidateCount: 1,
        selectedCount: 1,
        usefulCount: 1
      });
      const followUp = result.assessment.sourceNavigationFollowUps.results[0];
      expect(followUp?.url).toBe(`${fixture.baseUrl}/framed-child`);
      expect(followUp?.childEvidence).toMatchObject({
        queryOverlapTokenCount: 1,
        matchedQueryTokens: ["ramen"],
        evidenceSignals: expect.arrayContaining(["browser_capture", "visible_text", "claims_registered", "query_overlap"])
      });
      expect(followUp?.childEvidence?.textSnippet).toContain("ramen iframe-only destination evidence");
      const followUpText = await readFile(join(followUp?.runDir ?? "", "raw", "fixture-frame-destination-page-capture.txt"), "utf8");
      expect(followUpText).toContain("ramen iframe-only destination evidence");
    } finally {
      await fixture.close();
    }
  });

  it("does not count failed child page capture as successful browser evidence", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping failed child capture workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-failed-child-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation-failed-child?query=ramen`,
        runDir,
        captureId: "fixture-failed-child",
        waitMs: 0,
        sampleFrames: false,
        navigationTimeoutMs: 5_000,
        sourceNavigation: {
          enabled: true,
          actions: [
            { actionKey: "destination-followup", operation: "follow_up", selector: "#failed-destination-link", captureId: "fixture-failed-destination" }
          ],
          maxFollowUps: 1,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.destinationTriage).toMatchObject({
        status: "partial",
        candidateCount: 1,
        selectedCount: 1,
        usefulCount: 0,
        lowValueCount: 1
      });
      const followUp = result.assessment.sourceNavigationFollowUps.results[0];
      expect(followUp?.childEvidence).toMatchObject({
        browserCaptureRecords: 0,
        browserCaptureFailedRecords: 1,
        pageTextLength: 0,
        evidenceSignals: expect.arrayContaining(["browser_capture_failed"]),
        evidenceWarnings: expect.arrayContaining(["missing_browser_capture", "failed_browser_capture", "empty_visible_text"])
      });
      expect(followUp?.childEvidence?.evidenceSignals).not.toContain("browser_capture");
    } finally {
      await fixture.close();
    }
  });

  it("triages extracted destination candidates before bounded child evidence runs", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping extracted destination triage workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-destination-triage-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation`,
        runDir,
        captureId: "fixture-destination-triage",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            {
              actionKey: "destination-followup",
              operation: "extract_destinations",
              selector: "#destination-candidates",
              maxLinks: 4,
              captureId: "fixture-extracted-destination"
            }
          ],
          maxFollowUps: 1,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.sourceNavigationFollowUps).toMatchObject({
        requestedCount: 4,
        attemptedCount: 1,
        completedCount: 1,
        failedCount: 0,
        omittedCount: 3
      });
      expect(result.assessment.destinationTriage).toMatchObject({
        status: "selected",
        candidateCount: 4,
        selectedCount: 1,
        rejectedCount: 3,
        usefulCount: 1,
        duplicateCount: 1
      });
      const followUp = result.assessment.sourceNavigationFollowUps.results[0];
      expect(followUp?.url).toBe(`${fixture.baseUrl}/official?query=ramen`);
      expect(followUp?.childEvidence).toMatchObject({
        queryOverlapTokenCount: 1,
        matchedQueryTokens: ["ramen"],
        deeperCandidateCount: 1,
        deeperCandidates: [
          expect.objectContaining({
            url: `${fixture.baseUrl}/source-document`,
            signals: expect.arrayContaining(["depth_2_proposal", "query_overlap", "source_document_hint"]),
            warnings: expect.arrayContaining(["proposal_only_not_executed"])
          })
        ],
        evidenceSignals: expect.arrayContaining(["browser_capture", "visible_text", "claims_registered", "query_overlap", "deeper_candidates_visible"])
      });
      expect(result.assessment.destinationDeepeningProposals).toMatchObject({
        status: "proposed",
        proposalCount: 1,
        candidateCount: 1
      });
      expect(result.assessment.destinationDeepeningExecution).toMatchObject({
        status: "not_enabled",
        maxDepth: 1,
        attemptedCount: 0,
        omittedCount: 1
      });
      expect(result.destinationDeepeningProposalRecords.some((record) => record.evidence_kind === "destination_deepening_proposal")).toBe(true);
      expect(result.destinationTriageRecords).toHaveLength(2);
      expect(result.assessment.destinationTriage.usefulCount).toBe(1);
      const followUpText = await readFile(join(followUp?.runDir ?? "", "raw", "fixture-extracted-destination-2-page-capture.txt"), "utf8");
      expect(followUpText).toContain("official destination fixture");

      const actionRecord = result.sourceNavigationActionRecords.find((record) => record.path.includes("destination-followup-action.metadata.json"));
      const actionMetadata = await readFile(join(runDir, actionRecord?.path ?? ""), "utf8");
      expect(actionMetadata).toContain("\"operation\": \"extract_destinations\"");
      const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
      expect(ledger).toContain("\"tool_name\":\"destination_candidate\"");
      expect(ledger).toContain("\"tool_name\":\"destination_triage\"");
      expect(ledger).toContain("\"tool_name\":\"destination_deepening_proposal\"");
      const triageTextRecord = result.destinationTriageRecords.find((record) => record.kind === "text");
      const triageText = await readFile(join(runDir, triageTextRecord?.path ?? ""), "utf8");
      expect(triageText).toContain("\"matchedQueryTokens\"");
      expect(triageText).toContain("\"reasonCodes\"");
      expect(triageText).toContain("\"visibleMetadata\"");
      expect(triageText).toContain("\"positiveReasonCounts\"");
      expect(triageText).toContain("\"negativeReasonCounts\"");
      expect(triageText).toContain("\"query_overlap\"");
      expect(triageText).toContain("\"portal_shell\"");
      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Source navigation follow-ups: requested 4, attempted 1, completed 1, failed 0, omitted 3");
      expect(report).toContain("Destination triage: selected, candidates 4, selected 1, rejected 3");
      expect(report).toContain("Destination triage reasons: positive");
      expect(report).toContain("negative");
      expect(report).toContain("Destination triage visible metadata: snippets 4/4, recent-year 0, stale-year 0, price/offer 0, rating/review 1, local/place 0, publisher/article 0");
      expect(report).toContain("Destination triage candidate kinds: all official=2, blog=1, generic=1, selected official=1, useful official=1, rejected blog=1, generic=1, official=1");
      expect(report).toContain("Destination triage query intents: general=4");
      expect(report).toContain("Destination deepening proposals: proposed, proposals 1, candidates 1");
      expect(report).toContain("Destination deepening execution: not_enabled, max depth 1");
    } finally {
      await fixture.close();
    }
  });

  it("runs selected source navigation follow-ups with bounded concurrency", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping follow-up concurrency workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-followup-concurrency-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation-parallel?query=ramen`,
        runDir,
        captureId: "fixture-followup-concurrency",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            {
              actionKey: "destination-followup",
              operation: "extract_destinations",
              selector: "#destination-candidates",
              maxLinks: 2,
              captureId: "fixture-parallel-destination"
            }
          ],
          maxFollowUps: 2,
          maxFollowUpsPerDomain: 2,
          followUpConcurrency: 2,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.sourceNavigationFollowUps).toMatchObject({
        requestedCount: 2,
        attemptedCount: 2,
        completedCount: 2,
        failedCount: 0,
        omittedCount: 0,
        maxFollowUps: 2,
        maxFollowUpsPerDomain: 2,
        followUpConcurrency: 2
      });
      expect(fixture.slowChildMaxConcurrency()).toBeGreaterThan(1);
      expect(result.assessment.sourceNavigationFollowUps.results.map((run) => run.url)).toEqual([
        `${fixture.baseUrl}/slow-child-one?query=ramen`,
        `${fixture.baseUrl}/slow-child-two?query=ramen`
      ]);
      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Source navigation follow-ups: requested 2, attempted 2, completed 2, failed 0, omitted 0, concurrency 2");
    } finally {
      await fixture.close();
    }
  });

  it("reports fallback diagnostics when the selected child evidence is downgraded", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping destination fallback diagnostics workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-destination-fallback-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation-fallback?query=noodle`,
        runDir,
        captureId: "fixture-destination-fallback",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            {
              actionKey: "destination-followup",
              operation: "extract_destinations",
              selector: "#destination-candidates",
              maxLinks: 2,
              captureId: "fixture-fallback-destination"
            }
          ],
          maxFollowUps: 1,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.sourceNavigationFollowUps).toMatchObject({
        requestedCount: 2,
        attemptedCount: 1,
        completedCount: 1,
        failedCount: 0,
        omittedCount: 1
      });
      expect(result.assessment.sourceNavigationFollowUps.results[0]).toMatchObject({
        url: `${fixture.baseUrl}/official-thin`,
        childEvidence: expect.objectContaining({
          queryOverlapTokenCount: 0,
          evidenceWarnings: expect.arrayContaining(["no_query_overlap"])
        })
      });
      expect(result.assessment.destinationTriage).toMatchObject({
        status: "partial",
        candidateCount: 2,
        selectedCount: 1,
        rejectedCount: 1,
        usefulCount: 0,
        offTopicCount: 1,
        budgetLimitedCount: 1,
        unattemptedFallbackCount: 1,
        fallbackCandidates: [
          expect.objectContaining({
            candidateId: "destination-candidate-2",
            actionKey: "destination-followup",
            url: `${fixture.baseUrl}/blog/ramen`,
            budgetReason: "top_k_budget"
          })
        ],
        retryRecommended: true,
        retryAdvice: {
          recommendedMaxSelected: 2,
          recommendedMaxPerDomain: 1,
          cliFlags: [
            "--source-navigation-max-followups",
            "2",
            "--source-navigation-max-followups-per-domain",
            "1"
          ],
          reasons: ["increase_max_followups"]
        }
      });

      const triageTextRecord = result.destinationTriageRecords.find((record) => record.kind === "text");
      const triageText = await readFile(join(runDir, triageTextRecord?.path ?? ""), "utf8");
      expect(triageText).toContain("\"unattemptedFallbackCount\": 1");
      expect(triageText).toContain("\"fallbackCandidates\"");
      expect(triageText).toContain(`${fixture.baseUrl}/blog/ramen`);
      expect(triageText).toContain("\"retryRecommended\": true");
      expect(triageText).toContain("Selected child evidence was downgraded while unattempted fallback candidates remain");

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Destination triage: partial, candidates 2, selected 1, rejected 1");
      expect(report).toContain("fallback candidates 1, retry recommended yes");
      expect(report).toContain(`Destination triage fallback candidates: destination-candidate-2 blog ${fixture.baseUrl}/blog/ramen`);
      expect(report).toContain("Destination triage retry advice: maxFollowUps 2, maxFollowUpsPerDomain 1, flags --source-navigation-max-followups 2 --source-navigation-max-followups-per-domain 1, reasons increase_max_followups");
    } finally {
      await fixture.close();
    }
  });

  it("runs bounded fallback follow-ups when explicitly enabled after a downgraded child", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping destination fallback execution workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-destination-fallback-exec-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation-fallback?query=noodle`,
        runDir,
        captureId: "fixture-destination-fallback-exec",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            {
              actionKey: "destination-followup",
              operation: "extract_destinations",
              selector: "#destination-candidates",
              maxLinks: 2,
              captureId: "fixture-fallback-destination-exec"
            }
          ],
          maxFollowUps: 1,
          fallbackFollowUps: true,
          maxFallbackFollowUps: 1,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.sourceNavigationFollowUps).toMatchObject({
        requestedCount: 2,
        attemptedCount: 2,
        completedCount: 2,
        failedCount: 0,
        omittedCount: 0,
        maxFollowUps: 1,
        effectiveMaxFollowUps: 2,
        effectiveMaxFollowUpsPerDomain: 2,
        fallbackFollowUps: true,
        maxFallbackFollowUps: 1,
        fallbackAttemptedCount: 1
      });
      expect(result.assessment.sourceNavigationFollowUps.results.map((run) => run.url)).toEqual([
        `${fixture.baseUrl}/official-thin`,
        `${fixture.baseUrl}/blog/ramen`
      ]);
      expect(result.assessment.destinationTriage).toMatchObject({
        status: "partial",
        candidateCount: 2,
        selectedCount: 2,
        rejectedCount: 0,
        usefulCount: 1,
        offTopicCount: 1,
        budgetLimitedCount: 0,
        unattemptedFallbackCount: 0,
        retryRecommended: false
      });
      const triageTextRecord = result.destinationTriageRecords.find((record) => record.kind === "text");
      const triageText = await readFile(join(runDir, triageTextRecord?.path ?? ""), "utf8");
      expect(triageText).toContain(`${fixture.baseUrl}/official-thin`);
      expect(triageText).toContain(`${fixture.baseUrl}/blog/ramen`);
      expect(triageText).toContain("\"usefulness\": \"off_topic\"");
      expect(triageText).toContain("\"usefulness\": \"useful\"");
      expect(triageText).toContain("\"query_overlap\"");

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Source navigation follow-ups: requested 2, attempted 2, completed 2, failed 0, omitted 0");
      expect(report).toContain("fallback enabled, fallback attempted 1, effective max 2/2");
      expect(report).toContain("Destination triage fallback candidates: none");
      expect(report).toContain("Destination triage retry advice: none");
    } finally {
      await fixture.close();
    }
  });

  it("reports profile/headed recovery advice when a blocked child exposes deeper candidates", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping blocked-child recovery workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-destination-blocked-recovery-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation-blocked-recovery?query=ramen`,
        runDir,
        captureId: "fixture-destination-blocked-recovery",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            {
              actionKey: "destination-followup",
              operation: "extract_destinations",
              selector: "#destination-candidates",
              maxLinks: 1,
              captureId: "fixture-blocked-recovery-destination"
            }
          ],
          maxFollowUps: 1,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.destinationTriage).toMatchObject({
        status: "partial",
        candidateCount: 1,
        selectedCount: 1,
        blockedCount: 1,
        blockedChildRecoveryCandidateCount: 1,
        retryRecommended: true,
        blockedChildRecoveryAdvice: {
          recommendedAction: "profile_headed_retry",
          profileName: "127.0.0.1-recovery-profile",
          storagePolicy: "persistent-profile",
          browserChannel: "chrome",
          candidateCount: 1,
          sampleUrls: [`${fixture.baseUrl}/recovery-place`],
          profileSetupUrl: `${fixture.baseUrl}/blocked-child`,
          recoveryUrl: `${fixture.baseUrl}/recovery-place`,
          steps: [
            expect.objectContaining({
              step: "profile_setup",
              argv: expect.arrayContaining(["auth-login", "--profile", "127.0.0.1-recovery-profile"])
            }),
            expect.objectContaining({
              step: "recovery_evidence_run",
              argv: expect.arrayContaining(["evidence-run", "--url", `${fixture.baseUrl}/recovery-place`])
            })
          ],
          reasons: [
            "blocked_child_exposes_deeper_candidates",
            "profile_headed_review_required",
            "default_depth_2_execution_disabled"
          ]
        }
      });
      expect(result.assessment.destinationTriage.blockedChildRecoveryAdvice?.steps.map((step) => step.powershellCommand)).toEqual(
        result.assessment.destinationTriage.blockedChildRecoveryAdvice?.commandHints
      );
      expect(result.assessment.destinationTriage.blockedChildRecoveryAdvice?.profileSetupPowerShellCommand).toContain("'auth-login' '--profile' '127.0.0.1-recovery-profile'");
      expect(result.assessment.destinationTriage.blockedChildRecoveryAdvice?.profileSetupPowerShellCommand).toContain("'--browser-channel' 'chrome'");
      expect(result.assessment.destinationTriage.blockedChildRecoveryAdvice?.evidenceRunPowerShellCommand).toContain(`'evidence-run' '--url' '${fixture.baseUrl}/recovery-place'`);
      expect(result.assessment.destinationTriage.blockedChildRecoveryAdvice?.evidenceRunPowerShellCommand).toContain("'--headed' '--browser-channel' 'chrome' '--profile' '127.0.0.1-recovery-profile'");
      expect(result.assessment.destinationDeepeningProposals).toMatchObject({
        status: "no_proposals",
        proposalCount: 0
      });

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Destination triage blocked child recovery candidates: 1 found");
      expect(report).toContain("Destination triage blocked child recovery advice: profile_headed_retry");
      expect(report).toContain("'auth-login' '--profile' '127.0.0.1-recovery-profile'");
      expect(report).toContain("'evidence-run' '--url'");
      expect(report).toContain("Destination triage retry advice: none");
    } finally {
      await fixture.close();
    }
  });

  it("matches common transliterated query aliases on cross-script child evidence", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping query alias workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-destination-query-alias-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/maps/search/seongsu%20cafe`,
        runDir,
        captureId: "fixture-destination-query-alias",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            {
              actionKey: "destination-followup",
              operation: "extract_destinations",
              selector: "#destination-candidates",
              maxLinks: 1,
              captureId: "fixture-query-alias-destination"
            }
          ],
          maxFollowUps: 1,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.sourceNavigationFollowUps.results[0]).toMatchObject({
        url: `${fixture.baseUrl}/korean-place`,
        childEvidence: expect.objectContaining({
          queryOverlapTokenCount: 2,
          matchedQueryTokens: ["seongsu", "cafe"],
          queryScriptFamilies: ["latin"],
          evidenceScriptFamilies: expect.arrayContaining(["hangul"]),
          evidenceSignals: expect.arrayContaining(["query_overlap"]),
          evidenceWarnings: expect.not.arrayContaining(["no_query_overlap", "query_script_mismatch_possible"])
        })
      });
      expect(result.assessment.destinationTriage).toMatchObject({
        status: "selected",
        usefulCount: 1,
        positiveReasonCounts: expect.arrayContaining([
          { reasonCode: "query_overlap", count: 1 }
        ])
      });

      const triageTextRecord = result.destinationTriageRecords.find((record) => record.kind === "text");
      const triageText = await readFile(join(runDir, triageTextRecord?.path ?? ""), "utf8");
      expect(triageText).toContain("\"matchedQueryTokens\"");
      expect(triageText).toContain("\"seongsu\"");
      expect(triageText).not.toContain("\"query_script_mismatch_possible\"");
    } finally {
      await fixture.close();
    }
  });

  it("executes proposed depth-2 destination evidence only with explicit maxDepth opt-in", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping depth-2 destination deepening workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-destination-deepening-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation`,
        runDir,
        captureId: "fixture-destination-deepening",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            {
              actionKey: "destination-followup",
              operation: "extract_destinations",
              selector: "#destination-candidates",
              maxLinks: 4,
              captureId: "fixture-extracted-destination"
            }
          ],
          maxFollowUps: 1,
          maxDepth: 2,
          maxDeepeningRuns: 1,
          maxDeepeningRunsPerDomain: 1,
          deepeningTimeoutMs: 15_000,
          maxDeepeningArtifacts: 1_000,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.destinationDeepeningProposals).toMatchObject({
        status: "proposed",
        proposalCount: 1,
        candidateCount: 1
      });
      expect(result.assessment.destinationDeepeningExecution).toMatchObject({
        status: "ok",
        maxDepth: 2,
        maxRuns: 1,
        maxPerDomain: 1,
        timeoutMs: 15_000,
        maxArtifacts: 1_000,
        proposalCount: 1,
        candidateCount: 1,
        attemptedCount: 1,
        completedCount: 1,
        failedCount: 0,
        omittedCount: 0,
        usefulCount: 1,
        budgetLimitedCount: 0,
        timeoutCount: 0
      });
      expect(result.assessment.destinationDeepeningExecution.results[0]).toMatchObject({
        sourceCandidateId: "destination-candidate-2",
        actionKey: "destination-followup",
        url: `${fixture.baseUrl}/source-document`,
        status: "ok",
        usefulness: "useful",
        timeoutMs: 15_000,
        maxArtifacts: 1_000,
        artifactBudgetExceeded: false,
        childEvidence: expect.objectContaining({
          matchedQueryTokens: ["ramen"],
          evidenceSignals: expect.arrayContaining(["browser_capture", "visible_text", "claims_registered", "query_overlap"])
        })
      });
      expect(result.destinationDeepeningRunRecords.some((record) => record.evidence_kind === "destination_deepening_run")).toBe(true);

      const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
      expect(ledger).toContain("\"tool_name\":\"destination_deepening_run\"");
      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Destination deepening execution: ok, max depth 2, max runs 1, max per-domain 1, concurrency 1, timeout 15000ms, max artifacts 1000, attempted 1, completed 1, failed 0, omitted 0, useful 1, budget-limited 0, timeouts 0");
    } finally {
      await fixture.close();
    }
  });

  it("runs proposed depth-2 destination evidence with bounded concurrency", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping depth-2 concurrency workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-deepening-concurrency-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation-deepening-parallel?query=ramen`,
        runDir,
        captureId: "fixture-deepening-concurrency",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            {
              actionKey: "destination-followup",
              operation: "extract_destinations",
              selector: "#destination-candidates",
              maxLinks: 1,
              captureId: "fixture-deepening-parallel-destination"
            }
          ],
          maxFollowUps: 1,
          maxDepth: 2,
          maxDeepeningRuns: 2,
          maxDeepeningRunsPerDomain: 2,
          deepeningConcurrency: 2,
          deepeningTimeoutMs: 15_000,
          maxDeepeningArtifacts: 1_000,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.destinationDeepeningExecution).toMatchObject({
        status: "ok",
        maxDepth: 2,
        maxRuns: 2,
        maxPerDomain: 2,
        concurrency: 2,
        candidateCount: 2,
        attemptedCount: 2,
        completedCount: 2,
        failedCount: 0,
        omittedCount: 0,
        usefulCount: 2
      });
      expect(fixture.slowChildMaxConcurrency()).toBeGreaterThan(1);
      expect(result.assessment.destinationDeepeningExecution.results.map((run) => run.url)).toEqual([
        `${fixture.baseUrl}/slow-depth-one?query=ramen`,
        `${fixture.baseUrl}/slow-depth-two?query=ramen`
      ]);
      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Destination deepening execution: ok, max depth 2, max runs 2, max per-domain 2, concurrency 2");
    } finally {
      await fixture.close();
    }
  });

  it("marks depth-2 destination evidence as budget-limited when artifact budget is exceeded", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping depth-2 destination artifact-budget workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-destination-deepening-budget-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/navigation`,
        runDir,
        captureId: "fixture-destination-deepening-budget",
        waitMs: 0,
        sampleFrames: false,
        sourceNavigation: {
          enabled: true,
          actions: [
            {
              actionKey: "destination-followup",
              operation: "extract_destinations",
              selector: "#destination-candidates",
              maxLinks: 4,
              captureId: "fixture-extracted-destination-budget"
            }
          ],
          maxFollowUps: 1,
          maxDepth: 2,
          maxDeepeningRuns: 1,
          maxDeepeningRunsPerDomain: 1,
          deepeningTimeoutMs: 15_000,
          maxDeepeningArtifacts: 1,
          limits: { perActionTimeoutMs: 5_000 }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.destinationDeepeningExecution).toMatchObject({
        status: "partial",
        maxDepth: 2,
        maxRuns: 1,
        maxPerDomain: 1,
        timeoutMs: 15_000,
        maxArtifacts: 1,
        attemptedCount: 1,
        completedCount: 1,
        failedCount: 0,
        budgetLimitedCount: 1
      });
      expect(result.assessment.destinationDeepeningExecution.results[0]).toMatchObject({
        status: "ok",
        usefulness: "budget_limited",
        maxArtifacts: 1,
        artifactBudgetExceeded: true,
        error: "depth-2 evidence run exceeded artifact budget of 1"
      });
      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Destination deepening execution: partial, max depth 2, max runs 1, max per-domain 1, concurrency 1, timeout 15000ms, max artifacts 1, attempted 1, completed 1, failed 0, omitted 0, useful 0, budget-limited 1, timeouts 0");
    } finally {
      await fixture.close();
    }
  });

  it("adds dense frame sampling around OCR text hits", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping OCR dense workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-ocr-dense-"));
    runDirs.push(runDir);
    let recognizeCalls = 0;
    let workerFactoryCalls = 0;

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/video`,
        runDir,
        captureId: "fixture-ocr-dense",
        timestampsSec: [10],
        maxFrames: 1,
        waitMs: 0,
        seekTimeoutMs: 1_000,
        settleMs: 10,
        ocr: { enabled: true, maxFrames: 20, timeoutMs: 1_000, language: "eng", minConfidence: 50 },
        denseSampling: { enabled: true, windowSec: 1, stepSec: 1, maxDenseFrames: 4, query: "marker" }
      }, {
        ocrWorkerFactory: async () => {
          workerFactoryCalls += 1;
          const worker: OcrWorker = {
            recognize: async () => {
              recognizeCalls += 1;
              return { data: { text: "OCR marker", confidence: 95, words: [{ text: "marker", confidence: 96 }] } };
            },
            terminate: async () => undefined
          };
          return worker;
        }
      });

      expect(result.ok).toBe(true);
      expect(workerFactoryCalls).toBe(2);
      expect(recognizeCalls).toBeGreaterThan(1);
      expect(result.stageTimings.map((timing) => timing.stage)).toEqual(expect.arrayContaining([
        "ocr",
        "ocr_hit_dense_frame_sampling",
        "ocr_dense_sampling"
      ]));
      expect(result.frameRecords.filter((record) => record.evidence_kind === "frame_screenshot")).toHaveLength(3);
      expect(result.ocrRecords.filter((record) => record.kind === "text" && record.status === "ok")).toHaveLength(3);
      expect(result.claims.some((claim) => claim.verification_level === "ocr_extracted")).toBe(true);
      if ("timestampsSec" in result.assessment.frameSampling) {
        expect(result.assessment.frameSampling.timestampsSec).toEqual(expect.arrayContaining([9, 10, 11]));
        expect(result.assessment.frameSampling.denseSampling?.events).toEqual(expect.arrayContaining([
          expect.objectContaining({
            source: "ocr_text",
            hitTimestampsSec: [10],
            capturedTimestampsSec: expect.arrayContaining([9, 11])
          })
        ]));
      }
    } finally {
      await fixture.close();
    }
  });

  it("records browser-visible obstruction artifacts and claims", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping obstruction workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-obstruction-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/login-wall`,
        runDir,
        captureId: "fixture-login-wall",
        waitMs: 0,
        sampleFrames: false
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.browserObstructions.status).toBe("detected");
      expect(result.assessment.browserObstructions.detections).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "login_wall" })
      ]));
      expect(result.obstructionRecords.some((record) => record.evidence_kind === "browser_obstruction")).toBe(true);
      expect(result.claims.some((claim) => claim.evidence_kind === "browser_obstruction")).toBe(true);

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Browser obstructions: detected");
      expect(report).toContain("login_wall");
    } finally {
      await fixture.close();
    }
  });

  it("dismisses benign overlays before evidence page capture", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping overlay dismissal workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-overlay-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/dismissible-overlay`,
        runDir,
        captureId: "fixture-overlay",
        waitMs: 0,
        sampleFrames: false
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.browserOverlayDismissal.status).toBe("dismissed");
      expect(result.assessment.browserOverlayDismissal.dismissedCount).toBeGreaterThan(0);
      expect(result.overlayDismissalRecords.some((record) => record.evidence_kind === "browser_overlay_dismissal")).toBe(true);
      expect(result.stageTimings.map((timing) => timing.stage)).toEqual(expect.arrayContaining([
        "browser_overlay_dismissal",
        "browser_overlay_dismissal_artifact"
      ]));

      const textRecord = result.pageCaptureRecords.find((record) => record.kind === "text");
      expect(textRecord).toBeDefined();
      const text = await readFile(join(runDir, textRecord?.path ?? ""), "utf8");
      expect(text).toContain("primary evidence content");
      expect(text).not.toContain("newsletter overlay");

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Browser overlay dismissal: dismissed");
    } finally {
      await fixture.close();
    }
  });

  it("can disable overlay dismissal for evidence page capture", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping disabled overlay dismissal workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-overlay-disabled-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/dismissible-overlay`,
        runDir,
        captureId: "fixture-overlay-disabled",
        waitMs: 0,
        sampleFrames: false,
        overlayDismissal: { enabled: false, maxActions: 3 }
      });

      expect(result.ok).toBe(true);
      expect(result.assessment.browserOverlayDismissal.status).toBe("skipped");
      expect(result.assessment.browserOverlayDismissal.dismissedCount).toBe(0);
      expect(result.overlayDismissalRecords.some((record) => record.evidence_kind === "browser_overlay_dismissal")).toBe(true);

      const textRecord = result.pageCaptureRecords.find((record) => record.kind === "text");
      expect(textRecord).toBeDefined();
      const text = await readFile(join(runDir, textRecord?.path ?? ""), "utf8");
      expect(text).toContain("primary evidence content");
      expect(text).toContain("newsletter overlay");
    } finally {
      await fixture.close();
    }
  });

  it("adds dense frame sampling around browser-visible scene changes", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping scene-change dense workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-scene-dense-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/video`,
        runDir,
        captureId: "fixture-scene-dense",
        timestampsSec: [0, 10, 20],
        maxFrames: 3,
        waitMs: 0,
        seekTimeoutMs: 1_000,
        settleMs: 10,
        denseSampling: {
          enabled: true,
          windowSec: 1,
          stepSec: 1,
          maxDenseFrames: 4,
          sceneChange: true,
          sceneChangeThreshold: 16,
          sceneChangeMaxHits: 1,
          query: "no-transcript-hit"
        }
      });

      expect(result.ok).toBe(true);
      expect(result.stageTimings.map((timing) => timing.stage)).toContain("scene_change_dense_frame_sampling");
      expect(result.frameRecords.filter((record) => record.evidence_kind === "frame_screenshot")).toHaveLength(6);
      if ("timestampsSec" in result.assessment.frameSampling) {
        expect(result.assessment.frameSampling.timestampsSec).toEqual(expect.arrayContaining([0, 4, 5, 6, 10, 20]));
        expect(result.assessment.frameSampling.denseSampling?.events).toEqual(expect.arrayContaining([
          expect.objectContaining({
            source: "scene_change",
            hitTimestampsSec: [5],
            capturedTimestampsSec: expect.arrayContaining([4, 5, 6]),
            sceneChangeDiagnostics: expect.objectContaining({
              threshold: 16,
              maxHits: 1,
              uniqueFingerprintCount: expect.any(Number),
              zeroDistancePairCount: expect.any(Number),
              distanceP90: expect.any(Number),
              comparablePairCount: expect.any(Number),
              selectedHitCount: 1,
              thresholdRecommendation: expect.any(String)
            }),
            sceneChangeHits: expect.arrayContaining([
              expect.objectContaining({
                fromTimestampSec: 0,
                toTimestampSec: 10,
                midpointSec: 5
              })
            ])
          })
        ]));
        expect(result.assessment.frameSampling.sceneChangeDiagnostics).toEqual(expect.arrayContaining([
          expect.objectContaining({
            threshold: 16,
            maxHits: 1,
            selectedHitCount: 1,
            maxObservedDistance: expect.any(Number),
            distanceP90: expect.any(Number),
            thresholdRecommendation: expect.any(String)
          })
        ]));
      }
      expect(result.assessment.frameSampling.status).toBe("ok");
      expect(await readFile(result.reportPath, "utf8")).toContain("Scene-change diagnostics:");
      expect(await readFile(result.reportPath, "utf8")).toContain("recommendation=");
      expect(await readFile(result.reportPath, "utf8")).toContain("p90=");
    } finally {
      await fixture.close();
    }
  });
});

async function startFixtureServer(): Promise<{ baseUrl: string; close: () => Promise<void>; slowChildMaxConcurrency: () => number }> {
  const captions = Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:12.000\nfixture caption\n", "utf8");
  let activeSlowChildRequests = 0;
  let maxSlowChildRequests = 0;
  const server = createServer((request, response) => {
    const path = request.url?.split("?", 1)[0] ?? "/";
    if (path === "/captions.vtt") {
      response.writeHead(200, { "content-type": "text/vtt", "content-length": String(captions.byteLength) });
      response.end(captions);
      return;
    }
    if (path === "/structured") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>structured fixture</title>
        <meta property="og:title" content="Acme Cafe">
        <script type="application/ld+json">{"@type":"Product","name":"Latte","offers":{"@type":"Offer","price":"4500","priceCurrency":"KRW"}}</script>
        </head><body><main><h1>Acme Cafe</h1><p>open now</p></main></body></html>`);
      return;
    }
    if (path === "/login-wall") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>Login required</title></head><body>
        <main>
          <h1>Log in to continue</h1>
          <p>Sign in to view this content.</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/dismissible-overlay") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>overlay fixture</title></head><body>
        <main>
          <h1>primary evidence content</h1>
        </main>
        <div id="newsletter-modal" role="dialog" aria-modal="true" style="position:fixed;inset:20px;z-index:50;background:white">
          <p>newsletter overlay</p>
          <button id="dismiss" onclick="document.querySelector('#newsletter-modal').remove()">No thanks</button>
        </div>
      </body></html>`);
      return;
    }
    if (path === "/navigation") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>navigation fixture</title></head><body>
        <main style="min-height: 2400px">
          <h1>navigation fixture</h1>
          <p>top marker</p>
          <a id="destination-link" href="/destination">destination page</a>
          <section id="destination-candidates">
            <a href="/privacy">Privacy policy</a>
            <a href="/official?query=ramen">Official ramen guide</a>
            <a href="/blog/ramen">Ramen blog review</a>
            <a href="/official?query=ramen#duplicate">Official ramen guide duplicate</a>
          </section>
          <section style="margin-top: 1800px">bottom marker</section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/navigation-frame-child") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>navigation frame child fixture</title></head><body>
        <main>
          <h1>navigation frame child fixture</h1>
          <a id="frame-destination-link" href="/framed-child">frame child destination</a>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/navigation-failed-child") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>navigation failed child fixture</title></head><body>
        <main>
          <h1>navigation failed child fixture</h1>
          <a id="failed-destination-link" href="/failed-child">failed child destination</a>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/navigation-fallback") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>navigation fallback fixture</title></head><body>
        <main>
          <h1>navigation fallback fixture</h1>
          <section id="destination-candidates">
            <a href="/official-thin">Official noodle homepage</a>
            <a href="/blog/ramen">Noodle blog review</a>
          </section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/navigation-blocked-recovery") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>navigation blocked recovery fixture</title></head><body>
        <main>
          <h1>navigation blocked recovery fixture</h1>
          <section id="destination-candidates">
            <a href="/blocked-child">Blocked ramen place entry</a>
          </section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/navigation-parallel") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>parallel navigation fixture</title></head><body>
        <main>
          <h1>parallel navigation fixture</h1>
          <section id="destination-candidates">
            <a href="/slow-child-one?query=ramen">Official ramen source one</a>
            <a href="/slow-child-two?query=ramen">Official ramen source two</a>
          </section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/navigation-deepening-parallel") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>parallel deepening navigation fixture</title></head><body>
        <main>
          <h1>parallel deepening navigation fixture</h1>
          <section id="destination-candidates">
            <a href="/official-two-sources?query=ramen">Official ramen source hub</a>
          </section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/navigation-script-mismatch" || path === "/maps/search/seongsu%20cafe") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>navigation script mismatch fixture</title></head><body>
        <main>
          <h1>navigation script mismatch fixture</h1>
          <section id="destination-candidates">
            <a href="/korean-place">Seongsu cafe place evidence</a>
          </section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/blocked-child") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>blocked child fixture</title></head><body>
        <main>
          <h1>Log in to continue</h1>
          <p>Sign in to view this ramen place entry.</p>
          <a href="/recovery-place">Ramen place home</a>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/recovery-place") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>recovery place fixture</title></head><body>
        <main>
          <h1>recovery place fixture</h1>
          <p>official ramen place evidence after profile review.</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/destination") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>destination fixture</title></head><body>
        <main>
          <h1>destination fixture</h1>
          <p>follow-up evidence content</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/korean-place") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>성수 카페 장소 정보</title></head><body>
        <main>
          <h1>성수 카페 장소 정보</h1>
          <p>성수동 카페 영업시간 주소 리뷰 메뉴 정보를 보여주는 장소 페이지입니다.</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/failed-child") {
      request.socket.destroy();
      return;
    }
    if (path === "/framed-child") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>framed child fixture</title></head><body>
        <main>
          <h1>frame child shell</h1>
          <iframe src="/framed-child-inner" title="destination evidence" style="width:500px;height:180px;border:0"></iframe>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/framed-child-inner") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>framed child inner fixture</title></head><body>
        <main>
          <h2>ramen iframe-only destination evidence</h2>
          <p>menu, hours, and source context are rendered inside the child frame.</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/official") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>official destination fixture</title></head><body>
        <main>
          <h1>official destination fixture</h1>
          <p>official ramen evidence</p>
          <a href="/source-document">Official ramen source document</a>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/slow-child-one" || path === "/slow-child-two") {
      activeSlowChildRequests += 1;
      maxSlowChildRequests = Math.max(maxSlowChildRequests, activeSlowChildRequests);
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html><head><title>${path.slice(1)} fixture</title></head><body>
          <main>
            <h1>${path.slice(1)} destination fixture</h1>
            <p>official ramen evidence from ${path.slice(1)}</p>
          </main>
        </body></html>`);
        activeSlowChildRequests -= 1;
      }, 300);
      return;
    }
    if (path === "/official-two-sources") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>official two sources fixture</title></head><body>
        <main>
          <h1>official two sources fixture</h1>
          <p>official ramen evidence with two deeper primary source documents</p>
          <a href="/slow-depth-one?query=ramen">Official ramen source document one</a>
          <a href="/slow-depth-two?query=ramen">Official ramen source document two</a>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/slow-depth-one" || path === "/slow-depth-two") {
      activeSlowChildRequests += 1;
      maxSlowChildRequests = Math.max(maxSlowChildRequests, activeSlowChildRequests);
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html><head><title>${path.slice(1)} source fixture</title></head><body>
          <main>
            <h1>${path.slice(1)} source document fixture</h1>
            <p>primary official ramen source document evidence from ${path.slice(1)}</p>
          </main>
        </body></html>`);
        activeSlowChildRequests -= 1;
      }, 300);
      return;
    }
    if (path === "/official-thin") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>thin official fixture</title></head><body>
        <main>
          <h1>thin official fixture</h1>
          <p>generic homepage shell with no matching subject evidence</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/source-document") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>source document fixture</title></head><body>
        <main>
          <h1>source document fixture</h1>
          <p>primary ramen source document</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/blog/ramen") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>blog destination fixture</title></head><body>
        <main>
          <h1>blog destination fixture</h1>
          <p>ramen noodle blog evidence</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/privacy") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>privacy fixture</title></head><body>
        <main>
          <h1>privacy policy</h1>
        </main>
      </body></html>`);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>evidence fixture</title></head><body>
      <main>
        <h1>evidence fixture</h1>
        <video id="clip" preload="metadata" style="display:block;width:320px;height:180px;background:#111827">
          <track kind="captions" src="/captions.vtt" srclang="en" label="English" default>
        </video>
      </main>
      <script>
        const video = document.querySelector('#clip');
        let current = 0;
        let canvasVideoTime = 0;
        const originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, options) {
          if (type !== '2d' || this.width !== 8 || this.height !== 8) {
            return originalGetContext.call(this, type, options);
          }
          return {
            drawImage(source) {
              canvasVideoTime = Number(source.currentTime || 0);
            },
            getImageData() {
              const value = canvasVideoTime >= 10 ? 255 : 0;
              const data = new Uint8ClampedArray(8 * 8 * 4);
              for (let index = 0; index < data.length; index += 4) {
                data[index] = value;
                data[index + 1] = value;
                data[index + 2] = value;
                data[index + 3] = 255;
              }
              return { data };
            }
          };
        };
        Object.defineProperty(video, 'duration', { get: () => 20 });
        Object.defineProperty(video, 'currentTime', {
          get: () => current,
          set: (value) => {
            current = Number(value);
            video.dataset.currentTime = current.toFixed(3);
            setTimeout(() => video.dispatchEvent(new Event('seeked')), 5);
          }
        });
        video.pause = () => {};
      </script>
    </body></html>`);
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
    slowChildMaxConcurrency: () => maxSlowChildRequests
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    });
  });
}
