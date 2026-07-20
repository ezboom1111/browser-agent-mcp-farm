import type { BrowserClientStateResult } from "./browser-pool.js";
import type { DestinationUrlResolutionMethod } from "./destination-url.js";

export type ClientStateDestinationExtractor = "naver_place_apollo";

const NAVER_PLACE_APOLLO_HOSTS = new Set(["map.naver.com", "m.place.naver.com", "pcmap.place.naver.com"]);

/** True when a hostname is one of the Naver map/place surfaces that hydrate place data into `window.__APOLLO_STATE__`. */
export function isNaverPlaceApolloHost(host: string): boolean {
  return NAVER_PLACE_APOLLO_HOSTS.has(host.toLowerCase());
}

export interface ClientStateDestinationCandidate {
  url: string;
  originalUrl?: string | undefined;
  urlResolutionMethod?: DestinationUrlResolutionMethod | undefined;
  text: string;
  frameIndex: number;
  frameUrl: string;
  frameName?: string;
  sourceId: string;
}

export interface ClientStateDestinationExtractionResult {
  candidates: ClientStateDestinationCandidate[];
  parsedFrameCount: number;
  truncatedFrameCount: number;
  rawCandidateCount: number;
  uniqueCandidateCount: number;
}

/**
 * Gate + extract for the runtime capture pipeline (evidence-runner.ts). Engages ONLY when the
 * already-captured page_html shows an `__APOLLO_STATE__` hydration hint AND the requested host is a
 * known Naver map/place surface — `readClientState` (a live re-query of the still-open page) is the
 * caller's responsibility and is intentionally injected here so this gate is unit-testable without a
 * live browser. Returns undefined when the gate does not open or no candidates were found, so the
 * caller never registers an empty/irrelevant artifact.
 */
export async function maybeExtractNaverPlaceApolloDestinations(input: { html: string; hostname: string; maxLinks?: number; destinationPath?: string | undefined; readClientState: () => Promise<BrowserClientStateResult> }): Promise<ClientStateDestinationExtractionResult | undefined> {
  if (!input.html.includes("__APOLLO_STATE__") || !isNaverPlaceApolloHost(input.hostname)) {
    return undefined;
  }
  const state = await input.readClientState();
  const extraction = extractClientStateDestinationCandidates(state, {
    extractor: "naver_place_apollo",
    maxLinks: input.maxLinks ?? 20,
    destinationPath: input.destinationPath
  });
  return extraction.candidates.length > 0 ? extraction : undefined;
}

export function extractClientStateDestinationCandidates(
  state: BrowserClientStateResult,
  options: {
    extractor: ClientStateDestinationExtractor;
    maxLinks: number;
    destinationPath?: string | undefined;
  }
): ClientStateDestinationExtractionResult {
  const rawCandidates: ClientStateDestinationCandidate[] = [];
  let parsedFrameCount = 0;
  let truncatedFrameCount = 0;
  for (const frame of state.frames) {
    if (!frame.found || frame.json === undefined) {
      continue;
    }
    if (frame.truncated) {
      truncatedFrameCount += 1;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.json);
      parsedFrameCount += 1;
    } catch {
      continue;
    }
    rawCandidates.push(...extractNaverPlaceApolloCandidates(parsed, frame, options.destinationPath));
  }

  const seen = new Set<string>();
  const uniqueCandidates: ClientStateDestinationCandidate[] = [];
  for (const candidate of rawCandidates) {
    const normalized = normalizedDestinationUrl(candidate.url);
    if (normalized === undefined || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    uniqueCandidates.push(candidate);
  }
  return {
    candidates: uniqueCandidates.slice(0, options.maxLinks),
    parsedFrameCount,
    truncatedFrameCount,
    rawCandidateCount: rawCandidates.length,
    uniqueCandidateCount: uniqueCandidates.length
  };
}

function extractNaverPlaceApolloCandidates(value: unknown, frame: BrowserClientStateResult["frames"][number], destinationPath: string | undefined): ClientStateDestinationCandidate[] {
  const candidates: ClientStateDestinationCandidate[] = [];
  const seenIds = new Set<string>();
  const stack: unknown[] = [value];
  let visited = 0;
  const path = normalizeNaverPlaceDestinationPath(destinationPath) ?? normalizeNaverPlaceDestinationPath(pathFromNaverPlaceFrameUrl(frame.frameUrl)) ?? "restaurant";

  while (stack.length > 0 && visited < 50_000) {
    visited += 1;
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push(current[index]);
      }
      continue;
    }
    if (!isRecord(current)) {
      continue;
    }
    const candidate = naverPlaceCandidateFromRecord(current, frame, path);
    if (candidate !== undefined && !seenIds.has(candidate.sourceId)) {
      seenIds.add(candidate.sourceId);
      candidates.push(candidate);
    }
    const children = Object.values(current);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (typeof child === "object" && child !== null) {
        stack.push(child);
      }
    }
  }
  return candidates;
}

function naverPlaceCandidateFromRecord(record: Record<string, unknown>, frame: BrowserClientStateResult["frames"][number], path: string): ClientStateDestinationCandidate | undefined {
  const id = stringValue(record.id);
  const name = compactText(stringValue(record.name));
  if (id === undefined || !/^\d{5,20}$/.test(id) || name === undefined) {
    return undefined;
  }
  const category = compactText(firstStringValue(record, ["category", "businessCategory", "categoryName"]));
  const address = compactText(firstStringValue(record, ["roadAddress", "address", "fullAddress"]));
  const hasPlaceSignal =
    category !== undefined ||
    address !== undefined ||
    stringValue(record.x) !== undefined ||
    stringValue(record.y) !== undefined ||
    stringValue(record.distance) !== undefined ||
    stringValue(record.reviewCount) !== undefined ||
    stringValue(record.visitorReviewCount) !== undefined ||
    stringValue(record.routeUrl) !== undefined;
  if (!hasPlaceSignal) {
    return undefined;
  }
  const originalUrl = `https://place.naver.com/${path}/${id}`;
  return {
    url: `https://map.naver.com/p/entry/place/${id}`,
    originalUrl,
    urlResolutionMethod: "naver_place_entry_fallback",
    text: [name, category, address].filter((part): part is string => part !== undefined).join(" | "),
    frameIndex: frame.frameIndex,
    frameUrl: frame.frameUrl,
    ...(frame.frameName === undefined ? {} : { frameName: frame.frameName }),
    sourceId: id
  };
}

function pathFromNaverPlaceFrameUrl(frameUrl: string): string | undefined {
  try {
    const parsed = new URL(frameUrl);
    const match = parsed.pathname.match(/^\/([^/]+)\/(?:list|search|entry|home)(?:\/|$)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function normalizeNaverPlaceDestinationPath(value: string | undefined): string | undefined {
  const normalized = value
    ?.trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }
  return ["restaurant", "hospital", "place", "accommodation"].includes(normalized) ? normalized : undefined;
}

function firstStringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function compactText(value: string | undefined): string | undefined {
  const compact = value?.replace(/\s+/g, " ").trim();
  return compact === undefined || compact.length === 0 ? undefined : compact.slice(0, 300);
}

function normalizedDestinationUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
