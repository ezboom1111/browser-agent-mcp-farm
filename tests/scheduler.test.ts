import { describe, expect, it } from "vitest";
import { EvidenceRunScheduler, type ScheduledEvidenceRun } from "../src/scheduler.js";

describe("EvidenceRunScheduler", () => {
  it("retains only the configured number of terminal jobs", async () => {
    const scheduler = new EvidenceRunScheduler({
      concurrency: 1,
      maxTerminalJobs: 1,
      executor: async () => ({ ok: true, runDir: "run", reportPath: "report.md", claims: 1 })
    });

    const first = scheduler.enqueue({ url: "https://example.com/first" });
    await waitForStatus(scheduler, first.id, "completed");

    const second = scheduler.enqueue({ url: "https://example.com/second" });
    await waitForStatus(scheduler, second.id, "completed");

    expect(scheduler.get(first.id)).toBeUndefined();
    const retained = scheduler.get(second.id);
    expect(retained?.status).toBe("completed");
    expect(retained?.startedAt).toBeDefined();
    expect(retained?.finishedAt).toBeDefined();
    expect(retained?.queueDurationMs).toBeGreaterThanOrEqual(0);
    expect(retained?.runDurationMs).toBeGreaterThanOrEqual(0);
    expect(retained?.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(scheduler.stats().counts.completed).toBe(1);
  });

  it("records queued cancellation diagnostics", async () => {
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolvePromise) => {
      releaseSlow = resolvePromise;
    });
    const scheduler = new EvidenceRunScheduler({
      concurrency: 1,
      executor: async (input) => {
        if (input.url.includes("slow")) {
          await slowGate;
        }
        return { ok: true, runDir: "run", reportPath: "report.md", claims: 1 };
      }
    });

    try {
      const slow = scheduler.enqueue({ url: "https://example.com/slow" });
      await waitForStatus(scheduler, slow.id, "running");
      const job = scheduler.enqueue({ url: "https://example.com/queued-cancel" });
      const result = scheduler.cancel(job.id);

      expect(result.ok).toBe(true);
      expect(result.job?.status).toBe("canceled");
      expect(result.job?.cancelRequestedAt).toBeDefined();
      expect(result.job?.finishedAt).toBeDefined();
      expect(result.job?.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.job?.abortLatencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      releaseSlow?.();
    }
  });

  it("cancels a running job through an abort signal", async () => {
    const scheduler = new EvidenceRunScheduler({
      concurrency: 1,
      executor: async (_input, signal) => {
        await rejectOnAbort(signal);
        return { ok: true, runDir: "run", reportPath: "report.md", claims: 1 };
      }
    });

    const job = scheduler.enqueue({ url: "https://example.com/running" });
    await waitForStatus(scheduler, job.id, "running");

    const result = scheduler.cancel(job.id);
    expect(result.ok).toBe(true);
    expect(result.job?.status).toBe("running");
    expect(result.job?.cancelRequestedAt).toBeDefined();

    const canceled = await waitForStatus(scheduler, job.id, "canceled");
    expect(canceled.cancelReason).toBe("canceled by request");
    expect(canceled.startedAt).toBeDefined();
    expect(canceled.finishedAt).toBeDefined();
    expect(canceled.queueDurationMs).toBeGreaterThanOrEqual(0);
    expect(canceled.runDurationMs).toBeGreaterThanOrEqual(0);
    expect(canceled.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(canceled.abortLatencyMs).toBeGreaterThanOrEqual(0);
  });
});

async function waitForStatus(scheduler: EvidenceRunScheduler, id: string, status: ScheduledEvidenceRun["status"]): Promise<ScheduledEvidenceRun> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = scheduler.get(id);
    if (job?.status === status) {
      return job;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Job ${id} did not reach status ${status}`);
}

function rejectOnAbort(signal: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    const listener = () => reject(new Error(String(signal.reason ?? "aborted")));
    signal.addEventListener("abort", listener, { once: true });
  });
}
