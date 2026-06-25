import type { AcquisitionTier } from "./acquisition-router.js";
import type { BrowserObstructionKind } from "./browser-obstructions.js";
import { describeSourceStrategy, type SourceFamily, type SourcePlatform } from "./source-strategy.js";

export type AcquisitionFailureSignal = "none" | "http_fetch_declined" | "empty_shell" | "browser_blocked" | "login_or_paywall" | "captcha_or_challenge" | "manual_selector_pressure";

export type AcquisitionIntent = "single_page" | "bulk_collection";

export type AcquisitionMethodTrust = "farm_direct" | "operator_consent" | "external_untrusted";

export type AcquisitionMethodStatus = "try" | "conditional" | "terminal" | "unsupported";

export type AcquisitionMethodTier = AcquisitionTier | "external_bridge";

export interface AcquisitionMethodStep {
  key: string;
  phase: 0 | 1 | 2 | 3 | 4;
  tier: AcquisitionMethodTier;
  trust: AcquisitionMethodTrust;
  status: AcquisitionMethodStatus;
  captureMethod?: string;
  reason: string;
  safety: string[];
}

export interface AcquisitionMethodPlanInput {
  url: string;
  observedFailure?: AcquisitionFailureSignal;
  intent?: AcquisitionIntent;
  allowExternalBridge?: boolean;
}

export interface AcquisitionMethodPlan {
  schemaVersion: "1.0";
  inputUrl: string;
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  observedFailure: AcquisitionFailureSignal;
  intent: AcquisitionIntent;
  methods: AcquisitionMethodStep[];
  refusalBoundaries: string[];
  knowledgeBaseTags: string[];
  decision: string;
}

interface PlatformPublicEndpoint {
  key: string;
  tier: AcquisitionTier;
  reason: string;
  captureMethod: string;
}

const PUBLIC_ENDPOINTS: Partial<Record<SourcePlatform, PlatformPublicEndpoint>> = {
  youtube: {
    key: "youtube_official_api_or_served_metadata",
    tier: "official_api",
    reason: "Use credential-gated YouTube Data API metadata first; transcript or frame claims still need captured caption/OCR/frame artifacts.",
    captureMethod: "official-api"
  },
  reddit: {
    key: "reddit_rss_or_public_json",
    tier: "feed",
    reason: "Try public RSS/Atom or public JSON-style surfaces before rendering the full page.",
    captureMethod: "feed"
  },
  x_twitter: {
    key: "x_public_syndication_or_oembed",
    tier: "feed",
    reason: "For public posts, try public syndication/oEmbed-style metadata before a browser capture.",
    captureMethod: "feed"
  },
  stack_overflow: {
    key: "stack_exchange_public_api",
    tier: "official_api",
    reason: "Use Stack Exchange's public API surface for question metadata where it covers the claim.",
    captureMethod: "official-api"
  },
  wikipedia: {
    key: "wikipedia_public_api",
    tier: "official_api",
    reason: "Use public REST/API content where it covers the claim, then seal exact returned bytes.",
    captureMethod: "official-api"
  },
  pubmed: {
    key: "pubmed_public_endpoint",
    tier: "official_api",
    reason: "Use public NCBI/PubMed metadata endpoints where they cover the claim.",
    captureMethod: "official-api"
  },
  naver_search: {
    key: "naver_public_search_surface",
    tier: "feed",
    reason: "Start from the public search surface and its rendered snippets; do not treat snippets as destination proof.",
    captureMethod: "feed"
  },
  naver_news: {
    key: "naver_news_public_surface",
    tier: "feed",
    reason: "Start from public news/search surfaces, then open destination articles as separate evidence when claims depend on them.",
    captureMethod: "feed"
  },
  naver_blog: {
    key: "naver_blog_public_browser_surface",
    tier: "headed",
    reason: "Naver desktop blog posts may serve a thin iframe shell to browserless HTTP; escalate to the public browser-visible frame or mobile surface before asking for BYO.",
    captureMethod: "browser-agent-mcp-farm capture"
  }
};

const DEFAULT_BOUNDARIES = [
  "Do not bypass login, paywall, CAPTCHA, age gate, payments, bookings, account changes, DRM, or raw media stream protections.",
  "Treat external capturers as untrusted byte suppliers; only the farm gate verifies registered bytes and anchors.",
  "Do not revive per-site selector recipes as an autonomous crawler path; selector pressure should become capture or BYO guidance."
];

export function planAcquisitionMethods(input: AcquisitionMethodPlanInput): AcquisitionMethodPlan {
  const sourceStrategy = describeSourceStrategy(input.url);
  const observedFailure = input.observedFailure ?? "none";
  const intent = input.intent ?? "single_page";
  const methods: AcquisitionMethodStep[] = [];

  const endpoint = PUBLIC_ENDPOINTS[sourceStrategy.platform];
  if (endpoint !== undefined) {
    methods.push({
      key: endpoint.key,
      phase: 0,
      tier: endpoint.tier,
      trust: "farm_direct",
      status: "try",
      captureMethod: endpoint.captureMethod,
      reason: endpoint.reason,
      safety: ["Register exact API/feed bytes before citing them.", "Open destination pages separately when a portal snippet is only a lead."]
    });
  }

  methods.push(
    {
      key: "generic_feed_sitemap_metadata_discovery",
      phase: 1,
      tier: "feed",
      trust: "farm_direct",
      status: "try",
      captureMethod: "feed",
      reason: "Prefer redesign-stable public feeds, sitemaps, JSON-LD, Open Graph, and canonical metadata before browser work.",
      safety: ["Publisher metadata is a site claim; cross-check it against visible DOM/OCR when a claim depends on it."]
    },
    {
      key: "tier0_http_fetch_with_validation",
      phase: 1,
      tier: "http_fetch",
      trust: "farm_direct",
      status: "try",
      captureMethod: "http-fetch",
      reason: "Try browserless HTTP capture for server-rendered bytes, but treat 200 OK as only a candidate, not proof of content quality.",
      safety: ["Reject tiny shells, challenge pages, non-HTML, off-domain redirects, and empty structured responses."]
    },
    {
      key: "deterministic_model_extract_from_captured_bytes",
      phase: 1,
      tier: "model_extract",
      trust: "farm_direct",
      status: "conditional",
      captureMethod: "structured-extractor",
      reason: "Extract deterministic/structured derivatives only from bytes already captured or registered.",
      safety: ["Never register model prose as evidence; cite the underlying captured bytes."]
    },
    {
      key: "browser_visible_capture",
      phase: 2,
      tier: "headed",
      trust: "farm_direct",
      status: "try",
      captureMethod: "browser-agent-mcp-farm capture",
      reason: "Render the public page in an isolated browser context and preserve screenshot, text, HTML, media index, OCR, obstructions, and frames as needed.",
      safety: ["Record obstruction artifacts instead of treating blocked pages as missing facts."]
    }
  );

  if (isTerminalAccessFailure(observedFailure)) {
    methods.push({
      key: "consented_profile_or_human_byo_only",
      phase: 3,
      tier: "profile",
      trust: "operator_consent",
      status: "terminal",
      captureMethod: "byo-operator",
      reason: "The observed failure is an access-control boundary; continue only with a consented saved profile, headed human review, or human BYO bytes.",
      safety: ["Do not automate CAPTCHA solving, paywall defeat, login bypass, or account-bound scraping."]
    });
  } else if (shouldOfferExternalBridge(observedFailure, input.allowExternalBridge === true)) {
    methods.push({
      key: "caged_external_bridge_byo",
      phase: 3,
      tier: "external_bridge",
      trust: "external_untrusted",
      status: "conditional",
      captureMethod: "byo-bridge",
      reason: "If direct farm capture is blocked, a zero-credential domain-fenced external method selector can supply bytes that the farm registers and gate-checks.",
      safety: ["External bridge must be opt-in, read-only, short-lived, domain-fenced, and credential-free.", "Label provenance explicitly, for example captureMethod='byo-insane-search' or captureMethod='byo-bridge'."]
    });
  }

  methods.push({
    key: "universal_byo_capture_registration",
    phase: 4,
    tier: "byo_capture",
    trust: observedFailure === "none" ? "external_untrusted" : "operator_consent",
    status: "conditional",
    captureMethod: "byo_capture",
    reason: "When the farm cannot acquire a source directly, any lawful external tool, consented browser, mobile session, or human paste can still feed exact bytes into the same cite-or-fail gate.",
    safety: ["The final answer may cite only registered bytes whose anchors pass the claim gate."]
  });

  return {
    schemaVersion: "1.0",
    inputUrl: sourceStrategy.inputUrl,
    platform: sourceStrategy.platform,
    sourceFamily: sourceStrategy.sourceFamily,
    observedFailure,
    intent,
    methods: collapseMethodsForIntent(methods, intent),
    refusalBoundaries: DEFAULT_BOUNDARIES,
    knowledgeBaseTags: ["leesearch", "insane-search-dna", "acquisition-router", "byo_capture", "claim-gate"],
    decision: decisionFor(observedFailure, input.allowExternalBridge === true)
  };
}

export function observedFailureFromBrowserObstructionKinds(kinds: readonly BrowserObstructionKind[]): AcquisitionFailureSignal {
  const kindSet = new Set(kinds);
  if (kindSet.has("bot_block")) {
    return "captcha_or_challenge";
  }
  if (kindSet.has("login_wall") || kindSet.has("age_gate") || kindSet.has("region_gate")) {
    return "login_or_paywall";
  }
  if (kindSet.has("app_interstitial") || kindSet.has("media_unavailable")) {
    return "browser_blocked";
  }
  return "none";
}

function isTerminalAccessFailure(signal: AcquisitionFailureSignal): boolean {
  return signal === "login_or_paywall" || signal === "captcha_or_challenge";
}

function shouldOfferExternalBridge(signal: AcquisitionFailureSignal, allowExternalBridge: boolean): boolean {
  if (!allowExternalBridge) {
    return false;
  }
  return signal === "http_fetch_declined" || signal === "empty_shell" || signal === "browser_blocked" || signal === "manual_selector_pressure";
}

function collapseMethodsForIntent(methods: AcquisitionMethodStep[], intent: AcquisitionIntent): AcquisitionMethodStep[] {
  if (intent !== "bulk_collection") {
    return methods;
  }
  return methods.map((method) => {
    if (method.key === "generic_feed_sitemap_metadata_discovery") {
      return {
        ...method,
        status: "try" as const,
        reason: `${method.reason} For bulk collection, batch by host and prefer feed/API pagination over browser loops.`
      };
    }
    if (method.key === "browser_visible_capture") {
      return {
        ...method,
        status: "conditional" as const,
        reason: `${method.reason} For bulk collection, use it to discover public JSON/feed endpoints and verify sampled pages, not to crawl unbounded pages.`
      };
    }
    return method;
  });
}

function decisionFor(signal: AcquisitionFailureSignal, allowExternalBridge: boolean): string {
  if (isTerminalAccessFailure(signal)) {
    return "Do not escalate autonomously; require consented profile/headed/human BYO capture and keep the obstruction in the evidence bundle.";
  }
  if (allowExternalBridge && shouldOfferExternalBridge(signal, true)) {
    return "Integrate external method-selection DNA as a caged BYO/external-bridge supplier, not as trusted farm capture.";
  }
  return "Use farm-native tiers first and keep BYO capture as the universal verifier-backed fallback.";
}
