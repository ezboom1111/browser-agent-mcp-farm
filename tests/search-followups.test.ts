import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";
import { buildBundleManifest, verifyBundle } from "../src/evidence-bundle.js";
import { buildSearchFollowupPlan, runSearchFollowups } from "../src/search-followups.js";
import type { CandidateDeepeningLedger } from "../src/candidate-deepening-ledger.js";
import type { SearchStrategyPlan } from "../src/search-strategy-planner.js";

const runDirs: string[] = [];

afterEach(async () => {
  await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  runDirs.length = 0;
});

describe("search followups", () => {
  it("builds a bounded follow-up queue from search arms and candidate decisions", async () => {
    const runDir = await makeParentRun();

    const plan = await buildSearchFollowupPlan({ runDir, maxArms: 2, maxCandidates: 2, maxTotal: 4 });

    expect(plan.status).toBe("ready");
    expect(plan.executionPolicy).toBe("bounded_explicit_followup");
    expect(plan.items.map((item) => item.itemId)).toEqual(["arm-naver_image_visual", "arm-dissent_probe", "candidate-1", "candidate-2"]);
    expect(plan.items.find((item) => item.itemId === "arm-current_surface")).toBeUndefined();
    expect(plan.items.find((item) => item.itemId === "candidate-3")?.nextAction).toBeUndefined();
    expect(plan.guards.join("\n")).toContain("not a platform crawler");
  });

  it("does not execute unless requested and writes a parent plan artifact", async () => {
    const runDir = await makeParentRun();
    const workflowRunner = vi.fn();

    const result = await runSearchFollowups({ runDir, execute: false, workflowRunner, maxArms: 1, maxCandidates: 1 });

    expect(workflowRunner).not.toHaveBeenCalled();
    expect(result.outcomeLedger.status).toBe("planned");
    expect(result.planRecords.some((record) => record.evidence_kind === "search_followup_plan")).toBe(true);
    expect(result.outcomeRecords.some((record) => record.evidence_kind === "search_followup_outcome_ledger")).toBe(true);
  });

  it("keeps follow-up artifacts append-only across repeated planning runs", async () => {
    const runDir = await makeParentRun();

    await runSearchFollowups({ runDir, execute: false, maxArms: 1, maxCandidates: 1 });
    await runSearchFollowups({ runDir, execute: false, maxArms: 1, maxCandidates: 1 });

    const rows = (await readFile(join(runDir, "artifacts.jsonl"), "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { evidence_kind?: string; path?: string });
    const followupPaths = rows
      .filter((row) => row.evidence_kind === "search_followup_plan" || row.evidence_kind === "search_followup_outcome_ledger")
      .map((row) => row.path)
      .filter((path): path is string => path !== undefined);

    expect(followupPaths).toHaveLength(8);
    expect(new Set(followupPaths).size).toBe(followupPaths.length);

    const manifest = await buildBundleManifest(runDir);
    const verification = await verifyBundle(runDir, manifest);
    expect(verification.ok).toBe(true);
    expect(verification.tamperedArtifacts).toEqual([]);
  });

  it("executes only runnable bounded items and records skipped manual/BYO outcomes", async () => {
    const runDir = await makeParentRun();
    const workflowRunner = vi.fn(async (options: { url: string; runDir: string }) => ({
      ok: true,
      runDir: options.runDir,
      reportPath: join(options.runDir, "reports", "final.md"),
      url: options.url
    }));

    const result = await runSearchFollowups({ runDir, execute: true, workflowRunner, maxArms: 1, maxCandidates: 3, maxTotal: 4 });

    expect(workflowRunner).toHaveBeenCalledTimes(3);
    expect(result.outcomeLedger.status).toBe("ok");
    expect(result.outcomeLedger.executedCount).toBe(3);
    expect(result.outcomeLedger.skippedCount).toBe(1);
    expect(workflowRunner.mock.calls[0]?.[0]).toMatchObject({ finalClaimGate: false });
    expect(result.outcomeLedger.outcomes.find((outcome) => outcome.itemId === "candidate-3")).toMatchObject({
      status: "skipped",
      reason: "manual_profile_or_byo"
    });
    expect(result.outcomeLedger.outcomes[0]?.childRunDir).toContain("search-followups");
  });

  it("uses fresh child run directories for repeated executions", async () => {
    const runDir = await makeParentRun();
    const workflowRunner = vi.fn(async (options: { url: string; runDir: string }) => ({
      ok: true,
      runDir: options.runDir,
      reportPath: join(options.runDir, "reports", "final.md"),
      url: options.url
    }));

    const first = await runSearchFollowups({ runDir, execute: true, workflowRunner, maxArms: 1, maxCandidates: 0, maxTotal: 1 });
    const second = await runSearchFollowups({ runDir, execute: true, workflowRunner, maxArms: 1, maxCandidates: 0, maxTotal: 1 });

    expect(first.outcomeLedger.outcomes[0]?.childRunDir).not.toBe(second.outcomeLedger.outcomes[0]?.childRunDir);
    expect(first.outcomeLedger.outcomes[0]?.childRunDir).toContain("execution-");
    expect(second.outcomeLedger.outcomes[0]?.childRunDir).toContain("execution-");
  });

  it("can require final claim gates for executed child runs", async () => {
    const runDir = await makeParentRun();
    const workflowRunner = vi.fn(async (options: { url: string; runDir: string; finalClaimGate?: boolean }) => ({
      ok: true,
      runDir: options.runDir,
      reportPath: join(options.runDir, "reports", "final.md"),
      url: options.url
    }));

    const result = await runSearchFollowups({ runDir, execute: true, workflowRunner, childFinalClaimGate: true, maxArms: 1, maxCandidates: 0, maxTotal: 1 });

    expect(workflowRunner).toHaveBeenCalledWith(expect.objectContaining({ finalClaimGate: true }));
    expect(result.outcomeLedger.outcomes[0]).toMatchObject({ status: "executed", finalClaimGate: true });
  });

  it("returns a missing-artifacts plan when the parent run has no search planning artifacts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-search-followups-empty-"));
    runDirs.push(runDir);

    const plan = await buildSearchFollowupPlan({ runDir });

    expect(plan.status).toBe("missing_artifacts");
    expect(plan.items).toEqual([]);
    expect(plan.warnings.join("\n")).toContain("search_strategy_plan");
  });
});

async function makeParentRun(): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "farm-search-followups-parent-"));
  runDirs.push(runDir);
  const writer = new ArtifactWriter();
  const sourceUrl = "https://search.naver.com/search.naver?where=image&query=lorabounce";
  const searchStrategyPlan: SearchStrategyPlan = {
    schemaVersion: "1.0",
    sourceUrl,
    sourcePlatform: "naver_search",
    sourceFamily: "search",
    intentStatus: "locked",
    status: "ok",
    baseQuery: "로라바운스 리뷰 내돈내산 사진",
    arms: [
      {
        armId: "current_surface",
        rank: 1,
        platform: "naver_search",
        purpose: "current",
        status: "try",
        risk: "low",
        query: "로라바운스 리뷰",
        url: sourceUrl,
        evidenceShapes: ["page_text"],
        rationale: "already captured",
        successMetric: "captured",
        failureMode: "none"
      },
      {
        armId: "naver_image_visual",
        rank: 2,
        platform: "naver_search",
        purpose: "visual",
        status: "try",
        risk: "low",
        query: "로라바운스 리뷰 사진",
        url: "https://search.naver.com/search.naver?where=image&query=%EB%A1%9C%EB%9D%BC%EB%B0%94%EC%9A%B4%EC%8A%A4",
        evidenceShapes: ["page_text", "ui_screenshot", "ocr_image_text"],
        rationale: "visual arm",
        successMetric: "visual candidates",
        failureMode: "thumbnail only"
      },
      {
        armId: "dissent_probe",
        rank: 3,
        platform: "naver_search",
        purpose: "dissent",
        status: "try",
        risk: "low",
        query: "로라바운스 단점",
        url: "https://search.naver.com/search.naver?where=view&query=%EB%A1%9C%EB%9D%BC%EB%B0%94%EC%9A%B4%EC%8A%A4%20%EB%8B%A8%EC%A0%90",
        evidenceShapes: ["page_text", "semi_structured_dom"],
        rationale: "dissent arm",
        successMetric: "negative leads",
        failureMode: "none"
      },
      {
        armId: "korean_community_review",
        rank: 4,
        platform: "naver_cafe",
        purpose: "community",
        status: "defer",
        risk: "medium",
        query: "로라바운스 카페",
        url: "https://search.naver.com/search.naver?where=cafe&query=%EB%A1%9C%EB%9D%BC%EB%B0%94%EC%9A%B4%EC%8A%A4",
        evidenceShapes: ["page_text"],
        rationale: "member risk",
        successMetric: "public snippets",
        failureMode: "member wall"
      }
    ],
    antiHarnessGuard: "Search arms are hypotheses",
    caveats: [],
    questions: []
  };
  const candidateLedger: CandidateDeepeningLedger = {
    schemaVersion: "1.0",
    sourceUrl,
    status: "ok",
    selectedCount: 3,
    budget: { maxSelected: 3, candidateCount: 3 },
    decisions: [
      {
        candidateRank: 1,
        title: "로라바운스 천호점 내돈내산 리뷰",
        url: "https://blog.naver.com/one/1",
        source: "blog.naver.com",
        selected: true,
        priority: "must_open",
        nextAction: "open_destination_capture",
        score: 23,
        risk: "low",
        reasons: ["review_intent_match"],
        warnings: [],
        recommendedEvidenceShapes: ["page_text", "page_html", "ui_screenshot"]
      },
      {
        candidateRank: 2,
        title: "로라바운스 주말 주차 후기",
        url: "https://blog.naver.com/two/2",
        source: "blog.naver.com",
        selected: true,
        priority: "must_open",
        nextAction: "open_destination_capture",
        score: 19,
        risk: "low",
        reasons: ["detail_terms_present"],
        warnings: [],
        recommendedEvidenceShapes: ["page_text", "page_html"]
      },
      {
        candidateRank: 3,
        title: "안양 애플트리 로라바운스 네이버 카페",
        url: "https://cafe.naver.com/example/3",
        source: "cafe.naver.com",
        selected: true,
        priority: "open",
        nextAction: "open_destination_capture",
        score: 16,
        risk: "medium",
        reasons: ["detail_terms_present"],
        warnings: ["possible_login_or_membership_wall"],
        recommendedEvidenceShapes: ["page_text"]
      }
    ],
    caveats: []
  };
  await writer.writeCaptureBundle({
    runDir,
    sourceUrl,
    contextToken: "ctx",
    pageId: "search-strategy-plan",
    captureId: "parent-search-strategy-plan",
    text: JSON.stringify(searchStrategyPlan, null, 2),
    metadata: { searchStrategyPlan },
    captureMethod: "browser-agent-mcp-farm search-strategy-plan",
    toolName: "search_strategy_plan",
    evidenceKind: "search_strategy_plan"
  });
  await writer.writeCaptureBundle({
    runDir,
    sourceUrl,
    contextToken: "ctx",
    pageId: "candidate-deepening-ledger",
    captureId: "parent-candidate-deepening-ledger",
    text: JSON.stringify(candidateLedger, null, 2),
    metadata: { candidateDeepeningLedger: candidateLedger },
    captureMethod: "browser-agent-mcp-farm candidate-deepening-ledger",
    toolName: "candidate_deepening_ledger",
    evidenceKind: "candidate_deepening_ledger"
  });
  expect(await readFile(join(runDir, "artifacts.jsonl"), "utf8")).toContain("search_strategy_plan");
  return runDir;
}
