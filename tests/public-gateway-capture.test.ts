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
});
