import type { EvidenceShape, IntentProfileReport } from "./intent-profile.js";
import type { SearchResultCandidate, SearchResultCandidatesReport } from "./search-result-candidates.js";

export type CandidateDeepeningPriority = "must_open" | "open" | "defer" | "skip";
export type CandidateDeepeningNextAction = "open_destination_capture" | "manual_profile_or_byo" | "skip_duplicate" | "no_candidate";
export type CandidateDeepeningRisk = "low" | "medium" | "high";

export interface CandidateDeepeningDecision {
  candidateRank: number;
  title: string;
  url?: string;
  source?: string;
  selected: boolean;
  priority: CandidateDeepeningPriority;
  nextAction: CandidateDeepeningNextAction;
  score: number;
  risk: CandidateDeepeningRisk;
  reasons: string[];
  warnings: string[];
  recommendedEvidenceShapes: EvidenceShape[];
}

export interface CandidateDeepeningLedger {
  schemaVersion: "1.0";
  sourceUrl: string;
  status: "ok" | "empty" | "not_search_surface";
  selectedCount: number;
  budget: {
    maxSelected: number;
    candidateCount: number;
  };
  decisions: CandidateDeepeningDecision[];
  caveats: string[];
}

export interface PlanCandidateDeepeningLedgerInput {
  sourceUrl: string;
  intentProfile: IntentProfileReport;
  searchResultCandidates: SearchResultCandidatesReport;
  maxSelected?: number | undefined;
}

export function planCandidateDeepeningLedger(input: PlanCandidateDeepeningLedgerInput): CandidateDeepeningLedger {
  const maxSelected = Math.max(0, Math.min(20, Math.trunc(input.maxSelected ?? 3)));
  const candidateCount = input.searchResultCandidates.candidates.length;
  const budget = { maxSelected, candidateCount };

  if (input.searchResultCandidates.status === "not_search_surface") {
    return {
      schemaVersion: "1.0",
      sourceUrl: input.sourceUrl,
      status: "not_search_surface",
      selectedCount: 0,
      budget,
      decisions: [],
      caveats: ["The current page was not classified as a search surface, so there is no candidate deepening queue."]
    };
  }

  if (candidateCount === 0) {
    return {
      schemaVersion: "1.0",
      sourceUrl: input.sourceUrl,
      status: "empty",
      selectedCount: 0,
      budget,
      decisions: [],
      caveats: ["No candidates were extracted from this search surface; revise the query or capture mode before deepening."]
    };
  }

  const scored = input.searchResultCandidates.candidates.map((candidate, index) => scoreCandidate(candidate, index, input.intentProfile));
  const selectedKeys = new Set(
    [...scored]
      .sort((left, right) => right.score - left.score || left.candidate.rank - right.candidate.rank)
      .slice(0, maxSelected)
      .filter((item) => item.score > 0 && item.candidate.url !== undefined)
      .map((item) => item.key)
  );

  const decisions = scored.map((item): CandidateDeepeningDecision => {
    const selected = selectedKeys.has(item.key);
    const priority = selected ? (item.score >= 12 ? "must_open" : "open") : item.score <= 0 || item.candidate.url === undefined ? "skip" : "defer";
    const nextAction = chooseNextAction({ selected, priority, warnings: item.warnings, url: item.candidate.url });
    return {
      candidateRank: item.candidate.rank,
      title: item.candidate.title,
      ...(item.candidate.url === undefined ? {} : { url: item.candidate.url }),
      ...(item.candidate.source === undefined ? {} : { source: item.candidate.source }),
      selected,
      priority,
      nextAction,
      score: item.score,
      risk: item.risk,
      reasons: item.reasons,
      warnings: item.warnings,
      recommendedEvidenceShapes: recommendedEvidenceShapes(input.intentProfile)
    };
  });

  return {
    schemaVersion: "1.0",
    sourceUrl: input.sourceUrl,
    status: "ok",
    selectedCount: decisions.filter((decision) => decision.selected).length,
    budget,
    decisions,
    caveats: ["Candidate deepening is a deterministic queue, not proof of destination content.", "Open selected destinations as separate evidence runs before making claims about the destination page.", "Membership/login/CAPTCHA walls are obstruction evidence; do not bypass them autonomously."]
  };
}

function scoreCandidate(candidate: SearchResultCandidate, sourceIndex: number, intentProfile: IntentProfileReport): { key: string; candidate: SearchResultCandidate; score: number; risk: CandidateDeepeningRisk; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const titleIntent = `${candidate.title}\n${intentProfile.intent.decisionNeeded}\n${intentProfile.intent.successCriteria}`;
  let score = 0;

  if (candidate.matchedTerms.length > 0) {
    score += candidate.matchedTerms.length * 3;
    reasons.push("query_terms_present");
  }
  if (candidate.signals.includes("review_intent") || /내돈내산|리뷰|후기|review|visited|방문/i.test(titleIntent)) {
    score += 4;
    reasons.push("review_intent_match");
  }
  if (candidate.signals.includes("detail_intent") || /가격|주차|시설|사진|이미지|price|parking|menu|photo/i.test(titleIntent)) {
    score += 3;
    reasons.push("detail_terms_present");
  }
  if (candidate.thumbnailEvidence === "page_screenshot_present" && needsVisualEvidence(intentProfile)) {
    score += 3;
    reasons.push("visual_or_ocr_evidence_available");
  }
  if (candidate.signals.includes("naver_blog_source") || /blog\.naver\.com|m\.blog\.naver\.com|post\.naver\.com/i.test(candidate.url ?? "")) {
    score += 2;
    reasons.push("public_blog_candidate");
  }
  if (candidate.url !== undefined) {
    score += 1;
    reasons.push("destination_url_available");
  }
  if (sourceIndex === 0) {
    score += 1;
    reasons.push("top_visible_candidate");
  }

  let risk: CandidateDeepeningRisk = "low";
  if (isLikelyMembershipWallCandidate(candidate)) {
    risk = "medium";
    warnings.push("possible_login_or_membership_wall");
    score -= 1;
  }
  if (/event|이벤트|ad|광고|sponsored|협찬/i.test(candidate.title)) {
    warnings.push("possible_promotional_candidate");
    score -= 2;
  }
  if (candidate.url === undefined) {
    warnings.push("missing_destination_url");
    score -= 4;
  }

  return {
    key: `${candidate.rank}:${candidate.url ?? candidate.title}`,
    candidate,
    score: Math.max(0, score),
    risk,
    reasons: Array.from(new Set(reasons)),
    warnings: Array.from(new Set(warnings))
  };
}

function isLikelyMembershipWallCandidate(candidate: SearchResultCandidate): boolean {
  const urlAndSource = `${candidate.url ?? ""}\n${candidate.source ?? ""}`;
  return /cafe\.naver\.com|member|login/i.test(urlAndSource) || /네이버\s*카페/i.test(candidate.title);
}

function chooseNextAction(input: { selected: boolean; priority: CandidateDeepeningPriority; warnings: readonly string[]; url: string | undefined }): CandidateDeepeningNextAction {
  if (input.url === undefined || input.priority === "skip") {
    return "no_candidate";
  }
  if (!input.selected) {
    return "open_destination_capture";
  }
  if (input.warnings.includes("possible_login_or_membership_wall") && /login|member/i.test(input.url)) {
    return "manual_profile_or_byo";
  }
  return "open_destination_capture";
}

function needsVisualEvidence(profile: IntentProfileReport): boolean {
  return profile.inferredShapes.some((shape) => shape === "ui_screenshot" || shape === "ocr_image_text" || shape === "map_place_state" || shape === "video_frames");
}

function recommendedEvidenceShapes(profile: IntentProfileReport): EvidenceShape[] {
  const preferred: EvidenceShape[] = [];
  for (const shape of ["page_text", "page_html", "semi_structured_dom", "ui_screenshot", "ocr_image_text", "structured_data", "video_frames", "captions_transcript"] as const) {
    if (profile.inferredShapes.includes(shape)) {
      preferred.push(shape);
    }
  }
  return preferred.length > 0 ? preferred : ["page_text", "page_html"];
}
