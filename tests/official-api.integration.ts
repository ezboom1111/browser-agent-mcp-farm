import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectOfficialApiEvidence } from "../src/official-api.js";
import { describePlatformCapabilities } from "../src/platform-adapters/index.js";

const integrationEnabled = process.env.FARM_OFFICIAL_API_INTEGRATION === "1";
let runDirs: string[] = [];

describe.skipIf(!integrationEnabled)("official API integration", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it.skipIf(!process.env.FARM_YOUTUBE_API_KEY)("collects YouTube videos.list metadata with an API key", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-api-youtube-integration-"));
    runDirs.push(runDir);
    const sourceUrl = process.env.FARM_YOUTUBE_VIDEO_URL ?? "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    const result = await collectOfficialApiEvidence({
      runDir,
      sourceUrl,
      contextToken: "ctx_integration",
      pageId: "api",
      baseCaptureId: "youtube-integration",
      platformCapabilities: describePlatformCapabilities(sourceUrl),
      officialApi: {
        enabled: true,
        credentials: {
          youtubeApiKeyEnv: "FARM_YOUTUBE_API_KEY",
          youtubeOAuthTokenEnv: "FARM_YOUTUBE_OAUTH_TOKEN"
        }
      }
    });

    expect(result.records.some((record) => record.status === "ok" && record.evidence_kind === "official_api_metadata")).toBe(true);
    await expectNoSecretLeak(runDir, [process.env.FARM_YOUTUBE_API_KEY, process.env.FARM_YOUTUBE_OAUTH_TOKEN]);
  });

  it.skipIf(!process.env.FARM_INSTAGRAM_ACCESS_TOKEN || !process.env.FARM_INSTAGRAM_MEDIA_ID)("collects Instagram Graph media metadata", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-api-instagram-integration-"));
    runDirs.push(runDir);
    const mediaId = process.env.FARM_INSTAGRAM_MEDIA_ID ?? "";
    const sourceUrl = process.env.FARM_INSTAGRAM_MEDIA_URL ?? `https://www.instagram.com/p/${mediaId}/`;

    const result = await collectOfficialApiEvidence({
      runDir,
      sourceUrl,
      contextToken: "ctx_integration",
      pageId: "api",
      baseCaptureId: "instagram-integration",
      platformCapabilities: describePlatformCapabilities(sourceUrl),
      officialApi: {
        enabled: true,
        credentials: {
          instagramAccessTokenEnv: "FARM_INSTAGRAM_ACCESS_TOKEN"
        }
      }
    });

    expect(result.records.some((record) => record.status === "ok" && record.evidence_kind === "official_api_metadata")).toBe(true);
    await expectNoSecretLeak(runDir, [process.env.FARM_INSTAGRAM_ACCESS_TOKEN]);
  });

  it.skipIf(!process.env.FARM_TIKTOK_ACCESS_TOKEN || !process.env.FARM_TIKTOK_VIDEO_ID)("collects TikTok Display API video metadata", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-api-tiktok-integration-"));
    runDirs.push(runDir);
    const username = process.env.FARM_TIKTOK_USERNAME ?? "integration";
    const videoId = process.env.FARM_TIKTOK_VIDEO_ID ?? "";
    const sourceUrl = process.env.FARM_TIKTOK_VIDEO_URL ?? `https://www.tiktok.com/@${username}/video/${videoId}`;

    const result = await collectOfficialApiEvidence({
      runDir,
      sourceUrl,
      contextToken: "ctx_integration",
      pageId: "api",
      baseCaptureId: "tiktok-integration",
      platformCapabilities: describePlatformCapabilities(sourceUrl),
      officialApi: {
        enabled: true,
        credentials: {
          tiktokAccessTokenEnv: "FARM_TIKTOK_ACCESS_TOKEN",
          tiktokResearchTokenEnv: "FARM_TIKTOK_RESEARCH_TOKEN"
        }
      }
    });

    expect(result.records.some((record) => record.status === "ok" && record.evidence_kind === "official_api_metadata")).toBe(true);
    await expectNoSecretLeak(runDir, [process.env.FARM_TIKTOK_ACCESS_TOKEN, process.env.FARM_TIKTOK_RESEARCH_TOKEN]);
  });
});

async function expectNoSecretLeak(runDir: string, secrets: Array<string | undefined>): Promise<void> {
  const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
  for (const secret of secrets) {
    if (secret === undefined || secret.length < 4) {
      continue;
    }
    expect(ledger).not.toContain(secret);
  }
}
