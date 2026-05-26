import { capability, type PlatformCapabilityMap, type PlatformEvidenceAdapter } from "./types.js";

const YOUTUBE_SOURCES = [
  "https://developers.google.com/youtube/v3/docs/videos/list",
  "https://developers.google.com/youtube/v3/docs/captions/list",
  "https://developers.google.com/youtube/v3/docs/captions/download"
];

export class YouTubeEvidenceAdapter implements PlatformEvidenceAdapter {
  readonly platform = "youtube" as const;

  canHandle(url: URL): boolean {
    return isYouTubeHost(url.hostname);
  }

  describe(url: URL): PlatformCapabilityMap {
    const videoId = parseYouTubeVideoId(url);
    const canonicalUrl = videoId === undefined ? url.toString() : `https://www.youtube.com/watch?v=${videoId}`;
    return {
      platform: this.platform,
      inputUrl: url.toString(),
      canonicalUrl,
      ...(videoId === undefined ? {} : { mediaId: videoId }),
      confidence: videoId === undefined ? "medium" : "high",
      sources: YOUTUBE_SOURCES,
      warnings: [
        "Official caption track metadata is authorization-gated.",
        "Official caption body download requires sufficient OAuth scope and rights.",
        "Raw video bytes are not a supported evidence path for this farm."
      ],
      capabilities: {
        metadata: capability({
          name: "metadata",
          status: "available",
          source: "official_api",
          requiresCredential: "api_key",
          artifactKind: "structured",
          confidence: "high",
          note: "Use YouTube Data API videos.list with parts such as snippet, contentDetails, statistics, and status."
        }),
        thumbnail: capability({
          name: "thumbnail",
          status: "available",
          source: "official_api",
          requiresCredential: "api_key",
          artifactKind: "media",
          confidence: "high",
          note: "Video resource snippet thumbnails can be preserved as media artifacts when returned."
        }),
        captionTrackList: capability({
          name: "captionTrackList",
          status: "available",
          source: "official_api",
          requiresCredential: "oauth",
          artifactKind: "structured",
          confidence: "high",
          note: "captions.list returns caption track metadata, not caption text.",
          condition: "Requires youtube.force-ssl or youtubepartner authorization with sufficient access."
        }),
        captionBody: capability({
          name: "captionBody",
          status: "available",
          source: "official_api",
          requiresCredential: "oauth",
          artifactKind: "text",
          confidence: "medium",
          note: "captions.download can return caption track content only when authorized for the track.",
          condition: "Treat third-party videos as unavailable unless credentials and rights are present.",
          legalLimit: "Do not scrape or bypass caption access controls."
        }),
        visibleFrameSampling: capability({
          name: "visibleFrameSampling",
          status: "available",
          source: "browser_visible",
          requiresCredential: "browser_session",
          artifactKind: "screenshot",
          confidence: "high",
          note: "Use visible playback screenshots with timestamps; do not infer unseen intervals."
        }),
        rawVideoBytes: capability({
          name: "rawVideoBytes",
          status: "unavailable",
          source: "not_supported",
          requiresCredential: "none",
          artifactKind: "none",
          confidence: "high",
          note: "This farm indexes video streams but does not download raw YouTube video bytes.",
          legalLimit: "Do not bypass YouTube streaming, DRM, or platform access controls."
        })
      }
    };
  }
}

export function parseYouTubeVideoId(url: URL): string | undefined {
  if (url.hostname === "youtu.be") {
    return cleanVideoId(url.pathname.split("/").filter(Boolean)[0]);
  }
  if (url.pathname === "/watch") {
    return cleanVideoId(url.searchParams.get("v") ?? undefined);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (["shorts", "embed", "live"].includes(parts[0] ?? "")) {
    return cleanVideoId(parts[1]);
  }
  return undefined;
}

function isYouTubeHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "youtube.com" || normalized === "www.youtube.com" || normalized === "m.youtube.com" || normalized === "youtu.be";
}

function cleanVideoId(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const clean = value.trim();
  return /^[a-zA-Z0-9_-]{6,32}$/.test(clean) ? clean : undefined;
}
