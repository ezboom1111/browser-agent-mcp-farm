import { capability, type PlatformCapabilityMap, type PlatformEvidenceAdapter } from "./types.js";

const INSTAGRAM_SOURCES = ["https://developers.facebook.com/docs/instagram-platform/reference/instagram-media"];

export class InstagramEvidenceAdapter implements PlatformEvidenceAdapter {
  readonly platform = "instagram" as const;

  canHandle(url: URL): boolean {
    return isInstagramHost(url.hostname);
  }

  describe(url: URL): PlatformCapabilityMap {
    const shortcode = parseInstagramShortcode(url);
    const canonicalUrl = shortcode === undefined ? url.toString() : `https://www.instagram.com/${shortcode.kind}/${shortcode.id}/`;
    return {
      platform: this.platform,
      inputUrl: url.toString(),
      canonicalUrl,
      ...(shortcode === undefined ? {} : { mediaId: shortcode.id }),
      confidence: shortcode === undefined ? "medium" : "high",
      sources: INSTAGRAM_SOURCES,
      warnings: ["Instagram Graph API media reads are account, permission, and media-ownership constrained.", "The documented Graph path cannot be treated as a general public post metadata endpoint.", "media_url can be omitted for copyright-flagged material."],
      capabilities: {
        metadata: capability({
          name: "metadata",
          status: "available",
          source: "official_api",
          requiresCredential: "oauth",
          artifactKind: "structured",
          confidence: "high",
          note: "IG Media can expose fields such as caption, media_type, permalink, timestamp, username, comments_count, and like_count.",
          condition: "Requires an eligible Instagram account, access token, permissions, and readable media."
        }),
        thumbnail: capability({
          name: "thumbnail",
          status: "available",
          source: "official_api",
          requiresCredential: "oauth",
          artifactKind: "media",
          confidence: "medium",
          note: "thumbnail_url is documented for VIDEO media only.",
          condition: "Available only when the media is a video and the API returns thumbnail_url."
        }),
        captionTrackList: capability({
          name: "captionTrackList",
          status: "unavailable",
          source: "not_supported",
          requiresCredential: "none",
          artifactKind: "none",
          confidence: "high",
          note: "IG Media exposes post caption metadata, not timed caption tracks."
        }),
        captionBody: capability({
          name: "captionBody",
          status: "unavailable",
          source: "not_supported",
          requiresCredential: "none",
          artifactKind: "none",
          confidence: "high",
          note: "No official timed transcript body is exposed for general IG Media in the checked API surface."
        }),
        visibleFrameSampling: capability({
          name: "visibleFrameSampling",
          status: "available",
          source: "browser_visible",
          requiresCredential: "browser_session",
          artifactKind: "screenshot",
          confidence: "medium",
          note: "Use browser-visible frames when the post/reel can be lawfully viewed in the session.",
          condition: "Login, region, embed setting, and anti-automation checks can affect visibility."
        }),
        rawVideoBytes: capability({
          name: "rawVideoBytes",
          status: "unavailable",
          source: "not_supported",
          requiresCredential: "none",
          artifactKind: "none",
          confidence: "medium",
          note: "Do not rely on raw video bytes for general Instagram evidence runs.",
          legalLimit: "Only preserve media bytes when a legitimate API response returns a media_url that the run is authorized to access."
        })
      }
    };
  }
}

export function parseInstagramShortcode(url: URL): { kind: "p" | "reel" | "tv"; id: string } | undefined {
  const parts = url.pathname.split("/").filter(Boolean);
  const kind = parts[0];
  if (kind !== "p" && kind !== "reel" && kind !== "tv") {
    return undefined;
  }
  const id = parts[1];
  if (id === undefined || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return undefined;
  }
  return { kind, id };
}

function isInstagramHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "instagram.com" || normalized === "www.instagram.com";
}
