import { isIP } from "node:net";
import type { ArtifactRecord, ArtifactWriter } from "./artifact-writer.js";

export type PublicGatewayKey = "jina_reader" | "wayback_latest";

export interface PublicGatewayCandidate {
  key: PublicGatewayKey;
  url: string;
  sourceUrl: string;
  reason: string;
}

export interface PublicGatewayAttempt {
  key: PublicGatewayKey;
  gatewayUrl: string;
  status: "ok" | "declined" | "error";
  statusCode?: number;
  reason?: string;
}

export interface PublicGatewayAssessment {
  status: "skipped" | "ok" | "declined";
  attempts: PublicGatewayAttempt[];
  reason?: string;
}

export interface PublicGatewayCaptureResult extends PublicGatewayAssessment {
  ok: boolean;
  records: ArtifactRecord[];
}

export interface PublicGatewayCaptureInput {
  runDir: string;
  url: string;
  writer: ArtifactWriter;
  captureId: string;
  contextToken: string;
  pageId: string;
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export type PublicGatewayCapture = (input: PublicGatewayCaptureInput) => Promise<PublicGatewayCaptureResult>;

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;
const MIN_GATEWAY_TEXT_CHARS = 80;
const CHALLENGE_RE = /\b(log in to continue|login required|sign in to view|captcha|not a robot|access denied|verify you are human|checking your browser)\b/i;

export function buildPublicGatewayCandidates(sourceUrl: string): PublicGatewayCandidate[] {
  if (!isPublicHttpUrl(sourceUrl)) {
    return [];
  }
  return [
    {
      key: "jina_reader",
      url: `https://r.jina.ai/${sourceUrl}`,
      sourceUrl,
      reason: "Read the public URL through Jina Reader's no-key URL-prefix gateway and register the returned markdown/text bytes as untrusted gateway evidence."
    },
    {
      key: "wayback_latest",
      url: `https://archive.org/wayback/available?url=${encodeURIComponent(sourceUrl)}`,
      sourceUrl,
      reason: "Ask the Internet Archive Wayback availability endpoint for the latest public snapshot, then register the returned archived page bytes when available."
    }
  ];
}

export async function publicGatewayCapture(input: PublicGatewayCaptureInput): Promise<PublicGatewayCaptureResult> {
  const candidates = buildPublicGatewayCandidates(input.url);
  if (candidates.length === 0) {
    return skippedPublicGatewayCapture("no public http(s) gateway candidate; local/private/internal URLs are not sent to third-party readers");
  }

  const attempts: PublicGatewayAttempt[] = [];
  for (const candidate of candidates) {
    const result = await tryGatewayCandidate(input, candidate);
    attempts.push(result.attempt);
    if (result.records !== undefined) {
      return {
        ok: true,
        status: "ok",
        attempts,
        records: result.records
      };
    }
  }

  return {
    ok: false,
    status: "declined",
    attempts,
    records: [],
    reason: attempts.at(-1)?.reason ?? "all public gateway candidates declined"
  };
}

export function skippedPublicGatewayCapture(reason: string): PublicGatewayCaptureResult {
  return {
    ok: false,
    status: "skipped",
    attempts: [],
    records: [],
    reason
  };
}

export function isPublicHttpUrl(value: string): boolean {
  const parsed = parseHttpUrl(value);
  if (parsed === undefined) {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false;
  }
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    return isPublicIpv4(host);
  }
  if (ipVersion === 6) {
    return isPublicIpv6(host);
  }
  return host.includes(".");
}

async function tryGatewayCandidate(input: PublicGatewayCaptureInput, candidate: PublicGatewayCandidate): Promise<{ attempt: PublicGatewayAttempt; records?: ArtifactRecord[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  if (input.signal !== undefined) {
    if (input.signal.aborted) {
      controller.abort();
    } else {
      input.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  try {
    if (candidate.key === "wayback_latest") {
      return await tryWaybackCandidate(input, candidate, controller.signal);
    }
    const fetcher = input.fetch ?? fetch;
    const response = await fetcher(candidate.url, {
      signal: controller.signal,
      headers: { accept: "text/plain,text/markdown,*/*" }
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        attempt: {
          key: candidate.key,
          gatewayUrl: candidate.url,
          status: "declined",
          statusCode: response.status,
          reason: `gateway declined: http ${response.status}`
        }
      };
    }
    if (Buffer.byteLength(text, "utf8") > (input.maxBytes ?? DEFAULT_MAX_BYTES)) {
      return {
        attempt: {
          key: candidate.key,
          gatewayUrl: candidate.url,
          status: "declined",
          statusCode: response.status,
          reason: `gateway declined: body exceeds maxBytes ${input.maxBytes ?? DEFAULT_MAX_BYTES}`
        }
      };
    }
    const validation = validateGatewayText(text);
    if (validation !== undefined) {
      return {
        attempt: {
          key: candidate.key,
          gatewayUrl: candidate.url,
          status: "declined",
          statusCode: response.status,
          reason: validation
        }
      };
    }

    const records = await writeGatewayBundle(input, candidate, {
      text,
      gatewayStatus: response.status,
      contentType: response.headers.get("content-type") ?? "text/plain"
    });
    return {
      attempt: {
        key: candidate.key,
        gatewayUrl: candidate.url,
        status: "ok",
        statusCode: response.status
      },
      records
    };
  } catch (error) {
    return {
      attempt: {
        key: candidate.key,
        gatewayUrl: candidate.url,
        status: "error",
        reason: `gateway error: ${error instanceof Error ? error.message : String(error)}`
      }
    };
  } finally {
    if (input.signal !== undefined) {
      input.signal.removeEventListener("abort", onAbort);
    }
    clearTimeout(timer);
  }
}

async function tryWaybackCandidate(input: PublicGatewayCaptureInput, candidate: PublicGatewayCandidate, signal: AbortSignal): Promise<{ attempt: PublicGatewayAttempt; records?: ArtifactRecord[] }> {
  const fetcher = input.fetch ?? fetch;
  const availabilityResponse = await fetcher(candidate.url, {
    signal,
    headers: { accept: "application/json" }
  });
  const availabilityText = await availabilityResponse.text();
  if (!availabilityResponse.ok) {
    return {
      attempt: {
        key: candidate.key,
        gatewayUrl: candidate.url,
        status: "declined",
        statusCode: availabilityResponse.status,
        reason: `wayback availability declined: http ${availabilityResponse.status}`
      }
    };
  }
  const snapshotUrl = parseWaybackSnapshotUrl(availabilityText);
  if (snapshotUrl === undefined) {
    return {
      attempt: {
        key: candidate.key,
        gatewayUrl: candidate.url,
        status: "declined",
        statusCode: availabilityResponse.status,
        reason: "wayback availability declined: no usable closest snapshot"
      }
    };
  }

  const snapshotResponse = await fetcher(snapshotUrl, {
    signal,
    headers: { accept: "text/html,text/plain,*/*" }
  });
  const snapshotBody = await snapshotResponse.text();
  if (!snapshotResponse.ok) {
    return {
      attempt: {
        key: candidate.key,
        gatewayUrl: candidate.url,
        status: "declined",
        statusCode: snapshotResponse.status,
        reason: `wayback snapshot declined: http ${snapshotResponse.status}`
      }
    };
  }
  if (Buffer.byteLength(snapshotBody, "utf8") > (input.maxBytes ?? DEFAULT_MAX_BYTES)) {
    return {
      attempt: {
        key: candidate.key,
        gatewayUrl: candidate.url,
        status: "declined",
        statusCode: snapshotResponse.status,
        reason: `wayback snapshot declined: body exceeds maxBytes ${input.maxBytes ?? DEFAULT_MAX_BYTES}`
      }
    };
  }

  const contentType = snapshotResponse.headers.get("content-type") ?? "text/plain";
  const isHtml = contentType.toLowerCase().includes("text/html");
  const visibleText = isHtml ? htmlToVisibleText(snapshotBody) : snapshotBody;
  const validation = validateGatewayText(visibleText);
  if (validation !== undefined) {
    return {
      attempt: {
        key: candidate.key,
        gatewayUrl: candidate.url,
        status: "declined",
        statusCode: snapshotResponse.status,
        reason: validation.replace("gateway declined", "wayback snapshot declined")
      }
    };
  }

  const records = await writeGatewayBundle(input, candidate, {
    text: visibleText,
    ...(isHtml ? { html: snapshotBody } : {}),
    gatewayStatus: snapshotResponse.status,
    contentType,
    gatewaySnapshotUrl: snapshotUrl
  });
  return {
    attempt: {
      key: candidate.key,
      gatewayUrl: candidate.url,
      status: "ok",
      statusCode: snapshotResponse.status
    },
    records
  };
}

async function writeGatewayBundle(
  input: PublicGatewayCaptureInput,
  candidate: PublicGatewayCandidate,
  captured: {
    text: string;
    html?: string;
    gatewayStatus: number;
    contentType: string;
    gatewaySnapshotUrl?: string;
  }
): Promise<ArtifactRecord[]> {
  return input.writer.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: input.url,
    contextToken: input.contextToken,
    pageId: input.pageId,
    captureId: `${input.captureId}-${candidate.key}`,
    metadata: {
      captureTier: "feed",
      gateway: candidate.key,
      gatewayUrl: candidate.url,
      gatewayStatus: captured.gatewayStatus,
      contentType: captured.contentType,
      ...(captured.gatewaySnapshotUrl === undefined ? {} : { gatewaySnapshotUrl: captured.gatewaySnapshotUrl })
    },
    ...(captured.html === undefined ? {} : { html: captured.html }),
    text: captured.text,
    captureMethod: `public-gateway:${candidate.key}`,
    toolName: "public_gateway_capture",
    evidenceKind: "page_text",
    note: candidate.reason
  });
}

function parseWaybackSnapshotUrl(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as {
      archived_snapshots?: {
        closest?: {
          available?: boolean;
          url?: string;
        };
      };
    };
    const closest = parsed.archived_snapshots?.closest;
    if (closest?.available !== true || typeof closest.url !== "string") {
      return undefined;
    }
    const snapshotUrl = new URL(closest.url);
    return snapshotUrl.protocol === "https:" && snapshotUrl.hostname === "web.archive.org" ? snapshotUrl.toString() : undefined;
  } catch {
    return undefined;
  }
}

function validateGatewayText(text: string): string | undefined {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < MIN_GATEWAY_TEXT_CHARS) {
    return `gateway declined: recovered text too thin (${trimmed.length} chars)`;
  }
  if (CHALLENGE_RE.test(trimmed)) {
    return "gateway declined: recovered text still appears to be an access or challenge surface";
  }
  return undefined;
}

function htmlToVisibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPublicIpv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a = 0, b = 0] = parts;
  if (a === 10 || a === 127 || a === 0 || a >= 224) {
    return false;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return false;
  }
  if (a === 192 && b === 168) {
    return false;
  }
  if (a === 169 && b === 254) {
    return false;
  }
  return true;
}

function isPublicIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized !== "::1" && !normalized.startsWith("fc") && !normalized.startsWith("fd") && !normalized.startsWith("fe80");
}
