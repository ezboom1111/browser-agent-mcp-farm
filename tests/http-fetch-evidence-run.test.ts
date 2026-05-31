import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runEvidenceWorkflow } from "../src/evidence-runner.js";

// A1-wire (v0.5.0): an opt-in (httpFetch) evidence run captures via tier-0 browserless HTTP fetch,
// skips the browser entirely, and labels the page-capture claim http_fetch (NOT browser_visible).

let roots: string[] = [];
let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  servers = [];
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
  roots = [];
});

const PAGE = `<!doctype html><html><head><title>Server Rendered</title>
<script type="application/ld+json">{"@type":"Product","name":"Astrolabe"}</script></head>
<body><h1>Astrolabe</h1><p>Made in Kyoto.</p></body></html>`;

async function startServer(): Promise<{ baseUrl: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}` };
}

async function newRunDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "farm-httpfetch-run-"));
  roots.push(dir);
  return dir;
}

async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("evidence run with httpFetch (A1-wire)", () => {
  it("captures via tier-0, passes the claim gate, and labels the page capture http_fetch", async () => {
    const { baseUrl } = await startServer();
    const runDir = await newRunDir();
    const result = await runEvidenceWorkflow({ url: `${baseUrl}/p`, runDir, sampleFrames: false, httpFetch: true });

    expect(result.ok).toBe(true);

    // No browser was launched: the run-meta.json engine sidecar (written only on the browser path)
    // must be absent for a tier-0 run.
    const runMeta = await readFile(join(runDir, "run-meta.json"), "utf8").catch(() => "ABSENT");
    expect(runMeta).toBe("ABSENT");

    const claims = await readJsonl(join(runDir, "claims.jsonl"));
    const pageClaim = claims.find((c) => typeof c.claim === "string" && (c.claim as string).includes("page capture"));
    expect(pageClaim?.verification_level).toBe("http_fetch");
    expect(JSON.stringify(claims)).not.toContain("browser-visible page capture");

    // The structured_data + page artifacts are in the ledger.
    const artifacts = await readJsonl(join(runDir, "artifacts.jsonl"));
    const kinds = artifacts.map((a) => a.evidence_kind);
    expect(kinds).toContain("page_html");
    expect(kinds).toContain("page_text");
    expect(kinds).toContain("structured_data");
  });
});
