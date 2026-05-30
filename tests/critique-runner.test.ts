import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { completeNextCritiqueTask, getNextCritiqueTask } from "../src/critique-runner.js";

let runDirs: string[] = [];

describe("critique runner", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("returns exactly the next open task without mutating the queue", async () => {
    const fixture = await createQueueFixture();

    const result = await getNextCritiqueTask(fixture.queuePath, fixture.rootDir);

    expect(result.complete).toBe(false);
    expect(result.task?.id).toBe("MEDIA-CRIT-01");
    expect(result.outputExists).toBe(false);
    const queue = JSON.parse(await readFile(fixture.queuePath, "utf8")) as { next_task: string; tasks: Array<{ status: string }> };
    expect(queue.next_task).toBe("MEDIA-CRIT-01");
    expect(queue.tasks.map((task) => task.status)).toEqual(["open", "open"]);
  });

  it("refuses to advance when the expected output file is missing", async () => {
    const fixture = await createQueueFixture();

    await expect(completeNextCritiqueTask(fixture.queuePath, { cwd: fixture.rootDir })).rejects.toThrow(/missing/);

    const queue = JSON.parse(await readFile(fixture.queuePath, "utf8")) as { next_task: string; tasks: Array<{ status: string }> };
    expect(queue.next_task).toBe("MEDIA-CRIT-01");
    expect(queue.tasks.map((task) => task.status)).toEqual(["open", "open"]);
  });

  it("uses the Required Output path from a task brief when output points to instructions", async () => {
    const fixture = await createQueueFixture({
      next_task: "MEDIA-CRIT-01",
      tasks: [
        {
          id: "MEDIA-CRIT-01",
          status: "open",
          output: ".gstack/projects/test/rounds/round-01.md"
        }
      ]
    });
    await mkdir(join(fixture.rootDir, ".gstack", "projects", "test", "rounds"), { recursive: true });
    await writeFile(join(fixture.rootDir, ".gstack", "projects", "test", "rounds", "round-01.md"), "## Required Output\n\nWrite findings to:\n\n`.gstack/projects/test/rounds/round-01-output.md`\n", "utf8");

    const result = await getNextCritiqueTask(fixture.queuePath, fixture.rootDir);

    expect(result.outputPath).toBe(join(fixture.rootDir, ".gstack", "projects", "test", "rounds", "round-01-output.md"));
    expect(result.outputExists).toBe(false);
  });

  it("refuses to advance when the expected output file is empty", async () => {
    const fixture = await createQueueFixture();
    await mkdir(join(fixture.rootDir, ".gstack", "projects", "test", "rounds"), { recursive: true });
    await writeFile(join(fixture.rootDir, ".gstack", "projects", "test", "rounds", "round-01.md"), "", "utf8");

    await expect(completeNextCritiqueTask(fixture.queuePath, { cwd: fixture.rootDir })).rejects.toThrow(/empty/);

    const queue = JSON.parse(await readFile(fixture.queuePath, "utf8")) as { next_task: string; tasks: Array<{ status: string }> };
    expect(queue.next_task).toBe("MEDIA-CRIT-01");
    expect(queue.tasks.map((task) => task.status)).toEqual(["open", "open"]);
  });

  it("marks only one task done and advances to the next open task", async () => {
    const fixture = await createQueueFixture();
    await mkdir(join(fixture.rootDir, ".gstack", "projects", "test", "rounds"), { recursive: true });
    await writeFile(join(fixture.rootDir, ".gstack", "projects", "test", "rounds", "round-01.md"), "# Round 1\n", "utf8");

    const result = await completeNextCritiqueTask(fixture.queuePath, { taskId: "MEDIA-CRIT-01", cwd: fixture.rootDir });

    expect(result.completedTask.id).toBe("MEDIA-CRIT-01");
    expect(result.nextTask?.id).toBe("MEDIA-CRIT-02");
    const queue = JSON.parse(await readFile(fixture.queuePath, "utf8")) as { next_task: string; tasks: Array<{ status: string; completed_at?: string }> };
    expect(queue.next_task).toBe("MEDIA-CRIT-02");
    expect(queue.tasks[0]?.status).toBe("done");
    expect(queue.tasks[0]?.completed_at).toBeTruthy();
    expect(queue.tasks[1]?.status).toBe("open");
  });

  it("sets next_task to null when the final task completes", async () => {
    const fixture = await createQueueFixture({
      next_task: "MEDIA-CRIT-02",
      tasks: [
        {
          id: "MEDIA-CRIT-01",
          status: "done",
          output: ".gstack/projects/test/rounds/round-01.md"
        },
        {
          id: "MEDIA-CRIT-02",
          status: "open",
          output: ".gstack/projects/test/rounds/round-02.md"
        }
      ]
    });
    await mkdir(join(fixture.rootDir, ".gstack", "projects", "test", "rounds"), { recursive: true });
    await writeFile(join(fixture.rootDir, ".gstack", "projects", "test", "rounds", "round-02.md"), "# Round 2\n", "utf8");

    const result = await completeNextCritiqueTask(fixture.queuePath, { cwd: fixture.rootDir });

    expect(result.nextTask).toBeNull();
    const queue = JSON.parse(await readFile(fixture.queuePath, "utf8")) as { next_task: string | null; tasks: Array<{ status: string }> };
    expect(queue.next_task).toBeNull();
    expect(queue.tasks.map((task) => task.status)).toEqual(["done", "done"]);
  });

  it("fails when next_task points to a non-open task", async () => {
    const fixture = await createQueueFixture({
      next_task: "MEDIA-CRIT-01",
      tasks: [
        {
          id: "MEDIA-CRIT-01",
          status: "done",
          output: ".gstack/projects/test/rounds/round-01.md"
        }
      ]
    });

    await expect(getNextCritiqueTask(fixture.queuePath, fixture.rootDir)).rejects.toThrow(/expected open/);
  });
});

async function createQueueFixture(queue = defaultQueue()): Promise<{ rootDir: string; queuePath: string }> {
  const rootDir = await mkdtemp(join(tmpdir(), "farm-critique-runner-"));
  runDirs.push(rootDir);
  const queuePath = join(rootDir, ".gstack", "projects", "test", "media-critical-review-tasks-20260526.json");
  await mkdir(join(rootDir, ".gstack", "projects", "test"), { recursive: true });
  await writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  return { rootDir, queuePath };
}

function defaultQueue() {
  return {
    next_task: "MEDIA-CRIT-01",
    tasks: [
      {
        id: "MEDIA-CRIT-01",
        status: "open",
        priority: "P1",
        output: ".gstack/projects/test/rounds/round-01.md"
      },
      {
        id: "MEDIA-CRIT-02",
        status: "open",
        priority: "P1",
        output: ".gstack/projects/test/rounds/round-02.md"
      }
    ]
  };
}
