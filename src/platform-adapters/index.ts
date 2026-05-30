import { InstagramEvidenceAdapter } from "./instagram.js";
import { TikTokEvidenceAdapter } from "./tiktok.js";
import { capability, notAttemptedCapability, type PlatformCapabilityMap, type PlatformEvidenceAdapter, type PlatformId } from "./types.js";
import { YouTubeEvidenceAdapter } from "./youtube.js";

export * from "./instagram.js";
export * from "./tiktok.js";
export * from "./types.js";
export * from "./youtube.js";

export const PLATFORM_ADAPTERS: PlatformEvidenceAdapter[] = [new YouTubeEvidenceAdapter(), new InstagramEvidenceAdapter(), new TikTokEvidenceAdapter()];

export function describePlatformCapabilities(inputUrl: string): PlatformCapabilityMap {
  const url = parseUrl(inputUrl);
  const adapter = PLATFORM_ADAPTERS.find((candidate) => candidate.canHandle(url));
  return adapter === undefined ? describeGenericCapabilities(url) : adapter.describe(url);
}

export function detectPlatform(inputUrl: string): PlatformId {
  return describePlatformCapabilities(inputUrl).platform;
}

function describeGenericCapabilities(url: URL): PlatformCapabilityMap {
  return {
    platform: "generic",
    inputUrl: url.toString(),
    canonicalUrl: url.toString(),
    confidence: "low",
    sources: [],
    warnings: ["No platform adapter matched this URL.", "Only browser-visible evidence can be characterized without a platform-specific API contract."],
    capabilities: {
      metadata: notAttemptedCapability("metadata", "No platform-specific metadata API contract is registered for this URL."),
      thumbnail: notAttemptedCapability("thumbnail", "No platform-specific thumbnail API contract is registered for this URL."),
      captionTrackList: notAttemptedCapability("captionTrackList", "No platform-specific caption track API contract is registered for this URL."),
      captionBody: notAttemptedCapability("captionBody", "No platform-specific caption body API contract is registered for this URL."),
      visibleFrameSampling: capability({
        name: "visibleFrameSampling",
        status: "available",
        source: "browser_visible",
        requiresCredential: "browser_session",
        artifactKind: "screenshot",
        confidence: "low",
        note: "A generic browser session can preserve visible screenshots, but platform semantics are unknown."
      }),
      rawVideoBytes: capability({
        name: "rawVideoBytes",
        status: "unavailable",
        source: "not_supported",
        requiresCredential: "none",
        artifactKind: "none",
        confidence: "medium",
        note: "Raw media byte capture is not a generic fallback evidence path.",
        legalLimit: "Do not bypass site, platform, DRM, or access controls."
      })
    }
  };
}

function parseUrl(inputUrl: string): URL {
  try {
    return new URL(inputUrl);
  } catch {
    throw new Error(`Invalid URL: ${inputUrl}`);
  }
}
