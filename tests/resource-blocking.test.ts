import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { BrowserPool } from "../src/browser-pool.js";
import { LeaseManager } from "../src/lease-manager.js";
import { shouldBlockRequest, BLOCKED_RESOURCE_TYPES } from "../src/resource-blocking.js";

// A3 (v0.5.0): the text capture profile aborts image/media/font + ad-host subrequests and skips the
// page screenshot, without changing page_html/page_text bytes.

describe("shouldBlockRequest (A3)", () => {
  it("blocks image/media/font resource types", () => {
    for (const type of BLOCKED_RESOURCE_TYPES) {
      expect(shouldBlockRequest(type, "https://example.com/x")).toBe(true);
    }
  });

  it("allows document/script/stylesheet/xhr (page_html/page_text bytes must survive)", () => {
    for (const type of ["document", "script", "stylesheet", "xhr", "fetch"]) {
      expect(shouldBlockRequest(type, "https://example.com/x")).toBe(false);
    }
  });

  it("blocks known ad/tracker hosts regardless of resource type", () => {
    expect(shouldBlockRequest("script", "https://www.googletagmanager.com/gtm.js")).toBe(true);
    expect(shouldBlockRequest("script", "https://pagead2.doubleclick.net/x")).toBe(true);
    expect(shouldBlockRequest("script", "https://example.com/app.js")).toBe(false);
  });
});

let runDirs: string[] = [];
let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  servers = [];
  await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  runDirs = [];
});

describe("BrowserPool text capture profile (A3, real Chromium)", () => {
  it("blocks an image subrequest and skips the screenshot, keeping page_html/page_text", async () => {
    const available = await chromium
      .launch({ headless: true })
      .then(async (b) => {
        await b.close();
        return true;
      })
      .catch(() => false);
    if (!available) {
      console.warn("Skipping A3 integration test: Playwright Chromium not installed.");
      return;
    }

    let imageRequested = false;
    const server = createServer((req, res) => {
      if ((req.url ?? "").startsWith("/img")) {
        imageRequested = true;
        res.writeHead(200, { "content-type": "image/png" });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><body><h1>Blocked Demo</h1><p>Visible body text.</p><img src="/img.png"></body></html>`);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const runDir = await mkdtemp(join(tmpdir(), "farm-a3-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { captureProfile: "text" });
    try {
      const lease = manager.acquire({ agentId: "a", runId: "r", artifactRunDir: runDir, allowedDomains: ["127.0.0.1"] });
      const page = await pool.openPage("a", lease.contextToken, `${baseUrl}/p`);
      const { records } = await pool.capturePage("a", lease.contextToken, page.pageId, "cap");

      const kinds = records.map((r) => r.evidence_kind);
      expect(kinds).toContain("page_html");
      expect(kinds).toContain("page_text");
      expect(kinds).not.toContain("page_screenshot"); // text profile skips the screenshot
      expect(imageRequested).toBe(false); // the <img> subrequest was aborted

      const internal = (pool as unknown as { contexts: Map<string, { blockedResourceCount: number }> }).contexts;
      expect(internal.get(lease.contextToken)?.blockedResourceCount ?? 0).toBeGreaterThan(0);
    } finally {
      await pool.shutdown();
    }
  });
});
