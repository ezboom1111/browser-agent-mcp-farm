import type { ArtifactRecord, ArtifactWriter } from "./artifact-writer.js";
import { assertDomainAllowed } from "./lease-manager.js";
import { extractStructuredData } from "./structured-extractor.js";

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
    let currentUrl = input.url;
    let response: Response | undefined;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (parseHttpUrl(currentUrl) === undefined) {
        return { ok: false, records: [], reason: `tier-0 declined: non-http(s) url ${currentUrl}` };
      }
      // Fence every hop against the lease allow-list (SSRF / off-domain redirect guard). A
      // credentialed lease would also fail closed here on an empty allow-list.
      assertDomainAllowed(input.allowedDomains, currentUrl);
      response = await fetch(currentUrl, { redirect: "manual", signal: controller.signal, headers: { accept: "text/html,application/xhtml+xml" } });
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
      return { ok: false, records: [], reason: "tier-0 declined: too many redirects" };
    }
    if (!response.ok) {
      return { ok: false, records: [], status: response.status, reason: `tier-0 declined: http ${response.status}` };
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType !== "" && !contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { ok: false, records: [], status: response.status, reason: `tier-0 declined: non-html content-type '${contentType}'` };
    }
    const html = await response.text();
    if (html.length > maxBytes) {
      return { ok: false, records: [], status: response.status, reason: `tier-0 declined: body ${html.length} exceeds maxBytes ${maxBytes}` };
    }

    const text = htmlToVisibleText(html);
    const finalUrl = response.url.length > 0 ? response.url : currentUrl;
    const title = extractTitle(html);

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
      metadata: { ...(title === undefined ? {} : { title }), finalUrl, status: "ok", captureTier: "http_fetch" },
      captureMethod: "http-fetch"
    });
    const records: ArtifactRecord[] = [...pageRecords];

    // structured_data via a SEPARATE bundle call (its single evidenceKind override applies only here).
    const structured = extractStructuredData(html);
    const hasStructured = structured.jsonLd.length > 0 || structured.hydration.length > 0 || Object.keys(structured.openGraph).length > 0 || structured.summary.name !== undefined || structured.tables.length > 0;
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

    return { ok: true, finalUrl, status: response.status, records };
  } catch (error) {
    return { ok: false, records: [], reason: `tier-0 declined: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
  }
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
