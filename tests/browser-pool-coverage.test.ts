import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserPool } from "../src/browser-pool.js";
import { LeaseManager } from "../src/lease-manager.js";

// Cluster (A): no-browser validation paths. Every case here is proven (by reading
// src/browser-pool.ts) to throw a FarmError / AbortError on an entry guard BEFORE
// any chromium.launch() / context creation. No real Chromium, no network, no writes
// to real user dirs. The only state created is in-memory leases + an empty pool.
//
// runDirs is kept for parity with tests/browser-pool.test.ts; A-cases never write to
// disk (they throw before any artifact write), but any stray temp dir is cleaned up.
let runDirs: string[] = [];

describe("BrowserPool no-browser validation", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("A1: openPage rejects a disallowed domain before launching a browser", async () => {
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { browserChannel: "chromium" });
    try {
      const lease = manager.acquire({
        agentId: "a",
        runId: "r",
        artifactRunDir: "x",
        allowedDomains: ["example.com"]
      });
      await expect(pool.openPage("a", lease.contextToken, "https://evil.test/x")).rejects.toMatchObject({ code: "domain_not_allowed" });
      await expect(pool.openPage("a", lease.contextToken, "https://evil.test/x")).rejects.toThrow("Domain is not allowed for this lease: evil.test");
    } finally {
      await pool.shutdown();
    }
  });

  it("A2: openPage rejects an expired lease without launching a browser", async () => {
    let now = new Date("2026-05-25T00:00:00.000Z");
    const manager = new LeaseManager({ now: () => now });
    const pool = new BrowserPool(manager);
    try {
      const lease = manager.acquire({
        agentId: "a",
        runId: "r",
        artifactRunDir: "x",
        ttlMs: 1,
        allowedDomains: ["example.com"]
      });
      now = new Date("2026-05-25T00:00:00.005Z");
      const rejection = pool.openPage("a", lease.contextToken, "https://example.com/page");
      await expect(rejection).rejects.toMatchObject({ code: "lease_expired" });
      await expect(rejection).rejects.toThrow(/^Lease expired: ctx_/);
    } finally {
      await pool.shutdown();
    }
  });

  it("A3: openPage rejects when the page limit is exceeded (no browser)", async () => {
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);
    try {
      // maxPages: 0 makes pages.length (0) >= maxPages (0) true, so assertCanOpen
      // throws page_limit_exceeded before assertDomainAllowed and before ensureContext.
      const lease = manager.acquire({
        agentId: "a",
        runId: "r",
        artifactRunDir: "x",
        allowedDomains: ["example.com"],
        maxPages: 0
      } as Parameters<LeaseManager["acquire"]>[0]);
      const rejection = pool.openPage("a", lease.contextToken, "https://example.com/page");
      await expect(rejection).rejects.toMatchObject({ code: "page_limit_exceeded" });
      await expect(rejection).rejects.toThrow(/^Lease page limit exceeded: ctx_/);
    } finally {
      await pool.shutdown();
    }
  });

  it("A4: openPage honors a pre-aborted signal before any browser work", async () => {
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);
    try {
      const lease = manager.acquire({
        agentId: "a",
        runId: "r",
        artifactRunDir: "x",
        allowedDomains: ["example.com"]
      });
      const controller = new AbortController();
      controller.abort("cancel-now");
      const rejection = pool.openPage("a", lease.contextToken, "https://example.com/page", controller.signal);
      await expect(rejection).rejects.toMatchObject({ name: "AbortError" });
      await expect(rejection).rejects.toThrow("cancel-now");
    } finally {
      await pool.shutdown();
    }
  });

  it("A5: readClientState rejects an unsafe window property name", async () => {
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);
    try {
      const lease = manager.acquire({ agentId: "a", runId: "r", artifactRunDir: "x" });
      // isSafeWindowPropertyName guard runs first, before assertActive/getPageState.
      await expect(pool.readClientState("a", lease.contextToken, "page_x", "1bad name")).rejects.toMatchObject({ code: "client_state_property_invalid" });
      await expect(pool.readClientState("a", lease.contextToken, "page_x", "1bad name")).rejects.toThrow("Client state property must be a plain window property name: 1bad name");
      await expect(pool.readClientState("a", lease.contextToken, "page_x", "__proto__.x")).rejects.toMatchObject({ code: "client_state_property_invalid" });
    } finally {
      await pool.shutdown();
    }
  });

  it("A6: read-write mutation actions reject when the page is not found", async () => {
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);
    try {
      // capability MUST be read-write, otherwise assertCanMutate throws capability_denied
      // first; with read-write it passes and getPageState misses -> page_not_found.
      const rw = manager.acquire({
        agentId: "a",
        runId: "r",
        artifactRunDir: "x",
        allowedDomains: ["example.com"],
        capability: "read-write"
      });
      const expectPageNotFound = async (work: Promise<unknown>): Promise<void> => {
        await expect(work).rejects.toMatchObject({ code: "page_not_found" });
      };
      await expectPageNotFound(pool.click("a", rw.contextToken, "page_x", "#s"));
      await expectPageNotFound(pool.fill("a", rw.contextToken, "page_x", "#s", "v"));
      await expectPageNotFound(pool.press("a", rw.contextToken, "page_x", "Enter"));
      await expectPageNotFound(pool.selectOption("a", rw.contextToken, "page_x", "#s", "v"));
      await expect(pool.click("a", rw.contextToken, "page_x", "#s")).rejects.toThrow("Page not found: page_x");
    } finally {
      await pool.shutdown();
    }
  });

  it("A7: a write action is denied for a read-only lease (capability_denied)", async () => {
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);
    try {
      // default capability is read-only -> assertCanMutate throws before getPageState.
      const ro = manager.acquire({
        agentId: "a",
        runId: "r",
        artifactRunDir: "x",
        allowedDomains: ["example.com"]
      });
      await expect(pool.click("a", ro.contextToken, "page_x", "#s")).rejects.toMatchObject({ code: "capability_denied" });
      await expect(pool.click("a", ro.contextToken, "page_x", "#s")).rejects.toThrow(/^Lease does not allow write actions: ctx_/);
    } finally {
      await pool.shutdown();
    }
  });

  it("A8: read/capture methods reject when the page is not found", async () => {
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);
    try {
      const lease = manager.acquire({ agentId: "a", runId: "r", artifactRunDir: "x" });
      const t = lease.contextToken;
      const calls: Array<Promise<unknown>> = [
        pool.capturePage("a", t, "page_x", "cap"),
        pool.captureLocator("a", t, "page_x", "#s", "cap"),
        pool.closePage("a", t, "page_x"),
        pool.scroll("a", t, "page_x", "bottom", 10),
        pool.waitForSelector("a", t, "page_x", "#s", 1000),
        pool.waitForPage("a", t, "page_x", 5),
        pool.readVisibleText("a", t, "page_x"),
        pool.readLinkTargets("a", t, "page_x", "#s"),
        pool.inspectSelector("a", t, "page_x", "#s"),
        pool.discoverLinkTargets("a", t, "page_x"),
        pool.dismissBenignOverlays("a", t, "page_x"),
        pool.captureAfterIdle("a", t, "page_x", "c", 0, 0, 100),
        pool.sampleFrames("a", t, "page_x", {
          selector: "#v",
          strideSec: 1,
          maxFrames: 1,
          seekTimeoutMs: 100,
          settleMs: 0
        })
      ];
      for (const call of calls) {
        await expect(call).rejects.toMatchObject({ code: "page_not_found" });
      }
      await expect(pool.capturePage("a", t, "page_x", "cap")).rejects.toThrow("Page not found: page_x");
    } finally {
      await pool.shutdown();
    }
  });

  it("A9: capturePage and sampleFrames honor a pre-aborted signal before browser work", async () => {
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);
    try {
      const lease = manager.acquire({ agentId: "a", runId: "r", artifactRunDir: "x" });
      const controller = new AbortController();
      controller.abort("cancel-now");
      await expect(pool.capturePage("a", lease.contextToken, "p", "c", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
      await expect(pool.capturePage("a", lease.contextToken, "p", "c", controller.signal)).rejects.toThrow("cancel-now");
      await expect(
        pool.sampleFrames("a", lease.contextToken, "p", {
          selector: "#v",
          strideSec: 1,
          maxFrames: 1,
          seekTimeoutMs: 100,
          settleMs: 0,
          abortSignal: controller.signal
        })
      ).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      await pool.shutdown();
    }
  });

  it("A10: releaseContext / closeContext / shutdown / touchProfileLock are no-ops on an empty pool", async () => {
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);
    const lease = manager.acquire({ agentId: "a", runId: "r", artifactRunDir: "x" });

    // No page opened, so this.contexts has no entry: closeContext early-returns and
    // releaseContext just flips the lease to released via leaseManager.release.
    await expect(pool.releaseContext("a", lease.contextToken)).resolves.toBeUndefined();
    await expect(pool.closeContext("ctx_missing")).resolves.toBeUndefined();
    expect(() => pool.touchProfileLock("ctx_missing")).not.toThrow();
    await expect(pool.shutdown()).resolves.toBeUndefined();

    // The lease was released, so it is no longer active.
    expect(() => manager.assertActive(lease.contextToken)).toThrow(/^Lease is released: ctx_/);
  });
});
