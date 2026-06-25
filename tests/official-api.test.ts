import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOfficialApiReadiness, collectOfficialApiEvidence, writeOfficialApiReadinessArtifact } from "../src/official-api.js";
import { describePlatformCapabilities } from "../src/platform-adapters/index.js";

let runDirs: string[] = [];

describe("collectOfficialApiEvidence", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.FARM_TEST_YOUTUBE_KEY;
    delete process.env.FARM_TEST_YOUTUBE_OAUTH_TOKEN;
    delete process.env.FARM_TEST_INSTAGRAM_TOKEN;
    delete process.env.FARM_TEST_TIKTOK_TOKEN;
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("records missing credentials without raw secrets", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-api-missing-"));
    runDirs.push(runDir);

    const result = await collectOfficialApiEvidence({
      runDir,
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      contextToken: "ctx_test",
      pageId: "api",
      baseCaptureId: "api",
      platformCapabilities: describePlatformCapabilities("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      officialApi: { enabled: true, credentials: { youtubeApiKeyEnv: "FARM_TEST_YOUTUBE_KEY" } }
    });

    expect(result.records.some((record) => record.evidence_kind === "official_api_metadata")).toBe(true);
    const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
    expect(ledger).toContain("credential-required");
    expect(ledger).toContain("FARM_TEST_YOUTUBE_KEY");
  });

  it("reports credential readiness without calling provider APIs", () => {
    process.env.FARM_TEST_YOUTUBE_KEY = "SECRET_TEST_KEY";
    const report = buildOfficialApiReadiness({
      platformCapabilities: describePlatformCapabilities("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      credentials: {
        youtubeApiKeyEnv: "FARM_TEST_YOUTUBE_KEY",
        youtubeOAuthTokenEnv: "FARM_TEST_YOUTUBE_OAUTH_TOKEN"
      }
    });

    expect(report).toMatchObject({
      executionPolicy: "credential_readiness_only_no_api_calls",
      platform: "youtube",
      mediaId: "dQw4w9WgXcQ",
      supportedLookupCount: 2,
      readyLookupCount: 1,
      missingEnvCount: 1,
      missingReferenceCount: 0,
      credentialReadyCount: 1,
      credentialMissingEnvCount: 1,
      credentialMissingReferenceCount: 0,
      mediaIdBlockedReadyCredentialCount: 0,
      ok: false
    });
    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "youtube-videos",
          credentialRef: "FARM_TEST_YOUTUBE_KEY",
          status: "ready",
          credentialStatus: "ready",
          nextAction: "ready_for_live_api_call"
        }),
        expect.objectContaining({
          key: "youtube-captions",
          credentialRef: "FARM_TEST_YOUTUBE_OAUTH_TOKEN",
          status: "missing_env",
          credentialStatus: "missing_env",
          nextAction: "set_credential_env"
        })
      ])
    );
    expect(JSON.stringify(report)).not.toContain("SECRET_TEST_KEY");
  });

  it("writes credential readiness as a source-strategy artifact without provider API calls", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-api-readiness-artifact-"));
    runDirs.push(runDir);

    const result = await writeOfficialApiReadinessArtifact({
      runDir,
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      contextToken: "ctx_test",
      pageId: "api-readiness",
      baseCaptureId: "api",
      platformCapabilities: describePlatformCapabilities("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      credentials: { youtubeApiKeyEnv: "FARM_TEST_YOUTUBE_KEY" }
    });

    expect(result.report.executionPolicy).toBe("credential_readiness_only_no_api_calls");
    expect(result.records.some((record) => record.tool_name === "evidence_run_official_api_readiness" && record.evidence_kind === "source_strategy")).toBe(true);
    const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
    expect(ledger).toContain("official-api-readiness");
    const textRecord = result.records.find((record) => record.kind === "text");
    expect(textRecord).toBeDefined();
    const text = await readFile(join(runDir, textRecord?.path as string), "utf8");
    expect(text).toContain("FARM_TEST_YOUTUBE_KEY");
  });

  it("reports unsupported official API readiness for generic URLs", () => {
    const report = buildOfficialApiReadiness({
      platformCapabilities: describePlatformCapabilities("https://example.com/article"),
      credentials: {}
    });

    expect(report).toMatchObject({
      platform: "generic",
      supportedLookupCount: 0,
      readyLookupCount: 0,
      notApplicableCount: 1,
      ok: false
    });
    expect(report.items).toEqual([]);
    expect(report.warnings).toContain("No supported official API lookup is available for this URL/platform/media ID.");
  });

  it("distinguishes supported platform URLs that do not contain a media ID", () => {
    const report = buildOfficialApiReadiness({
      platformCapabilities: describePlatformCapabilities("https://www.youtube.com/results?search_query=tokyo+travel"),
      credentials: { youtubeApiKeyEnv: "FARM_TEST_YOUTUBE_KEY" }
    });

    expect(report).toMatchObject({
      platform: "youtube",
      supportedLookupCount: 2,
      readyLookupCount: 0,
      missingMediaIdCount: 2,
      notApplicableCount: 0,
      credentialMissingEnvCount: 1,
      credentialMissingReferenceCount: 1,
      mediaIdBlockedReadyCredentialCount: 0,
      ok: false
    });
    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "youtube-videos",
          credentialRef: "FARM_TEST_YOUTUBE_KEY",
          status: "missing_media_id",
          credentialStatus: "missing_env",
          nextAction: "use_direct_media_url_or_followup",
          reason: "a stable media ID could not be parsed from this URL"
        }),
        expect.objectContaining({
          key: "youtube-captions",
          status: "missing_media_id",
          credentialStatus: "missing_reference"
        })
      ])
    );
    expect(report.warnings).toContain("Official API lookups for this platform require a stable media ID; use a direct item URL or destination follow-up before live API collection.");
  });

  it("reports ready credentials separately when a listing URL is blocked by missing media ID", () => {
    process.env.FARM_TEST_YOUTUBE_KEY = "SECRET_TEST_KEY";
    const report = buildOfficialApiReadiness({
      platformCapabilities: describePlatformCapabilities("https://www.youtube.com/results?search_query=tokyo+travel"),
      credentials: { youtubeApiKeyEnv: "FARM_TEST_YOUTUBE_KEY" }
    });

    expect(report).toMatchObject({
      platform: "youtube",
      readyLookupCount: 0,
      missingMediaIdCount: 2,
      credentialReadyCount: 1,
      credentialMissingReferenceCount: 1,
      mediaIdBlockedReadyCredentialCount: 1,
      ok: false
    });
    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "youtube-videos",
          status: "missing_media_id",
          credentialStatus: "ready",
          nextAction: "use_direct_media_url_or_followup"
        })
      ])
    );
    expect(JSON.stringify(report)).not.toContain("SECRET_TEST_KEY");
  });

  it("records missing-media-id artifacts and cache entries without provider calls", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-api-missing-media-id-"));
    runDirs.push(runDir);
    process.env.FARM_TEST_YOUTUBE_KEY = "SECRET_TEST_KEY";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectOfficialApiEvidence({
      runDir,
      sourceUrl: "https://www.youtube.com/results?search_query=tokyo+travel",
      contextToken: "ctx_test",
      pageId: "api",
      baseCaptureId: "api",
      platformCapabilities: describePlatformCapabilities("https://www.youtube.com/results?search_query=tokyo+travel"),
      officialApi: { enabled: true, credentials: { youtubeApiKeyEnv: "FARM_TEST_YOUTUBE_KEY" } }
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("official API lookup requires a stable media ID")]));
    expect(result.records.filter((record) => record.evidence_kind === "official_api_metadata")).toHaveLength(2);
    const metadata = await readOfficialApiMetadata(runDir, "api-official-api-youtube-videos-missing-media-id.metadata.json");
    expect(metadata.officialApi).toMatchObject({
      label: "YouTube Data API videos.list",
      status: "missing_media_id",
      credentialRef: "FARM_TEST_YOUTUBE_KEY",
      credentialStatus: "ready",
      nextAction: "use_direct_media_url_or_followup"
    });
    const cache = await readOfficialApiCache(runDir);
    expect(cache.officialApiCache).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "youtube-videos",
          status: "missing_media_id",
          credentialStatus: "ready",
          nextAction: "use_direct_media_url_or_followup"
        })
      ])
    );
    expect(JSON.stringify(cache)).not.toContain("SECRET_TEST_KEY");
  });

  it("uses env var references and redacts token values from artifacts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-api-redact-"));
    runDirs.push(runDir);
    process.env.FARM_TEST_YOUTUBE_KEY = "SECRET_TEST_KEY";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ items: [{ id: "dQw4w9WgXcQ", tokenEcho: "SECRET_TEST_KEY" }] }), { status: 200 }))
    );

    await collectOfficialApiEvidence({
      runDir,
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      contextToken: "ctx_test",
      pageId: "api",
      baseCaptureId: "api",
      platformCapabilities: describePlatformCapabilities("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      officialApi: { enabled: true, credentials: { youtubeApiKeyEnv: "FARM_TEST_YOUTUBE_KEY" } }
    });

    const allArtifacts = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
    const metadata = await readFile(join(runDir, "structured", "api-official-api-youtube-videos.metadata.json"), "utf8");
    expect(allArtifacts).not.toContain("SECRET_TEST_KEY");
    expect(metadata).not.toContain("SECRET_TEST_KEY");
    expect(metadata).toContain("FARM_TEST_YOUTUBE_KEY");
  });

  it("redacts token values from API error artifacts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-api-error-redact-"));
    runDirs.push(runDir);
    process.env.FARM_TEST_YOUTUBE_KEY = "SECRET_TEST_KEY";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: `bad key SECRET_TEST_KEY` }), { status: 403 }))
    );

    await collectOfficialApiEvidence({
      runDir,
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      contextToken: "ctx_test",
      pageId: "api",
      baseCaptureId: "api",
      platformCapabilities: describePlatformCapabilities("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      officialApi: { enabled: true, credentials: { youtubeApiKeyEnv: "FARM_TEST_YOUTUBE_KEY" } }
    });

    const allArtifacts = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
    const metadata = await readFile(join(runDir, "structured", "api-official-api-youtube-videos-failed.metadata.json"), "utf8");
    expect(allArtifacts).not.toContain("SECRET_TEST_KEY");
    expect(metadata).not.toContain("SECRET_TEST_KEY");
    expect(metadata).toContain("[REDACTED]");
  });

  it("classifies YouTube quota errors in metadata and API cache", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-api-youtube-quota-"));
    runDirs.push(runDir);
    process.env.FARM_TEST_YOUTUBE_KEY = "SECRET_TEST_KEY";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 403,
                message: "The request cannot be completed because you have exceeded your quota.",
                errors: [{ reason: "quotaExceeded" }]
              }
            }),
            { status: 403 }
          )
      )
    );

    await collectOfficialApiEvidence({
      runDir,
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      contextToken: "ctx_test",
      pageId: "api",
      baseCaptureId: "api",
      platformCapabilities: describePlatformCapabilities("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      officialApi: { enabled: true, credentials: { youtubeApiKeyEnv: "FARM_TEST_YOUTUBE_KEY" } }
    });

    const metadata = await readOfficialApiMetadata(runDir, "api-official-api-youtube-videos-failed.metadata.json");
    expect(metadata.officialApi.failureKind).toBe("quota_exceeded");
    const cache = await readOfficialApiCache(runDir);
    expect(cache.officialApiCache).toEqual(expect.arrayContaining([expect.objectContaining({ key: "youtube-videos", status: "error", failureKind: "quota_exceeded" })]));
  });

  it("classifies Instagram ownership errors without leaking token values", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-api-instagram-owner-"));
    runDirs.push(runDir);
    process.env.FARM_TEST_INSTAGRAM_TOKEN = "SECRET_INSTAGRAM_TOKEN";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: "Unsupported get request. Object with ID 'ABC123' does not exist, cannot be loaded due to missing permissions, or does not support this operation. SECRET_INSTAGRAM_TOKEN",
                type: "IGApiException",
                code: 100
              }
            }),
            { status: 400 }
          )
      )
    );

    await collectOfficialApiEvidence({
      runDir,
      sourceUrl: "https://www.instagram.com/p/ABC123/",
      contextToken: "ctx_test",
      pageId: "api",
      baseCaptureId: "api",
      platformCapabilities: describePlatformCapabilities("https://www.instagram.com/p/ABC123/"),
      officialApi: { enabled: true, credentials: { instagramAccessTokenEnv: "FARM_TEST_INSTAGRAM_TOKEN" } }
    });

    const allArtifacts = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
    const metadataRaw = await readFile(join(runDir, "structured", "api-official-api-instagram-media-failed.metadata.json"), "utf8");
    const metadata = JSON.parse(metadataRaw) as { officialApi: Record<string, unknown> };
    expect(allArtifacts).not.toContain("SECRET_INSTAGRAM_TOKEN");
    expect(metadataRaw).not.toContain("SECRET_INSTAGRAM_TOKEN");
    expect(metadataRaw).toContain("[REDACTED]");
    expect(metadata.officialApi.failureKind).toBe("ownership_required");
  });

  it("classifies TikTok permission and rate-limit failures", async () => {
    const permissionRunDir = await mkdtemp(join(tmpdir(), "farm-api-tiktok-permission-"));
    const rateRunDir = await mkdtemp(join(tmpdir(), "farm-api-tiktok-rate-"));
    runDirs.push(permissionRunDir, rateRunDir);
    process.env.FARM_TEST_TIKTOK_TOKEN = "SECRET_TIKTOK_TOKEN";

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "access_denied",
                message: "permission denied for this video query"
              }
            }),
            { status: 403 }
          )
      )
    );
    await collectOfficialApiEvidence({
      runDir: permissionRunDir,
      sourceUrl: "https://www.tiktok.com/@example/video/1234567890123456789",
      contextToken: "ctx_test",
      pageId: "api",
      baseCaptureId: "api",
      platformCapabilities: describePlatformCapabilities("https://www.tiktok.com/@example/video/1234567890123456789"),
      officialApi: { enabled: true, credentials: { tiktokAccessTokenEnv: "FARM_TEST_TIKTOK_TOKEN" } }
    });
    let metadata = await readOfficialApiMetadata(permissionRunDir, "api-official-api-tiktok-video-query-failed.metadata.json");
    expect(metadata.officialApi.failureKind).toBe("permission_denied");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "rate_limit_exceeded",
                message: "Too many requests"
              }
            }),
            { status: 429 }
          )
      )
    );
    await collectOfficialApiEvidence({
      runDir: rateRunDir,
      sourceUrl: "https://www.tiktok.com/@example/video/1234567890123456789",
      contextToken: "ctx_test",
      pageId: "api",
      baseCaptureId: "api",
      platformCapabilities: describePlatformCapabilities("https://www.tiktok.com/@example/video/1234567890123456789"),
      officialApi: { enabled: true, credentials: { tiktokAccessTokenEnv: "FARM_TEST_TIKTOK_TOKEN" } }
    });
    metadata = await readOfficialApiMetadata(rateRunDir, "api-official-api-tiktok-video-query-failed.metadata.json");
    expect(metadata.officialApi.failureKind).toBe("rate_limited");
  });
});

async function readOfficialApiMetadata(runDir: string, filename: string): Promise<{ officialApi: Record<string, unknown> }> {
  return JSON.parse(await readFile(join(runDir, "structured", filename), "utf8")) as { officialApi: Record<string, unknown> };
}

async function readOfficialApiCache(runDir: string): Promise<{ officialApiCache: Array<Record<string, unknown>> }> {
  return JSON.parse(await readFile(join(runDir, "structured", "api-api-cache.metadata.json"), "utf8")) as { officialApiCache: Array<Record<string, unknown>> };
}
