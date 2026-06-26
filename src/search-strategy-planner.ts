import type { EvidenceShape } from "./intent-profile.js";
import type { IntentProfileReport } from "./intent-profile.js";
import type { SourceFamily, SourcePlatform, SourceStrategy } from "./source-strategy.js";

export type SearchStrategyArmPurpose = "current" | "broad" | "focused" | "visual" | "video" | "community" | "official" | "dissent";
export type SearchStrategyArmStatus = "try" | "defer" | "terminal";
export type SearchStrategyArmRisk = "low" | "medium" | "high";

export interface SearchStrategyArm {
  armId: string;
  rank: number;
  platform: SourcePlatform;
  purpose: SearchStrategyArmPurpose;
  status: SearchStrategyArmStatus;
  risk: SearchStrategyArmRisk;
  query: string;
  url?: string;
  evidenceShapes: EvidenceShape[];
  rationale: string;
  successMetric: string;
  failureMode: string;
}

export interface SearchStrategyPlan {
  schemaVersion: "1.0";
  sourceUrl: string;
  sourcePlatform: SourcePlatform;
  sourceFamily: SourceFamily;
  intentStatus: IntentProfileReport["status"];
  status: "ok" | "underspecified";
  baseQuery: string;
  arms: SearchStrategyArm[];
  antiHarnessGuard: string;
  caveats: string[];
  questions: string[];
}

export interface PlanSearchStrategyInput {
  sourceUrl: string;
  sourceStrategy: SourceStrategy;
  intentProfile: IntentProfileReport;
  trendTerms?: string[] | undefined;
  maxArms?: number | undefined;
}

const QUERY_PARAM_NAMES = ["query", "q", "keyword", "search_query", "p", "where"] as const;

export function planSearchStrategy(input: PlanSearchStrategyInput): SearchStrategyPlan {
  const trendTerms = normalizeTerms(input.trendTerms ?? []);
  const baseQuery = inferBaseQuery(input.sourceUrl, input.intentProfile, trendTerms);
  const armBuilder = new SearchArmBuilder(baseQuery);
  const shapes = input.intentProfile.inferredShapes;
  const decisionNeeded = input.intentProfile.intent.decisionNeeded ?? "";
  const targetScope = input.intentProfile.intent.targetScope ?? "";
  const successCriteria = input.intentProfile.intent.successCriteria ?? "";
  const visualIntent = shapes.includes("ui_screenshot") || shapes.includes("ocr_image_text") || shapes.includes("map_place_state");
  const videoIntent = shapes.includes("video_frames") || shapes.includes("captions_transcript") || shapes.includes("stt_asr") || shapes.includes("audio_events") || shapes.includes("tts_detection");
  const koreanIntent = containsHangul(baseQuery) || /ko-|korea|naver|네이버|한국/i.test(targetScope);
  const reviewIntent = /review|후기|리뷰|내돈내산|user pain|불만|단점|비평|평가/i.test(`${baseQuery} ${decisionNeeded} ${successCriteria}`);
  const structuredIntent = shapes.includes("structured_data") || /official|공식|가격|price|api|metadata|source verification|검증/i.test(decisionNeeded);

  armBuilder.add({
    armId: "current_surface",
    platform: input.sourceStrategy.platform,
    purpose: "current",
    status: "try",
    risk: "low",
    query: baseQuery,
    url: input.sourceUrl,
    evidenceShapes: shapes,
    rationale: "Preserve the current query/result surface before widening or changing platforms.",
    successMetric: "Captured query state, visible ranking/snippets, and obstruction state are registered.",
    failureMode: "Current surface is personalized, blocked, empty, or not the source universe the decision needs."
  });

  if (koreanIntent) {
    armBuilder.add({
      armId: "naver_view_review",
      platform: "naver_search",
      purpose: reviewIntent ? "focused" : "broad",
      status: "try",
      risk: "low",
      query: enrichQuery(baseQuery, reviewIntent ? ["내돈내산", "리뷰", "후기"] : ["리뷰"]),
      url: naverSearchUrl("view", enrichQuery(baseQuery, reviewIntent ? ["내돈내산", "리뷰", "후기"] : ["리뷰"])),
      evidenceShapes: ["page_text", "semi_structured_dom"],
      rationale: "Naver VIEW is a public Korean review/discussion surface; treat it as a search-result arm, not destination proof.",
      successMetric: "Find public blog/post candidates with matching review and detail terms.",
      failureMode: "VIEW ranking is personalized or candidate destinations later require login/member access."
    });
    if (visualIntent) {
      armBuilder.add({
        armId: "naver_image_visual",
        platform: "naver_search",
        purpose: "visual",
        status: "try",
        risk: "low",
        query: enrichQuery(baseQuery, ["사진", "이미지"]),
        url: naverSearchUrl("image", enrichQuery(baseQuery, ["사진", "이미지"])),
        evidenceShapes: ["ui_screenshot", "ocr_image_text", "semi_structured_dom"],
        rationale: "Visual intent needs image/card evidence and OCR-ready screenshots before claiming design, photo, price badge, or UI details.",
        successMetric: "Visible image/card candidates expose photo-rich destinations and OCR text cues.",
        failureMode: "Image results may show thumbnails only; destination evidence must be captured in a separate run."
      });
    }
  }

  armBuilder.add({
    armId: "google_cross_check",
    platform: "google_search",
    purpose: "broad",
    status: "try",
    risk: "low",
    query: baseQuery,
    url: googleSearchUrl(baseQuery),
    evidenceShapes: ["page_text", "semi_structured_dom"],
    rationale: "A second public search engine reduces single-portal ranking and personalization dependence.",
    successMetric: "Independent result candidates overlap or expose missing/refuting destinations.",
    failureMode: "Search result snippets still do not prove destination content."
  });

  if (structuredIntent) {
    armBuilder.add({
      armId: "official_source_probe",
      platform: input.sourceStrategy.platform === "google_search" ? "google_search" : "naver_search",
      purpose: "official",
      status: "try",
      risk: "low",
      query: enrichQuery(baseQuery, koreanIntent ? ["공식"] : ["official"]),
      url: koreanIntent ? naverSearchUrl("web", enrichQuery(baseQuery, ["공식"])) : googleSearchUrl(enrichQuery(baseQuery, ["official"])),
      evidenceShapes: ["page_text", "structured_data"],
      rationale: "Structured or source-verification decisions need an official-source arm before relying on reviews or snippets.",
      successMetric: "Official page/API/metadata candidate is identified or absence is recorded.",
      failureMode: "Official source may not expose the needed field publicly."
    });
  }

  if (reviewIntent) {
    armBuilder.add({
      armId: koreanIntent ? "korean_community_review" : "community_review",
      platform: koreanIntent ? "naver_cafe" : "reddit",
      purpose: "community",
      status: koreanIntent ? "defer" : "try",
      risk: koreanIntent ? "medium" : "low",
      query: enrichQuery(baseQuery, koreanIntent ? ["후기", "불만"] : ["review", "reddit", "complaint"]),
      url: koreanIntent ? naverSearchUrl("cafe", enrichQuery(baseQuery, ["후기", "불만"])) : googleSearchUrl(enrichQuery(baseQuery, ["reddit", "review", "complaint"])),
      evidenceShapes: ["page_text", "semi_structured_dom"],
      rationale: "Community surfaces are useful for pain/dissent discovery but often have membership or personalization walls.",
      successMetric: "Public, non-login community snippets or destination URLs are found.",
      failureMode: "Candidate destinations require login/membership; record obstruction and stop."
    });
  }

  if (videoIntent) {
    armBuilder.add({
      armId: "youtube_video",
      platform: "youtube",
      purpose: "video",
      status: "try",
      risk: "low",
      query: baseQuery,
      url: youtubeSearchUrl(baseQuery),
      evidenceShapes: ["page_text", "semi_structured_dom", "video_frames", "captions_transcript"],
      rationale: "Video intent needs a lawful video search arm, captions when served, and timestamped frames for visual claims.",
      successMetric: "Video candidates expose public captions/metadata or frame-capture targets.",
      failureMode: "No served captions; spoken claims require leesearch-video-heavy/BYO transcript registration."
    });
    armBuilder.add({
      armId: "tiktok_public_lead",
      platform: "tiktok",
      purpose: "video",
      status: "defer",
      risk: "medium",
      query: baseQuery,
      url: googleSearchUrl(enrichQuery(baseQuery, ["site:tiktok.com"])),
      evidenceShapes: ["page_text", "video_frames"],
      rationale: "TikTok is a volatile public lead source; use it as a lead arm, not a guaranteed autonomous capture surface.",
      successMetric: "Public TikTok URLs or snippets identify follow-up targets.",
      failureMode: "Login/app/interstitial blocks unattended capture; record obstruction."
    });
    armBuilder.add({
      armId: "x_threads_public_lead",
      platform: "x_twitter",
      purpose: "community",
      status: "defer",
      risk: "medium",
      query: baseQuery,
      url: googleSearchUrl(enrichQuery(baseQuery, ["site:x.com OR site:threads.net"])),
      evidenceShapes: ["page_text", "semi_structured_dom"],
      rationale: "X/Threads can surface trend and dissent leads, but public visibility is unstable and login-sensitive.",
      successMetric: "Public posts or snippets reveal lead terms to verify elsewhere.",
      failureMode: "Login wall or incomplete public render; stop at obstruction or use consented BYO only."
    });
  }

  armBuilder.add({
    armId: "dissent_probe",
    platform: koreanIntent ? "naver_search" : "google_search",
    purpose: "dissent",
    status: "try",
    risk: "low",
    query: enrichQuery(baseQuery, koreanIntent ? ["단점", "문제", "불만", "비싸"] : ["problem", "complaint", "downside", "expensive"]),
    url: koreanIntent ? naverSearchUrl("view", enrichQuery(baseQuery, ["단점", "문제", "불만", "비싸"])) : googleSearchUrl(enrichQuery(baseQuery, ["problem", "complaint", "downside", "expensive"])),
    evidenceShapes: ["page_text", "semi_structured_dom"],
    rationale: "A dissent arm prevents trend/review searches from only confirming positive or promotional surfaces.",
    successMetric: "Refuting, negative, or cost/friction candidates are found and separated from promotional candidates.",
    failureMode: "Negative snippets are absent or not independently verifiable."
  });

  const maxArms = Math.max(1, Math.min(20, Math.trunc(input.maxArms ?? 10)));
  const arms = armBuilder
    .build()
    .slice(0, maxArms)
    .map((arm, index) => ({ ...arm, rank: index + 1 }));
  return {
    schemaVersion: "1.0",
    sourceUrl: input.sourceUrl,
    sourcePlatform: input.sourceStrategy.platform,
    sourceFamily: input.sourceStrategy.sourceFamily,
    intentStatus: input.intentProfile.status,
    status: baseQuery.length === 0 ? "underspecified" : "ok",
    baseQuery,
    arms,
    antiHarnessGuard: "Search arms are hypotheses, not a maintained scraping harness; score outcomes and revise arms from evidence rather than hard-coding platform selectors.",
    caveats: ["Search arms do not prove coverage", "Search-result snippets are portal-visible evidence only; destination claims need separate captures.", "Login, paywall, CAPTCHA, age-gate, and raw-media protections remain terminal unless the operator supplies consented profile/BYO evidence."],
    questions: input.intentProfile.questions.filter((question) => /decision|scope|evidence|success/i.test(question))
  };
}

class SearchArmBuilder {
  private readonly arms: Array<Omit<SearchStrategyArm, "rank">> = [];
  private readonly seen = new Set<string>();

  constructor(private readonly baseQuery: string) {}

  add(arm: Omit<SearchStrategyArm, "rank">): void {
    const key = `${arm.armId}\n${arm.platform}\n${arm.query}`;
    if (this.seen.has(key)) {
      return;
    }
    this.seen.add(key);
    this.arms.push({ ...arm, query: arm.query.length === 0 ? this.baseQuery : arm.query });
  }

  build(): Array<Omit<SearchStrategyArm, "rank">> {
    return this.arms;
  }
}

function inferBaseQuery(sourceUrl: string, intentProfile: IntentProfileReport, trendTerms: readonly string[]): string {
  const fromUrl = searchQueryFromUrl(sourceUrl);
  if (fromUrl !== undefined && fromUrl.length > 0) {
    return normalizeWhitespace(fromUrl);
  }
  if (trendTerms.length > 0) {
    return normalizeWhitespace(trendTerms.slice(0, 6).join(" "));
  }
  const target = stripProvisionalPrefix(intentProfile.intent.targetScope ?? "");
  if (target.length > 0 && !/^target url only/i.test(target)) {
    return normalizeWhitespace(target);
  }
  const decision = stripProvisionalPrefix(intentProfile.intent.decisionNeeded ?? "");
  return normalizeWhitespace(decision);
}

function searchQueryFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    for (const name of QUERY_PARAM_NAMES) {
      const value = parsed.searchParams.get(name)?.trim();
      if (value !== undefined && value.length > 0 && name !== "where") {
        return value.replace(/\+/g, " ");
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeTerms(terms: readonly string[]): string[] {
  return Array.from(new Set(terms.map((term) => normalizeWhitespace(term)).filter((term) => term.length > 0)));
}

function stripProvisionalPrefix(value: string): string {
  return value.replace(/^provisional:\s*/i, "").trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function enrichQuery(baseQuery: string, additions: readonly string[]): string {
  const terms = new Set(normalizeTerms([...baseQuery.split(/\s+/), ...additions]));
  return Array.from(terms).join(" ");
}

function containsHangul(value: string): boolean {
  return /[가-힣]/.test(value);
}

function naverSearchUrl(where: "view" | "image" | "cafe" | "web", query: string): string {
  const params = new URLSearchParams({ query });
  if (where !== "web") {
    params.set("where", where);
  }
  return `https://search.naver.com/search.naver?${params.toString()}`;
}

function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?${new URLSearchParams({ q: query }).toString()}`;
}

function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?${new URLSearchParams({ search_query: query }).toString()}`;
}
