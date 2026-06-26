import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { runEvidenceWorkflow } from "../src/evidence-runner.js";
import type { OcrWorker } from "../src/ocr.js";

let runDirs: string[] = [];

describe("runEvidenceWorkflow", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("registers a structured_data artifact when the page exposes JSON-LD", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);
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
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

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
      expect(result.acquisitionPlan.methods.at(-1)?.key).toBe("universal_byo_capture_registration");
      expect(result.acquisitionPlanRecords.some((record) => record.evidence_kind === "source_strategy")).toBe(true);
      expect(result.sourceRegistry).toMatchObject({ matchReason: "platform" });
      expect(result.sourceRegistryRecords.some((record) => record.evidence_kind === "source_registry")).toBe(true);
      expect(result.intentProfileRecords.some((record) => record.evidence_kind === "intent_profile")).toBe(true);
      expect(result.assessment.intentProfile.autonomyMode).toBe("soft_lock");
      expect(result.trendAnalysisRecords.some((record) => record.evidence_kind === "trend_analysis")).toBe(true);
      expect(result.assessment.trendAnalysis.status).toBe("ok");
      expect(result.assessment.sourceRegistry).toMatchObject({
        matchReason: "platform",
        matchedEntryCount: 1,
        platforms: ["generic"]
      });
      expect(result.assessment.frameSampling.status).toBe("ok");
      expect(result.frameRecords.some((record) => record.kind === "screenshot")).toBe(true);
      const stageNames = result.stageTimings.map((timing) => timing.stage);
      expect(stageNames).toEqual(expect.arrayContaining(["setup", "platform_capability_artifact", "source_registry_artifact", "official_api_readiness", "browser_open_page", "browser_page_capture", "frame_sampling", "claim_gate"]));
      expect(stageNames.indexOf("official_api_readiness")).toBeLessThan(stageNames.indexOf("browser_open_page"));
      expect(result.stageTimings.every((timing) => timing.durationMs >= 0)).toBe(true);

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Transcript verified in this run: false");
      expect(report).toContain("Audio verified: false");
      expect(report).toContain("Acquisition plan:");
      expect(report).toContain("Intent profile:");
      expect(report).toContain("Source registry: platform");
      expect(report).toContain("Trend analysis:");
      expect(report).toContain("## Stage Timings");
      expect(report).toContain("browser_page_capture");

      const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
      expect(ledger).toContain('"tool_name":"platform_capabilities"');
      expect(ledger).toContain('"tool_name":"source_registry"');
      expect(ledger).toContain('"tool_name":"intent_profile"');
      expect(ledger).toContain('"tool_name":"trend_analysis"');
      expect(ledger).toContain('"tool_name":"acquisition_method_plan"');
      expect(ledger).toContain('"tool_name":"farm_sample_frames"');
      expect(ledger).toContain('"tool_name":"evidence_run"');

      const claims = await readFile(join(runDir, "claims.jsonl"), "utf8");
      const citations = await readFile(join(runDir, "citations.jsonl"), "utf8");
      expect(claims.split(/\r?\n/).filter(Boolean)).toHaveLength(4);
      expect(citations.split(/\r?\n/).filter(Boolean)).toHaveLength(4);
    } finally {
      await fixture.close();
    }
  });

  it("routes visual research intent through browser capture and page screenshot OCR", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping visual intent workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-visual-intent-"));
    runDirs.push(runDir);
    let recognizeCalls = 0;

    try {
      const result = await runEvidenceWorkflow(
        {
          url: `${fixture.baseUrl}/structured`,
          runDir,
          captureId: "fixture-visual-intent",
          captureRouting: "auto",
          captureProfile: "text",
          captureCache: true,
          sampleFrames: false,
          waitMs: 0,
          finalClaimGate: false,
          researchIntent: {
            decisionNeeded: "Need UI screenshot and image text evidence from the rendered review/search page.",
            targetScope: "fixture rendered page",
            evidenceShapes: ["page_text", "ui_screenshot", "ocr_image_text"],
            successCriteria: "A browser-visible page screenshot and OCR text are registered.",
            boundaries: "public only; no login/paywall/CAPTCHA bypass"
          }
        },
        {
          ocrWorkerFactory: async () => {
            const worker: OcrWorker = {
              recognize: async () => {
                recognizeCalls += 1;
                return { data: { text: "Rendered visual evidence", confidence: 96, words: [{ text: "Rendered", confidence: 96 }] } };
              },
              terminate: async () => undefined
            };
            return worker;
          }
        }
      );

      const stageNames = result.stageTimings.map((timing) => timing.stage);
      expect(stageNames).not.toContain("http_tier0_capture");
      expect(stageNames).not.toContain("capture_cache_replay");
      expect(stageNames).toEqual(expect.arrayContaining(["browser_open_page", "browser_page_capture", "ocr"]));
      expect(result.pageCaptureRecords.some((record) => record.evidence_kind === "page_screenshot")).toBe(true);
      expect(recognizeCalls).toBe(1);
      expect(result.ocrRecords.some((record) => record.kind === "text" && record.evidence_kind === "ocr_text" && record.status === "ok")).toBe(true);
      expect(result.claims.some((claim) => claim.verification_level === "ocr_extracted")).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it("writes search result candidate artifacts from captured search surfaces", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping search-result candidate workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-search-candidates-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/search?query=%EB%A1%9C%EB%9D%BC%EB%B0%94%EC%9A%B4%EC%8A%A4%20%EB%82%B4%EB%8F%88%EB%82%B4%EC%82%B0`,
        runDir,
        captureId: "fixture-search-candidates",
        sampleFrames: false,
        waitMs: 0,
        finalClaimGate: false
      });

      expect(result.searchResultCandidateRecords.some((record) => record.evidence_kind === "search_result_candidates")).toBe(true);
      expect(result.searchStrategyPlanRecords.some((record) => record.evidence_kind === "search_strategy_plan")).toBe(true);
      expect(result.candidateDeepeningLedgerRecords.some((record) => record.evidence_kind === "candidate_deepening_ledger")).toBe(true);
      expect(result.assessment.searchResultCandidates.status).toBe("ok");
      expect(result.assessment.searchStrategyPlan.arms.map((arm) => arm.armId)).toContain("dissent_probe");
      expect(result.assessment.candidateDeepeningLedger.selectedCount).toBeGreaterThan(0);
      expect(result.assessment.searchResultCandidates.candidates[0]).toMatchObject({
        title: "로라바운스 천호점: 주차 가격 놀이시설 음식 리뷰 (내돈내산)",
        url: `${fixture.baseUrl}/blog/lorabounce-review`
      });
      const textRecord = result.searchResultCandidateRecords.find((record) => record.kind === "text" && record.evidence_kind === "search_result_candidates");
      expect(textRecord).toBeDefined();
      const report = JSON.parse(await readFile(join(runDir, textRecord?.path ?? ""), "utf8")) as { candidates?: Array<{ title?: string }> };
      expect(report.candidates?.map((candidate) => candidate.title)).toContain("7살 내돈내산 키즈카페 추천 : 로라바운스 서울 천호점");
      const finalReport = await readFile(result.reportPath, "utf8");
      expect(finalReport).toContain("Search result candidates: ok, candidates=2");
      expect(finalReport).toContain("Search strategy plan: ok");
      expect(finalReport).toContain("Candidate deepening ledger: ok");
    } finally {
      await fixture.close();
    }
  });

  it("adds dense frame sampling around OCR text hits", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

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
      const result = await runEvidenceWorkflow(
        {
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
        },
        {
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
        }
      );

      expect(result.ok).toBe(true);
      expect(workerFactoryCalls).toBe(2);
      expect(recognizeCalls).toBeGreaterThan(1);
      expect(result.stageTimings.map((timing) => timing.stage)).toEqual(expect.arrayContaining(["ocr", "ocr_hit_dense_frame_sampling", "ocr_dense_sampling"]));
      expect(result.frameRecords.filter((record) => record.evidence_kind === "frame_screenshot")).toHaveLength(3);
      expect(result.ocrRecords.filter((record) => record.kind === "text" && record.status === "ok")).toHaveLength(3);
      expect(result.claims.some((claim) => claim.verification_level === "ocr_extracted")).toBe(true);
      if ("timestampsSec" in result.assessment.frameSampling) {
        expect(result.assessment.frameSampling.timestampsSec).toEqual(expect.arrayContaining([9, 10, 11]));
        expect(result.assessment.frameSampling.denseSampling?.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: "ocr_text",
              hitTimestampsSec: [10],
              capturedTimestampsSec: expect.arrayContaining([9, 11])
            })
          ])
        );
      }
    } finally {
      await fixture.close();
    }
  });

  it("records browser-visible obstruction artifacts and claims", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

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
      expect(result.assessment.browserObstructions.detections).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "login_wall" })]));
      expect(result.runtimeAcquisitionPlan?.observedFailure).toBe("login_or_paywall");
      expect(result.runtimeAcquisitionPlan?.methods).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "consented_profile_or_human_byo_only",
            status: "terminal"
          })
        ])
      );
      expect(result.runtimeAcquisitionPlanRecords.some((record) => record.evidence_kind === "source_strategy")).toBe(true);
      expect(result.obstructionRecords.some((record) => record.evidence_kind === "browser_obstruction")).toBe(true);
      expect(result.claims.some((claim) => claim.evidence_kind === "browser_obstruction")).toBe(true);

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Browser obstructions: detected");
      expect(report).toContain("login_wall");
      expect(report).toContain("Runtime acquisition re-plan:");
      expect(report).toContain("consented_profile_or_human_byo_only");
    } finally {
      await fixture.close();
    }
  });

  it("runs a legal public gateway capture after a non-terminal browser obstruction", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping gateway escalation workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-gateway-"));
    runDirs.push(runDir);
    let gatewayCalled = false;

    try {
      const result = await runEvidenceWorkflow(
        {
          url: `${fixture.baseUrl}/media-unavailable`,
          runDir,
          captureId: "fixture-media-unavailable",
          waitMs: 0,
          sampleFrames: false
        },
        {
          publicGatewayCapture: async (input) => {
            gatewayCalled = true;
            const records = await input.writer.writeCaptureBundle({
              runDir: input.runDir,
              sourceUrl: input.url,
              contextToken: input.contextToken,
              pageId: input.pageId,
              captureId: `${input.captureId}-fake-gateway`,
              metadata: {
                captureTier: "feed",
                gateway: "jina_reader",
                gatewayUrl: "https://r.jina.ai/example"
              },
              text: "Gateway recovered enough public page text to register as legal gateway evidence.",
              captureMethod: "public-gateway:jina_reader",
              toolName: "public_gateway_capture",
              evidenceKind: "page_text"
            });
            return {
              ok: true,
              status: "ok",
              records,
              attempts: [
                {
                  key: "jina_reader",
                  gatewayUrl: "https://r.jina.ai/example",
                  status: "ok",
                  statusCode: 200
                }
              ]
            };
          }
        }
      );

      expect(gatewayCalled).toBe(true);
      expect(result.runtimeAcquisitionPlan?.observedFailure).toBe("browser_blocked");
      expect(result.publicGatewayRecords.some((record) => record.capture_method === "public-gateway:jina_reader")).toBe(true);
      expect(result.claims.some((claim) => claim.evidence_kind === "page_text" && claim.verification_level === "grounded")).toBe(true);

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Public gateway: ok");
      expect(report).toContain("jina_reader:ok");
    } finally {
      await fixture.close();
    }
  });

  it("dismisses benign overlays before evidence page capture", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

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
      expect(result.stageTimings.map((timing) => timing.stage)).toEqual(expect.arrayContaining(["browser_overlay_dismissal", "browser_overlay_dismissal_artifact"]));

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
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

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
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

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
        expect(result.assessment.frameSampling.denseSampling?.events).toEqual(
          expect.arrayContaining([
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
          ])
        );
        expect(result.assessment.frameSampling.sceneChangeDiagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              threshold: 16,
              maxHits: 1,
              selectedHitCount: 1,
              maxObservedDistance: expect.any(Number),
              distanceP90: expect.any(Number),
              thresholdRecommendation: expect.any(String)
            })
          ])
        );
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
    if (path === "/media-unavailable") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>Video unavailable</title></head><body>
        <main>
          <h1>Video unavailable</h1>
          <p>This video is unavailable. Something went wrong.</p>
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
    if (path === "/search") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>검색 결과 fixture</title></head><body>
        <main>
          <h1>검색 결과</h1>
          <a href="/blog/lorabounce-review">로라바운스 천호점: 주차 가격 놀이시설 음식 리뷰 (내돈내산)</a>
          <a href="/blog/lorabounce-seven">7살 내돈내산 키즈카페 추천 : 로라바운스 서울 천호점</a>
        </main>
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
