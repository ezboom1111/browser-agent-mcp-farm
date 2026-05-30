import { randomUUID } from "node:crypto";
import { isAbortError } from "./abort.js";
import { normalizeEvidenceRunInput } from "./evidence-run-input.js";
import { runEvidenceWorkflow, type EvidenceWorkflowResult, type EvidenceWorkflowStageTiming } from "./evidence-runner.js";
import type { EvidenceRunInput } from "./schemas.js";

export type ScheduledEvidenceRunStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface EvidenceRunSchedulerOptions {
  concurrency?: number;
  maxTerminalJobs?: number;
  executor?: EvidenceRunExecutor;
}

export type EvidenceRunExecutor = (input: EvidenceRunInput, signal: AbortSignal) => Promise<EvidenceWorkflowResultSummary>;

export interface ScheduledEvidenceRun {
  id: string;
  status: ScheduledEvidenceRunStatus;
  createdAt: string;
  updatedAt: string;
  input: EvidenceRunInput;
  result?: EvidenceWorkflowResultSummary;
  error?: string;
  cancelReason?: string;
  cancelRequestedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  queueDurationMs?: number;
  runDurationMs?: number;
  totalDurationMs?: number;
  abortLatencyMs?: number;
}

export interface EvidenceWorkflowResultSummary {
  ok: boolean;
  runDir: string;
  reportPath: string;
  claims: number;
  claimGateOk?: boolean;
  stageTimings?: EvidenceWorkflowStageTiming[];
}

export class EvidenceRunScheduler {
  private readonly queue: string[] = [];
  private readonly jobs = new Map<string, ScheduledEvidenceRun>();
  private readonly concurrency: number;
  private readonly maxTerminalJobs: number;
  private readonly executor: EvidenceRunExecutor;
  private readonly runningControllers = new Map<string, AbortController>();
  private running = 0;

  constructor(options: number | EvidenceRunSchedulerOptions = 1) {
    const normalized = typeof options === "number" ? { concurrency: options } : options;
    this.concurrency = Math.max(1, Math.floor(normalized.concurrency ?? 1));
    this.maxTerminalJobs = Math.max(0, Math.floor(normalized.maxTerminalJobs ?? 500));
    this.executor = normalized.executor ?? defaultEvidenceRunExecutor;
  }

  enqueue(input: EvidenceRunInput): ScheduledEvidenceRun {
    const now = new Date().toISOString();
    const job: ScheduledEvidenceRun = {
      id: `job_${randomUUID()}`,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      input
    };
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    void this.pump();
    this.pruneTerminal({ maxTerminalJobs: this.maxTerminalJobs });
    return cloneJob(job);
  }

  get(id: string): ScheduledEvidenceRun | undefined {
    const job = this.jobs.get(id);
    return job === undefined ? undefined : cloneJob(job);
  }

  list(): ScheduledEvidenceRun[] {
    return [...this.jobs.values()].map(cloneJob);
  }

  stats(): EvidenceRunSchedulerStats {
    const counts = emptyStatusCounts();
    for (const job of this.jobs.values()) {
      counts[job.status] += 1;
    }
    return {
      total: this.jobs.size,
      queued: this.queue.length,
      running: this.running,
      concurrency: this.concurrency,
      maxTerminalJobs: this.maxTerminalJobs,
      counts
    };
  }

  cancel(id: string, reason = "canceled by request"): SchedulerMutationResult {
    const job = this.jobs.get(id);
    if (job === undefined) {
      return { ok: false, reason: "job not found" };
    }
    if (job.status === "running") {
      const controller = this.runningControllers.get(id);
      if (controller === undefined) {
        return { ok: false, job: cloneJob(job), reason: "running job has no abort controller" };
      }
      job.cancelReason = reason;
      job.cancelRequestedAt = new Date().toISOString();
      job.updatedAt = job.cancelRequestedAt;
      controller.abort(reason);
      return { ok: true, job: cloneJob(job) };
    }
    if (job.status !== "queued") {
      return { ok: false, job: cloneJob(job), reason: `cannot cancel ${job.status} job` };
    }
    const index = this.queue.indexOf(id);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
    job.cancelReason = reason;
    job.cancelRequestedAt = new Date().toISOString();
    updateJob(job, "canceled");
    this.pruneTerminal({ maxTerminalJobs: this.maxTerminalJobs });
    return { ok: true, job: cloneJob(job) };
  }

  delete(id: string): SchedulerMutationResult {
    const job = this.jobs.get(id);
    if (job === undefined) {
      return { ok: false, reason: "job not found" };
    }
    if (!isTerminalStatus(job.status)) {
      return { ok: false, job: cloneJob(job), reason: `cannot delete ${job.status} job` };
    }
    this.jobs.delete(id);
    return { ok: true, job: cloneJob(job) };
  }

  pruneTerminal(options: PruneTerminalJobsOptions = {}): ScheduledEvidenceRun[] {
    const terminalJobs = [...this.jobs.values()]
      .filter((job) => isTerminalStatus(job.status))
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
    const pruned: ScheduledEvidenceRun[] = [];
    const nowMs = Date.now();
    const olderThanMs = options.olderThanMs;

    for (const job of terminalJobs) {
      if (olderThanMs !== undefined && nowMs - Date.parse(job.updatedAt) >= olderThanMs) {
        this.jobs.delete(job.id);
        pruned.push(cloneJob(job));
      }
    }

    const maxTerminalJobs = options.maxTerminalJobs ?? this.maxTerminalJobs;
    if (maxTerminalJobs >= 0) {
      const remaining = [...this.jobs.values()]
        .filter((job) => isTerminalStatus(job.status))
        .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
      while (remaining.length > maxTerminalJobs) {
        const job = remaining.shift();
        if (job === undefined) {
          break;
        }
        this.jobs.delete(job.id);
        pruned.push(cloneJob(job));
      }
    }

    return pruned;
  }

  private async pump(): Promise<void> {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      if (id === undefined) {
        return;
      }
      const job = this.jobs.get(id);
      if (job === undefined || job.status !== "queued") {
        continue;
      }
      this.running += 1;
      void this.runJob(job).finally(() => {
        this.running -= 1;
        void this.pump();
      });
    }
  }

  private async runJob(job: ScheduledEvidenceRun): Promise<void> {
    const controller = new AbortController();
    this.runningControllers.set(job.id, controller);
    updateJob(job, "running");
    try {
      job.result = await this.executor(job.input, controller.signal);
      updateJob(job, job.cancelRequestedAt === undefined ? "completed" : "canceled");
    } catch (error) {
      if (job.cancelRequestedAt !== undefined || isAbortError(error)) {
        job.cancelReason = job.cancelReason ?? (error instanceof Error ? error.message : String(error));
        updateJob(job, "canceled");
      } else {
        job.error = error instanceof Error ? error.message : String(error);
        updateJob(job, "failed");
      }
    } finally {
      this.runningControllers.delete(job.id);
      this.pruneTerminal({ maxTerminalJobs: this.maxTerminalJobs });
    }
  }
}

export interface EvidenceRunSchedulerStats {
  total: number;
  queued: number;
  running: number;
  concurrency: number;
  maxTerminalJobs: number;
  counts: Record<ScheduledEvidenceRunStatus, number>;
}

export interface SchedulerMutationResult {
  ok: boolean;
  job?: ScheduledEvidenceRun;
  reason?: string;
}

export interface PruneTerminalJobsOptions {
  olderThanMs?: number;
  maxTerminalJobs?: number;
}

async function defaultEvidenceRunExecutor(input: EvidenceRunInput, signal: AbortSignal): Promise<EvidenceWorkflowResultSummary> {
  const options = await normalizeEvidenceRunInput(input);
  const result: EvidenceWorkflowResult = await runEvidenceWorkflow({ ...options, abortSignal: signal });
  return {
    ok: result.ok,
    runDir: result.runDir,
    reportPath: result.reportPath,
    claims: result.claims.length,
    stageTimings: result.stageTimings,
    ...(result.claimGate === undefined ? {} : { claimGateOk: result.claimGate.ok })
  };
}

function updateJob(job: ScheduledEvidenceRun, status: ScheduledEvidenceRunStatus): void {
  const now = new Date().toISOString();
  if (status === "running" && job.startedAt === undefined) {
    job.startedAt = now;
    job.queueDurationMs = elapsedMs(job.createdAt, now);
  }
  if (isTerminalStatus(status)) {
    job.finishedAt = now;
    job.totalDurationMs = elapsedMs(job.createdAt, now);
    if (job.startedAt !== undefined) {
      job.runDurationMs = elapsedMs(job.startedAt, now);
    }
    if (status === "canceled" && job.cancelRequestedAt !== undefined) {
      job.abortLatencyMs = elapsedMs(job.cancelRequestedAt, now);
    }
  }
  job.status = status;
  job.updatedAt = now;
}

function cloneJob(job: ScheduledEvidenceRun): ScheduledEvidenceRun {
  return JSON.parse(JSON.stringify(job)) as ScheduledEvidenceRun;
}

function isTerminalStatus(status: ScheduledEvidenceRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function emptyStatusCounts(): Record<ScheduledEvidenceRunStatus, number> {
  return {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    canceled: 0
  };
}

function elapsedMs(startIso: string, endIso: string): number {
  const elapsed = Date.parse(endIso) - Date.parse(startIso);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}
