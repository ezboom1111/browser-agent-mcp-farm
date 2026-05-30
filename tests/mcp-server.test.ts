import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";
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
    expect(result.content[0].text).toContain('"ok": false');
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
        actions: [{ actionKey: "bounded-scroll", operation: "scroll", direction: "bottom" }],
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
        actions: [{ actionKey: "bounded-scroll", operation: "scroll", direction: "bottom" }],
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
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(["farm_read_report", "farm_list_artifacts", "farm_run_claim_gate"]));
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
    await writeFile(join(dir, "artifacts.jsonl"), `${JSON.stringify({ artifact_id: "a1", evidence_kind: "page_text" })}\n${JSON.stringify({ artifact_id: "a2", evidence_kind: "frame_screenshot" })}\n`, "utf8");

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

  it("farm_read_artifact reads bytes, re-hashes, and flags tampering", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-mcp-readart-"));
    dirs.push(dir);
    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir: dir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx",
      pageId: "p",
      captureId: "c",
      text: "grounded evidence text"
    });
    const textRecord = records.find((record) => record.evidence_kind === "page_text");
    if (!textRecord) {
      throw new Error("expected a page_text artifact");
    }

    const tools = registeredTools(createMcpServer());
    const okResult = await tools.farm_read_artifact.handler({ runDir: dir, artifactId: textRecord.artifact_id });
    const ok = JSON.parse(okResult.content[0].text) as { found: boolean; tampered: boolean; content: string; recordedSha256: string; recomputedSha256: string };
    expect(okResult.isError).toBeUndefined();
    expect(ok.found).toBe(true);
    expect(ok.tampered).toBe(false);
    expect(ok.content).toContain("grounded evidence text");
    expect(ok.recomputedSha256).toBe(ok.recordedSha256);

    // Mutate the on-disk bytes after registration; the read must detect it.
    await writeFile(join(dir, textRecord.path), "tampered bytes", "utf8");
    const tamperedResult = await tools.farm_read_artifact.handler({ runDir: dir, path: textRecord.path });
    const tampered = JSON.parse(tamperedResult.content[0].text) as { tampered: boolean };
    expect(tampered.tampered).toBe(true);
    expect(tamperedResult.isError).toBe(true);
  });

  it("farm_register_evidence + farm_add_claim author a cite-or-fail grounded claim", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-mcp-author-"));
    dirs.push(dir);
    const tools = registeredTools(createMcpServer());

    const reg = JSON.parse(
      (
        await tools.farm_register_evidence.handler({
          runDir: dir,
          text: "The store is open now and rated 4.6.",
          evidenceKind: "page_text",
          sourceUrl: "https://example.com/"
        })
      ).content[0].text
    ) as { registered: boolean; artifactId: string };
    expect(reg.registered).toBe(true);

    // A grounded claim passes the gate.
    const good = await tools.farm_add_claim.handler({
      runDir: dir,
      claim: "The store is rated 4.6",
      claimType: "metadata",
      artifactId: reg.artifactId,
      evidenceKind: "page_text",
      anchor: { type: "text_span", quote: "rated 4.6" }
    });
    const goodParsed = JSON.parse(good.content[0].text) as { ok: boolean; appended: boolean };
    expect(good.isError).toBeUndefined();
    expect(goodParsed.ok).toBe(true);
    expect(goodParsed.appended).toBe(true);

    // An ungrounded claim fails the gate (cite-or-fail).
    const bad = await tools.farm_add_claim.handler({
      runDir: dir,
      claim: "The store is permanently closed",
      claimType: "metadata",
      artifactId: reg.artifactId,
      evidenceKind: "page_text",
      anchor: { type: "text_span", quote: "permanently closed" }
    });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("claim text not found in cited artifact");
  });

  it("farm_capabilities identifies the server with non-goals and evidence kinds", async () => {
    const tools = registeredTools(createMcpServer());
    const caps = JSON.parse((await tools.farm_capabilities.handler({})).content[0].text) as {
      serverName: string;
      evidenceKinds: string[];
      nonGoals: string[];
      optionalDeps: { tesseractAvailable: boolean };
    };
    expect(caps.serverName).toBe("browser-agent-mcp-farm");
    expect(Array.isArray(caps.evidenceKinds)).toBe(true);
    expect(caps.nonGoals.join(" ")).toContain("no payments");
    expect(typeof caps.optionalDeps.tesseractAvailable).toBe("boolean");
  });

  it("farm_list_runs finds a run directory with an artifact ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-runs-root-"));
    dirs.push(root);
    const runDir = join(root, "run-1");
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "artifacts.jsonl"), `${JSON.stringify({ artifact_id: "a1", path: "raw/x.txt", sha256: "0" })}\n`, "utf8");
    await writeFile(join(runDir, "claims.jsonl"), `${JSON.stringify({ claim_id: "c1" })}\n`, "utf8");

    const tools = registeredTools(createMcpServer());
    const listed = JSON.parse((await tools.farm_list_runs.handler({ runRoot: root })).content[0].text) as {
      runs: Array<{ artifactCount: number; claimCount: number }>;
    };
    expect(listed.runs.length).toBe(1);
    expect(listed.runs[0].artifactCount).toBe(1);
    expect(listed.runs[0].claimCount).toBe(1);
  });

  it("farm_extract_structured parses JSON-LD and Open Graph from captured HTML", async () => {
    const tools = registeredTools(createMcpServer());
    const res = JSON.parse(
      (
        await tools.farm_extract_structured.handler({
          html: '<script type="application/ld+json">{"@type":"Place","name":"Acme"}</script><meta property="og:title" content="Acme">'
        })
      ).content[0].text
    ) as { openGraph: Record<string, string>; jsonLd: unknown[] };
    expect(res.openGraph["og:title"]).toBe("Acme");
    expect(res.jsonLd.length).toBe(1);
  });

  it("farm_export_bundle + farm_verify_bundle round-trip and detect tampering", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-mcp-bundle-"));
    dirs.push(dir);
    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir: dir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx",
      pageId: "p",
      captureId: "c",
      text: "bundle evidence"
    });
    const textRecord = records.find((record) => record.kind === "text");
    if (!textRecord) {
      throw new Error("expected a text artifact");
    }

    const tools = registeredTools(createMcpServer());
    const exported = JSON.parse((await tools.farm_export_bundle.handler({ runDir: dir })).content[0].text) as {
      manifest: { merkleRoot: string };
    };
    expect(exported.manifest.merkleRoot).toMatch(/^[0-9a-f]{64}$/);

    const verified = await tools.farm_verify_bundle.handler({ runDir: dir, manifest: exported.manifest });
    expect(verified.isError).toBeUndefined();
    expect((JSON.parse(verified.content[0].text) as { ok: boolean }).ok).toBe(true);

    await writeFile(join(dir, textRecord.path), "tampered", "utf8");
    const reVerified = await tools.farm_verify_bundle.handler({ runDir: dir, manifest: exported.manifest });
    expect(reVerified.isError).toBe(true);
  });

  it("farm_extract_structured can load HTML from a run artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-mcp-struct-run-"));
    dirs.push(dir);
    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir: dir,
      sourceUrl: "https://example.com/",
      contextToken: "c",
      pageId: "p",
      captureId: "x",
      html: '<script type="application/ld+json">{"@type":"Place","name":"Acme"}</script>'
    });
    const htmlRecord = records.find((record) => record.evidence_kind === "page_html");
    if (!htmlRecord) {
      throw new Error("expected a page_html artifact");
    }

    const tools = registeredTools(createMcpServer());
    const res = JSON.parse((await tools.farm_extract_structured.handler({ runDir: dir, artifactId: htmlRecord.artifact_id })).content[0].text) as {
      jsonLd: unknown[];
      summary: { name?: string };
    };
    expect(res.jsonLd.length).toBe(1);
    expect(res.summary.name).toBe("Acme");
  });
});

function registeredTools(server: unknown): Record<string, { description?: string; handler: (input: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> {
  return (server as { _registeredTools: Record<string, { description?: string; handler: (input: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }> })._registeredTools;
}
