import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { EvidenceRunScheduler, type PruneTerminalJobsOptions, type ScheduledEvidenceRunStatus } from "./scheduler.js";
import type { EvidenceRunInput } from "./schemas.js";

export interface HttpServerOptions {
  scheduler?: EvidenceRunScheduler;
}

const JSON_BODY_LIMIT_BYTES = 1_000_000;
const SCHEDULED_STATUS_VALUES: ScheduledEvidenceRunStatus[] = ["queued", "running", "completed", "failed", "canceled"];

export function createHttpServer(options: HttpServerOptions = {}): Server {
  const scheduler = options.scheduler ?? new EvidenceRunScheduler(1);
  return createServer(async (request, response) => {
    try {
      await routeRequest(request, response, scheduler);
    } catch (error) {
      const statusCode = error instanceof HttpRequestError ? error.statusCode : 500;
      writeJson(response, statusCode, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

async function routeRequest(request: IncomingMessage, response: ServerResponse, scheduler: EvidenceRunScheduler): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, { ok: true, service: "browser-agent-mcp-farm", scheduler: scheduler.stats() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/jobs") {
    const status = url.searchParams.get("status");
    if (status !== null && !isScheduledStatus(status)) {
      throw new HttpRequestError(400, `invalid job status filter: ${status}`);
    }
    const jobs = scheduler.list().filter((job) => status === null || job.status === status);
    writeJson(response, 200, { ok: true, jobs, scheduler: scheduler.stats() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/jobs/prune") {
    const body = await readJson<{ olderThanMs?: unknown; maxTerminalJobs?: unknown }>(request);
    const pruned = scheduler.pruneTerminal(normalizePruneRequest(body));
    writeJson(response, 200, { ok: true, pruned, scheduler: scheduler.stats() });
    return;
  }

  const jobRoute = parseJobRoute(url.pathname);
  if (request.method === "POST" && jobRoute !== undefined && jobRoute.action === "cancel") {
    const result = scheduler.cancel(jobRoute.id);
    if (!result.ok) {
      writeJson(response, result.reason === "job not found" ? 404 : 409, {
        ok: false,
        reason: result.reason,
        ...(result.job === undefined ? {} : { job: result.job })
      });
      return;
    }
    writeJson(response, 200, { ok: true, job: result.job });
    return;
  }

  if (request.method === "DELETE" && jobRoute !== undefined && jobRoute.action === undefined) {
    const result = scheduler.delete(jobRoute.id);
    if (!result.ok) {
      writeJson(response, result.reason === "job not found" ? 404 : 409, {
        ok: false,
        reason: result.reason,
        ...(result.job === undefined ? {} : { job: result.job })
      });
      return;
    }
    writeJson(response, 200, { ok: true, deleted: result.job, scheduler: scheduler.stats() });
    return;
  }

  if (request.method === "GET" && jobRoute !== undefined && jobRoute.action === undefined) {
    const job = scheduler.get(jobRoute.id);
    if (job === undefined) {
      writeJson(response, 404, { ok: false, error: "job not found" });
      return;
    }
    writeJson(response, 200, { ok: true, job });
    return;
  }

  if (request.method === "POST" && url.pathname === "/evidence-run") {
    const body = await readJson<EvidenceRunInput>(request);
    const job = scheduler.enqueue(body);
    writeJson(response, 202, { ok: true, job });
    return;
  }

  writeJson(response, 404, { ok: false, error: "not found" });
}

function parseJobRoute(pathname: string): { id: string; action?: string } | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "jobs" || parts[1] === undefined || parts.length > 3) {
    return undefined;
  }
  return {
    id: parts[1],
    ...(parts[2] === undefined ? {} : { action: parts[2] })
  };
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > JSON_BODY_LIMIT_BYTES) {
      throw new HttpRequestError(413, `JSON body exceeds ${JSON_BODY_LIMIT_BYTES} bytes`);
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return (text.length === 0 ? {} : JSON.parse(text)) as T;
  } catch {
    throw new HttpRequestError(400, "invalid JSON body");
  }
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function normalizePruneRequest(body: { olderThanMs?: unknown; maxTerminalJobs?: unknown }): PruneTerminalJobsOptions {
  const options: PruneTerminalJobsOptions = {};
  if (body.olderThanMs !== undefined) {
    options.olderThanMs = nonNegativeInteger(body.olderThanMs, "olderThanMs");
  }
  if (body.maxTerminalJobs !== undefined) {
    options.maxTerminalJobs = nonNegativeInteger(body.maxTerminalJobs, "maxTerminalJobs");
  }
  return options;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpRequestError(400, `${field} must be a non-negative integer`);
  }
  return value;
}

function isScheduledStatus(status: string): status is ScheduledEvidenceRunStatus {
  return SCHEDULED_STATUS_VALUES.includes(status as ScheduledEvidenceRunStatus);
}

class HttpRequestError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
