import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CritiqueRunnerError,
  completeNextCritiqueTask,
  getNextCritiqueTask
} from "../src/critique-runner.js";
import { runCli, trackTempDirs } from "./helpers/cli-harness.js";

const { cleanup, makeTempDir } = trackTempDirs();
afterEach(cleanup);

// Self-contained fixture builder. Mirrors tests/critique-runner.test.ts's createQueueFixture
// and tests/cli.test.ts's queue layout WITHOUT importing from any *.test.ts file.
// The queue is nested under <root>/.gstack/projects/test/ so inferProjectRootFromQueuePath
// resolves projectRoot to <root>, making relative task output paths deterministic
// regardless of the test process cwd.
async function buildQueue(queue: unknown): Promise<{ rootDir: string; queuePath: string }> {
  const rootDir = await makeTempDir("farm-critique-cov-");
  const projectDir = join(rootDir, ".gstack", "projects", "test");
  await mkdir(projectDir, { recursive: true });
  const queuePath = join(projectDir, "media-critical-review-tasks-20260526.json");
  await writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  return { rootDir, queuePath };
}

// Writes arbitrary (possibly invalid) JSON text to a fresh queue path for the
// readQueue validation cases the typed builder cannot express.
async function writeRawQueue(text: string): Promise<{ rootDir: string; queuePath: string }> {
  const rootDir = await makeTempDir("farm-critique-cov-raw-");
  const projectDir = join(rootDir, ".gstack", "projects", "test");
  await mkdir(projectDir, { recursive: true });
  const queuePath = join(projectDir, "media-critical-review-tasks-20260526.json");
  await writeFile(queuePath, text, "utf8");
  return { rootDir, queuePath };
}

function defaultQueue() {
  return {
    next_task: "MEDIA-CRIT-01",
    tasks: [
      { id: "MEDIA-CRIT-01", status: "open", priority: "P1", output: ".gstack/projects/test/rounds/round-01.md" },
      { id: "MEDIA-CRIT-02", status: "open", priority: "P1", output: ".gstack/projects/test/rounds/round-02.md" }
    ]
  };
}

describe("critique CLI commands", () => {
  it("critique-status prints next-task JSON state for a pending queue", async () => {
    // Single open task; do NOT create the output file -> outputExists false, outputBytes 0.
    const { queuePath } = await buildQueue({
      next_task: "MEDIA-CRIT-01",
      tasks: [{ id: "MEDIA-CRIT-01", status: "open", output: ".gstack/projects/test/rounds/round-01.md" }]
    });

    const { out, exitCode } = await runCli(["critique-status", "--queue", queuePath]);

    expect(out).toContain("\"task\":");
    expect(out).toContain("\"id\": \"MEDIA-CRIT-01\"");
    expect(out).toContain("\"complete\": false");
    expect(out).toContain("\"outputExists\": false");
    expect(out).toContain("\"outputBytes\": 0");
    expect(exitCode).toBeFalsy();
  });

  it("critique-next prints complete:true for an exhausted queue", async () => {
    const { queuePath } = await buildQueue({
      next_task: null,
      tasks: [{ id: "MEDIA-CRIT-01", status: "done", output: ".gstack/projects/test/rounds/round-01.md" }]
    });

    const { out, exitCode } = await runCli(["critique-next", "--queue", queuePath]);

    expect(out).toContain("\"task\": null");
    expect(out).toContain("\"complete\": true");
    expect(out).toContain("\"outputExists\": false");
    expect(exitCode).toBeFalsy();
  });

  it("critique-complete marks the next task done and prints completion JSON", async () => {
    const { rootDir, queuePath } = await buildQueue(defaultQueue());
    // Create a non-empty output for the first task so completion succeeds.
    const roundsDir = join(rootDir, ".gstack", "projects", "test", "rounds");
    await mkdir(roundsDir, { recursive: true });
    await writeFile(join(roundsDir, "round-01.md"), "# Round 1\n", "utf8");

    const { out, exitCode } = await runCli(["critique-complete", "--queue", queuePath, "--task-id", "MEDIA-CRIT-01"]);

    expect(out).toContain("\"ok\": true");
    expect(out).toContain("\"completedTask\":");
    expect(out).toContain("\"id\": \"MEDIA-CRIT-01\"");
    expect(out).toContain("\"status\": \"done\"");
    expect(out).toContain("\"completedOutputPath\":");
    expect(out).toContain("\"nextTask\":");
    expect(out).toContain("\"id\": \"MEDIA-CRIT-02\"");
    expect(exitCode).toBeFalsy();

    // Queue file was mutated on disk.
    const queue = JSON.parse(await readFile(queuePath, "utf8")) as {
      next_task: string | null;
      tasks: Array<{ status: string; completed_at?: string }>;
    };
    expect(queue.next_task).toBe("MEDIA-CRIT-02");
    expect(queue.tasks[0]?.status).toBe("done");
    expect(queue.tasks[0]?.completed_at).toBeTruthy();
    expect(queue.tasks[1]?.status).toBe("open");
  });

  it("critique-complete on an empty queue exits 1 with the no-open-task message", async () => {
    const { queuePath } = await buildQueue({
      next_task: null,
      tasks: [{ id: "MEDIA-CRIT-01", status: "done", output: ".gstack/projects/test/rounds/round-01.md" }]
    });

    const { out, exitCode } = await runCli(["critique-complete", "--queue", queuePath]);

    expect(out).toContain("No open critique task remains.");
    expect(exitCode).toBe(1);
  });
});

describe("critique runner direct API", () => {
  it("getNextCritiqueTask returns complete:true for an exhausted queue", async () => {
    const { rootDir, queuePath } = await buildQueue({
      next_task: null,
      tasks: [{ id: "MEDIA-CRIT-01", status: "done", output: ".gstack/projects/test/rounds/round-01.md" }]
    });

    const result = await getNextCritiqueTask(queuePath, rootDir);

    expect(result.complete).toBe(true);
    expect(result.task).toBeNull();
    expect(result.outputPath).toBeNull();
    expect(result.outputExists).toBe(false);
    expect(result.outputBytes).toBe(0);
  });

  it("throws critique_queue_inconsistent when next_task is null but a task is still open", async () => {
    const { rootDir, queuePath } = await buildQueue({
      next_task: null,
      tasks: [{ id: "MEDIA-CRIT-01", status: "open", output: ".gstack/projects/test/rounds/round-01.md" }]
    });

    await expect(getNextCritiqueTask(queuePath, rootDir)).rejects.toThrow(
      "Queue next_task is null but MEDIA-CRIT-01 is still open."
    );
  });

  it("throws critique_next_task_missing when next_task is absent but a task is open", async () => {
    // Omit next_task entirely -> queue.next_task === undefined.
    const { rootDir, queuePath } = await buildQueue({
      tasks: [{ id: "MEDIA-CRIT-01", status: "open", output: ".gstack/projects/test/rounds/round-01.md" }]
    });

    await expect(getNextCritiqueTask(queuePath, rootDir)).rejects.toThrow(
      "Queue has open task MEDIA-CRIT-01 but no next_task pointer."
    );
  });

  it("returns null when next_task is absent and no task is open", async () => {
    const { rootDir, queuePath } = await buildQueue({
      tasks: [{ id: "MEDIA-CRIT-01", status: "done", output: ".gstack/projects/test/rounds/round-01.md" }]
    });

    const result = await getNextCritiqueTask(queuePath, rootDir);

    expect(result.complete).toBe(true);
    expect(result.task).toBeNull();
  });

  it("throws critique_next_task_unknown for a dangling next_task pointer", async () => {
    const { rootDir, queuePath } = await buildQueue({
      next_task: "MEDIA-CRIT-99",
      tasks: [{ id: "MEDIA-CRIT-01", status: "open", output: ".gstack/projects/test/rounds/round-01.md" }]
    });

    await expect(getNextCritiqueTask(queuePath, rootDir)).rejects.toThrow(
      "Queue next_task points to an unknown task: MEDIA-CRIT-99"
    );
  });

  it("completeNextCritiqueTask throws critique_task_mismatch and leaves the queue unmutated", async () => {
    const { rootDir, queuePath } = await buildQueue(defaultQueue());

    await expect(
      completeNextCritiqueTask(queuePath, { taskId: "MEDIA-CRIT-02", cwd: rootDir })
    ).rejects.toThrow("Expected next task MEDIA-CRIT-01, got MEDIA-CRIT-02.");

    const queue = JSON.parse(await readFile(queuePath, "utf8")) as {
      next_task: string;
      tasks: Array<{ status: string }>;
    };
    expect(queue.next_task).toBe("MEDIA-CRIT-01");
    expect(queue.tasks[0]?.status).toBe("open");
  });

  it("readQueue throws critique_queue_invalid when tasks is not an array", async () => {
    const { rootDir, queuePath } = await writeRawQueue(JSON.stringify({ next_task: null }));

    await expect(getNextCritiqueTask(queuePath, rootDir)).rejects.toThrow(
      /Critique queue must contain a tasks array:/
    );
  });

  it("readQueue throws critique_queue_invalid when a task lacks string id/status", async () => {
    const { rootDir, queuePath } = await writeRawQueue(
      JSON.stringify({ next_task: "X", tasks: [{ status: "open" }] })
    );

    await expect(getNextCritiqueTask(queuePath, rootDir)).rejects.toThrow(
      /Every critique task must have string id and status fields:/
    );
  });

  it("readQueue throws critique_queue_read_failed for a missing queue file (absolute path)", async () => {
    const rootDir = await makeTempDir("farm-critique-cov-noent-");
    const queuePath = join(rootDir, "does-not-exist.json");

    let caught: unknown;
    try {
      await getNextCritiqueTask(queuePath, rootDir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CritiqueRunnerError);
    expect((caught as CritiqueRunnerError).code).toBe("critique_queue_read_failed");
  });

  it("resolveTaskOutputPath throws critique_output_missing_field when the active task has no output path", async () => {
    const { rootDir, queuePath } = await buildQueue({
      next_task: "MEDIA-CRIT-01",
      tasks: [{ id: "MEDIA-CRIT-01", status: "open" }]
    });

    await expect(getNextCritiqueTask(queuePath, rootDir)).rejects.toThrow(
      "Current critique task must define a non-empty output path."
    );
  });

  it("honors an explicit absolute result_output and reports outputBytes", async () => {
    const rootDir = await makeTempDir("farm-critique-cov-explicit-");
    const projectDir = join(rootDir, ".gstack", "projects", "test");
    await mkdir(projectDir, { recursive: true });
    const queuePath = join(projectDir, "media-critical-review-tasks-20260526.json");
    const outFile = join(rootDir, "explicit-output.md");
    const payload = "data-bytes";
    await writeFile(outFile, payload, "utf8");
    await writeFile(
      queuePath,
      `${JSON.stringify(
        {
          next_task: "MEDIA-CRIT-01",
          tasks: [{ id: "MEDIA-CRIT-01", status: "open", result_output: outFile }]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await getNextCritiqueTask(queuePath, rootDir);

    expect(result.outputPath).toBe(outFile);
    expect(result.outputExists).toBe(true);
    expect(result.outputBytes).toBe(Buffer.byteLength(payload));
    expect(result.complete).toBe(false);
  });
});
