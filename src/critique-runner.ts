import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface CritiqueTask {
  id: string;
  status: string;
  priority?: string;
  lens?: string;
  title?: string;
  output?: string;
  [key: string]: unknown;
}

export interface CritiqueTaskQueue {
  next_task?: string | null;
  tasks: CritiqueTask[];
  [key: string]: unknown;
}

export interface CritiqueTaskState {
  queuePath: string;
  task: CritiqueTask | null;
  outputPath: string | null;
  outputExists: boolean;
  outputBytes: number;
  complete: boolean;
}

export interface CompleteCritiqueTaskOptions {
  taskId?: string;
  cwd?: string;
}

export interface CompleteCritiqueTaskResult {
  ok: true;
  queuePath: string;
  completedTask: CritiqueTask;
  completedOutputPath: string;
  nextTask: CritiqueTask | null;
}

export class CritiqueRunnerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CritiqueRunnerError";
    this.code = code;
  }
}

export async function getNextCritiqueTask(queuePathInput?: string, cwd = process.cwd()): Promise<CritiqueTaskState> {
  const queuePath = await resolveCritiqueQueuePath(queuePathInput, cwd);
  const queue = await readQueue(queuePath);
  const task = getActiveTask(queue);
  if (task === null) {
    return {
      queuePath,
      task: null,
      outputPath: null,
      outputExists: false,
      outputBytes: 0,
      complete: true
    };
  }

  const outputPath = await resolveTaskOutputPath(queuePath, task, cwd);
  const outputStats = await stat(outputPath).catch(() => null);
  return {
    queuePath,
    task,
    outputPath,
    outputExists: outputStats !== null,
    outputBytes: outputStats?.size ?? 0,
    complete: false
  };
}

export async function completeNextCritiqueTask(queuePathInput?: string, options: CompleteCritiqueTaskOptions = {}): Promise<CompleteCritiqueTaskResult> {
  const cwd = options.cwd ?? process.cwd();
  const queuePath = await resolveCritiqueQueuePath(queuePathInput, cwd);
  const queue = await readQueue(queuePath);
  const task = getActiveTask(queue);
  if (task === null) {
    throw new CritiqueRunnerError("critique_queue_complete", "No open critique task remains.");
  }
  if (options.taskId !== undefined && options.taskId !== task.id) {
    throw new CritiqueRunnerError("critique_task_mismatch", `Expected next task ${task.id}, got ${options.taskId}.`);
  }

  const outputPath = await resolveTaskOutputPath(queuePath, task, cwd);
  const outputStats = await stat(outputPath).catch(() => null);
  if (outputStats === null) {
    throw new CritiqueRunnerError("critique_output_missing", `Required critique output is missing: ${outputPath}`);
  }
  if (outputStats.size === 0) {
    throw new CritiqueRunnerError("critique_output_empty", `Required critique output is empty: ${outputPath}`);
  }

  const taskIndex = queue.tasks.findIndex((candidate) => candidate.id === task.id);
  queue.tasks[taskIndex] = {
    ...task,
    status: "done",
    completed_at: new Date().toISOString()
  };

  const nextTask = queue.tasks.slice(taskIndex + 1).find((candidate) => candidate.status === "open") ?? null;
  queue.next_task = nextTask?.id ?? null;
  await writeQueue(queuePath, queue);

  return {
    ok: true,
    queuePath,
    completedTask: queue.tasks[taskIndex]!,
    completedOutputPath: outputPath,
    nextTask
  };
}

async function resolveCritiqueQueuePath(queuePathInput: string | undefined, cwd: string): Promise<string> {
  if (queuePathInput !== undefined) {
    return resolveExistingPath(queuePathInput, cwd);
  }

  const defaultQueue = await findDefaultCritiqueQueue(cwd);
  if (defaultQueue !== undefined) {
    return defaultQueue;
  }

  throw new CritiqueRunnerError("critique_queue_missing", "No critique queue provided and no media-critical-review-tasks-*.json queue was found.");
}

function resolveExistingPath(pathInput: string, cwd: string): string {
  if (isAbsolute(pathInput)) {
    return pathInput;
  }

  const candidates = [resolve(cwd, pathInput)];
  for (const ancestor of ancestors(cwd)) {
    candidates.push(resolve(ancestor, pathInput));
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

async function findDefaultCritiqueQueue(cwd: string): Promise<string | undefined> {
  for (const ancestor of ancestors(cwd)) {
    const projectsRoot = join(ancestor, ".gstack", "projects");
    if (!existsSync(projectsRoot)) {
      continue;
    }
    const projectDirs = await readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
    const matches: string[] = [];
    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory()) {
        continue;
      }
      const files = await readdir(join(projectsRoot, projectDir.name)).catch(() => []);
      for (const file of files) {
        if (/^media-critical-review-tasks-\d{8}\.json$/.test(file)) {
          matches.push(join(projectsRoot, projectDir.name, file));
        }
      }
    }
    if (matches.length > 0) {
      return matches.sort().at(-1);
    }
  }
  return undefined;
}

async function readQueue(queuePath: string): Promise<CritiqueTaskQueue> {
  const text = await readFile(queuePath, "utf8").catch((error: unknown) => {
    throw new CritiqueRunnerError("critique_queue_read_failed", error instanceof Error ? error.message : String(error));
  });
  const parsed = JSON.parse(text) as Partial<CritiqueTaskQueue>;
  if (!Array.isArray(parsed.tasks)) {
    throw new CritiqueRunnerError("critique_queue_invalid", `Critique queue must contain a tasks array: ${queuePath}`);
  }
  for (const task of parsed.tasks) {
    if (!task || typeof task.id !== "string" || typeof task.status !== "string") {
      throw new CritiqueRunnerError("critique_queue_invalid", `Every critique task must have string id and status fields: ${queuePath}`);
    }
  }
  return parsed as CritiqueTaskQueue;
}

async function writeQueue(queuePath: string, queue: CritiqueTaskQueue): Promise<void> {
  await mkdir(dirname(queuePath), { recursive: true });
  const tmp = `${queuePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  await rename(tmp, queuePath);
}

function getActiveTask(queue: CritiqueTaskQueue): CritiqueTask | null {
  const nextTaskId = queue.next_task;
  if (nextTaskId === null) {
    const openTask = queue.tasks.find((task) => task.status === "open");
    if (openTask !== undefined) {
      throw new CritiqueRunnerError("critique_queue_inconsistent", `Queue next_task is null but ${openTask.id} is still open.`);
    }
    return null;
  }
  if (nextTaskId === undefined || nextTaskId === "") {
    const openTask = queue.tasks.find((task) => task.status === "open");
    if (openTask === undefined) {
      return null;
    }
    throw new CritiqueRunnerError("critique_next_task_missing", `Queue has open task ${openTask.id} but no next_task pointer.`);
  }

  const task = queue.tasks.find((candidate) => candidate.id === nextTaskId);
  if (task === undefined) {
    throw new CritiqueRunnerError("critique_next_task_unknown", `Queue next_task points to an unknown task: ${nextTaskId}`);
  }
  if (task.status !== "open") {
    throw new CritiqueRunnerError("critique_next_task_not_open", `Queue next_task ${nextTaskId} has status ${task.status}, expected open.`);
  }
  return task;
}

async function resolveTaskOutputPath(queuePath: string, task: CritiqueTask, cwd: string): Promise<string> {
  const explicitOutput = task.result_output ?? task.required_output;
  if (typeof explicitOutput === "string" && explicitOutput.length > 0) {
    return resolveOutputPathString(queuePath, explicitOutput, cwd);
  }

  if (typeof task.output !== "string" || task.output.length === 0) {
    throw new CritiqueRunnerError("critique_output_missing_field", "Current critique task must define a non-empty output path.");
  }

  const taskOutputPath = resolveOutputPathString(queuePath, task.output, cwd);
  const requiredOutput = await readRequiredOutputFromTaskBrief(taskOutputPath);
  if (requiredOutput !== undefined) {
    return resolveOutputPathString(queuePath, requiredOutput, cwd);
  }

  return taskOutputPath;
}

function resolveOutputPathString(queuePath: string, output: string, cwd: string): string {
  if (isAbsolute(output)) {
    return output;
  }

  const projectRoot = inferProjectRootFromQueuePath(queuePath);
  const candidates = [projectRoot === undefined ? undefined : resolve(projectRoot, output), resolve(cwd, output), resolve(dirname(queuePath), output)].filter((candidate): candidate is string => candidate !== undefined);

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

async function readRequiredOutputFromTaskBrief(taskOutputPath: string): Promise<string | undefined> {
  if (!existsSync(taskOutputPath)) {
    return undefined;
  }
  const text = await readFile(taskOutputPath, "utf8").catch(() => "");
  const requiredOutputSection = text.match(/## Required Output[\s\S]*?`([^`]+)`/);
  const requiredOutput = requiredOutputSection?.[1]?.trim();
  return requiredOutput && requiredOutput.length > 0 ? requiredOutput : undefined;
}

function inferProjectRootFromQueuePath(queuePath: string): string | undefined {
  const normalized = queuePath.replaceAll("\\", "/");
  const marker = "/.gstack/projects/";
  const index = normalized.indexOf(marker);
  if (index === -1) {
    return undefined;
  }
  return queuePath.slice(0, index);
}

function ancestors(cwd: string): string[] {
  const result: string[] = [];
  let current = resolve(cwd);
  while (true) {
    result.push(current);
    const parent = dirname(current);
    if (parent === current) {
      return result;
    }
    current = parent;
  }
}
