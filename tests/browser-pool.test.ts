import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { BrowserPool } from "../src/browser-pool.js";
import { LeaseManager } from "../src/lease-manager.js";

let runDirs: string[] = [];

describe("BrowserPool", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("uses isolated BrowserContexts", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping browser isolation test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-browser-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const a = manager.acquire({ agentId: "a", runId: "run", artifactRunDir: runDir, allowedDomains: ["127.0.0.1"] });
      const b = manager.acquire({ agentId: "b", runId: "run", artifactRunDir: runDir, allowedDomains: ["127.0.0.1"] });
      const pageA = await pool.openPage("a", a.contextToken, `${fixture.baseUrl}/a`);
      const pageB = await pool.openPage("b", b.contextToken, `${fixture.baseUrl}/b`);

      const internalContexts = (pool as unknown as { contexts: Map<string, { pages: Map<string, { page: { evaluate: (fn: () => unknown) => Promise<unknown> } }> }> }).contexts;
      const internalPageA = internalContexts.get(a.contextToken)?.pages.get(pageA.pageId)?.page;
      const internalPageB = internalContexts.get(b.contextToken)?.pages.get(pageB.pageId)?.page;
      if (!internalPageA || !internalPageB) {
        throw new Error("Expected internal pages to exist for isolation test");
      }

      await internalPageA.evaluate(() => {
        document.cookie = "farm_context=a";
        localStorage.setItem("farm_context", "a");
      });

      const observedInB = await internalPageB.evaluate(() => ({
        cookie: document.cookie,
        localStorage: localStorage.getItem("farm_context")
      }));

      await pool.capturePage("a", a.contextToken, pageA.pageId, "a");
      await pool.capturePage("b", b.contextToken, pageB.pageId, "b");

      expect(manager.get(a.contextToken, "a").pages).toHaveLength(1);
      expect(manager.get(b.contextToken, "b").pages).toHaveLength(1);
      expect(observedInB).toEqual({ cookie: "", localStorage: null });
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("aborts low-level page waits with AbortSignal", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping browser abort test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-browser-abort-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({ agentId: "reader", runId: "run", artifactRunDir: runDir, allowedDomains: ["127.0.0.1"] });
      const page = await pool.openPage("reader", lease.contextToken, `${fixture.baseUrl}/dynamic`);
      const controller = new AbortController();
      const wait = pool.waitForPage("reader", lease.contextToken, page.pageId, 10_000, controller.signal);
      setTimeout(() => controller.abort("test cancel"), 10);
      await expect(wait).rejects.toMatchObject({ name: "AbortError" });
      await pool.releaseContext("reader", lease.contextToken);
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("dismisses benign overlays without clicking access-control buttons", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping overlay dismissal safety test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-overlay-safety-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({ agentId: "reader", runId: "run", artifactRunDir: runDir, allowedDomains: ["127.0.0.1"] });
      const page = await pool.openPage("reader", lease.contextToken, `${fixture.baseUrl}/overlay-actions`);
      const report = await pool.dismissBenignOverlays("reader", lease.contextToken, page.pageId, 5);
      await pool.capturePage("reader", lease.contextToken, page.pageId, "overlay-safety");

      expect(report.status).toBe("dismissed");
      expect(report.dismissedCount).toBeGreaterThan(0);
      expect(report.skippedCount).toBeGreaterThan(0);
      expect(report.actions).toEqual(expect.arrayContaining([expect.objectContaining({ status: "skipped", label: expect.stringContaining("log in") })]));

      const text = await readFile(join(runDir, "raw", "overlay-safety.txt"), "utf8");
      expect(text).not.toContain("cookie banner");
      expect(text).toContain("login required");
      expect(text).not.toContain("logged in");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures visible text and destination links from accessible frames", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping frame-aware capture test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-frame-capture-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({ agentId: "reader", runId: "run", artifactRunDir: runDir, allowedDomains: ["127.0.0.1"] });
      const page = await pool.openPage("reader", lease.contextToken, `${fixture.baseUrl}/framed-capture`);
      await pool.capturePage("reader", lease.contextToken, page.pageId, "framed");

      const text = await readFile(join(runDir, "raw", "framed.txt"), "utf8");
      expect(text).toContain("top shell evidence");
      expect(text).toContain("iframe-only place evidence");
      expect(text).toContain("성수 카페");

      const metadata = JSON.parse(await readFile(join(runDir, "structured", "framed.metadata.json"), "utf8")) as {
        visibleTextFrames?: {
          frameCount: number;
          textFrameCount: number;
          frames: Array<{ frameUrl: string; textLength: number; textSnippet?: string }>;
        };
        visibleLinks?: Array<{ url: string; text: string; frameUrl?: string }>;
      };
      expect(metadata.visibleTextFrames?.frameCount).toBeGreaterThanOrEqual(2);
      expect(metadata.visibleTextFrames?.textFrameCount).toBeGreaterThanOrEqual(2);
      expect(metadata.visibleTextFrames?.frames.some((frame) => frame.textSnippet?.includes("iframe-only place evidence"))).toBe(true);
      expect(metadata.visibleLinks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: `${fixture.baseUrl}/framed-destination`,
            text: "Frame destination"
          })
        ])
      );
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("persists storage-state profiles and allows non-payment write actions", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping profile persistence test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-profile-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const writer = manager.acquire({
        agentId: "writer",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write",
        storagePolicy: "storage-state",
        profileName: "test-profile",
        storageStatePath: join(runDir, "profiles", "test-profile", "storage-state.json")
      });
      const writePage = await pool.openPage("writer", writer.contextToken, `${fixture.baseUrl}/write`);
      await pool.fill("writer", writer.contextToken, writePage.pageId, "#name", "alice");
      await pool.click("writer", writer.contextToken, writePage.pageId, "#save");
      await pool.releaseContext("writer", writer.contextToken);

      const reader = manager.acquire({
        agentId: "reader",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        storagePolicy: "storage-state",
        profileName: "test-profile",
        storageStatePath: join(runDir, "profiles", "test-profile", "storage-state.json")
      });
      const checkPage = await pool.openPage("reader", reader.contextToken, `${fixture.baseUrl}/check`);
      await pool.capturePage("reader", reader.contextToken, checkPage.pageId, "profile-check");
      const text = await readFile(join(runDir, "raw", "profile-check.txt"), "utf8");
      expect(text).toContain("alice");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("persists OAuth-style popup consent in the same profile", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping popup consent test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-popup-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);
    const storageStatePath = join(runDir, "profiles", "popup-profile", "storage-state.json");

    try {
      const writer = manager.acquire({
        agentId: "writer",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write",
        storagePolicy: "storage-state",
        profileName: "popup-profile",
        storageStatePath
      });
      const loginPage = await pool.openPage("writer", writer.contextToken, `${fixture.baseUrl}/oauth-login`);
      await pool.click("writer", writer.contextToken, loginPage.pageId, "#connect");
      await pool.waitForPage("writer", writer.contextToken, loginPage.pageId, 500);
      await pool.releaseContext("writer", writer.contextToken);

      const reader = manager.acquire({
        agentId: "reader",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        storagePolicy: "storage-state",
        profileName: "popup-profile",
        storageStatePath
      });
      const checkPage = await pool.openPage("reader", reader.contextToken, `${fixture.baseUrl}/oauth-check`);
      await pool.capturePage("reader", reader.contextToken, checkPage.pageId, "popup-check");
      const text = await readFile(join(runDir, "raw", "popup-check.txt"), "utf8");
      expect(text).toContain("connected");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("rejects concurrent leases that share a profile", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping profile lock test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-profile-lock-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);
    const storageStatePath = join(runDir, "profiles", "locked-profile", "storage-state.json");

    try {
      const first = manager.acquire({
        agentId: "first",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        storagePolicy: "storage-state",
        profileName: "locked-profile",
        storageStatePath
      });
      await pool.openPage("first", first.contextToken, `${fixture.baseUrl}/write`);

      const second = manager.acquire({
        agentId: "second",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        storagePolicy: "storage-state",
        profileName: "locked-profile",
        storageStatePath
      });

      await expect(pool.openPage("second", second.contextToken, `${fixture.baseUrl}/write`)).rejects.toThrow(/already leased/);
      await pool.releaseContext("first", first.contextToken);
      await expect(pool.openPage("second", second.contextToken, `${fixture.baseUrl}/write`)).resolves.toMatchObject({ title: "write" });
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("blocks write actions on payment-like pages", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping payment guard test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-payment-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "writer",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("writer", lease.contextToken, `${fixture.baseUrl}/checkout`);
      await expect(pool.click("writer", lease.contextToken, page.pageId, "#pay")).rejects.toThrow(/payment-like/);

      const cartPage = await pool.openPage("writer", lease.contextToken, `${fixture.baseUrl}/cart`);
      await expect(pool.click("writer", lease.contextToken, cartPage.pageId, "#pay-now")).rejects.toThrow(/payment-like/);
      await expect(pool.fill("writer", lease.contextToken, cartPage.pageId, "#card-number", "4111111111111111")).rejects.toThrow(/payment-like/);
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("applies a lease-level user agent fingerprint", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping fingerprint test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-fingerprint-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "reader",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        fingerprint: {
          userAgent: "FarmTestAgent/1.0",
          locale: "ko-KR",
          timezoneId: "Asia/Seoul",
          viewport: { width: 777, height: 555 },
          colorScheme: "dark"
        }
      });
      const page = await pool.openPage("reader", lease.contextToken, `${fixture.baseUrl}/ua`);
      await pool.capturePage("reader", lease.contextToken, page.pageId, "fingerprint");
      const text = await readFile(join(runDir, "raw", "fingerprint.txt"), "utf8");
      expect(text).toContain("FarmTestAgent/1.0");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures image-like media artifacts and indexes skipped video bytes", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping media capture test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-media-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "reader",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"]
      });
      const page = await pool.openPage("reader", lease.contextToken, `${fixture.baseUrl}/media`);
      await pool.waitForSelector("reader", lease.contextToken, page.pageId, "#media-ready", 5_000);
      const capture = await pool.capturePage("reader", lease.contextToken, page.pageId, "media-capture");

      const mediaRecords = capture.records.filter((record) => record.kind === "media");
      expect(mediaRecords.length).toBeGreaterThanOrEqual(3);
      expect(mediaRecords.some((record) => record.mime === "image/png")).toBe(true);
      expect(mediaRecords.some((record) => record.mime === "image/svg+xml")).toBe(true);

      const mediaIndex = JSON.parse(await readFile(join(runDir, "structured", "media-capture.media-index.json"), "utf8")) as Array<{ mime: string; skipped: boolean; reason?: string }>;
      expect(mediaIndex.some((row) => row.mime === "video/mp4" && row.skipped && row.reason === "non_capturable_stream_or_binary_media")).toBe(true);

      const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
      expect(ledger).toContain('"kind":"media"');
      expect(ledger).toContain("media/media-capture/");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("samples timestamped media frames with per-frame metadata", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping frame sampling test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-frame-sample-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "reader",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"]
      });
      const page = await pool.openPage("reader", lease.contextToken, `${fixture.baseUrl}/frame-sample`);
      const sample = await pool.sampleFrames("reader", lease.contextToken, page.pageId, {
        selector: "#clip",
        captureId: "frame-sample",
        durationSec: 20,
        strideSec: 60,
        maxFrames: 3,
        seekTimeoutMs: 1_000,
        settleMs: 10
      });

      expect(sample.ok).toBe(true);
      expect(sample.plan.timestampsSec).toEqual([0, 10, 20]);
      expect(sample.frames).toHaveLength(3);
      expect(sample.frames.every((frame) => frame.status === "ok")).toBe(true);
      expect(sample.media.trackElements[0]).toMatchObject({ kind: "captions", label: "English" });

      const metadata = JSON.parse(await readFile(join(runDir, "structured", "frame-sample-frame-002-000010s.metadata.json"), "utf8")) as {
        frameSample: { timestampSec: number; seek: { ok: boolean }; activeCues: unknown[] };
      };
      expect(metadata.frameSample.timestampSec).toBe(10);
      expect(metadata.frameSample.seek.ok).toBe(true);
      await expect(readFile(join(runDir, "screenshots", "frame-sample-frame-002-000010s.png"))).resolves.toBeInstanceOf(Buffer);

      const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
      expect(ledger).toContain('"tool_name":"farm_sample_frames"');
      expect(ledger).toContain('"capture_method":"browser-agent-mcp-farm frame-sample"');
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("records partial frame artifacts when seeking fails", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping failed frame sampling test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-frame-partial-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "reader",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"]
      });
      const page = await pool.openPage("reader", lease.contextToken, `${fixture.baseUrl}/frame-sample-blocked`);
      const sample = await pool.sampleFrames("reader", lease.contextToken, page.pageId, {
        selector: "#clip",
        captureId: "frame-partial",
        timestampsSec: [10],
        strideSec: 60,
        maxFrames: 1,
        seekTimeoutMs: 500,
        settleMs: 10
      });

      expect(sample.ok).toBe(false);
      expect(sample.status).toBe("partial");
      expect(sample.frames[0]?.seek.reason).toContain("seek_failed");
      expect(sample.frames[0]?.records.some((record) => record.status === "partial")).toBe(true);

      const metadata = await readFile(join(runDir, "structured", "frame-partial-frame-001-000010s.metadata.json"), "utf8");
      expect(metadata).toContain("seek_failed");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("waits for selectors, scrolls, and captures after idle", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping wait/scroll test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-wait-scroll-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "reader",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"]
      });
      const page = await pool.openPage("reader", lease.contextToken, `${fixture.baseUrl}/dynamic`);
      await pool.waitForSelector("reader", lease.contextToken, page.pageId, "#late", 5_000);
      const scroll = await pool.scroll("reader", lease.contextToken, page.pageId, "bottom", 1_000);
      expect(scroll.scrollY).toBeGreaterThan(0);
      await pool.captureAfterIdle("reader", lease.contextToken, page.pageId, "dynamic-capture", 0, 100, 5_000);

      const text = await readFile(join(runDir, "raw", "dynamic-capture.txt"), "utf8");
      expect(text).toContain("late content");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("routes traffic through a lease-level proxy", async () => {
    const executableAvailable = await chromium
      .launch({ headless: true })
      .then(async (browser) => {
        await browser.close();
        return true;
      })
      .catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping proxy test because Playwright Chromium is not installed.");
      return;
    }

    const proxy = await startProxyFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-proxy-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "reader",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["proxy-smoke.test"],
        proxy: { server: proxy.proxyUrl }
      });
      const page = await pool.openPage("reader", lease.contextToken, "http://proxy-smoke.test/proxy-test");
      await pool.capturePage("reader", lease.contextToken, page.pageId, "proxy-test");
      const text = await readFile(join(runDir, "raw", "proxy-test.txt"), "utf8");
      expect(text).toContain("proxied-ok");
      expect(proxy.requestedUrls.some((url) => url.includes("proxy-smoke.test"))).toBe(true);
    } finally {
      await pool.shutdown();
      await proxy.close();
    }
  });
});

async function startFixtureServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0f766e"/></svg>', "utf8");
  const captions = Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nmedia fixture caption\n", "utf8");
  const fakeMp4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const server = createServer((request, response) => {
    const path = request.url?.split("?", 1)[0] ?? "/";
    if (path === "/image.png" || path === "/poster.png") {
      response.writeHead(200, { "content-type": "image/png", "content-length": String(tinyPng.byteLength) });
      response.end(tinyPng);
      return;
    }
    if (path === "/vector.svg") {
      response.writeHead(200, { "content-type": "image/svg+xml", "content-length": String(svg.byteLength) });
      response.end(svg);
      return;
    }
    if (path === "/captions.vtt") {
      response.writeHead(200, { "content-type": "text/vtt", "content-length": String(captions.byteLength) });
      response.end(captions);
      return;
    }
    if (path === "/clip.mp4") {
      response.writeHead(200, { "content-type": "video/mp4", "content-length": String(fakeMp4.byteLength) });
      response.end(fakeMp4);
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (path === "/write") {
      response.end(`<!doctype html><html><head><title>write</title></head><body>
        <input id="name" aria-label="name">
        <button id="save" onclick="localStorage.setItem('profile_name', document.querySelector('#name').value); document.body.append(' saved')">save</button>
      </body></html>`);
      return;
    }
    if (path === "/check") {
      response.end(`<!doctype html><html><head><title>check</title></head><body>
        <main id="value"></main>
        <script>document.querySelector('#value').textContent = localStorage.getItem('profile_name') || 'missing';</script>
      </body></html>`);
      return;
    }
    if (path === "/checkout") {
      response.end(`<!doctype html><html><head><title>checkout</title></head><body>
        <button id="pay">pay</button>
      </body></html>`);
      return;
    }
    if (path === "/cart") {
      response.end(`<!doctype html><html><head><title>cart</title></head><body>
        <button id="pay-now">Pay now</button>
        <input id="card-number" aria-label="Card number">
      </body></html>`);
      return;
    }
    if (path === "/oauth-login") {
      response.end(`<!doctype html><html><head><title>oauth</title></head><body>
        <button id="connect" onclick="window.open('/oauth-consent', 'consent', 'width=500,height=500')">connect</button>
      </body></html>`);
      return;
    }
    if (path === "/oauth-consent") {
      response.end(`<!doctype html><html><head><title>consent</title></head><body>
        <script>localStorage.setItem('oauth_state', 'connected'); setTimeout(() => window.close(), 50);</script>
        connected
      </body></html>`);
      return;
    }
    if (path === "/oauth-check") {
      response.end(`<!doctype html><html><head><title>oauth-check</title></head><body>
        <main id="value"></main>
        <script>document.querySelector('#value').textContent = localStorage.getItem('oauth_state') || 'missing';</script>
      </body></html>`);
      return;
    }
    if (path === "/ua") {
      response.end(`<!doctype html><html><head><title>ua</title></head><body>
        <main id="value"></main>
        <script>document.querySelector('#value').textContent = navigator.userAgent;</script>
      </body></html>`);
      return;
    }
    if (path === "/overlay-actions") {
      response.end(`<!doctype html><html><head><title>overlay actions</title></head><body>
        <main id="content">primary page</main>
        <div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;z-index:50;background:white">
          <p>cookie banner</p>
          <button id="reject" onclick="document.querySelector('#cookie-banner').remove()">Reject all</button>
        </div>
        <div id="login-wall" role="dialog" aria-modal="true" style="position:fixed;top:20px;left:20px;z-index:60;background:white">
          <p>login required</p>
          <button id="login" onclick="document.body.textContent = 'logged in'">Log in to continue</button>
        </div>
      </body></html>`);
      return;
    }
    if (path === "/framed-capture") {
      response.end(`<!doctype html><html><head><title>framed capture</title></head><body>
        <main>
          <h1>top shell evidence</h1>
          <iframe src="/framed-inner" title="inner evidence" style="width:420px;height:160px;border:0"></iframe>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/framed-inner") {
      response.end(`<!doctype html><html><head><title>inner evidence</title></head><body>
        <main>
          <h2>iframe-only place evidence</h2>
          <p>성수 카페 review text from accessible frame</p>
          <a href="/framed-destination">Frame destination</a>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/framed-destination") {
      response.end(`<!doctype html><html><head><title>framed destination</title></head><body>
        <main>destination page</main>
      </body></html>`);
      return;
    }
    if (path === "/media") {
      response.end(`<!doctype html><html><head><title>media</title></head><body>
        <main>
          <h1>media fixture</h1>
          <img id="png" src="/image.png" alt="png">
          <img id="svg" src="/vector.svg" alt="svg">
          <video id="clip" poster="/poster.png" preload="metadata">
            <source src="/clip.mp4" type="video/mp4">
            <track kind="captions" src="/captions.vtt" srclang="en" label="English" default>
          </video>
          <script>
            Promise.allSettled([fetch('/captions.vtt'), fetch('/clip.mp4')]).then(() => {
              const ready = document.createElement('div');
              ready.id = 'media-ready';
              ready.textContent = 'ready';
              document.body.appendChild(ready);
            });
          </script>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/frame-sample" || path === "/frame-sample-blocked") {
      const blocked = path === "/frame-sample-blocked";
      response.end(`<!doctype html><html><head><title>frame sample</title></head><body>
        <video id="clip" preload="metadata" style="display:block;width:320px;height:180px;background:#1f2937">
          <track kind="captions" src="/captions.vtt" srclang="en" label="English" default>
        </video>
        <script>
          const video = document.querySelector('#clip');
          let current = 0;
          Object.defineProperty(video, 'duration', { get: () => 20 });
          Object.defineProperty(video, 'currentTime', {
            get: () => current,
            set: (value) => {
              ${blocked ? "throw new Error('blocked seek');" : "current = Number(value); video.dataset.currentTime = current.toFixed(3); setTimeout(() => video.dispatchEvent(new Event('seeked')), 5);"}
            }
          });
          video.pause = () => {};
        </script>
      </body></html>`);
      return;
    }
    if (path === "/dynamic") {
      response.end(`<!doctype html><html><head><title>dynamic</title></head><body>
        <main style="min-height: 2200px">
          <h1>dynamic fixture</h1>
          <script>
            setTimeout(() => {
              const late = document.createElement('div');
              late.id = 'late';
              late.textContent = 'late content';
              late.style.marginTop = '1800px';
              document.body.appendChild(late);
            }, 100);
          </script>
        </main>
      </body></html>`);
      return;
    }
    response.end("<!doctype html><html><head><title>fixture</title></head><body>fixture</body></html>");
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolvePromise();
          }
        });
      })
  };
}

async function startProxyFixtureServer(): Promise<{ proxyUrl: string; requestedUrls: string[]; close: () => Promise<void> }> {
  const requestedUrls: string[] = [];
  const server = createServer((request, response) => {
    requestedUrls.push(request.url ?? "");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>proxy</title></head><body>proxied-ok ${request.url ?? ""}</body></html>`);
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Proxy fixture server did not bind to a TCP port");
  }

  return {
    proxyUrl: `http://127.0.0.1:${address.port}`,
    requestedUrls,
    close: () =>
      new Promise((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolvePromise();
          }
        });
      })
  };
}
