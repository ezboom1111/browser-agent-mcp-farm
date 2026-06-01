import type { EvidenceKind, ClaimType } from "./schemas.js";
import { type InformationCategory, type LocaleSegment, type SourceRegistryEntry, listSourceRegistryEntries } from "./source-registry.js";

// Research LENSES (engine #3). The farm's core — capture + the cite-or-fail gate — is domain-neutral.
// A "lens" is a DECLARATIVE config (not forked code) that points the same engine at a domain: WHICH
// source categories to prioritize, WHAT typed claims to author (and which need cross-source
// corroboration, engine #2), and HOW to shape the cited report. So marketing / product-planning / etc.
// are data here, not separate skills — the gstack "many skills" model done as config over one engine,
// which keeps generality (no domain semantics leak into the core; the boundary guard still holds).

export interface LensClaimTemplate {
  id: string;
  claimType: ClaimType;
  description: string;
  /** Evidence kinds that can ground this claim (the agent must cite one of these). */
  groundingEvidenceKinds: EvidenceKind[];
  /** High-stakes claims (numbers, prices) should be corroborated across independent sources (engine #2). */
  recommendCorroboration: boolean;
}

export interface Lens {
  id: string;
  displayName: string;
  description: string;
  /** Source-registry information categories this lens prioritizes (selected via listSourceRegistryEntries). */
  sourceCategories: InformationCategory[];
  claimTemplates: LensClaimTemplate[];
  /** Ordered section headings for the lens's cited report. */
  reportSections: string[];
}

const RESEARCH: Lens = {
  id: "research",
  displayName: "General research",
  description: "Domain-neutral evidence research: capture sources, author grounded claims, cite or fail.",
  sourceCategories: ["search", "news_media", "knowledge_database", "content_media"],
  claimTemplates: [
    { id: "fact", claimType: "text", description: "A factual statement grounded in a quoted span of page text.", groundingEvidenceKinds: ["page_text", "page_html", "ocr_text"], recommendCorroboration: false },
    { id: "figure", claimType: "metadata", description: "A numeric or typed figure read from structured/visible data.", groundingEvidenceKinds: ["structured_data", "page_text"], recommendCorroboration: true }
  ],
  reportSections: ["Summary", "Findings", "Open questions", "Sources"]
};

const MARKET_SCAN: Lens = {
  id: "market_scan",
  displayName: "Market scan (marketing)",
  description: "Competitive/market research: competitor pricing, review sentiment, and market sizing — each claim cited, the high-stakes numbers corroborated across independent sources.",
  sourceCategories: ["marketplace_transaction", "review_reputation", "news_media", "social_feed", "recommendation_curation"],
  claimTemplates: [
    { id: "competitor_price", claimType: "metadata", description: "A competitor's listed price/plan, read from the product page (structured data, visible text, or OCR).", groundingEvidenceKinds: ["structured_data", "page_text", "ocr_text"], recommendCorroboration: true },
    { id: "review_sentiment", claimType: "text", description: "A review-sentiment statement, each supporting quote grounded in a captured review.", groundingEvidenceKinds: ["page_text"], recommendCorroboration: false },
    { id: "market_figure", claimType: "metadata", description: "A market-size, growth, or share figure.", groundingEvidenceKinds: ["structured_data", "page_text"], recommendCorroboration: true }
  ],
  reportSections: ["Executive summary", "Competitor pricing", "Review sentiment", "Market sizing", "Sources"]
};

const PRODUCT_PLANNING: Lens = {
  id: "product_planning",
  displayName: "Product planning",
  description: "Requirement/opportunity research: user pains, feature gaps, and adoption signals from forums, reviews, and docs — each grounded in a quoted source.",
  sourceCategories: ["community_forum", "review_reputation", "knowledge_database", "content_media", "news_media"],
  claimTemplates: [
    { id: "user_pain", claimType: "text", description: "A user-reported pain point, grounded in a forum/review quote.", groundingEvidenceKinds: ["page_text"], recommendCorroboration: false },
    { id: "feature_gap", claimType: "text", description: "A missing or requested feature relative to an alternative, grounded in a quote.", groundingEvidenceKinds: ["page_text", "page_html"], recommendCorroboration: false },
    { id: "adoption_figure", claimType: "metadata", description: "An adoption, usage, or demand figure.", groundingEvidenceKinds: ["structured_data", "page_text"], recommendCorroboration: true }
  ],
  reportSections: ["Summary", "User pains", "Feature gaps", "Opportunities", "Sources"]
};

const LENSES: Record<string, Lens> = {
  [RESEARCH.id]: RESEARCH,
  [MARKET_SCAN.id]: MARKET_SCAN,
  [PRODUCT_PLANNING.id]: PRODUCT_PLANNING
};

export const DEFAULT_LENS_ID = RESEARCH.id;

export function listLenses(): Lens[] {
  return Object.values(LENSES);
}

export function getLens(id: string): Lens | undefined {
  return LENSES[id];
}

/** Compact lens summaries for discovery (e.g. in farm_capabilities) without the full template/source detail. */
export function lensSummaries(): Array<{ id: string; displayName: string; description: string }> {
  return listLenses().map((lens) => ({ id: lens.id, displayName: lens.displayName, description: lens.description }));
}

/** The source-registry entries a lens prioritizes, deduped by platform, optionally narrowed to a locale. */
export function selectLensSources(lens: Lens, locale?: LocaleSegment): SourceRegistryEntry[] {
  const byPlatform = new Map<string, SourceRegistryEntry>();
  for (const category of lens.sourceCategories) {
    const filter = locale === undefined ? { category } : { category, locale };
    for (const entry of listSourceRegistryEntries(filter)) {
      if (!byPlatform.has(entry.platform)) {
        byPlatform.set(entry.platform, entry);
      }
    }
  }
  return [...byPlatform.values()];
}

export interface LensDescription {
  lens: Lens;
  sources: Array<{ platform: string; displayName: string; supportTier: number; categories: InformationCategory[] }>;
}

/** Full lens descriptor: the lens + its selected sources. undefined for an unknown lens id. */
export function describeLens(id: string, locale?: LocaleSegment): LensDescription | undefined {
  const lens = getLens(id);
  if (lens === undefined) {
    return undefined;
  }
  const sources = selectLensSources(lens, locale).map((entry) => ({ platform: entry.platform, displayName: entry.displayName, supportTier: entry.supportTier, categories: entry.informationCategories }));
  return { lens, sources };
}
