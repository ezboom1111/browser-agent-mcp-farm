import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import { main } from "../../src/cli.js";
import { ArtifactWriter } from "../../src/artifact-writer.js";

// Shared in-process CLI test harness. Runs src/cli.ts main() with the given argv,
// capturing console.log, console.error AND process.stdout.write (several commands —
// e.g. destination-recovery-plan format=markdown/commands — emit rendered output via
// process.stdout.write, not console.log). Returns the joined output and the resulting
// process.exitCode. Mirrors the real CLI's top-level catch so arg-validation throws
// are observable as out + exitCode 1.
export async function runCli(args: string[]): Promise<{ out: string; exitCode: number | undefined }> {
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
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown): boolean => {
    lines.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write);
  process.argv = ["node", "/repo/dist/cli.js", ...args];
  try {
    await main();
  } catch (error) {
    lines.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    outSpy.mockRestore();
    process.argv = savedArgv;
  }
  const exitCode = process.exitCode;
  process.exitCode = savedExit;
  return { out: lines.join("\n"), exitCode };
}

// Tracks temp dirs created during a test file so afterEach can remove them all.
export function trackTempDirs(): {
  dirs: string[];
  makeTempDir: (prefix?: string) => Promise<string>;
  cleanup: () => Promise<void>;
} {
  const dirs: string[] = [];
  return {
    dirs,
    async makeTempDir(prefix = "farm-cli-"): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), prefix));
      dirs.push(dir);
      return dir;
    },
    async cleanup(): Promise<void> {
      await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
      dirs.length = 0;
    }
  };
}

// Builds a minimal evidence run dir with one registered text artifact, registered in
// the given dirs[] array for cleanup. Same shape the existing tests/cli.test.ts uses.
export async function makeRun(dirs: string[], text = "evidence one"): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "farm-cli-run-"));
  dirs.push(runDir);
  const writer = new ArtifactWriter();
  await writer.writeCaptureBundle({
    runDir,
    sourceUrl: "https://example.com/",
    contextToken: "ctx",
    pageId: "p",
    captureId: "c",
    text
  });
  return runDir;
}
