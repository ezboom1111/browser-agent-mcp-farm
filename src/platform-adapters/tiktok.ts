import { capability, type PlatformCapabilityMap, type PlatformEvidenceAdapter } from "./types.js";

const TIKTOK_SOURCES = [
  "https://developers.tiktok.com/doc/display-api-overview/",
  "https://developers.tiktok.com/doc/tiktok-api-v2-video-query/",
  "https://developers.tiktok.com/doc/about-research-api/",
  "https://developers.tiktok.com/doc/research-api-specs-query-videos/"
];

export class TikTokEvidenceAdapter implements PlatformEvidenceAdapter {
  readonly platform = "tiktok" as const;

  canHandle(url: URL): boolean {
    return isTikTokHost(url.hostname);
  }

  describe(url: URL): PlatformCapabilityMap {
    const video = parseTikTokVideo(url);
    const canonicalUrl = video === undefined ? url.toString() : `https://www.tiktok.com/@${video.username}/video/${video.id}`;
    return {
      platform: this.platform,
      inputUrl: url.toString(),
      canonicalUrl,
      ...(video === undefined ? {} : { mediaId: video.id, accountHint: video.username }),
      confidence: video === undefined ? "medium" : "high",
      sources: TIKTOK_SOURCES,
      warnings: [
        "Display API video query is limited to videos owned by the authorized user.",
        "Research API access is application- and eligibility-gated.",
        "Short links may require browser resolution before a stable media ID can be known."
      ],
      capabilities: {
        metadata: capability({
          name: "metadata",
          status: "available",
          source: "official_api",
          requiresCredential: "oauth",
          artifactKind: "structured",
          confidence: "high",
          note: "Display API /v2/video/query can return fields such as id, title, video_description, duration, cover_image_url, share_url, embed_link, and engagement counts.",
          condition: "Requires a user OAuth token and only verifies videos that belong to the authorized user; Research API can cover eligible public research data after approval."
        }),
        thumbnail: capability({
          name: "thumbnail",
          status: "available",
          source: "official_api",
          requiresCredential: "oauth",
          artifactKind: "media",
          confidence: "high",
          note: "Display API can return cover_image_url and refresh its TTL through /v2/video/query.",
          condition: "Available when the authorized API response includes cover_image_url."
        }),
        captionTrackList: capability({
          name: "captionTrackList",
          status: "unavailable",
          source: "not_supported",
          requiresCredential: "none",
          artifactKind: "none",
          confidence: "high",
          note: "The checked TikTok API surfaces do not expose a general timed caption track list for arbitrary videos."
        }),
        captionBody: capability({
          name: "captionBody",
          status: "available",
          source: "official_api",
          requiresCredential: "research_api",
          artifactKind: "text",
          confidence: "medium",
          note: "Research API video query can expose voice_to_text for approved research access when that data exists.",
          condition: "Requires approved Research API credentials and videos/features covered by the research data policy."
        }),
        visibleFrameSampling: capability({
          name: "visibleFrameSampling",
          status: "available",
          source: "browser_visible",
          requiresCredential: "browser_session",
          artifactKind: "screenshot",
          confidence: "medium",
          note: "Use browser-visible playback screenshots with timestamps when the video can be lawfully viewed in the session.",
          condition: "Login, region, autoplay, app interstitials, and anti-automation checks can affect visibility."
        }),
        rawVideoBytes: capability({
          name: "rawVideoBytes",
          status: "unavailable",
          source: "not_supported",
          requiresCredential: "none",
          artifactKind: "none",
          confidence: "high",
          note: "This farm does not download raw TikTok video bytes as an evidence path.",
          legalLimit: "Do not bypass platform streaming, watermarking, DRM, short-link, or access-control mechanisms."
        })
      }
    };
  }
}

export function parseTikTokVideo(url: URL): { username: string; id: string } | undefined {
  const parts = url.pathname.split("/").filter(Boolean);
  const accountPart = parts[0];
  const videoPart = parts[1];
  const id = parts[2];
  if (accountPart === undefined || videoPart !== "video" || id === undefined || !accountPart.startsWith("@")) {
    return undefined;
  }
  const username = accountPart.slice(1);
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(username) || !/^\d{8,32}$/.test(id)) {
    return undefined;
  }
  return { username, id };
}

function isTikTokHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "tiktok.com" || normalized === "www.tiktok.com" || normalized === "vm.tiktok.com" || normalized === "vt.tiktok.com";
}
