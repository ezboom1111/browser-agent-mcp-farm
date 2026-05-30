import { matchingDestinationQueryTokens, type DestinationTextScriptFamily } from "./destination-triage.js";

// Pure text-script + destination-query helpers extracted from evidence-runner.ts (a stage
// seam in the split of that file): script-family detection for cross-script query/evidence
// mismatch checks, and best-effort query recovery from a destination URL. No I/O, no browser.

const TEXT_SCRIPT_FAMILIES: DestinationTextScriptFamily[] = ["latin", "hangul", "hiragana", "katakana", "han", "digit"];

export function detectedTextScriptFamilies(value: string): DestinationTextScriptFamily[] {
  const counts = countTextScripts(value);
  return TEXT_SCRIPT_FAMILIES.filter((script) => counts[script] > 0);
}

export function hasDominantTextScriptMismatch(query: string, evidenceText: string): boolean {
  const queryScripts = dominantNonDigitTextScripts(query);
  const evidenceScripts = dominantNonDigitTextScripts(evidenceText);
  if (queryScripts.length === 0 || evidenceScripts.length === 0) {
    return false;
  }
  return !queryScripts.some((script) => evidenceScripts.includes(script));
}

function dominantNonDigitTextScripts(value: string): DestinationTextScriptFamily[] {
  const counts = countTextScripts(value);
  const scripts = TEXT_SCRIPT_FAMILIES.filter((script) => script !== "digit");
  const total = scripts.reduce((sum, script) => sum + counts[script], 0);
  if (total < 2) {
    return [];
  }
  const threshold = Math.max(2, Math.ceil(total * 0.25));
  return scripts.filter((script) => counts[script] >= threshold);
}

function countTextScripts(value: string): Record<DestinationTextScriptFamily, number> {
  const counts: Record<DestinationTextScriptFamily, number> = {
    latin: 0,
    hangul: 0,
    hiragana: 0,
    katakana: 0,
    han: 0,
    digit: 0
  };
  for (const char of value) {
    const script = textScriptForCodePoint(char.codePointAt(0) ?? 0);
    if (script !== undefined) {
      counts[script] += 1;
    }
  }
  return counts;
}

function textScriptForCodePoint(code: number): DestinationTextScriptFamily | undefined {
  if (code >= 0x30 && code <= 0x39) {
    return "digit";
  }
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
    return "latin";
  }
  if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f) || (code >= 0xac00 && code <= 0xd7af)) {
    return "hangul";
  }
  if (code >= 0x3040 && code <= 0x309f) {
    return "hiragana";
  }
  if (code >= 0x30a0 && code <= 0x30ff) {
    return "katakana";
  }
  if ((code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)) {
    return "han";
  }
  return undefined;
}

export function destinationQueryFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    for (const key of ["q", "query", "keyword", "search_query", "p", "text", "destination"]) {
      const value = parsed.searchParams.get(key);
      if (value !== null && value.trim().length > 0) {
        return value.trim();
      }
    }
    const pathQuery = destinationQueryFromKnownSearchPath(parsed);
    if (pathQuery !== undefined) {
      return pathQuery;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function destinationQueryFromKnownSearchPath(parsed: URL): string | undefined {
  const patterns = [/\/maps\/search\/([^/?#]+)/i, /\/p\/search\/([^/?#]+)/i];
  for (const pattern of patterns) {
    const match = parsed.pathname.match(pattern);
    const raw = match?.[1];
    if (raw === undefined) {
      continue;
    }
    const decoded = decodeUrlPathQuerySegment(raw);
    if (decoded !== undefined) {
      return decoded;
    }
  }
  return undefined;
}

function decodeUrlPathQuerySegment(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value.replace(/\+/g, " ")).replace(/\s+/g, " ").trim();
    return decoded.length === 0 ? undefined : decoded;
  } catch {
    const fallback = value.replace(/\+/g, " ").replace(/\s+/g, " ").trim();
    return fallback.length === 0 ? undefined : fallback;
  }
}

export function matchingTextTokens(query: string, value: string): string[] {
  return matchingDestinationQueryTokens(query, value);
}

export function normalizeEvidenceText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}
