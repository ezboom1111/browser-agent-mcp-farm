import { ArtifactWriter, type ArtifactRecord } from "./artifact-writer.js";
import { isAbortError, throwIfAborted } from "./abort.js";
import type { PlatformCapabilityMap } from "./platform-adapters/index.js";
import type { NormalizedEvidenceRunInput } from "./schemas.js";

export interface OfficialApiRunResult {
  records: ArtifactRecord[];
  warnings: string[];
}

export type OfficialApiFailureKind =
  | "permission_denied"
  | "ownership_required"
  | "quota_exceeded"
  | "rate_limited"
  | "not_found"
  | "unknown";

interface ApiLookup {
  key: string;
  label: string;
  credentialRef?: string | undefined;
  run: (token: string, signal: AbortSignal | undefined) => Promise<unknown>;
}

export type OfficialApiCredentialReadinessStatus =
  | "ready"
  | "missing_reference"
  | "missing_env"
  | "missing_media_id"
  | "not_applicable";

export type OfficialApiCredentialState =
  | "ready"
  | "missing_reference"
  | "missing_env"
  | "not_applicable";

export type OfficialApiReadinessNextAction =
  | "ready_for_live_api_call"
  | "provide_credential_reference"
  | "set_credential_env"
  | "use_direct_media_url_or_followup"
  | "browser_visible_evidence_only";

export interface OfficialApiCredentialReadinessItem {
  key: string;
  label: string;
  credentialRef?: string;
  status: OfficialApiCredentialReadinessStatus;
  credentialStatus: OfficialApiCredentialState;
  nextAction: OfficialApiReadinessNextAction;
  reason?: string;
}

export interface OfficialApiReadinessReport {
  schemaVersion: "1.0";
  executionPolicy: "credential_readiness_only_no_api_calls";
  platform: PlatformCapabilityMap["platform"];
  mediaId?: string;
  supportedLookupCount: number;
  readyLookupCount: number;
  missingReferenceCount: number;
  missingEnvCount: number;
  missingMediaIdCount: number;
  notApplicableCount: number;
  credentialReadyCount: number;
  credentialMissingReferenceCount: number;
  credentialMissingEnvCount: number;
  mediaIdBlockedReadyCredentialCount: number;
  ok: boolean;
  items: OfficialApiCredentialReadinessItem[];
  warnings: string[];
}

export async function collectOfficialApiEvidence(input: {
  runDir: string;
  sourceUrl: string;
  contextToken: string;
  pageId: string;
  baseCaptureId: string;
  platformCapabilities: PlatformCapabilityMap;
  officialApi: NormalizedEvidenceRunInput["officialApi"];
  writer?: ArtifactWriter;
  signal?: AbortSignal | undefined;
}): Promise<OfficialApiRunResult> {
  if (!input.officialApi.enabled) {
    return { records: [], warnings: [] };
  }

  const writer = input.writer ?? new ArtifactWriter();
  const records: ArtifactRecord[] = [];
  const warnings: string[] = [];
  const lookups = buildLookups(input.platformCapabilities, input.officialApi.credentials);
  const cache: OfficialApiCacheEntry[] = [];
  if (lookups.length === 0 && input.platformCapabilities.mediaId === undefined && isMediaIdRequiredOfficialApiPlatform(input.platformCapabilities.platform)) {
    const message = `${input.platformCapabilities.platform}: official API lookup requires a stable media ID; use a direct item URL or destination follow-up before requesting official API metadata.`;
    warnings.push(message);
    for (const template of lookupTemplatesForPlatform(input.platformCapabilities.platform, input.officialApi.credentials)) {
      const credentialStatus = credentialStateForRef(template.credentialRef);
      cache.push({
        key: template.key,
        label: template.label,
        status: "missing_media_id",
        ...(template.credentialRef === undefined ? {} : { credentialRef: template.credentialRef }),
        credentialStatus,
        nextAction: "use_direct_media_url_or_followup",
        error: "a stable media ID could not be parsed from this URL"
      });
      records.push(...await writer.writeCaptureBundle({
        runDir: input.runDir,
        sourceUrl: input.sourceUrl,
        contextToken: input.contextToken,
        pageId: input.pageId,
        captureId: `${input.baseCaptureId}-official-api-${template.key}-missing-media-id`,
        status: "partial",
        metadata: {
          officialApi: {
            label: template.label,
            status: "missing_media_id",
            ...(template.credentialRef === undefined ? {} : { credentialRef: template.credentialRef }),
            credentialStatus,
            nextAction: "use_direct_media_url_or_followup",
            error: "a stable media ID could not be parsed from this URL"
          }
        },
        captureMethod: "browser-agent-mcp-farm official-api",
        toolName: "evidence_run_official_api",
        evidenceKind: "official_api_metadata",
        note: "missing_media_id: use a direct item URL or destination follow-up before requesting official API metadata"
      }));
    }
  }

  for (const lookup of lookups) {
    throwIfAborted(input.signal);
    const credential = resolveCredential(lookup.credentialRef);
    if (credential.token === undefined) {
      const error = credential.reason ?? "credential reference not configured";
      warnings.push(`${lookup.label}: ${error}`);
      cache.push(cacheEntry(lookup, "credential-required", error));
      records.push(...await writer.writeCaptureBundle({
        runDir: input.runDir,
        sourceUrl: input.sourceUrl,
        contextToken: input.contextToken,
        pageId: input.pageId,
        captureId: `${input.baseCaptureId}-official-api-${lookup.key}`,
        status: "partial",
        metadata: {
          officialApi: {
            label: lookup.label,
            status: "credential-required",
            credentialRef: lookup.credentialRef,
            error
          }
        },
        captureMethod: "browser-agent-mcp-farm official-api",
        toolName: "evidence_run_official_api",
        evidenceKind: "official_api_metadata",
        note: `credential-required: ${error}`
      }));
      continue;
    }

    try {
      const data = await lookup.run(credential.token, input.signal);
      const sanitizedData = redactSecrets(data, [credential.token]);
      cache.push(cacheEntry(lookup, "ok"));
      records.push(...await writer.writeCaptureBundle({
        runDir: input.runDir,
        sourceUrl: input.sourceUrl,
        contextToken: input.contextToken,
        pageId: input.pageId,
        captureId: `${input.baseCaptureId}-official-api-${lookup.key}`,
        status: "ok",
        metadata: {
          officialApi: {
            label: lookup.label,
            status: "ok",
            credentialRef: lookup.credentialRef,
            data: sanitizedData
          }
        },
        text: JSON.stringify(sanitizedData, null, 2),
        captureMethod: "browser-agent-mcp-farm official-api",
        toolName: "evidence_run_official_api",
        evidenceKind: "official_api_metadata"
      }));
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      const message = redactSecretString(error instanceof Error ? error.message : String(error), [credential.token]);
      const failureKind = classifyOfficialApiFailure(message);
      warnings.push(`${lookup.label}: ${failureKind}: ${message}`);
      cache.push(cacheEntry(lookup, "error", message, failureKind));
      records.push(...await writer.writeCaptureBundle({
        runDir: input.runDir,
        sourceUrl: input.sourceUrl,
        contextToken: input.contextToken,
        pageId: input.pageId,
        captureId: `${input.baseCaptureId}-official-api-${lookup.key}-failed`,
        status: "partial",
        metadata: {
          officialApi: {
            label: lookup.label,
            status: "error",
            credentialRef: lookup.credentialRef,
            failureKind,
            error: message
          }
        },
        captureMethod: "browser-agent-mcp-farm official-api",
        toolName: "evidence_run_official_api",
        evidenceKind: "official_api_metadata",
        note: `${failureKind}: ${message}`
      }));
    }
  }

  records.push(...await writer.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: input.sourceUrl,
    contextToken: input.contextToken,
    pageId: input.pageId,
    captureId: `${input.baseCaptureId}-api-cache`,
    status: "ok",
    metadata: { officialApiCache: cache },
    captureMethod: "browser-agent-mcp-farm api-cache",
    toolName: "evidence_run_official_api",
    evidenceKind: "api_cache"
  }));

  return { records, warnings };
}

export function buildOfficialApiReadiness(input: {
  platformCapabilities: PlatformCapabilityMap;
  credentials: NormalizedEvidenceRunInput["officialApi"]["credentials"];
}): OfficialApiReadinessReport {
  const lookups = buildLookups(input.platformCapabilities, input.credentials);
  const missingMediaIdItems = lookups.length === 0 && input.platformCapabilities.mediaId === undefined
    ? missingMediaIdReadinessItems(input.platformCapabilities.platform, input.credentials)
    : [];
  const items = lookups.length === 0 ? missingMediaIdItems : lookups.map((lookup) => credentialReadinessItem(lookup));
  const missingMediaIdCount = items.filter((item) => item.status === "missing_media_id").length;
  const notApplicableCount = lookups.length === 0 && missingMediaIdCount === 0 ? 1 : 0;
  const readyLookupCount = items.filter((item) => item.status === "ready").length;
  const missingReferenceCount = items.filter((item) => item.status === "missing_reference").length;
  const missingEnvCount = items.filter((item) => item.status === "missing_env").length;
  const credentialReadyCount = items.filter((item) => item.credentialStatus === "ready").length;
  const credentialMissingReferenceCount = items.filter((item) => item.credentialStatus === "missing_reference").length;
  const credentialMissingEnvCount = items.filter((item) => item.credentialStatus === "missing_env").length;
  const mediaIdBlockedReadyCredentialCount = items.filter((item) => item.status === "missing_media_id" && item.credentialStatus === "ready").length;
  return {
    schemaVersion: "1.0",
    executionPolicy: "credential_readiness_only_no_api_calls",
    platform: input.platformCapabilities.platform,
    ...(input.platformCapabilities.mediaId === undefined ? {} : { mediaId: input.platformCapabilities.mediaId }),
    supportedLookupCount: lookups.length === 0 ? missingMediaIdItems.length : lookups.length,
    readyLookupCount,
    missingReferenceCount,
    missingEnvCount,
    missingMediaIdCount,
    notApplicableCount,
    credentialReadyCount,
    credentialMissingReferenceCount,
    credentialMissingEnvCount,
    mediaIdBlockedReadyCredentialCount,
    ok: lookups.length > 0 && readyLookupCount === lookups.length,
    items,
    warnings: [
      "Official API readiness does not call provider APIs and does not validate token scopes, ownership, quota, or live provider availability.",
      "Ready means the required credential env var reference is present and the named env var has a non-empty value.",
      ...(missingMediaIdCount > 0 ? ["Official API lookups for this platform require a stable media ID; use a direct item URL or destination follow-up before live API collection."] : []),
      ...(notApplicableCount > 0 ? ["No supported official API lookup is available for this URL/platform/media ID."] : [])
    ]
  };
}

interface OfficialApiCacheEntry {
  key: string;
  status: string;
  label: string;
  credentialRef?: string;
  credentialStatus?: OfficialApiCredentialState;
  nextAction?: OfficialApiReadinessNextAction;
  error?: string;
  failureKind?: OfficialApiFailureKind;
}

function cacheEntry(
  lookup: ApiLookup,
  status: string,
  error?: string,
  failureKind?: OfficialApiFailureKind
): OfficialApiCacheEntry {
  return {
    key: lookup.key,
    label: lookup.label,
    status,
    ...(lookup.credentialRef === undefined ? {} : { credentialRef: lookup.credentialRef }),
    ...(error === undefined ? {} : { error }),
    ...(failureKind === undefined ? {} : { failureKind })
  };
}

function credentialReadinessItem(lookup: ApiLookup): OfficialApiCredentialReadinessItem {
  if (lookup.credentialRef === undefined) {
    return {
      key: lookup.key,
      label: lookup.label,
      status: "missing_reference",
      credentialStatus: "missing_reference",
      nextAction: "provide_credential_reference",
      reason: "credential env var reference was not provided"
    };
  }
  if (!process.env[lookup.credentialRef]) {
    return {
      key: lookup.key,
      label: lookup.label,
      credentialRef: lookup.credentialRef,
      status: "missing_env",
      credentialStatus: "missing_env",
      nextAction: "set_credential_env",
      reason: `credential env var is not set: ${lookup.credentialRef}`
    };
  }
  return {
    key: lookup.key,
    label: lookup.label,
    credentialRef: lookup.credentialRef,
    status: "ready",
    credentialStatus: "ready",
    nextAction: "ready_for_live_api_call"
  };
}

function missingMediaIdReadinessItems(
  platform: PlatformCapabilityMap["platform"],
  credentials: NormalizedEvidenceRunInput["officialApi"]["credentials"]
): OfficialApiCredentialReadinessItem[] {
  return lookupTemplatesForPlatform(platform, credentials).map((lookup) => ({
    key: lookup.key,
    label: lookup.label,
    ...(lookup.credentialRef === undefined ? {} : { credentialRef: lookup.credentialRef }),
    status: "missing_media_id",
    credentialStatus: credentialStateForRef(lookup.credentialRef),
    nextAction: "use_direct_media_url_or_followup",
    reason: "a stable media ID could not be parsed from this URL"
  }));
}

function credentialStateForRef(credentialRef: string | undefined): OfficialApiCredentialState {
  if (credentialRef === undefined) {
    return "missing_reference";
  }
  return process.env[credentialRef] ? "ready" : "missing_env";
}

function isMediaIdRequiredOfficialApiPlatform(platform: PlatformCapabilityMap["platform"]): boolean {
  return platform === "youtube" || platform === "instagram" || platform === "tiktok";
}

function lookupTemplatesForPlatform(
  platform: PlatformCapabilityMap["platform"],
  credentials: NormalizedEvidenceRunInput["officialApi"]["credentials"]
): Array<Pick<ApiLookup, "key" | "label" | "credentialRef">> {
  if (platform === "youtube") {
    return [
      { key: "youtube-videos", label: "YouTube Data API videos.list", credentialRef: credentials.youtubeApiKeyEnv },
      { key: "youtube-captions", label: "YouTube Data API captions.list", credentialRef: credentials.youtubeOAuthTokenEnv }
    ];
  }
  if (platform === "instagram") {
    return [
      { key: "instagram-media", label: "Instagram Graph IG Media fields", credentialRef: credentials.instagramAccessTokenEnv }
    ];
  }
  if (platform === "tiktok") {
    return [
      { key: "tiktok-video-query", label: "TikTok Display API video query", credentialRef: credentials.tiktokAccessTokenEnv },
      { key: "tiktok-research-video-query", label: "TikTok Research API video query", credentialRef: credentials.tiktokResearchTokenEnv }
    ];
  }
  return [];
}

function buildLookups(
  platformCapabilities: PlatformCapabilityMap,
  credentials: NormalizedEvidenceRunInput["officialApi"]["credentials"]
): ApiLookup[] {
  if (platformCapabilities.mediaId === undefined) {
    return [];
  }

  if (platformCapabilities.platform === "youtube") {
    return [
      {
        key: "youtube-videos",
        label: "YouTube Data API videos.list",
        credentialRef: credentials.youtubeApiKeyEnv,
        run: (apiKey, signal) => fetchJson(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics,status&id=${encodeURIComponent(platformCapabilities.mediaId ?? "")}&key=${encodeURIComponent(apiKey)}`, undefined, undefined, signal)
      },
      {
        key: "youtube-captions",
        label: "YouTube Data API captions.list",
        credentialRef: credentials.youtubeOAuthTokenEnv,
        run: (token, signal) => fetchJson(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${encodeURIComponent(platformCapabilities.mediaId ?? "")}`, token, undefined, signal)
      }
    ];
  }

  if (platformCapabilities.platform === "instagram") {
    return [
      {
        key: "instagram-media",
        label: "Instagram Graph IG Media fields",
        credentialRef: credentials.instagramAccessTokenEnv,
        run: (token, signal) => fetchJson(`https://graph.instagram.com/${encodeURIComponent(platformCapabilities.mediaId ?? "")}?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username&access_token=${encodeURIComponent(token)}`, undefined, undefined, signal)
      }
    ];
  }

  if (platformCapabilities.platform === "tiktok") {
    return [
      {
        key: "tiktok-video-query",
        label: "TikTok Display API video query",
        credentialRef: credentials.tiktokAccessTokenEnv,
        run: (token, signal) => fetchJson("https://open.tiktokapis.com/v2/video/query/?fields=id,title,video_description,duration,cover_image_url,share_url,embed_link", token, {
          filters: { video_ids: [platformCapabilities.mediaId] }
        }, signal),
      },
      {
        key: "tiktok-research-video-query",
        label: "TikTok Research API video query",
        credentialRef: credentials.tiktokResearchTokenEnv,
        run: (token, signal) => fetchJson("https://open.tiktokapis.com/v2/research/video/query/?fields=id,video_description,voice_to_text,video_duration", token, {
          query: { and: [{ operation: "EQ", field_name: "id", field_values: [platformCapabilities.mediaId] }] },
          max_count: 1
        }, signal)
      }
    ];
  }

  return [];
}

function resolveCredential(envName: string | undefined): { token?: string; reason?: string } {
  if (envName === undefined) {
    return { reason: "credential env var reference was not provided" };
  }
  const token = process.env[envName];
  if (!token) {
    return { reason: `credential env var is not set: ${envName}` };
  }
  return { token };
}

function redactSecrets(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    return redactSecretString(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, secrets));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecrets(item, secrets)]));
  }
  return value;
}

function redactSecretString(value: string, secrets: string[]): string {
  return secrets
    .filter((secret) => secret.length >= 4)
    .reduce((text, secret) => text.split(secret).join("[REDACTED]"), value);
}

function classifyOfficialApiFailure(message: string): OfficialApiFailureKind {
  const normalized = message.toLocaleLowerCase();
  if (normalized.includes("quotaexceeded") || normalized.includes("quota exceeded") || normalized.includes("daily limit") || normalized.includes("user rate limit exceeded")) {
    return "quota_exceeded";
  }
  if (normalized.includes("ratelimitexceeded") || normalized.includes("rate limit") || normalized.includes("too many requests") || normalized.includes("http 429")) {
    return "rate_limited";
  }
  if (normalized.includes("not owned") || normalized.includes("ownership") || normalized.includes("owner") || normalized.includes("only query videos that the user owns") || normalized.includes("media object does not exist") || normalized.includes("does not exist, cannot be loaded due to missing permissions")) {
    return "ownership_required";
  }
  if (normalized.includes("notfound") || normalized.includes("not found") || normalized.includes("http 404")) {
    return "not_found";
  }
  if (normalized.includes("permission") || normalized.includes("permissions") || normalized.includes("insufficient") || normalized.includes("unauthorized") || normalized.includes("forbidden") || normalized.includes("http 401") || normalized.includes("http 403")) {
    return "permission_denied";
  }
  return "unknown";
}

async function fetchJson(url: string, bearerToken?: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (bearerToken !== undefined) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(signal === undefined ? {} : { signal }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    data = { rawText: text };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}
