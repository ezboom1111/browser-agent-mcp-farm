// @ts-check
// Pure, zero-import helper for the youtube-research skill (a CONSUMER of the farm, not part
// of it). It does NO network and NO I/O on its own: the only side-effecting path,
// fetchSnapshots, takes an INJECTED fetch, mirroring the TsaClient seam in
// src/timestamp-anchor.ts so the module stays pure and unit-testable with a fake fetch.
//
// Security invariants (see ../SKILL.md):
//   - the API key comes from the caller (process.env.YOUTUBE_API_KEY); this module reads no env;
//   - videoIds are validated against the canonical farm shape before any URL is built;
//   - the key is redacted (AIza... -> AIza********) from the displayed URL, error messages,
//     and any JSON before it is handed to farm_register_evidence.
// The regexes are COPIED (not imported, since this .mjs cannot import the farm's .ts) from
// src/platform-adapters/youtube.ts (cleanVideoId) and src/secret-scan.ts (google_api_key).

/** Canonical YouTube videoId shape — copied from src/platform-adapters/youtube.ts cleanVideoId. */
export const VALID_VIDEO_ID = /^[a-zA-Z0-9_-]{6,32}$/;

/** Public-only part allowlist; authenticated parts (fileDetails/processingDetails) are never requested. */
export const PART_ALLOWLIST = "snippet,statistics,contentDetails,status";

/** videos.list endpoint as a non-interpolated constant; only the validated id list and the key vary. */
const STATS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";

/** YouTube allows up to 50 ids per videos.list call. */
const MAX_IDS = 50;

/** google-api-key shape — copied from src/secret-scan.ts. */
const GOOGLE_API_KEY_RE = /\bAIza[0-9A-Za-z_-]{35,}\b/g;

/**
 * Mask a secret exactly the way src/secret-scan.ts redact() does (AIza... -> AIza********).
 * @param {string} secret
 * @returns {string}
 */
function maskSecret(secret) {
  if (secret.length <= 4) {
    return "****";
  }
  return secret.slice(0, 4) + "*".repeat(Math.min(8, secret.length - 4));
}

/**
 * Redact an API key from arbitrary text: the exact key value AND any google-api-key-shaped token.
 * @param {string} text
 * @param {string} [key]
 * @returns {string}
 */
export function redactKey(text, key) {
  let out = String(text);
  if (typeof key === "string" && key.length > 0) {
    out = out.split(key).join(maskSecret(key));
  }
  return out.replace(GOOGLE_API_KEY_RE, (match) => maskSecret(match));
}

/**
 * Validate + normalize a list of videoIds. Drops invalid ids, caps at 50, throws if none remain.
 * @param {readonly unknown[]} ids
 * @returns {string[]}
 */
export function validateVideoIds(ids) {
  if (!Array.isArray(ids)) {
    throw new TypeError("videoIds must be an array");
  }
  /** @type {string[]} */
  const valid = [];
  for (const id of ids) {
    if (typeof id === "string" && VALID_VIDEO_ID.test(id.trim())) {
      valid.push(id.trim());
      if (valid.length >= MAX_IDS) {
        break;
      }
    }
  }
  if (valid.length === 0) {
    throw new Error("no valid videoIds (each must match ^[a-zA-Z0-9_-]{6,32}$)");
  }
  return valid;
}

/**
 * Build the videos.list request. Host/path are constant; only validated ids + the encoded key vary.
 * @param {readonly unknown[]} videoIds
 * @param {string} apiKey
 * @returns {{ url: string, redactedUrl: string }}
 */
export function buildStatsRequest(videoIds, apiKey) {
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error("apiKey required (caller supplies process.env.YOUTUBE_API_KEY)");
  }
  const ids = validateVideoIds(videoIds);
  const url = `${STATS_ENDPOINT}?part=${PART_ALLOWLIST}&id=${ids.join(",")}&key=${encodeURIComponent(apiKey)}`;
  return { url, redactedUrl: redactKey(url, apiKey) };
}

/**
 * Coerce a videos.list statistics.viewCount (string or number) to a finite number, else NaN.
 * @param {unknown} raw
 * @returns {number}
 */
function toViewCount(raw) {
  if (typeof raw === "string") {
    return Number.parseInt(raw, 10);
  }
  if (typeof raw === "number") {
    return raw;
  }
  return Number.NaN;
}

/**
 * Parse a videos.list response into per-video view snapshots. Tolerant: returns [] on any
 * unexpected shape and never throws on malformed input.
 * @param {unknown} json
 * @param {string} [capturedAt] ISO-8601 timestamp recorded on each snapshot
 * @returns {Array<{ videoId: string, viewCount: number, at: string }>}
 */
export function parseStatsResponse(json, capturedAt) {
  const at = typeof capturedAt === "string" ? capturedAt : "";
  if (json === null || typeof json !== "object") {
    return [];
  }
  const items = /** @type {{ items?: unknown }} */ (json).items;
  if (!Array.isArray(items)) {
    return [];
  }
  /** @type {Array<{ videoId: string, viewCount: number, at: string }>} */
  const out = [];
  for (const item of items) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const row = /** @type {{ id?: unknown, statistics?: { viewCount?: unknown } }} */ (item);
    const videoId = typeof row.id === "string" ? row.id : undefined;
    const stats = row.statistics && typeof row.statistics === "object" ? row.statistics : undefined;
    const viewCount = toViewCount(stats ? stats.viewCount : undefined);
    if (videoId !== undefined && VALID_VIDEO_ID.test(videoId) && Number.isFinite(viewCount)) {
      out.push({ videoId, viewCount, at });
    }
  }
  return out;
}

/**
 * Delta-views per hour between two snapshots of the SAME video. Guards a non-increasing time
 * gap (returns 0, no divide-by-zero) and a decreasing view count (clamps to 0).
 * @param {{ viewCount: number, at: string }} prev
 * @param {{ viewCount: number, at: string }} next
 * @returns {number}
 */
export function viewVelocityPerHour(prev, next) {
  const t0 = Date.parse(prev.at);
  const t1 = Date.parse(next.at);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
    return 0;
  }
  const hours = (t1 - t0) / 3_600_000;
  if (hours <= 0) {
    return 0;
  }
  const delta = next.viewCount - prev.viewCount;
  if (delta <= 0) {
    return 0;
  }
  return delta / hours;
}

/**
 * OPTIONAL standalone snapshot fetch via an INJECTED fetch (the module never references a global
 * fetch). Use this ONLY outside a farm run; inside a farm run, consume the already-registered
 * official-API statistics artifact instead (the farm already calls videos.list — do not open a
 * second key path). The injected impl returns a fetch-like Response (ok, status, text()).
 * @param {readonly unknown[]} videoIds
 * @param {string} apiKey
 * @param {(url: string) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>} fetchImpl
 * @param {string} [capturedAt]
 * @returns {Promise<Array<{ videoId: string, viewCount: number, at: string }>>}
 */
export async function fetchSnapshots(videoIds, apiKey, fetchImpl, capturedAt) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be injected (this module never uses a global fetch)");
  }
  const { url, redactedUrl } = buildStatsRequest(videoIds, apiKey);
  let res;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`stats fetch failed for ${redactedUrl}: ${redactKey(message, apiKey)}`);
  }
  if (res?.ok !== true) {
    const status = res?.status ?? 0;
    let body = "";
    try {
      body = await res.text();
    } catch {
      body = "";
    }
    throw new Error(`stats fetch HTTP ${status} for ${redactedUrl}: ${redactKey(body, apiKey)}`);
  }
  let json = null;
  try {
    json = JSON.parse(await res.text());
  } catch {
    json = null;
  }
  return parseStatsResponse(json, capturedAt);
}
