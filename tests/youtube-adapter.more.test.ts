import { describe, expect, it } from "vitest";
import { parseYouTubeVideoId, YouTubeEvidenceAdapter } from "../src/platform-adapters/youtube.js";

const a = new YouTubeEvidenceAdapter();

describe("YouTubeEvidenceAdapter.canHandle", () => {
  it("matches youtube hosts and youtu.be, rejects others", () => {
    expect(a.canHandle(new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))).toBe(true);
    expect(a.canHandle(new URL("https://m.youtube.com/watch?v=dQw4w9WgXcQ"))).toBe(true);
    expect(a.canHandle(new URL("https://youtu.be/dQw4w9WgXcQ"))).toBe(true);
    expect(a.canHandle(new URL("https://vimeo.com/123"))).toBe(false);
  });
});

describe("parseYouTubeVideoId", () => {
  it("reads watch, youtu.be, shorts, embed and live forms", () => {
    expect(parseYouTubeVideoId(new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId(new URL("https://youtu.be/dQw4w9WgXcQ"))).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeVideoId(new URL("https://www.youtube.com/shorts/abc123def45"))).toBe("abc123def45");
    expect(parseYouTubeVideoId(new URL("https://www.youtube.com/embed/abc123def45"))).toBe("abc123def45");
    expect(parseYouTubeVideoId(new URL("https://www.youtube.com/live/abc123def45"))).toBe("abc123def45");
  });
  it("rejects too-short ids and unknown paths", () => {
    expect(parseYouTubeVideoId(new URL("https://www.youtube.com/watch?v=short"))).toBeUndefined();
    expect(parseYouTubeVideoId(new URL("https://www.youtube.com/watch"))).toBeUndefined();
    expect(parseYouTubeVideoId(new URL("https://www.youtube.com/feed/trending"))).toBeUndefined();
  });
});

describe("YouTubeEvidenceAdapter.describe", () => {
  it("high confidence + canonical + mediaId for a valid id", () => {
    const d = a.describe(new URL("https://youtu.be/dQw4w9WgXcQ?t=10"));
    expect(d.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(d.mediaId).toBe("dQw4w9WgXcQ");
    expect(d.confidence).toBe("high");
    expect(d.capabilities.metadata.requiresCredential).toBe("api_key");
    expect(d.capabilities.captionTrackList.status).toBe("available");
  });
  it("medium confidence + no mediaId for a non-video url", () => {
    const d = a.describe(new URL("https://www.youtube.com/feed/trending"));
    expect(d.confidence).toBe("medium");
    expect(d.mediaId).toBeUndefined();
  });
});
