import { describe, expect, it } from "vitest";
import { InstagramEvidenceAdapter, parseInstagramShortcode } from "../src/platform-adapters/instagram.js";
import { TikTokEvidenceAdapter, parseTikTokVideo } from "../src/platform-adapters/tiktok.js";

describe("InstagramEvidenceAdapter", () => {
  const a = new InstagramEvidenceAdapter();
  it("handles instagram hosts only", () => {
    expect(a.canHandle(new URL("https://www.instagram.com/p/ABC/"))).toBe(true);
    expect(a.canHandle(new URL("https://instagram.com/x"))).toBe(true);
    expect(a.canHandle(new URL("https://example.com/p/ABC/"))).toBe(false);
  });
  it("parses p/reel/tv shortcodes and rejects others", () => {
    expect(parseInstagramShortcode(new URL("https://www.instagram.com/p/AbC-1_2/"))).toEqual({ kind: "p", id: "AbC-1_2" });
    expect(parseInstagramShortcode(new URL("https://www.instagram.com/reel/XYZ/"))).toEqual({ kind: "reel", id: "XYZ" });
    expect(parseInstagramShortcode(new URL("https://www.instagram.com/tv/T1/"))).toEqual({ kind: "tv", id: "T1" });
    expect(parseInstagramShortcode(new URL("https://www.instagram.com/nasa/"))).toBeUndefined();
    expect(parseInstagramShortcode(new URL("https://www.instagram.com/p/bad.id/"))).toBeUndefined();
  });
  it("describe yields high confidence, canonical and mediaId for a known shortcode", () => {
    const d = a.describe(new URL("https://www.instagram.com/p/ABC/?utm=x"));
    expect(d.platform).toBe("instagram");
    expect(d.canonicalUrl).toBe("https://www.instagram.com/p/ABC/");
    expect(d.mediaId).toBe("ABC");
    expect(d.confidence).toBe("high");
    expect(d.capabilities.metadata.status).toBe("available");
    expect(d.capabilities.captionBody.status).toBe("unavailable");
  });
  it("describe falls back to medium confidence with no mediaId for a non-post url", () => {
    const d = a.describe(new URL("https://www.instagram.com/nasa/"));
    expect(d.confidence).toBe("medium");
    expect(d.mediaId).toBeUndefined();
    expect(d.canonicalUrl).toBe("https://www.instagram.com/nasa/");
  });
});

describe("TikTokEvidenceAdapter", () => {
  const a = new TikTokEvidenceAdapter();
  it("handles tiktok hosts including short-link subdomains", () => {
    expect(a.canHandle(new URL("https://www.tiktok.com/@nasa/video/12345678"))).toBe(true);
    expect(a.canHandle(new URL("https://vm.tiktok.com/abc"))).toBe(true);
    expect(a.canHandle(new URL("https://vt.tiktok.com/abc"))).toBe(true);
    expect(a.canHandle(new URL("https://example.com"))).toBe(false);
  });
  it("parses @user/video/<digits> and rejects malformed", () => {
    expect(parseTikTokVideo(new URL("https://www.tiktok.com/@nasa/video/12345678"))).toEqual({ username: "nasa", id: "12345678" });
    expect(parseTikTokVideo(new URL("https://www.tiktok.com/@nasa/photo/12345678"))).toBeUndefined();
    expect(parseTikTokVideo(new URL("https://www.tiktok.com/@nasa/video/123"))).toBeUndefined();
    expect(parseTikTokVideo(new URL("https://www.tiktok.com/nasa/video/12345678"))).toBeUndefined();
  });
  it("describe yields canonical, mediaId and accountHint for a video url", () => {
    const d = a.describe(new URL("https://www.tiktok.com/@nasa/video/12345678?x=1"));
    expect(d.canonicalUrl).toBe("https://www.tiktok.com/@nasa/video/12345678");
    expect(d.mediaId).toBe("12345678");
    expect(d.accountHint).toBe("nasa");
    expect(d.confidence).toBe("high");
    expect(d.capabilities.captionBody.status).toBe("available");
  });
});
