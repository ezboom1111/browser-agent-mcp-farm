import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer } from "../src/http-server.js";
import { EvidenceRunScheduler } from "../src/scheduler.js";

let servers: Server[] = [];

describe("createHttpServer", () => {
  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers = [];
  });

  it("reports health, queues evidence-run jobs, and exposes failure status", async () => {
    const server = createHttpServer();
    servers.push(server);
    const baseUrl = await listen(server);

    const health = await fetchJson<{ ok: boolean; service: string }>(`${baseUrl}/health`);
    expect(health.ok).toBe(true);
    expect(health.service).toBe("browser-agent-mcp-farm");
    expect(health).toHaveProperty("scheduler");

    const enqueue = await fetchJson<{ ok: boolean; job: { id: string; status: string } }>(`${baseUrl}/evidence-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "not-a-url" })
    });
    expect(enqueue.ok).toBe(true);
    expect(["queued", "running", "failed"]).toContain(enqueue.job.status);

    const job = await waitForJobStatus(baseUrl, enqueue.job.id, "failed");
    expect(job.status).toBe("failed");
    expect(job.error).toContain("url");
  });

  it("queues rich evidence-run payloads through HTTP", async () => {
    let received: unknown;
    const scheduler = new EvidenceRunScheduler({
      concurrency: 1,
      executor: async (input) => {
        received = input;
        return { ok: true, runDir: "run", reportPath: "report.md", claims: 1, claimGateOk: true };
      }
    });
    const server = createHttpServer({ scheduler });
    servers.push(server);
    const baseUrl = await listen(server);

    const enqueueResult = await fetchJson<{ ok: boolean; job: { id: string } }>(`${baseUrl}/evidence-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/",
        ocr: {
          enabled: true,
          maxFrames: 5,
          timeoutMs: 5000,
          language: "eng",
          minConfidence: 40
        },
        officialApi: {
          enabled: true,
          credentials: { youtubeApiKeyEnv: "YT_KEY" }
        }
      })
    });
    expect(enqueueResult.ok).toBe(true);
    await waitForJobStatus(baseUrl, enqueueResult.job.id, "completed");
    expect(received).toMatchObject({
      ocr: {
        enabled: true,
        maxFrames: 5,
        timeoutMs: 5000,
        language: "eng",
        minConfidence: 40
      },
      officialApi: {
        enabled: true,
        credentials: { youtubeApiKeyEnv: "YT_KEY" }
      }
    });
  });

  it("cancels queued jobs, deletes terminal jobs, and prunes retained terminal jobs", async () => {
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolvePromise) => {
      releaseSlow = resolvePromise;
    });
    const scheduler = new EvidenceRunScheduler({
      concurrency: 1,
      maxTerminalJobs: 10,
      executor: async (input, signal) => {
        if (input.url.includes("slow")) {
          await waitForReleaseOrAbort(slowGate, signal);
        }
        return { ok: true, runDir: "run", reportPath: "report.md", claims: 1, claimGateOk: true };
      }
    });
    const server = createHttpServer({ scheduler });
    servers.push(server);
    const baseUrl = await listen(server);

    try {
      const slow = await enqueue(baseUrl, "https://example.com/slow");
      await waitForJobStatus(baseUrl, slow.job.id, "running");

      const queued = await enqueue(baseUrl, "https://example.com/queued");
      expect(queued.job.status).toBe("queued");

      const canceled = await fetchJson<{ ok: boolean; job: { status: string; cancelReason: string; abortLatencyMs?: number } }>(`${baseUrl}/jobs/${queued.job.id}/cancel`, {
        method: "POST"
      });
      expect(canceled.ok).toBe(true);
      expect(canceled.job.status).toBe("canceled");
      expect(canceled.job.cancelReason).toBe("canceled by request");
      expect(canceled.job.abortLatencyMs).toBeGreaterThanOrEqual(0);

      const deleteCanceled = await fetchJson<{ ok: boolean; deleted: { id: string } }>(`${baseUrl}/jobs/${queued.job.id}`, {
        method: "DELETE"
      });
      expect(deleteCanceled.ok).toBe(true);
      expect(deleteCanceled.deleted.id).toBe(queued.job.id);

      const cancelRunning = await fetchJson<{ ok: boolean; job: { status: string; cancelRequestedAt?: string } }>(`${baseUrl}/jobs/${slow.job.id}/cancel`, {
        method: "POST"
      });
      expect(cancelRunning.ok).toBe(true);
      expect(cancelRunning.job.status).toBe("running");
      expect(cancelRunning.job.cancelRequestedAt).toBeDefined();
      const canceledRunning = await waitForJobStatus(baseUrl, slow.job.id, "canceled");
      expect(canceledRunning.abortLatencyMs).toBeGreaterThanOrEqual(0);

      const prune = await fetchJson<{ ok: boolean; pruned: Array<{ id: string }>; scheduler: { total: number } }>(`${baseUrl}/jobs/prune`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxTerminalJobs: 0 })
      });
      expect(prune.ok).toBe(true);
      expect(prune.pruned.map((job) => job.id)).toContain(slow.job.id);
      expect(prune.scheduler.total).toBe(0);
    } finally {
      releaseSlow?.();
    }
  });

  it("rejects invalid HTTP queue filters and prune inputs with client errors", async () => {
    const server = createHttpServer();
    servers.push(server);
    const baseUrl = await listen(server);

    const invalidStatus = await fetch(`${baseUrl}/jobs?status=unknown`);
    expect(invalidStatus.status).toBe(400);
    await expect(invalidStatus.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid job status filter: unknown"
    });

    const negativePrune = await fetch(`${baseUrl}/jobs/prune`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxTerminalJobs: -1 })
    });
    expect(negativePrune.status).toBe(400);
    await expect(negativePrune.json()).resolves.toMatchObject({
      ok: false,
      error: "maxTerminalJobs must be a non-negative integer"
    });

    const malformedJson = await fetch(`${baseUrl}/evidence-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    expect(malformedJson.status).toBe(400);
    await expect(malformedJson.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid JSON body"
    });
  });
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP test server did not bind to a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function waitForJobStatus(baseUrl: string, id: string, status: string): Promise<{ status: string; error?: string; abortLatencyMs?: number }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetchJson<{ job: { status: string; error?: string } }>(`${baseUrl}/jobs/${id}`);
    if (response.job.status === status) {
      return response.job;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error(`Job ${id} did not reach status ${status}`);
}

async function enqueue(baseUrl: string, url: string): Promise<{ ok: boolean; job: { id: string; status: string } }> {
  return await fetchJson(`${baseUrl}/evidence-run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url })
  });
}

async function waitForReleaseOrAbort(release: Promise<void>, signal: AbortSignal): Promise<void> {
  await Promise.race([
    release,
    new Promise<never>((_, reject) => {
      const listener = () => reject(new Error(String(signal.reason ?? "aborted")));
      signal.addEventListener("abort", listener, { once: true });
    })
  ]);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  return (await response.json()) as T;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    });
  });
}
