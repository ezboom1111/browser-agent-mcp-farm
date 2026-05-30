#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { ArtifactWriter } from "./artifact-writer.js";
import { BrowserPool } from "./browser-pool.js";
import { normalizeEvidenceRunInput } from "./evidence-run-input.js";
import { buildDestinationRecoveryPlanFromRunDir, checkDestinationRecoveryPlan, filterDestinationRecoveryPlanByCheck, formatDestinationRecoveryPlanCommandsAsLines, formatDestinationRecoveryPlanMarkdown, type DestinationRecoveryPlanCheckOptions, type DestinationRecoveryPlanCommandFormat } from "./destination-recovery-plan.js";
import { FarmService } from "./farm-service.js";
import { LeaseManager } from "./lease-manager.js";
import { runStdioServer } from "./mcp-server.js";
import { runEvidenceWorkflow } from "./evidence-runner.js";
import { runClaimGate } from "./claim-gate.js";
import { buildHtmlPreview } from "./html-preview.js";
import { createHttpServer } from "./http-server.js";
import { buildOfficialApiReadiness } from "./official-api.js";
import { listProfiles, profilePaths, removeProfile } from "./profile-store.js";
import { completeNextCritiqueTask, getNextCritiqueTask } from "./critique-runner.js";
import { describePlatformCapabilities } from "./platform-adapters/index.js";
import { registerAll, registerClaude, registerCodex } from "./registration.js";
import { EvidenceRunScheduler } from "./scheduler.js";
import { isInformationCategory, isLocaleSegment, listSourceRegistryEntries, selectSourceRegistryEntriesForIntent, selectSourceRegistryEntriesForUrl, summarizeSourceRegistryMatch, type SourceRegistryFilter } from "./source-registry.js";
import { describeSourceStrategy, type SourceFamily, type SourcePlatform } from "./source-strategy.js";
import { buildSourceCoverageCalibrationLoopPlan, formatSourceCoverageCalibrationLoopReport, sourceCoverageCalibrationLoopOutputPaths } from "./source-coverage-calibration-loop.js";
import { buildSourceCoverageReadinessAudit, buildSourceCoverageReadinessRetryPlan, checkSourceCoverageReadinessRetryPlan, filterSourceCoverageReadinessRetryPlan, filterSourceCoverageReadinessRetryPlanByCheck, formatSourceCoverageReadinessRetryCommandsAsLines, formatSourceCoverageReadinessRetryPlanCommandsAsLines, formatSourceCoverageReadinessRetryPlanMarkdown, formatSourceCoverageReadinessTargetsAsLines, parseSourceCoverageReadinessRetryPlan, type SourceCoverageReadinessRetryPlanCheckOptions, type SourceCoverageReadinessRetryPlanCommandFormat, type SourceCoverageReadinessRetryPriority } from "./source-coverage-readiness.js";
import { describeSourceNavigationPlan } from "./source-navigation.js";
import { describeSourceNavigationRecipePlan, summarizeSourceNavigationRecipePlan } from "./source-navigation-recipes.js";
import { calibrateSourceNavigationRecipePlan, writeSourceNavigationCalibrationArtifact } from "./source-navigation-calibration.js";
import { buildSourceNavigationCalibrationBatchManifest, expandSourceNavigationCalibrationBatchAttempts, parseSourceNavigationCalibrationBatchManifest, parseSourceNavigationCalibrationBatchTargets, runSourceNavigationCalibrationBatchAttempts, type SourceNavigationCalibrationBatchAttempt, type SourceNavigationCalibrationBatchAttemptResult, type SourceNavigationCalibrationBatchTarget, type SourceNavigationCalibrationRuntime } from "./source-navigation-calibration-batch.js";
import { loadSourceNavigationCalibrationReports, type SourceNavigationCalibrationReportLoadResult } from "./source-navigation-calibration-loader.js";
import { buildSourceNavigationCalibrationTargetPlan, formatSourceNavigationCalibrationTargetsAsLines } from "./source-navigation-calibration-targets.js";
import { parseSourceNavigationPromotionSummary, promoteSourceNavigationCalibrationBatch, reviewSourceNavigationPromotion, type SourceNavigationPromotionEvidenceRunOptions } from "./source-navigation-promotion.js";
import { applySourceNavigationSelectorHintsToRecipePlan, buildSourceNavigationRecipeCatalog, exportMaintainedSourceNavigationRecipes, formatSourceNavigationDestinationSelectorHintsAsLines, parseSourceNavigationDestinationSelectorHintsAsLines, type SourceNavigationDestinationSelectorHintLine } from "./source-navigation-recipe-catalog.js";
import { SourceNavigationExecutableActionSchema, type SourceNavigationExecutableActionInput } from "./schemas.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";

  if (command === "serve") {
    await runStdioServer();
    return;
  }

  if (command === "serve-http") {
    await runHttpServerCommand();
    return;
  }

  if (command === "smoke") {
    await runSmoke();
    return;
  }

  if (command === "smoke-web") {
    await runWebSmoke();
    return;
  }

  if (command === "smoke-media") {
    await runMediaSmoke();
    return;
  }

  if (command === "smoke-proxy") {
    await runProxySmoke();
    return;
  }

  if (command === "claim-gate") {
    await runClaimGateCommand();
    return;
  }

  if (command === "html-preview") {
    await runHtmlPreviewCommand();
    return;
  }

  if (command === "critique-status" || command === "critique-next") {
    await runCritiqueNextCommand();
    return;
  }

  if (command === "critique-complete") {
    await runCritiqueCompleteCommand();
    return;
  }

  if (command === "platform-capabilities") {
    await runPlatformCapabilitiesCommand();
    return;
  }

  if (command === "official-api-readiness") {
    await runOfficialApiReadinessCommand();
    return;
  }

  if (command === "source-registry") {
    await runSourceRegistryCommand();
    return;
  }

  if (command === "source-coverage-readiness") {
    await runSourceCoverageReadinessCommand();
    return;
  }

  if (command === "source-coverage-calibrate") {
    await runSourceCoverageCalibrateCommand();
    return;
  }

  if (command === "source-coverage-retry-plan") {
    await runSourceCoverageRetryPlanCommand();
    return;
  }

  if (command === "destination-recovery-plan") {
    await runDestinationRecoveryPlanCommand();
    return;
  }

  if (command === "source-navigation-recipes") {
    await runSourceNavigationRecipesCommand();
    return;
  }

  if (command === "source-navigation-calibrate") {
    await runSourceNavigationCalibrateCommand();
    return;
  }

  if (command === "source-navigation-calibrate-batch") {
    await runSourceNavigationCalibrateBatchCommand();
    return;
  }

  if (command === "source-navigation-calibration-targets") {
    await runSourceNavigationCalibrationTargetsCommand();
    return;
  }

  if (command === "source-navigation-catalog") {
    await runSourceNavigationCatalogCommand();
    return;
  }

  if (command === "source-navigation-export-recipes") {
    await runSourceNavigationExportRecipesCommand();
    return;
  }

  if (command === "source-navigation-promote-batch") {
    await runSourceNavigationPromoteBatchCommand();
    return;
  }

  if (command === "source-navigation-promotion-review") {
    await runSourceNavigationPromotionReviewCommand();
    return;
  }

  if (command === "evidence-run") {
    await runEvidenceRunCommand();
    return;
  }

  if (command === "auth-login") {
    await runAuthLogin();
    return;
  }

  if (command === "auth-cdp-launch") {
    await runAuthCdpLaunch();
    return;
  }

  if (command === "auth-cdp-import") {
    await runAuthCdpImport();
    return;
  }

  if (command === "profile-list") {
    console.log(JSON.stringify({ ok: true, profiles: await listProfiles() }, null, 2));
    return;
  }

  if (command === "profile-remove") {
    const profileName = getArgValue("--profile");
    if (!profileName) {
      throw new Error("profile-remove requires --profile <name>");
    }
    console.log(JSON.stringify(await removeProfile(profileName), null, 2));
    return;
  }

  if (command === "register-codex") {
    console.log(JSON.stringify(await registerCodex(), null, 2));
    return;
  }

  if (command === "register-claude") {
    console.log(JSON.stringify(await registerClaude(), null, 2));
    return;
  }

  if (command === "register-all") {
    console.log(JSON.stringify({ ok: true, results: await registerAll() }, null, 2));
    return;
  }

  printHelp();
}

async function runAuthLogin(): Promise<void> {
  const url = getArgValue("--url");
  const profileName = getArgValue("--profile");
  if (!url || !profileName) {
    throw new Error("auth-login requires --profile <name> --url <url>");
  }

  const waitMs = Number(getArgValue("--wait-ms") ?? "120000");
  const runDir = getArgValue("--run-dir") ?? await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-auth-"));
  const profileMode = hasFlag("--persistent-profile") ? "persistent-profile" : "storage-state";
  const browserChannel = browserChannelFromArgs();
  const paths = profilePaths(profileName);
  const leaseManager = new LeaseManager();
  const service = new FarmService(leaseManager, new BrowserPool(leaseManager, {
    launchHeadless: false,
    ...(browserChannel === undefined ? {} : { browserChannel })
  }));
  const agentId = "auth-login";
  const lease = service.acquireContext({
    agentId,
    runId: "auth-login",
    artifactRunDir: runDir,
    allowedDomains: [new URL(url).hostname],
    maxPages: 1,
    ttlMs: Math.max(waitMs + 30_000, 60_000),
    capability: "read-write",
    storagePolicy: profileMode,
    profileName,
    storageStatePath: paths.storageStatePath,
    userDataDir: paths.userDataDir
  }).lease;

  try {
    const page = await service.openPage({ agentId, contextToken: lease.contextToken, url });
    console.error(`Login window opened for ${url}. Finish login/consent popups, then press Enter here to save profile '${profileName}'.`);
    console.error(`If no input is received, profile will be saved after ${waitMs}ms. Mode: ${profileMode}. Browser channel: ${browserChannel ?? "chromium"}`);
    await waitForEnterOrTimeout(waitMs);
    await service.capture({ agentId, contextToken: lease.contextToken, pageId: page.page.pageId, captureId: `auth-login-${sanitizeArg(profileName)}` });
    await service.releaseContext({ agentId, contextToken: lease.contextToken });
    console.log(JSON.stringify({ ok: true, runDir, profileName, profileMode, browserChannel: browserChannel ?? "chromium", storageStatePath: paths.storageStatePath, userDataDir: paths.userDataDir }, null, 2));
  } finally {
    await service.shutdown();
  }
}

async function runAuthCdpImport(): Promise<void> {
  const profileName = getArgValue("--profile");
  if (!profileName) {
    throw new Error("auth-cdp-import requires --profile <name>");
  }
  const cdpUrl = getArgValue("--cdp-url") ?? "http://127.0.0.1:9222";
  const url = getArgValue("--url");
  const waitMs = Number(getArgValue("--wait-ms") ?? "120000");
  const cookieDomains = getArgValue("--cookie-domains") === undefined ? [] : splitCommaArg(getArgValue("--cookie-domains") ?? "");
  const paths = profilePaths(profileName);
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0] ?? await browser.newContext();
    if (url !== undefined) {
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    }
    console.error(`Connected to Chrome over CDP at ${cdpUrl}. Finish login in that Chrome window, then press Enter here to save profile '${profileName}'.`);
    console.error(`If no input is received, profile will be saved after ${waitMs}ms. This saves cookies/storage state, not passwords.`);
    if (!hasFlag("--save-now") && waitMs > 0) {
      await waitForEnterOrTimeout(waitMs);
    }
    await mkdir(dirname(paths.storageStatePath), { recursive: true });
    const storageState = await context.storageState({ indexedDB: true });
    const filteredStorageState = filterStorageState(storageState, cookieDomains);
    await writeFile(paths.storageStatePath, `${JSON.stringify(filteredStorageState, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      ok: true,
      profileName,
      cdpUrl,
      storageStatePath: paths.storageStatePath,
      userDataDir: paths.userDataDir,
      cookieDomains,
      cookiesSaved: filteredStorageState.cookies.length,
      originsSaved: filteredStorageState.origins.length,
      note: "Saved browser storage state from the attached Chrome session; no password values were read or stored."
    }, null, 2));
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function runAuthCdpLaunch(): Promise<void> {
  const profileName = getArgValue("--profile");
  if (!profileName) {
    throw new Error("auth-cdp-launch requires --profile <name>");
  }
  const port = parsePositiveIntegerArg("--port", 9222);
  const url = getArgValue("--url") ?? "https://accounts.google.com/";
  const chromePath = resolveChromePath(getArgValue("--chrome-path"));
  const paths = profilePaths(profileName);
  await mkdir(paths.userDataDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${paths.userDataDir}`,
    url
  ];
  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  console.log(JSON.stringify({
    ok: true,
    profileName,
    cdpUrl: `http://127.0.0.1:${port}`,
    chromePath,
    userDataDir: paths.userDataDir,
    storageStatePath: paths.storageStatePath,
    url,
    importCommand: `node .\\dist\\cli.js auth-cdp-import --profile ${quoteCliValue(profileName)} --cdp-url http://127.0.0.1:${port}`,
    warning: "Remote debugging exposes this Chrome profile to local processes while the browser is running; close the window after importing the profile."
  }, null, 2));
}

async function runHttpServerCommand(): Promise<void> {
  const port = Number(getArgValue("--port") ?? "9876");
  const host = getArgValue("--host") ?? "127.0.0.1";
  const concurrency = parsePositiveIntegerArg("--concurrency", 1);
  const maxTerminalJobs = parseNonNegativeIntegerArg("--max-terminal-jobs", 500);
  const scheduler = new EvidenceRunScheduler({ concurrency, maxTerminalJobs });
  const server = createHttpServer({ scheduler });
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const onError = (error: NodeJS.ErrnoException): void => rejectPromise(error);
      server.once("error", onError);
      server.listen(port, host, () => {
        server.removeListener("error", onError);
        resolvePromise();
      });
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`Port ${port} on ${host} is already in use. Use --port <n>, or reuse the farm already running there.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  console.error(`browser-agent-mcp-farm HTTP server listening on http://${host}:${port} concurrency=${concurrency} maxTerminalJobs=${maxTerminalJobs}`);
}

async function runProxySmoke(): Promise<void> {
  const runDir = getArgValue("--run-dir") ?? await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-proxy-"));
  const proxy = await startProxyFixtureServer();
  const leaseManager = new LeaseManager();
  const service = new FarmService(leaseManager);
  const agentId = "proxy-smoke-agent";
  const url = "http://proxy-smoke.test/proxy-smoke";

  try {
    const lease = service.acquireContext({
      agentId,
      runId: "smoke-proxy",
      artifactRunDir: runDir,
      allowedDomains: ["proxy-smoke.test"],
      maxPages: 1,
      ttlMs: 60_000,
      proxy: { server: proxy.proxyUrl }
    }).lease;
    const page = await service.openPage({ agentId, contextToken: lease.contextToken, url });
    const capture = await service.capture({ agentId, contextToken: lease.contextToken, pageId: page.page.pageId, captureId: "proxy-smoke" });
    await service.releaseContext({ agentId, contextToken: lease.contextToken });
    const output = {
      ok: true,
      runDir,
      proxyUrl: proxy.proxyUrl,
      requestedUrls: proxy.requestedUrls,
      records: capture.records.length
    };
    await mkdir(join(runDir, "reports"), { recursive: true });
    await writeFile(join(runDir, "reports", "proxy-smoke-output.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await service.shutdown();
    await proxy.close();
  }
}

async function runWebSmoke(): Promise<void> {
  const runDir = getArgValue("--run-dir") ?? await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-web-"));
  const timeoutMs = Number(getArgValue("--timeout-ms") ?? "10000");
  const urls = [
    "https://example.com/",
    "https://www.iana.org/domains/reserved",
    "https://example.org/"
  ];
  const leaseManager = new LeaseManager();
  const service = new FarmService(leaseManager, new BrowserPool(leaseManager, { navigationTimeoutMs: timeoutMs }));
  const results = [];

  try {
    for (const [index, url] of urls.entries()) {
      const agentId = `web-smoke-agent-${index + 1}`;
      const lease = service.acquireContext({
        agentId,
        runId: "smoke-web",
        artifactRunDir: runDir,
        allowedDomains: [new URL(url).hostname],
        maxPages: 1,
        ttlMs: Math.max(timeoutMs * 3, 30_000)
      }).lease;

      try {
        const page = await service.openPage({ agentId, contextToken: lease.contextToken, url });
        const capture = await service.capture({
          agentId,
          contextToken: lease.contextToken,
          pageId: page.page.pageId,
          captureId: `web-smoke-${index + 1}`
        });
        results.push({ url, ok: true, records: capture.records.length });
      } catch (error) {
        results.push({
          url,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        await service.releaseContext({ agentId, contextToken: lease.contextToken }).catch(() => undefined);
      }
    }
  } finally {
    await service.shutdown();
  }

  const output = {
    ok: results.every((result) => result.ok),
    runDir,
    timeoutMs,
    results
  };
  await mkdir(join(runDir, "reports"), { recursive: true });
  await writeFile(join(runDir, "reports", "public-smoke-output.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

async function runHtmlPreviewCommand(): Promise<void> {
  const runDir = getArgValue("--run-dir");
  if (!runDir) {
    throw new Error("html-preview requires --run-dir <path>");
  }

  const result = await buildHtmlPreview(runDir);
  console.log(JSON.stringify(result, null, 2));
}

async function runCritiqueNextCommand(): Promise<void> {
  const result = await getNextCritiqueTask(getArgValue("--queue"));
  console.log(JSON.stringify(result, null, 2));
}

async function runCritiqueCompleteCommand(): Promise<void> {
  const taskId = getArgValue("--task-id");
  const result = await completeNextCritiqueTask(getArgValue("--queue"), taskId === undefined ? {} : { taskId });
  console.log(JSON.stringify(result, null, 2));
}

async function runPlatformCapabilitiesCommand(): Promise<void> {
  const url = getArgValue("--url");
  if (!url) {
    throw new Error("platform-capabilities requires --url <url>");
  }

  console.log(JSON.stringify(describePlatformCapabilities(url), null, 2));
}

async function runOfficialApiReadinessCommand(): Promise<void> {
  const url = getArgValue("--url");
  if (!url) {
    throw new Error("official-api-readiness requires --url <url>");
  }

  const report = buildOfficialApiReadiness({
    platformCapabilities: describePlatformCapabilities(url),
    credentials: {
      youtubeApiKeyEnv: getArgValue("--youtube-api-key-env"),
      youtubeOAuthTokenEnv: getArgValue("--youtube-oauth-token-env"),
      instagramAccessTokenEnv: getArgValue("--instagram-token-env"),
      tiktokAccessTokenEnv: getArgValue("--tiktok-token-env"),
      tiktokResearchTokenEnv: getArgValue("--tiktok-research-token-env")
    }
  });
  const ok = !hasFlag("--fail-not-ready") || report.ok;
  console.log(JSON.stringify({ ok, report }, null, 2));
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runSourceRegistryCommand(): Promise<void> {
  const url = getArgValue("--url");
  const categoryArg = getArgValue("--category");
  const localeArg = getArgValue("--locale");
  const platformArg = getArgValue("--platform");
  const sourceFamilyArg = getArgValue("--family");
  const minTierArg = getArgValue("--min-tier");

  if (url !== undefined) {
    const match = selectSourceRegistryEntriesForUrl(url);
    console.log(JSON.stringify({ ok: true, match, summary: summarizeSourceRegistryMatch(match) }, null, 2));
    return;
  }

  const filter: SourceRegistryFilter = {};
  if (categoryArg !== undefined) {
    if (!isInformationCategory(categoryArg)) {
      throw new Error(`Unknown source registry category: ${categoryArg}`);
    }
    filter.category = categoryArg;
  }
  if (localeArg !== undefined) {
    if (!isLocaleSegment(localeArg)) {
      throw new Error(`Unknown source registry locale: ${localeArg}`);
    }
    filter.locale = localeArg;
  }
  if (platformArg !== undefined) {
    filter.platform = platformArg as SourcePlatform;
  }
  if (sourceFamilyArg !== undefined) {
    filter.sourceFamily = sourceFamilyArg as SourceFamily;
  }
  if (minTierArg !== undefined) {
    const minTier = Number(minTierArg);
    if (!Number.isInteger(minTier) || minTier < 0 || minTier > 5) {
      throw new Error("--min-tier must be an integer from 0 to 5");
    }
    filter.minSupportTier = minTier as SourceRegistryFilter["minSupportTier"];
  }

  const entries = listSourceRegistryEntries(filter);
  const match = categoryArg === undefined && localeArg === undefined && minTierArg === undefined
    ? undefined
    : selectSourceRegistryEntriesForIntent({
      category: filter.category,
      locale: filter.locale,
      minSupportTier: filter.minSupportTier
    });

  console.log(JSON.stringify({
    ok: true,
    filter,
    entries,
    ...(match === undefined ? {} : { summary: summarizeSourceRegistryMatch({ ...match, entries }) })
  }, null, 2));
}

async function runSourceCoverageReadinessCommand(): Promise<void> {
  const categoryArg = getArgValue("--category");
  const localeArg = getArgValue("--locale");
  const platformArg = getArgValue("--platform");
  const sourceFamilyArg = getArgValue("--family");
  const minTierArg = getArgValue("--min-tier");
  const topRankArg = getArgValue("--top-rank");
  const category = categoryArg === undefined ? undefined : parseInformationCategoryArg(categoryArg);
  const locale = localeArg === undefined ? undefined : parseLocaleSegmentArg(localeArg);
  const minSupportTier = minTierArg === undefined ? undefined : parseSupportTierArg(minTierArg);
  const promotionSummaries = await loadPromotionSummariesFromArgs();
  const audit = buildSourceCoverageReadinessAudit({
    category,
    locale,
    platform: platformArg as SourcePlatform | undefined,
    sourceFamily: sourceFamilyArg as SourceFamily | undefined,
    minSupportTier,
    topRankMax: topRankArg === undefined ? undefined : Number(topRankArg),
    query: getArgValue("--query"),
    promotionSummaries
  });
  const ok = !hasFlag("--fail-not-ready") || audit.ok;
  const format = getArgValue("--format") ?? "json";
  if (format === "json") {
    console.log(JSON.stringify({ ok, audit }, null, 2));
  } else if (format === "targets" || format === "lines") {
    process.stdout.write(formatSourceCoverageReadinessTargetsAsLines(audit));
  } else if (format === "retry-commands") {
    process.stdout.write(formatSourceCoverageReadinessRetryCommandsAsLines(audit));
  } else if (format === "retry-plan") {
    const retryPlan = buildSourceCoverageReadinessRetryPlan(audit);
    process.stdout.write(formatSourceCoverageReadinessRetryPlanMarkdown(
      retryPlan,
      checkSourceCoverageReadinessRetryPlan(retryPlan, sourceCoverageRetryPlanCheckOptionsFromArgs())
    ));
  } else {
    throw new Error("--format must be json, lines, targets, retry-commands, or retry-plan for source-coverage-readiness");
  }
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runSourceCoverageCalibrateCommand(): Promise<void> {
  const categoryArg = getArgValue("--category");
  const localeArg = getArgValue("--locale");
  const platformArg = getArgValue("--platform");
  const sourceFamilyArg = getArgValue("--family");
  const minTierArg = getArgValue("--min-tier");
  const topRankArg = getArgValue("--top-rank");
  const category = categoryArg === undefined ? undefined : parseInformationCategoryArg(categoryArg);
  const locale = localeArg === undefined ? undefined : parseLocaleSegmentArg(localeArg);
  const minSupportTier = minTierArg === undefined ? undefined : parseSupportTierArg(minTierArg);
  const promotionSummaries = await loadPromotionSummariesFromArgs();
  const runRoot = resolve(getArgValue("--run-root") ?? await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-coverage-calibration-")));
  const paths = sourceCoverageCalibrationLoopOutputPaths(runRoot);
  const outputDir = resolve(getArgValue("--output-dir") ?? paths.promotionDir);
  const promotionSummaryFile = join(outputDir, "promotion-summary.json");
  const targetFile = resolve(getArgValue("--targets-output-file") ?? paths.targetFile);
  const repeat = parsePositiveIntegerArg("--repeat", 2);
  const calibrationConcurrency = parseBoundedIntegerArg("--calibration-concurrency", 1, 1, 5);
  const calibrationRuntime = calibrationRuntimeFromArgs();
  assertCalibrationConcurrencyCompatible(calibrationConcurrency, calibrationRuntime);
  const promotionReviewEvidenceRunOptions = sourceNavigationPromotionEvidenceRunOptionsFromArgs();
  const selectorHintFiles = selectorHintFilePathsFromArgs();
  const retryPlanCheckOptions = sourceCoverageRetryPlanCheckOptionsFromArgs();
  const plan = buildSourceCoverageCalibrationLoopPlan({
    category,
    locale,
    platform: platformArg as SourcePlatform | undefined,
    sourceFamily: sourceFamilyArg as SourceFamily | undefined,
    minSupportTier,
    topRankMax: topRankArg === undefined ? undefined : Number(topRankArg),
    query: getArgValue("--query"),
    promotionSummaries,
    targetFile,
    runRoot,
    promotionDir: outputDir,
    repeat,
    calibrationConcurrency,
    calibrationRuntime,
    promotionReviewEvidenceRunOptions,
    includeSearchVariants: hasFlag("--include-search-variants"),
    selectorHintFiles
  });
  await mkdir(runRoot, { recursive: true });
  await writeJsonFile(paths.initialReadinessFile, plan.audit);
  await writeFile(targetFile, plan.targetLines, "utf8");
  await writeJsonFile(paths.planFile, plan);
  await writeCoverageRetryPlanFiles(paths, plan.audit, retryPlanCheckOptions);
  await writeFile(paths.reportFile, formatSourceCoverageCalibrationLoopReport({
    plan,
    files: paths,
    retryPlanCheckOptions
  }), "utf8");

  if (hasFlag("--plan-only") || hasFlag("--dry-run") || plan.targetCount === 0) {
    const ok = hasFlag("--fail-not-ready") ? plan.audit.ok : plan.targetCount > 0 || plan.audit.ok;
    console.log(JSON.stringify({
      ok,
      mode: "plan_only",
      runRoot,
      targetFile,
      planFile: paths.planFile,
      initialReadinessFile: paths.initialReadinessFile,
      retryPlanFile: paths.retryPlanFile,
      retryPlanJsonFile: paths.retryPlanJsonFile,
      retryPlanCheckFile: paths.retryPlanCheckFile,
      reportFile: paths.reportFile,
      plan
    }, null, 2));
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }

  const batch = await executeSourceNavigationCalibrationBatch({
    targets: plan.targets,
    repeat,
    concurrency: calibrationConcurrency,
    runRoot,
    manifestPath: paths.manifestFile,
    waitMs: parseNonNegativeIntegerArg("--wait-ms", 0),
    navigationTimeoutMs: parsePositiveIntegerArg("--timeout-ms", 15_000),
    selectorTimeoutMs: parsePositiveIntegerArg("--selector-timeout-ms", 1_000),
    selectorHintFiles,
    selectorHints: await loadSelectorHintsFromFiles(selectorHintFiles),
    headed: calibrationRuntime.headed,
    persistentProfile: calibrationRuntime.storagePolicy === "persistent-profile",
    profileName: calibrationRuntime.profileName,
    browserChannel: calibrationRuntime.browserChannel,
    stopOnError: hasFlag("--stop-on-error")
  });
  const promotion = await promoteSourceNavigationCalibrationBatch({
    manifest: batch.manifest,
    outputDir
  });
  await writeJsonFile(promotionSummaryFile, promotion);
  const promotionReview = reviewSourceNavigationPromotion(promotion, {
    evidenceRunOptions: promotionReviewEvidenceRunOptions
  });
  await writeJsonFile(paths.promotionReviewFile, promotionReview);
  const finalAudit = buildSourceCoverageReadinessAudit({
    category,
    locale,
    platform: platformArg as SourcePlatform | undefined,
    sourceFamily: sourceFamilyArg as SourceFamily | undefined,
    minSupportTier,
    topRankMax: topRankArg === undefined ? undefined : Number(topRankArg),
    query: getArgValue("--query"),
    promotionSummaries: [...promotionSummaries, promotion]
  });
  await writeJsonFile(paths.finalReadinessFile, finalAudit);
  await writeCoverageRetryPlanFiles(paths, finalAudit, retryPlanCheckOptions);
  await writeFile(paths.reportFile, formatSourceCoverageCalibrationLoopReport({
    plan,
    files: paths,
    manifest: batch.manifest,
    promotion,
    promotionReview,
    finalAudit,
    retryPlanCheckOptions
  }), "utf8");
  const ok = batch.manifest.failedCount === 0 && (!hasFlag("--fail-not-ready") || finalAudit.ok);
  console.log(JSON.stringify({
    ok,
    mode: "executed",
    runRoot,
    targetFile,
    planFile: paths.planFile,
    manifestPath: paths.manifestFile,
    promotionSummaryFile,
    promotionReviewFile: paths.promotionReviewFile,
    initialReadinessFile: paths.initialReadinessFile,
    finalReadinessFile: paths.finalReadinessFile,
    retryPlanFile: paths.retryPlanFile,
    retryPlanJsonFile: paths.retryPlanJsonFile,
    retryPlanCheckFile: paths.retryPlanCheckFile,
    reportFile: paths.reportFile,
    initialAudit: plan.audit,
    manifest: batch.manifest,
    promotion,
    promotionReview,
    finalAudit
  }, null, 2));
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runSourceCoverageRetryPlanCommand(): Promise<void> {
  const retryPlanPath = getArgValue("--retry-plan") ?? getArgValue("--file");
  if (retryPlanPath === undefined) {
    throw new Error("source-coverage-retry-plan requires --retry-plan <profile-headed-retry-plan.json>");
  }
  let plan = filterSourceCoverageReadinessRetryPlan(
    parseSourceCoverageReadinessRetryPlan(await readFile(retryPlanPath, "utf8")),
    {
      platform: getArgValue("--platform") as SourcePlatform | undefined,
      priority: retryPlanPriorityFromArgs(),
      limit: getArgValue("--limit") === undefined ? undefined : parseBoundedIntegerArg("--limit", 1, 1, 1000)
    }
  );
  const format = getArgValue("--format") ?? "json";
  const checkOptions = sourceCoverageRetryPlanCheckOptionsFromArgs();
  if (hasFlag("--only-check-ok")) {
    plan = filterSourceCoverageReadinessRetryPlanByCheck(plan, checkOptions);
  }
  const output = renderSourceCoverageRetryPlanOutput(plan, format, checkOptions);
  const outputFile = getArgValue("--output-file");
  if (outputFile !== undefined) {
    await writeFile(resolve(outputFile), output, "utf8");
  } else {
    process.stdout.write(output);
  }
  if (hasFlag("--fail-empty") && plan.itemCount === 0) {
    process.exitCode = 1;
  }
  if (hasFlag("--fail-check") && !checkSourceCoverageReadinessRetryPlan(plan, checkOptions).ok) {
    process.exitCode = 1;
  }
}

function renderSourceCoverageRetryPlanOutput(
  plan: ReturnType<typeof parseSourceCoverageReadinessRetryPlan>,
  format: string,
  checkOptions: SourceCoverageReadinessRetryPlanCheckOptions = {}
): string {
  if (format === "json") {
    return `${JSON.stringify({ ok: true, retryPlan: plan }, null, 2)}\n`;
  }
  if (format === "check") {
    const check = checkSourceCoverageReadinessRetryPlan(plan, checkOptions);
    return `${JSON.stringify({ ok: check.ok, check }, null, 2)}\n`;
  }
  if (format === "markdown") {
    return formatSourceCoverageReadinessRetryPlanMarkdown(plan, checkSourceCoverageReadinessRetryPlan(plan, checkOptions));
  }
  if (isRetryPlanCommandFormat(format)) {
    return formatSourceCoverageReadinessRetryPlanCommandsAsLines(plan, format);
  }
  throw new Error("--format must be json, check, markdown, commands, setup-commands, or retry-commands for source-coverage-retry-plan");
}

function sourceCoverageRetryPlanCheckOptionsFromArgs(): SourceCoverageReadinessRetryPlanCheckOptions {
  const options: SourceCoverageReadinessRetryPlanCheckOptions = {};
  if (hasFlag("--check-files")) {
    options.selectorHintFileExists = (filePath: string) => existsSync(filePath);
  }
  if (hasFlag("--check-profiles")) {
    options.profileExists = (profileName: string) => savedBrowserProfileExists(profileName);
  }
  return options;
}

function savedBrowserProfileExists(profileName: string): boolean {
  const paths = profilePaths(profileName);
  return existsSync(paths.storageStatePath) || existsSync(paths.userDataDir);
}

function isRetryPlanCommandFormat(value: string): value is SourceCoverageReadinessRetryPlanCommandFormat {
  return value === "commands" || value === "setup-commands" || value === "retry-commands";
}

async function runDestinationRecoveryPlanCommand(): Promise<void> {
  const runDir = getArgValue("--run-dir");
  if (runDir === undefined) {
    throw new Error("destination-recovery-plan requires --run-dir <evidence-run-dir>");
  }
  let plan = await buildDestinationRecoveryPlanFromRunDir(runDir);
  const format = getArgValue("--format") ?? "json";
  const checkOptions = destinationRecoveryPlanCheckOptionsFromArgs();
  if (hasFlag("--only-check-ok")) {
    plan = filterDestinationRecoveryPlanByCheck(plan, checkOptions);
  }
  const output = renderDestinationRecoveryPlanOutput(plan, format, checkOptions);
  const outputFile = getArgValue("--output-file");
  if (outputFile !== undefined) {
    await writeFile(resolve(outputFile), output, "utf8");
  } else {
    process.stdout.write(output);
  }
  if (hasFlag("--fail-empty") && plan.itemCount === 0) {
    process.exitCode = 1;
  }
  if (hasFlag("--fail-check") && !checkDestinationRecoveryPlan(plan, checkOptions).ok) {
    process.exitCode = 1;
  }
}

function renderDestinationRecoveryPlanOutput(
  plan: Awaited<ReturnType<typeof buildDestinationRecoveryPlanFromRunDir>>,
  format: string,
  checkOptions: DestinationRecoveryPlanCheckOptions = {}
): string {
  if (format === "json") {
    return `${JSON.stringify({ ok: true, recoveryPlan: plan }, null, 2)}\n`;
  }
  if (format === "check") {
    const check = checkDestinationRecoveryPlan(plan, checkOptions);
    return `${JSON.stringify({ ok: check.ok, check }, null, 2)}\n`;
  }
  if (format === "markdown") {
    return formatDestinationRecoveryPlanMarkdown(plan, checkDestinationRecoveryPlan(plan, checkOptions));
  }
  if (isDestinationRecoveryPlanCommandFormat(format)) {
    return formatDestinationRecoveryPlanCommandsAsLines(plan, format);
  }
  throw new Error("--format must be json, check, markdown, commands, setup-commands, or retry-commands for destination-recovery-plan");
}

function isDestinationRecoveryPlanCommandFormat(value: string): value is DestinationRecoveryPlanCommandFormat {
  return value === "commands" || value === "setup-commands" || value === "retry-commands";
}

function destinationRecoveryPlanCheckOptionsFromArgs(): DestinationRecoveryPlanCheckOptions {
  const options: DestinationRecoveryPlanCheckOptions = {};
  if (hasFlag("--check-profiles")) {
    options.profileExists = (profileName: string) => savedBrowserProfileExists(profileName);
  }
  return options;
}

function retryPlanPriorityFromArgs(): SourceCoverageReadinessRetryPriority | undefined {
  const priority = getArgValue("--priority");
  if (priority === undefined) {
    return undefined;
  }
  if (priority !== "top_slot_blocked" && priority !== "blocked") {
    throw new Error("--priority must be top_slot_blocked or blocked for source-coverage-retry-plan");
  }
  return priority;
}

async function writeCoverageRetryPlanFiles(
  paths: ReturnType<typeof sourceCoverageCalibrationLoopOutputPaths>,
  audit: ReturnType<typeof buildSourceCoverageReadinessAudit>,
  checkOptions: SourceCoverageReadinessRetryPlanCheckOptions = {}
): Promise<void> {
  const retryPlan = buildSourceCoverageReadinessRetryPlan(audit);
  const retryPlanCheck = checkSourceCoverageReadinessRetryPlan(retryPlan, checkOptions);
  await writeFile(paths.retryPlanFile, formatSourceCoverageReadinessRetryPlanMarkdown(retryPlan, retryPlanCheck), "utf8");
  await writeJsonFile(paths.retryPlanJsonFile, retryPlan);
  await writeJsonFile(paths.retryPlanCheckFile, retryPlanCheck);
}

async function runSourceNavigationRecipesCommand(): Promise<void> {
  const url = getArgValue("--url");
  if (!url) {
    throw new Error("source-navigation-recipes requires --url <url>");
  }
  const sourceStrategy = describeSourceStrategy(url);
  const sourceNavigationPlan = describeSourceNavigationPlan({ sourceStrategy });
  const recipePlan = describeSourceNavigationRecipePlan(sourceNavigationPlan);
  console.log(JSON.stringify({
    ok: true,
    sourceStrategy: {
      platform: sourceStrategy.platform,
      family: sourceStrategy.sourceFamily
    },
    summary: summarizeSourceNavigationRecipePlan(recipePlan),
    recipePlan
  }, null, 2));
}

async function runSourceNavigationCalibrateCommand(): Promise<void> {
  const url = getArgValue("--url");
  if (!url) {
    throw new Error("source-navigation-calibrate requires --url <url>");
  }
  const runDir = getArgValue("--run-dir") ?? await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-calibrate-"));
  const result = await runSourceNavigationCalibration({
    url,
    runDir,
    waitMs: parseNonNegativeIntegerArg("--wait-ms", 0),
    navigationTimeoutMs: parsePositiveIntegerArg("--timeout-ms", 15_000),
    selectorTimeoutMs: parsePositiveIntegerArg("--selector-timeout-ms", 1_000),
    selectorHints: await loadSelectorHintsFromArgs(),
    headed: hasFlag("--headed"),
    persistentProfile: hasFlag("--persistent-profile"),
    profileName: getArgValue("--profile"),
    browserChannel: browserChannelFromArgs()
  });
  console.log(JSON.stringify({
    ok: true,
    runDir,
    sourceStrategy: result.sourceStrategy,
    recipeSummary: result.recipeSummary,
    calibrationSummary: result.report.summary,
    artifacts: result.artifacts,
    report: result.report
  }, null, 2));
}

async function runSourceNavigationCalibrateBatchCommand(): Promise<void> {
  const urlsFile = getArgValue("--urls-file") ?? getArgValue("--targets-file");
  if (!urlsFile) {
    throw new Error("source-navigation-calibrate-batch requires --urls-file <path>");
  }
  const targets = parseSourceNavigationCalibrationBatchTargets(await readFile(urlsFile, "utf8"));
  const repeat = parsePositiveIntegerArg("--repeat", 1);
  const calibrationConcurrency = parseBoundedIntegerArg("--calibration-concurrency", 1, 1, 5);
  const runRoot = resolve(getArgValue("--run-root") ?? await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-calibration-batch-")));
  const manifestPath = join(runRoot, "calibration-batch-manifest.json");
  const calibrationRuntime = calibrationRuntimeFromArgs();
  const selectorHintFiles = selectorHintFilePathsFromArgs();
  assertCalibrationConcurrencyCompatible(calibrationConcurrency, calibrationRuntime);
  const batch = await executeSourceNavigationCalibrationBatch({
    targets,
    repeat,
    concurrency: calibrationConcurrency,
    runRoot,
    manifestPath,
    waitMs: parseNonNegativeIntegerArg("--wait-ms", 0),
    navigationTimeoutMs: parsePositiveIntegerArg("--timeout-ms", 15_000),
    selectorTimeoutMs: parsePositiveIntegerArg("--selector-timeout-ms", 1_000),
    selectorHintFiles,
    selectorHints: await loadSelectorHintsFromFiles(selectorHintFiles),
    headed: calibrationRuntime.headed,
    persistentProfile: calibrationRuntime.storagePolicy === "persistent-profile",
    profileName: calibrationRuntime.profileName,
    browserChannel: calibrationRuntime.browserChannel,
    stopOnError: hasFlag("--stop-on-error")
  });
  console.log(JSON.stringify({
    ok: batch.manifest.failedCount === 0,
    runRoot,
    manifestPath,
    manifest: batch.manifest
  }, null, 2));
}

async function executeSourceNavigationCalibrationBatch(input: {
  targets: SourceNavigationCalibrationBatchTarget[];
  repeat: number;
  concurrency: number;
  runRoot: string;
  manifestPath: string;
  waitMs: number;
  navigationTimeoutMs: number;
  selectorTimeoutMs: number;
  selectorHintFiles: string[];
  selectorHints: SourceNavigationDestinationSelectorHintLine[];
  headed: boolean;
  persistentProfile: boolean;
  profileName?: string | undefined;
  browserChannel?: string | undefined;
  stopOnError: boolean;
}): Promise<{
  manifestPath: string;
  manifest: ReturnType<typeof buildSourceNavigationCalibrationBatchManifest>;
  results: SourceNavigationCalibrationBatchAttemptResult[];
}> {
  const attempts = expandSourceNavigationCalibrationBatchAttempts({ targets: input.targets, repeat: input.repeat });
  await mkdir(input.runRoot, { recursive: true });
  const results = await runSourceNavigationCalibrationBatchAttempts({
    attempts,
    concurrency: input.concurrency,
    stopOnError: input.stopOnError,
    runAttempt: (attempt) => runSourceNavigationCalibrationBatchAttempt(input, attempt),
    onProgress: (progressResults) => writeSourceNavigationCalibrationBatchManifest(
      input.manifestPath,
      input.runRoot,
      input.targets,
      input.repeat,
      input.concurrency,
      progressResults,
      calibrationRuntimeFromBatchInput(input),
      input.selectorHintFiles
    )
  });

  return {
    manifestPath: input.manifestPath,
    manifest: buildSourceNavigationCalibrationBatchManifest({
      runRoot: input.runRoot,
      targets: input.targets,
      repeat: input.repeat,
      concurrency: input.concurrency,
      attempts: results,
      runtime: calibrationRuntimeFromBatchInput(input),
      selectorHintFiles: input.selectorHintFiles
    }),
    results
  };
}

async function runSourceNavigationCalibrationBatchAttempt(
  input: {
    runRoot: string;
    waitMs: number;
    navigationTimeoutMs: number;
    selectorTimeoutMs: number;
    selectorHints: SourceNavigationDestinationSelectorHintLine[];
    headed: boolean;
    persistentProfile: boolean;
    profileName?: string | undefined;
    browserChannel?: string | undefined;
  },
  attempt: SourceNavigationCalibrationBatchAttempt
): Promise<SourceNavigationCalibrationBatchAttemptResult> {
  const runDir = join(input.runRoot, attempt.runDirName);
  try {
    const result = await runSourceNavigationCalibration({
      url: attempt.url,
      runDir,
      waitMs: input.waitMs,
      navigationTimeoutMs: input.navigationTimeoutMs,
      selectorTimeoutMs: input.selectorTimeoutMs,
      selectorHints: input.selectorHints,
      headed: input.headed,
      persistentProfile: input.persistentProfile,
      profileName: input.profileName,
      browserChannel: input.browserChannel
    });
    return {
      ...attempt,
      runDir,
      status: "succeeded",
      platform: result.sourceStrategy.platform,
      sourceFamily: result.sourceStrategy.family,
      calibrationSummary: result.report.summary,
      calibrationArtifactPaths: result.calibrationArtifactPaths
    };
  } catch (error) {
    return {
      ...attempt,
      runDir,
      status: "failed",
      calibrationArtifactPaths: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runSourceNavigationCalibrationTargetsCommand(): Promise<void> {
  const categoryArg = getArgValue("--category");
  const localeArg = getArgValue("--locale");
  const platformArg = getArgValue("--platform");
  const sourceFamilyArg = getArgValue("--family");
  const minTierArg = getArgValue("--min-tier");
  const limitArg = getArgValue("--limit");
  const formatArg = getArgValue("--format") ?? "json";

  if (categoryArg !== undefined && !isInformationCategory(categoryArg)) {
    throw new Error(`Unknown source registry category: ${categoryArg}`);
  }
  if (localeArg !== undefined && !isLocaleSegment(localeArg)) {
    throw new Error(`Unknown source registry locale: ${localeArg}`);
  }
  const minTier = minTierArg === undefined ? undefined : Number(minTierArg);
  if (minTier !== undefined && (!Number.isInteger(minTier) || minTier < 0 || minTier > 5)) {
    throw new Error("--min-tier must be an integer from 0 to 5");
  }
  const limit = limitArg === undefined ? undefined : Number(limitArg);
  const plan = buildSourceNavigationCalibrationTargetPlan({
    ...(categoryArg === undefined ? {} : { category: categoryArg }),
    ...(localeArg === undefined ? {} : { locale: localeArg }),
    ...(platformArg === undefined ? {} : { platform: platformArg as SourcePlatform }),
    ...(sourceFamilyArg === undefined ? {} : { sourceFamily: sourceFamilyArg as SourceFamily }),
    ...(minTier === undefined ? {} : { minSupportTier: minTier as SourceRegistryFilter["minSupportTier"] }),
    ...(getArgValue("--query") === undefined ? {} : { query: getArgValue("--query") }),
    ...(limit === undefined ? {} : { limit }),
    includeSearchVariants: hasFlag("--include-search-variants")
  });

  if (formatArg !== "json" && formatArg !== "lines") {
    throw new Error("--format must be json or lines");
  }
  if (formatArg === "lines") {
    process.stdout.write(formatSourceNavigationCalibrationTargetsAsLines(plan));
    return;
  }
  console.log(JSON.stringify({ ok: true, plan }, null, 2));
}

interface SourceNavigationCalibrationCliResult {
  runDir: string;
  sourceStrategy: {
    platform: SourcePlatform;
    family: SourceFamily;
  };
  recipeSummary: ReturnType<typeof summarizeSourceNavigationRecipePlan>;
  artifacts: {
    pageCapture: number;
    calibration: number;
  };
  calibrationArtifactPaths: string[];
  report: Awaited<ReturnType<typeof calibrateSourceNavigationRecipePlan>>;
}

async function runSourceNavigationCalibration(input: {
  url: string;
  runDir: string;
  waitMs: number;
  navigationTimeoutMs: number;
  selectorTimeoutMs: number;
  selectorHints: SourceNavigationDestinationSelectorHintLine[];
  headed: boolean;
  persistentProfile: boolean;
  profileName?: string | undefined;
  browserChannel?: string | undefined;
}): Promise<SourceNavigationCalibrationCliResult> {
  const paths = input.profileName === undefined ? undefined : profilePaths(input.profileName);
  const sourceStrategy = describeSourceStrategy(input.url);
  const sourceNavigationPlan = describeSourceNavigationPlan({ sourceStrategy });
  const recipePlan = applySourceNavigationSelectorHintsToRecipePlan(
    describeSourceNavigationRecipePlan(sourceNavigationPlan),
    input.selectorHints
  );
  const artifactWriter = new ArtifactWriter();
  const leaseManager = new LeaseManager();
  const pool = new BrowserPool(leaseManager, {
    artifactWriter,
    navigationTimeoutMs: input.navigationTimeoutMs,
    launchHeadless: !input.headed,
    ...(input.browserChannel === undefined ? {} : { browserChannel: input.browserChannel })
  });
  const agentId = "source-navigation-calibrate";
  const lease = leaseManager.acquire({
    agentId,
    runId: "source-navigation-calibration",
    artifactRunDir: input.runDir,
    allowedDomains: [new URL(input.url).hostname],
    maxPages: 1,
    ttlMs: Math.max(input.navigationTimeoutMs + input.waitMs + 30_000, 60_000),
    capability: "read-only",
    ...(input.profileName === undefined || paths === undefined
      ? {}
      : {
          storagePolicy: input.persistentProfile ? "persistent-profile" as const : "storage-state" as const,
          profileName: input.profileName,
          storageStatePath: paths.storageStatePath,
          userDataDir: paths.userDataDir
        })
  });

  try {
    const page = await pool.openPage(agentId, lease.contextToken, input.url);
    if (input.waitMs > 0) {
      await pool.waitForPage(agentId, lease.contextToken, page.pageId, input.waitMs);
    }
    const capture = await pool.capturePage(agentId, lease.contextToken, page.pageId, "source-navigation-calibration-page");
    const report = await calibrateSourceNavigationRecipePlan({
      recipePlan,
      browserPool: pool,
      agentId,
      contextToken: lease.contextToken,
      pageId: page.pageId,
      url: input.url,
      selectorTimeoutMs: input.selectorTimeoutMs
    });
    const calibrationRecords = await writeSourceNavigationCalibrationArtifact({
      artifactWriter,
      runDir: input.runDir,
      sourceUrl: input.url,
      contextToken: lease.contextToken,
      pageId: page.pageId,
      report
    });
    await pool.releaseContext(agentId, lease.contextToken);
    return {
      runDir: input.runDir,
      sourceStrategy: {
        platform: sourceStrategy.platform,
        family: sourceStrategy.sourceFamily
      },
      recipeSummary: summarizeSourceNavigationRecipePlan(recipePlan),
      artifacts: {
        pageCapture: capture.records.length,
        calibration: calibrationRecords.length
      },
      calibrationArtifactPaths: calibrationRecords.map((record) => join(input.runDir, record.path)),
      report
    };
  } finally {
    await pool.shutdown();
  }
}

async function writeSourceNavigationCalibrationBatchManifest(
  manifestPath: string,
  runRoot: string,
  targets: ReturnType<typeof parseSourceNavigationCalibrationBatchTargets>,
  repeat: number,
  concurrency: number,
  results: SourceNavigationCalibrationBatchAttemptResult[],
  runtime: SourceNavigationCalibrationRuntime,
  selectorHintFiles: string[]
): Promise<void> {
  await writeFile(manifestPath, `${JSON.stringify(buildSourceNavigationCalibrationBatchManifest({
    runRoot,
    targets,
    repeat,
    concurrency,
    attempts: results,
    runtime,
    selectorHintFiles
  }), null, 2)}\n`, "utf8");
}

function calibrationRuntimeFromArgs(): SourceNavigationCalibrationRuntime {
  const profileName = getArgValue("--profile");
  const browserChannel = browserChannelFromArgs();
  return {
    headed: hasFlag("--headed"),
    storagePolicy: profileName === undefined
      ? "ephemeral"
      : hasFlag("--persistent-profile")
        ? "persistent-profile"
        : "storage-state",
    ...(profileName === undefined ? {} : { profileName }),
    ...(browserChannel === undefined ? {} : { browserChannel })
  };
}

function assertCalibrationConcurrencyCompatible(concurrency: number, runtime: SourceNavigationCalibrationRuntime): void {
  if (concurrency > 1 && runtime.storagePolicy === "persistent-profile") {
    throw new Error("--calibration-concurrency must be 1 when --persistent-profile is used");
  }
}

function calibrationRuntimeFromBatchInput(input: {
  headed: boolean;
  persistentProfile: boolean;
  profileName?: string | undefined;
  browserChannel?: string | undefined;
}): SourceNavigationCalibrationRuntime {
  return {
    headed: input.headed,
    storagePolicy: input.profileName === undefined
      ? "ephemeral"
      : input.persistentProfile
        ? "persistent-profile"
        : "storage-state",
    ...(input.profileName === undefined ? {} : { profileName: input.profileName }),
    ...(input.browserChannel === undefined ? {} : { browserChannel: input.browserChannel })
  };
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const resolvedPath = resolve(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runSourceNavigationCatalogCommand(): Promise<void> {
  const url = getArgValue("--url");
  if (!url) {
    throw new Error("source-navigation-catalog requires --url <url>");
  }
  const format = getArgValue("--format") ?? "json";
  const sourceStrategy = describeSourceStrategy(url);
  const sourceNavigationPlan = describeSourceNavigationPlan({ sourceStrategy });
  const recipePlan = describeSourceNavigationRecipePlan(sourceNavigationPlan);
  const calibrationInputs = await loadCalibrationReportsFromArgs();
  const catalog = buildSourceNavigationRecipeCatalog({
    recipePlan,
    ...(calibrationInputs === undefined ? {} : { calibrationReports: calibrationInputs.reports })
  });
  if (format === "selector-hints") {
    process.stdout.write(formatSourceNavigationDestinationSelectorHintsAsLines(catalog));
    return;
  }
  if (format !== "json") {
    throw new Error("--format must be json or selector-hints for source-navigation-catalog");
  }
  console.log(JSON.stringify({
    ok: true,
    sourceStrategy: {
      platform: sourceStrategy.platform,
      family: sourceStrategy.sourceFamily
    },
    recipeSummary: summarizeSourceNavigationRecipePlan(recipePlan),
    ...(calibrationInputs === undefined ? {} : { calibrationInputs: summarizeCalibrationInputs(calibrationInputs) }),
    catalog
  }, null, 2));
}

async function runSourceNavigationExportRecipesCommand(): Promise<void> {
  const url = getArgValue("--url");
  if (!url) {
    throw new Error("source-navigation-export-recipes requires --url <url>");
  }
  const sourceStrategy = describeSourceStrategy(url);
  const sourceNavigationPlan = describeSourceNavigationPlan({ sourceStrategy });
  const recipePlan = describeSourceNavigationRecipePlan(sourceNavigationPlan);
  const calibrationInputs = await loadCalibrationReportsFromArgs();
  const catalog = buildSourceNavigationRecipeCatalog({
    recipePlan,
    ...(calibrationInputs === undefined ? {} : { calibrationReports: calibrationInputs.reports })
  });
  const exportBundle = exportMaintainedSourceNavigationRecipes(catalog);
  const actionsOutputFile = getArgValue("--actions-output-file");
  const exportOutputFile = getArgValue("--export-output-file");
  if (actionsOutputFile !== undefined) {
    await writeJsonFile(actionsOutputFile, exportBundle.actions);
  }
  if (exportOutputFile !== undefined) {
    await writeJsonFile(exportOutputFile, exportBundle);
  }
  const ok = !hasFlag("--fail-empty-export") || exportBundle.status !== "empty";
  console.log(JSON.stringify({
    ok,
    sourceStrategy: {
      platform: sourceStrategy.platform,
      family: sourceStrategy.sourceFamily
    },
    ...(calibrationInputs === undefined ? {} : { calibrationInputs: summarizeCalibrationInputs(calibrationInputs) }),
    catalogSummary: catalog.summary,
    outputFiles: {
      ...(actionsOutputFile === undefined ? {} : { actions: resolve(actionsOutputFile) }),
      ...(exportOutputFile === undefined ? {} : { export: resolve(exportOutputFile) })
    },
    export: exportBundle
  }, null, 2));
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runSourceNavigationPromoteBatchCommand(): Promise<void> {
  const manifestPath = getArgValue("--calibration-batch-manifest") ?? getArgValue("--manifest");
  if (manifestPath === undefined) {
    throw new Error("source-navigation-promote-batch requires --calibration-batch-manifest <path>");
  }
  const outputDir = getArgValue("--output-dir") ?? join(dirname(resolve(manifestPath)), "promotion");
  const manifest = parseSourceNavigationCalibrationBatchManifest(await readFile(manifestPath, "utf8"));
  const promotion = await promoteSourceNavigationCalibrationBatch({
    manifest,
    outputDir
  });
  const promotionPath = join(resolve(outputDir), "promotion-summary.json");
  await writeJsonFile(promotionPath, promotion);
  const ok = !hasFlag("--fail-empty-export") || promotion.emptyGroupCount === 0;
  console.log(JSON.stringify({
    ok,
    manifestPath: resolve(manifestPath),
    outputDir: promotion.outputDir,
    promotionPath,
    promotion
  }, null, 2));
  if (!ok) {
    process.exitCode = 1;
  }
}

async function runSourceNavigationPromotionReviewCommand(): Promise<void> {
  const promotionDir = getArgValue("--promotion-dir");
  const promotionSummaryPath = getArgValue("--promotion-summary")
    ?? (promotionDir === undefined ? undefined : join(resolve(promotionDir), "promotion-summary.json"));
  if (promotionSummaryPath === undefined) {
    throw new Error("source-navigation-promotion-review requires --promotion-summary <path> or --promotion-dir <path>");
  }
  const promotion = parseSourceNavigationPromotionSummary(await readFile(promotionSummaryPath, "utf8"));
  const review = reviewSourceNavigationPromotion(promotion, {
    evidenceRunOptions: sourceNavigationPromotionEvidenceRunOptionsFromArgs()
  });
  const ok = !hasFlag("--fail-no-ready") || review.readyGroupCount > 0;
  const format = getArgValue("--format") ?? "json";
  if (format === "commands") {
    if (review.readyActionFiles.length === 0) {
      console.log("# No ready source-navigation action files found.");
    } else {
      for (const readyActionFile of review.readyActionFiles) {
        console.log(readyActionFile.evidenceRun.powershellCommand);
      }
    }
  } else if (format === "json") {
    console.log(JSON.stringify({
      ok,
      promotionSummaryPath: resolve(promotionSummaryPath),
      review
    }, null, 2));
  } else {
    throw new Error("--format must be json or commands");
  }
  if (!ok) {
    process.exitCode = 1;
  }
}

function sourceNavigationPromotionEvidenceRunOptionsFromArgs(): SourceNavigationPromotionEvidenceRunOptions {
  return {
    ...optionalBoundedIntegerArg("--source-navigation-max-followups", 0, 5, "maxFollowUps"),
    ...optionalBoundedIntegerArg("--source-navigation-max-followups-per-domain", 0, 5, "maxFollowUpsPerDomain"),
    ...optionalBoundedIntegerArg("--source-navigation-followup-concurrency", 1, 5, "followUpConcurrency"),
    ...(hasFlag("--source-navigation-fallback-followups") ? { fallbackFollowUps: true } : {}),
    ...optionalBoundedIntegerArg("--source-navigation-max-fallback-followups", 0, 5, "maxFallbackFollowUps"),
    ...optionalBoundedIntegerArg("--source-navigation-max-depth", 1, 2, "maxDepth"),
    ...optionalBoundedIntegerArg("--source-navigation-max-deepening-runs", 0, 5, "maxDeepeningRuns"),
    ...optionalBoundedIntegerArg("--source-navigation-max-deepening-runs-per-domain", 0, 5, "maxDeepeningRunsPerDomain"),
    ...optionalBoundedIntegerArg("--source-navigation-deepening-concurrency", 1, 5, "deepeningConcurrency"),
    ...optionalBoundedIntegerArg("--source-navigation-deepening-timeout-ms", 1, 120_000, "deepeningTimeoutMs"),
    ...optionalBoundedIntegerArg("--source-navigation-max-deepening-artifacts", 1, 1_000, "maxDeepeningArtifacts")
  };
}

function optionalBoundedIntegerArg<K extends keyof SourceNavigationPromotionEvidenceRunOptions>(
  name: string,
  min: number,
  max: number,
  key: K
): Partial<Pick<SourceNavigationPromotionEvidenceRunOptions, K>> {
  const raw = getArgValue(name);
  if (raw === undefined) {
    return {};
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return { [key]: value } as Pick<SourceNavigationPromotionEvidenceRunOptions, K>;
}

async function runEvidenceRunCommand(): Promise<void> {
  const url = getArgValue("--url");
  if (!url) {
    throw new Error("evidence-run requires --url <url>");
  }
  const timestampsArg = getArgValue("--timestamps-sec");
  const maxFramesArg = getArgValue("--max-frames");
  const waitMsArg = getArgValue("--wait-ms");
  const navigationTimeoutArg = getArgValue("--timeout-ms");
  const seekTimeoutArg = getArgValue("--seek-timeout-ms");
  const settleMsArg = getArgValue("--settle-ms");
  const ocrMaxFramesArg = getArgValue("--ocr-max-frames");
  const ocrTimeoutArg = getArgValue("--ocr-timeout-ms");
  const ocrMinConfidenceArg = getArgValue("--ocr-min-confidence");
  const overlayMaxActionsArg = getArgValue("--overlay-dismissal-max-actions");
  const denseWindowArg = getArgValue("--dense-window-sec");
  const denseStepArg = getArgValue("--dense-step-sec");
  const denseMaxArg = getArgValue("--dense-max-frames");
  const denseSceneThresholdArg = getArgValue("--dense-scene-threshold");
  const denseSceneMaxHitsArg = getArgValue("--dense-scene-max-hits");
  const sourceNavigationActions = await parseSourceNavigationActions();
  const sourceNavigationMaxActionsArg = getArgValue("--source-navigation-max-actions");
  const sourceNavigationTimeoutArg = getArgValue("--source-navigation-timeout-ms");
  const sourceNavigationMaxFollowUpsArg = getArgValue("--source-navigation-max-followups");
  const sourceNavigationMaxFollowUpsPerDomainArg = getArgValue("--source-navigation-max-followups-per-domain");
  const sourceNavigationFollowUpConcurrencyArg = getArgValue("--source-navigation-followup-concurrency");
  const sourceNavigationMaxFallbackFollowUpsArg = getArgValue("--source-navigation-max-fallback-followups");
  const sourceNavigationMaxDepthArg = getArgValue("--source-navigation-max-depth");
  const sourceNavigationMaxDeepeningRunsArg = getArgValue("--source-navigation-max-deepening-runs");
  const sourceNavigationMaxDeepeningRunsPerDomainArg = getArgValue("--source-navigation-max-deepening-runs-per-domain");
  const sourceNavigationDeepeningConcurrencyArg = getArgValue("--source-navigation-deepening-concurrency");
  const sourceNavigationDeepeningTimeoutArg = getArgValue("--source-navigation-deepening-timeout-ms");
  const sourceNavigationMaxDeepeningArtifactsArg = getArgValue("--source-navigation-max-deepening-artifacts");
  const sourceNavigationCalibrationTimeoutArg = getArgValue("--source-navigation-calibration-timeout-ms");
  const input = await normalizeEvidenceRunInput({
    url,
    runDir: getArgValue("--run-dir"),
    captureId: getArgValue("--capture-id"),
    frameSelector: getArgValue("--frame-selector"),
    timestampsSec: timestampsArg === undefined ? undefined : parseNumberList(timestampsArg),
    maxFrames: maxFramesArg === undefined ? undefined : Number(maxFramesArg),
    waitMs: waitMsArg === undefined ? undefined : Number(waitMsArg),
    navigationTimeoutMs: navigationTimeoutArg === undefined ? undefined : Number(navigationTimeoutArg),
    seekTimeoutMs: seekTimeoutArg === undefined ? undefined : Number(seekTimeoutArg),
    settleMs: settleMsArg === undefined ? undefined : Number(settleMsArg),
    sampleFrames: !hasFlag("--no-frames"),
    finalClaimGate: !hasFlag("--no-final-gate"),
    profileName: getArgValue("--profile"),
    storagePolicy: hasFlag("--persistent-profile") ? "persistent-profile" : undefined,
    headed: hasFlag("--headed"),
    browserChannel: browserChannelFromArgs(),
    overlayDismissal: {
      enabled: !hasFlag("--no-overlay-dismissal"),
      maxActions: overlayMaxActionsArg === undefined ? 3 : Number(overlayMaxActionsArg)
    },
    ocr: {
      enabled: hasFlag("--ocr"),
      maxFrames: ocrMaxFramesArg === undefined ? 20 : Number(ocrMaxFramesArg),
      timeoutMs: ocrTimeoutArg === undefined ? 10_000 : Number(ocrTimeoutArg),
      language: getArgValue("--ocr-language") ?? "eng",
      minConfidence: ocrMinConfidenceArg === undefined ? 0 : Number(ocrMinConfidenceArg)
    },
    denseSampling: {
      enabled: hasFlag("--dense-sampling"),
      windowSec: denseWindowArg === undefined ? 5 : Number(denseWindowArg),
      stepSec: denseStepArg === undefined ? 1 : Number(denseStepArg),
      maxDenseFrames: denseMaxArg === undefined ? 40 : Number(denseMaxArg),
      sceneChange: !hasFlag("--no-dense-scene-change"),
      sceneChangeThreshold: denseSceneThresholdArg === undefined ? 16 : Number(denseSceneThresholdArg),
      sceneChangeMaxHits: denseSceneMaxHitsArg === undefined ? undefined : Number(denseSceneMaxHitsArg),
      query: getArgValue("--dense-query")
    },
    officialApi: {
      enabled: hasFlag("--official-api"),
      credentials: {
        youtubeApiKeyEnv: getArgValue("--youtube-api-key-env"),
        youtubeOAuthTokenEnv: getArgValue("--youtube-oauth-token-env"),
        instagramAccessTokenEnv: getArgValue("--instagram-token-env"),
        tiktokAccessTokenEnv: getArgValue("--tiktok-token-env"),
        tiktokResearchTokenEnv: getArgValue("--tiktok-research-token-env")
      }
    },
    sourceNavigation: {
      enabled: hasFlag("--source-navigation") || sourceNavigationActions !== undefined,
      calibrate: hasFlag("--source-navigation-calibrate"),
      calibrationSelectorTimeoutMs: sourceNavigationCalibrationTimeoutArg === undefined ? undefined : Number(sourceNavigationCalibrationTimeoutArg),
      actions: sourceNavigationActions,
      maxActions: sourceNavigationMaxActionsArg === undefined ? undefined : Number(sourceNavigationMaxActionsArg),
      perActionTimeoutMs: sourceNavigationTimeoutArg === undefined ? undefined : Number(sourceNavigationTimeoutArg),
      captureBeforeAfter: hasFlag("--no-source-navigation-captures") ? false : undefined,
      stopOnUnsupported: hasFlag("--source-navigation-continue-unsupported") ? false : undefined,
      maxFollowUps: sourceNavigationMaxFollowUpsArg === undefined ? undefined : Number(sourceNavigationMaxFollowUpsArg),
      maxFollowUpsPerDomain: sourceNavigationMaxFollowUpsPerDomainArg === undefined ? undefined : Number(sourceNavigationMaxFollowUpsPerDomainArg),
      followUpConcurrency: sourceNavigationFollowUpConcurrencyArg === undefined ? undefined : Number(sourceNavigationFollowUpConcurrencyArg),
      fallbackFollowUps: hasFlag("--source-navigation-fallback-followups") ? true : undefined,
      maxFallbackFollowUps: sourceNavigationMaxFallbackFollowUpsArg === undefined ? undefined : Number(sourceNavigationMaxFallbackFollowUpsArg),
      maxDepth: sourceNavigationMaxDepthArg === undefined ? undefined : Number(sourceNavigationMaxDepthArg),
      maxDeepeningRuns: sourceNavigationMaxDeepeningRunsArg === undefined ? undefined : Number(sourceNavigationMaxDeepeningRunsArg),
      maxDeepeningRunsPerDomain: sourceNavigationMaxDeepeningRunsPerDomainArg === undefined ? undefined : Number(sourceNavigationMaxDeepeningRunsPerDomainArg),
      deepeningConcurrency: sourceNavigationDeepeningConcurrencyArg === undefined ? undefined : Number(sourceNavigationDeepeningConcurrencyArg),
      deepeningTimeoutMs: sourceNavigationDeepeningTimeoutArg === undefined ? undefined : Number(sourceNavigationDeepeningTimeoutArg),
      maxDeepeningArtifacts: sourceNavigationMaxDeepeningArtifactsArg === undefined ? undefined : Number(sourceNavigationMaxDeepeningArtifactsArg)
    }
  });
  const result = await runEvidenceWorkflow(input);
  console.log(JSON.stringify({
    ok: result.ok,
    runDir: result.runDir,
    reportPath: result.reportPath,
    platform: result.platformCapabilities.platform,
    sourceStrategy: {
      platform: result.sourceStrategy.platform,
      family: result.sourceStrategy.sourceFamily
    },
    sourceRegistry: result.assessment.sourceRegistry,
    sourceNavigationPlan: result.assessment.sourceNavigationPlan,
    sourceNavigationExecutionPlan: result.assessment.sourceNavigationExecutionPlan,
    sourceNavigationRecipePlan: result.assessment.sourceNavigationRecipePlan,
    sourceNavigationCalibration: result.assessment.sourceNavigationCalibration,
    sourceNavigationExecution: result.assessment.sourceNavigationExecution,
    sourceNavigationFollowUps: result.assessment.sourceNavigationFollowUps,
    destinationTriage: result.assessment.destinationTriage,
    destinationDeepeningProposals: result.assessment.destinationDeepeningProposals,
    destinationDeepeningExecution: result.assessment.destinationDeepeningExecution,
    mediaId: result.platformCapabilities.mediaId,
    claims: result.claims.length,
    claimGate: result.claimGate,
    frameSampling: result.assessment.frameSampling,
    stageTimings: result.stageTimings,
    artifacts: {
      ocr: result.ocrRecords.length,
      officialApi: result.officialApiRecords.length,
      sourceStrategy: result.sourceStrategyRecords.length,
      sourceRegistry: result.sourceRegistryRecords.length,
      sourceNavigationPlan: result.sourceNavigationPlanRecords.length,
      sourceNavigationExecutionPlan: result.sourceNavigationExecutionPlanRecords.length,
      sourceNavigationRecipePlan: result.sourceNavigationRecipePlanRecords.length,
      sourceNavigationCalibration: result.sourceNavigationCalibrationRecords.length,
      sourceNavigationActions: result.sourceNavigationActionRecords.length,
      sourceNavigationFollowUps: result.sourceNavigationFollowUpRecords.length,
      destinationCandidates: result.destinationCandidateRecords.length,
      destinationTriage: result.destinationTriageRecords.length,
      destinationDeepeningProposals: result.destinationDeepeningProposalRecords.length,
      destinationDeepeningRuns: result.destinationDeepeningRunRecords.length,
      overlayDismissal: result.overlayDismissalRecords.length,
      obstruction: result.obstructionRecords.length
    }
  }, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function parseSourceNavigationActions(): Promise<SourceNavigationExecutableActionInput[] | undefined> {
  const rawJson = getArgValue("--source-navigation-actions-json");
  const filePath = getArgValue("--source-navigation-actions-file");
  if (rawJson !== undefined && filePath !== undefined) {
    throw new Error("Use only one of --source-navigation-actions-json or --source-navigation-actions-file");
  }
  const text = rawJson ?? (filePath === undefined ? undefined : await readFile(filePath, "utf8"));
  if (text === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid source navigation actions JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Source navigation actions JSON must be an array");
  }
  return parsed.map((action) => SourceNavigationExecutableActionSchema.parse(action));
}

async function runClaimGateCommand(): Promise<void> {
  const runDir = getArgValue("--run-dir");
  if (!runDir) {
    throw new Error("claim-gate requires --run-dir <path>");
  }

  const mode = getArgValue("--mode") === "final" ? "final" : "smoke";
  const minClaimsArg = getArgValue("--min-claims");
  const minClaims = minClaimsArg === undefined ? undefined : Number(minClaimsArg);
  if (minClaims !== undefined && (!Number.isInteger(minClaims) || minClaims < 0)) {
    throw new Error("claim-gate --min-claims must be a non-negative integer");
  }

  const result = await runClaimGate(runDir, minClaims === undefined ? { mode } : { mode, minClaims });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function runMediaSmoke(): Promise<void> {
  const runDir = getArgValue("--run-dir") ?? await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-media-"));
  const fixture = await startMediaFixtureServer();
  const service = new FarmService();
  const agentId = "media-smoke-agent";

  try {
    const lease = service.acquireContext({
      agentId,
      runId: "smoke-media",
      artifactRunDir: runDir,
      allowedDomains: ["127.0.0.1"],
      maxPages: 1,
      ttlMs: 120_000
    }).lease;
    const page = await service.openPage({ agentId, contextToken: lease.contextToken, url: `${fixture.baseUrl}/media` });
    await service.waitForSelector({ agentId, contextToken: lease.contextToken, pageId: page.page.pageId, selector: "#media-ready", timeoutMs: 5_000 });
    const capture = await service.captureAfterIdle({
      agentId,
      contextToken: lease.contextToken,
      pageId: page.page.pageId,
      captureId: "media-smoke",
      idleMs: 250,
      timeoutMs: 5_000
    });
    await service.releaseContext({ agentId, contextToken: lease.contextToken });
    const mediaRecords = capture.records.filter((record) => record.kind === "media");
    const output = {
      ok: mediaRecords.length >= 3,
      runDir,
      records: capture.records.length,
      mediaRecords: mediaRecords.length
    };
    await mkdir(join(runDir, "reports"), { recursive: true });
    await writeFile(join(runDir, "reports", "media-smoke-output.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(output, null, 2));
    if (!output.ok) {
      process.exitCode = 1;
    }
  } finally {
    await service.shutdown();
    await fixture.close();
  }
}

async function runSmoke(): Promise<void> {
  const runDir = getArgValue("--run-dir") ?? await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-"));
  const fixture = await startFixtureServer();
  const service = new FarmService();
  const urls = [
    `${fixture.baseUrl}/alpha`,
    `${fixture.baseUrl}/bravo`,
    `${fixture.baseUrl}/charlie`
  ];

  try {
    const captures = await Promise.all(
      urls.map(async (url, index) => {
        const agentId = `smoke-agent-${index + 1}`;
        const lease = service.acquireContext({
          agentId,
          runId: "smoke",
          artifactRunDir: runDir,
          allowedDomains: ["127.0.0.1"],
          maxPages: 1,
          ttlMs: 120_000
        }).lease;
        const page = await service.openPage({ agentId, contextToken: lease.contextToken, url });
        const capture = await service.capture({
          agentId,
          contextToken: lease.contextToken,
          pageId: page.page.pageId,
          captureId: `smoke-${index + 1}`
        });
        await service.releaseContext({ agentId, contextToken: lease.contextToken });
        return { url, records: capture.records.length };
      })
    );

    console.log(JSON.stringify({ ok: true, runDir, captures }, null, 2));
  } finally {
    await service.shutdown();
    await fixture.close();
  }
}

async function startFixtureServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
  <head><title>Farm Smoke ${escapeHtml(path)}</title></head>
  <body>
    <main>
      <h1>Farm Smoke ${escapeHtml(path)}</h1>
      <p data-path="${escapeHtml(path)}">deterministic local fixture</p>
    </main>
  </body>
</html>`);
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
    close: () => closeServer(server)
  };
}

async function startMediaFixtureServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  );
  const svg = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\" fill=\"#0f766e\"/></svg>", "utf8");
  const captions = Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nmedia smoke caption\n", "utf8");
  const fakeMp4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);

  const server = createServer((request, response) => {
    const path = request.url?.split("?", 1)[0] ?? "/";
    if (path === "/media") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <head><title>media smoke</title></head>
  <body>
    <main>
      <h1>media smoke</h1>
      <img id="png" src="/image.png" alt="png">
      <img id="svg" src="/vector.svg" alt="svg">
      <video id="clip" poster="/poster.png" preload="metadata">
        <source src="/clip.mp4" type="video/mp4">
        <track kind="captions" src="/captions.vtt" srclang="en" label="English" default>
      </video>
      <script>
        Promise.allSettled([
          fetch('/captions.vtt'),
          fetch('/clip.mp4')
        ]).then(() => {
          const ready = document.createElement('div');
          ready.id = 'media-ready';
          ready.textContent = 'ready';
          document.body.appendChild(ready);
        });
      </script>
    </main>
  </body>
</html>`);
      return;
    }
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
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Media fixture server did not bind to a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server)
  };
}

async function startProxyFixtureServer(): Promise<{ proxyUrl: string; requestedUrls: string[]; close: () => Promise<void> }> {
  const requestedUrls: string[] = [];
  const server = createServer((request, response) => {
    requestedUrls.push(request.url ?? "");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>Proxy Smoke</title></head><body><main>proxied-ok ${escapeHtml(request.url ?? "")}</main></body></html>`);
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
    close: () => closeServer(server)
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    });
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function printHelp(): void {
  console.log(`browser-agent-mcp-farm

Commands:
  serve   Start the MCP stdio server
  serve-http [--host 127.0.0.1] [--port 9876] [--concurrency 1] [--max-terminal-jobs 500]
          Start a local HTTP server with /health, /evidence-run, and /jobs endpoints
  smoke   Capture three local fixture pages in isolated contexts
  smoke-web
          Capture three public pages with strict timeout and JSON report
  smoke-media
          Verify first-class media artifact capture with a local fixture
  smoke-proxy
          Verify lease-level proxy routing through a local proxy fixture
  claim-gate --run-dir <path> [--mode smoke|final] [--min-claims <n>]
          Fail when claims cite missing or unregistered artifacts
  html-preview --run-dir <path>
          Generate html/farm-evidence-preview.html
  critique-next [--queue <path>]
          Print exactly one next media critical review task without mutating the queue
  critique-complete [--queue <path>] [--task-id <id>]
          Mark the next media critical review task done only after its output file exists
  platform-capabilities --url <url>
          Print official/browser evidence capability map for a media platform URL
  official-api-readiness --url <url> [--fail-not-ready]
          Check official API credential env references without calling provider APIs
  source-registry [--url <url>] [--category <name>] [--locale <segment>] [--platform <id>] [--family <name>] [--min-tier 0-5]
          Inspect information-source coverage registry entries and support tiers
  source-coverage-readiness [--category <name>] [--locale <segment>] [--top-rank 3] [--promotion-summary <path>] [--format json|targets|retry-commands|retry-plan]
          Audit registry source slots against promoted maintained action files for QA coverage
  source-coverage-calibrate [--category <name>] [--locale <segment>] [--run-root <path>] [--calibration-concurrency 1] [--plan-only] [--check-files] [--check-profiles]
          Generate readiness-guided targets, optionally run read-only calibration, promote, and re-audit coverage
  source-coverage-retry-plan --retry-plan <path> [--platform <id>] [--priority top_slot_blocked|blocked] [--limit <n>] [--format json|check|markdown|commands|setup-commands|retry-commands] [--output-file <path>] [--check-files] [--check-profiles] [--only-check-ok]
          Inspect or print commands from a profile-headed-retry-plan.json handoff
  destination-recovery-plan --run-dir <evidence-run-dir> [--format json|check|markdown|commands|setup-commands|retry-commands] [--output-file <path>] [--fail-empty] [--fail-check] [--check-profiles] [--only-check-ok]
          Extract blocked-child recovery advice from destination_triage artifacts
  source-navigation-recipes --url <url>
          Print manual-only selector candidates for real-site calibration
  source-navigation-calibrate --url <url> [--run-dir <path>] [--wait-ms <n>] [--selector-timeout-ms <n>]
          Open a page read-only and record which manual-only selector candidates are browser-visible
  source-navigation-calibrate-batch --urls-file <path> [--run-root <path>] [--repeat <n>] [--calibration-concurrency 1]
          Run read-only selector calibration over many URLs and write a batch manifest with catalog/export hints
  source-navigation-calibration-targets [--category <name>] [--locale <segment>] [--platform <id>] [--family <name>] [--query <text>] [--include-search-variants] [--format json|lines]
          Generate registry-backed calibration target files for source-navigation-calibrate-batch
  source-navigation-catalog --url <url> [--calibration-file <path>] [--calibration-files <a,b>] [--calibration-run-dir <path>] [--calibration-run-dirs <a,b>] [--calibration-batch-manifest <path>] [--format json|selector-hints]
          Build explicit-opt-in recipe catalog proposals from candidates and optional calibration output
  source-navigation-export-recipes --url <url> [--calibration-file <path>] [--calibration-files <a,b>] [--calibration-run-dir <path>] [--calibration-run-dirs <a,b>] [--calibration-batch-manifest <path>]
          Export maintained read-only recipe actions from repeated calibration catalog proposals
  source-navigation-promote-batch --calibration-batch-manifest <path> [--output-dir <path>]
          Build per-platform catalog/export/actions files for every group in a calibration batch manifest
  source-navigation-promotion-review --promotion-summary <path> [--format json|commands] [source-navigation budget flags]
          Review promoted action files and print evidence-run commands for ready groups.
          Optional source-navigation budget flags are copied into generated evidence-run commands.
  evidence-run --url <url> [--run-dir <path>] [--timestamps-sec 0,10]
          Capture platform/page/frame evidence, write claims/citations/report, and run final claim gate
  auth-login --profile <name> --url <url> [--wait-ms <n>]
          Open a headed browser, let the user log in, then save storage state
  auth-cdp-launch --profile <name> [--url <url>] [--port 9222] [--chrome-path <path>]
          Launch user-controlled Chrome with a local DevTools port for login import
  auth-cdp-import --profile <name> [--cdp-url http://127.0.0.1:9222] [--url <url>] [--wait-ms <n>] [--save-now] [--cookie-domains <a,b>]
          Attach to a user-controlled Chrome DevTools session and save cookies/storage state
  profile-list
          List saved browser farm profiles
  profile-remove --profile <name>
          Remove a saved browser farm profile
  register-codex | register-claude | register-all
          Register this MCP server in local agent configs

Options:
  --run-dir <path>   Write smoke artifacts into a specific evidence run
  --timeout-ms <n>   Navigation timeout for smoke-web
  --persistent-profile
          auth-login/evidence-run uses a full persistent Chromium profile instead of storage-state
  --profile <name>
          evidence-run reuses a saved profile from auth-login
  --headed
          evidence-run opens a visible Chromium window for debugging
  --browser-channel <channel>
          use an installed Playwright browser channel such as chrome or msedge for headed login/calibration/evidence runs
  --chrome
          shorthand for --browser-channel chrome
  --no-overlay-dismissal
          Disable cautious pre-capture overlay dismissal
  --overlay-dismissal-max-actions <0-10>
          Maximum ordinary overlay dismissal actions before evidence capture, default 3
  --ocr
          Run bounded OCR over sampled frame screenshots when optional tesseract.js is available
  --ocr-language <lang>
          OCR language passed to tesseract.js, default eng
  --ocr-min-confidence <0-100>
          Mark OCR text partial when reported confidence is below this threshold
  --dense-sampling
          Add bounded dense timestamp sampling around visible transcript cue, OCR text, and scene-change hits
  --dense-scene-threshold <1-64>
          Minimum 8x8 visual fingerprint hamming distance for scene-change dense sampling
  --dense-scene-max-hits <1-120>
          Maximum scene-change hit midpoints to expand before dense frame caps are applied
  --no-dense-scene-change
          Disable scene-change dense sampling while keeping transcript/OCR dense sampling
  --official-api
          Attempt credentials-gated official API metadata collection using env var references
  --source-navigation
          Execute explicit safe source-navigation recipes before final page capture
  --source-navigation-calibrate
          Probe manual-only source-navigation selector candidates read-only during evidence-run
  --source-navigation-calibration-timeout-ms <ms>
          Timeout for calibration body text reads, default 1000
  --urls-file <path>
          source-navigation-calibrate-batch target file; supports one URL per line or JSON { "targets": [...] }
  --run-root <path>
          source-navigation-calibrate-batch/source-coverage-calibrate root directory for per-target run directories and manifest
  --repeat <1-20>
          repeated read-only calibration passes per target; default 1 for calibrate-batch and 2 for coverage-calibrate
  --calibration-concurrency <1-5>
          Maximum source-navigation calibration attempts to run concurrently in batch/coverage calibration, default 1
  --selector-hints-file <path>
          source-navigation-calibrate/source-navigation-calibrate-batch/source-coverage-calibrate adds selector-hints.tsv rows as extra read-only selector candidates
  --selector-hints-files <a,b>
          Load multiple selector-hints.tsv files as extra read-only selector candidates
  --stop-on-error
          Abort source-navigation-calibrate-batch on the first failed target instead of recording the failure
  --plan-only | --dry-run
          source-coverage-calibrate writes readiness, target, and loop-plan files without opening browsers
  --retry-plan <path>
          source-coverage-retry-plan reads a generated profile-headed-retry-plan.json file
  --priority top_slot_blocked|blocked
          source-coverage-retry-plan filters generated retry-plan items by retry priority
  --targets-output-file <path>
          source-coverage-calibrate writes generated calibration target lines to this file
  --query <text>
          Calibration target query seed, default depends on locale/category
  --format json|lines|commands|targets|selector-hints
          target/readiness commands choose their output format
  --top-rank <n>
          source-coverage-readiness filters category/locale top slots, default 3 when both are supplied
  --limit <n>
          source-navigation-calibration-targets maximum generated target count
  --include-search-variants
          Expand supported search calibration targets into reviewed news/image/video/local/place/shopping vertical variants
  --calibration-batch-manifest <path>
          Load calibration run directories from a source-navigation-calibrate-batch manifest
  --calibration-batch-manifests <a,b>
          Load calibration run directories from multiple batch manifests
  --actions-output-file <path>
          source-navigation-export-recipes writes only the maintained action array for --source-navigation-actions-file
  --format selector-hints
          source-navigation-catalog prints tab-separated manual destination selector hints and scoped suggestions
  --export-output-file <path>
          source-navigation-export-recipes writes the full maintained recipe export bundle
  --output-dir <path>
          source-navigation-promote-batch/source-coverage-calibrate output directory for grouped promotion files
  --output-file <path>
          source-coverage-retry-plan writes the rendered filtered handoff to this file instead of stdout
  --promotion-summary <path>
          source-navigation-promotion-review input promotion-summary.json file
  --promotion-dir <path>
          source-navigation-promotion-review directory containing promotion-summary.json
  --promotion-summaries <a,b>
          source-coverage-readiness loads multiple promotion-summary.json files
  --promotion-dirs <a,b>
          source-coverage-readiness loads promotion-summary.json from multiple promotion directories
  --fail-empty-export
          source-navigation-export-recipes or source-navigation-promote-batch exits non-zero when no maintained actions are ready
  --fail-no-ready
          source-navigation-promotion-review exits non-zero when no ready action files are available
  --fail-empty
          source-coverage-retry-plan exits non-zero when the retry plan has no items
  --fail-check
          source-coverage-retry-plan exits non-zero when --format check finds retry command errors
  --check-files
          source-coverage-retry-plan/source-coverage-calibrate also checks selector-hints.tsv file existence during retry-plan checks
  --check-profiles
          source-coverage-retry-plan/source-coverage-calibrate also checks whether referenced saved browser profiles exist locally
  --only-check-ok
          source-coverage-retry-plan filters out retry items with check errors before rendering output
  --fail-not-ready
          source-coverage-readiness/source-coverage-calibrate exits non-zero when actionable registry slots are not ready
  --source-navigation-actions-json <json>
          JSON array of explicit action-key recipes, e.g. [{"actionKey":"bounded-scroll","operation":"scroll","direction":"bottom"}]
  --source-navigation-actions-file <path>
          Read explicit source-navigation action recipes from a JSON file
  --source-navigation-max-actions <1-50>
          Maximum planned source-navigation actions considered for execution
  --source-navigation-timeout-ms <ms>
          Per-action source-navigation timeout, default 10000
  --source-navigation-max-followups <0-5>
          Maximum explicit follow_up/extract_destinations child evidence runs, default 1
  --source-navigation-max-followups-per-domain <0-5>
          Maximum selected child evidence runs per destination domain, default min(2, max-followups)
  --source-navigation-followup-concurrency <1-5>
          Maximum selected follow-up child evidence runs to execute concurrently, default 1
  --source-navigation-fallback-followups
          After downgraded selected child evidence, run bounded lower-ranked fallback candidates explicitly
  --source-navigation-max-fallback-followups <0-5>
          Maximum fallback child evidence runs after downgrade when fallback follow-ups are enabled, default 1
  --source-navigation-max-depth <1-2>
          Maximum destination follow-up depth. Default 1 records depth-2 proposals only; 2 executes proposed deeper child evidence runs.
  --source-navigation-max-deepening-runs <0-5>
          Maximum proposed depth-2 child evidence runs when max-depth is 2, default min(1, max-followups)
  --source-navigation-max-deepening-runs-per-domain <0-5>
          Maximum proposed depth-2 child evidence runs per destination domain, default min(1, max-deepening-runs)
  --source-navigation-deepening-concurrency <1-5>
          Maximum proposed depth-2 child evidence runs to execute concurrently, default 1
  --source-navigation-deepening-timeout-ms <ms>
          Whole-run timeout for each depth-2 child evidence run, default min(parent timeout, 15000)
  --source-navigation-max-deepening-artifacts <1-1000>
          Mark depth-2 child evidence as budget-limited when its artifact count exceeds this cap, default 100
  --no-source-navigation-captures
          Disable before/after page captures around configured navigation actions
  --source-navigation-continue-unsupported
          Record unsupported navigation actions but do not treat them as terminal
`);
}

async function waitForEnterOrTimeout(waitMs: number): Promise<void> {
  if (!process.stdin.isTTY) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
    return;
  }

  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    await Promise.race([
      readline.question("Press Enter when login/consent is complete...").then(() => undefined),
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, waitMs))
    ]);
  } finally {
    readline.close();
  }
}

function sanitizeArg(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
}

type BrowserStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

function filterStorageState(state: BrowserStorageState, allowedDomains: string[]): BrowserStorageState {
  const domains = allowedDomains.map(normalizeCookieDomain).filter(Boolean);
  if (domains.length === 0) {
    return state;
  }
  return {
    ...state,
    cookies: state.cookies.filter((cookie) => domainAllowed(cookie.domain, domains)),
    origins: state.origins.filter((origin) => originAllowed(origin.origin, domains))
  };
}

function normalizeCookieDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\./, "");
}

function domainAllowed(value: string, allowedDomains: string[]): boolean {
  const domain = normalizeCookieDomain(value);
  return allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function originAllowed(origin: string, allowedDomains: string[]): boolean {
  try {
    return domainAllowed(new URL(origin).hostname, allowedDomains);
  } catch {
    return false;
  }
}

function resolveChromePath(explicitPath: string | undefined): string {
  const candidates = [
    explicitPath,
    process.env.PROGRAMFILES === undefined ? undefined : join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] === undefined ? undefined : join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA === undefined ? undefined : join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
  ].filter((item): item is string => item !== undefined && item.length > 0);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error("Chrome executable was not found. Pass --chrome-path <path>.");
  }
  return found;
}

function quoteCliValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function getArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function browserChannelFromArgs(): string | undefined {
  const channel = getArgValue("--browser-channel") ?? (hasFlag("--chrome") ? "chrome" : undefined);
  const trimmed = channel?.trim();
  return trimmed === undefined || trimmed.length === 0 || trimmed === "chromium" ? undefined : trimmed;
}

function parseNumberList(value: string): number[] {
  return value.split(",").map((part) => Number(part.trim())).filter((part) => Number.isFinite(part));
}

function parsePositiveIntegerArg(name: string, fallback: number): number {
  const raw = getArgValue(name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function parseNonNegativeIntegerArg(name: string, fallback: number): number {
  const raw = getArgValue(name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function parseBoundedIntegerArg(name: string, fallback: number, min: number, max: number): number {
  const raw = getArgValue(name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function splitCommaArg(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function parseInformationCategoryArg(value: string): NonNullable<SourceRegistryFilter["category"]> {
  if (!isInformationCategory(value)) {
    throw new Error(`Unknown source registry category: ${value}`);
  }
  return value;
}

function parseLocaleSegmentArg(value: string): NonNullable<SourceRegistryFilter["locale"]> {
  if (!isLocaleSegment(value)) {
    throw new Error(`Unknown source registry locale: ${value}`);
  }
  return value;
}

function parseSupportTierArg(value: string): SourceRegistryFilter["minSupportTier"] {
  const minTier = Number(value);
  if (!Number.isInteger(minTier) || minTier < 0 || minTier > 5) {
    throw new Error("--min-tier must be an integer from 0 to 5");
  }
  return minTier as SourceRegistryFilter["minSupportTier"];
}

async function loadCalibrationReportsFromArgs(): Promise<SourceNavigationCalibrationReportLoadResult | undefined> {
  const files = [
    ...singleArgList("--calibration-file"),
    ...splitCommaArg(getArgValue("--calibration-files") ?? "")
  ];
  const runDirs = [
    ...singleArgList("--calibration-run-dir"),
    ...splitCommaArg(getArgValue("--calibration-run-dirs") ?? "")
  ];
  const batchManifests = [
    ...singleArgList("--calibration-batch-manifest"),
    ...splitCommaArg(getArgValue("--calibration-batch-manifests") ?? "")
  ];
  if (files.length + runDirs.length + batchManifests.length === 0) {
    return undefined;
  }
  return loadSourceNavigationCalibrationReports({ files, runDirs, batchManifests });
}

async function loadPromotionSummariesFromArgs(): Promise<ReturnType<typeof parseSourceNavigationPromotionSummary>[]> {
  const summaryFiles = [
    ...singleArgList("--promotion-summary"),
    ...splitCommaArg(getArgValue("--promotion-summaries") ?? "")
  ];
  const summaryDirs = [
    ...singleArgList("--promotion-dir"),
    ...splitCommaArg(getArgValue("--promotion-dirs") ?? "")
  ];
  const paths = [
    ...summaryFiles,
    ...summaryDirs.map((dir) => join(resolve(dir), "promotion-summary.json"))
  ];
  return Promise.all(paths.map(async (path) => parseSourceNavigationPromotionSummary(await readFile(path, "utf8"))));
}

async function loadSelectorHintsFromArgs(): Promise<SourceNavigationDestinationSelectorHintLine[]> {
  return loadSelectorHintsFromFiles(selectorHintFilePathsFromArgs());
}

function selectorHintFilePathsFromArgs(): string[] {
  return [
    ...singleArgList("--selector-hints-file"),
    ...splitCommaArg(getArgValue("--selector-hints-files") ?? "")
  ].map((path) => resolve(path));
}

async function loadSelectorHintsFromFiles(files: string[]): Promise<SourceNavigationDestinationSelectorHintLine[]> {
  if (files.length === 0) {
    return [];
  }
  const parsed = await Promise.all(files.map(async (path) =>
    parseSourceNavigationDestinationSelectorHintsAsLines(await readFile(path, "utf8"))
  ));
  return parsed.flat();
}

function singleArgList(name: string): string[] {
  const value = getArgValue(name);
  return value === undefined ? [] : [value];
}

function summarizeCalibrationInputs(input: SourceNavigationCalibrationReportLoadResult): {
  reportCount: number;
  sources: SourceNavigationCalibrationReportLoadResult["sources"];
  warnings: string[];
} {
  return {
    reportCount: input.reports.length,
    sources: input.sources,
    warnings: input.warnings
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
