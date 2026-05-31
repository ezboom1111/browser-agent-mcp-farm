import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBundleManifest } from "../src/evidence-bundle.js";
import { BrowserPool } from "../src/browser-pool.js";
import { LeaseManager } from "../src/lease-manager.js";

// C2b (v0.5.0): the bundle manifest records the resolved capture engine (channel + browser version)
// as provenance BESIDE the bytes — attached outside the Merkle root, so it never affects the hash
// verdict. The load-bearing invariant: merkleRoot is identical whether or not run-meta.json exists.

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
  roots = [];
});

async function newRun(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "farm-bundle-engine-"));
  roots.push(dir);
  return dir;
}

const ARTIFACTS = [JSON.stringify({ artifact_id: "a1", sha256: "11".repeat(32), path: "a1.txt" }), JSON.stringify({ artifact_id: "a2", sha256: "22".repeat(32), path: "a2.txt" })].join("\n");

describe("bundle engine provenance (C2b)", () => {
  it("attaches manifest.engine from run-meta.json when present", async () => {
    const runDir = await newRun();
    await writeFile(join(runDir, "artifacts.jsonl"), `${ARTIFACTS}\n`, "utf8");
    await writeFile(join(runDir, "run-meta.json"), `${JSON.stringify({ engine: { channel: "msedge", browserVersion: "131.0.1" } })}\n`, "utf8");

    const manifest = await buildBundleManifest(runDir);
    expect(manifest.engine).toEqual({ channel: "msedge", browserVersion: "131.0.1" });
  });

  it("keeps merkleRoot IDENTICAL with and without the engine sidecar (engine is outside the tree)", async () => {
    const withoutDir = await newRun();
    await writeFile(join(withoutDir, "artifacts.jsonl"), `${ARTIFACTS}\n`, "utf8");
    const withoutEngine = await buildBundleManifest(withoutDir);
    expect(withoutEngine.engine).toBeUndefined();

    const withDir = await newRun();
    await writeFile(join(withDir, "artifacts.jsonl"), `${ARTIFACTS}\n`, "utf8");
    await writeFile(join(withDir, "run-meta.json"), `${JSON.stringify({ engine: { channel: "chromium", browserVersion: "unknown" } })}\n`, "utf8");
    const withEngine = await buildBundleManifest(withDir);

    expect(withEngine.engine).toEqual({ channel: "chromium", browserVersion: "unknown" });
    expect(withEngine.merkleRoot).toBe(withoutEngine.merkleRoot); // engine never perturbs the hash
  });

  it("omits engine when run-meta.json is absent or malformed", async () => {
    const runDir = await newRun();
    await writeFile(join(runDir, "artifacts.jsonl"), `${ARTIFACTS}\n`, "utf8");
    await writeFile(join(runDir, "run-meta.json"), "not json{", "utf8");
    const manifest = await buildBundleManifest(runDir);
    expect(manifest.engine).toBeUndefined();
  });
});

describe("BrowserPool.engineProvenance (C2b)", () => {
  it("reports the channel and a non-authoritative 'unknown' version before any launch", () => {
    const manager = new LeaseManager();
    expect(new BrowserPool(manager).engineProvenance()).toEqual({ channel: "chromium", browserVersion: "unknown" });
    expect(new BrowserPool(manager, { browserChannel: "msedge" }).engineProvenance()).toEqual({ channel: "msedge", browserVersion: "unknown" });
  });
});
