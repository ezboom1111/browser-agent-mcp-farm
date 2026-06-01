import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";
import { captureCacheDir, playwrightPackageVersion, readEngineIdentity, writeEngineIdentity, type EngineIdentity } from "../src/capture-cache.js";
import { storeCaptureInCache, tryReplayCachedCapture } from "../src/evidence-runner.js";

// D1 (v0.5.0): the C4 hot-path replay wiring. store -> replay round-trips the IDENTICAL page bytes by
// content hash (same SHA-256), declines on a tamper/drift, and declines when the persisted Playwright
// engine version no longer matches. Deterministic + browserless: store and replay both run in-process.

const URL = "https://example.com/cached";
const ENGINE = { channel: "chromium", browserVersion: "131.0.6778.0" };
const HTML = `<!doctype html><html><head><title>Cached</title></head><body><h1>Cached page</h1><p>Replay me.</p></body></html>`;
const TEXT = "Cached page Replay me.";

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
  roots = [];
});

async function seedSourceRun(cacheRoot: string): Promise<{ writer: ArtifactWriter; sourceRunDir: string; htmlPath: string }> {
  const sourceRunDir = join(cacheRoot, "source-run");
  const writer = new ArtifactWriter();
  const records = await writer.writeCaptureBundle({ runDir: sourceRunDir, sourceUrl: URL, contextToken: "ctx", pageId: "pg", captureId: "cap-page-capture", html: HTML, text: TEXT, screenshot: new Uint8Array([1, 2, 3, 4]), captureMethod: "browser-test" });
  await storeCaptureInCache({ cacheRoot, runDir: sourceRunDir, url: URL, options: { url: URL, runDir: sourceRunDir }, engine: ENGINE, captureRecords: records });
  const htmlRecord = records.find((record) => record.evidence_kind === "page_html");
  return { writer, sourceRunDir, htmlPath: join(sourceRunDir, htmlRecord?.path as string) };
}

describe("capture replay store/replay round-trip (D1)", () => {
  it("replays identical page bytes into a new run without a browser, with a non-negative staleness", async () => {
    if (playwrightPackageVersion() === undefined) {
      return; // playwright not resolvable in this env -> store/replay are intentional no-ops
    }
    const cacheRoot = await mkdtemp(join(tmpdir(), "farm-replay-"));
    roots.push(cacheRoot);
    await seedSourceRun(cacheRoot);

    const replayRunDir = join(cacheRoot, "replay-run");
    const writer = new ArtifactWriter();
    const replay = await tryReplayCachedCapture({ cacheRoot, runDir: replayRunDir, url: URL, options: { url: URL, runDir: replayRunDir }, writer, baseCaptureId: "cap", contextToken: "ctx" });

    expect(replay).toBeDefined();
    expect(replay?.stalenessMs).toBeGreaterThanOrEqual(0);
    const kinds = replay?.records.map((record) => record.evidence_kind) ?? [];
    expect(kinds).toContain("page_html");
    const htmlRecord = replay?.records.find((record) => record.evidence_kind === "page_html");
    const replayed = await readFile(join(replayRunDir, htmlRecord?.path as string), "utf8");
    expect(replayed).toBe(HTML); // byte-identical replay
  });

  it("declines (MISS) when a cached byte was tampered after store", async () => {
    if (playwrightPackageVersion() === undefined) {
      return;
    }
    const cacheRoot = await mkdtemp(join(tmpdir(), "farm-replay-tamper-"));
    roots.push(cacheRoot);
    const { htmlPath } = await seedSourceRun(cacheRoot);

    // Corrupt the source html so its re-hash no longer matches the stored sha256.
    await writeFile(htmlPath, `${HTML}<!-- tampered -->`, "utf8");

    const replayRunDir = join(cacheRoot, "replay-run");
    const replay = await tryReplayCachedCapture({ cacheRoot, runDir: replayRunDir, url: URL, options: { url: URL, runDir: replayRunDir }, writer: new ArtifactWriter(), baseCaptureId: "cap", contextToken: "ctx" });
    expect(replay).toBeUndefined();
  });

  it("declines (MISS) when the persisted Playwright engine version no longer matches", async () => {
    if (playwrightPackageVersion() === undefined) {
      return;
    }
    const cacheRoot = await mkdtemp(join(tmpdir(), "farm-replay-engine-"));
    roots.push(cacheRoot);
    await seedSourceRun(cacheRoot);

    // Rewrite the engine identity with a stale Playwright version -> the bundled Chromium could differ.
    const stale: EngineIdentity = { channel: ENGINE.channel, browserVersion: ENGINE.browserVersion, playwrightVersion: "0.0.0-stale" };
    await writeEngineIdentity(cacheRoot, stale);

    const replayRunDir = join(cacheRoot, "replay-run");
    const replay = await tryReplayCachedCapture({ cacheRoot, runDir: replayRunDir, url: URL, options: { url: URL, runDir: replayRunDir }, writer: new ArtifactWriter(), baseCaptureId: "cap", contextToken: "ctx" });
    expect(replay).toBeUndefined();
  });
});

describe("engine identity persistence (D1)", () => {
  it("round-trips and rejects an invalid/missing identity", async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), "farm-engine-id-"));
    roots.push(cacheRoot);
    expect(await readEngineIdentity(cacheRoot)).toBeUndefined();

    await writeEngineIdentity(cacheRoot, { channel: "chromium", browserVersion: "131.0.6778.0", playwrightVersion: "1.60.0" });
    const back = await readEngineIdentity(cacheRoot);
    expect(back?.browserVersion).toBe("131.0.6778.0");
    expect(back?.playwrightVersion).toBe("1.60.0");

    // An "unknown" browser version is not a resolved engine -> rejected.
    await writeFile(join(captureCacheDir(cacheRoot), "engine-identity.json"), JSON.stringify({ channel: "chromium", browserVersion: "unknown", playwrightVersion: "1.60.0" }), "utf8");
    expect(await readEngineIdentity(cacheRoot)).toBeUndefined();
  });

  it("exposes a non-empty installed Playwright version", () => {
    const version = playwrightPackageVersion();
    // playwright is a direct dependency, so this resolves in the test env.
    expect(typeof version === "string" && version.length > 0).toBe(true);
  });
});
