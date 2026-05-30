import { describe, expect, it } from "vitest";
import type { FarmService } from "../src/farm-service.js";
import { createMcpServer } from "../src/mcp-server.js";

describe("createMcpServer", () => {
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
});

function registeredTools(server: unknown): Record<string, { handler: (input: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> {
  return (server as { _registeredTools: Record<string, { handler: (input: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools;
}
