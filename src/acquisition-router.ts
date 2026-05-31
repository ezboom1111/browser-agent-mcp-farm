import type { CoverageClass, CoverageReport, CoverageReportEntry } from "./coverage-report.js";

// Acquisition routing brain (v0.4.0). For a vast, heterogeneous source universe, the farm does
// NOT maintain per-site scrapers — it picks, per source, the cheapest viable acquisition TIER and
// falls back honestly. `byo_capture` is the universal last resort: when the farm cannot capture a
// source itself (anti-bot, mobile-only, login-walled), ANY external tool/agent/human — or a
// consented mobile session — can capture the bytes and the farm VERIFIES them via the same
// cite-or-fail gate. So no source is truly impossible; it is only "not captured by the farm
// directly". Lawful-refusal (payments, bypassing others' access controls) stays enforced upstream
// in source-strategy.ts, not here.

export type AcquisitionTier =
  | "official_api" // lawful, credential-gated API connector (no browser, no anti-bot)
  | "feed" // sitemap / RSS / JSON-LD / canonical (cheapest, robust to redesigns)
  | "http_fetch" // tier-0 browserless GET: server-rendered HTML/hydration captured without Chromium
  | "model_extract" // generic deterministic/model extraction from already-captured bytes (no per-site selectors)
  | "profile" // the user's consented, lease-scoped persistent profile
  | "headed" // headed human-in-the-loop capture
  | "byo_capture"; // bring-your-own-capture: any external tool/agent/human feeds bytes; the farm verifies

// Cost/robustness order, cheapest first. http_fetch sits after feed (a feed is more redesign-robust)
// and before any browser tier (it needs no Chromium), so a server-rendered page is captured cheaply.
export const ACQUISITION_TIERS: AcquisitionTier[] = ["official_api", "feed", "http_fetch", "model_extract", "profile", "headed", "byo_capture"];

export interface AcquisitionRoute {
  platform: string;
  displayName: string;
  coverageClass: CoverageClass;
  /** Ordered viable tiers, cheapest first; always ends in byo_capture (the universal fallback). */
  tiers: AcquisitionTier[];
  /** The first viable tier to attempt. */
  recommended: AcquisitionTier;
  reasons: string[];
}

// Each coverage class routes to its ordered viable tiers. byo_capture closes every list as the
// universal verifier-fallback, so the router never implies the farm can autonomously capture
// everything — the honest answer for a hard source is "an external capture can still feed the gate".
const TIERS_BY_CLASS: Record<CoverageClass, AcquisitionTier[]> = {
  api_backed: ["official_api", "feed", "http_fetch", "model_extract", "byo_capture"],
  autonomous_ready: ["feed", "http_fetch", "model_extract", "byo_capture"],
  headed_only: ["profile", "headed", "byo_capture"], // auth/anti-bot sensitive: a browserless GET won't pass
  unmaintained: ["feed", "http_fetch", "model_extract", "byo_capture"],
  blocked: ["byo_capture"]
};

export function routeAcquisition(entry: CoverageReportEntry): AcquisitionRoute {
  const tiers = TIERS_BY_CLASS[entry.coverageClass];
  const recommended = tiers[0] ?? "byo_capture";
  return {
    platform: entry.platform,
    displayName: entry.displayName,
    coverageClass: entry.coverageClass,
    tiers,
    recommended,
    reasons: [`coverage '${entry.coverageClass}' → try '${recommended}' first; byo_capture is the universal fallback (the farm verifies bytes it did not capture).`, ...entry.reasons]
  };
}

export function routeCoverageReport(report: CoverageReport): AcquisitionRoute[] {
  return report.entries.map(routeAcquisition);
}

export function formatAcquisitionRoutesAsLines(routes: AcquisitionRoute[]): string {
  const lines = [`# acquisition routes (${routes.length} sources; cheapest viable tier first)`];
  for (const route of routes) {
    lines.push(`${route.coverageClass}\t→ ${route.recommended}\t${route.platform}\t[${route.tiers.join(" > ")}]`);
  }
  return `${lines.join("\n")}\n`;
}
