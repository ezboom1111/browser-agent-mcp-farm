import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FarmService } from "../src/farm-service.js";
import { createMcpServer } from "../src/mcp-server.js";

describe("createMcpServer", () => {
  let dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
    dirs = [];
  });

  it("registers farm_evidence_run", () => {
    const server = createMcpServer();
    const tools = registeredTools(server);
    expect(Object.keys(tools)).toContain("farm_evidence_run");
  });

  it("returns MCP isError when evidence-run final gate fails", async () => {
    const service = {
      evidenceRun: async () => ({ ok: false, runDir: "run", reportPath: "report", claimGate: { ok: false, errors: ["bad"], warnings: [] } })
    } as unknown as FarmService;
    const server = createMcpServer(service);
    const tool = registeredTools(server).farm_evidence_run;
    const result = await tool.handler({ url: "https://example.com/" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("\"ok\": false");
  });

  it("validates farm_evidence_run input", async () => {
    const service = {
      evidenceRun: async () => ({ ok: true })
    } as unknown as FarmService;
    const server = createMcpServer(service);
    const tool = registeredTools(server).farm_evidence_run;
    const result = await tool.handler({ url: "not-a-url" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("invalid");
  });

  it("accepts explicit source navigation recipes for farm_evidence_run", async () => {
    let received: unknown;
    const service = {
      evidenceRun: async (input: unknown) => {
        received = input;
        return { ok: true };
      }
    } as unknown as FarmService;
    const server = createMcpServer(service);
    const tool = registeredTools(server).farm_evidence_run;
    const result = await tool.handler({
      url: "https://example.com/",
      browserChannel: "chrome",
      denseSampling: {
        enabled: true,
        windowSec: 2,
        stepSec: 1,
        maxDenseFrames: 12,
        sceneChange: true,
        sceneChangeThreshold: 12,
        sceneChangeMaxHits: 3
      },
      sourceNavigation: {
        enabled: true,
        calibrate: true,
        calibrationSelectorTimeoutMs: 1000,
        actions: [
          { actionKey: "bounded-scroll", operation: "scroll", direction: "bottom" }
        ],
        perActionTimeoutMs: 5000,
        followUpConcurrency: 2,
        fallbackFollowUps: true,
        maxFallbackFollowUps: 1,
        maxDepth: 2,
        maxDeepeningRuns: 1,
        maxDeepeningRunsPerDomain: 1,
        deepeningConcurrency: 1,
        deepeningTimeoutMs: 7500,
        maxDeepeningArtifacts: 50
      }
    });

    expect(result.isError).toBeUndefined();
    expect(received).toMatchObject({
      browserChannel: "chrome",
      denseSampling: {
        enabled: true,
        windowSec: 2,
        stepSec: 1,
        maxDenseFrames: 12,
        sceneChange: true,
        sceneChangeThreshold: 12,
        sceneChangeMaxHits: 3
      },
      sourceNavigation: {
        enabled: true,
        calibrate: true,
        calibrationSelectorTimeoutMs: 1000,
        actions: [
          { actionKey: "bounded-scroll", operation: "scroll", direction: "bottom" }
        ],
        perActionTimeoutMs: 5000,
        followUpConcurrency: 2,
        fallbackFollowUps: true,
        maxFallbackFollowUps: 1,
        maxDepth: 2,
        maxDeepeningRuns: 1,
        maxDeepeningRunsPerDomain: 1,
        deepeningConcurrency: 1,
        deepeningTimeoutMs: 7500,
        maxDeepeningArtifacts: 50
      }
    });
  });

  it("gives every registered tool a real, non-stub description", () => {
    const server = createMcpServer();
    const tools = registeredTools(server);
    expect(Object.keys(tools).length).toBeGreaterThanOrEqual(20);
    for (const [name, entry] of Object.entries(tools)) {
      expect(entry.description, name).toBeTruthy();
      // The old generic stub was "<name> for the Browser-Agent MCP Farm".
      expect(entry.description ?? "", name).not.toMatch(/^farm_\w+ for the Browser-Agent MCP Farm$/);
    }
  });

  it("registers the read-only evidence-loop tools", () => {
    const tools = registeredTools(createMcpServer());
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining(["farm_read_report", "farm_list_artifacts", "farm_run_claim_gate"])
    );
  });

  it("farm_read_report reads a report file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-mcp-report-"));
    dirs.push(dir);
    const reportPath = join(dir, "report.md");
    await writeFile(reportPath, "# Report\nhello evidence\n", "utf8");

    const tool = registeredTools(createMcpServer()).farm_read_report;
    const result = await tool.handler({ reportPath });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("hello evidence");
  });

  it("farm_list_artifacts lists and filters the artifact ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-mcp-artifacts-"));
    dirs.push(dir);
    await writeFile(
      join(dir, "artifacts.jsonl"),
      `${JSON.stringify({ artifact_id: "a1", evidence_kind: "page_text" })}\n${JSON.stringify({ artifact_id: "a2", evidence_kind: "frame_screenshot" })}\n`,
      "utf8"
    );

    const tools = registeredTools(createMcpServer());
    const all = await tools.farm_list_artifacts.handler({ runDir: dir });
    expect(all.content[0].text).toContain('"total": 2');

    const filtered = await tools.farm_list_artifacts.handler({ runDir: dir, evidenceKind: "frame_screenshot" });
    expect(filtered.content[0].text).toContain('"total": 1');
    expect(filtered.content[0].text).toContain("a2");
  });

  it("farm_run_claim_gate flags a failing run as isError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-mcp-gate-"));
    dirs.push(dir);
    await writeFile(join(dir, "artifacts.jsonl"), "", "utf8");

    const tool = registeredTools(createMcpServer()).farm_run_claim_gate;
    const result = await tool.handler({ runDir: dir, mode: "final" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("claim count below required minimum");
  });
});

function registeredTools(server: unknown): Record<string, { description?: string; handler: (input: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> {
  return (server as { _registeredTools: Record<string, { description?: string; handler: (input: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools;
}
