#!/usr/bin/env node
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserPool } from "./browser-pool.js";
import { FarmService } from "./farm-service.js";
import { LeaseManager } from "./lease-manager.js";
import { runStdioServer } from "./mcp-server.js";
import { runEvidenceWorkflow } from "./evidence-runner.js";
import { runClaimGate } from "./claim-gate.js";
import { buildHtmlPreview } from "./html-preview.js";
import { listProfiles, profilePaths, removeProfile } from "./profile-store.js";
import { completeNextCritiqueTask, getNextCritiqueTask } from "./critique-runner.js";
import { describePlatformCapabilities } from "./platform-adapters/index.js";
import { registerAll, registerClaude, registerCodex } from "./registration.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";

  if (command === "serve") {
    await runStdioServer();
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

  if (command === "evidence-run") {
    await runEvidenceRunCommand();
    return;
  }

  if (command === "auth-login") {
    await runAuthLogin();
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
  const paths = profilePaths(profileName);
  const leaseManager = new LeaseManager();
  const service = new FarmService(leaseManager, new BrowserPool(leaseManager, { launchHeadless: false }));
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
    console.error(`If no input is received, profile will be saved after ${waitMs}ms. Mode: ${profileMode}`);
    await waitForEnterOrTimeout(waitMs);
    await service.capture({ agentId, contextToken: lease.contextToken, pageId: page.page.pageId, captureId: `auth-login-${sanitizeArg(profileName)}` });
    await service.releaseContext({ agentId, contextToken: lease.contextToken });
    console.log(JSON.stringify({ ok: true, runDir, profileName, profileMode, storageStatePath: paths.storageStatePath, userDataDir: paths.userDataDir }, null, 2));
  } finally {
    await service.shutdown();
  }
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

async function runEvidenceRunCommand(): Promise<void> {
  const url = getArgValue("--url");
  if (!url) {
    throw new Error("evidence-run requires --url <url>");
  }
  const runDir = getArgValue("--run-dir") ?? await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-evidence-"));
  const timestampsArg = getArgValue("--timestamps-sec");
  const maxFramesArg = getArgValue("--max-frames");
  const waitMsArg = getArgValue("--wait-ms");
  const navigationTimeoutArg = getArgValue("--timeout-ms");
  const result = await runEvidenceWorkflow({
    url,
    runDir,
    captureId: getArgValue("--capture-id"),
    frameSelector: getArgValue("--frame-selector"),
    timestampsSec: timestampsArg === undefined ? undefined : parseNumberList(timestampsArg),
    maxFrames: maxFramesArg === undefined ? undefined : Number(maxFramesArg),
    waitMs: waitMsArg === undefined ? undefined : Number(waitMsArg),
    navigationTimeoutMs: navigationTimeoutArg === undefined ? undefined : Number(navigationTimeoutArg),
    sampleFrames: hasFlag("--no-frames") ? false : undefined,
    finalClaimGate: hasFlag("--no-final-gate") ? false : undefined
  });
  console.log(JSON.stringify({
    ok: result.ok,
    runDir: result.runDir,
    reportPath: result.reportPath,
    platform: result.platformCapabilities.platform,
    mediaId: result.platformCapabilities.mediaId,
    claims: result.claims.length,
    claimGate: result.claimGate,
    frameSampling: result.assessment.frameSampling
  }, null, 2));
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
  evidence-run --url <url> [--run-dir <path>] [--timestamps-sec 0,10]
          Capture platform/page/frame evidence, write claims/citations/report, and run final claim gate
  auth-login --profile <name> --url <url> [--wait-ms <n>]
          Open a headed browser, let the user log in, then save storage state
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
          auth-login uses a full persistent Chromium profile instead of storage-state
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

function parseNumberList(value: string): number[] {
  return value.split(",").map((part) => Number(part.trim())).filter((part) => Number.isFinite(part));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
