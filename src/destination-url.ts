import { Buffer } from "node:buffer";
import { safeUrl } from "./util/url.js";

export type DestinationUrlResolutionMethod = "bing_ck_u" | "google_url_param" | "naver_redirect_param" | "naver_place_entry_fallback" | "yahoo_ru_path";

export interface DestinationUrlResolution {
  url: string;
  originalUrl?: string;
  method?: DestinationUrlResolutionMethod;
}

export function resolveDestinationUrl(url: string, baseUrl?: string | undefined): DestinationUrlResolution {
  const absolute = absoluteHttpUrl(url, baseUrl);
  if (absolute === undefined) {
    return { url };
  }

  let current = absolute;
  let method: DestinationUrlResolutionMethod | undefined;
  for (let depth = 0; depth < 3; depth += 1) {
    const next = unwrapSearchRedirectUrl(current);
    if (next === undefined || next.url === current) {
      break;
    }
    current = next.url;
    method = next.method;
  }

  if (current === absolute || method === undefined) {
    return { url: absolute };
  }
  return { url: current, originalUrl: absolute, method };
}

function unwrapSearchRedirectUrl(url: string): DestinationUrlResolution | undefined {
  const parsed = safeUrl(url);
  if (parsed === undefined) {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  if ((host === "www.bing.com" || host === "bing.com") && path === "/ck/a") {
    const resolved = resolveBingRedirectParam(parsed.searchParams.get("u"));
    return resolved === undefined ? undefined : { url: resolved, method: "bing_ck_u" };
  }

  if (isGoogleHost(host) && path === "/url") {
    const resolved = firstHttpParam(parsed, ["url", "q"]);
    return resolved === undefined ? undefined : { url: resolved, method: "google_url_param" };
  }

  if ((isGoogleHost(host) || host === "www.googleadservices.com") && path === "/aclk") {
    const resolved = firstHttpParam(parsed, ["adurl", "url", "q"]);
    return resolved === undefined ? undefined : { url: resolved, method: "google_url_param" };
  }

  if ((host === "cr.naver.com" || host === "link.naver.com") && (path === "/rd" || path === "/bridge")) {
    const resolved = firstHttpParam(parsed, ["u", "url"]);
    return resolved === undefined ? undefined : { url: resolved, method: "naver_redirect_param" };
  }

  if ((host === "search.naver.com" || host === "m.search.naver.com") && path === "/p/crd/rd") {
    const resolved = firstHttpParam(parsed, ["u", "url"]);
    return resolved === undefined ? undefined : { url: resolved, method: "naver_redirect_param" };
  }

  if (host === "r.search.yahoo.com" || host === "r.search.yahoo.co.jp") {
    const resolved = resolveYahooRedirectPath(path);
    return resolved === undefined ? undefined : { url: resolved, method: "yahoo_ru_path" };
  }

  return undefined;
}

function resolveBingRedirectParam(rawValue: string | null): string | undefined {
  if (rawValue === null || rawValue.trim().length === 0) {
    return undefined;
  }
  const value = rawValue.trim();
  const direct = normalizeHttpUrl(value);
  if (direct !== undefined) {
    return direct;
  }

  const base64Candidates = [value, /^a\d/i.test(value) ? value.slice(2) : undefined].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);

  for (const candidate of base64Candidates) {
    const decoded = decodeBase64Url(candidate);
    if (decoded === undefined) {
      continue;
    }
    const resolved = normalizeHttpUrl(decoded.trim());
    if (resolved !== undefined) {
      return resolved;
    }
  }
  return undefined;
}

function firstHttpParam(parsed: URL, names: string[]): string | undefined {
  for (const name of names) {
    const value = parsed.searchParams.get(name);
    if (value === null || value.trim().length === 0) {
      continue;
    }
    const resolved = normalizeHttpUrl(value.trim());
    if (resolved !== undefined) {
      return resolved;
    }
  }
  return undefined;
}

function resolveYahooRedirectPath(pathname: string): string | undefined {
  const match = pathname.match(/\/RU=([^/]+)/i);
  if (match?.[1] === undefined) {
    return undefined;
  }
  let decoded = match[1];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    decoded = match[1];
  }
  return normalizeHttpUrl(decoded);
}

function absoluteHttpUrl(url: string, baseUrl: string | undefined): string | undefined {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return undefined;
  }
}

function normalizeHttpUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.href;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): string | undefined {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

function isGoogleHost(host: string): boolean {
  return host === "google.com" || host.endsWith(".google.com") || host.startsWith("www.google.");
}
