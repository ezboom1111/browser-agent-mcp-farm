#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type BrowserContext } from "playwright";
import { BrowserPool } from "./browser-pool.js";
import { normalizeEvidenceRunInput } from "./evidence-run-input.js";
import {
  buildDestinationRecoveryPlanFromRunDir,
  checkDestinationRecoveryPlan,
  filterDestinationRecoveryPlanByCheck,
  formatDestinationRecoveryPlanCommandsAsLines,
  formatDestinationRecoveryPlanMarkdown,
  type DestinationRecoveryPlanCheckOptions,
  type DestinationRecoveryPlanCommandFormat
} from "./destination-recovery-plan.js";
import { FarmService } from "./farm-service.js";
import { LeaseManager } from "./lease-manager.js";
import { runStdioServer } from "./mcp-server.js";
import { runEvidenceWorkflow } from "./evidence-runner.js";
import { runClaimGate } from "./claim-gate.js";
import { buildBundleManifest, exportBundleArchive, signManifest, verifyBundle, verifyBundleArchive, type BundleArchive, type BundleManifest } from "./evidence-bundle.js";
import { scanRunArtifacts } from "./secret-scan.js";
import { archiveRun, autoPruneConfigFromEnv, autoPruneRunsRoot, parseByteSize, pruneRuns, pruneRunsByBudget, purgeRun } from "./run-lifecycle.js";
import { appendDecision, verifyDecisionLog } from "./decision-log.js";
import { appendAnchor, verifyTimestampLog } from "./timestamp-anchor.js";
import { buildHtmlPreview } from "./html-preview.js";
import { createHttpServer } from "./http-server.js";
import { buildOfficialApiReadiness } from "./official-api.js";
import { ensureHardenedDir, listProfiles, profilePaths, removeProfile } from "./profile-store.js";
import { encryptStorageStateFileInPlace, storageStateEncryptionEnabled } from "./secret-store.js";
import { completeNextCritiqueTask, getNextCritiqueTask } from "./critique-runner.js";
import { describePlatformCapabilities } from "./platform-adapters/index.js";
import { writeAcquisitionMethodMemoryBridge, type AcquisitionMethodMemoryBridgeInput } from "./acquisition-method-memory-bridge.js";
import { refreshStaleSkillSnapshot, registerAll, registerClaude, registerCodex, registerCodexSkill, registerCodexSkills, type RegisterOptions } from "./registration.js";
import { ensureChromiumInstalled } from "./browser-install.js";
import { describeLens, listLenses } from "./lens.js";
import type { LocaleSegment } from "./source-registry.js";
import { EvidenceRunScheduler } from "./scheduler.js";
import { isInformationCategory, isLocaleSegment, listSourceRegistryEntries, selectSourceRegistryEntriesForIntent, selectSourceRegistryEntriesForUrl, summarizeSourceRegistryMatch, type SourceRegistryFilter } from "./source-registry.js";
import type { SourceFamily, SourcePlatform } from "./source-strategy.js";
import { BrowserChannelSchema, EvidenceShapeSchema, type BrowserChannel, type EvidenceShape } from "./schemas.js";

export async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";

  if (command === "serve") {
    // Provision the Chromium binary on first run (the npm package does not bundle it), self-heal
    // stale host skill snapshots after an upgrade, and apply env-driven run retention. All best-effort,
    // all log only to stderr.
    await ensureChromiumInstalled().catch(() => undefined);
    await refreshStaleSkillSnapshot().catch(() => undefined);
    await refreshStaleSkillSnapshot(join(homedir(), ".codex", "skills")).catch(() => undefined);
    await autoPruneFromEnv().catch(() => undefined);
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

  if (command === "export-bundle") {
    const runDir = getArgValue("--run-dir");
    if (runDir === undefined) {
      console.error("export-bundle requires --run-dir <evidence-run-dir>");
      process.exitCode = 1;
      return;
    }
    const privateKeyEnv = getArgValue("--private-key-env");
    const privateKeyPem = privateKeyEnv !== undefined ? process.env[privateKeyEnv] : undefined;

    // Opt-in: anchor this bundle's Merkle root into a tamper-evident, hash-chained transparency log
    // (proves the bundle's order relative to other anchored bundles; absolute time needs a TSA — D2).
    const anchorLog = getArgValue("--anchor-log");
    const maybeAnchor = async (merkleRoot: string): Promise<void> => {
      if (anchorLog !== undefined) {
        await appendAnchor(anchorLog, { merkleRoot, runDir, at: new Date().toISOString() });
      }
    };

    // Self-contained, offline-verifiable archive when --archive-file is given.
    const archiveFile = getArgValue("--archive-file");
    if (archiveFile !== undefined) {
      const archive = await exportBundleArchive(runDir, privateKeyPem !== undefined && privateKeyPem.length > 0 ? { privateKeyPem } : {});
      // Auto-verify the archive we just built (offline re-hash + Merkle): a run that is
      // already tampered at export time fails the export instead of shipping poisoned bytes.
      // Deliberate size-cap omissions (recorded in archive.omitted) and path-less artifacts do
      // NOT fail the export — they are by-design incomplete and already flagged for the verifier.
      const verification = verifyBundleArchive(archive);
      const omittedPaths = new Set(archive.omitted.map((entry) => entry.path));
      const pathByArtifact = new Map(archive.manifest.artifacts.map((artifact) => [artifact.artifact_id, artifact.path]));
      const unaccountedMissing = verification.missingArtifacts.filter((artifactId) => {
        const path = pathByArtifact.get(artifactId);
        return path !== undefined && !omittedPaths.has(path);
      });
      const exportOk = verification.tamperedArtifacts.length === 0 && verification.merkleMatches && verification.signatureValid !== false && unaccountedMissing.length === 0;
      await writeFile(archiveFile, `${JSON.stringify(archive)}\n`, "utf8");
      if (exportOk) {
        await maybeAnchor(archive.manifest.merkleRoot);
      }
      console.log(
        JSON.stringify(
          {
            ok: exportOk,
            archiveFile,
            merkleRoot: archive.manifest.merkleRoot,
            signed: archive.manifest.signature !== undefined,
            artifactCount: archive.manifest.artifactCount,
            embeddedFiles: Object.keys(archive.files).length,
            omitted: archive.omitted.length,
            verification
          },
          null,
          2
        )
      );
      if (!exportOk) {
        process.exitCode = 1;
      }
      return;
    }

    const manifest = await buildBundleManifest(runDir);
    if (privateKeyPem !== undefined && privateKeyPem.length > 0) {
      manifest.signature = signManifest(manifest, privateKeyPem);
    }
    // Auto-verify the manifest against the run in place before anchoring/printing it.
    const verification = await verifyBundle(runDir, manifest);
    if (verification.ok) {
      await maybeAnchor(manifest.merkleRoot);
    }
    const outputFile = getArgValue("--output-file");
    if (outputFile !== undefined) {
      await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      console.log(JSON.stringify({ ok: verification.ok, outputFile, merkleRoot: manifest.merkleRoot, signed: manifest.signature !== undefined, artifactCount: manifest.artifactCount, verification }, null, 2));
    } else {
      console.log(JSON.stringify({ ok: verification.ok, manifest, verification }, null, 2));
    }
    if (!verification.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "verify-bundle") {
    const publicKeyEnv = getArgValue("--public-key-env");
    const publicKeyPem = publicKeyEnv !== undefined ? process.env[publicKeyEnv] : undefined;

    // Offline, self-contained verification when --archive-file is given (no runDir).
    const archiveFile = getArgValue("--archive-file");
    if (archiveFile !== undefined) {
      const archive = JSON.parse(await readFile(archiveFile, "utf8")) as BundleArchive;
      const result = verifyBundleArchive(archive, publicKeyPem);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) {
        process.exitCode = 1;
      }
      return;
    }

    const runDir = getArgValue("--run-dir");
    const manifestFile = getArgValue("--manifest-file");
    if (runDir === undefined || manifestFile === undefined) {
      console.error("verify-bundle requires --run-dir <dir> --manifest-file <manifest.json>, or --archive-file <bundle.evb>");
      process.exitCode = 1;
      return;
    }
    const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as BundleManifest;
    const result = await verifyBundle(runDir, manifest, publicKeyPem);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "scan-secrets") {
    await runScanSecretsCommand();
    return;
  }

  if (command === "purge-run") {
    await runPurgeRunCommand();
    return;
  }

  if (command === "prune-runs") {
    await runPruneRunsCommand();
    return;
  }

  if (command === "archive-run") {
    await runArchiveRunCommand();
    return;
  }

  if (command === "lens") {
    runLensCommand();
    return;
  }

  if (command === "verify-decision-log") {
    await runVerifyDecisionLogCommand();
    return;
  }

  if (command === "verify-timestamp-log") {
    await runVerifyTimestampLogCommand();
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

  // The source-coverage / recipe-canary / source-navigation-* calibration commands were removed
  // with the selector/calibration subsystem (docs/SELECTOR_STACK_EXCISION.md): selector recipes
  // rot, and model vision + consented capture solved the problem they were built for.

  if (command === "destination-recovery-plan") {
    await runDestinationRecoveryPlanCommand();
    return;
  }

  if (command === "kb-acquisition-bridge") {
    await runKbAcquisitionBridgeCommand();
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
    const results = [await registerCodex(undefined, registerOptionsFromArgs()), ...(await registerCodexSkills()), await registerCodexSkill()];
    console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
    return;
  }

  if (command === "register-claude") {
    console.log(JSON.stringify(await registerClaude(registerOptionsFromArgs()), null, 2));
    return;
  }

  if (command === "register-all") {
    console.log(JSON.stringify({ ok: true, results: await registerAll(registerOptionsFromArgs()) }, null, 2));
    return;
  }

  if (command === "upgrade") {
    await runUpgradeCommand();
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
  const runDir = getArgValue("--run-dir") ?? (await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-auth-")));
  const profileMode = hasFlag("--persistent-profile") ? "persistent-profile" : "storage-state";
  const browserChannel = browserChannelFromArgs();
  const paths = profilePaths(profileName);
  const leaseManager = new LeaseManager();
  const service = new FarmService(
    leaseManager,
    new BrowserPool(leaseManager, {
      launchHeadless: false,
      ...(browserChannel === undefined ? {} : { browserChannel })
    })
  );
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
    const context = browser.contexts()[0] ?? (await browser.newContext());
    if (url !== undefined) {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    }
    console.error(`Connected to Chrome over CDP at ${cdpUrl}. Finish login in that Chrome window, then press Enter here to save profile '${profileName}'.`);
    console.error(`If no input is received, profile will be saved after ${waitMs}ms. This saves cookies/storage state, not passwords.`);
    if (!hasFlag("--save-now") && waitMs > 0) {
      await waitForEnterOrTimeout(waitMs);
    }
    await ensureHardenedDir(dirname(paths.storageStatePath));
    const storageState = await context.storageState({ indexedDB: true });
    const filteredStorageState = filterStorageState(storageState, cookieDomains);
    await writeFile(paths.storageStatePath, `${JSON.stringify(filteredStorageState, null, 2)}\n`, "utf8");
    // At-rest DPAPI encryption of the saved storage state (D3, opt-in, Windows, best-effort).
    if (storageStateEncryptionEnabled()) {
      await encryptStorageStateFileInPlace(paths.storageStatePath).catch(() => undefined);
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          profileName,
          cdpUrl,
          storageStatePath: paths.storageStatePath,
          userDataDir: paths.userDataDir,
          cookieDomains,
          cookiesSaved: filteredStorageState.cookies.length,
          originsSaved: filteredStorageState.origins.length,
          note: "Saved browser storage state from the attached Chrome session; no password values were read or stored."
        },
        null,
        2
      )
    );
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
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${paths.userDataDir}`, url];
  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  console.log(
    JSON.stringify(
      {
        ok: true,
        profileName,
        cdpUrl: `http://127.0.0.1:${port}`,
        chromePath,
        userDataDir: paths.userDataDir,
        storageStatePath: paths.storageStatePath,
        url,
        importCommand: `node .\\dist\\cli.js auth-cdp-import --profile ${quoteCliValue(profileName)} --cdp-url http://127.0.0.1:${port}`,
        warning: "Remote debugging exposes this Chrome profile to local processes while the browser is running; close the window after importing the profile."
      },
      null,
      2
    )
  );
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
  const runDir = getArgValue("--run-dir") ?? (await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-proxy-")));
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
  const runDir = getArgValue("--run-dir") ?? (await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-web-")));
  const timeoutMs = Number(getArgValue("--timeout-ms") ?? "10000");
  const urls = ["https://example.com/", "https://www.iana.org/domains/reserved", "https://example.org/"];
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

// Secret-at-rest guard: scan a finished run's text artifacts / ledgers / reports for
// credentials and exit non-zero if any are found (redacted in the output).
async function runScanSecretsCommand(): Promise<void> {
  const runDir = getArgValue("--run-dir");
  if (!runDir) {
    throw new Error("scan-secrets requires --run-dir <evidence-run-dir>");
  }

  const findings = await scanRunArtifacts(runDir);
  console.log(JSON.stringify({ ok: findings.length === 0, runDir, findingCount: findings.length, findings }, null, 2));
  if (findings.length > 0) {
    process.exitCode = 1;
  }
}

// Data-lifecycle: delete a single evidence run (refuses non-run dirs unless --force).
async function runPurgeRunCommand(): Promise<void> {
  const runDir = getArgValue("--run-dir");
  if (!runDir) {
    throw new Error("purge-run requires --run-dir <evidence-run-dir>");
  }

  const result = await purgeRun(runDir, hasFlag("--force") ? { force: true } : {});
  console.log(JSON.stringify(result, null, 2));
  if (!result.removed) {
    process.exitCode = 1;
  }
}

// Data-lifecycle: sweep a runs root, removing runs older than --max-age-days
// (default 30). --dry-run reports candidates without deleting.
async function runPruneRunsCommand(): Promise<void> {
  const root = getArgValue("--run-root");
  if (!root) {
    throw new Error("prune-runs requires --run-root <dir>");
  }

  const days = Number(getArgValue("--max-age-days") ?? "30");
  if (!Number.isFinite(days) || days < 0) {
    throw new Error("prune-runs --max-age-days must be a non-negative number");
  }
  const maxAgeMs = days * 24 * 60 * 60 * 1000;
  const dryRun = hasFlag("--dry-run");
  const ageResult = await pruneRuns(root, dryRun ? { maxAgeMs, dryRun: true } : { maxAgeMs });
  // Optional disk-budget pass after the age pass (delete the oldest remaining runs until under budget).
  const maxBytesArg = getArgValue("--max-bytes");
  let budgetResult: Awaited<ReturnType<typeof pruneRunsByBudget>> | undefined;
  if (maxBytesArg !== undefined) {
    const maxBytes = parseByteSize(maxBytesArg);
    if (maxBytes === undefined) {
      throw new Error('prune-runs --max-bytes must be a size like "5GB", "500mb", or a byte count');
    }
    budgetResult = await pruneRunsByBudget(root, dryRun ? { maxBytes, dryRun: true } : { maxBytes });
  }
  console.log(JSON.stringify(budgetResult === undefined ? ageResult : { age: ageResult, budget: budgetResult }, null, 2));
}

// Research lenses (engine #3): list the declarative lenses, or describe one (its claim templates +
// report sections + the source-registry entries it prioritizes) with `--lens <id> [--locale <seg>]`.
function runLensCommand(): void {
  const id = getArgValue("--lens");
  if (id === undefined) {
    console.log(JSON.stringify({ ok: true, lenses: listLenses() }, null, 2));
    return;
  }
  const locale = getArgValue("--locale") as LocaleSegment | undefined;
  const described = describeLens(id, locale);
  if (described === undefined) {
    console.log(JSON.stringify({ ok: false, error: `unknown lens: ${id}`, available: listLenses().map((lens) => lens.id) }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ok: true, ...described }, null, 2));
}

// Data-lifecycle: tiered archive of a single run — reclaim its bulky screenshot/media bytes while
// keeping the ledger/claims/report/raw index. --dry-run reports the reclaimable bytes without deleting.
async function runArchiveRunCommand(): Promise<void> {
  const runDir = getArgValue("--run-dir");
  if (!runDir) {
    throw new Error("archive-run requires --run-dir <evidence-run-dir>");
  }
  const result = await archiveRun(runDir, hasFlag("--dry-run") ? { dryRun: true } : {});
  console.log(JSON.stringify(result, null, 2));
  if (!result.archived && result.reason !== undefined) {
    process.exitCode = 1;
  }
}

// Best-effort env-driven auto-retention, run at serve startup. Opt-in: a no-op unless FARM_RUNS_ROOT is
// set. Sweeps that root by age (FARM_RUNS_MAX_AGE_DAYS) then by disk budget (FARM_RUNS_MAX_BYTES, e.g.
// "5GB"). Never throws and never blocks serve. Logs a one-line summary to stderr (safe for MCP stdio).
async function autoPruneFromEnv(): Promise<void> {
  const config = autoPruneConfigFromEnv(process.env);
  if (config === undefined) {
    return;
  }
  try {
    const result = await autoPruneRunsRoot(config);
    const reclaimed = (result.aged?.removed.length ?? 0) + (result.budgeted?.removed.length ?? 0);
    if (reclaimed > 0) {
      process.stderr.write(`[browser-agent-mcp-farm] auto-retention: reclaimed ${reclaimed} run(s) under ${config.root}\n`);
    }
  } catch {
    // best-effort: retention must never break a serve
  }
}

// Verify a hash-chained gate-verdict decision log (exit 1 if the chain is broken).
async function runVerifyDecisionLogCommand(): Promise<void> {
  const logFile = getArgValue("--log-file");
  if (!logFile) {
    throw new Error("verify-decision-log requires --log-file <decisions.jsonl>");
  }

  const result = await verifyDecisionLog(logFile);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

// Verify a hash-chained bundle transparency log: chain integrity + relative ordering (exit 1 if broken).
// TSA tokens, if present, are reported but verified offline with `openssl ts -verify`, not here.
async function runVerifyTimestampLogCommand(): Promise<void> {
  const logFile = getArgValue("--log-file");
  if (!logFile) {
    throw new Error("verify-timestamp-log requires --log-file <transparency-log.ndjson>");
  }

  const result = await verifyTimestampLog(logFile);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
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
  const match =
    categoryArg === undefined && localeArg === undefined && minTierArg === undefined
      ? undefined
      : selectSourceRegistryEntriesForIntent({
          category: filter.category,
          locale: filter.locale,
          minSupportTier: filter.minSupportTier
        });

  console.log(
    JSON.stringify(
      {
        ok: true,
        filter,
        entries,
        ...(match === undefined ? {} : { summary: summarizeSourceRegistryMatch({ ...match, entries }) })
      },
      null,
      2
    )
  );
}

async function runUpgradeCommand(): Promise<void> {
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(await readFile(join(pkgRoot, "package.json"), "utf8")) as { name: string; version: string };
  // A git-clone install (.git at the package root) upgrades by pull+build; a published-package install
  // upgrades through the package manager (or auto-resolves when registered via npx @latest).
  const mode = existsSync(join(pkgRoot, ".git")) ? "git-clone" : "installed";
  const upgrade =
    mode === "git-clone"
      ? ["git pull", "npm ci", "npx playwright install chromium", "npm run build", "node ./dist/cli.js register-all"]
      : [`npm install -g ${pkg.name}@latest   # (or register via 'npx ${pkg.name}@latest serve', which auto-resolves @latest)`, `${pkg.name} register-all      # refresh registration + skill`];

  // `upgrade --run` performs the one always-safe, in-process step: re-register (refresh the MCP config +
  // self-heal the skill snapshot). It does NOT auto-run git pull / npm — those stay printed, since they
  // are environment-specific. Pass --npx/--package-spec to re-register in npx mode.
  if (hasFlag("--run")) {
    const results = await registerAll(registerOptionsFromArgs());
    console.log(JSON.stringify({ ok: true, name: pkg.name, version: pkg.version, mode, ran: "register-all", results, afterUpgrade: "restart your agent (Codex/Claude) so the new server + skill load" }, null, 2));
    return;
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        name: pkg.name,
        version: pkg.version,
        mode,
        upgrade,
        afterUpgrade: "restart your agent (Codex/Claude) so the new server + skill load",
        note: "Run 'upgrade --run' to re-register in place now; an npx-registered install auto-resolves @latest. Self-maintenance: the CI/verify gate guards every release."
      },
      null,
      2
    )
  );
}

function savedBrowserProfileExists(profileName: string): boolean {
  const paths = profilePaths(profileName);
  return existsSync(paths.storageStatePath) || existsSync(paths.userDataDir);
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

function renderDestinationRecoveryPlanOutput(plan: Awaited<ReturnType<typeof buildDestinationRecoveryPlanFromRunDir>>, format: string, checkOptions: DestinationRecoveryPlanCheckOptions = {}): string {
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

async function runKbAcquisitionBridgeCommand(): Promise<void> {
  const runDir = getArgValue("--run-dir");
  if (runDir === undefined) {
    throw new Error("kb-acquisition-bridge requires --run-dir <evidence-run-dir>");
  }
  const vaultRoot = getArgValue("--vault-root") ?? defaultVaultRoot();
  if (vaultRoot === undefined) {
    throw new Error("kb-acquisition-bridge requires --vault-root <vault-root> unless LEE_VAULT_ROOT, LOOP_VAULT_ROOT, or C:\\lee-vault exists");
  }
  const bridgeInput: AcquisitionMethodMemoryBridgeInput = {
    runDir: resolve(runDir),
    vaultRoot: resolve(vaultRoot),
    apply: hasFlag("--apply")
  };
  const sourceUrl = getArgValue("--url");
  const merkleRoot = getArgValue("--merkle-root");
  const methodId = getArgValue("--method-id");
  const decisionId = getArgValue("--decision-id");
  const now = getArgValue("--now");
  if (sourceUrl !== undefined) {
    bridgeInput.sourceUrl = sourceUrl;
  }
  if (merkleRoot !== undefined) {
    bridgeInput.merkleRoot = merkleRoot;
  }
  if (methodId !== undefined) {
    bridgeInput.methodId = methodId;
  }
  if (decisionId !== undefined) {
    bridgeInput.decisionId = decisionId;
  }
  if (now !== undefined) {
    bridgeInput.now = now;
  }
  const result = await writeAcquisitionMethodMemoryBridge(bridgeInput);
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        applied: result.applied,
        written: result.written,
        runDir: result.runDir,
        vaultRoot: result.vaultRoot,
        methodId: result.methodId,
        sourceUrl: result.sourceUrl,
        merkleRoot: result.merkleRoot,
        acquisitionPlanArtifactId: result.acquisitionPlanArtifactId,
        obstructionArtifactIds: result.obstructionArtifactIds,
        notes: result.notes.map((note) => ({
          kind: note.kind,
          path: note.path,
          relativePath: note.relativePath,
          changed: note.changed
        })),
        warnings: result.warnings
      },
      null,
      2
    )
  );
}

function defaultVaultRoot(): string | undefined {
  const envRoot = process.env.LEE_VAULT_ROOT ?? process.env.LOOP_VAULT_ROOT;
  if (envRoot !== undefined && envRoot.length > 0) {
    return envRoot;
  }
  const leeVaultAlias = "C:\\lee-vault";
  return existsSync(leeVaultAlias) ? leeVaultAlias : undefined;
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
  const intentShapesArg = getArgValue("--intent-shapes");
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
    researchIntent:
      getArgValue("--intent") === undefined && getArgValue("--intent-scope") === undefined && intentShapesArg === undefined && getArgValue("--success-criteria") === undefined && getArgValue("--intent-boundaries") === undefined
        ? undefined
        : {
            decisionNeeded: getArgValue("--intent"),
            targetScope: getArgValue("--intent-scope"),
            evidenceShapes: intentShapesArg === undefined ? undefined : parseEvidenceShapeList(intentShapesArg),
            successCriteria: getArgValue("--success-criteria"),
            boundaries: getArgValue("--intent-boundaries")
          },
    httpFetch: hasFlag("--http-fetch"),
    captureRouting: hasFlag("--auto-capture") ? "auto" : "browser",
    captureCache: hasFlag("--capture-cache"),
    captureProfile: hasFlag("--text-only") ? "text" : "full",
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
    }
  });
  const result = await runEvidenceWorkflow(input);
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        runDir: result.runDir,
        reportPath: result.reportPath,
        platform: result.platformCapabilities.platform,
        sourceStrategy: {
          platform: result.sourceStrategy.platform,
          family: result.sourceStrategy.sourceFamily
        },
        sourceRegistry: result.assessment.sourceRegistry,
        intentProfile: result.assessment.intentProfile,
        trendAnalysis: result.assessment.trendAnalysis,
        searchResultCandidates: result.assessment.searchResultCandidates,
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
          intentProfile: result.intentProfileRecords.length,
          trendAnalysis: result.trendAnalysisRecords.length,
          searchResultCandidates: result.searchResultCandidateRecords.length,
          overlayDismissal: result.overlayDismissalRecords.length,
          obstruction: result.obstructionRecords.length
        }
      },
      null,
      2
    )
  );
  if (!result.ok) {
    process.exitCode = 1;
  }
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

  // Opt-in: append this verdict to a tamper-evident, hash-chained decision log.
  const decisionLog = getArgValue("--decision-log");
  if (decisionLog !== undefined) {
    await appendDecision(decisionLog, {
      runDir,
      ok: result.ok,
      claimCount: result.counts.claims,
      errorCount: result.errors.length,
      at: new Date().toISOString(),
      mode
    });
  }

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function runMediaSmoke(): Promise<void> {
  const runDir = getArgValue("--run-dir") ?? (await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-media-")));
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
  const runDir = getArgValue("--run-dir") ?? (await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-")));
  const fixture = await startFixtureServer();
  const service = new FarmService();
  const urls = [`${fixture.baseUrl}/alpha`, `${fixture.baseUrl}/bravo`, `${fixture.baseUrl}/charlie`];

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
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0f766e"/></svg>', "utf8");
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
      case '"':
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
  claim-gate --run-dir <path> [--mode smoke|final] [--min-claims <n>] [--decision-log <path>]
          Fail when claims cite missing or unregistered artifacts; optionally append the
          verdict to a tamper-evident hash-chained decision log
  verify-decision-log --log-file <decisions.jsonl>
          Verify the hash chain of a gate-verdict decision log (exit 1 if broken/tampered)
  verify-timestamp-log --log-file <transparency-log.ndjson>
          Verify the hash chain + relative ordering of a bundle transparency log (exit 1 if
          broken). TSA tokens, if present, are reported but verified offline via openssl ts -verify
  html-preview --run-dir <path>
          Generate html/farm-evidence-preview.html
  scan-secrets --run-dir <evidence-run-dir>
          Scan a finished run's artifacts/ledgers/reports for secrets-at-rest (exit 1 if any)
  purge-run --run-dir <evidence-run-dir> [--force]
          Delete one evidence run (refuses a non-run directory unless --force)
  prune-runs --run-root <dir> [--max-age-days 30] [--max-bytes 5GB] [--dry-run]
          Sweep a runs root: remove runs older than the max age, then (if --max-bytes) delete the
          oldest remaining runs until the total fits the disk budget (--dry-run to preview).
          Auto-retention: set FARM_RUNS_ROOT (+ FARM_RUNS_MAX_AGE_DAYS / FARM_RUNS_MAX_BYTES) to sweep
          on every serve startup.
  archive-run --run-dir <evidence-run-dir> [--dry-run]
          Tiered archive: reclaim a run's bulky screenshot/media bytes while keeping the
          ledger/claims/report/raw index (its text claims stay re-verifiable; visual artifacts do not)
  lens [--lens <id>] [--locale <segment>]
          List the declarative research lenses, or describe one (its claim templates + report sections
          + the prioritized source-registry entries). Lenses (research | market_scan | product_planning)
          are domain configs over the same engine + gate.
  export-bundle --run-dir <dir> [--output-file <manifest.json>] [--archive-file <bundle.evb>] [--private-key-env <ENV>] [--anchor-log <transparency-log.ndjson>]
          Build a Merkle-rooted manifest, or a self-contained signed .evb archive; --anchor-log
          appends the Merkle root to a tamper-evident transparency log (proves bundle ordering)
  verify-bundle (--run-dir <dir> --manifest-file <m.json> | --archive-file <bundle.evb>) [--public-key-env <ENV>]
          Verify a bundle; --archive-file verifies fully offline (no runDir)
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
  destination-recovery-plan --run-dir <evidence-run-dir> [--format json|check|markdown|commands|setup-commands|retry-commands] [--output-file <path>] [--fail-empty] [--fail-check] [--check-profiles] [--only-check-ok]
          Extract blocked-child recovery advice from destination_triage artifacts
  kb-acquisition-bridge --run-dir <evidence-run-dir> [--url <source-url>] [--vault-root <path>] [--merkle-root <hex>] [--apply]
          Bridge an acquisition_method_plan run into Lee-vault method memory:
          SYSTEM_DNA row, acquisition recipe, frontier ledger, bridge note, and LOG entry.
          Pass --url for older sealed runs that predate acquisition_method_plan artifacts.
          Dry-run by default; --apply writes markdown. This is a personal KB bridge, not farm core.
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
          Register this MCP server in local agent configs.
          --npx                  register an "npx -y <spec> serve" invocation instead of an absolute
                                 build path (portable; upgrades flow through the package manager).
                                 Use this for a published-package install, not a local git clone.
          --package-spec <spec>  npx package spec (default browser-agent-mcp-farm@latest; e.g. a pinned
                                 version or a private @scope/name@version).
  upgrade
          Print the installed version + how to upgrade and re-register

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
  --http-fetch
          tier-0 browserless capture: try a plain HTTP GET first (no Chromium) for server-rendered pages; falls back to the browser if it declines (no frames on the tier-0 path)
  --auto-capture
          auto routing: try tier-0 browserless capture first and escalate to the browser on any decline (client-rendered shell / non-HTML / off-domain / bot-block); never a worse capture than the browser
  --capture-cache
          opt-in replay: reuse a fresh (<=1h) prior bare-ephemeral capture by content hash instead of launching the browser; the page claim is labelled cached_capture with its staleness age
  --text-only
          text capture profile: block image/media/font + ad-host subrequests and skip the page screenshot (faster text/structure-only browser runs)
  --intent <text>
          Soft intent lock: record the decision this run should support without blocking capture
  --intent-scope <text>
          Scope for the intent profile, such as entity/product/place, locale, time horizon, and source universe
  --intent-shapes <a,b>
          Evidence modalities for the intent profile: ${EvidenceShapeSchema.options.join(", ")}
  --success-criteria <text>
          What would count as useful, surprising, or decision-changing for this run
  --intent-boundaries <text>
          Login/profile/BYO and refusal boundaries; CAPTCHA/paywall/raw-media bypass remains terminal
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
  --output-file <path>
          destination-recovery-plan writes the rendered output to this file instead of stdout
  --fail-empty
          destination-recovery-plan exits non-zero when the recovery plan has no items
  --fail-check
          destination-recovery-plan exits non-zero when --format check finds command errors
  --check-profiles
          destination-recovery-plan also checks whether referenced saved browser profiles exist locally
  --only-check-ok
          destination-recovery-plan filters out items with check errors before rendering output
`);
}

async function waitForEnterOrTimeout(waitMs: number): Promise<void> {
  if (!process.stdin.isTTY) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
    return;
  }

  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    await Promise.race([readline.question("Press Enter when login/consent is complete...").then(() => undefined), new Promise<void>((resolvePromise) => setTimeout(resolvePromise, waitMs))]);
  } finally {
    readline.close();
  }
}

function sanitizeArg(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "profile"
  );
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

// Build registration options from CLI flags. `--npx` writes an `npx -y <spec> serve` invocation
// (portable, package-manager-upgradable) instead of an absolute path to this build; `--package-spec`
// overrides the default `browser-agent-mcp-farm@latest` (e.g. a pinned version or a private scope).
function registerOptionsFromArgs(): RegisterOptions {
  const options: RegisterOptions = { npx: hasFlag("--npx") };
  const spec = getArgValue("--package-spec");
  if (spec !== undefined) {
    options.packageSpec = spec;
  }
  return options;
}

function browserChannelFromArgs(): BrowserChannel | undefined {
  const channel = getArgValue("--browser-channel") ?? (hasFlag("--chrome") ? "chrome" : undefined);
  const trimmed = channel?.trim();
  if (trimmed === undefined || trimmed.length === 0 || trimmed === "chromium") {
    return undefined; // bundled default Chromium engine
  }
  // Validate against the closed channel enum BEFORE any browser launch, so an unsupported value
  // (e.g. "firefox", "msedge-canary") fails fast with a clear message instead of deep inside Playwright.
  const parsed = BrowserChannelSchema.safeParse(trimmed);
  if (!parsed.success) {
    throw new Error(`Invalid --browser-channel '${trimmed}'. Allowed: ${BrowserChannelSchema.options.join(", ")} (or omit for the bundled Chromium engine).`);
  }
  return parsed.data;
}

function parseNumberList(value: string): number[] {
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
}

function parseStringList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseEvidenceShapeList(value: string): EvidenceShape[] {
  return parseStringList(value).map((part) => {
    const parsed = EvidenceShapeSchema.safeParse(part);
    if (!parsed.success) {
      throw new Error(`Invalid --intent-shapes value '${part}'. Allowed: ${EvidenceShapeSchema.options.join(", ")}`);
    }
    return parsed.data;
  });
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

function splitCommaArg(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

// Run main() only when executed as the CLI entry point, NOT when imported (e.g. by
// tests), so the command functions can be exercised in-process. verify's 4 smokes
// (which run `node dist/cli.js …`) prove this guard still launches the real CLI.
const invokedPath = process.argv[1];
const isEntryPoint = invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href;
if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
