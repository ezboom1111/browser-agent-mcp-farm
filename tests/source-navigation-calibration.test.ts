import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { ArtifactWriter } from "../src/artifact-writer.js";
import { BrowserPool } from "../src/browser-pool.js";
import { LeaseManager } from "../src/lease-manager.js";
import {
  calibrateSourceNavigationRecipePlan,
  writeSourceNavigationCalibrationArtifact
} from "../src/source-navigation-calibration.js";
import { describeSourceNavigationPlan } from "../src/source-navigation.js";
import { describeSourceNavigationRecipePlan } from "../src/source-navigation-recipes.js";
import { describeSourceStrategy } from "../src/source-strategy.js";

let runDirs: string[] = [];

describe("calibrateSourceNavigationRecipePlan", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("probes Google-like selector candidates read-only and records calibration artifacts", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-"));
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
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/google-like`);
      const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/google-like`
      });
      const records = await writeSourceNavigationCalibrationArtifact({
        artifactWriter,
        runDir,
        sourceUrl: `${fixture.baseUrl}/google-like`,
        contextToken: lease.contextToken,
        pageId: page.pageId,
        report
      });

      expect(report.executionPolicy).toBe("read_only_selector_probe");
      expect(report.summary.actionCandidateCount).toBe(6);
      expect(report.summary.matchedSelectorCount).toBeGreaterThanOrEqual(6);
      expect(report.summary.matchedCaptureScopeCount).toBeGreaterThanOrEqual(3);
      expect(report.summary.blockedSignalHits).toBe(0);
      expect(report.actionCalibrations.find((action) => action.actionKey === "destination-followup")?.status).toBe("observed");
      const destinationProbe = report.actionCalibrations
        .find((action) => action.actionKey === "destination-followup")
        ?.selectorResults.find((result) => result.selector === "#result-card")
        ?.destinationProbe;
      expect(destinationProbe).toMatchObject({
        status: "ok",
        usableCandidateCount: 1,
        uniqueCandidateCount: 1,
        anchorCandidateCount: 1,
        attributeCandidateCount: 0,
        promotableCandidateCount: 1,
        nonPromotableCandidateCount: 0,
        warningCounts: []
      });
      expect(destinationProbe?.sampleUrls?.[0]).toContain("/destination");
      expect(destinationProbe?.samplePromotableUrls?.[0]).toContain("/destination");
      expect(destinationProbe?.samplePromotableTargets?.[0]).toMatchObject({
        url: expect.stringContaining("/destination"),
        text: "Destination page",
        source: "anchor",
        warnings: []
      });
      expect(records.some((record) => record.evidence_kind === "source_navigation_calibration")).toBe(true);

      const artifactText = await readFile(join(runDir, "raw", "source-navigation-calibration.txt"), "utf8");
      expect(artifactText).toContain("\"executionPolicy\": \"read_only_selector_probe\"");
      expect(artifactText).toContain("\"destinationProbe\"");
      expect(artifactText).toContain("Tokyo hotel result");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("records no-usable-link destination probes for visible destination containers without links", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration destination-probe test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-destination-probe-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/google-like-no-destination`);
      const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/google-like-no-destination`
      });

      const destinationResult = report.actionCalibrations
        .find((action) => action.actionKey === "destination-followup")
        ?.selectorResults.find((result) => result.selector === "#result-card");
      expect(destinationResult).toMatchObject({
        status: "matched",
        destinationProbe: {
          status: "no_usable_links",
          rawCandidateCount: 0,
          usableCandidateCount: 0,
          uniqueCandidateCount: 0,
          anchorCandidateCount: 0,
          attributeCandidateCount: 0,
          promotableCandidateCount: 0,
          nonPromotableCandidateCount: 0,
          warningCounts: []
        }
      });
      expect(report.actionCalibrations.find((action) => action.actionKey === "destination-followup")?.status).toBe("observed");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("probes result selectors and destination links inside iframes", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration iframe test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-iframe-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/google-like-iframe`);
      const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/google-like-iframe`
      });

      const resultCard = report.actionCalibrations
        .find((action) => action.actionKey === "result-selection")
        ?.selectorResults.find((result) => result.selector === "#result-card");
      expect(resultCard).toMatchObject({
        status: "matched",
        matchedFrameCount: 1,
        visibleFrameCount: 1,
        firstVisibleFrameUrl: expect.stringContaining("/google-like-frame-content")
      });

      const destinationProbe = report.actionCalibrations
        .find((action) => action.actionKey === "destination-followup")
        ?.selectorResults.find((result) => result.selector === "#result-card")
        ?.destinationProbe;
      expect(destinationProbe).toMatchObject({
        status: "ok",
        usableCandidateCount: 1,
        promotableCandidateCount: 1,
        matchedFrameCount: 1,
        samplePromotableUrls: [
          `${fixture.baseUrl}/destination`
        ],
        samplePromotableTargets: [
          expect.objectContaining({
            url: `${fixture.baseUrl}/destination`,
            text: "Destination page",
            source: "anchor",
            frameUrl: expect.stringContaining("/google-like-frame-content"),
            warnings: []
          })
        ]
      });
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("classifies provider shell and login destination probes as non-promotable for map pages", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration provider-shell probe test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-provider-shell-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/naver-map-provider-shell`);
      const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: "https://map.naver.com/p/search/seongsu%20cafe"
      });

      const destinationProbe = report.actionCalibrations
        .find((action) => action.actionKey === "destination-followup")
        ?.selectorResults.find((result) => result.selector === "#root a[href^=\"http\"]")
        ?.destinationProbe;
      expect(destinationProbe).toMatchObject({
        status: "ok",
        usableCandidateCount: 2,
        promotableCandidateCount: 0,
        nonPromotableCandidateCount: 2,
        warningCounts: expect.arrayContaining([
          { warning: "login_or_account_surface", count: 1 },
          { warning: "low_value_navigation_surface", count: 1 }
        ]),
        sampleNonPromotableUrls: [
          "https://www.naver.com/",
          "https://nid.naver.com/nidlogin.login"
        ],
        sampleNonPromotableTargets: [
          expect.objectContaining({
            url: "https://www.naver.com/",
            source: "anchor",
            warnings: expect.arrayContaining(["low_value_navigation_surface", "source_family_weak_fit"])
          }),
          expect.objectContaining({
            url: "https://nid.naver.com/nidlogin.login",
            source: "anchor",
            warnings: expect.arrayContaining(["login_or_account_surface", "source_family_weak_fit"])
          })
        ]
      });
      expect(destinationProbe?.samplePromotableUrls).toBeUndefined();
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("probes client-state destination extraction candidates read-only", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration client-state test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-client-state-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/naver-map-client-state`);
      const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: "https://map.naver.com/p/search/seongsu%20cafe"
      });

      const clientStateAction = report.actionCalibrations.find((action) => action.operation === "extract_client_state_destinations");
      expect(clientStateAction?.status).toBe("observed");
      expect(clientStateAction?.clientStateProbe).toMatchObject({
        status: "ok",
        stateKey: "__APOLLO_STATE__",
        extractor: "naver_place_apollo",
        destinationPath: "restaurant",
        frameCount: 1,
        matchedFrameCount: 1,
        parsedFrameCount: 1,
        rawCandidateCount: 2,
        uniqueCandidateCount: 2,
        sampleUrls: [
          "https://map.naver.com/p/entry/place/1790076538",
          "https://map.naver.com/p/entry/place/9876543210"
        ],
        sampleOriginalUrls: [
          "https://place.naver.com/restaurant/1790076538",
          "https://place.naver.com/restaurant/9876543210"
        ],
        sampleTexts: [
          expect.stringContaining("\uC131\uC218 \uCE74\uD398"),
          expect.stringContaining("\uC131\uC218 \uB514\uC800\uD2B8")
        ]
      });
      expect(report.summary.clientStateProbeCount).toBe(1);
      expect(report.summary.clientStateProbeOkCount).toBe(1);
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("records global destination discovery when planned map selectors miss a promotable link", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration destination discovery test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-discovery-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/naver-map-discovery-only`);
      const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: "https://map.naver.com/p/search/seongsu%20cafe"
      });

      const destinationAction = report.actionCalibrations.find((action) => action.actionKey === "destination-followup");
      expect(destinationAction?.selectorResults.filter((result) => result.status === "matched")).toHaveLength(0);
      expect(destinationAction?.destinationDiscovery).toMatchObject({
        status: "ok",
        usableCandidateCount: 2,
        promotableCandidateCount: 2,
        nonPromotableCandidateCount: 0,
        samplePromotableUrls: expect.arrayContaining([
          "https://place.naver.com/restaurant/12345",
          "https://place.naver.com/restaurant/67890"
        ]),
        samplePromotableTargets: expect.arrayContaining([
          expect.objectContaining({
            url: "https://place.naver.com/restaurant/12345",
            text: "\uC131\uC218 \uCE74\uD398 \uC7A5\uC18C \uC0C1\uC138",
            source: "anchor",
            warnings: []
          }),
          expect.objectContaining({
            url: "https://place.naver.com/restaurant/67890",
            text: "\uC131\uC218 \uCE74\uD398 \uC18D\uC131 \uC7A5\uC18C",
            source: "attribute",
            attributeName: "data-place-url",
            warnings: []
          })
        ])
      });
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("classifies global discovery map shell hash anchors as non-promotable", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration destination discovery shell test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-discovery-shell-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/naver-map-discovery-shell-only`);
      const recipePlan = recipePlanFor("https://map.naver.com/p/search/seongsu%20cafe");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: "https://map.naver.com/p/search/seongsu%20cafe"
      });

      const discovery = report.actionCalibrations.find((action) => action.actionKey === "destination-followup")?.destinationDiscovery;
      expect(discovery).toMatchObject({
        status: "ok",
        usableCandidateCount: 4,
        promotableCandidateCount: 0,
        nonPromotableCandidateCount: 4,
        warningCounts: expect.arrayContaining([
          { warning: "low_value_navigation_surface", count: 3 },
          { warning: "login_or_account_surface", count: 1 }
        ]),
        sampleNonPromotableUrls: expect.arrayContaining([
          "https://map.naver.com/p/#section_content",
          "https://map.naver.com/p/#header",
          "https://www.naver.com/",
          "https://nid.naver.com/nidlogin.login"
        ]),
        sampleNonPromotableTargets: expect.arrayContaining([
          expect.objectContaining({
            url: "https://map.naver.com/p/#section_content",
            warnings: expect.arrayContaining(["low_value_navigation_surface"])
          }),
          expect.objectContaining({
            url: "https://nid.naver.com/nidlogin.login",
            warnings: expect.arrayContaining(["login_or_account_surface"])
          })
        ])
      });
      expect(discovery?.samplePromotableUrls).toBeUndefined();
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("classifies Google News navigation shell links as non-promotable while probing read links", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration Google News shell test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-google-news-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/google-news-shell-and-read`);
      const recipePlan = recipePlanFor("https://news.google.com/search?q=AI+policy");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: "https://news.google.com/search?q=AI+policy"
      });

      const destinationAction = report.actionCalibrations.find((action) => action.actionKey === "destination-followup");
      const readProbe = destinationAction?.selectorResults.find((result) => result.selector === 'a[href^="./read/"]')?.destinationProbe;
      expect(readProbe).toMatchObject({
        status: "ok",
        usableCandidateCount: 1,
        promotableCandidateCount: 1,
        nonPromotableCandidateCount: 0,
        samplePromotableUrls: [
          "https://news.google.com/read/CBMiFixtureArticle?hl=en-US&gl=US&ceid=US%3Aen"
        ],
        samplePromotableTargets: [
          expect.objectContaining({
            url: "https://news.google.com/read/CBMiFixtureArticle?hl=en-US&gl=US&ceid=US%3Aen",
            text: "AI policy publisher article",
            source: "anchor",
            warnings: []
          })
        ]
      });
      expect(destinationAction?.destinationDiscovery).toMatchObject({
        status: "ok",
        promotableCandidateCount: 2,
        nonPromotableCandidateCount: 4,
        warningCounts: expect.arrayContaining([
          { warning: "low_value_navigation_surface", count: 4 }
        ]),
        sampleNonPromotableUrls: expect.arrayContaining([
          "https://news.google.com/?hl=en-US&gl=US&ceid=US%3Aen",
          "https://news.google.com/home?hl=en-US&gl=US&ceid=US%3Aen",
          "https://news.google.com/my/library?hl=en-US&gl=US&ceid=US%3Aen",
          "https://www.google.co.kr/intl/en/about/products?tab=nh"
        ])
      });
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("classifies Reuters shell links as non-promotable while probing dated article links", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration Reuters shell test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-reuters-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/reuters-shell-and-article`);
      const recipePlan = recipePlanFor("https://www.reuters.com/site-search/?query=AI%20policy");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: "https://www.reuters.com/site-search/?query=AI%20policy"
      });

      const destinationAction = report.actionCalibrations.find((action) => action.actionKey === "destination-followup");
      const articleProbe = destinationAction?.selectorResults.find((result) => result.selector === 'main a[href*="/world/"][href*="-20"]')?.destinationProbe;
      expect(articleProbe).toMatchObject({
        status: "ok",
        usableCandidateCount: 1,
        promotableCandidateCount: 1,
        nonPromotableCandidateCount: 0,
        samplePromotableUrls: [
          "https://www.reuters.com/world/us/ai-policy-lawmakers-debate-new-rules-2026-05-28/"
        ],
        samplePromotableTargets: [
          expect.objectContaining({
            url: "https://www.reuters.com/world/us/ai-policy-lawmakers-debate-new-rules-2026-05-28/",
            text: "AI policy lawmakers debate new rules",
            source: "anchor",
            warnings: []
          })
        ]
      });
      expect(destinationAction?.destinationDiscovery).toMatchObject({
        status: "ok",
        promotableCandidateCount: 2,
        nonPromotableCandidateCount: 4,
        warningCounts: expect.arrayContaining([
          { warning: "low_value_navigation_surface", count: 4 }
        ]),
        sampleNonPromotableUrls: expect.arrayContaining([
          "https://www.reuters.com/world/",
          "https://www.reuters.com/business/",
          "https://www.reuters.com/site-search/?query=AI%20policy",
          "https://www.thomsonreuters.com/en/privacy-statement.html"
        ])
      });
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("surfaces blocked signals for video/social calibration pages", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration blocked-signal test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-blocked-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/blocked-social`);
      const recipePlan = recipePlanFor("https://www.tiktok.com/@example/video/123");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/blocked-social`
      });

      expect(report.summary.blockedSignalHits).toBeGreaterThanOrEqual(3);
      expect(report.actionCalibrations.find((action) => action.actionKey === "obstruction-check")?.status).toBe("blocked_signal_detected");
      expect(report.warnings.join(" ")).toContain("read-only");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("does not mark visible social pages blocked for login chrome alone", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration visible-social test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-visible-social-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/visible-social-login-chrome`);
      const recipePlan = recipePlanFor("https://www.instagram.com/explore/tags/tokyotravel/");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/visible-social-login-chrome`
      });

      expect(report.summary.blockedSignalHits).toBe(0);
      expect(report.summary.blockedActionCount).toBe(0);
      expect(report.actionCalibrations.find((action) => action.actionKey === "visible-metadata")?.status).toBe("observed");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("surfaces search engine bot-check pages as blocked calibration signals", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration search block test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-search-blocked-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/blocked-search`);
      const recipePlan = recipePlanFor("https://www.google.com/search?q=tokyo+hotel");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/blocked-search`
      });

      expect(report.summary.blockedSignalHits).toBeGreaterThanOrEqual(2);
      expect(report.actionCalibrations.find((action) => action.actionKey === "result-selection")?.status).toBe("blocked_signal_detected");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("surfaces global community security verification pages as blocked calibration signals", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration community security block test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-community-blocked-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/blocked-community-security`);
      const recipePlan = recipePlanFor("https://stackoverflow.com/search?q=tokyo+travel");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/blocked-community-security`
      });

      expect(report.summary.blockedSignalHits).toBeGreaterThanOrEqual(4);
      expect(report.summary.blockedActionCount).toBe(recipePlan.actionCandidates.length);
      expect(report.actionCalibrations.find((action) => action.actionKey === "article-capture")?.status).toBe("blocked_signal_detected");
      expect(report.actionCalibrations.find((action) => action.actionKey === "obstruction-check")?.status).toBe("blocked_signal_detected");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("surfaces DataDome captcha-delivery pages as blocked calibration signals", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration DataDome block test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-datadome-blocked-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/blocked-datadome`);
      const recipePlan = recipePlanFor("https://www.reuters.com/site-search/?query=AI%20policy");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/blocked-datadome`
      });

      expect(report.summary.blockedSignalHits).toBeGreaterThanOrEqual(3);
      expect(report.summary.blockedActionCount).toBe(recipePlan.actionCandidates.length);
      expect(report.actionCalibrations.find((action) => action.actionKey === "article-capture")?.status).toBe("blocked_signal_detected");
      expect(report.actionCalibrations.find((action) => action.actionKey === "obstruction-check")?.status).toBe("blocked_signal_detected");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("surfaces Korean marketplace access blocks as commerce calibration signals", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration commerce block test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-commerce-blocked-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/blocked-commerce`);
      const recipePlan = recipePlanFor("https://shopping.naver.com/search/all?query=earbuds");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/blocked-commerce`
      });

      expect(report.summary.blockedSignalHits).toBeGreaterThanOrEqual(2);
      expect(report.summary.blockedActionCount).toBe(recipePlan.actionCandidates.length);
      expect(report.actionCalibrations.find((action) => action.actionKey === "product-card")?.status).toBe("blocked_signal_detected");
      expect(report.actionCalibrations.find((action) => action.actionKey === "price-ocr")?.status).toBe("blocked_signal_detected");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("surfaces global travel security challenges as travel calibration signals", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration travel block test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-travel-blocked-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/blocked-travel`);
      const recipePlan = recipePlanFor("https://www.booking.com/searchresults.html?ss=tokyo");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/blocked-travel`
      });

      expect(report.summary.blockedSignalHits).toBeGreaterThanOrEqual(3);
      expect(report.summary.blockedActionCount).toBe(recipePlan.actionCandidates.length);
      expect(report.actionCalibrations.find((action) => action.actionKey === "offer-detail")?.status).toBe("blocked_signal_detected");
      expect(report.actionCalibrations.find((action) => action.actionKey === "price-ocr")?.status).toBe("blocked_signal_detected");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("surfaces Expedia human-or-bot challenges as travel calibration signals", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration Expedia block test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-expedia-blocked-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/blocked-expedia`);
      const recipePlan = recipePlanFor("https://www.expedia.com/Hotel-Search?destination=Tokyo");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/blocked-expedia`
      });

      expect(report.summary.blockedSignalHits).toBeGreaterThanOrEqual(3);
      expect(report.summary.blockedActionCount).toBe(recipePlan.actionCandidates.length);
      expect(report.actionCalibrations.find((action) => action.actionKey === "offer-card")?.status).toBe("blocked_signal_detected");
      expect(report.actionCalibrations.find((action) => action.actionKey === "price-ocr")?.status).toBe("blocked_signal_detected");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("does not treat generic Naver Blog login and join header links as a blocked page", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration Naver Blog shell test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-blog-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/naver-blog-search-shell`);
      const recipePlan = recipePlanFor("https://section.blog.naver.com/Search/Post.naver?keyword=cafe");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/naver-blog-search-shell`
      });

      expect(report.summary.blockedSignalHits).toBe(0);
      expect(report.actionCalibrations.find((action) => action.actionKey === "article-capture")?.status).toBe("observed");
      expect(report.actionCalibrations.find((action) => action.actionKey === "obstruction-check")?.status).toBe("observed");
      expect(report.actionCalibrations
        .find((action) => action.actionKey === "article-capture")
        ?.captureScopeResults.filter((result) => result.status === "matched").map((result) => result.selector)).toEqual(expect.arrayContaining([
          "#content",
          "#app",
          ".post_list_wrap"
        ]));
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("still surfaces specific Naver Cafe membership walls as blocked", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration Naver Cafe membership-wall test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-cafe-wall-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/naver-cafe-member-wall`);
      const recipePlan = recipePlanFor("https://cafe.naver.com/example");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/naver-cafe-member-wall`
      });

      expect(report.summary.blockedSignalHits).toBeGreaterThanOrEqual(2);
      expect(report.actionCalibrations.find((action) => action.actionKey === "obstruction-check")?.status).toBe("blocked_signal_detected");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });

  it("probes map shell capture scopes read-only", async () => {
    if (!await chromiumAvailable()) {
      console.warn("Skipping source navigation calibration map shell test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startCalibrationFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-source-nav-calibration-map-"));
    runDirs.push(runDir);
    const manager = new LeaseManager();
    const pool = new BrowserPool(manager);

    try {
      const lease = manager.acquire({
        agentId: "agent",
        runId: "run",
        artifactRunDir: runDir,
        allowedDomains: ["127.0.0.1"],
        maxPages: 1
      });
      const page = await pool.openPage("agent", lease.contextToken, `${fixture.baseUrl}/kakao-map-shell`);
      const recipePlan = recipePlanFor("https://map.kakao.com/?q=seoul+cafe");
      const report = await calibrateSourceNavigationRecipePlan({
        recipePlan,
        browserPool: pool,
        agentId: "agent",
        contextToken: lease.contextToken,
        pageId: page.pageId,
        url: `${fixture.baseUrl}/kakao-map-shell`
      });

      expect(report.summary.matchedCaptureScopeCount).toBeGreaterThanOrEqual(3);
      expect(report.actionCalibrations.find((action) => action.actionKey === "map-viewport")?.status).toBe("observed");
      expect(report.actionCalibrations.find((action) => action.actionKey === "map-ocr")?.status).toBe("observed");
    } finally {
      await pool.shutdown();
      await fixture.close();
    }
  });
});

function recipePlanFor(url: string) {
  return describeSourceNavigationRecipePlan(describeSourceNavigationPlan({
    sourceStrategy: describeSourceStrategy(url)
  }));
}

async function chromiumAvailable(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

async function startCalibrationFixtureServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const path = request.url?.split("?", 1)[0] ?? "/";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (path === "/blocked-social") {
      response.end(`<!doctype html>
<html>
  <body>
    <main>
      <h1>Video unavailable</h1>
      <div id="gate" role="dialog">Please log in. Captcha required. Open app to continue. This media is age restricted and not available.</div>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/visible-social-login-chrome") {
      response.end(`<!doctype html>
<html>
  <body>
    <nav><a>Log In</a><a>Sign Up</a></nav>
    <main>
      <h1>Tokyotravel</h1>
      <article id="visible-post">
        <h2>Tokyo travel guide</h2>
        <p>Watch public reels and captions from people around the world.</p>
      </article>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/blocked-search") {
      response.end(`<!doctype html>
<html>
  <body>
    <main>
      <h1>About this page</h1>
      <p>Our systems have detected unusual traffic from your computer network.</p>
      <p>This page checks to see if it is really you sending the requests, and not a robot.</p>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/blocked-community-security") {
      response.end(`<!doctype html>
<html>
  <head><title>Performing security verification</title></head>
  <body>
    <main>
      <h1>Performing security verification</h1>
      <p>This website uses a security service to protect against malicious bots.</p>
      <p>This page is displayed while the website verifies you are not a bot.</p>
      <p>Ray ID: community-test. Performance and Security by Cloudflare.</p>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/blocked-datadome") {
      response.end(`<!doctype html>
<html>
  <head><title>Reuters challenge</title></head>
  <body>
    <main>
      <script>var dd={'rt':'c','host':'geo.captcha-delivery.com','cid':'challenge'};</script>
      <p>Please wait.</p>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/blocked-commerce") {
      response.end(`<!doctype html>
<html>
  <body>
    <main>
      <h1>\uC1FC\uD551 \uC11C\uBE44\uC2A4 \uC811\uC18D\uC774 \uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C\uB418\uC5C8\uC2B5\uB2C8\uB2E4.</h1>
      <p>\uBE44\uC815\uC0C1\uC801\uC778 \uC811\uADFC\uC774 \uAC10\uC9C0\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC6D0\uD65C\uD55C \uC11C\uBE44\uC2A4 \uC774\uC6A9\uC744 \uC704\uD55C \uAC04\uB2E8\uD55C \uD655\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.</p>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/blocked-travel") {
      response.end(`<!doctype html>
<html>
  <body>
    <main>
      <h1>Pardon Our Interruption</h1>
      <p>Access to this page has been denied. Please complete the security check and enable cookies to continue.</p>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/blocked-expedia") {
      response.end(`<!doctype html>
<html>
  <head><title>Bot or Not?</title></head>
  <body>
    <main>
      <h1>Show us your human side...</h1>
      <p>We can't tell if you're a human or a bot.</p>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/naver-blog-search-shell") {
      response.end(`<!doctype html>
<html>
  <body>
    <header>
      <a href="/login">\uB85C\uADF8\uC778</a>
      <a href="/market/join">\uBE14\uB85C\uADF8 \uB9C8\uCF13 \uAC00\uC785</a>
    </header>
    <div id="app">
      <main id="content">
        <section class="BlogId_content">
          <div class="post_list_wrap">
            <article>
              <h2>\uC131\uC218 \uCE74\uD398 \uAC80\uC0C9 \uACB0\uACFC</h2>
              <p>\uC791\uC131\uC790\uC640 \uB0A0\uC9DC\uAC00 \uBCF4\uC774\uB294 \uBE14\uB85C\uADF8 \uACB0\uACFC \uBCF8\uBB38 \uBBF8\uB9AC\uBCF4\uAE30.</p>
            </article>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>`);
      return;
    }
    if (path === "/naver-cafe-member-wall") {
      response.end(`<!doctype html>
<html>
  <body>
    <main id="app">
      <div id="member-wall">\uC774 \uCE74\uD398\uB294 \uBA64\uBC84\uB9CC \uBCFC \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uAC00\uC785\uD574\uC57C \uC811\uADFC \uAD8C\uD55C\uC774 \uC5F4\uB9BD\uB2C8\uB2E4.</div>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/kakao-map-shell") {
      response.end(`<!doctype html>
<html>
  <body>
    <div id="search" class="Search">
      <input type="text" id="search.keyword.query" name="q" value="seoul cafe">
    </div>
    <div id="view" class="View">
      <div id="view.map" class="map">
        <div id="view.mapContainer" class="cont_map">Visible Kakao map viewport with pins and labels.</div>
      </div>
    </div>
    <div id="info.search" class="keywordSearch">
      <div id="info.search.place" class="section places">
        <ul id="info.search.place.list">
          <li><a href="/place/1">Cafe result with address and review snippet</a></li>
        </ul>
      </div>
    </div>
  </body>
</html>`);
      return;
    }
    if (path === "/google-like-no-destination") {
      response.end(`<!doctype html>
<html>
  <body>
    <main id="search">
      <input id="google-query" name="q" value="tokyo hotel">
      <article id="result-card">
        <h2>Tokyo hotel result without follow-up</h2>
        <p>Visible result copy with no anchor, href, or destination URL attributes.</p>
      </article>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/google-like-iframe") {
      response.end(`<!doctype html>
<html>
  <body>
    <main id="search">
      <iframe name="results-frame" src="/google-like-frame-content"></iframe>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/google-like-frame-content") {
      response.end(`<!doctype html>
<html>
  <body>
    <article id="result-card">
      <h2>Tokyo hotel iframe result</h2>
      <p>Result card rendered inside a browser frame.</p>
      <a id="result-link" href="/destination">Destination page</a>
    </article>
  </body>
</html>`);
      return;
    }
    if (path === "/naver-map-provider-shell") {
      response.end(`<!doctype html>
<html>
  <body>
    <main id="root">
      <a href="https://www.naver.com/">\uB124\uC774\uBC84\uC9C0\uB3C4</a>
      <a href="https://nid.naver.com/nidlogin.login">\uB85C\uADF8\uC778</a>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/naver-map-client-state") {
      response.end(`<!doctype html>
<html>
  <body>
    <main id="root">
      <section id="app-root">
        <article>\uC131\uC218 \uCE74\uD398 \uAC80\uC0C9 \uACB0\uACFC</article>
      </section>
      <script>
        window.__APOLLO_STATE__ = {
          "Place:1790076538": {
            id: "1790076538",
            name: "\uC131\uC218 \uCE74\uD398",
            category: "\uCE74\uD398",
            roadAddress: "\uC11C\uC6B8 \uC131\uB3D9\uAD6C \uC131\uC218\uC774\uB85C",
            x: "127.044",
            y: "37.544",
            visitorReviewCount: "120"
          },
          "Place:9876543210": {
            id: "9876543210",
            name: "\uC131\uC218 \uB514\uC800\uD2B8",
            businessCategory: "\uB514\uC800\uD2B8",
            address: "\uC11C\uC6B8 \uC131\uB3D9\uAD6C",
            reviewCount: "45"
          }
        };
      </script>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/naver-map-discovery-only") {
      response.end(`<!doctype html>
<html>
  <body>
    <main id="not-root">
      <a href="https://place.naver.com/restaurant/12345">\uC131\uC218 \uCE74\uD398 \uC7A5\uC18C \uC0C1\uC138</a>
      <button data-place-url="https://place.naver.com/restaurant/67890">\uC131\uC218 \uCE74\uD398 \uC18D\uC131 \uC7A5\uC18C</button>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/naver-map-discovery-shell-only") {
      response.end(`<!doctype html>
<html>
  <body>
    <main id="not-root">
      <a href="https://map.naver.com/p/#section_content">\uBCF8\uBB38 \uBC14\uB85C\uAC00\uAE30</a>
      <a href="https://map.naver.com/p/#header">\uC8FC \uBA54\uB274 \uBC14\uB85C\uAC00\uAE30</a>
      <a href="https://www.naver.com/">\uB124\uC774\uBC84\uC9C0\uB3C4</a>
      <a href="https://nid.naver.com/nidlogin.login">\uB85C\uADF8\uC778</a>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/google-news-shell-and-read") {
      response.end(`<!doctype html>
<html>
  <head><base href="https://news.google.com/"></head>
  <body>
    <header>
      <a href="https://news.google.com/?hl=en-US&gl=US&ceid=US%3Aen">News</a>
      <a href="https://www.google.co.kr/intl/en/about/products?tab=nh">Google apps</a>
    </header>
    <main>
      <nav>
        <button data-url="https://news.google.com/home?hl=en-US&gl=US&ceid=US%3Aen">Home</button>
        <button data-url="https://news.google.com/my/library?hl=en-US&gl=US&ceid=US%3Aen">Following</button>
      </nav>
      <article>
        <h2>AI policy publisher article</h2>
        <a href="./read/CBMiFixtureArticle?hl=en-US&gl=US&ceid=US%3Aen">AI policy publisher article</a>
      </article>
      <article>
        <h2>AI policy second article</h2>
        <a href="https://news.google.com/read/CBMiSecondArticle?hl=en-US&gl=US&ceid=US%3Aen">AI policy second article</a>
      </article>
    </main>
  </body>
</html>`);
      return;
    }
    if (path === "/reuters-shell-and-article") {
      response.end(`<!doctype html>
<html>
  <head><base href="https://www.reuters.com/"></head>
  <body>
    <header>
      <a href="/world/">World</a>
      <a href="/business/">Business</a>
      <a href="/site-search/?query=AI%20policy">Search Reuters</a>
      <a href="https://www.thomsonreuters.com/en/privacy-statement.html">Privacy</a>
    </header>
    <main>
      <section data-testid="MediaStoryCard">
        <h2>AI policy lawmakers debate new rules</h2>
        <a href="/world/us/ai-policy-lawmakers-debate-new-rules-2026-05-28/">AI policy lawmakers debate new rules</a>
      </section>
      <section data-testid="SearchResult">
        <h2>AI policy technology roundup</h2>
        <a href="https://www.reuters.com/technology/artificial-intelligence-policy-roundup-2026-05-29/">AI policy technology roundup</a>
      </section>
    </main>
  </body>
</html>`);
      return;
    }
    response.end(`<!doctype html>
<html>
  <body>
    <main id="search">
      <input id="google-query" name="q" value="tokyo hotel">
      <nav>
        <a id="tab-images" href="/images">Images</a>
      </nav>
      <button id="tools" aria-label="Search tools">Search tools</button>
      <section id="filter-panel">Filter panel recent results</section>
      <button id="more-results">More results</button>
      <article id="result-card">
        <h2>Tokyo hotel result</h2>
        <p>Snippet with Sponsored marker and visible price context.</p>
        <a id="result-link" href="/destination">Destination page</a>
      </article>
    </main>
  </body>
</html>`);
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Calibration fixture server did not bind to a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    })
  };
}
