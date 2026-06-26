import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";
import type { CandidateDeepeningLedger } from "../src/candidate-deepening-ledger.js";
import type { SearchStrategyPlan } from "../src/search-strategy-planner.js";
import { runCli } from "./helpers/cli-harness.js";

const runDirs: string[] = [];

afterEach(async () => {
  await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  runDirs.length = 0;
});

describe("cli search-followups command", () => {
  it("writes a bounded plan and outcome ledger without executing by default", async () => {
    const runDir = await makeCliParentRun();

    const { out, exitCode } = await runCli(["search-followups", "--run-dir", runDir, "--max-arms", "1", "--max-candidates", "1"]);
    const parsed = JSON.parse(out) as { ok: boolean; execute: boolean; plan: { items: Array<{ itemId: string }> }; outcomeLedger: { status: string; executedCount: number }; artifacts: { searchFollowupPlan: number; searchFollowupOutcomeLedger: number } };

    expect(exitCode).toBeUndefined();
    expect(parsed.ok).toBe(true);
    expect(parsed.execute).toBe(false);
    expect(parsed.plan.items.map((item) => item.itemId)).toEqual(["arm-dissent_probe", "candidate-1"]);
    expect(parsed.outcomeLedger.status).toBe("planned");
    expect(parsed.outcomeLedger.executedCount).toBe(0);
    expect(parsed.artifacts.searchFollowupPlan).toBeGreaterThan(0);
    expect(parsed.artifacts.searchFollowupOutcomeLedger).toBeGreaterThan(0);
  });

  it("requires a parent run directory", async () => {
    const { out, exitCode } = await runCli(["search-followups"]);

    expect(exitCode).toBe(1);
    expect(out).toContain("search-followups requires --run-dir <evidence-run-dir>");
  });
});

async function makeCliParentRun(): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "farm-cli-search-followups-"));
  runDirs.push(runDir);
  const sourceUrl = "https://search.example.test/?q=lorabounce";
  const writer = new ArtifactWriter();
  const searchStrategyPlan: SearchStrategyPlan = {
    schemaVersion: "1.0",
    sourceUrl,
    sourcePlatform: "google_search",
    sourceFamily: "search",
    intentStatus: "locked",
    status: "ok",
    baseQuery: "lorabounce review",
    arms: [
      {
        armId: "current_surface",
        rank: 1,
        platform: "google_search",
        purpose: "current",
        status: "try",
        risk: "low",
        query: "lorabounce review",
        url: sourceUrl,
        evidenceShapes: ["page_text"],
        rationale: "already captured",
        successMetric: "captured",
        failureMode: "none"
      },
      {
        armId: "dissent_probe",
        rank: 2,
        platform: "google_search",
        purpose: "dissent",
        status: "try",
        risk: "low",
        query: "lorabounce complaint",
        url: "https://www.google.com/search?q=lorabounce+complaint",
        evidenceShapes: ["page_text", "semi_structured_dom"],
        rationale: "refutation pass",
        successMetric: "negative leads",
        failureMode: "none"
      }
    ],
    antiHarnessGuard: "arms are hypotheses",
    caveats: [],
    questions: []
  };
  const candidateLedger: CandidateDeepeningLedger = {
    schemaVersion: "1.0",
    sourceUrl,
    status: "ok",
    selectedCount: 1,
    budget: { maxSelected: 1, candidateCount: 1 },
    decisions: [
      {
        candidateRank: 1,
        title: "Lorabounce review",
        url: "https://example.test/review",
        source: "example.test",
        selected: true,
        priority: "must_open",
        nextAction: "open_destination_capture",
        score: 20,
        risk: "low",
        reasons: ["review_intent_match"],
        warnings: [],
        recommendedEvidenceShapes: ["page_text", "page_html"]
      }
    ],
    caveats: []
  };
  await writer.writeCaptureBundle({
    runDir,
    sourceUrl,
    contextToken: "ctx",
    pageId: "search-strategy-plan",
    captureId: "cli-search-strategy-plan",
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
    captureId: "cli-candidate-deepening-ledger",
    text: JSON.stringify(candidateLedger, null, 2),
    metadata: { candidateDeepeningLedger: candidateLedger },
    captureMethod: "browser-agent-mcp-farm candidate-deepening-ledger",
    toolName: "candidate_deepening_ledger",
    evidenceKind: "candidate_deepening_ledger"
  });
  return runDir;
}
