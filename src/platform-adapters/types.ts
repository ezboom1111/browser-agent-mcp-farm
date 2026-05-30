export type PlatformId = "youtube" | "instagram" | "tiktok" | "generic";

export type CapabilityName = "metadata" | "thumbnail" | "captionTrackList" | "captionBody" | "visibleFrameSampling" | "rawVideoBytes";

export type CapabilityStatus = "available" | "unavailable" | "not_attempted";
export type CredentialKind = "none" | "api_key" | "oauth" | "research_api" | "browser_session";

export interface EvidenceCapability {
  name: CapabilityName;
  status: CapabilityStatus;
  source: "official_api" | "browser_visible" | "not_supported";
  requiresCredential: CredentialKind;
  artifactKind: "structured" | "media" | "screenshot" | "text" | "none";
  confidence: "high" | "medium" | "low";
  note: string;
  condition?: string;
  legalLimit?: string;
}

export interface PlatformCapabilityMap {
  platform: PlatformId;
  inputUrl: string;
  canonicalUrl: string;
  mediaId?: string;
  accountHint?: string;
  confidence: "high" | "medium" | "low";
  capabilities: Record<CapabilityName, EvidenceCapability>;
  sources: string[];
  warnings: string[];
}

export interface PlatformEvidenceAdapter {
  readonly platform: PlatformId;
  canHandle(url: URL): boolean;
  describe(url: URL): PlatformCapabilityMap;
}

export const CAPABILITY_NAMES: CapabilityName[] = ["metadata", "thumbnail", "captionTrackList", "captionBody", "visibleFrameSampling", "rawVideoBytes"];

export function capability(input: EvidenceCapability): EvidenceCapability {
  return input;
}

export function notAttemptedCapability(name: CapabilityName, note: string): EvidenceCapability {
  return {
    name,
    status: "not_attempted",
    source: "not_supported",
    requiresCredential: "none",
    artifactKind: "none",
    confidence: "medium",
    note
  };
}
