import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { runCli } from "./helpers/cli-harness.js";

let dirs: string[] = [];
let servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((res) => s.close(() => res()))));
  servers = [];
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function chromiumAvailable(): Promise<boolean> {
  return chromium.launch({ headless: true }).then(async (b) => { await b.close(); return true; }).catch(() => false);
}

async function startFixture(html: string): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  servers.push(server);
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server has no port");
  }
  return `http://127.0.0.1:${address.port}/`;
}

async function writeGolden(requiredSelectors: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "farm-canary-live-"));
  dirs.push(dir);
  const goldenPath = join(dir, "golden.json");
  await writeFile(goldenPath, JSON.stringify({ recipeKey: "fixture/recipe", requiredSelectors, capturedAt: "2026-05-01T00:00:00.000Z" }), "utf8");
  return goldenPath;
}

describe("recipe-canary live headless probe", () => {
  it("passes when the golden's selectors still resolve on the live page", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping live canary test: Playwright Chromium is not installed.");
      return;
    }
    const url = await startFixture('<html><body><a class="result" href="/x">r</a><h3 class="title">t</h3></body></html>');
    const golden = await writeGolden([".result", "h3.title"]);
    const { out, exitCode } = await runCli(["recipe-canary", "--golden-file", golden, "--url", url, "--now", "2026-05-30T00:00:00.000Z"]);
    expect(out).toContain('"verdict": "pass"');
    expect(exitCode).toBeFalsy();
  });

  it("demotes to needs_recalibration when a required selector is gone from the live page", async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping live canary test: Playwright Chromium is not installed.");
      return;
    }
    const url = await startFixture('<html><body><a class="result" href="/x">r</a></body></html>');
    const golden = await writeGolden([".result", ".vanished"]);
    const { out, exitCode } = await runCli(["recipe-canary", "--golden-file", golden, "--url", url, "--fail-on-recalibration", "--now", "2026-05-30T00:00:00.000Z"]);
    expect(out).toContain('"verdict": "needs_recalibration"');
    expect(out).toContain(".vanished");
    expect(exitCode).toBe(1);
  });
});
