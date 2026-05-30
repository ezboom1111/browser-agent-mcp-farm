import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { ArtifactWriter } from "../src/artifact-writer.js";
import { BrowserPool } from "../src/browser-pool.js";
import { LeaseManager } from "../src/lease-manager.js";
import { executeSourceNavigationActions } from "../src/source-navigation-executor.js";
import { describeSourceNavigationPlan } from "../src/source-navigation.js";
import { describeSourceStrategy } from "../src/source-strategy.js";

let runDirs: string[] = [];

describe("executeSourceNavigationActions", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("executes only explicitly configured search actions and records action artifacts", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-search-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/navigation`);
      const plan = planFor("https://www.google.com/search?q=ramen");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          { actionKey: "query-state", operation: "fill", selector: "#query", value: "ramen" },
          { actionKey: "visible-filters", operation: "click", selector: "#filter" },
          { actionKey: "visible-sort", operation: "select", selector: "#sort", value: "date" },
          { actionKey: "result-selection", operation: "click", selector: "#details" },
          { actionKey: "destination-followup", operation: "wait_for_selector", selector: "#details-open" }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/navigation`,
        captureIdBase: "fixture-search",
        limits: { perActionTimeoutMs: 5_000 }
      });

      const statusByKey = new Map(result.actionResults.map((action) => [action.actionKey, action.status]));
      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(5);
      expect(result.skippedActionCount).toBe(2);
      expect(statusByKey.get("vertical-tab")).toBe("skipped");
      expect(statusByKey.get("result-pagination")).toBe("skipped");
      expect(statusByKey.get("query-state")).toBe("ok");
      expect(statusByKey.get("destination-followup")).toBe("ok");
      expect(result.records.some((record) => record.evidence_kind === "source_navigation_action")).toBe(true);

      const text = await readFile(join(runDir, "raw", "fixture-search-destination-followup-after.txt"), "utf8");
      expect(text).toContain("query: ramen");
      expect(text).toContain("filter: active");
      expect(text).toContain("sort: date");
      expect(text).toContain("details open");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures, scrolls, skips unconfigured generic actions, and records unsupported actions", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping generic source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-generic-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/navigation`);
      const plan = planFor(`${fixture.baseUrl}/navigation`);

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          { actionKey: "page-capture", operation: "capture" },
          { actionKey: "bounded-scroll", operation: "scroll", direction: "bottom" }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/navigation`,
        captureIdBase: "fixture-generic",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(2);
      expect(result.skippedActionCount).toBe(2);
      expect(result.unsupportedActionCount).toBe(1);
      const scrollResult = result.actionResults.find((action) => action.actionKey === "bounded-scroll");
      expect(scrollResult?.operationDetails?.scrollY).toEqual(expect.any(Number));
      expect(scrollResult?.operationDetails?.scrollY as number).toBeGreaterThan(0);

      const captureText = await readFile(join(runDir, "raw", "fixture-generic-page-capture-capture.txt"), "utf8");
      expect(captureText).toContain("navigation fixture");
      expect(result.records.some((record) => record.evidence_kind === "source_navigation_action" && record.status === "partial")).toBe(true);
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("records explicit follow-up destinations without navigating the parent page", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping follow-up source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-followup-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/navigation`);
      const plan = planFor(`${fixture.baseUrl}/navigation`);

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [{ actionKey: "destination-followup", operation: "follow_up", selector: "#destination-link", captureId: "fixture-destination" }],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/navigation`,
        captureIdBase: "fixture-followup",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.followUps).toEqual([
        expect.objectContaining({
          actionKey: "destination-followup",
          url: `${fixture.baseUrl}/destination`,
          selector: "#destination-link",
          linkText: "destination page",
          captureId: "fixture-destination"
        })
      ]);
      expect(result.executedActionCount).toBe(1);
      expect(result.actionResults.find((action) => action.actionKey === "destination-followup")?.followUp?.url).toBe(`${fixture.baseUrl}/destination`);

      const text = await readFile(join(runDir, "raw", "fixture-followup-destination-followup-after.txt"), "utf8");
      expect(text).toContain("navigation fixture");
      expect(text).not.toContain("destination fixture");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("skips hash-only self links when resolving broad follow-up selectors", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping hash follow-up source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-followup-hash-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/navigation`);
      const plan = planFor(`${fixture.baseUrl}/navigation`);

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [{ actionKey: "destination-followup", operation: "follow_up", selector: ".followup-candidate", captureId: "fixture-destination" }],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/navigation`,
        captureIdBase: "fixture-followup-hash",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.followUps).toEqual([
        expect.objectContaining({
          actionKey: "destination-followup",
          url: `${fixture.baseUrl}/destination`,
          selector: ".followup-candidate",
          linkText: "destination page"
        })
      ]);
      expect(result.actionResults.find((action) => action.actionKey === "destination-followup")?.followUp?.url).toBe(`${fixture.baseUrl}/destination`);
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("extracts multiple visible destination links without navigating the parent page", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping multi-destination source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-destinations-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/navigation`);
      const plan = planFor(`${fixture.baseUrl}/navigation`);

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#destination-candidates",
            maxLinks: 4,
            captureId: "fixture-extracted-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/navigation`,
        captureIdBase: "fixture-destination-extract",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.executedActionCount).toBe(1);
      expect(result.followUps).toEqual([
        expect.objectContaining({ url: `${fixture.baseUrl}/privacy`, linkText: "Privacy policy" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/official?query=ramen`, linkText: "Official ramen guide" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/blog/ramen`, linkText: "Ramen blog review" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/official?query=ramen#duplicate`, linkText: "Official ramen guide duplicate" })
      ]);
      const extraction = result.actionResults.find((action) => action.actionKey === "destination-followup");
      expect(extraction?.followUps).toHaveLength(4);
      expect(extraction?.operationDetails?.extractedDestinationCount).toBe(4);
      expect(extraction?.operationDetails?.duplicateDestinationCandidateCount).toBe(1);
      expect(extraction?.operationDetails?.omittedDuplicateDestinationCount).toBe(0);

      const text = await readFile(join(runDir, "raw", "fixture-destination-extract-destination-followup-after.txt"), "utf8");
      expect(text).toContain("navigation fixture");
      expect(text).not.toContain("official destination fixture");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("prefers unique extracted destinations before duplicate hash variants", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping destination extraction dedupe test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-destination-unique-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/navigation`);
      const plan = planFor(`${fixture.baseUrl}/navigation`);

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#destination-candidates-crowded",
            maxLinks: 4,
            captureId: "fixture-extracted-unique-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/navigation`,
        captureIdBase: "fixture-destination-unique-extract",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.executedActionCount).toBe(1);
      expect(result.followUps).toEqual([
        expect.objectContaining({ url: `${fixture.baseUrl}/privacy`, linkText: "Privacy policy" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/official?query=ramen`, linkText: "Official ramen guide" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/blog/ramen`, linkText: "Ramen blog review" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/community/ramen`, linkText: "Ramen community thread" })
      ]);
      expect(result.followUps.map((request) => request.url)).not.toContain(`${fixture.baseUrl}/official?query=ramen#duplicate`);
      const extraction = result.actionResults.find((action) => action.actionKey === "destination-followup");
      expect(extraction?.operationDetails?.extractedDestinationCount).toBe(4);
      expect(extraction?.operationDetails?.uniqueDestinationCandidateCount).toBe(4);
      expect(extraction?.operationDetails?.duplicateDestinationCandidateCount).toBe(1);
      expect(extraction?.operationDetails?.omittedDuplicateDestinationCount).toBe(1);
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("extracts visible non-anchor destination attributes for SPA-style cards", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping attribute destination extraction test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-destination-attrs-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/navigation`);
      const plan = planFor(`${fixture.baseUrl}/navigation`);

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#destination-candidates-attributes",
            maxLinks: 3,
            captureId: "fixture-extracted-attribute-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/navigation`,
        captureIdBase: "fixture-destination-attribute-extract",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.executedActionCount).toBe(1);
      expect(result.followUps).toEqual([
        expect.objectContaining({ url: `${fixture.baseUrl}/place/alpha`, linkText: "Cafe Alpha place card" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/official?query=spa`, linkText: "Official SPA card" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/blog/ramen`, linkText: "Ramen blog attribute" })
      ]);
      const extraction = result.actionResults.find((action) => action.actionKey === "destination-followup");
      expect(extraction?.operationDetails?.attributeDestinationCandidateCount).toBe(4);
      expect(extraction?.operationDetails?.anchorDestinationCandidateCount).toBe(0);
      expect(extraction?.operationDetails?.usableDestinationCandidateCount).toBe(3);
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures scoped map panels and verifies expected visible state", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping scoped map source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-map-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/map`);
      const plan = planFor("https://map.naver.com/p/search/cafe");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "query-state",
            operation: "fill",
            selector: "#map-query",
            value: "cafe",
            expectedStates: [{ selector: "#query-state", textIncludes: "query: cafe" }]
          },
          {
            actionKey: "map-viewport",
            operation: "capture",
            captureScopes: [{ key: "viewport", selector: "#map-viewport" }],
            expectedStates: [{ selector: "#map-viewport", textIncludes: "visible pins" }]
          },
          {
            actionKey: "selected-place",
            operation: "click",
            selector: "#place-alpha",
            captureScopes: [{ key: "place-panel", selector: "#place-panel" }],
            expectedStates: [{ selector: "#place-panel", textIncludes: "Cafe Alpha" }]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: '#root [data-place-url*="place.naver.com/restaurant"]',
            maxLinks: 3,
            captureId: "naver-map-place-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/map`,
        captureIdBase: "fixture-map",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(4);
      expect(result.skippedActionCount).toBe(2);
      expect(result.actionResults.find((action) => action.actionKey === "destination-followup")?.status).toBe("ok");
      expect(result.followUps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: "https://place.naver.com/restaurant/12345",
            linkText: "Cafe Alpha Naver Place restaurant page"
          })
        ])
      );
      const selectedPlace = result.actionResults.find((action) => action.actionKey === "selected-place");
      expect(selectedPlace?.status).toBe("ok");
      expect(selectedPlace?.assertionResults).toEqual(expect.arrayContaining([expect.objectContaining({ status: "ok", textIncludes: "Cafe Alpha" })]));
      expect(selectedPlace?.scopedCaptureArtifactIds?.length).toBeGreaterThan(0);
      expect(result.records.some((record) => record.tool_name === "farm_capture_scope" && record.kind === "screenshot")).toBe(true);

      const panelText = await readFile(join(runDir, "raw", "fixture-map-selected-place-scope-place-panel-after.txt"), "utf8");
      expect(panelText).toContain("Cafe Alpha");
      expect(panelText).toContain("review snippet");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("extracts Naver Place destinations from browser client state", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping client-state destination extraction test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-client-state-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });
    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/map`);
      const plan = planFor("https://map.naver.com/p/search/cafe");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "destination-followup",
            operation: "extract_client_state_destinations",
            selector: "#root",
            stateKey: "__APOLLO_STATE__",
            extractor: "naver_place_apollo",
            destinationPath: "restaurant",
            maxLinks: 2,
            captureId: "naver-map-state-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/map`,
        captureIdBase: "fixture-map-state",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.actionResults.find((action) => action.actionKey === "destination-followup")?.status).toBe("ok");
      expect(result.followUps).toEqual([
        expect.objectContaining({
          url: "https://map.naver.com/p/entry/place/12345",
          originalUrl: "https://place.naver.com/restaurant/12345",
          urlResolutionMethod: "naver_place_entry_fallback",
          linkText: "Cafe Alpha | cafe | 1 Alpha Road"
        }),
        expect.objectContaining({
          url: "https://map.naver.com/p/entry/place/67890",
          originalUrl: "https://place.naver.com/restaurant/67890",
          urlResolutionMethod: "naver_place_entry_fallback",
          linkText: "Cafe Beta | cafe | 2 Beta Road"
        })
      ]);
      expect(result.actionResults.find((action) => action.actionKey === "destination-followup")?.operationDetails).toMatchObject({
        stateKey: "__APOLLO_STATE__",
        extractor: "naver_place_apollo",
        extractedDestinationCount: 2,
        rawClientStateCandidateCount: 2,
        uniqueClientStateCandidateCount: 2
      });
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("extracts Naver Place destinations when client state lives in a visible iframe", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping frame client-state destination extraction test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-client-state-frame-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });
    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/map-client-state-frame`);
      const plan = planFor("https://map.naver.com/p/search/cafe");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "destination-followup",
            operation: "extract_client_state_destinations",
            selector: "#app-root",
            stateKey: "__APOLLO_STATE__",
            extractor: "naver_place_apollo",
            destinationPath: "restaurant",
            maxLinks: 2,
            captureId: "naver-map-frame-state-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/map-client-state-frame`,
        captureIdBase: "fixture-map-frame-state",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.actionResults.find((action) => action.actionKey === "destination-followup")?.status).toBe("ok");
      expect(result.followUps).toEqual([
        expect.objectContaining({
          url: "https://map.naver.com/p/entry/place/12345",
          originalUrl: "https://place.naver.com/restaurant/12345",
          urlResolutionMethod: "naver_place_entry_fallback",
          linkText: "Cafe Alpha | cafe | 1 Alpha Road"
        }),
        expect.objectContaining({
          url: "https://map.naver.com/p/entry/place/67890",
          originalUrl: "https://place.naver.com/restaurant/67890",
          urlResolutionMethod: "naver_place_entry_fallback",
          linkText: "Cafe Beta | cafe | 2 Beta Road"
        })
      ]);
      expect(result.actionResults.find((action) => action.actionKey === "destination-followup")?.operationDetails).toMatchObject({
        selector: "#app-root",
        clientStateMatchedFrameCount: 1,
        extractedDestinationCount: 2
      });
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures travel offer scopes and fails unmet expected states visibly", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping travel source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-travel-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/travel`);
      const plan = planFor("https://www.agoda.com/hotel/example.html");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "query-state",
            operation: "fill",
            selector: "#destination",
            value: "Seoul",
            expectedStates: [{ selector: "#query-state", textIncludes: "destination: Seoul" }]
          },
          {
            actionKey: "visible-filters",
            operation: "click",
            selector: "#breakfast-filter",
            expectedStates: [{ selector: "#filter-state", textIncludes: "breakfast included" }]
          },
          {
            actionKey: "visible-sort",
            operation: "select",
            selector: "#sort",
            value: "price",
            expectedStates: [{ selector: "#sort-state", textIncludes: "sort: price" }]
          },
          {
            actionKey: "offer-detail",
            operation: "click",
            selector: "#offer-detail",
            captureScopes: [{ key: "rate-panel", selector: "#rate-panel" }],
            expectedStates: [{ selector: "#rate-panel", textIncludes: "Free cancellation" }]
          },
          {
            actionKey: "price-ocr",
            operation: "capture",
            captureScopes: [{ key: "price-card", selector: "#price-card" }],
            expectedStates: [{ selector: "#price-card", textIncludes: "impossible text" }]
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/travel`,
        captureIdBase: "fixture-travel",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("error");
      expect(result.executedActionCount).toBe(4);
      expect(result.failedActionCount).toBe(1);
      expect(result.unsupportedActionCount).toBe(3);
      const priceOcr = result.actionResults.find((action) => action.actionKey === "price-ocr");
      expect(priceOcr?.status).toBe("error");
      expect(priceOcr?.error).toContain("Expected source navigation state failed");
      expect(priceOcr?.assertionResults).toEqual(expect.arrayContaining([expect.objectContaining({ status: "error", textIncludes: "impossible text" })]));

      const ratePanel = await readFile(join(runDir, "raw", "fixture-travel-offer-detail-scope-rate-panel-after.txt"), "utf8");
      expect(ratePanel).toContain("Free cancellation");
      expect(ratePanel).toContain("Taxes included");
      const priceCard = await readFile(join(runDir, "raw", "fixture-travel-price-ocr-scope-price-card-after.txt"), "utf8");
      expect(priceCard).toContain("KRW 120,000");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("executes vertical tabs, filters, and bounded pagination in a search fixture", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping search vertical/pagination source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-search-pagination-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/search`);
      const plan = planFor("https://search.naver.com/search.naver?query=ramen");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          { actionKey: "query-state", operation: "fill", selector: "#q", value: "ramen", expectedStates: [{ selector: "#query-state", textIncludes: "query: ramen" }] },
          {
            actionKey: "vertical-tab",
            operation: "click",
            selector: "#tab-blog",
            captureScopes: [{ key: "serp", selector: "#results" }],
            expectedStates: [{ selector: "#active-vertical", textIncludes: "vertical: blog" }]
          },
          { actionKey: "visible-filters", operation: "click", selector: "#recent-filter", expectedStates: [{ selector: "#filter-state", textIncludes: "filter: recent" }] },
          { actionKey: "visible-sort", operation: "select", selector: "#search-sort", value: "date", expectedStates: [{ selector: "#sort-state", textIncludes: "sort: date" }] },
          {
            actionKey: "result-pagination",
            operation: "click",
            selector: "#next-page",
            captureScopes: [{ key: "page-two", selector: "#results" }],
            expectedStates: [{ selector: "#page-state", textIncludes: "page: 2" }]
          },
          { actionKey: "result-selection", operation: "click", selector: "#result-two", expectedStates: [{ selector: "#selection-state", textIncludes: "selected: Page 2 result" }] }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/search`,
        captureIdBase: "fixture-search-pagination",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(6);
      expect(result.skippedActionCount).toBe(1);
      const pagination = result.actionResults.find((action) => action.actionKey === "result-pagination");
      expect(pagination?.status).toBe("ok");
      expect(pagination?.scopedCaptureArtifactIds?.length).toBeGreaterThan(0);

      const pageTwoText = await readFile(join(runDir, "raw", "fixture-search-pagination-result-pagination-scope-page-two-after.txt"), "utf8");
      expect(pageTwoText).toContain("Page 2 result");
      expect(pageTwoText).toContain("blog vertical result list");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures Naver integrated search modules and extracts mixed vertical destinations", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping Naver integrated search source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-naver-integrated-search-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/naver-integrated-search`);
      const plan = planFor("https://search.naver.com/search.naver?query=seongsu+cafe");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "query-state",
            operation: "fill",
            selector: "#naver-integrated-query",
            value: "seongsu cafe",
            expectedStates: [{ selector: "#query-state", textIncludes: "query: seongsu cafe" }]
          },
          {
            actionKey: "vertical-tab",
            operation: "click",
            selector: "#naver-tab-news",
            captureScopes: [{ key: "naver-news-module", selector: "#naver-news-module" }],
            expectedStates: [{ selector: "#active-vertical", textIncludes: "vertical: news" }]
          },
          {
            actionKey: "visible-filters",
            operation: "click",
            selector: "#naver-integrated-filter",
            captureScopes: [{ key: "naver-filter-state", selector: "#naver-integrated-filter-state" }],
            expectedStates: [{ selector: "#naver-integrated-filter-state", textIncludes: "filter: recent" }]
          },
          {
            actionKey: "visible-sort",
            operation: "select",
            selector: "#naver-integrated-sort",
            value: "date",
            expectedStates: [{ selector: "#naver-integrated-sort-state", textIncludes: "sort: date" }]
          },
          {
            actionKey: "result-pagination",
            operation: "click",
            selector: "#naver-integrated-more",
            captureScopes: [{ key: "naver-integrated-main", selector: "#naver-integrated-main" }],
            expectedStates: [{ selector: "#page-state", textIncludes: "page: 2" }]
          },
          {
            actionKey: "result-selection",
            operation: "capture",
            captureScopes: [
              { key: "naver-view-module", selector: "#naver-view-module" },
              { key: "naver-news-module", selector: "#naver-news-module" },
              { key: "naver-place-module", selector: "#naver-place-module" },
              { key: "naver-image-module", selector: "#naver-image-module" },
              { key: "naver-video-module", selector: "#naver-video-module" },
              { key: "naver-shopping-module", selector: "#naver-shopping-module" }
            ],
            expectedStates: [{ selector: "#naver-integrated-main", textIncludes: "Naver integrated search modules ready" }]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#naver-integrated-destination-links",
            maxLinks: 8,
            captureId: "naver-integrated-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/naver-integrated-search`,
        captureIdBase: "fixture-naver-integrated-search",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("ok");
      expect(result.executedActionCount).toBe(7);
      const followUpUrls = result.followUps.map((request) => request.url);
      expect(followUpUrls).toEqual(
        expect.arrayContaining([
          `${fixture.baseUrl}/naver-blog-destination`,
          `${fixture.baseUrl}/naver-cafe-destination`,
          `${fixture.baseUrl}/naver-news-destination`,
          `${fixture.baseUrl}/naver-place-destination`,
          `${fixture.baseUrl}/naver-image-destination`,
          `${fixture.baseUrl}/naver-video-destination`,
          `${fixture.baseUrl}/naver-shopping-destination`
        ])
      );
      expect(result.followUps.length).toBeGreaterThanOrEqual(7);

      const viewModule = await readFile(join(runDir, "raw", "fixture-naver-integrated-search-result-selection-scope-naver-view-module-after.txt"), "utf8");
      expect(viewModule).toContain("Naver Blog result");
      expect(viewModule).toContain("Naver Cafe result");
      const placeModule = await readFile(join(runDir, "raw", "fixture-naver-integrated-search-result-selection-scope-naver-place-module-after.txt"), "utf8");
      expect(placeModule).toContain("Place module");
      const shoppingModule = await readFile(join(runDir, "raw", "fixture-naver-integrated-search-result-selection-scope-naver-shopping-module-after.txt"), "utf8");
      expect(shoppingModule).toContain("Shopping module");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures Daum-like search result scopes and destination targets", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping Daum-like search source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-daum-search-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/daum-search`);
      const plan = planFor("https://search.daum.net/search?q=seongsu+cafe");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          { actionKey: "query-state", operation: "fill", selector: "#daum-query", value: "seongsu cafe", expectedStates: [{ selector: "#query-state", textIncludes: "query: seongsu cafe" }] },
          {
            actionKey: "vertical-tab",
            operation: "click",
            selector: "#daum-tab-cafe",
            captureScopes: [{ key: "daum-results", selector: "#daum-results" }],
            expectedStates: [{ selector: "#active-vertical", textIncludes: "vertical: cafe" }]
          },
          {
            actionKey: "visible-filters",
            operation: "click",
            selector: "#daum-filter",
            captureScopes: [{ key: "daum-filter-state", selector: "#daum-filter-state" }],
            expectedStates: [{ selector: "#daum-filter-state", textIncludes: "period: recent" }]
          },
          {
            actionKey: "result-selection",
            operation: "capture",
            captureScopes: [{ key: "daum-result-card", selector: "#daum-result-card" }],
            expectedStates: [{ selector: "#daum-result-card", textIncludes: "Daum result card" }]
          },
          {
            actionKey: "destination-followup",
            operation: "follow_up",
            selector: "#daum-result-link",
            captureId: "daum-search-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/daum-search`,
        captureIdBase: "fixture-daum-search",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(5);
      expect(result.skippedActionCount).toBe(2);
      expect(result.followUps).toEqual([
        expect.objectContaining({
          actionKey: "destination-followup",
          url: `${fixture.baseUrl}/daum-search-destination`,
          captureId: "daum-search-destination"
        })
      ]);

      const resultCard = await readFile(join(runDir, "raw", "fixture-daum-search-result-selection-scope-daum-result-card-after.txt"), "utf8");
      expect(resultCard).toContain("Daum result card");
      expect(resultCard).toContain("visible search snippet");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures fixture-backed Bing, Yahoo, and Yahoo Japan search scopes and destinations", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping global search source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-global-search-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    const cases = [
      {
        url: "https://www.bing.com/search?q=tokyo+hotel",
        path: "/bing-search",
        captureIdBase: "fixture-bing-search",
        querySelector: "#bing-query",
        tabSelector: "#bing-tab-news",
        filterSelector: "#bing-filter",
        nextSelector: "#bing-next-page",
        resultsSelector: "#bing-results",
        resultCardSelector: "#bing-result-card",
        destinationSelector: "#bing-destination-links",
        destinationUrl: `${fixture.baseUrl}/bing-destination`,
        expectedCardText: "Bing result card"
      },
      {
        url: "https://search.yahoo.com/search?p=tokyo+hotel",
        path: "/yahoo-search",
        captureIdBase: "fixture-yahoo-search",
        querySelector: "#yahoo-query",
        tabSelector: "#yahoo-tab-news",
        filterSelector: "#yahoo-filter",
        nextSelector: "#yahoo-next-page",
        resultsSelector: "#yahoo-results",
        resultCardSelector: "#yahoo-result-card",
        destinationSelector: "#yahoo-destination-links",
        destinationUrl: `${fixture.baseUrl}/yahoo-destination`,
        expectedCardText: "Yahoo Search result card"
      },
      {
        url: "https://search.yahoo.co.jp/search?p=tokyo+hotel",
        path: "/yahoo-japan-search",
        captureIdBase: "fixture-yahoo-japan-search",
        querySelector: "#yahoo-japan-query",
        tabSelector: "#yahoo-japan-tab-news",
        filterSelector: "#yahoo-japan-filter",
        nextSelector: "#yahoo-japan-next-page",
        resultsSelector: "#yahoo-japan-contents",
        resultCardSelector: "#yahoo-japan-result-card",
        destinationSelector: "#yahoo-japan-destination-links",
        destinationUrl: `${fixture.baseUrl}/yahoo-japan-destination`,
        expectedCardText: "Yahoo Japan result card"
      }
    ];

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });

      for (const searchCase of cases) {
        const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}${searchCase.path}`);
        const plan = planFor(searchCase.url);

        const result = await executeSourceNavigationActions({
          plan,
          executableActions: [
            { actionKey: "query-state", operation: "fill", selector: searchCase.querySelector, value: "tokyo hotel", expectedStates: [{ selector: "#query-state", textIncludes: "query: tokyo hotel" }] },
            {
              actionKey: "vertical-tab",
              operation: "click",
              selector: searchCase.tabSelector,
              captureScopes: [{ key: "results", selector: searchCase.resultsSelector }],
              expectedStates: [{ selector: "#active-vertical", textIncludes: "vertical: news" }]
            },
            {
              actionKey: "visible-filters",
              operation: "click",
              selector: searchCase.filterSelector,
              captureScopes: [{ key: "filter-state", selector: "#filter-state" }],
              expectedStates: [{ selector: "#filter-state", textIncludes: "filter: recent" }]
            },
            {
              actionKey: "result-pagination",
              operation: "click",
              selector: searchCase.nextSelector,
              captureScopes: [{ key: "page-two", selector: searchCase.resultsSelector }],
              expectedStates: [{ selector: "#page-state", textIncludes: "page: 2" }]
            },
            {
              actionKey: "result-selection",
              operation: "capture",
              captureScopes: [{ key: "result-card", selector: searchCase.resultCardSelector }],
              expectedStates: [{ selector: searchCase.resultCardSelector, textIncludes: searchCase.expectedCardText }]
            },
            {
              actionKey: "destination-followup",
              operation: "extract_destinations",
              selector: searchCase.destinationSelector,
              maxLinks: 3,
              captureId: `${searchCase.captureIdBase}-destination`
            }
          ],
          browserPool: pool,
          artifactWriter,
          agentId: "agent",
          contextToken: lease.contextToken,
          pageId: page.pageId,
          runDir,
          sourceUrl: `${fixture.baseUrl}${searchCase.path}`,
          captureIdBase: searchCase.captureIdBase,
          limits: { perActionTimeoutMs: 5_000 }
        });

        expect(result.executedActionCount).toBe(6);
        for (const actionKey of ["query-state", "vertical-tab", "visible-filters", "result-pagination", "result-selection", "destination-followup"]) {
          expect(result.actionResults.find((action) => action.actionKey === actionKey)?.status).toBe("ok");
        }
        expect(result.followUps).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              actionKey: "destination-followup",
              url: searchCase.destinationUrl
            })
          ])
        );

        const resultCard = await readFile(join(runDir, "raw", `${searchCase.captureIdBase}-result-selection-scope-result-card-after.txt`), "utf8");
        expect(resultCard).toContain(searchCase.expectedCardText);
        expect(resultCard).toContain("visible search snippet");
      }
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures Google-like filters, result cards, gallery scopes, and follow-up targets", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping Google-like source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-google-serp-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/google-search`);
      const plan = planFor("https://www.google.com/search?q=tokyo+hotel");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "query-state",
            operation: "fill",
            selector: "#google-query",
            value: "tokyo hotel",
            expectedStates: [{ selector: "#query-state", textIncludes: "query: tokyo hotel" }]
          },
          {
            actionKey: "vertical-tab",
            operation: "click",
            selector: "#tab-images",
            captureScopes: [{ key: "serp-module", selector: "#serp-module" }],
            expectedStates: [{ selector: "#vertical-state", textIncludes: "vertical: images" }]
          },
          {
            actionKey: "visible-filters",
            operation: "click",
            selector: "#tools",
            captureScopes: [{ key: "filter-panel", selector: "#filter-panel" }],
            expectedStates: [{ selector: "#filter-panel", textIncludes: "date and rating filters visible" }]
          },
          {
            actionKey: "visible-sort",
            operation: "select",
            selector: "#google-sort",
            value: "recent",
            expectedStates: [{ selector: "#sort-state", textIncludes: "sort: recent" }]
          },
          {
            actionKey: "result-pagination",
            operation: "click",
            selector: "#more-results",
            captureScopes: [{ key: "expanded-results", selector: "#results" }],
            expectedStates: [{ selector: "#page-state", textIncludes: "more results loaded" }]
          },
          {
            actionKey: "result-selection",
            operation: "click",
            selector: "#open-result",
            captureScopes: [
              { key: "result-card", selector: "#result-card" },
              { key: "gallery", selector: "#gallery" }
            ],
            expectedStates: [
              { selector: "#selection-state", textIncludes: "selected: Tokyo Station Hotel" },
              { selector: "#gallery", textIncludes: "Gallery image two" }
            ]
          },
          {
            actionKey: "destination-followup",
            operation: "follow_up",
            selector: "#result-link",
            captureId: "google-result-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/google-search`,
        captureIdBase: "fixture-google-serp",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("ok");
      expect(result.executedActionCount).toBe(7);
      expect(result.skippedActionCount).toBe(0);
      expect(result.unsupportedActionCount).toBe(0);
      expect(result.followUps).toEqual([
        expect.objectContaining({
          actionKey: "destination-followup",
          url: `${fixture.baseUrl}/google-destination`,
          linkText: "Tokyo Station Hotel official site",
          captureId: "google-result-destination"
        })
      ]);

      const filterPanel = await readFile(join(runDir, "raw", "fixture-google-serp-visible-filters-scope-filter-panel-after.txt"), "utf8");
      expect(filterPanel).toContain("date and rating filters visible");
      const resultCard = await readFile(join(runDir, "raw", "fixture-google-serp-result-selection-scope-result-card-after.txt"), "utf8");
      expect(resultCard).toContain("Tokyo Station Hotel");
      expect(resultCard).toContain("price badge");
      const gallery = await readFile(join(runDir, "raw", "fixture-google-serp-result-selection-scope-gallery-after.txt"), "utf8");
      expect(gallery).toContain("Gallery image two");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures Google-like rich modules and extracts mixed destinations", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping Google-like module source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-google-modules-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/google-modules`);
      const plan = planFor("https://www.google.com/search?q=best+cafe");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "query-state",
            operation: "fill",
            selector: "#module-query",
            value: "best cafe",
            expectedStates: [{ selector: "#query-state", textIncludes: "query: best cafe" }]
          },
          {
            actionKey: "vertical-tab",
            operation: "click",
            selector: "#google-tab-news",
            captureScopes: [{ key: "news-cluster", selector: "#news-cluster" }],
            expectedStates: [{ selector: "#vertical-state", textIncludes: "vertical: news" }]
          },
          {
            actionKey: "visible-filters",
            operation: "click",
            selector: "#show-ads",
            captureScopes: [{ key: "ad-module", selector: "#ad-module" }],
            expectedStates: [{ selector: "#ad-module", textIncludes: "Sponsored" }]
          },
          {
            actionKey: "result-selection",
            operation: "capture",
            captureScopes: [
              { key: "google-local-module", selector: "#google-local-module" },
              { key: "map-pack", selector: "#map-pack" },
              { key: "google-news-module", selector: "#google-news-module" },
              { key: "google-image-module", selector: "#google-image-module" },
              { key: "google-video-module", selector: "#google-video-module" },
              { key: "google-travel-module", selector: "#google-travel-module" },
              { key: "google-hotel-offer-card", selector: "#google-hotel-offer-card" },
              { key: "ad-card", selector: "#ad-module" }
            ],
            expectedStates: [{ selector: "#module-state", textIncludes: "modules ready" }]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#google-destination-links",
            maxLinks: 9,
            captureId: "google-module-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/google-modules`,
        captureIdBase: "fixture-google-modules",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(5);
      expect(result.skippedActionCount).toBe(2);
      expect(result.followUps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ actionKey: "destination-followup", url: `${fixture.baseUrl}/google-organic-destination` }),
          expect.objectContaining({ actionKey: "destination-followup", url: `${fixture.baseUrl}/google-news-destination` }),
          expect.objectContaining({ actionKey: "destination-followup", url: `${fixture.baseUrl}/google-local-destination` }),
          expect.objectContaining({ actionKey: "destination-followup", url: `${fixture.baseUrl}/google-image-destination` }),
          expect.objectContaining({ actionKey: "destination-followup", url: `${fixture.baseUrl}/google-video-destination` }),
          expect.objectContaining({ actionKey: "destination-followup", url: `${fixture.baseUrl}/google-travel-destination` }),
          expect.objectContaining({ actionKey: "destination-followup", url: `${fixture.baseUrl}/google-travel-search-destination` }),
          expect.objectContaining({ actionKey: "destination-followup", url: `${fixture.baseUrl}/google-hotel-destination` }),
          expect.objectContaining({ actionKey: "destination-followup", url: `${fixture.baseUrl}/google-hotel-offer-destination` })
        ])
      );
      expect(result.actionResults.find((action) => action.actionKey === "destination-followup")?.operationDetails).toMatchObject({
        attributeDestinationCandidateCount: 5
      });

      const localModule = await readFile(join(runDir, "raw", "fixture-google-modules-result-selection-scope-google-local-module-after.txt"), "utf8");
      expect(localModule).toContain("Local module");
      const mapPack = await readFile(join(runDir, "raw", "fixture-google-modules-result-selection-scope-map-pack-after.txt"), "utf8");
      expect(mapPack).toContain("Map pack");
      expect(mapPack).toContain("rating 4.6");
      const newsModule = await readFile(join(runDir, "raw", "fixture-google-modules-result-selection-scope-google-news-module-after.txt"), "utf8");
      expect(newsModule).toContain("News cluster");
      const imageModule = await readFile(join(runDir, "raw", "fixture-google-modules-result-selection-scope-google-image-module-after.txt"), "utf8");
      expect(imageModule).toContain("Image module");
      const videoModule = await readFile(join(runDir, "raw", "fixture-google-modules-result-selection-scope-google-video-module-after.txt"), "utf8");
      expect(videoModule).toContain("Video module");
      const travelModule = await readFile(join(runDir, "raw", "fixture-google-modules-result-selection-scope-google-travel-module-after.txt"), "utf8");
      expect(travelModule).toContain("Travel hotel module");
      const offerCard = await readFile(join(runDir, "raw", "fixture-google-modules-result-selection-scope-google-hotel-offer-card-after.txt"), "utf8");
      expect(offerCard).toContain("Free cancellation");
      const adCard = await readFile(join(runDir, "raw", "fixture-google-modules-result-selection-scope-ad-card-after.txt"), "utf8");
      expect(adCard).toContain("Sponsored");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures Korean and global news modules with publisher follow-up and obstruction state", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping news portal source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const cases = [
      {
        id: "naver-news",
        path: "/naver-news",
        url: "https://search.naver.com/search.naver?where=news&query=ai",
        querySelector: "#naver-news-query",
        sectionSelector: "#naver-news-section",
        filterSelector: "#naver-news-recent",
        moreSelector: "#naver-news-more",
        destinationPath: "/naver-news-destination",
        headline: "Naver headline card"
      },
      {
        id: "daum-news",
        path: "/daum-news",
        url: "https://search.daum.net/search?w=news&q=ai",
        querySelector: "#daum-news-query",
        sectionSelector: "#daum-news-section",
        filterSelector: "#daum-news-recent",
        moreSelector: "#daum-news-more",
        destinationPath: "/daum-news-destination",
        headline: "Daum headline card"
      },
      {
        id: "yahoo-news",
        path: "/yahoo-news",
        url: "https://news.yahoo.com/search?p=ai",
        querySelector: "#yahoo-news-query",
        sectionSelector: "#yahoo-news-section",
        filterSelector: "#yahoo-news-recent",
        moreSelector: "#yahoo-news-more",
        destinationPath: "/yahoo-news-destination",
        headline: "Yahoo News headline card"
      },
      {
        id: "reuters-news",
        path: "/reuters-news",
        url: "https://www.reuters.com/world/us/ai-policy-2026-05-28/",
        querySelector: "#reuters-query",
        sectionSelector: "#reuters-section",
        filterSelector: "#reuters-recent",
        moreSelector: "#reuters-more",
        destinationPath: "/reuters-news-destination",
        headline: "Reuters headline card"
      }
    ];

    try {
      for (const item of cases) {
        const runDir = await mkdtemp(join(tmpdir(), `farm-source-nav-${item.id}-`));
        runDirs.push(runDir);
        const artifactWriter = new ArtifactWriter();
        const manager = new LeaseManager();
        const pool = new BrowserPool(manager, { artifactWriter });

        try {
          const lease = manager.acquire({
            agentId: "agent",
            runId: item.id,
            artifactRunDir: runDir,
            allowedDomains: ["127.0.0.1"],
            capability: "read-write"
          });
          const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}${item.path}`);
          const plan = planFor(item.url);

          const result = await executeSourceNavigationActions({
            plan,
            executableActions: [
              {
                actionKey: "query-state",
                operation: "fill",
                selector: item.querySelector,
                value: "ai",
                expectedStates: [{ selector: "#query-state", textIncludes: "query: ai" }]
              },
              {
                actionKey: "news-section",
                operation: "click",
                selector: item.sectionSelector,
                captureScopes: [{ key: "section", selector: "#news-section-state" }],
                expectedStates: [{ selector: "#news-section-state", textIncludes: "section: society" }]
              },
              {
                actionKey: "visible-filters",
                operation: "click",
                selector: item.filterSelector,
                captureScopes: [{ key: "filters", selector: "#news-filter-state" }],
                expectedStates: [{ selector: "#news-filter-state", textIncludes: "sort: latest" }]
              },
              {
                actionKey: "result-pagination",
                operation: "click",
                selector: item.moreSelector,
                captureScopes: [{ key: "news-module", selector: "#news-module" }],
                expectedStates: [{ selector: "#news-module", textIncludes: "Second page headline" }]
              },
              {
                actionKey: "article-capture",
                operation: "capture",
                captureScopes: [
                  { key: "news-module", selector: "#news-module" },
                  { key: "headline-card", selector: "#headline-card" },
                  { key: "publisher-meta", selector: "#publisher-meta" }
                ],
                expectedStates: [{ selector: "#headline-card", textIncludes: item.headline }]
              },
              {
                actionKey: "destination-followup",
                operation: "follow_up",
                selector: "#news-link",
                captureId: `${item.id}-publisher`
              },
              {
                actionKey: "obstruction-check",
                operation: "capture",
                captureScopes: [{ key: "obstruction-state", selector: "#news-obstruction-state" }],
                expectedStates: [{ selector: "#news-obstruction-state", textIncludes: "paywall: none" }]
              }
            ],
            browserPool: pool,
            artifactWriter,
            agentId: "agent",
            contextToken: lease.contextToken,
            pageId: page.pageId,
            runDir,
            sourceUrl: `${fixture.baseUrl}${item.path}`,
            captureIdBase: `fixture-${item.id}`,
            limits: { perActionTimeoutMs: 5_000 }
          });

          expect(result.status).toBe("partial");
          expect(result.executedActionCount).toBe(7);
          expect(result.skippedActionCount).toBe(0);
          expect(result.unsupportedActionCount).toBe(3);
          expect(result.followUps).toEqual([
            expect.objectContaining({
              actionKey: "destination-followup",
              url: `${fixture.baseUrl}${item.destinationPath}`,
              captureId: `${item.id}-publisher`
            })
          ]);

          const moduleText = await readFile(join(runDir, "raw", `fixture-${item.id}-article-capture-scope-news-module-after.txt`), "utf8");
          expect(moduleText).toContain(item.headline);
          expect(moduleText).toContain("Second page headline");
          const publisher = await readFile(join(runDir, "raw", `fixture-${item.id}-article-capture-scope-publisher-meta-after.txt`), "utf8");
          expect(publisher).toContain("publisher:");
          expect(publisher).toContain("published:");
          const obstruction = await readFile(join(runDir, "raw", `fixture-${item.id}-obstruction-check-scope-obstruction-state-after.txt`), "utf8");
          expect(obstruction).toContain("paywall: none");
          expect(obstruction).toContain("login: not required");
        } finally {
          await pool.shutdown();
        }
      }
    } finally {
      await fixture.close();
    }
  });

  it("captures community portal threads with follow-up and obstruction state", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping community portal source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const cases = [
      {
        id: "dcinside",
        path: "/dcinside-community",
        url: "https://search.dcinside.com/post?keyword=seongsu+cafe",
        querySelector: "#dcinside-query",
        destinationPath: "/dcinside-thread",
        titleText: "DCInside community thread card"
      },
      {
        id: "naver-kin",
        path: "/naver-kin-community",
        url: "https://kin.naver.com/search/list.naver?query=seongsu+cafe",
        querySelector: "#naver-kin-query",
        destinationPath: "/naver-kin-answer",
        titleText: "Naver Knowledge iN question card"
      },
      {
        id: "reddit",
        path: "/reddit-community",
        url: "https://www.reddit.com/search/?q=tokyo%20travel",
        querySelector: "#reddit-query",
        destinationPath: "/reddit-thread",
        titleText: "Reddit community thread card"
      },
      {
        id: "quora",
        path: "/quora-community",
        url: "https://www.quora.com/search?q=tokyo%20travel",
        querySelector: "#quora-query",
        destinationPath: "/quora-answer",
        titleText: "Quora community question card"
      },
      {
        id: "stack-overflow",
        path: "/stack-overflow-community",
        url: "https://stackoverflow.com/search?q=playwright",
        querySelector: "#stack-overflow-query",
        destinationPath: "/stack-overflow-answer",
        titleText: "Stack Overflow question card"
      }
    ];

    try {
      for (const item of cases) {
        const runDir = await mkdtemp(join(tmpdir(), `farm-source-nav-${item.id}-community-`));
        runDirs.push(runDir);
        const artifactWriter = new ArtifactWriter();
        const manager = new LeaseManager();
        const pool = new BrowserPool(manager, { artifactWriter });

        try {
          const lease = manager.acquire({
            agentId: "agent",
            runId: item.id,
            artifactRunDir: runDir,
            allowedDomains: ["127.0.0.1"],
            capability: "read-write"
          });
          const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}${item.path}`);
          const plan = planFor(item.url);

          const result = await executeSourceNavigationActions({
            plan,
            executableActions: [
              {
                actionKey: "query-state",
                operation: "fill",
                selector: item.querySelector,
                value: "seongsu cafe",
                expectedStates: [{ selector: "#query-state", textIncludes: "query: seongsu cafe" }]
              },
              {
                actionKey: "news-section",
                operation: "click",
                selector: "#community-section",
                captureScopes: [{ key: "section", selector: "#community-section-state" }],
                expectedStates: [{ selector: "#community-section-state", textIncludes: "section: community" }]
              },
              {
                actionKey: "visible-filters",
                operation: "click",
                selector: "#community-recent",
                captureScopes: [{ key: "filters", selector: "#community-filter-state" }],
                expectedStates: [{ selector: "#community-filter-state", textIncludes: "sort: latest" }]
              },
              {
                actionKey: "result-pagination",
                operation: "click",
                selector: "#community-more",
                captureScopes: [{ key: "community-module", selector: "#community-module" }],
                expectedStates: [{ selector: "#community-module", textIncludes: "Second page community result" }]
              },
              {
                actionKey: "article-capture",
                operation: "capture",
                captureScopes: [
                  { key: "community-module", selector: "#community-module" },
                  { key: "thread-card", selector: "#thread-card" },
                  { key: "community-meta", selector: "#community-meta" }
                ],
                expectedStates: [{ selector: "#thread-card", textIncludes: item.titleText }]
              },
              {
                actionKey: "destination-followup",
                operation: "follow_up",
                selector: "#community-link",
                captureId: `${item.id}-community-destination`
              },
              {
                actionKey: "obstruction-check",
                operation: "capture",
                captureScopes: [{ key: "obstruction-state", selector: "#community-obstruction-state" }],
                expectedStates: [{ selector: "#community-obstruction-state", textIncludes: "access: public" }]
              }
            ],
            browserPool: pool,
            artifactWriter,
            agentId: "agent",
            contextToken: lease.contextToken,
            pageId: page.pageId,
            runDir,
            sourceUrl: `${fixture.baseUrl}${item.path}`,
            captureIdBase: `fixture-${item.id}-community`,
            limits: { perActionTimeoutMs: 5_000 }
          });

          expect(result.status).toBe("partial");
          expect(result.executedActionCount).toBe(7);
          expect(result.skippedActionCount).toBe(0);
          expect(result.unsupportedActionCount).toBe(3);
          expect(result.followUps).toEqual([
            expect.objectContaining({
              actionKey: "destination-followup",
              url: `${fixture.baseUrl}${item.destinationPath}`,
              captureId: `${item.id}-community-destination`
            })
          ]);

          const moduleText = await readFile(join(runDir, "raw", `fixture-${item.id}-community-article-capture-scope-community-module-after.txt`), "utf8");
          expect(moduleText).toContain(item.titleText);
          expect(moduleText).toContain("Second page community result");
          const meta = await readFile(join(runDir, "raw", `fixture-${item.id}-community-article-capture-scope-community-meta-after.txt`), "utf8");
          expect(meta).toContain("author:");
          expect(meta).toContain("published:");
          const obstruction = await readFile(join(runDir, "raw", `fixture-${item.id}-community-obstruction-check-scope-obstruction-state-after.txt`), "utf8");
          expect(obstruction).toContain("access: public");
          expect(obstruction).toContain("no bypass attempted");
        } finally {
          await pool.shutdown();
        }
      }
    } finally {
      await fixture.close();
    }
  });

  it("captures review portal listing cards, destinations, and obstruction state", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping review portal source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const cases = [
      {
        id: "yelp",
        path: "/yelp-review",
        url: "https://www.yelp.com/search?find_desc=coffee",
        platform: "Yelp",
        destinationPath: "/yelp-business"
      },
      {
        id: "tripadvisor",
        path: "/tripadvisor-review",
        url: "https://www.tripadvisor.com/Search?q=tokyo%20hotel",
        platform: "TripAdvisor",
        destinationPath: "/tripadvisor-listing"
      }
    ];

    try {
      for (const item of cases) {
        const runDir = await mkdtemp(join(tmpdir(), `farm-source-nav-${item.id}-review-`));
        runDirs.push(runDir);
        const artifactWriter = new ArtifactWriter();
        const manager = new LeaseManager();
        const pool = new BrowserPool(manager, { artifactWriter });

        try {
          const lease = manager.acquire({
            agentId: "agent",
            runId: "run",
            artifactRunDir: runDir,
            allowedDomains: ["127.0.0.1"],
            capability: "read-write"
          });
          const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}${item.path}`);
          const plan = planFor(item.url);

          const result = await executeSourceNavigationActions({
            plan,
            executableActions: [
              { actionKey: "query-state", operation: "fill", selector: "#review-query", value: "coffee" },
              {
                actionKey: "news-section",
                operation: "click",
                selector: "#review-category",
                captureScopes: [{ key: "section", selector: "#review-section-state" }],
                expectedStates: [{ selector: "#review-section-state", textIncludes: "category: restaurants" }]
              },
              {
                actionKey: "visible-filters",
                operation: "click",
                selector: "#review-filter",
                captureScopes: [{ key: "filters", selector: "#review-filter-state" }],
                expectedStates: [{ selector: "#review-filter-state", textIncludes: "filter: rating 4+" }]
              },
              {
                actionKey: "result-pagination",
                operation: "click",
                selector: "#review-more",
                captureScopes: [{ key: "review-module", selector: "#review-module" }],
                expectedStates: [{ selector: "#review-module", textIncludes: "Second page review result" }]
              },
              {
                actionKey: "article-capture",
                operation: "capture",
                captureScopes: [
                  { key: "review-module", selector: "#review-module" },
                  { key: "review-card", selector: "#review-card" },
                  { key: "review-meta", selector: "#review-meta" }
                ],
                expectedStates: [{ selector: "#review-card", textIncludes: `${item.platform} listing card` }]
              },
              {
                actionKey: "destination-followup",
                operation: "extract_destinations",
                selector: "#review-destination-links",
                maxLinks: 4,
                captureId: `${item.id}-review-destination`
              },
              {
                actionKey: "obstruction-check",
                operation: "capture",
                captureScopes: [{ key: "obstruction-state", selector: "#review-obstruction-state" }],
                expectedStates: [{ selector: "#review-obstruction-state", textIncludes: "human check: none" }]
              }
            ],
            browserPool: pool,
            artifactWriter,
            agentId: "agent",
            contextToken: lease.contextToken,
            pageId: page.pageId,
            runDir,
            sourceUrl: `${fixture.baseUrl}${item.path}`,
            captureIdBase: `fixture-${item.id}-review`,
            limits: { perActionTimeoutMs: 5_000 }
          });

          expect(result.status).toBe("partial");
          expect(result.executedActionCount).toBe(7);
          expect(result.skippedActionCount).toBe(0);
          expect(result.unsupportedActionCount).toBe(3);
          expect(result.followUps).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                actionKey: "destination-followup",
                url: `${fixture.baseUrl}${item.destinationPath}`,
                linkText: `${item.platform} listing destination`
              }),
              expect.objectContaining({
                actionKey: "destination-followup",
                url: `${fixture.baseUrl}/${item.id}-menu`
              })
            ])
          );

          const extraction = result.actionResults.find((action) => action.actionKey === "destination-followup");
          expect(extraction?.operationDetails?.extractedDestinationCount).toBeGreaterThanOrEqual(3);
          const moduleText = await readFile(join(runDir, "raw", `fixture-${item.id}-review-article-capture-scope-review-module-after.txt`), "utf8");
          expect(moduleText).toContain(`${item.platform} listing card`);
          expect(moduleText).toContain("Second page review result");
          const meta = await readFile(join(runDir, "raw", `fixture-${item.id}-review-article-capture-scope-review-meta-after.txt`), "utf8");
          expect(meta).toContain("rating:");
          expect(meta).toContain("review count:");
          const obstruction = await readFile(join(runDir, "raw", `fixture-${item.id}-review-obstruction-check-scope-obstruction-state-after.txt`), "utf8");
          expect(obstruction).toContain("human check: none");
          expect(obstruction).toContain("no bypass attempted");
        } finally {
          await pool.shutdown();
        }
      }
    } finally {
      await fixture.close();
    }
  });

  it("captures Google Scholar result metadata, citation links, and full-text destinations", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping Google Scholar source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-google-scholar-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/google-scholar-portal`);
      const plan = planFor("https://scholar.google.com/scholar?q=machine+learning");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          { actionKey: "query-state", operation: "fill", selector: "#gs_hdr_tsi", value: "machine learning" },
          {
            actionKey: "news-section",
            operation: "wait_for_selector",
            selector: "#scholar-section-state",
            captureScopes: [{ key: "scholar-section", selector: "#scholar-section-state" }],
            expectedStates: [{ selector: "#scholar-section-state", textIncludes: "section: all results" }]
          },
          {
            actionKey: "visible-filters",
            operation: "wait_for_selector",
            selector: "#scholar-filter-state",
            captureScopes: [{ key: "scholar-filters", selector: "#scholar-filter-state" }],
            expectedStates: [{ selector: "#scholar-filter-state", textIncludes: "filter: since 2022" }]
          },
          {
            actionKey: "article-capture",
            operation: "capture",
            captureScopes: [
              { key: "scholar-results", selector: "#gs_res_ccl_mid" },
              { key: "scholar-title", selector: ".gs_rt" },
              { key: "scholar-authors", selector: ".gs_a" },
              { key: "scholar-snippet", selector: ".gs_rs" },
              { key: "scholar-links", selector: ".gs_fl" },
              { key: "scholar-fulltext", selector: ".gs_or_ggsm" }
            ],
            expectedStates: [{ selector: "#gs_res_ccl_mid", textIncludes: "Google Scholar academic result card" }]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#gs_res_ccl_mid",
            maxLinks: 5,
            captureId: "google-scholar-destination"
          },
          {
            actionKey: "obstruction-check",
            operation: "capture",
            captureScopes: [{ key: "scholar-obstruction", selector: "#scholar-obstruction-state" }],
            expectedStates: [{ selector: "#scholar-obstruction-state", textIncludes: "login: not required" }]
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/google-scholar-portal`,
        captureIdBase: "fixture-google-scholar",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(6);
      expect(result.skippedActionCount).toBe(1);
      expect(result.unsupportedActionCount).toBe(3);
      expect(result.followUps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionKey: "destination-followup",
            url: "https://publisher.example/paper",
            linkText: "Google Scholar academic result card"
          }),
          expect.objectContaining({
            actionKey: "destination-followup",
            url: "https://doi.org/10.1000/scholar-fixture"
          })
        ])
      );

      const extraction = result.actionResults.find((action) => action.actionKey === "destination-followup");
      expect(extraction?.operationDetails?.extractedDestinationCount).toBeGreaterThanOrEqual(4);
      const resultsText = await readFile(join(runDir, "raw", "fixture-google-scholar-article-capture-scope-scholar-results-after.txt"), "utf8");
      expect(resultsText).toContain("Google Scholar academic result card");
      expect(resultsText).toContain("Cited by 42");
      expect(resultsText).toContain("All 7 versions");
      const metadataText = await readFile(join(runDir, "raw", "fixture-google-scholar-article-capture-scope-scholar-authors-after.txt"), "utf8");
      expect(metadataText).toContain("Journal of Browser Evidence");
      const obstruction = await readFile(join(runDir, "raw", "fixture-google-scholar-obstruction-check-scope-scholar-obstruction-after.txt"), "utf8");
      expect(obstruction).toContain("login: not required");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures knowledge database records, citation surfaces, and visible source destinations", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping knowledge database source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const cases = [
      {
        id: "wikipedia",
        path: "/wikipedia-knowledge",
        url: "https://en.wikipedia.org/wiki/Tokyo",
        captureScopes: [
          { key: "article-body", selector: "#mw-content-text" },
          { key: "references", selector: "ol.references" }
        ],
        destinationSelector: "#mw-content-text",
        expectedCaptureText: "Wikipedia knowledge article body",
        expectedDestinationUrl: "https://source.example/wiki-citation"
      },
      {
        id: "namuwiki",
        path: "/namuwiki-knowledge",
        url: "https://namu.wiki/w/%EC%84%B1%EC%88%98%EB%8F%99",
        captureScopes: [
          { key: "article-body", selector: "article" },
          { key: "wiki-paragraph", selector: ".wiki-paragraph" }
        ],
        destinationSelector: "article",
        expectedCaptureText: "Namuwiki article body evidence",
        expectedDestinationUrl: "https://source.example/namuwiki-source"
      },
      {
        id: "pubmed",
        path: "/pubmed-knowledge",
        url: "https://pubmed.ncbi.nlm.nih.gov/?term=playwright",
        captureScopes: [
          { key: "result-summary", selector: ".docsum-content" },
          { key: "article-details", selector: "#article-details" }
        ],
        destinationSelector: "#article-details",
        expectedCaptureText: "PubMed abstract evidence",
        expectedDestinationUrl: "https://doi.org/10.1234/example"
      },
      {
        id: "data-go-kr",
        path: "/data-go-kr-knowledge",
        url: "https://www.data.go.kr/tcs/dss/selectDataSetList.do?keyword=population",
        captureScopes: [
          { key: "dataset-list", selector: "#contents" },
          { key: "detail-info", selector: ".detail-info" }
        ],
        destinationSelector: "#contents",
        expectedCaptureText: "data.go.kr dataset result list",
        expectedDestinationUrl: `${fixture.baseUrl}/tcs/dss/selectDataSetDetail.do`
      },
      {
        id: "kosis",
        path: "/kosis-knowledge",
        url: "https://kosis.kr/search/search.do?query=population",
        captureScopes: [
          { key: "search-result", selector: "#contents" },
          { key: "stat-table", selector: ".tbl-list" }
        ],
        destinationSelector: "#contents",
        expectedCaptureText: "KOSIS statistic table metadata",
        expectedDestinationUrl: `${fixture.baseUrl}/statisticsList/statisticsListIndex.do`
      },
      {
        id: "riss",
        path: "/riss-knowledge",
        url: "https://www.riss.kr/search/Search.do?queryText=ai",
        captureScopes: [
          { key: "result-list", selector: "#divContent" },
          { key: "metadata", selector: ".metadata" }
        ],
        destinationSelector: "#divContent",
        expectedCaptureText: "RISS academic record metadata",
        expectedDestinationUrl: `${fixture.baseUrl}/search/detail/DetailView.do`
      },
      {
        id: "kipris",
        path: "/kipris-knowledge",
        url: "https://www.kipris.or.kr/khome/search/search.do?queryText=robot",
        captureScopes: [
          { key: "patent-view", selector: "#content" },
          { key: "patent-detail", selector: ".patentView" }
        ],
        destinationSelector: "#content",
        expectedCaptureText: "KIPRIS patent detail metadata",
        expectedDestinationUrl: `${fixture.baseUrl}/khome/search/patentDetail.do`
      }
    ];

    try {
      for (const item of cases) {
        const runDir = await mkdtemp(join(tmpdir(), `farm-source-nav-${item.id}-knowledge-`));
        runDirs.push(runDir);
        const artifactWriter = new ArtifactWriter();
        const manager = new LeaseManager();
        const pool = new BrowserPool(manager, { artifactWriter });

        try {
          const lease = manager.acquire({
            agentId: "agent",
            runId: "run",
            artifactRunDir: runDir,
            allowedDomains: ["127.0.0.1"],
            capability: "read-write"
          });
          const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}${item.path}`);
          const plan = planFor(item.url);

          const result = await executeSourceNavigationActions({
            plan,
            executableActions: [
              {
                actionKey: "page-capture",
                operation: "capture",
                captureScopes: item.captureScopes,
                expectedStates: [{ selector: item.captureScopes[0]?.selector ?? "body", textIncludes: item.expectedCaptureText }]
              },
              {
                actionKey: "bounded-scroll",
                operation: "scroll",
                direction: "bottom",
                captureScopes: [{ key: "after-scroll", selector: item.captureScopes.at(-1)?.selector ?? "body" }]
              },
              {
                actionKey: "destination-followup",
                operation: "extract_destinations",
                selector: item.destinationSelector,
                maxLinks: 5,
                captureId: `${item.id}-knowledge-destination`
              }
            ],
            browserPool: pool,
            artifactWriter,
            agentId: "agent",
            contextToken: lease.contextToken,
            pageId: page.pageId,
            runDir,
            sourceUrl: `${fixture.baseUrl}${item.path}`,
            captureIdBase: `fixture-${item.id}-knowledge`,
            limits: { perActionTimeoutMs: 5_000 }
          });

          expect(result.status).toBe("partial");
          expect(result.executedActionCount).toBe(3);
          expect(result.skippedActionCount).toBe(1);
          expect(result.unsupportedActionCount).toBe(1);
          expect(result.followUps).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                actionKey: "destination-followup",
                url: item.expectedDestinationUrl
              })
            ])
          );
          const extraction = result.actionResults.find((action) => action.actionKey === "destination-followup");
          expect(extraction?.operationDetails?.extractedDestinationCount).toBeGreaterThanOrEqual(2);

          const firstScope = item.captureScopes[0];
          const captured = await readFile(join(runDir, "raw", `fixture-${item.id}-knowledge-page-capture-scope-${firstScope.key}-after.txt`), "utf8");
          expect(captured).toContain(item.expectedCaptureText);
        } finally {
          await pool.shutdown();
        }
      }
    } finally {
      await fixture.close();
    }
  });

  it("captures community destination question answer and comment scopes", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping community destination source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const cases = [
      {
        id: "dcinside",
        path: "/dcinside-thread",
        url: "https://gall.dcinside.com/board/view/?id=travel&no=1",
        platform: "DCInside"
      },
      {
        id: "naver-kin",
        path: "/naver-kin-answer",
        url: "https://kin.naver.com/qna/detail.naver?d1id=1&dirId=101&docId=1",
        platform: "Naver Knowledge iN"
      },
      {
        id: "reddit",
        path: "/reddit-thread",
        url: "https://www.reddit.com/r/travel/comments/abc/tokyo_thread/",
        platform: "Reddit"
      },
      {
        id: "quora",
        path: "/quora-answer",
        url: "https://www.quora.com/What-is-a-good-Tokyo-itinerary/answer/example",
        platform: "Quora"
      },
      {
        id: "stack-overflow",
        path: "/stack-overflow-answer",
        url: "https://stackoverflow.com/questions/123/playwright-question",
        platform: "Stack Overflow"
      }
    ];

    try {
      for (const item of cases) {
        const runDir = await mkdtemp(join(tmpdir(), `farm-source-nav-${item.id}-destination-`));
        runDirs.push(runDir);
        const artifactWriter = new ArtifactWriter();
        const manager = new LeaseManager();
        const pool = new BrowserPool(manager, { artifactWriter });

        try {
          const lease = manager.acquire({
            agentId: "agent",
            runId: `${item.id}-destination`,
            artifactRunDir: runDir,
            allowedDomains: ["127.0.0.1"],
            capability: "read-write"
          });
          const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}${item.path}`);
          const plan = planFor(item.url);

          const result = await executeSourceNavigationActions({
            plan,
            executableActions: [
              {
                actionKey: "article-capture",
                operation: "capture",
                captureScopes: [
                  { key: "community-destination", selector: "#community-destination" },
                  { key: "destination-meta", selector: "#destination-meta" },
                  { key: "question-body", selector: "#question-body" },
                  { key: "thread-body", selector: "#thread-body" },
                  { key: "answer-body", selector: "#answer-body" },
                  { key: "accepted-answer", selector: "#accepted-answer" },
                  { key: "comment-list", selector: "#comment-list" }
                ],
                expectedStates: [
                  { selector: "#community-destination", textIncludes: item.platform },
                  { selector: "#comment-list", textIncludes: "public reply context" }
                ]
              },
              {
                actionKey: "obstruction-check",
                operation: "capture",
                captureScopes: [{ key: "destination-obstruction-state", selector: "#destination-obstruction-state" }],
                expectedStates: [{ selector: "#destination-obstruction-state", textIncludes: "write actions disabled" }]
              }
            ],
            browserPool: pool,
            artifactWriter,
            agentId: "agent",
            contextToken: lease.contextToken,
            pageId: page.pageId,
            runDir,
            sourceUrl: `${fixture.baseUrl}${item.path}`,
            captureIdBase: `fixture-${item.id}-destination`,
            limits: { perActionTimeoutMs: 5_000 }
          });

          expect(result.status).toBe("partial");
          expect(result.executedActionCount).toBe(2);
          expect(result.skippedActionCount).toBe(5);
          expect(result.unsupportedActionCount).toBe(3);
          expect(result.failedActionCount).toBe(0);

          const destination = await readFile(join(runDir, "raw", `fixture-${item.id}-destination-article-capture-scope-community-destination-after.txt`), "utf8");
          expect(destination).toContain(`${item.platform} destination thread`);
          expect(destination).toContain("Thread body preserves browser-visible post text");
          const question = await readFile(join(runDir, "raw", `fixture-${item.id}-destination-article-capture-scope-question-body-after.txt`), "utf8");
          expect(question).toContain(`${item.platform} destination question`);
          const answer = await readFile(join(runDir, "raw", `fixture-${item.id}-destination-article-capture-scope-answer-body-after.txt`), "utf8");
          expect(answer).toContain("Answer body includes a cited itinerary suggestion");
          const comments = await readFile(join(runDir, "raw", `fixture-${item.id}-destination-article-capture-scope-comment-list-after.txt`), "utf8");
          expect(comments).toContain("Comment one:");
          expect(comments).toContain("Comment two:");
          const obstruction = await readFile(join(runDir, "raw", `fixture-${item.id}-destination-obstruction-check-scope-destination-obstruction-state-after.txt`), "utf8");
          expect(obstruction).toContain("access: public");
          expect(obstruction).toContain("write actions disabled");
        } finally {
          await pool.shutdown();
        }
      }
    } finally {
      await fixture.close();
    }
  });

  it("keeps long scoped capture file names unique after sanitization", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping long scoped capture filename test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-long-scopes-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "long-scopes",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/naver-news`);
      const plan = planFor("https://search.naver.com/search.naver?where=news&query=ai");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "article-capture",
            operation: "capture",
            captureScopes: [
              { key: "article-capture-scope-1", selector: "#headline-card" },
              { key: "article-capture-scope-2", selector: "#publisher-meta" }
            ],
            expectedStates: [{ selector: "#headline-card", textIncludes: "Naver headline card" }]
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/naver-news`,
        captureIdBase: "evidence-generic-search.naver.com-source-navigation",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.executedActionCount).toBe(1);
      const scopedPaths = result.records.filter((record) => record.tool_name === "farm_capture_scope").map((record) => record.path);
      expect(new Set(scopedPaths).size).toBe(scopedPaths.length);

      const scopedTextPaths = result.records.filter((record) => record.tool_name === "farm_capture_scope" && record.kind === "text").map((record) => record.path);
      expect(scopedTextPaths).toHaveLength(2);
      expect(new Set(scopedTextPaths).size).toBe(2);

      const scopedText = await Promise.all(scopedTextPaths.map((path) => readFile(join(runDir, path), "utf8")));
      expect(scopedText.join("\n")).toContain("Naver headline card");
      expect(scopedText.join("\n")).toContain("publisher:");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures Naver Cafe public content and member-wall obstruction without bypass", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping Naver Cafe source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-naver-cafe-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/naver-cafe`);
      const plan = planFor("https://cafe.naver.com/example/123");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "article-capture",
            operation: "capture",
            captureScopes: [
              { key: "article", selector: "#cafe-article" },
              { key: "comments", selector: "#visible-comments" }
            ],
            expectedStates: [{ selector: "#cafe-article", textIncludes: "public cafe post" }]
          },
          {
            actionKey: "media-gallery",
            operation: "click",
            selector: "#open-cafe-gallery",
            captureScopes: [{ key: "gallery", selector: "#cafe-gallery" }],
            expectedStates: [{ selector: "#cafe-gallery", textIncludes: "Cafe image caption" }]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#blog-destination-links",
            maxLinks: 2,
            captureId: "naver-cafe-destination"
          },
          {
            actionKey: "obstruction-check",
            operation: "click",
            selector: "#members-only",
            captureScopes: [{ key: "member-wall", selector: "#member-wall" }],
            expectedStates: [{ selector: "#member-wall", textIncludes: "Members only" }]
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/naver-cafe`,
        captureIdBase: "fixture-naver-cafe",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(4);
      expect(result.skippedActionCount).toBe(1);
      expect(result.unsupportedActionCount).toBe(1);
      expect(result.followUps).toEqual([expect.objectContaining({ url: `${fixture.baseUrl}/naver-cafe-source`, linkText: "Cafe source page" }), expect.objectContaining({ url: `${fixture.baseUrl}/naver-cafe-related`, linkText: "Related cafe post" })]);
      expect(result.actionResults.find((action) => action.actionKey === "unsupported:member-only-bypass")).toBeDefined();

      const article = await readFile(join(runDir, "raw", "fixture-naver-cafe-article-capture-scope-article-after.txt"), "utf8");
      expect(article).toContain("public cafe post");
      const comments = await readFile(join(runDir, "raw", "fixture-naver-cafe-article-capture-scope-comments-after.txt"), "utf8");
      expect(comments).toContain("Visible comment");
      const wall = await readFile(join(runDir, "raw", "fixture-naver-cafe-obstruction-check-scope-member-wall-after.txt"), "utf8");
      expect(wall).toContain("Members only");
      expect(wall).toContain("No bypass attempted");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures KakaoMap viewport, list, filter, and place detail panels", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping KakaoMap source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-kakao-map-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/kakao-map`);
      const plan = planFor("https://map.kakao.com/?q=seoul+cafe");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "query-state",
            operation: "fill",
            selector: "#kakao-query",
            value: "seoul cafe",
            expectedStates: [{ selector: "#query-state", textIncludes: "query: seoul cafe" }]
          },
          {
            actionKey: "map-filters",
            operation: "click",
            selector: "#category-filter",
            captureScopes: [{ key: "place-list", selector: "#place-list" }],
            expectedStates: [{ selector: "#filter-state", textIncludes: "category: cafe" }]
          },
          {
            actionKey: "map-viewport",
            operation: "capture",
            captureScopes: [
              { key: "viewport", selector: "#kakao-map-viewport" },
              { key: "place-list", selector: "#place-list" }
            ],
            expectedStates: [{ selector: "#kakao-map-viewport", textIncludes: "visible KakaoMap pins" }]
          },
          {
            actionKey: "selected-place",
            operation: "click",
            selector: "#place-gamma",
            captureScopes: [
              { key: "place-detail", selector: "#place-detail" },
              { key: "review-list", selector: "#review-list" }
            ],
            expectedStates: [{ selector: "#place-detail", textIncludes: "Cafe Gamma" }]
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/kakao-map`,
        captureIdBase: "fixture-kakao-map",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(4);
      expect(result.skippedActionCount).toBe(2);
      expect(result.actionResults.find((action) => action.actionKey === "destination-followup")?.status).toBe("skipped");
      const placeDetail = await readFile(join(runDir, "raw", "fixture-kakao-map-selected-place-scope-place-detail-after.txt"), "utf8");
      expect(placeDetail).toContain("Cafe Gamma");
      expect(placeDetail).toContain("road address");
      const reviews = await readFile(join(runDir, "raw", "fixture-kakao-map-selected-place-scope-review-list-after.txt"), "utf8");
      expect(reviews).toContain("review snippet");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures Google Maps selected place sheet, reviews, photos, and map labels", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping Google Maps selected-place source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-google-map-place-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/google-map-place`);
      const plan = planFor("https://www.google.com/maps/search/seoul+cafe");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "query-state",
            operation: "fill",
            selector: "#google-map-query",
            value: "seoul cafe",
            expectedStates: [{ selector: "#query-state", textIncludes: "query: seoul cafe" }]
          },
          {
            actionKey: "map-filters",
            operation: "click",
            selector: "#google-filter-open-now",
            captureScopes: [{ key: "place-list", selector: "#google-place-list" }],
            expectedStates: [{ selector: "#filter-state", textIncludes: "open now" }]
          },
          {
            actionKey: "map-viewport",
            operation: "capture",
            captureScopes: [
              { key: "viewport", selector: "#google-map-viewport" },
              { key: "place-list", selector: "#google-place-list" }
            ],
            expectedStates: [{ selector: "#google-map-viewport", textIncludes: "Google Maps pins" }]
          },
          {
            actionKey: "selected-place",
            operation: "click",
            selector: "#google-place-row",
            captureScopes: [
              { key: "place-sheet", selector: "#google-place-sheet" },
              { key: "review-list", selector: "#google-review-list" },
              { key: "photo-strip", selector: "#google-photo-strip" }
            ],
            expectedStates: [{ selector: "#google-place-sheet", textIncludes: "Cafe Orion" }]
          },
          {
            actionKey: "map-ocr",
            operation: "capture",
            captureScopes: [{ key: "map-label", selector: "#google-map-label" }],
            expectedStates: [{ selector: "#google-map-label", textIncludes: "Cafe Orion label" }]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#google-place-website-link",
            maxLinks: 3,
            captureId: "google-map-place-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/google-map-place`,
        captureIdBase: "fixture-google-map-place",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("ok");
      expect(result.executedActionCount).toBe(6);
      expect(result.skippedActionCount).toBe(0);
      expect(result.unsupportedActionCount).toBe(0);
      expect(result.followUps).toEqual([
        expect.objectContaining({
          actionKey: "destination-followup",
          url: `${fixture.baseUrl}/google-place-official`,
          selector: "#google-place-website-link",
          linkText: "Official website",
          captureId: "google-map-place-destination-1"
        })
      ]);

      const sheet = await readFile(join(runDir, "raw", "fixture-google-map-place-selected-place-scope-place-sheet-after.txt"), "utf8");
      expect(sheet).toContain("Cafe Orion");
      expect(sheet).toContain("Address visible");
      expect(sheet).toContain("route and call buttons are visible but not clicked");
      const reviews = await readFile(join(runDir, "raw", "fixture-google-map-place-selected-place-scope-review-list-after.txt"), "utf8");
      expect(reviews).toContain("review snippet");
      const photos = await readFile(join(runDir, "raw", "fixture-google-map-place-selected-place-scope-photo-strip-after.txt"), "utf8");
      expect(photos).toContain("photo strip");
      const label = await readFile(join(runDir, "raw", "fixture-google-map-place-map-ocr-scope-map-label-after.txt"), "utf8");
      expect(label).toContain("Cafe Orion label");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures Apple Maps local viewport, selected place, OCR label, and destinations", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping Apple Maps source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-apple-map-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/apple-map`);
      const plan = planFor("https://maps.apple.com/?q=seoul+cafe");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "query-state",
            operation: "fill",
            selector: "#apple-map-query",
            value: "seoul cafe",
            expectedStates: [{ selector: "#query-state", textIncludes: "query: seoul cafe" }]
          },
          {
            actionKey: "map-filters",
            operation: "click",
            selector: "#apple-filter-open-now",
            captureScopes: [{ key: "place-list", selector: "#apple-place-list" }],
            expectedStates: [{ selector: "#filter-state", textIncludes: "filter: open now" }]
          },
          {
            actionKey: "map-viewport",
            operation: "capture",
            captureScopes: [{ key: "viewport", selector: "#apple-map-viewport" }],
            expectedStates: [{ selector: "#apple-map-viewport", textIncludes: "Apple Maps pins visible" }]
          },
          {
            actionKey: "selected-place",
            operation: "click",
            selector: "#apple-place-row",
            captureScopes: [
              { key: "place-card", selector: "#apple-place-card" },
              { key: "review-list", selector: "#apple-review-list" }
            ],
            expectedStates: [{ selector: "#apple-place-card", textIncludes: "Cafe Pomme" }]
          },
          {
            actionKey: "map-ocr",
            operation: "capture",
            captureScopes: [
              { key: "map-label", selector: "#apple-map-label" },
              { key: "viewport", selector: "#apple-map-viewport" }
            ],
            expectedStates: [{ selector: "#apple-map-label", textIncludes: "Cafe Pomme label" }]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#apple-place-card",
            maxLinks: 3,
            captureId: "apple-map-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/apple-map`,
        captureIdBase: "fixture-apple-map",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("ok");
      expect(result.executedActionCount).toBe(6);
      expect(result.skippedActionCount).toBe(0);
      expect(result.unsupportedActionCount).toBe(0);
      expect(result.followUps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ url: `${fixture.baseUrl}/apple-place-official`, linkText: "Official website" }),
          expect.objectContaining({ url: `${fixture.baseUrl}/apple-place-menu`, linkText: "Menu" }),
          expect.objectContaining({ url: `${fixture.baseUrl}/apple-place-reviews`, linkText: "Reviews" })
        ])
      );

      const placeCard = await readFile(join(runDir, "raw", "fixture-apple-map-selected-place-scope-place-card-after.txt"), "utf8");
      expect(placeCard).toContain("Cafe Pomme");
      expect(placeCard).toContain("Rating 4.5");
      const mapLabel = await readFile(join(runDir, "raw", "fixture-apple-map-map-ocr-scope-map-label-after.txt"), "utf8");
      expect(mapLabel).toContain("Cafe Pomme label");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures richer travel room and rate-card variants without entering booking flow", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping rich travel rate source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-travel-rates-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/travel-rates`);
      const plan = planFor("https://www.booking.com/hotel/kr/example.html");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "query-state",
            operation: "fill",
            selector: "#rate-destination",
            value: "Busan",
            expectedStates: [{ selector: "#query-state", textIncludes: "destination: Busan" }]
          },
          {
            actionKey: "visible-filters",
            operation: "click",
            selector: "#refundable-filter",
            expectedStates: [{ selector: "#filter-state", textIncludes: "free cancellation" }]
          },
          {
            actionKey: "visible-sort",
            operation: "select",
            selector: "#rate-sort",
            value: "total",
            expectedStates: [{ selector: "#sort-state", textIncludes: "sort: total" }]
          },
          {
            actionKey: "result-scroll",
            operation: "scroll",
            direction: "down",
            pixels: 700,
            captureScopes: [{ key: "room-list", selector: "#room-list" }],
            expectedStates: [{ selector: "#room-list", textIncludes: "Deluxe Twin" }]
          },
          {
            actionKey: "result-pagination",
            operation: "click",
            selector: "#show-more-rates",
            captureScopes: [{ key: "room-list", selector: "#room-list" }],
            expectedStates: [{ selector: "#room-list", textIncludes: "Suite rate" }]
          },
          {
            actionKey: "offer-card",
            operation: "capture",
            captureScopes: [{ key: "room-list", selector: "#room-list" }],
            expectedStates: [{ selector: "#room-list", textIncludes: "Suite rate" }]
          },
          {
            actionKey: "offer-detail",
            operation: "click",
            selector: "#show-rate-terms",
            captureScopes: [{ key: "rate-terms", selector: "#rate-terms" }],
            expectedStates: [{ selector: "#rate-terms", textIncludes: "No prepayment" }]
          },
          {
            actionKey: "price-ocr",
            operation: "capture",
            captureScopes: [{ key: "rate-price-card", selector: "#rate-price-card" }],
            expectedStates: [{ selector: "#rate-price-card", textIncludes: "KRW 210,000" }]
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/travel-rates`,
        captureIdBase: "fixture-travel-rates",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(8);
      expect(result.skippedActionCount).toBe(0);
      expect(result.unsupportedActionCount).toBe(3);
      expect(result.actionResults.find((action) => action.actionKey === "unsupported:booking")).toBeDefined();

      const roomList = await readFile(join(runDir, "raw", "fixture-travel-rates-result-pagination-scope-room-list-after.txt"), "utf8");
      expect(roomList).toContain("Suite rate");
      const offerCard = await readFile(join(runDir, "raw", "fixture-travel-rates-offer-card-scope-room-list-after.txt"), "utf8");
      expect(offerCard).toContain("Suite rate");
      const terms = await readFile(join(runDir, "raw", "fixture-travel-rates-offer-detail-scope-rate-terms-after.txt"), "utf8");
      expect(terms).toContain("No prepayment");
      expect(terms).toContain("taxes and fees included");
      const priceCard = await readFile(join(runDir, "raw", "fixture-travel-rates-price-ocr-scope-rate-price-card-after.txt"), "utf8");
      expect(priceCard).toContain("KRW 210,000");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures commerce product cards, seller terms, and price scopes without transaction actions", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping commerce marketplace source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-commerce-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/commerce`);
      const plan = planFor("https://www.coupang.com/np/search?q=laptop");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "query-state",
            operation: "fill",
            selector: "#commerce-query",
            value: "laptop",
            expectedStates: [{ selector: "#query-state", textIncludes: "query: laptop" }]
          },
          {
            actionKey: "visible-filters",
            operation: "click",
            selector: "#rocket-filter",
            expectedStates: [{ selector: "#filter-state", textIncludes: "rocket delivery" }]
          },
          {
            actionKey: "visible-sort",
            operation: "select",
            selector: "#commerce-sort",
            value: "price",
            expectedStates: [{ selector: "#sort-state", textIncludes: "sort: price" }]
          },
          {
            actionKey: "result-scroll",
            operation: "scroll",
            direction: "down",
            pixels: 600,
            captureScopes: [{ key: "product-list", selector: "#product-list" }],
            expectedStates: [{ selector: "#product-list", textIncludes: "Laptop Pro 14" }]
          },
          {
            actionKey: "result-pagination",
            operation: "click",
            selector: "#more-products",
            captureScopes: [{ key: "product-list", selector: "#product-list" }],
            expectedStates: [{ selector: "#product-list", textIncludes: "Laptop Air 13" }]
          },
          {
            actionKey: "product-card",
            operation: "capture",
            captureScopes: [{ key: "product-card", selector: "#product-card" }],
            expectedStates: [{ selector: "#product-card", textIncludes: "seller: TechMarket" }]
          },
          {
            actionKey: "seller-terms",
            operation: "click",
            selector: "#seller-terms-button",
            captureScopes: [
              { key: "seller-terms", selector: "#seller-terms" },
              { key: "shipping-panel", selector: "#shipping-panel" }
            ],
            expectedStates: [{ selector: "#seller-terms", textIncludes: "return window" }]
          },
          {
            actionKey: "price-ocr",
            operation: "capture",
            captureScopes: [{ key: "price-badge", selector: "#price-badge" }],
            expectedStates: [{ selector: "#price-badge", textIncludes: "KRW 1,290,000" }]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#commerce-destination-links",
            maxLinks: 4,
            captureId: "commerce-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/commerce`,
        captureIdBase: "fixture-commerce",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(9);
      expect(result.skippedActionCount).toBe(0);
      expect(result.unsupportedActionCount).toBe(3);
      expect(result.actionResults.find((action) => action.actionKey === "unsupported:purchase")).toBeDefined();
      expect(result.actionResults.find((action) => action.actionKey === "unsupported:cart")).toBeDefined();
      expect(result.followUps).toEqual([
        expect.objectContaining({
          actionKey: "destination-followup",
          url: `${fixture.baseUrl}/commerce-product-detail`,
          selector: "#commerce-destination-links",
          linkText: "Product detail page",
          captureId: "commerce-destination-1"
        }),
        expect.objectContaining({
          actionKey: "destination-followup",
          url: `${fixture.baseUrl}/commerce-product-reviews`,
          linkText: "Review page",
          captureId: "commerce-destination-2"
        }),
        expect.objectContaining({
          actionKey: "destination-followup",
          url: `${fixture.baseUrl}/commerce-seller-profile`,
          linkText: "Seller profile",
          captureId: "commerce-destination-3"
        }),
        expect.objectContaining({
          actionKey: "destination-followup",
          url: `${fixture.baseUrl}/commerce-brand-store`,
          linkText: "Brand store",
          captureId: "commerce-destination-4"
        })
      ]);

      const productCard = await readFile(join(runDir, "raw", "fixture-commerce-product-card-scope-product-card-after.txt"), "utf8");
      expect(productCard).toContain("Laptop Pro 14");
      expect(productCard).toContain("seller: TechMarket");
      const sellerTerms = await readFile(join(runDir, "raw", "fixture-commerce-seller-terms-scope-seller-terms-after.txt"), "utf8");
      expect(sellerTerms).toContain("return window");
      expect(sellerTerms).toContain("No cart or checkout action submitted");
      const priceBadge = await readFile(join(runDir, "raw", "fixture-commerce-price-ocr-scope-price-badge-after.txt"), "utf8");
      expect(priceBadge).toContain("KRW 1,290,000");
      expect(priceBadge).toContain("free rocket delivery");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures provider-specific commerce fixtures for major marketplaces without transaction actions", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping provider-specific commerce source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-provider-commerce-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    const cases = [
      {
        url: "https://www.amazon.com/s?k=laptop",
        path: "/amazon-commerce",
        prefix: "amazon-commerce",
        captureIdBase: "fixture-amazon-commerce",
        expectedProductText: "Amazon Laptop Pro",
        expectedPriceText: "USD 899",
        expectedDestinationUrl: `${fixture.baseUrl}/amazon-product-detail`
      },
      {
        url: "https://www.coupang.com/np/search?q=laptop",
        path: "/coupang-commerce",
        prefix: "coupang-commerce",
        captureIdBase: "fixture-coupang-commerce",
        expectedProductText: "Coupang Laptop Pro",
        expectedPriceText: "KRW 1,290,000",
        expectedDestinationUrl: `${fixture.baseUrl}/coupang-product-detail`
      },
      {
        url: "https://shopping.naver.com/search/all?query=laptop",
        path: "/naver-shopping-commerce",
        prefix: "naver-shopping-commerce",
        captureIdBase: "fixture-naver-shopping-commerce",
        expectedProductText: "Naver Shopping Laptop Pro",
        expectedPriceText: "KRW 1,180,000",
        expectedDestinationUrl: `${fixture.baseUrl}/naver-shopping-product-detail`
      },
      {
        url: "https://browse.gmarket.co.kr/search?keyword=laptop",
        path: "/gmarket-commerce",
        prefix: "gmarket-commerce",
        captureIdBase: "fixture-gmarket-commerce",
        expectedProductText: "Gmarket Laptop Pro",
        expectedPriceText: "KRW 1,070,000",
        expectedDestinationUrl: `${fixture.baseUrl}/gmarket-product-detail`
      },
      {
        url: "https://www.11st.co.kr/products/123456789",
        path: "/elevenst-commerce",
        prefix: "elevenst-commerce",
        captureIdBase: "fixture-elevenst-commerce",
        expectedProductText: "11st Laptop Pro",
        expectedPriceText: "KRW 1,030,000",
        expectedDestinationUrl: `${fixture.baseUrl}/elevenst-product-detail`
      },
      {
        url: "https://www.walmart.com/search?q=laptop",
        path: "/walmart-commerce",
        prefix: "walmart-commerce",
        captureIdBase: "fixture-walmart-commerce",
        expectedProductText: "Walmart Laptop Pro",
        expectedPriceText: "USD 799",
        expectedDestinationUrl: `${fixture.baseUrl}/walmart-product-detail`
      },
      {
        url: "https://www.ebay.com/sch/i.html?_nkw=laptop",
        path: "/ebay-commerce",
        prefix: "ebay-commerce",
        captureIdBase: "fixture-ebay-commerce",
        expectedProductText: "eBay Laptop Pro",
        expectedPriceText: "USD 649",
        expectedDestinationUrl: `${fixture.baseUrl}/ebay-product-detail`
      }
    ];

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: cases.length,
        capability: "read-write"
      });

      for (const commerceCase of cases) {
        const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}${commerceCase.path}`);
        const plan = planFor(commerceCase.url);

        const result = await executeSourceNavigationActions({
          plan,
          executableActions: [
            {
              actionKey: "query-state",
              operation: "fill",
              selector: `#${commerceCase.prefix}-query`,
              value: "laptop",
              expectedStates: [{ selector: "#query-state", textIncludes: "query: laptop" }]
            },
            {
              actionKey: "visible-filters",
              operation: "click",
              selector: `#${commerceCase.prefix}-filter`,
              captureScopes: [{ key: "filter-state", selector: `#${commerceCase.prefix}-filter-state` }],
              expectedStates: [{ selector: `#${commerceCase.prefix}-filter-state`, textIncludes: "filter: shipping visible" }]
            },
            {
              actionKey: "visible-sort",
              operation: "select",
              selector: `#${commerceCase.prefix}-sort`,
              value: "price",
              expectedStates: [{ selector: "#sort-state", textIncludes: "sort: price" }]
            },
            {
              actionKey: "result-scroll",
              operation: "scroll",
              direction: "down",
              pixels: 600,
              captureScopes: [{ key: "product-list", selector: `#${commerceCase.prefix}-product-list` }],
              expectedStates: [{ selector: `#${commerceCase.prefix}-product-list`, textIncludes: commerceCase.expectedProductText }]
            },
            {
              actionKey: "result-pagination",
              operation: "click",
              selector: `#${commerceCase.prefix}-more-products`,
              captureScopes: [{ key: "product-list", selector: `#${commerceCase.prefix}-product-list` }],
              expectedStates: [{ selector: `#${commerceCase.prefix}-product-list`, textIncludes: "extra product" }]
            },
            {
              actionKey: "product-card",
              operation: "capture",
              captureScopes: [{ key: "product-card", selector: `#${commerceCase.prefix}-product-card` }],
              expectedStates: [{ selector: `#${commerceCase.prefix}-product-card`, textIncludes: commerceCase.expectedProductText }]
            },
            {
              actionKey: "seller-terms",
              operation: "click",
              selector: `#${commerceCase.prefix}-seller-terms-button`,
              captureScopes: [
                { key: "seller-terms", selector: `#${commerceCase.prefix}-seller-terms` },
                { key: "shipping-panel", selector: `#${commerceCase.prefix}-shipping-panel` }
              ],
              expectedStates: [{ selector: `#${commerceCase.prefix}-seller-terms`, textIncludes: "return window" }]
            },
            {
              actionKey: "price-ocr",
              operation: "capture",
              captureScopes: [{ key: "price-badge", selector: `#${commerceCase.prefix}-price-badge` }],
              expectedStates: [{ selector: `#${commerceCase.prefix}-price-badge`, textIncludes: commerceCase.expectedPriceText }]
            },
            {
              actionKey: "destination-followup",
              operation: "extract_destinations",
              selector: `#${commerceCase.prefix}-destination-links`,
              maxLinks: 5,
              captureId: `${commerceCase.captureIdBase}-destination`
            }
          ],
          browserPool: pool,
          artifactWriter,
          agentId: "agent",
          contextToken: lease.contextToken,
          pageId: page.pageId,
          runDir,
          sourceUrl: `${fixture.baseUrl}${commerceCase.path}`,
          captureIdBase: commerceCase.captureIdBase,
          limits: { perActionTimeoutMs: 5_000 }
        });

        expect(result.status).toBe("partial");
        expect(result.executedActionCount).toBe(9);
        expect(result.unsupportedActionCount).toBe(3);
        expect(result.failedActionCount).toBe(0);
        expect(result.followUps).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              actionKey: "destination-followup",
              url: commerceCase.expectedDestinationUrl
            })
          ])
        );

        const productCard = await readFile(join(runDir, "raw", `${commerceCase.captureIdBase}-product-card-scope-product-card-after.txt`), "utf8");
        expect(productCard).toContain(commerceCase.expectedProductText);
        const sellerTerms = await readFile(join(runDir, "raw", `${commerceCase.captureIdBase}-seller-terms-scope-seller-terms-after.txt`), "utf8");
        expect(sellerTerms).toContain("return window");
        expect(sellerTerms).toContain("No cart or checkout action submitted");
        const priceBadge = await readFile(join(runDir, "raw", `${commerceCase.captureIdBase}-price-ocr-scope-price-badge-after.txt`), "utf8");
        expect(priceBadge).toContain(commerceCase.expectedPriceText);
      }
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures blog media gallery scopes without bypassing member walls", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping media gallery source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-gallery-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/blog`);
      const plan = planFor("https://blog.naver.com/example/123");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "article-capture",
            operation: "capture",
            captureScopes: [{ key: "article", selector: "#article" }],
            expectedStates: [{ selector: "#article", textIncludes: "public blog article" }]
          },
          {
            actionKey: "media-gallery",
            operation: "click",
            selector: "#open-gallery",
            captureScopes: [{ key: "gallery", selector: "#gallery" }],
            expectedStates: [{ selector: "#gallery", textIncludes: "Image caption one" }]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#blog-destination-links",
            maxLinks: 3,
            captureId: "blog-destination"
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/blog`,
        captureIdBase: "fixture-blog-gallery",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(3);
      expect(result.skippedActionCount).toBe(2);
      expect(result.unsupportedActionCount).toBe(1);
      expect(result.followUps).toEqual([
        expect.objectContaining({ url: `${fixture.baseUrl}/blog-source`, linkText: "Source page" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/related-blog-post`, linkText: "Related post" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/official-blog-source`, linkText: "Official source" })
      ]);
      expect(result.actionResults.find((action) => action.actionKey === "unsupported:member-only-bypass")).toBeDefined();

      const galleryText = await readFile(join(runDir, "raw", "fixture-blog-gallery-media-gallery-scope-gallery-after.txt"), "utf8");
      expect(galleryText).toContain("Image caption one");
      expect(galleryText).toContain("Image caption two");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures video/social obstruction scopes without gate bypass", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping video obstruction source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-video-obstruction-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/video-obstruction`);
      const plan = planFor("https://www.tiktok.com/@example/video/123");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "obstruction-check",
            operation: "capture",
            captureScopes: [{ key: "gate", selector: "#gate" }],
            expectedStates: [{ selector: "#gate", textIncludes: "Log in to continue" }]
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/video-obstruction`,
        captureIdBase: "fixture-video-obstruction",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(1);
      expect(result.skippedActionCount).toBe(4);
      expect(result.unsupportedActionCount).toBe(3);
      const obstruction = result.actionResults.find((action) => action.actionKey === "obstruction-check");
      expect(obstruction?.status).toBe("ok");
      expect(obstruction?.scopedCaptureArtifactIds?.length).toBeGreaterThan(0);

      const gateText = await readFile(join(runDir, "raw", "fixture-video-obstruction-obstruction-check-scope-gate-after.txt"), "utf8");
      expect(gateText).toContain("Log in to continue");
      expect(gateText).toContain("No bypass attempted");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures non-login video/social metadata, frame, and overlay scopes", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping visible video/social source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-video-visible-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/video-visible`);
      const plan = planFor("https://www.instagram.com/reel/example/");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "obstruction-check",
            operation: "capture",
            captureScopes: [{ key: "obstruction-state", selector: "#obstruction-state" }],
            expectedStates: [{ selector: "#obstruction-state", textIncludes: "obstruction: none" }]
          },
          {
            actionKey: "visible-metadata",
            operation: "capture",
            captureScopes: [
              { key: "metadata", selector: "#post-metadata" },
              { key: "profile-card", selector: "#profile-card" },
              { key: "caption-body", selector: "#caption-body" },
              { key: "engagement-state", selector: "#engagement-state" },
              { key: "comment-preview-list", selector: "#comment-preview-list" }
            ],
            expectedStates: [
              { selector: "#post-metadata", textIncludes: "Public creator profile" },
              { selector: "#comment-preview-list", textIncludes: "public comment preview" }
            ]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#social-destination-links",
            maxLinks: 3,
            captureId: "social-destination"
          },
          {
            actionKey: "frame-sampling",
            operation: "capture",
            captureScopes: [{ key: "video-frame", selector: "#video-frame" }],
            expectedStates: [{ selector: "#video-frame", textIncludes: "frame at 00:05" }]
          },
          {
            actionKey: "overlay-ocr",
            operation: "capture",
            captureScopes: [{ key: "overlay-text", selector: "#overlay-text" }],
            expectedStates: [{ selector: "#overlay-text", textIncludes: "visible overlay text" }]
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/video-visible`,
        captureIdBase: "fixture-video-visible",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(5);
      expect(result.skippedActionCount).toBe(0);
      expect(result.unsupportedActionCount).toBe(3);
      expect(result.followUps).toEqual([
        expect.objectContaining({ url: `${fixture.baseUrl}/creator-profile`, linkText: "Creator profile" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/external-bio`, linkText: "External bio link" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/canonical-reel`, linkText: "Canonical reel page" })
      ]);
      expect(result.actionResults.find((action) => action.actionKey === "unsupported:raw-stream-download")).toBeDefined();
      expect(result.actionResults.find((action) => action.actionKey === "unsupported:social-write")).toBeDefined();

      const metadata = await readFile(join(runDir, "raw", "fixture-video-visible-visible-metadata-scope-metadata-after.txt"), "utf8");
      expect(metadata).toContain("Public creator profile");
      expect(metadata).toContain("caption visible without login");
      const caption = await readFile(join(runDir, "raw", "fixture-video-visible-visible-metadata-scope-caption-body-after.txt"), "utf8");
      expect(caption).toContain("Tokyo cafe reel caption");
      const comments = await readFile(join(runDir, "raw", "fixture-video-visible-visible-metadata-scope-comment-preview-list-after.txt"), "utf8");
      expect(comments).toContain("public comment preview");
      const frame = await readFile(join(runDir, "raw", "fixture-video-visible-frame-sampling-scope-video-frame-after.txt"), "utf8");
      expect(frame).toContain("frame at 00:05");
      const overlay = await readFile(join(runDir, "raw", "fixture-video-visible-overlay-ocr-scope-overlay-text-after.txt"), "utf8");
      expect(overlay).toContain("visible overlay text");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures YouTube search metadata and precise media destination links", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping YouTube source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-youtube-visible-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/youtube-visible`);
      const plan = planFor("https://www.youtube.com/results?search_query=seoul+cafe");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "obstruction-check",
            operation: "capture",
            captureScopes: [{ key: "obstruction-state", selector: "#youtube-obstruction-state" }],
            expectedStates: [{ selector: "#youtube-obstruction-state", textIncludes: "obstruction: none" }]
          },
          {
            actionKey: "visible-metadata",
            operation: "capture",
            captureScopes: [
              { key: "video-card", selector: "ytd-video-renderer" },
              { key: "rich-card", selector: "ytd-rich-item-renderer" },
              { key: "contents", selector: "#contents" }
            ],
            expectedStates: [
              { selector: "ytd-video-renderer", textIncludes: "Seoul cafe walkthrough" },
              { selector: "ytd-rich-item-renderer", textIncludes: "Related cafe video" }
            ]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: 'ytd-video-renderer a#video-title[href*="/watch"]',
            maxLinks: 2,
            captureId: "youtube-destination"
          },
          {
            actionKey: "frame-sampling",
            operation: "capture",
            captureScopes: [{ key: "thumbnail-frame", selector: "ytd-thumbnail" }],
            expectedStates: [{ selector: "ytd-thumbnail", textIncludes: "thumbnail frame" }]
          },
          {
            actionKey: "overlay-ocr",
            operation: "capture",
            captureScopes: [{ key: "overlay-text", selector: "#overlay-text" }],
            expectedStates: [{ selector: "#overlay-text", textIncludes: "visible YouTube overlay text" }]
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/youtube-visible`,
        captureIdBase: "fixture-youtube-visible",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(5);
      expect(result.skippedActionCount).toBe(0);
      expect(result.unsupportedActionCount).toBe(3);
      expect(result.followUps).toEqual([expect.objectContaining({ url: `${fixture.baseUrl}/watch?v=seoulcafes`, linkText: "Seoul cafe walkthrough" })]);
      const extraction = result.actionResults.find((action) => action.actionKey === "destination-followup");
      expect(extraction?.operationDetails?.anchorDestinationCandidateCount).toBe(1);

      const metadata = await readFile(join(runDir, "raw", "fixture-youtube-visible-visible-metadata-scope-video-card-after.txt"), "utf8");
      expect(metadata).toContain("Seoul cafe walkthrough");
      expect(metadata).toContain("Public Cafe Channel");
      const overlay = await readFile(join(runDir, "raw", "fixture-youtube-visible-overlay-ocr-scope-overlay-text-after.txt"), "utf8");
      expect(overlay).toContain("visible YouTube overlay text");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures TikTok public post metadata, SPA destinations, frame, and overlay scopes", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping TikTok visible source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-tiktok-visible-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/tiktok-visible`);
      const plan = planFor("https://www.tiktok.com/@public_cafe/video/1234567890123456789");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "obstruction-check",
            operation: "capture",
            captureScopes: [{ key: "obstruction-state", selector: "#tiktok-obstruction-state" }],
            expectedStates: [{ selector: "#tiktok-obstruction-state", textIncludes: "obstruction: none" }]
          },
          {
            actionKey: "visible-metadata",
            operation: "capture",
            captureScopes: [
              { key: "metadata", selector: "#tiktok-post-metadata" },
              { key: "profile-card", selector: "#tiktok-profile-card" },
              { key: "caption-body", selector: "#tiktok-caption-body" },
              { key: "engagement-state", selector: "#tiktok-engagement-state" },
              { key: "comment-preview-list", selector: "#tiktok-comment-preview-list" }
            ],
            expectedStates: [
              { selector: "#tiktok-post-metadata", textIncludes: "TikTok public creator profile" },
              { selector: "#tiktok-comment-preview-list", textIncludes: "public TikTok comment preview" }
            ]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#tiktok-destination-links",
            maxLinks: 5,
            captureId: "tiktok-destination"
          },
          {
            actionKey: "frame-sampling",
            operation: "capture",
            captureScopes: [{ key: "video-frame", selector: "#tiktok-video-frame" }],
            expectedStates: [{ selector: "#tiktok-video-frame", textIncludes: "frame at 00:07" }]
          },
          {
            actionKey: "overlay-ocr",
            operation: "capture",
            captureScopes: [{ key: "overlay-text", selector: "#tiktok-overlay-text" }],
            expectedStates: [{ selector: "#tiktok-overlay-text", textIncludes: "visible TikTok overlay text" }]
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/tiktok-visible`,
        captureIdBase: "fixture-tiktok-visible",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(5);
      expect(result.skippedActionCount).toBe(0);
      expect(result.unsupportedActionCount).toBe(3);
      expect(result.followUps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ url: `${fixture.baseUrl}/@public_cafe`, linkText: "Public TikTok profile" }),
          expect.objectContaining({ url: `${fixture.baseUrl}/restaurant-source`, linkText: "Restaurant source" }),
          expect.objectContaining({ url: `${fixture.baseUrl}/tiktok-video/1234567890123456789`, linkText: "Canonical TikTok video" }),
          expect.objectContaining({ url: `${fixture.baseUrl}/tiktok-related-video`, linkText: "Related TikTok video card" }),
          expect.objectContaining({ url: `${fixture.baseUrl}/tiktok-creator-card`, linkText: "TikTok creator card" })
        ])
      );
      const extraction = result.actionResults.find((action) => action.actionKey === "destination-followup");
      expect(extraction?.operationDetails?.attributeDestinationCandidateCount).toBe(2);
      expect(extraction?.operationDetails?.anchorDestinationCandidateCount).toBe(3);
      expect(result.actionResults.find((action) => action.actionKey === "unsupported:raw-stream-download")).toBeDefined();
      expect(result.actionResults.find((action) => action.actionKey === "unsupported:social-write")).toBeDefined();

      const metadata = await readFile(join(runDir, "raw", "fixture-tiktok-visible-visible-metadata-scope-metadata-after.txt"), "utf8");
      expect(metadata).toContain("TikTok public creator profile");
      expect(metadata).toContain("visible TikTok caption");
      const comments = await readFile(join(runDir, "raw", "fixture-tiktok-visible-visible-metadata-scope-comment-preview-list-after.txt"), "utf8");
      expect(comments).toContain("public TikTok comment preview");
      const frame = await readFile(join(runDir, "raw", "fixture-tiktok-visible-frame-sampling-scope-video-frame-after.txt"), "utf8");
      expect(frame).toContain("frame at 00:07");
      const overlay = await readFile(join(runDir, "raw", "fixture-tiktok-visible-overlay-ocr-scope-overlay-text-after.txt"), "utf8");
      expect(overlay).toContain("visible TikTok overlay text");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("captures X/Twitter public post metadata, thread context, media, and overlay scopes", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping X/Twitter source navigation executor test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startNavigationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-x-visible-"));
    runDirs.push(runDir);
    const artifactWriter = new ArtifactWriter();
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager, { artifactWriter });

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        capability: "read-write"
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/x-visible`);
      const plan = planFor("https://x.com/example/status/1234567890");

      const result = await executeSourceNavigationActions({
        plan,
        executableActions: [
          {
            actionKey: "obstruction-check",
            operation: "capture",
            captureScopes: [{ key: "obstruction-state", selector: "#x-obstruction-state" }],
            expectedStates: [{ selector: "#x-obstruction-state", textIncludes: "obstruction: none" }]
          },
          {
            actionKey: "visible-metadata",
            operation: "capture",
            captureScopes: [
              { key: "post-metadata", selector: "#x-post-metadata" },
              { key: "profile-card", selector: "#x-profile-card" },
              { key: "thread-context", selector: "#x-thread-context" },
              { key: "engagement-state", selector: "#x-engagement-state" },
              { key: "reply-list", selector: "#x-reply-list" }
            ],
            expectedStates: [{ selector: "#x-post-metadata", textIncludes: "@public_creator" }]
          },
          {
            actionKey: "destination-followup",
            operation: "extract_destinations",
            selector: "#social-destination-links",
            maxLinks: 3,
            captureId: "x-destination"
          },
          {
            actionKey: "frame-sampling",
            operation: "capture",
            captureScopes: [{ key: "media-frame", selector: "#x-media-frame" }],
            expectedStates: [{ selector: "#x-media-frame", textIncludes: "media frame visible" }]
          },
          {
            actionKey: "overlay-ocr",
            operation: "capture",
            captureScopes: [{ key: "overlay-text", selector: "#x-overlay-text" }],
            expectedStates: [{ selector: "#x-overlay-text", textIncludes: "overlay text on media" }]
          }
        ],
        browserPool: pool,
        artifactWriter,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        runDir,
        sourceUrl: `${fixture.baseUrl}/x-visible`,
        captureIdBase: "fixture-x-visible",
        limits: { perActionTimeoutMs: 5_000 }
      });

      expect(result.status).toBe("partial");
      expect(result.executedActionCount).toBe(5);
      expect(result.unsupportedActionCount).toBe(3);
      expect(result.followUps).toEqual([
        expect.objectContaining({ url: `${fixture.baseUrl}/public_creator`, linkText: "Public Creator profile" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/example/status/9876543210`, linkText: "Related status" }),
        expect.objectContaining({ url: `${fixture.baseUrl}/external-source`, linkText: "External source" })
      ]);
      expect(result.actionResults.find((action) => action.actionKey === "unsupported:social-write")).toBeDefined();

      const metadata = await readFile(join(runDir, "raw", "fixture-x-visible-visible-metadata-scope-post-metadata-after.txt"), "utf8");
      expect(metadata).toContain("@public_creator");
      expect(metadata).toContain("posted 4 minutes ago");
      const thread = await readFile(join(runDir, "raw", "fixture-x-visible-visible-metadata-scope-thread-context-after.txt"), "utf8");
      expect(thread).toContain("reply context visible");
      const replies = await readFile(join(runDir, "raw", "fixture-x-visible-visible-metadata-scope-reply-list-after.txt"), "utf8");
      expect(replies).toContain("public reply preview");
      const frame = await readFile(join(runDir, "raw", "fixture-x-visible-frame-sampling-scope-media-frame-after.txt"), "utf8");
      expect(frame).toContain("media frame visible");
      const overlay = await readFile(join(runDir, "raw", "fixture-x-visible-overlay-ocr-scope-overlay-text-after.txt"), "utf8");
      expect(overlay).toContain("overlay text on media");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("rejects duplicate executable recipes before touching the browser", async () => {
    const artifactWriter = new ArtifactWriter();
    await expect(
      executeSourceNavigationActions({
        plan: planFor("https://example.com/"),
        executableActions: [
          { actionKey: "page-capture", operation: "capture" },
          { actionKey: "page-capture", operation: "scroll" }
        ],
        browserPool: {} as BrowserPool,
        artifactWriter,
        agentId: "agent",
        contextToken: "context",
        pageId: "page",
        runDir: "unused"
      })
    ).rejects.toThrow(/Duplicate executable action recipe/);
  });
});

function planFor(url: string) {
  return describeSourceNavigationPlan({
    sourceStrategy: describeSourceStrategy(url),
    mode: "safe_execute"
  });
}

async function chromiumAvailable(): Promise<boolean> {
  return chromium
    .launch({ headless: true })
    .then(async (browser) => {
      await browser.close();
      return true;
    })
    .catch(() => false);
}

function communityFixtureForPath(path: string): {
  platform: string;
  queryId: string;
  destination: string;
  titleText: string;
} {
  const fixtures: Record<string, { platform: string; queryId: string; destination: string; titleText: string }> = {
    "/dcinside-community": {
      platform: "DCInside",
      queryId: "dcinside-query",
      destination: "/dcinside-thread",
      titleText: "DCInside community thread card"
    },
    "/naver-kin-community": {
      platform: "Naver Knowledge iN",
      queryId: "naver-kin-query",
      destination: "/naver-kin-answer",
      titleText: "Naver Knowledge iN question card"
    },
    "/reddit-community": {
      platform: "Reddit",
      queryId: "reddit-query",
      destination: "/reddit-thread",
      titleText: "Reddit community thread card"
    },
    "/quora-community": {
      platform: "Quora",
      queryId: "quora-query",
      destination: "/quora-answer",
      titleText: "Quora community question card"
    },
    "/stack-overflow-community": {
      platform: "Stack Overflow",
      queryId: "stack-overflow-query",
      destination: "/stack-overflow-answer",
      titleText: "Stack Overflow question card"
    }
  };
  const fixture = fixtures[path];
  if (fixture === undefined) {
    throw new Error(`No community fixture for ${path}`);
  }
  return fixture;
}

function destinationPlatformForPath(path: string): string {
  const platforms: Record<string, string> = {
    "/dcinside-thread": "DCInside",
    "/naver-kin-answer": "Naver Knowledge iN",
    "/reddit-thread": "Reddit",
    "/quora-answer": "Quora",
    "/stack-overflow-answer": "Stack Overflow"
  };
  const platform = platforms[path];
  if (platform === undefined) {
    throw new Error(`No destination fixture for ${path}`);
  }
  return platform;
}

interface SearchEngineFixture {
  engine: string;
  queryId: string;
  queryName: "p" | "q";
  tabImagesId: string;
  tabNewsId: string;
  tabVideosId: string;
  filterId: string;
  nextId: string;
  resultsId: string;
  resultCardId: string;
  contextId: string;
  destinationLinksId: string;
  resultLinkId: string;
  resultClass: string;
  destinationPath: string;
  newsPath: string;
  localPath: string;
}

function searchEngineFixtureForPath(path: string): SearchEngineFixture | undefined {
  const fixtures: Record<string, SearchEngineFixture> = {
    "/bing-search": {
      engine: "Bing",
      queryId: "bing-query",
      queryName: "q",
      tabImagesId: "bing-tab-images",
      tabNewsId: "bing-tab-news",
      tabVideosId: "bing-tab-videos",
      filterId: "bing-filter",
      nextId: "bing-next-page",
      resultsId: "bing-results",
      resultCardId: "bing-result-card",
      contextId: "bing-context",
      destinationLinksId: "bing-destination-links",
      resultLinkId: "bing-result-link",
      resultClass: "b_algo",
      destinationPath: "/bing-destination",
      newsPath: "/bing-news-destination",
      localPath: "/bing-map-destination"
    },
    "/yahoo-search": {
      engine: "Yahoo Search",
      queryId: "yahoo-query",
      queryName: "p",
      tabImagesId: "yahoo-tab-images",
      tabNewsId: "yahoo-tab-news",
      tabVideosId: "yahoo-tab-videos",
      filterId: "yahoo-filter",
      nextId: "yahoo-next-page",
      resultsId: "yahoo-results",
      resultCardId: "yahoo-result-card",
      contextId: "yahoo-context",
      destinationLinksId: "yahoo-destination-links",
      resultLinkId: "yahoo-result-link",
      resultClass: "dd algo",
      destinationPath: "/yahoo-destination",
      newsPath: "/yahoo-news-destination",
      localPath: "/yahoo-local-destination"
    },
    "/yahoo-japan-search": {
      engine: "Yahoo Japan",
      queryId: "yahoo-japan-query",
      queryName: "p",
      tabImagesId: "yahoo-japan-tab-images",
      tabNewsId: "yahoo-japan-tab-news",
      tabVideosId: "yahoo-japan-tab-videos",
      filterId: "yahoo-japan-filter",
      nextId: "yahoo-japan-next-page",
      resultsId: "yahoo-japan-contents",
      resultCardId: "yahoo-japan-result-card",
      contextId: "yahoo-japan-context",
      destinationLinksId: "yahoo-japan-destination-links",
      resultLinkId: "yahoo-japan-result-link",
      resultClass: "sw-Card sw-CardBase",
      destinationPath: "/yahoo-japan-destination",
      newsPath: "/yahoo-japan-news-destination",
      localPath: "/yahoo-japan-map-destination"
    }
  };
  return fixtures[path];
}

interface CommerceMarketplaceFixture {
  platform: string;
  prefix: string;
  productName: string;
  priceText: string;
  shippingText: string;
  productClass: string;
  productAttributes: string;
  priceClass: string;
  detailPath: string;
  reviewPath: string;
  sellerPath: string;
  brandPath: string;
}

function commerceMarketplaceFixtureForPath(path: string): CommerceMarketplaceFixture | undefined {
  const fixtures: Record<string, CommerceMarketplaceFixture> = {
    "/amazon-commerce": {
      platform: "Amazon",
      prefix: "amazon-commerce",
      productName: "Amazon Laptop Pro",
      priceText: "USD 899",
      shippingText: "Prime delivery visible",
      productClass: "s-result-item",
      productAttributes: 'data-component-type="s-search-result" data-asin="B0AMZ"',
      priceClass: "a-price",
      detailPath: "/amazon-product-detail",
      reviewPath: "/amazon-product-reviews",
      sellerPath: "/amazon-seller-profile",
      brandPath: "/amazon-brand-store"
    },
    "/coupang-commerce": {
      platform: "Coupang",
      prefix: "coupang-commerce",
      productName: "Coupang Laptop Pro",
      priceText: "KRW 1,290,000",
      shippingText: "rocket delivery visible",
      productClass: "search-product search-product-link",
      productAttributes: 'data-product-id="1001" data-url="/coupang-product-detail" data-product-url="/coupang-product-detail" data-item-url="/coupang-product-detail"',
      priceClass: "price-value sale-price",
      detailPath: "/coupang-product-detail",
      reviewPath: "/coupang-product-reviews",
      sellerPath: "/coupang-seller-profile",
      brandPath: "/coupang-brand-store"
    },
    "/naver-shopping-commerce": {
      platform: "Naver Shopping",
      prefix: "naver-shopping-commerce",
      productName: "Naver Shopping Laptop Pro",
      priceText: "KRW 1,180,000",
      shippingText: "smartstore shipping visible",
      productClass: "basicList_product__fixture product_item productCard",
      productAttributes: 'data-product-url="/naver-shopping-product-detail" data-item-url="/naver-shopping-product-detail" data-brand-url="/naver-shopping-brand-store"',
      priceClass: "price_num product_price",
      detailPath: "/naver-shopping-product-detail",
      reviewPath: "/naver-shopping-product-reviews",
      sellerPath: "/naver-shopping-seller-profile",
      brandPath: "/naver-shopping-brand-store"
    },
    "/gmarket-commerce": {
      platform: "Gmarket",
      prefix: "gmarket-commerce",
      productName: "Gmarket Laptop Pro",
      priceText: "KRW 1,070,000",
      shippingText: "seller shipping fee visible",
      productClass: "box__item itemcard",
      productAttributes: 'data-item-url="/gmarket-product-detail" data-product-url="/gmarket-product-detail" data-seller-url="/gmarket-seller-profile"',
      priceClass: "box__price text__price box__item-price",
      detailPath: "/gmarket-product-detail",
      reviewPath: "/gmarket-product-reviews",
      sellerPath: "/gmarket-seller-profile",
      brandPath: "/gmarket-brand-store"
    },
    "/elevenst-commerce": {
      platform: "11st",
      prefix: "elevenst-commerce",
      productName: "11st Laptop Pro",
      priceText: "KRW 1,030,000",
      shippingText: "11st delivery badge visible",
      productClass: "search_content c_prd product",
      productAttributes: 'data-item-url="/elevenst-product-detail" data-product-url="/elevenst-product-detail" data-seller-url="/elevenst-seller-profile"',
      priceClass: "salePrice c_prd_price",
      detailPath: "/elevenst-product-detail",
      reviewPath: "/elevenst-product-reviews",
      sellerPath: "/elevenst-seller-profile",
      brandPath: "/elevenst-brand-store"
    },
    "/walmart-commerce": {
      platform: "Walmart",
      prefix: "walmart-commerce",
      productName: "Walmart Laptop Pro",
      priceText: "USD 799",
      shippingText: "free two-day delivery visible",
      productClass: "product walmart-card",
      productAttributes: 'data-item-id="WM1001" data-product-url="/walmart-product-detail" data-item-url="/walmart-product-detail" data-seller-url="/walmart-seller-profile" data-testid="product-card"',
      priceClass: "price walmart-price",
      detailPath: "/walmart-product-detail",
      reviewPath: "/walmart-product-reviews",
      sellerPath: "/walmart-seller-profile",
      brandPath: "/walmart-brand-store"
    },
    "/ebay-commerce": {
      platform: "eBay",
      prefix: "ebay-commerce",
      productName: "eBay Laptop Pro",
      priceText: "USD 649",
      shippingText: "seller shipping visible",
      productClass: "s-item s-card",
      productAttributes: 'data-item-url="/ebay-product-detail" data-product-url="/ebay-product-detail" data-seller-url="/ebay-seller-profile"',
      priceClass: "s-item__price x-price-primary",
      detailPath: "/ebay-product-detail",
      reviewPath: "/ebay-product-reviews",
      sellerPath: "/ebay-seller-profile",
      brandPath: "/ebay-brand-store"
    }
  };
  return fixtures[path];
}

async function startNavigationFixtureServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const path = request.url?.split("?", 1)[0] ?? "/";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const searchEngineFixture = searchEngineFixtureForPath(path);
    if (searchEngineFixture !== undefined) {
      response.end(`<!doctype html><html><head><title>${searchEngineFixture.engine} search fixture</title></head><body>
        <main id="${searchEngineFixture.resultsId}-shell">
          <h1>${searchEngineFixture.engine} search fixture</h1>
          <label>Query <input id="${searchEngineFixture.queryId}" name="${searchEngineFixture.queryName}" aria-label="${searchEngineFixture.engine} query"></label>
          <p id="query-state">query:</p>
          <nav>
            <button id="${searchEngineFixture.tabImagesId}">Images</button>
            <button id="${searchEngineFixture.tabNewsId}">News</button>
            <button id="${searchEngineFixture.tabVideosId}">Videos</button>
          </nav>
          <p id="active-vertical">vertical: web</p>
          <button id="${searchEngineFixture.filterId}">recent filter</button>
          <section id="filter-state">filter: all</section>
          <p id="page-state">page: 1</p>
          <section id="${searchEngineFixture.resultsId}">
            <article id="${searchEngineFixture.resultCardId}" class="${searchEngineFixture.resultClass}">
              <h2 class="compTitle">${searchEngineFixture.engine} result card - Tokyo hotel</h2>
              <p class="b_caption compText">visible search snippet with publisher, image, video, and map/local context</p>
              <nav id="${searchEngineFixture.destinationLinksId}">
                <a id="${searchEngineFixture.resultLinkId}" href="${searchEngineFixture.destinationPath}">${searchEngineFixture.engine} destination page</a>
                <a href="${searchEngineFixture.newsPath}">${searchEngineFixture.engine} news destination</a>
                <a href="${searchEngineFixture.localPath}">${searchEngineFixture.engine} local/map destination</a>
              </nav>
            </article>
            <aside id="${searchEngineFixture.contextId}">${searchEngineFixture.engine} context panel with entity facts and source links</aside>
          </section>
          <button id="${searchEngineFixture.nextId}">next page</button>
        </main>
        <script>
          document.querySelector('#${searchEngineFixture.queryId}').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#${searchEngineFixture.tabNewsId}').addEventListener('click', () => {
            document.querySelector('#active-vertical').textContent = 'vertical: news';
          });
          document.querySelector('#${searchEngineFixture.filterId}').addEventListener('click', () => {
            document.querySelector('#filter-state').textContent = 'filter: recent';
          });
          document.querySelector('#${searchEngineFixture.nextId}').addEventListener('click', () => {
            document.querySelector('#page-state').textContent = 'page: 2';
            const extra = document.createElement('article');
            extra.textContent = '${searchEngineFixture.engine} page 2 result with visible search snippet';
            document.querySelector('#${searchEngineFixture.resultsId}').appendChild(extra);
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/google-scholar-portal") {
      response.end(`<!doctype html><html><head><title>Google Scholar fixture</title></head><body>
        <main id="gs_bdy">
          <header id="gs_hdr">
            <label>Scholar query <input id="gs_hdr_tsi" name="q" value="browser evidence"></label>
            <input id="gs_asd_q" name="as_q" value="browser evidence">
          </header>
          <nav id="gs_lnv">
            <a href="/scholar?hl=en">All results</a>
            <a class="scholar-filter" href="/scholar?as_ylo=2022">Since 2022</a>
            <a class="scholar-filter" href="/scholar?scisbd=1">Sort by date</a>
          </nav>
          <p id="scholar-section-state">section: all results</p>
          <p id="scholar-filter-state">filter: since 2022; sort: relevance</p>
          <section id="gs_res_ccl">
            <div id="gs_res_ccl_mid">
              <article class="gs_r gs_or">
                <div class="gs_or_ggsm">
                  <a href="https://doi.org/10.1000/scholar-fixture">PDF full text</a>
                </div>
                <div class="gs_ri">
                  <h3 class="gs_rt"><a href="https://publisher.example/paper">Google Scholar academic result card</a></h3>
                  <div class="gs_a">A Researcher, B Author - Journal of Browser Evidence, 2025 - publisher.example</div>
                  <div class="gs_rs">Visible abstract snippet with citation context, method summary, and record metadata for a browser evidence fixture.</div>
                  <div class="gs_fl">
                    <a href="/scholar?cites=123456789">Cited by 42</a>
                    <a href="/scholar?cluster=987654321">All 7 versions</a>
                    <a href="https://source.example/scholar-citation">Cite</a>
                    <a href="https://library.example/record">Library record</a>
                  </div>
                </div>
              </article>
            </div>
          </section>
          <section id="scholar-obstruction-state">login: not required. captcha: none. paid full text: not clicked. no bypass attempted.</section>
        </main>
      </body></html>`);
      return;
    }
    const commerceMarketplaceFixture = commerceMarketplaceFixtureForPath(path);
    if (commerceMarketplaceFixture !== undefined) {
      response.end(`<!doctype html><html><head><title>${commerceMarketplaceFixture.platform} commerce fixture</title></head><body>
        <main style="min-height: 1700px">
          <h1>${commerceMarketplaceFixture.platform} commerce fixture</h1>
          <label>Product search <input id="${commerceMarketplaceFixture.prefix}-query" aria-label="${commerceMarketplaceFixture.platform} product search"></label>
          <p id="query-state">query:</p>
          <button id="${commerceMarketplaceFixture.prefix}-filter">shipping filter</button>
          <p id="${commerceMarketplaceFixture.prefix}-filter-state">filter: all products</p>
          <select id="${commerceMarketplaceFixture.prefix}-sort" aria-label="sort">
            <option value="recommended">recommended</option>
            <option value="price">price</option>
            <option value="review">review</option>
          </select>
          <p id="sort-state">sort: recommended</p>
          <section id="${commerceMarketplaceFixture.prefix}-product-list" class="product-list" style="margin-top: 760px">
            <article id="${commerceMarketplaceFixture.prefix}-product-card" class="${commerceMarketplaceFixture.productClass}" ${commerceMarketplaceFixture.productAttributes}>
              <h2>${commerceMarketplaceFixture.productName}</h2>
              <p id="${commerceMarketplaceFixture.prefix}-price-badge" class="${commerceMarketplaceFixture.priceClass}" data-a-color="price">${commerceMarketplaceFixture.priceText} - coupon visible - ${commerceMarketplaceFixture.shippingText}<span class="a-price-whole">${commerceMarketplaceFixture.priceText}</span></p>
              <p>seller: ${commerceMarketplaceFixture.platform} DirectStore - rating 4.7 - review count 502</p>
              <nav id="${commerceMarketplaceFixture.prefix}-destination-links">
                <a id="${commerceMarketplaceFixture.prefix}-product-detail-link" href="${commerceMarketplaceFixture.detailPath}">${commerceMarketplaceFixture.platform} product detail page</a>
                <a id="${commerceMarketplaceFixture.prefix}-product-review-link" href="${commerceMarketplaceFixture.reviewPath}">${commerceMarketplaceFixture.platform} review page</a>
                <a id="${commerceMarketplaceFixture.prefix}-seller-profile-link" href="${commerceMarketplaceFixture.sellerPath}">${commerceMarketplaceFixture.platform} seller profile</a>
                <a id="${commerceMarketplaceFixture.prefix}-brand-store-link" href="${commerceMarketplaceFixture.brandPath}">${commerceMarketplaceFixture.platform} brand store</a>
                <span data-product-url="${commerceMarketplaceFixture.detailPath}">${commerceMarketplaceFixture.platform} SPA product URL</span>
                <span data-seller-url="${commerceMarketplaceFixture.sellerPath}">${commerceMarketplaceFixture.platform} SPA seller URL</span>
              </nav>
            </article>
          </section>
          <button id="${commerceMarketplaceFixture.prefix}-more-products">more products</button>
          <button id="${commerceMarketplaceFixture.prefix}-seller-terms-button">seller and shipping terms</button>
          <section id="${commerceMarketplaceFixture.prefix}-seller-terms">Select seller terms to inspect return policy.</section>
          <section id="${commerceMarketplaceFixture.prefix}-shipping-panel">Shipping panel idle.</section>
          <button id="${commerceMarketplaceFixture.prefix}-cart-button">Add to cart - unsupported fixture button</button>
        </main>
        <script>
          document.querySelector('#${commerceMarketplaceFixture.prefix}-query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#${commerceMarketplaceFixture.prefix}-filter').addEventListener('click', () => {
            document.querySelector('#${commerceMarketplaceFixture.prefix}-filter-state').textContent = 'filter: shipping visible';
          });
          document.querySelector('#${commerceMarketplaceFixture.prefix}-sort').addEventListener('change', (event) => {
            document.querySelector('#sort-state').textContent = 'sort: ' + event.target.value;
          });
          document.querySelector('#${commerceMarketplaceFixture.prefix}-more-products').addEventListener('click', () => {
            const extra = document.createElement('article');
            extra.textContent = '${commerceMarketplaceFixture.platform} extra product - visible price - seller and shipping context';
            document.querySelector('#${commerceMarketplaceFixture.prefix}-product-list').appendChild(extra);
          });
          document.querySelector('#${commerceMarketplaceFixture.prefix}-seller-terms-button').addEventListener('click', () => {
            document.querySelector('#${commerceMarketplaceFixture.prefix}-seller-terms').textContent = 'seller: ${commerceMarketplaceFixture.platform} DirectStore. return window 30 days. coupon and warranty text visible. No cart or checkout action submitted.';
            document.querySelector('#${commerceMarketplaceFixture.prefix}-shipping-panel').textContent = 'shipping: ${commerceMarketplaceFixture.shippingText}. fees included in visible card.';
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/wikipedia-knowledge") {
      response.end(`<!doctype html><html><head><title>Wikipedia knowledge fixture</title></head><body>
        <main id="content">
          <h1 id="firstHeading">Tokyo knowledge fixture</h1>
          <section id="mw-content-text">
            <article class="mw-parser-output">
              <table class="infobox"><tbody><tr><th>Population</th><td>Visible record field</td></tr></tbody></table>
              <p>Wikipedia knowledge article body with title, citation, references, and update context visible.</p>
              <p>Record field: article body evidence with citation chain preserved.</p>
              <ol class="references">
                <li><a href="https://source.example/wiki-citation">Wikipedia citation source</a></li>
                <li><a href="/wiki/Related_record">Related internal record</a></li>
              </ol>
            </article>
          </section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/namuwiki-knowledge") {
      response.end(`<!doctype html><html><head><title>Namuwiki knowledge fixture</title></head><body>
        <main id="app">
          <article>
            <h1 class="wiki-heading-content">성수동 knowledge fixture</h1>
            <p class="wiki-paragraph">Namuwiki article body evidence with 출처, 인용, table, and visible revision context.</p>
            <table class="wiki-table"><tbody><tr><th>장소</th><td>성수동</td></tr></tbody></table>
            <p><a class="wiki-link" href="https://source.example/namuwiki-source">Namuwiki external source</a></p>
            <p><a class="wiki-link" href="/namuwiki-related">Namuwiki related record</a></p>
          </article>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/pubmed-knowledge") {
      response.end(`<!doctype html><html><head><title>PubMed knowledge fixture</title></head><body>
        <main id="search-results">
          <article class="full-docsum">
            <div class="docsum-content">
              <a class="docsum-title" href="/pubmed-record">PubMed result detail</a>
              <p>PubMed abstract evidence with citation metadata and record fields.</p>
            </div>
            <section id="article-details">
              <p class="abstract">PubMed abstract evidence. Methods and results are visible.</p>
              <p class="cit">Journal citation metadata. PMID visible. DOI visible.</p>
              <a href="https://doi.org/10.1234/example">DOI destination</a>
              <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC123/">PubMed Central full text</a>
            </section>
          </article>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/data-go-kr-knowledge") {
      response.end(`<!doctype html><html><head><title>data.go.kr knowledge fixture</title></head><body>
        <main id="contents">
          <section class="result-list data-list dataset-list list-data">
            <article>
              <h2>data.go.kr dataset result list</h2>
              <p>Dataset metadata, 제공기관, update date, download metadata, and license fields are visible.</p>
              <a href="/tcs/dss/selectDataSetDetail.do">Dataset detail record</a>
              <a href="/tcs/dss/selectDataSetList.do">Dataset list context</a>
            </article>
          </section>
          <section class="detail-info">data.go.kr detail-info with schema, columns, and restricted-download warning visible.</section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/kosis-knowledge") {
      response.end(`<!doctype html><html><head><title>KOSIS knowledge fixture</title></head><body>
        <main id="contents">
          <section id="content" class="search-result">
            <article class="tbl-list table">
              <h2>KOSIS statistic table metadata</h2>
              <p>KOSIS statistic table metadata with period, region, unit, source agency, and update date visible.</p>
              <a href="/statisticsList/statisticsListIndex.do">KOSIS statistics list</a>
              <a href="/statHtml/statHtml.do">KOSIS statistic table</a>
            </article>
          </section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/riss-knowledge") {
      response.end(`<!doctype html><html><head><title>RISS knowledge fixture</title></head><body>
        <main id="divContent">
          <section class="srchResultListW">
            <article class="cont recordDetail">
              <h2>RISS academic record metadata</h2>
              <p class="metadata">RISS academic record metadata with author, year, institution, abstract, and citation context visible.</p>
              <a href="/search/detail/DetailView.do">RISS record detail</a>
              <a href="/search/Search.do?queryText=ai">RISS related search</a>
            </article>
          </section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/kipris-knowledge") {
      response.end(`<!doctype html><html><head><title>KIPRIS knowledge fixture</title></head><body>
        <main id="content">
          <section class="search-result result-list">
            <article class="patentView detail">
              <h2>KIPRIS patent detail metadata</h2>
              <p>KIPRIS patent detail metadata with applicant, filing date, publication number, abstract, and claims visible.</p>
              <a href="/khome/search/patentDetail.do">KIPRIS patent detail</a>
              <a href="/khome/search/search.do?queryText=robot">KIPRIS related search</a>
            </article>
          </section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/navigation") {
      response.end(`<!doctype html><html><head><title>navigation fixture</title></head><body>
        <main style="min-height: 2400px">
          <h1>navigation fixture</h1>
          <label>Search <input id="query" aria-label="query"></label>
          <button id="filter">filter</button>
          <select id="sort" aria-label="sort">
            <option value="relevance">relevance</option>
            <option value="date">date</option>
          </select>
          <button id="details">details</button>
          <a class="followup-candidate" href="#">self hash placeholder</a>
          <a id="destination-link" class="followup-candidate" href="/destination">destination page</a>
          <section id="destination-candidates">
            <a href="/privacy">Privacy policy</a>
            <a href="/official?query=ramen">Official ramen guide</a>
            <a href="/blog/ramen">Ramen blog review</a>
            <a href="/official?query=ramen#duplicate">Official ramen guide duplicate</a>
          </section>
          <section id="destination-candidates-crowded">
            <a href="/privacy">Privacy policy</a>
            <a href="/official?query=ramen">Official ramen guide</a>
            <a href="/official?query=ramen#duplicate">Official ramen guide duplicate</a>
            <a href="/blog/ramen">Ramen blog review</a>
            <a href="/community/ramen">Ramen community thread</a>
          </section>
          <section id="destination-candidates-attributes">
            <div data-url="/place/alpha">Cafe Alpha place card</div>
            <button data-target-url="/official?query=spa">Official SPA card</button>
            <div data-href="/navigation#self">Self hash SPA card</div>
            <div data-source-url="/blog/ramen">Ramen blog attribute</div>
          </section>
          <p id="query-state">query:</p>
          <p id="filter-state">filter: inactive</p>
          <p id="sort-state">sort: relevance</p>
          <section style="margin-top: 1800px">bottom marker</section>
        </main>
        <script>
          document.querySelector('#query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#filter').addEventListener('click', () => {
            document.querySelector('#filter-state').textContent = 'filter: active';
          });
          document.querySelector('#sort').addEventListener('change', (event) => {
            document.querySelector('#sort-state').textContent = 'sort: ' + event.target.value;
          });
          document.querySelector('#details').addEventListener('click', () => {
            const detail = document.createElement('p');
            detail.id = 'details-open';
            detail.textContent = 'details open';
            document.body.appendChild(detail);
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/destination") {
      response.end(`<!doctype html><html><head><title>destination fixture</title></head><body>
        <main>
          <h1>destination fixture</h1>
          <p>follow-up evidence content</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/official") {
      response.end(`<!doctype html><html><head><title>official destination fixture</title></head><body>
        <main>
          <h1>official destination fixture</h1>
          <p>official ramen evidence</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/blog/ramen") {
      response.end(`<!doctype html><html><head><title>blog destination fixture</title></head><body>
        <main>
          <h1>blog destination fixture</h1>
          <p>ramen blog evidence</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/place/alpha") {
      response.end(`<!doctype html><html><head><title>place destination fixture</title></head><body>
        <main>
          <h1>Cafe Alpha place fixture</h1>
          <p>address, hours, review snippet</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/privacy") {
      response.end(`<!doctype html><html><head><title>privacy fixture</title></head><body>
        <main>
          <h1>privacy policy</h1>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/map") {
      response.end(`<!doctype html><html><head><title>map fixture</title></head><body>
        <main id="root">
          <h1>map fixture</h1>
          <label>Map query <input id="map-query" aria-label="map query"></label>
          <p id="query-state">query:</p>
          <section id="map-viewport" style="width:420px;height:220px;border:1px solid #333">
            visible pins: Cafe Alpha, Cafe Beta
          </section>
          <button id="place-alpha">Cafe Alpha</button>
          <section id="map-destination-links">
            <div data-place-url="https://place.naver.com/restaurant/12345">Cafe Alpha Naver Place restaurant page</div>
            <div data-url="https://place.naver.com/hospital/45678">Clinic Beta Naver Place hospital page</div>
            <a href="https://place.naver.com/accommodation/98765">Stay Gamma Naver Place accommodation page</a>
            <a href="https://map.naver.com/p/entry/place/12345">Cafe Alpha Naver Map entry page</a>
          </section>
          <aside id="place-panel">No place selected</aside>
        </main>
        <script>
          window.__APOLLO_STATE__ = {
            'PlaceSummary:12345': {
              id: '12345',
              name: 'Cafe Alpha',
              category: 'cafe',
              roadAddress: '1 Alpha Road',
              x: '127.1',
              y: '37.5',
              reviewCount: '42'
            },
            'PlaceSummary:67890': {
              id: '67890',
              name: 'Cafe Beta',
              businessCategory: 'cafe',
              roadAddress: '2 Beta Road',
              x: '127.2',
              y: '37.6',
              visitorReviewCount: '10'
            },
            'VisitorImages:not-a-place': {
              id: 'review-image-1',
              name: 'Not a place record'
            }
          };
          document.querySelector('#map-query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#place-alpha').addEventListener('click', () => {
            document.querySelector('#place-panel').textContent = 'Cafe Alpha place panel - review snippet - open now';
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/map-client-state-frame") {
      response.end(`<!doctype html><html><head><title>map iframe fixture</title></head><body>
        <main id="root">
          <h1>map iframe fixture</h1>
          <iframe src="/map-client-state-frame-inner" title="map results" style="width:640px;height:360px;border:0"></iframe>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/map-client-state-frame-inner") {
      response.end(`<!doctype html><html><head><title>map iframe inner fixture</title></head><body>
        <main id="app-root">
          <h1>iframe map results</h1>
          <section>visible pins: Cafe Alpha, Cafe Beta</section>
        </main>
        <script>
          window.__APOLLO_STATE__ = {
            'PlaceSummary:12345': {
              id: '12345',
              name: 'Cafe Alpha',
              category: 'cafe',
              roadAddress: '1 Alpha Road',
              x: '127.1',
              y: '37.5',
              reviewCount: '42'
            },
            'PlaceSummary:67890': {
              id: '67890',
              name: 'Cafe Beta',
              businessCategory: 'cafe',
              roadAddress: '2 Beta Road',
              x: '127.2',
              y: '37.6',
              visitorReviewCount: '10'
            }
          };
        </script>
      </body></html>`);
      return;
    }
    if (path === "/travel") {
      response.end(`<!doctype html><html><head><title>travel fixture</title></head><body>
        <main>
          <h1>travel fixture</h1>
          <label>Destination <input id="destination" aria-label="destination"></label>
          <p id="query-state">destination:</p>
          <button id="breakfast-filter">breakfast</button>
          <p id="filter-state">filter: none</p>
          <select id="sort" aria-label="sort">
            <option value="recommended">recommended</option>
            <option value="price">price</option>
          </select>
          <p id="sort-state">sort: recommended</p>
          <article id="price-card">
            <h2>Seoul Central Hotel</h2>
            <p>KRW 120,000</p>
            <p>Breakfast badge visible</p>
          </article>
          <button id="offer-detail">rate details</button>
          <section id="rate-panel">Select a rate to view policy.</section>
        </main>
        <script>
          document.querySelector('#destination').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'destination: ' + event.target.value;
          });
          document.querySelector('#breakfast-filter').addEventListener('click', () => {
            document.querySelector('#filter-state').textContent = 'filter: breakfast included';
          });
          document.querySelector('#sort').addEventListener('change', (event) => {
            document.querySelector('#sort-state').textContent = 'sort: ' + event.target.value;
          });
          document.querySelector('#offer-detail').addEventListener('click', () => {
            document.querySelector('#rate-panel').textContent = 'Free cancellation until May 30. Taxes included. No payment submitted.';
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/search") {
      response.end(`<!doctype html><html><head><title>search fixture</title></head><body>
        <main>
          <h1>search fixture</h1>
          <label>Query <input id="q" aria-label="query"></label>
          <p id="query-state">query:</p>
          <nav>
            <button id="tab-web">web</button>
            <button id="tab-blog">blog</button>
          </nav>
          <p id="active-vertical">vertical: web</p>
          <button id="recent-filter">recent filter</button>
          <p id="filter-state">filter: none</p>
          <select id="search-sort" aria-label="sort">
            <option value="relevance">relevance</option>
            <option value="date">date</option>
          </select>
          <p id="sort-state">sort: relevance</p>
          <p id="page-state">page: 1</p>
          <section id="results">web vertical result list - Page 1 result</section>
          <button id="next-page">next</button>
          <button id="result-two">select result</button>
          <p id="selection-state">selected:</p>
        </main>
        <script>
          document.querySelector('#q').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#tab-blog').addEventListener('click', () => {
            document.querySelector('#active-vertical').textContent = 'vertical: blog';
            document.querySelector('#results').textContent = 'blog vertical result list - Page 1 result';
          });
          document.querySelector('#recent-filter').addEventListener('click', () => {
            document.querySelector('#filter-state').textContent = 'filter: recent';
          });
          document.querySelector('#search-sort').addEventListener('change', (event) => {
            document.querySelector('#sort-state').textContent = 'sort: ' + event.target.value;
          });
          document.querySelector('#next-page').addEventListener('click', () => {
            document.querySelector('#page-state').textContent = 'page: 2';
            document.querySelector('#results').textContent = 'blog vertical result list - Page 2 result';
          });
          document.querySelector('#result-two').addEventListener('click', () => {
            document.querySelector('#selection-state').textContent = 'selected: Page 2 result';
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/naver-integrated-search") {
      response.end(`<!doctype html><html><head><title>naver integrated search fixture</title></head><body>
        <main id="naver-integrated-main">
          <h1>Naver integrated search modules ready</h1>
          <label>Query <input id="naver-integrated-query" name="query" aria-label="Naver query"></label>
          <p id="query-state">query:</p>
          <nav id="naver-vertical-tabs">
            <button id="naver-tab-view">view</button>
            <button id="naver-tab-news">news</button>
            <button id="naver-tab-image">image</button>
            <button id="naver-tab-video">video</button>
            <button id="naver-tab-place">place</button>
            <button id="naver-tab-shopping">shopping</button>
          </nav>
          <p id="active-vertical">vertical: all</p>
          <button id="naver-integrated-filter">recent filter</button>
          <p id="naver-integrated-filter-state">filter: all</p>
          <select id="naver-integrated-sort" aria-label="Naver integrated sort">
            <option value="relevance">relevance</option>
            <option value="date">date</option>
          </select>
          <p id="naver-integrated-sort-state">sort: relevance</p>
          <p id="page-state">page: 1</p>
          <section id="main_pack">
            <section id="naver-view-module" class="api_subject_bx view_wrap">
              <h2>View module</h2>
              <article class="total_wrap">
                <a id="naver-view-link" class="api_txt_lines" href="/naver-blog-destination">Naver Blog result about Seongsu cafe</a>
                <p>visible blog snippet and author timestamp</p>
              </article>
              <article class="total_wrap">
                <a id="naver-cafe-link" class="api_txt_lines" href="/naver-cafe-destination">Naver Cafe result with local visitor comments</a>
                <p>visible cafe snippet and reply count</p>
              </article>
            </section>
            <section id="naver-news-module" class="api_subject_bx news_wrap">
              <h2>News module</h2>
              <a id="naver-news-link" class="news_tit" href="/naver-news-destination">Naver News publisher article</a>
              <p>visible news snippet and publisher metadata</p>
            </section>
            <section id="naver-place-module" class="api_subject_bx place_section" data-place-url="/naver-place-destination">
              <h2>Place module</h2>
              <a id="naver-place-link" href="/naver-place-destination">Naver Place cafe detail</a>
              <p>rating 4.6, business hours, visitor reviews</p>
            </section>
            <section id="naver-image-module" class="api_subject_bx image_wrap">
              <h2>Image module</h2>
              <a id="naver-image-link" href="/naver-image-destination"><img alt="Seongsu cafe interior">Naver Image result</a>
            </section>
            <section id="naver-video-module" class="api_subject_bx video_wrap">
              <h2>Video module</h2>
              <a id="naver-video-link" href="/naver-video-destination">Naver Video result with thumbnail overlay</a>
            </section>
            <section id="naver-shopping-module" class="api_subject_bx shopping_wrap sp_nshop" data-product-url="/naver-shopping-destination">
              <h2>Shopping module</h2>
              <a id="naver-shopping-link" href="/naver-shopping-destination">Naver Shopping product card KRW 12,000</a>
            </section>
            <nav id="naver-integrated-destination-links">
              <a href="/naver-blog-destination">Blog destination</a>
              <a href="/naver-cafe-destination">Cafe destination</a>
              <a href="/naver-news-destination">News destination</a>
              <a href="/naver-place-destination">Place destination</a>
              <a href="/naver-image-destination">Image destination</a>
              <a href="/naver-video-destination">Video destination</a>
              <a href="/naver-shopping-destination">Shopping destination</a>
              <span data-place-url="/naver-place-destination">SPA place attribute destination</span>
              <span data-product-url="/naver-shopping-destination">SPA shopping attribute destination</span>
            </nav>
          </section>
          <button id="naver-integrated-more">more integrated results</button>
        </main>
        <script>
          document.querySelector('#naver-integrated-query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          for (const id of ['view', 'news', 'image', 'video', 'place', 'shopping']) {
            document.querySelector('#naver-tab-' + id).addEventListener('click', () => {
              document.querySelector('#active-vertical').textContent = 'vertical: ' + id;
            });
          }
          document.querySelector('#naver-integrated-filter').addEventListener('click', () => {
            document.querySelector('#naver-integrated-filter-state').textContent = 'filter: recent';
          });
          document.querySelector('#naver-integrated-sort').addEventListener('change', (event) => {
            document.querySelector('#naver-integrated-sort-state').textContent = 'sort: ' + event.target.value;
          });
          document.querySelector('#naver-integrated-more').addEventListener('click', () => {
            document.querySelector('#page-state').textContent = 'page: 2';
            const extra = document.createElement('article');
            extra.id = 'naver-extra-result';
            extra.className = 'total_wrap';
            extra.textContent = 'extra integrated result on page 2';
            document.querySelector('#main_pack').appendChild(extra);
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/daum-search") {
      response.end(`<!doctype html><html><head><title>daum search fixture</title></head><body>
        <main id="cMain">
          <h1>daum search fixture</h1>
          <label>Query <input id="daum-query" name="q" aria-label="Daum query"></label>
          <p id="query-state">query:</p>
          <nav class="list_tab">
            <button id="daum-tab-all">all</button>
            <button id="daum-tab-cafe">cafe</button>
          </nav>
          <p id="active-vertical">vertical: all</p>
          <button id="daum-filter" class="btn_filter">recent period</button>
          <section id="daum-filter-state">period: all</section>
          <section id="mArticle">
            <section id="daum-results">
              <article id="daum-result-card">
                <h2>Daum result card - Seongsu cafe</h2>
                <p>visible search snippet with ad disclosure and publisher context</p>
                <a id="daum-result-link" href="/daum-search-destination">Daum destination page</a>
              </article>
            </section>
          </section>
          <button id="daum-next-page">next page</button>
          <p id="page-state">page: 1</p>
        </main>
        <script>
          document.querySelector('#daum-query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#daum-tab-cafe').addEventListener('click', () => {
            document.querySelector('#active-vertical').textContent = 'vertical: cafe';
          });
          document.querySelector('#daum-filter').addEventListener('click', () => {
            document.querySelector('#daum-filter-state').textContent = 'period: recent';
          });
          document.querySelector('#daum-next-page').addEventListener('click', () => {
            document.querySelector('#page-state').textContent = 'page: 2';
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/daum-search-destination") {
      response.end(`<!doctype html><html><head><title>daum search destination fixture</title></head><body>
        <main>
          <h1>Daum search destination</h1>
          <p>Destination content for Daum-like search follow-up.</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/blog") {
      response.end(`<!doctype html><html><head><title>blog fixture</title></head><body>
        <main>
          <article id="article">
            <h1>public blog article</h1>
            <p>Visible article body and author timestamp.</p>
            <nav id="blog-destination-links">
              <a id="article-source-link" href="/blog-source">Source page</a>
              <a id="related-post-link" href="/related-blog-post">Related post</a>
              <a id="official-link" href="/official-blog-source">Official source</a>
            </nav>
          </article>
          <button id="open-gallery">open gallery</button>
          <section id="gallery" hidden>
            <figure><img src="/missing-one.png" alt="one"><figcaption>Image caption one</figcaption></figure>
            <figure><img src="/missing-two.png" alt="two"><figcaption>Image caption two</figcaption></figure>
          </section>
        </main>
        <script>
          document.querySelector('#open-gallery').addEventListener('click', () => {
            document.querySelector('#gallery').hidden = false;
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/google-search") {
      response.end(`<!doctype html><html><head><title>google-like search fixture</title></head><body>
        <main>
          <h1>google-like search fixture</h1>
          <label>Query <input id="google-query" aria-label="query"></label>
          <p id="query-state">query:</p>
          <nav>
            <button id="tab-all">All</button>
            <button id="tab-images">Images</button>
          </nav>
          <p id="vertical-state">vertical: all</p>
          <section id="serp-module">SERP module: web results and image strip</section>
          <button id="tools">tools</button>
          <section id="filter-panel" hidden>filters hidden</section>
          <select id="google-sort" aria-label="sort">
            <option value="relevance">relevance</option>
            <option value="recent">recent</option>
          </select>
          <p id="sort-state">sort: relevance</p>
          <p id="page-state">page: 1</p>
          <section id="results">
            <article id="result-card">
              <h2>Tokyo Station Hotel</h2>
              <p>Visible snippet and price badge</p>
              <a id="result-link" href="/google-destination">Tokyo Station Hotel official site</a>
            </article>
          </section>
          <button id="more-results">more results</button>
          <button id="open-result">open result card</button>
          <p id="selection-state">selected:</p>
          <section id="gallery" hidden>
            <figure><figcaption>Gallery image one</figcaption></figure>
            <figure><figcaption>Gallery image two</figcaption></figure>
          </section>
        </main>
        <script>
          document.querySelector('#google-query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#tab-images').addEventListener('click', () => {
            document.querySelector('#vertical-state').textContent = 'vertical: images';
            document.querySelector('#serp-module').textContent = 'SERP module: images vertical with image strip';
          });
          document.querySelector('#tools').addEventListener('click', () => {
            document.querySelector('#filter-panel').hidden = false;
            document.querySelector('#filter-panel').textContent = 'date and rating filters visible';
          });
          document.querySelector('#google-sort').addEventListener('change', (event) => {
            document.querySelector('#sort-state').textContent = 'sort: ' + event.target.value;
          });
          document.querySelector('#more-results').addEventListener('click', () => {
            document.querySelector('#page-state').textContent = 'more results loaded';
            const extra = document.createElement('article');
            extra.textContent = 'Expanded result card with map pack and review stars';
            document.querySelector('#results').appendChild(extra);
          });
          document.querySelector('#open-result').addEventListener('click', () => {
            document.querySelector('#selection-state').textContent = 'selected: Tokyo Station Hotel';
            document.querySelector('#gallery').hidden = false;
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/google-destination") {
      response.end(`<!doctype html><html><head><title>google destination fixture</title></head><body>
        <main>
          <h1>Tokyo Station Hotel destination</h1>
          <p>Destination evidence content for Google-like follow-up.</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/naver-news" || path === "/daum-news" || path === "/yahoo-news" || path === "/reuters-news") {
      const isNaver = path === "/naver-news";
      const isYahoo = path === "/yahoo-news";
      const isReuters = path === "/reuters-news";
      const platform = isNaver ? "Naver" : isYahoo ? "Yahoo News" : isReuters ? "Reuters" : "Daum";
      const queryId = isNaver ? "naver-news-query" : isYahoo ? "yahoo-news-query" : isReuters ? "reuters-query" : "daum-news-query";
      const sectionId = isNaver ? "naver-news-section" : isYahoo ? "yahoo-news-section" : isReuters ? "reuters-section" : "daum-news-section";
      const filterId = isNaver ? "naver-news-recent" : isYahoo ? "yahoo-news-recent" : isReuters ? "reuters-recent" : "daum-news-recent";
      const moreId = isNaver ? "naver-news-more" : isYahoo ? "yahoo-news-more" : isReuters ? "reuters-more" : "daum-news-more";
      const destination = isNaver ? "/naver-news-destination" : isYahoo ? "/yahoo-news-destination" : isReuters ? "/reuters-news-destination" : "/daum-news-destination";
      const mainId = isYahoo ? "Main" : isReuters ? "fusion-app" : "news-main";
      const moduleAttributes = isYahoo ? 'id="news-module" data-test-locator="stream" class="news-stream"' : 'id="news-module"';
      const cardAttributes = isYahoo ? 'id="headline-card" data-test-locator="stream-item"' : isReuters ? 'id="headline-card" data-testid="MediaStoryCard"' : 'id="headline-card"';
      response.end(`<!doctype html><html><head><title>${platform} news fixture</title></head><body>
        <main id="${mainId}">
          <h1>${platform} news module fixture</h1>
          <label>News query <input id="${queryId}" aria-label="${platform} news query"></label>
          <p id="query-state">query:</p>
          <button id="${sectionId}">Society section</button>
          <p id="news-section-state">section: main</p>
          <button id="${filterId}">Latest first</button>
          <p id="news-filter-state">sort: relevance</p>
          <section ${moduleAttributes}>
            ${isReuters ? '<div id="reuters-news-module">' : ""}
            <article ${cardAttributes}>
              <h2 data-testid="${isReuters ? "Heading" : "Headline"}">${platform} headline card - AI policy update</h2>
              <p data-testid="${isReuters ? "Body" : "Snippet"}">Visible headline snippet with thumbnail marker and ranking badge.</p>
              <a id="news-link" href="${destination}">${platform} publisher article</a>
            </article>
            <p id="publisher-meta">publisher: ${platform} Daily. published: 2026-05-27 09:00. section: technology.</p>
            ${isReuters ? "</div>" : ""}
          </section>
          <button id="${moreId}">More news</button>
          <section id="news-obstruction-state">paywall: none. login: not required. comment write not attempted.</section>
        </main>
        <script>
          document.querySelector('#${queryId}').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#${sectionId}').addEventListener('click', () => {
            document.querySelector('#news-section-state').textContent = 'section: society';
          });
          document.querySelector('#${filterId}').addEventListener('click', () => {
            document.querySelector('#news-filter-state').textContent = 'sort: latest';
          });
          document.querySelector('#${moreId}').addEventListener('click', () => {
            const extra = document.createElement('article');
            extra.textContent = 'Second page headline - ${platform} follow-up story - publisher timestamp visible';
            document.querySelector('#news-module').appendChild(extra);
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/naver-news-destination" || path === "/daum-news-destination" || path === "/yahoo-news-destination" || path === "/reuters-news-destination") {
      const platform = path === "/naver-news-destination" ? "Naver" : path === "/yahoo-news-destination" ? "Yahoo News" : path === "/reuters-news-destination" ? "Reuters" : "Daum";
      response.end(`<!doctype html><html><head><title>${platform} publisher article fixture</title></head><body>
        <main>
          <article>
            <h1>${platform} publisher article destination</h1>
            <p>Destination article body for separate evidence capture.</p>
            <p>Publisher timestamp and author context visible.</p>
          </article>
        </main>
      </body></html>`);
      return;
    }
    if (["/dcinside-community", "/naver-kin-community", "/reddit-community", "/quora-community", "/stack-overflow-community"].includes(path)) {
      const communityFixture = communityFixtureForPath(path);
      const { platform, queryId, destination, titleText } = communityFixture;
      response.end(`<!doctype html><html><head><title>${platform} community fixture</title></head><body>
        <main>
          <h1>${platform} community fixture</h1>
          <label>Community query <input id="${queryId}" aria-label="${platform} query"></label>
          <p id="query-state">query:</p>
          <button id="community-section">Community section</button>
          <p id="community-section-state">section: all</p>
          <button id="community-recent">Latest first</button>
          <p id="community-filter-state">sort: relevance</p>
          <section id="community-module">
            <article id="thread-card">
              <h2>${titleText}</h2>
              <p>Visible thread snippet with reply count, rank marker, and question summary.</p>
              <a id="community-link" href="${destination}">${platform} thread destination</a>
            </article>
            <p id="community-meta">author: public-user. published: 2026-05-27 10:20. replies: 8.</p>
          </section>
          <button id="community-more">More community results</button>
          <section id="community-obstruction-state">access: public. login: not required. no bypass attempted.</section>
        </main>
        <script>
          document.querySelector('#${queryId}').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#community-section').addEventListener('click', () => {
            document.querySelector('#community-section-state').textContent = 'section: community';
          });
          document.querySelector('#community-recent').addEventListener('click', () => {
            document.querySelector('#community-filter-state').textContent = 'sort: latest';
          });
          document.querySelector('#community-more').addEventListener('click', () => {
            const extra = document.createElement('article');
            extra.textContent = 'Second page community result - visible author and reply metadata';
            document.querySelector('#community-module').appendChild(extra);
          });
        </script>
      </body></html>`);
      return;
    }
    if (["/dcinside-thread", "/naver-kin-answer", "/reddit-thread", "/quora-answer", "/stack-overflow-answer"].includes(path)) {
      const platform = destinationPlatformForPath(path);
      response.end(`<!doctype html><html><head><title>${platform} destination fixture</title></head><body>
        <main id="community-destination">
          <article>
            <h1>${platform} destination thread</h1>
            <p id="destination-meta">platform: ${platform}. author: destination-user. published: 2026-05-27 12:40. access: public.</p>
            <section id="question-body">
              <h2>${platform} destination question</h2>
              <p>Question body states the travel planning problem and visible source context.</p>
            </section>
            <section id="thread-body">
              <p>Destination community body for separate evidence capture.</p>
              <p>Thread body preserves browser-visible post text without posting, joining, or bypassing gates.</p>
            </section>
            <section id="answer-body">
              <h2>Answer body</h2>
              <p>Answer body includes a cited itinerary suggestion and author timestamp context.</p>
            </section>
            <section id="accepted-answer">
              <p>Accepted or top answer marker visible when the platform exposes one.</p>
            </section>
            <section id="comment-list">
              <article>Comment one: public reply context and vote marker visible.</article>
              <article>Comment two: dissenting public reply context visible.</article>
            </section>
          </article>
          <section id="destination-obstruction-state">access: public. login: not required. no bypass attempted. write actions disabled.</section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/yelp-review" || path === "/tripadvisor-review") {
      const isYelp = path === "/yelp-review";
      const platform = isYelp ? "Yelp" : "TripAdvisor";
      const destination = isYelp ? "/yelp-business" : "/tripadvisor-listing";
      const menuPath = isYelp ? "/yelp-menu" : "/tripadvisor-menu";
      const reviewPath = isYelp ? "/yelp-reviews" : "/tripadvisor-reviews";
      response.end(`<!doctype html><html><head><title>${platform} review fixture</title></head><body>
        <main id="review-main">
          <h1>${platform} review local fixture</h1>
          <label>Review query <input id="review-query" aria-label="${platform} search query"></label>
          <label>Review location <input id="review-location" aria-label="${platform} location" value="Tokyo"></label>
          <p id="query-state">query:</p>
          <button id="review-category">Restaurants category</button>
          <p id="review-section-state">category: all</p>
          <button id="review-filter">Rating 4+ filter</button>
          <p id="review-filter-state">filter: all ratings</p>
          <section id="review-module">
            <article id="review-card">
              <h2>${platform} listing card - Cafe Aurora</h2>
              <p>Visible review snippet with rating 4.6, open now, price marker, address, and current ranking badge.</p>
              <nav id="review-destination-links">
                <a id="review-listing-link" href="${destination}">${platform} listing destination</a>
                <a id="review-menu-link" href="${menuPath}">${platform} menu destination</a>
                <a id="review-external-link" href="/${isYelp ? "yelp" : "tripadvisor"}-official">Official website destination</a>
                <a id="review-user-link" href="${reviewPath}">${platform} user reviews</a>
              </nav>
            </article>
            <p id="review-meta">rating: 4.6. review count: 128. hours: open now. address: 12 Review Street. sort: relevance.</p>
          </section>
          <button id="review-more">More review results</button>
          <section id="review-obstruction-state">human check: none. cookies: visible if present. login: not required. app-open: not clicked. no bypass attempted.</section>
        </main>
        <script>
          document.querySelector('#review-query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#review-category').addEventListener('click', () => {
            document.querySelector('#review-section-state').textContent = 'category: restaurants';
          });
          document.querySelector('#review-filter').addEventListener('click', () => {
            document.querySelector('#review-filter-state').textContent = 'filter: rating 4+';
          });
          document.querySelector('#review-more').addEventListener('click', () => {
            const extra = document.createElement('article');
            extra.textContent = 'Second page review result - visible review snippet and rating badge';
            document.querySelector('#review-module').appendChild(extra);
          });
        </script>
      </body></html>`);
      return;
    }
    if (["/yelp-business", "/yelp-menu", "/yelp-reviews", "/yelp-official", "/tripadvisor-listing", "/tripadvisor-menu", "/tripadvisor-reviews", "/tripadvisor-official"].includes(path)) {
      const platform = path.startsWith("/yelp") ? "Yelp" : "TripAdvisor";
      response.end(`<!doctype html><html><head><title>${platform} review destination fixture</title></head><body>
        <main>
          <article>
            <h1>${platform} bounded review destination</h1>
            <p>Destination listing evidence with address, hours, rating, review count, menu context, and public review snippets.</p>
            <p>No login, reservation, app-open, or payment action was attempted.</p>
          </article>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/google-modules") {
      response.end(`<!doctype html><html><head><title>google module fixture</title></head><body>
        <main id="google-rich-main">
          <h1>google module fixture</h1>
          <label>Query <input id="module-query" aria-label="query"></label>
          <p id="query-state">query:</p>
          <nav>
            <button id="google-tab-news">News</button>
            <button id="google-tab-images">Images</button>
            <button id="google-tab-videos">Videos</button>
            <button id="google-tab-maps">Maps</button>
          </nav>
          <p id="vertical-state">vertical: all</p>
          <p id="module-state">modules ready</p>
          <button id="show-ads">show sponsored module</button>
          <section id="ad-module" hidden>
            <h2>Sponsored stay card</h2>
            <p>Sponsored label, visible price teaser, and ad disclosure.</p>
          </section>
          <section id="google-local-module">
            <h2>Local module</h2>
            <section id="map-pack">
              <h3>Map pack</h3>
              <p>Local cafe result - rating 4.6 - open now - map pin visible.</p>
              <a id="google-local-link" href="/google-local-destination">Google local place destination</a>
            </section>
          </section>
          <section id="google-news-module">
            <h2>News cluster</h2>
            <section id="news-cluster">
              <article>Fresh article result with publisher and timestamp.</article>
              <a id="google-news-link" href="/google-news-destination">Google News module destination</a>
            </section>
          </section>
          <section id="google-image-module" data-media-url="/google-image-destination">
            <h2>Image module</h2>
            <a id="google-image-link" href="/google-image-destination"><img alt="Google image result thumbnail">Google image result</a>
          </section>
          <section id="google-video-module" data-media-url="/google-video-destination">
            <h2>Video module</h2>
            <a id="google-video-link" href="/google-video-destination">Google video result with thumbnail overlay</a>
          </section>
          <section id="google-travel-module" data-travel-url="/google-travel-search-destination">
            <h2>Travel hotel module</h2>
            <article id="google-hotel-offer-card" data-hotel-url="/google-hotel-destination" data-offer-url="/google-hotel-offer-destination">
              <h3>Tokyo hotel offer card</h3>
              <p>Visible nightly price, rating 4.5, availability, and Free cancellation policy.</p>
              <a id="google-travel-link" href="/google-travel-destination">Google Travel hotel destination</a>
            </article>
          </section>
          <nav id="google-destination-links">
            <a id="google-organic-link" href="/google-organic-destination">Organic result destination</a>
            <a href="/google-news-destination">News destination</a>
            <a href="/google-local-destination">Local destination</a>
            <a href="/google-image-destination">Image destination</a>
            <a href="/google-video-destination">Video destination</a>
            <a id="google-travel-link-nav" href="/google-travel-destination">Travel hotel destination</a>
            <span data-target-url="/google-video-destination">SPA video attribute destination</span>
            <span data-media-url="/google-image-destination">SPA image attribute destination</span>
            <span data-travel-url="/google-travel-search-destination">SPA travel search attribute destination</span>
            <span data-hotel-url="/google-hotel-destination">SPA hotel attribute destination</span>
            <span data-offer-url="/google-hotel-offer-destination">SPA hotel offer attribute destination</span>
          </nav>
        </main>
        <script>
          document.querySelector('#module-query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          for (const id of ['news', 'images', 'videos', 'maps']) {
            document.querySelector('#google-tab-' + id).addEventListener('click', () => {
              document.querySelector('#vertical-state').textContent = 'vertical: ' + id.replace('images', 'images').replace('videos', 'videos').replace('maps', 'maps');
            });
          }
          document.querySelector('#show-ads').addEventListener('click', () => {
            document.querySelector('#ad-module').hidden = false;
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/google-map-place") {
      response.end(`<!doctype html><html><head><title>google maps selected place fixture</title></head><body>
        <main>
          <h1>google maps selected place fixture</h1>
          <label>Map search <input id="google-map-query" aria-label="Search Google Maps"></label>
          <p id="query-state">query:</p>
          <button id="google-filter-open-now">Open now</button>
          <p id="filter-state">filter: all places</p>
          <section id="google-map-viewport" style="width: 460px; height: 240px; border: 1px solid #333">
            Google Maps pins visible: Cafe Orion, Cafe Lyra
            <span id="google-map-label">Cafe Orion label - 4.7 - near station</span>
          </section>
          <section id="google-place-list" role="feed">
            <button id="google-place-row">Cafe Orion result row - rating 4.7 - open now</button>
            <p>Cafe Lyra result row - rating 4.3 - closes soon</p>
          </section>
          <aside id="google-place-sheet">No Google Maps place selected.</aside>
          <section id="google-review-list" hidden>Review list hidden.</section>
          <section id="google-photo-strip" hidden>Photo strip hidden.</section>
        </main>
        <script>
          document.querySelector('#google-map-query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#google-filter-open-now').addEventListener('click', () => {
            document.querySelector('#filter-state').textContent = 'filter: open now';
          });
          document.querySelector('#google-place-row').addEventListener('click', () => {
            document.querySelector('#google-place-sheet').innerHTML = 'Cafe Orion selected place sheet. Address visible: 12 Station Road. Hours visible: open now. Rating 4.7. route and call buttons are visible but not clicked. <a id="google-place-website-link" href="/google-place-official">Official website</a> <a id="google-place-menu-link" href="/google-place-menu">Menu</a>';
            document.querySelector('#google-review-list').hidden = false;
            document.querySelector('#google-review-list').textContent = 'Cafe Orion review snippet - quiet seats - recent visitor - reviewer context visible.';
            document.querySelector('#google-photo-strip').hidden = false;
            document.querySelector('#google-photo-strip').textContent = 'Cafe Orion photo strip - counter photo - menu photo - exterior photo.';
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/apple-map") {
      response.end(`<!doctype html><html><head><title>apple maps fixture</title></head><body>
        <main id="maps-app">
          <h1>apple maps fixture</h1>
          <label>Map search <input id="apple-map-query" aria-label="Search Maps"></label>
          <p id="query-state">query:</p>
          <button id="apple-filter-open-now">Open now</button>
          <p id="filter-state">filter: all places</p>
          <section id="apple-map-viewport" data-testid="apple-map-canvas" style="width: 460px; height: 240px; border: 1px solid #333">
            Apple Maps pins visible: Cafe Pomme, Cafe Cider
            <span id="apple-map-label">Cafe Pomme label - 4.5 - near station</span>
          </section>
          <section id="apple-place-list" role="feed">
            <button id="apple-place-row">Cafe Pomme result row - rating 4.5 - open now</button>
            <p>Cafe Cider result row - rating 4.2 - closes soon</p>
          </section>
          <aside id="apple-place-card" data-testid="apple-place-card">No Apple Maps place selected.</aside>
          <section id="apple-review-list" hidden>Review list hidden.</section>
        </main>
        <script>
          document.querySelector('#apple-map-query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#apple-filter-open-now').addEventListener('click', () => {
            document.querySelector('#filter-state').textContent = 'filter: open now';
          });
          document.querySelector('#apple-place-row').addEventListener('click', () => {
            document.querySelector('#apple-place-card').innerHTML = 'Cafe Pomme selected place card. Address visible: 24 Orchard Road. Hours visible: open now. Rating 4.5. route and call buttons are visible but not clicked. <a id="apple-place-website-link" href="/apple-place-official">Official website</a> <a id="apple-place-menu-link" href="/apple-place-menu">Menu</a> <a id="apple-place-review-link" href="/apple-place-reviews">Reviews</a>';
            document.querySelector('#apple-review-list').hidden = false;
            document.querySelector('#apple-review-list').textContent = 'Cafe Pomme review snippet - calm tables - recent visitor - reviewer context visible.';
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/naver-cafe") {
      response.end(`<!doctype html><html><head><title>naver cafe fixture</title></head><body>
        <main>
          <article id="cafe-article">
            <h1>public cafe post</h1>
            <p>Visible public body with author nickname and posted time.</p>
            <nav id="blog-destination-links">
              <a id="article-source-link" href="/naver-cafe-source">Cafe source page</a>
              <a id="related-post-link" href="/naver-cafe-related">Related cafe post</a>
            </nav>
          </article>
          <section id="visible-comments">
            <p>Visible comment one with timestamp.</p>
          </section>
          <button id="open-cafe-gallery">open cafe gallery</button>
          <section id="cafe-gallery" hidden>
            <figure><figcaption>Cafe image caption one</figcaption></figure>
            <figure><figcaption>Cafe image caption two</figcaption></figure>
          </section>
          <button id="members-only">members only area</button>
          <section id="member-wall" hidden role="dialog">
            <h2>Members only</h2>
            <p>No bypass attempted. Join or login wall is recorded as obstruction evidence.</p>
          </section>
        </main>
        <script>
          document.querySelector('#open-cafe-gallery').addEventListener('click', () => {
            document.querySelector('#cafe-gallery').hidden = false;
          });
          document.querySelector('#members-only').addEventListener('click', () => {
            document.querySelector('#member-wall').hidden = false;
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/kakao-map") {
      response.end(`<!doctype html><html><head><title>kakao map fixture</title></head><body>
        <main>
          <h1>kakao map fixture</h1>
          <label>Search <input id="kakao-query" aria-label="query"></label>
          <p id="query-state">query:</p>
          <button id="category-filter">cafe category</button>
          <p id="filter-state">category: all</p>
          <section id="kakao-map-viewport" style="width:420px;height:220px;border:1px solid #333">
            visible KakaoMap pins: Cafe Gamma, Cafe Delta
          </section>
          <section id="place-list">
            <button id="place-gamma">Cafe Gamma</button>
            <p>Cafe Delta list row</p>
          </section>
          <aside id="place-detail">No KakaoMap place selected</aside>
          <section id="review-list">No reviews selected</section>
        </main>
        <script>
          document.querySelector('#kakao-query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#category-filter').addEventListener('click', () => {
            document.querySelector('#filter-state').textContent = 'category: cafe';
          });
          document.querySelector('#place-gamma').addEventListener('click', () => {
            document.querySelector('#place-detail').textContent = 'Cafe Gamma place detail - road address visible - open now';
            document.querySelector('#review-list').textContent = 'Cafe Gamma review snippet - quiet seats - recent visitor';
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/travel-rates") {
      response.end(`<!doctype html><html><head><title>travel rate fixture</title></head><body>
        <main style="min-height: 1800px">
          <h1>travel rate fixture</h1>
          <label>Destination <input id="rate-destination" aria-label="destination"></label>
          <p id="query-state">destination:</p>
          <button id="refundable-filter">refundable only</button>
          <p id="filter-state">filter: all rates</p>
          <select id="rate-sort" aria-label="sort">
            <option value="recommended">recommended</option>
            <option value="total">total</option>
          </select>
          <p id="sort-state">sort: recommended</p>
          <section id="room-list" style="margin-top: 900px">
            <article>Standard Queen - breakfast available</article>
            <article>Deluxe Twin - refundable badge - KRW 210,000</article>
          </section>
          <button id="show-more-rates">show more rates</button>
          <button id="show-rate-terms">show rate terms</button>
          <section id="rate-terms">Select a room to view rate policy.</section>
          <article id="rate-price-card">
            <h2>Deluxe Twin</h2>
            <p>KRW 210,000</p>
            <p>2 adults, taxes and fees included</p>
          </article>
        </main>
        <script>
          document.querySelector('#rate-destination').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'destination: ' + event.target.value;
          });
          document.querySelector('#refundable-filter').addEventListener('click', () => {
            document.querySelector('#filter-state').textContent = 'filter: free cancellation';
          });
          document.querySelector('#rate-sort').addEventListener('change', (event) => {
            document.querySelector('#sort-state').textContent = 'sort: ' + event.target.value;
          });
          document.querySelector('#show-more-rates').addEventListener('click', () => {
            const suite = document.createElement('article');
            suite.textContent = 'Suite rate - pay at property - KRW 330,000';
            document.querySelector('#room-list').appendChild(suite);
          });
          document.querySelector('#show-rate-terms').addEventListener('click', () => {
            document.querySelector('#rate-terms').textContent = 'No prepayment needed. Free cancellation until May 29. taxes and fees included. No booking submitted.';
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/commerce") {
      response.end(`<!doctype html><html><head><title>commerce fixture</title></head><body>
        <main style="min-height: 1600px">
          <h1>commerce fixture</h1>
          <label>Product search <input id="commerce-query" aria-label="product search"></label>
          <p id="query-state">query:</p>
          <button id="rocket-filter">rocket delivery filter</button>
          <p id="filter-state">filter: all products</p>
          <select id="commerce-sort" aria-label="sort">
            <option value="recommended">recommended</option>
            <option value="price">price</option>
            <option value="review">review</option>
          </select>
          <p id="sort-state">sort: recommended</p>
          <section id="product-list" style="margin-top: 760px">
            <article id="product-card">
              <h2>Laptop Pro 14</h2>
              <p id="price-badge">KRW 1,290,000 - coupon visible - free rocket delivery</p>
              <p>seller: TechMarket - rating 4.8 - review count 1,204</p>
              <nav id="commerce-destination-links">
                <a id="product-detail-link" href="/commerce-product-detail">Product detail page</a>
                <a id="product-review-link" href="/commerce-product-reviews">Review page</a>
                <a id="seller-profile-link" href="/commerce-seller-profile">Seller profile</a>
                <a id="brand-store-link" href="/commerce-brand-store">Brand store</a>
              </nav>
            </article>
          </section>
          <button id="more-products">more products</button>
          <button id="seller-terms-button">seller and shipping terms</button>
          <section id="seller-terms">Select seller terms to inspect return policy.</section>
          <section id="shipping-panel">Shipping panel idle.</section>
          <button id="cart-button">Add to cart - unsupported fixture button</button>
        </main>
        <script>
          document.querySelector('#commerce-query').addEventListener('input', (event) => {
            document.querySelector('#query-state').textContent = 'query: ' + event.target.value;
          });
          document.querySelector('#rocket-filter').addEventListener('click', () => {
            document.querySelector('#filter-state').textContent = 'filter: rocket delivery';
          });
          document.querySelector('#commerce-sort').addEventListener('change', (event) => {
            document.querySelector('#sort-state').textContent = 'sort: ' + event.target.value;
          });
          document.querySelector('#more-products').addEventListener('click', () => {
            const extra = document.createElement('article');
            extra.textContent = 'Laptop Air 13 - KRW 990,000 - seller: DirectStore - free shipping';
            document.querySelector('#product-list').appendChild(extra);
          });
          document.querySelector('#seller-terms-button').addEventListener('click', () => {
            document.querySelector('#seller-terms').textContent = 'seller: TechMarket. return window 30 days. coupon and warranty text visible. No cart or checkout action submitted.';
            document.querySelector('#shipping-panel').textContent = 'shipping: free rocket delivery. fees included in visible card.';
          });
        </script>
      </body></html>`);
      return;
    }
    if (path === "/video-obstruction") {
      response.end(`<!doctype html><html><head><title>video obstruction fixture</title></head><body>
        <main>
          <h1>video/social fixture</h1>
          <section id="gate" role="dialog" aria-modal="true">
            <h2>Log in to continue</h2>
            <p>No bypass attempted. Browser-visible obstruction should be recorded.</p>
          </section>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/video-visible") {
      response.end(`<!doctype html><html><head><title>visible video social fixture</title></head><body>
        <main>
          <article id="visible-post">
            <section id="obstruction-state">obstruction: none - public browser-visible post shell</section>
            <header id="post-metadata">
              <h1>Public creator profile</h1>
              <p id="profile-card">creator: @public_cafe. profile: public travel creator. followers visible.</p>
              <p id="caption-body">caption visible without login - Tokyo cafe reel caption - posted 2 hours ago</p>
              <p id="engagement-state">Visible engagement context: likes 1,204, comments 86</p>
              <nav id="social-destination-links">
                <a id="profile-link" href="/creator-profile">Creator profile</a>
                <a id="external-link" href="/external-bio">External bio link</a>
                <a id="video-watch-link" href="/canonical-reel">Canonical reel page</a>
              </nav>
              <section id="comment-preview-list">
                <p>public comment preview: menu board helped with ordering.</p>
                <p>public comment preview: queue was short before noon.</p>
              </section>
            </header>
            <section id="video-frame" style="width: 360px; height: 220px; border: 1px solid #333">
              frame at 00:05 - cafe counter and menu board visible
              <p id="overlay-text">visible overlay text: best coffee near station</p>
            </section>
          </article>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/youtube-visible") {
      response.end(`<!doctype html><html><head><title>YouTube visible search fixture</title></head><body>
        <main id="contents">
          <section id="youtube-obstruction-state">obstruction: none - public YouTube search results shell</section>
          <ytd-video-renderer data-media-url="/watch?v=seoulcafes" data-channel-url="/@public_cafe_channel">
            <a id="video-title" href="/watch?v=seoulcafes">Seoul cafe walkthrough</a>
            <ytd-channel-name><a href="/@public_cafe_channel">Public Cafe Channel</a></ytd-channel-name>
            <a id="channel-thumbnail" href="/@public_cafe_channel">Channel avatar</a>
            <p id="metadata-line">views 12K - posted 3 hours ago - public metadata visible</p>
          </ytd-video-renderer>
          <ytd-rich-item-renderer data-media-url="/watch?v=relatedcafes" data-channel-url="/@related_cafe_channel">
            <a id="video-title-link" href="/watch?v=relatedcafes">Related cafe video</a>
            <a id="thumbnail" href="/shorts/seoul-cafe-short">Shorts thumbnail</a>
            <ytd-thumbnail>thumbnail frame - menu board and counter visible</ytd-thumbnail>
          </ytd-rich-item-renderer>
          <p id="overlay-text">visible YouTube overlay text: cafe menu under KRW 8000</p>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/tiktok-visible") {
      response.end(`<!doctype html><html><head><title>TikTok visible post fixture</title></head><body>
        <main>
          <article id="tiktok-visible-post" data-e2e="browse-video">
            <section id="tiktok-obstruction-state">obstruction: none - public TikTok browser-visible post shell</section>
            <header id="tiktok-post-metadata">
              <h1>TikTok public creator profile</h1>
              <p id="tiktok-profile-card">creator: @public_cafe. profile: public cafe creator. followers visible.</p>
              <p id="tiktok-caption-body" data-e2e="video-desc">visible TikTok caption - Seoul cafe counter walkthrough - posted 1 hour ago</p>
              <p id="tiktok-engagement-state">Visible TikTok engagement context: likes 12,400, comments 310, shares 55</p>
              <nav id="tiktok-destination-links">
                <a id="tiktok-profile-link" href="/@public_cafe">Public TikTok profile</a>
                <a id="tiktok-external-link" href="/restaurant-source">Restaurant source</a>
                <a id="tiktok-video-watch-link" href="/tiktok-video/1234567890123456789">Canonical TikTok video</a>
                <button data-media-url="/tiktok-related-video">Related TikTok video card</button>
                <div data-profile-url="/tiktok-creator-card">TikTok creator card</div>
              </nav>
              <section id="tiktok-comment-preview-list">
                <p>public TikTok comment preview: menu overlay was readable.</p>
                <p>public TikTok comment preview: location tag helped find the cafe.</p>
              </section>
            </header>
            <section id="tiktok-video-frame" data-e2e="video-player" style="width: 360px; height: 220px; border: 1px solid #333">
              frame at 00:07 - cafe counter, drink label, and menu board visible
              <p id="tiktok-overlay-text">visible TikTok overlay text: best latte near exit 3</p>
            </section>
          </article>
        </main>
      </body></html>`);
      return;
    }
    if (path === "/x-visible") {
      response.end(`<!doctype html><html><head><title>X/Twitter visible post fixture</title></head><body>
        <main>
          <article id="x-visible-post" data-testid="tweet">
            <section id="x-obstruction-state">obstruction: none - public X/Twitter post shell</section>
            <header id="x-post-metadata">
              <a href="/public_creator" data-testid="User-Name">Public Creator @public_creator</a>
              <time datetime="2026-05-26T19:20:00Z">posted 4 minutes ago</time>
              <p id="x-profile-card">profile card: public creator, visible handle, public bio snippet.</p>
              <p data-testid="tweetText">Public post text with a visible travel tip and linked media context.</p>
              <p id="x-engagement-state">Visible engagement context: replies 14, reposts 25, likes 240</p>
              <nav id="social-destination-links">
                <a id="x-profile-link" href="/public_creator">Public Creator profile</a>
                <a href="/example/status/9876543210">Related status</a>
                <a href="/external-source">External source</a>
              </nav>
            </header>
            <section id="x-thread-context">
              <p>reply context visible: one prior post and one public reply are shown in the browser.</p>
            </section>
            <section id="x-reply-list">
              <p>public reply preview: the station exit detail is visible.</p>
              <p>public reply preview: weekend timing context is visible.</p>
            </section>
            <section id="x-media-frame" data-testid="tweetPhoto" style="width: 360px; height: 220px; border: 1px solid #333">
              media frame visible - station cafe photo and menu board
              <p id="x-overlay-text">overlay text on media: weekend queue starts at 10</p>
            </section>
          </article>
        </main>
      </body></html>`);
      return;
    }
    response.end("<!doctype html><html><head><title>fixture</title></head><body>fixture</body></html>");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}
