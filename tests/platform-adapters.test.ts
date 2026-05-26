import { describe, expect, it } from "vitest";
import { describePlatformCapabilities, detectPlatform, parseInstagramShortcode, parseTikTokVideo, parseYouTubeVideoId } from "../src/platform-adapters/index.js";

describe("platform adapters", () => {
  it("describes YouTube watch URLs with official API and browser-visible evidence paths", () => {
    const result = describePlatformCapabilities("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    expect(result.platform).toBe("youtube");
    expect(result.mediaId).toBe("dQw4w9WgXcQ");
    expect(result.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.capabilities.metadata).toMatchObject({
      status: "available",
      source: "official_api",
      requiresCredential: "api_key"
    });
    expect(result.capabilities.captionBody).toMatchObject({
      status: "available",
      requiresCredential: "oauth"
    });
    expect(result.capabilities.rawVideoBytes).toMatchObject({
      status: "unavailable",
      source: "not_supported"
    });
  });

  it("parses YouTube short and embedded video IDs", () => {
    expect(parseYouTubeVideoId(new URL("https://youtu.be/dQw4w9WgXcQ"))).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId(new URL("https://www.youtube.com/shorts/abc123_DEF"))).toBe("abc123_DEF");
    expect(parseYouTubeVideoId(new URL("https://www.youtube.com/embed/xyz789"))).toBe("xyz789");
  });

  it("describes Instagram reel URLs with ownership and thumbnail constraints", () => {
    const result = describePlatformCapabilities("https://www.instagram.com/reel/ABC123_/");

    expect(result.platform).toBe("instagram");
    expect(result.mediaId).toBe("ABC123_");
    expect(result.canonicalUrl).toBe("https://www.instagram.com/reel/ABC123_/");
    expect(result.capabilities.captionTrackList.status).toBe("unavailable");
    expect(result.capabilities.thumbnail.note).toContain("VIDEO");
    expect(parseInstagramShortcode(new URL("https://www.instagram.com/p/Post_123/"))).toEqual({
      kind: "p",
      id: "Post_123"
    });
  });

  it("describes TikTok canonical video URLs with Display API and Research API limits", () => {
    const result = describePlatformCapabilities("https://www.tiktok.com/@creator.video/video/1234567890123456789");

    expect(result.platform).toBe("tiktok");
    expect(result.mediaId).toBe("1234567890123456789");
    expect(result.accountHint).toBe("creator.video");
    expect(result.canonicalUrl).toBe("https://www.tiktok.com/@creator.video/video/1234567890123456789");
    expect(result.capabilities.captionBody).toMatchObject({
      status: "available",
      requiresCredential: "research_api"
    });
    expect(result.capabilities.rawVideoBytes.status).toBe("unavailable");
    expect(parseTikTokVideo(new URL("https://www.tiktok.com/@creator/video/1234567890123456789"))).toEqual({
      username: "creator",
      id: "1234567890123456789"
    });
  });

  it("returns a generic fallback for unsupported URLs", () => {
    const result = describePlatformCapabilities("https://example.com/article");

    expect(result.platform).toBe("generic");
    expect(result.capabilities.metadata.status).toBe("not_attempted");
    expect(result.capabilities.visibleFrameSampling.status).toBe("available");
    expect(result.capabilities.rawVideoBytes.status).toBe("unavailable");
    expect(detectPlatform("https://example.com/article")).toBe("generic");
  });

  it("rejects invalid URLs", () => {
    expect(() => describePlatformCapabilities("not a url")).toThrow("Invalid URL");
  });
});
