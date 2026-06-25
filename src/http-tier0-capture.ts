import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { TLSSocket } from "node:tls";
import type { ArtifactRecord, ArtifactWriter } from "./artifact-writer.js";
import { assertDomainAllowed } from "./lease-manager.js";
import { attachTypedFacts, extractStructuredData } from "./structured-extractor.js";
import { captureTlsIdentity, sameConnectionTlsBindingEnabled, shapeSameConnectionTls, tlsBindingEnabled, type SameConnectionTls } from "./tls-identity.js";
import { buildCaptureTranscript, captureTranscriptEnabled, type TranscriptResponse } from "./capture-transcript.js";

// Tier-0 browserless capture (A1). For a source whose needed bytes are server-rendered, a plain
// HTTP GET produces the SAME artifact contract as the browser path — page_html, page_text, and a
// structured_data derivative — without launching Chromium. It is read-only, credential-free, and
// fences EVERY redirect hop against the lease's domain allow-list (SSRF guard) using the identical
// assertDomainAllowed the browser path uses. When the bytes are not server-rendered (client-only
// SPA), or the response is non-HTML / bot-blocked, tier-0 DECLINES (ok:false) and the caller
// escalates to the browser. Determinism is IMPROVED vs a rendered DOM: no JS, no ads, no timing.

export interface HttpTier0CaptureInput {
  runDir: string;
  url: string;
  /** Lease domain allow-list; every redirect hop is fenced against it. */
  allowedDomains: string[];
  writer: ArtifactWriter;
  captureId: string;
  contextToken: string;
  pageId: string;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
}

export interface HttpTier0CaptureResult {
  ok: boolean;
  /** Registered artifacts (page_html, page_text, optional structured_data). */
  records: ArtifactRecord[];
  finalUrl?: string;
  status?: number;
  /** Why tier-0 declined; the caller uses this to escalate to the browser. */
  reason?: string;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;

export async function httpTier0Capture(input: HttpTier0CaptureInput): Promise<HttpTier0CaptureResult> {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = input.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (input.signal !== undefined) {
    if (input.signal.aborted) {
      controller.abort();
    } else {
      input.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  try {
    // Acquire the final HTML (fenced redirects, content-type guard, byte cap). The default path uses
    // global fetch (byte-for-byte unchanged). When FARM_BIND_TLS_SAMECONN=1, an opt-in node:https
    // transport captures the cert from the SAME socket that delivered the bytes (D1, strong binding).
    const acquired = sameConnectionTlsBindingEnabled() ? await acquireViaHttps(input.url, input.allowedDomains, controller.signal, maxBytes, maxRedirects) : await acquireViaFetch(input.url, input.allowedDomains, controller.signal, maxBytes, maxRedirects);
    if ("declineReason" in acquired) {
      return { ok: false, records: [], ...(acquired.status === undefined ? {} : { status: acquired.status }), reason: acquired.declineReason };
    }
    const { status, finalUrl, html } = acquired;

    const text = htmlToVisibleText(html);
    // SPA-shell guard: a client-only page serves an (almost) empty body plus a hydration payload the
    // browser would render. Accepting that as tier-0 evidence would silently register an incomplete
    // capture, so DECLINE and let the caller escalate to a real browser.
    if (looksLikeClientRenderedShell(html, text)) {
      return { ok: false, records: [], status, reason: `tier-0 declined: client-rendered shell (visible text ${text.trim().length} chars with a hydration/mount marker; the browser must render it)` };
    }
    const title = extractTitle(html);
    // Capture-binding (Tier 2). The same-connection cert (D1) is captured on the https path; otherwise,
    // if FARM_BIND_TLS=1, a best-effort SEPARATE handshake records the (weaker) server TLS identity.
    const serverTlsIdentity = acquired.sameConnectionTls === undefined && tlsBindingEnabled() ? await captureTlsIdentity(finalUrl).catch(() => undefined) : undefined;
    const tlsMetadata = acquired.sameConnectionTls !== undefined ? { sameConnectionTls: acquired.sameConnectionTls } : serverTlsIdentity !== undefined ? { serverTlsIdentity } : {};

    // Page bundle: html -> page_html, text -> page_text by per-artifact inference. NO evidenceKind
    // override here (a single override would force BOTH artifacts to one kind).
    const pageRecords = await input.writer.writeCaptureBundle({
      runDir: input.runDir,
      sourceUrl: input.url,
      contextToken: input.contextToken,
      pageId: input.pageId,
      captureId: input.captureId,
      html,
      text,
      metadata: { ...(title === undefined ? {} : { title }), finalUrl, status: "ok", captureTier: "http_fetch", ...tlsMetadata },
      captureMethod: "http-fetch"
    });
    const records: ArtifactRecord[] = [...pageRecords];

    // Capture transcript (origin-binding Phase 0, opt-in FARM_CAPTURE_TRANSCRIPT=1). A capturer-attested
    // record of the responses, bound to the registered page_html artifact so the gate can cross-check the
    // digest. Honestly NOT origin proof (TLS deniability); see capture-transcript.ts / the design.
    if (captureTranscriptEnabled()) {
      const htmlRecord = pageRecords.find((record) => record.path.endsWith(".html"));
      if (htmlRecord !== undefined) {
        const response: TranscriptResponse = { url: finalUrl, status, bodySha256: htmlRecord.sha256 };
        if (acquired.contentType.length > 0) {
          response.contentType = acquired.contentType;
        }
        const transcript = buildCaptureTranscript({
          finalUrl,
          pageBody: html,
          responses: [response],
          binds: { path: htmlRecord.path, sha256: htmlRecord.sha256 },
          ...(acquired.sameConnectionTls === undefined ? {} : { certIdentity: acquired.sameConnectionTls as unknown as Record<string, unknown> })
        });
        const transcriptRecords = await input.writer.writeCaptureBundle({
          runDir: input.runDir,
          sourceUrl: input.url,
          contextToken: input.contextToken,
          pageId: input.pageId,
          captureId: `${input.captureId}-transcript`,
          text: JSON.stringify(transcript),
          evidenceKind: "capture_transcript",
          captureMethod: "capture-transcript"
        });
        records.push(...transcriptRecords);
      }
    }

    // structured_data via a SEPARATE bundle call (its single evidenceKind override applies only here).
    const structured = extractStructuredData(html);
    attachTypedFacts(structured, text); // typed facts from the browserless visible text (engine #4)
    const hasStructured = structured.jsonLd.length > 0 || structured.hydration.length > 0 || Object.keys(structured.openGraph).length > 0 || structured.summary.name !== undefined || structured.tables.length > 0 || (structured.typedFacts?.length ?? 0) > 0;
    if (hasStructured) {
      const structuredRecords = await input.writer.writeCaptureBundle({
        runDir: input.runDir,
        sourceUrl: input.url,
        contextToken: input.contextToken,
        pageId: input.pageId,
        captureId: `${input.captureId}-structured`,
        text: JSON.stringify(structured),
        evidenceKind: "structured_data",
        captureMethod: "http-fetch-structured"
      });
      records.push(...structuredRecords);
    }

    return { ok: true, finalUrl, status, records };
  } catch (error) {
    return { ok: false, records: [], reason: `tier-0 declined: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

interface AcquiredHtml {
  status: number;
  finalUrl: string;
  contentType: string;
  html: string;
  sameConnectionTls?: SameConnectionTls;
}
interface AcquireDecline {
  declineReason: string;
  status?: number;
}

const HTML_CONTENT_TYPE = (contentType: string): boolean => contentType === "" || contentType.includes("text/html") || contentType.includes("application/xhtml");

// Default acquisition via global fetch — byte-for-byte the original tier-0 behaviour.
async function acquireViaFetch(startUrl: string, allowedDomains: string[], signal: AbortSignal, maxBytes: number, maxRedirects: number): Promise<AcquiredHtml | AcquireDecline> {
  let currentUrl = startUrl;
  let response: Response | undefined;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (parseHttpUrl(currentUrl) === undefined) {
      return { declineReason: `tier-0 declined: non-http(s) url ${currentUrl}` };
    }
    assertDomainAllowed(allowedDomains, currentUrl);
    response = await fetch(currentUrl, { redirect: "manual", signal, headers: { accept: "text/html,application/xhtml+xml" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null) {
        break;
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    break;
  }
  if (response === undefined) {
    return { declineReason: "tier-0 declined: too many redirects" };
  }
  if (!response.ok) {
    return { declineReason: `tier-0 declined: http ${response.status}`, status: response.status };
  }
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!HTML_CONTENT_TYPE(contentType)) {
    return { declineReason: `tier-0 declined: non-html content-type '${contentType}'`, status: response.status };
  }
  const html = await response.text();
  if (html.length > maxBytes) {
    return { declineReason: `tier-0 declined: body ${html.length} exceeds maxBytes ${maxBytes}`, status: response.status };
  }
  return { status: response.status, finalUrl: response.url.length > 0 ? response.url : currentUrl, contentType, html };
}

export type HttpsOneShot = (parsed: URL, signal: AbortSignal, maxBytes: number) => Promise<HttpsOneShotResult>;

// Opt-in acquisition via node:https so the certificate is captured from the SAME socket that delivered
// the bytes (D1). Mirrors the fetch path's fenced-redirect / content-type / byte-cap contract. The
// oneShot transport is injectable so the redirect/decline/shaping logic is unit-testable without TLS.
export async function acquireViaHttps(startUrl: string, allowedDomains: string[], signal: AbortSignal, maxBytes: number, maxRedirects: number, oneShot: HttpsOneShot = httpsOneShot): Promise<AcquiredHtml | AcquireDecline> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsed = parseHttpUrl(currentUrl);
    if (parsed === undefined) {
      return { declineReason: `tier-0 declined: non-http(s) url ${currentUrl}` };
    }
    assertDomainAllowed(allowedDomains, currentUrl);
    const result = await oneShot(parsed, signal, maxBytes);
    if (result.status >= 300 && result.status < 400 && result.location !== undefined) {
      currentUrl = new URL(result.location, currentUrl).toString();
      continue;
    }
    if (!(result.status >= 200 && result.status < 300)) {
      return { declineReason: `tier-0 declined: http ${result.status}`, status: result.status };
    }
    if (!HTML_CONTENT_TYPE(result.contentType)) {
      return { declineReason: `tier-0 declined: non-html content-type '${result.contentType}'`, status: result.status };
    }
    if (result.tooLarge) {
      return { declineReason: `tier-0 declined: body exceeds maxBytes ${maxBytes}`, status: result.status };
    }
    const acquired: AcquiredHtml = { status: result.status, finalUrl: currentUrl, contentType: result.contentType, html: result.body };
    if (parsed.protocol === "https:" && result.peerCert !== undefined) {
      acquired.sameConnectionTls = shapeSameConnectionTls(parsed.hostname, parsed.port.length > 0 ? Number(parsed.port) : 443, result.peerCert, {
        authorized: result.authorized ?? false,
        ...(result.protocol === undefined ? {} : { protocol: result.protocol }),
        ...(result.authorizationError === undefined ? {} : { authorizationError: result.authorizationError })
      });
    }
    return acquired;
  }
  return { declineReason: "tier-0 declined: too many redirects" };
}

export interface HttpsOneShotResult {
  status: number;
  location?: string;
  contentType: string;
  body: string;
  tooLarge: boolean;
  peerCert?: { subject?: { CN?: string }; issuer?: { CN?: string; O?: string }; valid_from?: string; valid_to?: string; fingerprint256?: string };
  protocol?: string;
  authorized?: boolean;
  authorizationError?: string;
}

// One GET (manual redirect: returns status+location for a 3xx). Captures the peer cert from the
// response socket for https. Honours the abort signal and the byte cap (destroys the request when over).
function httpsOneShot(parsed: URL, signal: AbortSignal, maxBytes: number): Promise<HttpsOneShotResult> {
  return new Promise((resolve, reject) => {
    const isHttps = parsed.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port.length > 0 ? Number(parsed.port) : isHttps ? 443 : 80,
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      headers: { accept: "text/html,application/xhtml+xml" },
      signal,
      ...(isHttps ? { rejectUnauthorized: false, servername: parsed.hostname } : {})
    };
    const req = requestFn(options, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
      const location = typeof res.headers.location === "string" ? res.headers.location : undefined;
      let peerCert: HttpsOneShotResult["peerCert"];
      let protocol: string | undefined;
      let authorized: boolean | undefined;
      let authorizationError: string | undefined;
      if (isHttps) {
        const socket = res.socket as TLSSocket;
        peerCert = socket.getPeerCertificate() as HttpsOneShotResult["peerCert"];
        authorized = socket.authorized;
        const negotiated = socket.getProtocol();
        if (negotiated !== null) {
          protocol = negotiated;
        }
        const authError = socket.authorizationError;
        if (authError !== null && authError !== undefined) {
          authorizationError = authError instanceof Error ? authError.message : String(authError);
        }
      }
      // Conditional spread so an absent field is OMITTED (not present-as-undefined).
      const tlsFields = { ...(peerCert === undefined ? {} : { peerCert }), ...(protocol === undefined ? {} : { protocol }), ...(authorized === undefined ? {} : { authorized }), ...(authorizationError === undefined ? {} : { authorizationError }) };
      if (status >= 300 && status < 400 && location !== undefined) {
        res.resume(); // drain; we follow the redirect on a new request
        resolve({ status, location, contentType, body: "", tooLarge: false, ...tlsFields });
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      let tooLarge = false;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          tooLarge = true;
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8"), tooLarge, ...tlsFields }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

// Below this much visible server-rendered text, a hydration/mount marker is treated as a
// client-rendered shell (tier-0 declines). At or above it, the page has enough server-rendered text
// to cite even if it also hydrates, so tier-0 keeps it.
const SHELL_VISIBLE_TEXT_MAX = 200;
// An empty client mount point (the framework renders into it in the browser; the server ships it empty).
const EMPTY_ROOT_MOUNT_RE = /<div\b[^>]*\bid\s*=\s*("|')(root|__next|__nuxt|app|q-app|svelte)\1[^>]*>\s*<\/div>/i;
// Framework hydration globals that signal the real content arrives via client-side render.
const HYDRATION_HINT_RE = /__NEXT_DATA__|window\.__NUXT__|__remixContext|__APOLLO_STATE__|__sveltekit/;
// Naver desktop blog post URLs can serve only a title plus an iframe shell to browserless HTTP.
// The isolated browser path can read the public same-origin frame text, so tier-0 should decline.
const PROVIDER_IFRAME_SHELL_RE = /<iframe\b[^>]*(?:id|name)\s*=\s*("|')mainFrame\1[^>]*>|(?:PostView|screenFrame)\.nhn|blog\.naver\.com\/PostView/i;

/**
 * True when the fetched HTML is a client-rendered shell: (almost) no visible server-rendered text
 * AND a hydration/empty-mount marker. Pure + deterministic so the tier-0 decline is testable. JSON-LD
 * / Open Graph alone do NOT count — a fully server-rendered page can carry them, and a short page with
 * real `<h1>`/`<p>` text and no mount marker is kept.
 */
export function looksLikeClientRenderedShell(html: string, visibleText: string): boolean {
  const length = visibleText.trim().length;
  if (length === 0) {
    return true; // nothing a human could read server-rendered; the browser must render it
  }
  if (length >= SHELL_VISIBLE_TEXT_MAX) {
    return false; // enough server-rendered text to cite, even if the page also hydrates
  }
  return EMPTY_ROOT_MOUNT_RE.test(html) || HYDRATION_HINT_RE.test(html) || PROVIDER_IFRAME_SHELL_RE.test(html);
}

function parseHttpUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (match === null) {
    return undefined;
  }
  const title = (match[1] ?? "").replace(/\s+/g, " ").trim();
  return title.length > 0 ? title : undefined;
}

// Deterministic HTML -> visible text: drop comments + non-content elements, strip tags, decode the
// common named entities, collapse whitespace. Not as precise as a browser's innerText, but pure and
// byte-reproducible — enough for the cite-or-fail visible-text anchor.
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
