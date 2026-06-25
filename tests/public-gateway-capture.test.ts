import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";
import { buildPublicGatewayCandidates, publicGatewayCapture } from "../src/public-gateway-capture.js";

let runDirs: string[] = [];

afterEach(async () => {
  await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  runDirs = [];
});

async function newRun(): Promise<{ writer: ArtifactWriter; runDir: string }> {
  const runDir = await mkdtemp(join(tmpdir(), "farm-public-gateway-"));
  runDirs.push(runDir);
  return { writer: new ArtifactWriter(), runDir };
}

describe("publicGatewayCapture", () => {
  it("builds a Jina Reader candidate for public http(s) URLs", () => {
    expect(buildPublicGatewayCandidates("https://example.com/article?q=1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "jina_reader",
          url: "https://r.jina.ai/https://example.com/article?q=1"
        })
      ])
    );
  });

  it("does not build third-party gateway URLs for local or private targets", () => {
    expect(buildPublicGatewayCandidates("http://127.0.0.1:3000/page")).toEqual([]);
    expect(buildPublicGatewayCandidates("http://192.168.0.5/page")).toEqual([]);
    expect(buildPublicGatewayCandidates("http://localhost/page")).toEqual([]);
  });

  it("registers successful public gateway bytes as page_text evidence with gateway provenance", async () => {
    const { writer, runDir } = await newRun();
    const calls: string[] = [];
    const result = await publicGatewayCapture({
      runDir,
      url: "https://example.com/article",
      writer,
      captureId: "cap",
      contextToken: "ctx",
      pageId: "pg",
      fetch: async (url) => {
        calls.push(url);
        return new Response("# Example Article\n\nThis public gateway response contains enough recovered article text to be useful as a registered evidence artifact.", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["https://r.jina.ai/https://example.com/article"]);
    expect(result.records.some((record) => record.evidence_kind === "page_text" && record.capture_method === "public-gateway:jina_reader")).toBe(true);

    const metadataRecord = result.records.find((record) => record.path.endsWith(".metadata.json"));
    expect(metadataRecord).toBeDefined();
    const metadata = JSON.parse(await readFile(join(runDir, metadataRecord?.path as string), "utf8")) as {
      gateway?: string;
      gatewayUrl?: string;
      captureTier?: string;
    };
    expect(metadata).toMatchObject({
      gateway: "jina_reader",
      gatewayUrl: "https://r.jina.ai/https://example.com/article",
      captureTier: "feed"
    });
  });

  it("falls back to the latest Wayback snapshot when the reader output is too thin", async () => {
    const { writer, runDir } = await newRun();
    const calls: string[] = [];
    const snapshotUrl = "https://web.archive.org/web/20200101000000/https://example.com/article";

    const result = await publicGatewayCapture({
      runDir,
      url: "https://example.com/article",
      writer,
      captureId: "cap",
      contextToken: "ctx",
      pageId: "pg",
      fetch: async (url) => {
        calls.push(url);
        if (url.startsWith("https://r.jina.ai/")) {
          return new Response("thin", { status: 200, headers: { "content-type": "text/plain" } });
        }
        if (url.startsWith("https://archive.org/wayback/available")) {
          return new Response(JSON.stringify({ archived_snapshots: { closest: { available: true, status: "200", url: snapshotUrl } } }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        if (url === snapshotUrl) {
          return new Response("<!doctype html><html><body><h1>Archived Article</h1><p>This archived page contains enough recovered public article text for registration and later claim-gate anchoring.</p></body></html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" }
          });
        }
        throw new Error(`unexpected URL ${url}`);
      }
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["https://r.jina.ai/https://example.com/article", "https://archive.org/wayback/available?url=https%3A%2F%2Fexample.com%2Farticle", snapshotUrl]);
    expect(result.attempts.map((attempt) => `${attempt.key}:${attempt.status}`)).toEqual(["jina_reader:declined", "wayback_latest:ok"]);
    expect(result.records.some((record) => record.capture_method === "public-gateway:wayback_latest" && record.evidence_kind === "page_text")).toBe(true);

    const textRecord = result.records.find((record) => record.kind === "text");
    expect(textRecord).toBeDefined();
    const text = await readFile(join(runDir, textRecord?.path as string), "utf8");
    expect(text).toContain("Archived Article");

    const metadataRecord = result.records.find((record) => record.path.endsWith(".metadata.json"));
    const metadata = JSON.parse(await readFile(join(runDir, metadataRecord?.path as string), "utf8")) as {
      gateway?: string;
      gatewaySnapshotUrl?: string;
    };
    expect(metadata).toMatchObject({
      gateway: "wayback_latest",
      gatewaySnapshotUrl: snapshotUrl
    });
  });
});
