import type { PlatformCapabilityMap } from "./platform-adapters/index.js";

export type BrowserObstructionKind =
  | "login_wall"
  | "app_interstitial"
  | "bot_block"
  | "region_gate"
  | "age_gate"
  | "media_unavailable";

export type BrowserObstructionConfidence = "low" | "medium" | "high";

export interface BrowserObstructionDetection {
  kind: BrowserObstructionKind;
  confidence: BrowserObstructionConfidence;
  matchedSignals: string[];
  note: string;
}

export interface BrowserObstructionReport {
  status: "clear" | "detected";
  platform: PlatformCapabilityMap["platform"];
  url: string;
  finalUrl?: string;
  title?: string;
  detections: BrowserObstructionDetection[];
  warnings: string[];
}

export interface BrowserObstructionInput {
  platform: PlatformCapabilityMap["platform"];
  url: string;
  finalUrl?: string | undefined;
  title?: string | undefined;
  text?: string | undefined;
  html?: string | undefined;
}

interface ObstructionRule {
  kind: BrowserObstructionKind;
  signals: string[];
  note: string;
  socialPlatformBoost?: boolean;
}

const SOCIAL_PLATFORMS = new Set<PlatformCapabilityMap["platform"]>(["instagram", "tiktok"]);
const WEAK_APP_INTERSTITIAL_SIGNALS = new Set(["open the app", "download the app", "get the app"]);
const WEAK_MEDIA_UNAVAILABLE_SIGNALS = new Set(["couldn't load", "could not load"]);

const OBSTRUCTION_RULES: ObstructionRule[] = [
  {
    kind: "login_wall",
    signals: [
      "log in to continue",
      "login required",
      "sign in to continue",
      "sign in to view",
      "sign up to view",
      "create an account to view",
      "continue with facebook",
      "continue with google"
    ],
    note: "The visible page appears to require login, account creation, or identity continuation before evidence can be viewed.",
    socialPlatformBoost: true
  },
  {
    kind: "app_interstitial",
    signals: [
      "open app to continue",
      "open the app",
      "open the app to continue",
      "continue in the app",
      "download the app",
      "get the app"
    ],
    note: "The visible page appears to be an app-install or app-open interstitial rather than the target media.",
    socialPlatformBoost: true
  },
  {
    kind: "bot_block",
    signals: [
      "verify you are human",
      "show us your human side",
      "human or a bot",
      "can't tell if you're a human or a bot",
      "bot or not?",
      "unusual traffic",
      "automated",
      "automation",
      "captcha",
      "not a robot",
      "are you a robot",
      "i am not a robot",
      "i'm not a robot",
      "access denied",
      "access to this page has been denied",
      "permission to access",
      "errors.edgesuite.net",
      "temporarily blocked",
      "checking your browser",
      "performing security verification",
      "security service to protect against malicious bots",
      "malicious bots",
      "verifies you are not a bot",
      "you are not a bot",
      "you've been blocked by network security",
      "blocked by network security",
      "complete the security check",
      "performance and security by cloudflare",
      "ray id:",
      "pardon our interruption",
      "please enable cookies",
      "enable cookies to continue",
      "challenge required",
      "solve the puzzle below",
      "solve the task below",
      "complete the task below",
      "complete the challenge below",
      "datadome",
      "captcha-delivery.com",
      "geo.captcha-delivery.com",
      "var dd=",
      "var dd =",
      "\uC561\uC138\uC2A4\uAC00 \uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C",
      "\uCD94\uAC00 \uAC80\uC99D\uC774 \uD544\uC694",
      "\uBE44\uC815\uC0C1\uC801\uC778 \uD589\uB3D9",
      "\uBE0C\uB77C\uC6B0\uC9D5 \uC18D\uB3C4\uAC00 \uBE44\uC815\uC0C1\uC801\uC73C\uB85C \uBE68\uB77C",
      "\uB85C\uBD07\uC73C\uB85C \uC758\uC2EC",
      "\uC811\uC18D\uC774 \uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C",
      "\uC1FC\uD551 \uC11C\uBE44\uC2A4 \uC811\uC18D\uC774 \uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C",
      "\uC11C\uBE44\uC2A4 \uC774\uC6A9\uC774 \uC81C\uD55C",
      "\uC11C\uBE44\uC2A4 \uC774\uC6A9\uC774 \uC81C\uD55C\uB418\uC5C8\uC2B5\uB2C8\uB2E4",
      "\uACFC\uB3C4\uD55C \uC811\uADFC \uC694\uCCAD",
      "\uC811\uADFC \uC694\uCCAD\uC73C\uB85C \uC11C\uBE44\uC2A4 \uC774\uC6A9\uC774 \uC81C\uD55C",
      "\uBE44\uC815\uC0C1\uC801\uC778 \uC811\uADFC",
      "\uBD07 \uD655\uC778",
      "\uBD07(bot)",
      "\uAC04\uB2E8\uD55C \uD655\uC778",
      "\uC6D0\uD65C\uD55C \uC11C\uBE44\uC2A4 \uC774\uC6A9\uC744 \uC704\uD55C \uAC04\uB2E8\uD55C \uD655\uC778",
      "\uACC4\uC18D\uD558\uB824\uBA74 \uC544\uB798 \uACFC\uC81C",
      "\uC544\uB798 \uACFC\uC81C \uD574\uACB0",
      "\uACFC\uC81C \uD574\uACB0"
    ],
    note: "The visible page appears to be an anti-automation, challenge, or access-denied surface."
  },
  {
    kind: "region_gate",
    signals: [
      "not available in your region",
      "not available in this region",
      "not available in your country",
      "not available in this country",
      "not available in your area"
    ],
    note: "The visible page appears to restrict the target content by region or country."
  },
  {
    kind: "age_gate",
    signals: [
      "age-restricted",
      "confirm your age",
      "verify your age",
      "18+",
      "sensitive content"
    ],
    note: "The visible page appears to require age confirmation or sensitive-content acknowledgement."
  },
  {
    kind: "media_unavailable",
    signals: [
      "video unavailable",
      "this video is unavailable",
      "content isn't available",
      "content is not available",
      "post unavailable",
      "something went wrong",
      "something wrong with the server",
      "couldn't load",
      "could not load"
    ],
    note: "The visible page says the target media or post is unavailable."
  }
];

export function classifyBrowserObstructions(input: BrowserObstructionInput): BrowserObstructionReport {
  const haystack = normalizeText([
    input.title,
    input.finalUrl,
    input.url,
    input.text
  ].filter((value): value is string => value !== undefined).join("\n"));
  const detections = OBSTRUCTION_RULES
    .map((rule) => matchRule(rule, haystack, input.platform))
    .filter((detection): detection is BrowserObstructionDetection => detection !== undefined);
  const warnings = detections.map((detection) => `${detection.kind}:${detection.confidence}`);

  return {
    status: detections.length > 0 ? "detected" : "clear",
    platform: input.platform,
    url: input.url,
    ...(input.finalUrl === undefined ? {} : { finalUrl: input.finalUrl }),
    ...(input.title === undefined ? {} : { title: input.title }),
    detections,
    warnings
  };
}

function matchRule(rule: ObstructionRule, haystack: string, platform: PlatformCapabilityMap["platform"]): BrowserObstructionDetection | undefined {
  const matchedSignals = filterWeakSignals(
    rule,
    rule.signals.filter((signal) => haystack.includes(signal)),
    platform
  );
  if (matchedSignals.length === 0) {
    return undefined;
  }
  return {
    kind: rule.kind,
    confidence: confidenceFor(rule, platform, matchedSignals.length),
    matchedSignals,
    note: rule.note
  };
}

function filterWeakSignals(
  rule: ObstructionRule,
  matchedSignals: string[],
  platform: PlatformCapabilityMap["platform"]
): string[] {
  if (SOCIAL_PLATFORMS.has(platform)) {
    return matchedSignals;
  }
  if (rule.kind === "app_interstitial") {
    return matchedSignals.filter((signal) => !WEAK_APP_INTERSTITIAL_SIGNALS.has(signal));
  }
  if (rule.kind === "media_unavailable") {
    return matchedSignals.filter((signal) => !WEAK_MEDIA_UNAVAILABLE_SIGNALS.has(signal));
  }
  return matchedSignals;
}

function confidenceFor(rule: ObstructionRule, platform: PlatformCapabilityMap["platform"], signalCount: number): BrowserObstructionConfidence {
  if (signalCount >= 2 || (rule.socialPlatformBoost === true && SOCIAL_PLATFORMS.has(platform))) {
    return "high";
  }
  if (rule.kind === "bot_block" || rule.kind === "region_gate" || rule.kind === "media_unavailable") {
    return "high";
  }
  return "medium";
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ");
}
