import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";
import { httpTier0Capture } from "../src/http-tier0-capture.js";

// A1 (v0.5.0): tier-0 browserless capture. A plain HTTP GET registers the SAME artifact contract as
// the browser path (page_html, page_text, structured_data) without launching Chromium, fencing every
// redirect against the lease domain allow-list, and declining (ok:false) on non-HTML / off-domain.

let roots: string[] = [];
let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  servers = [];
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
  roots = [];
});

async function startServer(handler: (path: string) => { status?: number; headers?: Record<string, string>; body: string }): Promise<{ baseUrl: string; host: string }> {
  const server = createServer((req, res) => {
    const out = handler(req.url ?? "/");
    res.writeHead(out.status ?? 200, { "content-type": "text/html; charset=utf-8", ...(out.headers ?? {}) });
    res.end(out.body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, host: "127.0.0.1" };
}

async function newRun(): Promise<{ writer: ArtifactWriter; runDir: string }> {
  const runDir = await mkdtemp(join(tmpdir(), "farm-tier0-"));
  roots.push(runDir);
  return { writer: new ArtifactWriter(), runDir };
}

const PAGE = `<!doctype html><html><head><title>Tier0 Demo</title>
<script type="application/ld+json">{"@type":"Product","name":"Gizmo","offers":{"@type":"Offer","price":"4500"}}</script>
</head><body><h1>Gizmo</h1><p>The price is 4,500 yen.</p><script>console.log('ignored')</script></body></html>`;

describe("httpTier0Capture (A1)", () => {
  it("captures page_html + page_text + structured_data from a server-rendered page, no browser", async () => {
    const { baseUrl, host } = await startServer(() => ({ body: PAGE }));
    const { writer, runDir } = await newRun();
    const result = await httpTier0Capture({ runDir, url: `${baseUrl}/p`, allowedDomains: [host], writer, captureId: "cap", contextToken: "ctx", pageId: "pg" });

    expect(result.ok).toBe(true);
    const kinds = result.records.map((r) => r.evidence_kind);
    expect(kinds).toContain("page_html");
    expect(kinds).toContain("page_text");
    expect(kinds).toContain("structured_data");

    const htmlRecord = result.records.find((r) => r.evidence_kind === "page_html");
    const html = await readFile(join(runDir, htmlRecord?.path as string), "utf8");
    expect(html).toContain("Gizmo");
    const textRecord = result.records.find((r) => r.evidence_kind === "page_text");
    const text = await readFile(join(runDir, textRecord?.path as string), "utf8");
    expect(text).toContain("The price is 4,500 yen.");
    expect(text).not.toContain("console.log"); // <script> stripped from visible text
  });

  it("declines (ok:false) on a non-HTML content-type so the caller escalates", async () => {
    const { baseUrl, host } = await startServer(() => ({ headers: { "content-type": "application/pdf" }, body: "%PDF-1.4" }));
    const { writer, runDir } = await newRun();
    const result = await httpTier0Capture({ runDir, url: `${baseUrl}/file`, allowedDomains: [host], writer, captureId: "cap", contextToken: "ctx", pageId: "pg" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/non-html/i);
    expect(result.records).toEqual([]);
  });

  it("declines on an off-domain redirect (the domain fence blocks the hop)", async () => {
    const { baseUrl, host } = await startServer(() => ({ status: 302, headers: { location: "https://evil.example/x" }, body: "" }));
    const { writer, runDir } = await newRun();
    const result = await httpTier0Capture({ runDir, url: `${baseUrl}/r`, allowedDomains: [host], writer, captureId: "cap", contextToken: "ctx", pageId: "pg" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not allowed|domain/i);
  });

  it("declines on a non-http(s) scheme", async () => {
    const { writer, runDir } = await newRun();
    const result = await httpTier0Capture({ runDir, url: "file:///etc/passwd", allowedDomains: ["127.0.0.1"], writer, captureId: "cap", contextToken: "ctx", pageId: "pg" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/non-http/i);
  });
});
