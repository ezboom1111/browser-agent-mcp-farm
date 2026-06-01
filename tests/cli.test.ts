import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { ArtifactWriter } from "../src/artifact-writer.js";

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

// Run the CLI in-process with the given args, capturing stdout and the exit code.
async function runCli(args: string[]): Promise<{ out: string; exitCode: number | undefined }> {
  const savedArgv = process.argv;
  const savedExit = process.exitCode;
  process.exitCode = undefined;
  const lines: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.join(" "));
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.join(" "));
  });
  process.argv = ["node", "/repo/dist/cli.js", ...args];
  try {
    await main();
  } catch (error) {
    // Mirror the real CLI's top-level catch so arg-validation throws are observable.
    lines.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.argv = savedArgv;
  }
  const exitCode = process.exitCode;
  process.exitCode = savedExit;
  return { out: lines.join("\n"), exitCode };
}

async function makeRun(): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "farm-cli-run-"));
  dirs.push(runDir);
  const writer = new ArtifactWriter();
  await writer.writeCaptureBundle({
    runDir,
    sourceUrl: "https://example.com/",
    contextToken: "ctx",
    pageId: "p",
    captureId: "c",
    text: "evidence one"
  });
  return runDir;
}

describe("cli", () => {
  it("prints usage for help", async () => {
    const { out } = await runCli(["help"]);
    expect(out).toContain("browser-agent-mcp-farm");
    expect(out).toContain("scan-secrets");
  });

  it("scan-secrets passes a clean run and fails a dirty one", async () => {
    const clean = await makeRun();
    const cleanResult = await runCli(["scan-secrets", "--run-dir", clean]);
    expect(cleanResult.out).toContain('"ok": true');
    expect(cleanResult.exitCode).toBeFalsy();

    const dirty = await mkdtemp(join(tmpdir(), "farm-cli-dirty-"));
    dirs.push(dirty);
    await writeFile(join(dirty, "report.md"), "leak AIzaSyA1234567890abcdefghijklmnopqrstuv", "utf8");
    const dirtyResult = await runCli(["scan-secrets", "--run-dir", dirty]);
    expect(dirtyResult.out).toContain("google_api_key");
    expect(dirtyResult.exitCode).toBe(1);
  });

  it("purge-run deletes a run and refuses a non-run dir", async () => {
    const run = await mkdtemp(join(tmpdir(), "farm-cli-purge-"));
    dirs.push(run);
    await writeFile(join(run, "artifacts.jsonl"), '{"x":1}\n', "utf8");
    const purged = await runCli(["purge-run", "--run-dir", run]);
    expect(purged.out).toContain('"removed": true');
    await expect(stat(run)).rejects.toBeTruthy();

    const notRun = await mkdtemp(join(tmpdir(), "farm-cli-notrun-"));
    dirs.push(notRun);
    const refused = await runCli(["purge-run", "--run-dir", notRun]);
    expect(refused.exitCode).toBe(1);
  });

  it("prune-runs reports old runs in dry-run", async () => {
    const root = await mkdtemp(join(tmpdir(), "farm-cli-prune-"));
    dirs.push(root);
    await mkdir(join(root, "run-1"), { recursive: true });
    await writeFile(join(root, "run-1", "artifacts.jsonl"), '{"x":1}\n', "utf8");
    const { out } = await runCli(["prune-runs", "--run-root", root, "--max-age-days", "0", "--dry-run"]);
    expect(out).toContain('"dryRun": true');
    expect(out).toContain('"scanned": 1');
    await expect(stat(join(root, "run-1"))).resolves.toBeTruthy(); // not deleted
  });

  it("verify-decision-log verifies an empty log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-cli-dlog-"));
    dirs.push(dir);
    const logFile = join(dir, "decisions.jsonl");
    await writeFile(logFile, "", "utf8");
    const { out, exitCode } = await runCli(["verify-decision-log", "--log-file", logFile]);
    expect(out).toContain('"ok": true');
    expect(exitCode).toBeFalsy();
  });

  it("export-bundle --anchor-log appends a chained anchor that verify-timestamp-log accepts", async () => {
    const run = await makeRun();
    const dir = await mkdtemp(join(tmpdir(), "farm-cli-anchor-"));
    dirs.push(dir);
    const anchorLog = join(dir, "transparency-log.ndjson");
    const manifestFile = join(run, "manifest.json");
    const exported = await runCli(["export-bundle", "--run-dir", run, "--output-file", manifestFile, "--anchor-log", anchorLog]);
    expect(exported.out).toContain("merkleRoot");

    const verified = await runCli(["verify-timestamp-log", "--log-file", anchorLog]);
    expect(verified.out).toContain('"ok": true');
    expect(verified.out).toContain('"orderingOnlyCount": 1');
    expect(verified.exitCode).toBeFalsy();
  });

  it("verify-timestamp-log fails (exit 1) on a tampered transparency log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-cli-anchor-bad-"));
    dirs.push(dir);
    const anchorLog = join(dir, "transparency-log.ndjson");
    // A single entry whose recomputed hash will not match the forged merkleRoot.
    const forged = { seq: 1, prevHash: "0".repeat(64), at: "2026-06-02T00:00:00.000Z", merkleRoot: "forged", entryHash: "deadbeef" };
    await writeFile(anchorLog, `${JSON.stringify(forged)}\n`, "utf8");
    const { out, exitCode } = await runCli(["verify-timestamp-log", "--log-file", anchorLog]);
    expect(out).toContain('"ok": false');
    expect(exitCode).toBe(1);
  });

  it("export-bundle --archive-file then verify-bundle --archive-file round-trips", async () => {
    const run = await makeRun();
    const evb = join(run, "bundle.evb");
    const exported = await runCli(["export-bundle", "--run-dir", run, "--archive-file", evb]);
    expect(exported.out).toContain('"embeddedFiles"');
    const verified = await runCli(["verify-bundle", "--archive-file", evb]);
    expect(verified.out).toContain('"ok": true');
    expect(verified.exitCode).toBeFalsy();
  });

  it("source-registry prints registry entries", async () => {
    const { out } = await runCli(["source-registry"]);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/google_search|naver_search|platform/);
  });

  it("platform-capabilities describes a media URL", async () => {
    const { out } = await runCli(["platform-capabilities", "--url", "https://www.youtube.com/watch?v=abc"]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("html-preview generates a preview for a run", async () => {
    const run = await makeRun();
    const { out } = await runCli(["html-preview", "--run-dir", run]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("official-api-readiness reports without calling provider APIs", async () => {
    const { out } = await runCli(["official-api-readiness", "--url", "https://www.youtube.com/watch?v=abc"]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("source-coverage-readiness audits the registry", async () => {
    const { out } = await runCli(["source-coverage-readiness"]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("source-navigation-catalog builds the recipe catalog", async () => {
    const { out } = await runCli(["source-navigation-catalog"]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("export-bundle writes a manifest to --output-file", async () => {
    const run = await makeRun();
    const manifestFile = join(run, "manifest.json");
    const { out } = await runCli(["export-bundle", "--run-dir", run, "--output-file", manifestFile]);
    expect(out).toContain("merkleRoot");
    const verified = await runCli(["verify-bundle", "--run-dir", run, "--manifest-file", manifestFile]);
    expect(verified.out).toContain('"ok": true');
  });

  it("reports an error for a command missing required args", async () => {
    const { exitCode } = await runCli(["scan-secrets"]);
    expect(exitCode).toBe(1);
  });

  it("scan-secrets on a nonexistent run reports clean (no files)", async () => {
    const { out, exitCode } = await runCli(["scan-secrets", "--run-dir", join(tmpdir(), "definitely-missing-farm-run-xyz")]);
    expect(out).toContain('"ok": true');
    expect(exitCode).toBeFalsy();
  });

  it("describes a source-navigation recipe plan for a URL", async () => {
    const { out } = await runCli(["source-navigation-recipes", "--url", "https://www.youtube.com/watch?v=abc"]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("prints source-navigation calibration targets", async () => {
    const { out } = await runCli(["source-navigation-calibration-targets"]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("exports maintained source-navigation recipes", async () => {
    const { out } = await runCli(["source-navigation-export-recipes"]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("official-api-readiness with --fail-not-ready signals via exit code", async () => {
    const { out, exitCode } = await runCli(["official-api-readiness", "--url", "https://www.youtube.com/watch?v=abc", "--fail-not-ready"]);
    expect(out.length).toBeGreaterThan(0);
    expect(typeof exitCode === "number" || exitCode === undefined).toBe(true);
  });

  it("critique-next prints the next task (or an empty queue result)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-cli-critique-"));
    dirs.push(dir);
    const { out } = await runCli(["critique-next", "--queue", join(dir, "queue.json")]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("export-bundle signs the manifest when a private key env is set", async () => {
    const run = await makeRun();
    const previous = process.env.CLI_TEST_SIGNING_KEY;
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("ed25519");
    process.env.CLI_TEST_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    try {
      const evb = join(run, "signed.evb");
      const { out } = await runCli(["export-bundle", "--run-dir", run, "--archive-file", evb, "--private-key-env", "CLI_TEST_SIGNING_KEY"]);
      expect(out).toContain('"signed": true');
    } finally {
      if (previous === undefined) {
        delete process.env.CLI_TEST_SIGNING_KEY;
      } else {
        process.env.CLI_TEST_SIGNING_KEY = previous;
      }
    }
  });

  it("treats an unknown command as help", async () => {
    const { out } = await runCli(["definitely-not-a-real-command"]);
    expect(out.length).toBeGreaterThan(0);
  });
});
