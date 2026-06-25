import type { DestinationVisibleLink } from "./destination-triage.js";
import type { SourcePlatform } from "./source-strategy.js";

export type SearchResultCandidateThumbnailEvidence = "page_screenshot_present" | "not_captured";

export interface SearchResultCandidate {
  rank: number;
  title: string;
  url?: string | undefined;
  source?: string | undefined;
  matchedTerms: string[];
  thumbnailEvidence: SearchResultCandidateThumbnailEvidence;
  signals: string[];
}

export interface SearchResultCandidatesReport {
  schemaVersion: "1.0";
  sourceUrl: string;
  platform: SourcePlatform;
  status: "ok" | "empty" | "not_search_surface";
  query?: string | undefined;
  candidates: SearchResultCandidate[];
  evidenceInputs: {
    textChars: number;
    visibleLinkCount: number;
    pageScreenshotCount: number;
  };
  caveats: string[];
}

export interface SearchResultCandidatesInput {
  sourceUrl: string;
  platform: SourcePlatform;
  text?: string | undefined;
  visibleLinks?: DestinationVisibleLink[] | undefined;
  pageScreenshotCount?: number | undefined;
  maxCandidates?: number | undefined;
}

const QUERY_PARAM_NAMES = ["query", "q", "keyword", "search_query"] as const;
const NAVIGATION_LABELS = new Set(["검색", "이미지", "view", "블로그", "카페", "뉴스", "동영상", "지도", "쇼핑", "더보기", "옵션", "선택됨"]);

export function extractSearchResultCandidates(input: SearchResultCandidatesInput): SearchResultCandidatesReport {
  const query = searchQueryFromUrl(input.sourceUrl);
  const text = input.text ?? "";
  const pageScreenshotCount = Math.max(0, Math.trunc(input.pageScreenshotCount ?? 0));
  const visibleLinks = input.visibleLinks ?? [];
  const terms = searchTerms(query ?? text);
  const maxCandidates = Math.max(1, Math.min(50, Math.trunc(input.maxCandidates ?? 12)));
  const linkCandidates = candidatesFromVisibleLinks({
    links: visibleLinks,
    terms,
    pageScreenshotCount
  });
  const textCandidates =
    linkCandidates.length > 0
      ? []
      : candidatesFromTextLines({
          text,
          terms,
          pageScreenshotCount
        });
  const candidates = rankCandidates([...linkCandidates, ...textCandidates])
    .slice(0, maxCandidates)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const status = candidates.length > 0 ? "ok" : isLikelySearchSurface(input.sourceUrl, text, query) ? "empty" : "not_search_surface";

  return {
    schemaVersion: "1.0",
    sourceUrl: input.sourceUrl,
    platform: input.platform,
    status,
    ...(query === undefined ? {} : { query }),
    candidates,
    evidenceInputs: {
      textChars: text.length,
      visibleLinkCount: visibleLinks.length,
      pageScreenshotCount
    },
    caveats: ["Search-result candidates are deterministic derivatives of captured page text/link metadata; cite the original page_text/page_screenshot for load-bearing claims."]
  };
}

function candidatesFromVisibleLinks(input: { links: DestinationVisibleLink[]; terms: string[]; pageScreenshotCount: number }): Array<Omit<SearchResultCandidate, "rank"> & { score: number; sourceIndex: number }> {
  const candidates: Array<Omit<SearchResultCandidate, "rank"> & { score: number; sourceIndex: number }> = [];
  const seen = new Set<string>();
  for (const link of input.links) {
    const title = normalizeTitle(link.text);
    if (!isCandidateTitle(title)) {
      continue;
    }
    const matchedTerms = matchedSearchTerms(title, input.terms);
    const signals = candidateSignals(title, link.url, matchedTerms);
    if (matchedTerms.length === 0 && signals.length === 0) {
      continue;
    }
    const key = `${link.url}\n${title}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push({
      title,
      url: link.url,
      source: sourceHostname(link.url),
      matchedTerms,
      thumbnailEvidence: thumbnailEvidence(input.pageScreenshotCount),
      signals,
      score: scoreCandidate(matchedTerms, signals, link.url),
      sourceIndex: link.index
    });
  }
  return candidates;
}

function candidatesFromTextLines(input: { text: string; terms: string[]; pageScreenshotCount: number }): Array<Omit<SearchResultCandidate, "rank"> & { score: number; sourceIndex: number }> {
  const lines = input.text.split(/\r?\n/).map(normalizeTitle).filter(isCandidateTitle);
  const candidates: Array<Omit<SearchResultCandidate, "rank"> & { score: number; sourceIndex: number }> = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const matchedTerms = matchedSearchTerms(line, input.terms);
    const signals = candidateSignals(line, undefined, matchedTerms);
    if (matchedTerms.length === 0 && signals.length === 0) {
      continue;
    }
    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    candidates.push({
      title: line,
      matchedTerms,
      thumbnailEvidence: thumbnailEvidence(input.pageScreenshotCount),
      signals,
      score: scoreCandidate(matchedTerms, signals, undefined),
      sourceIndex: index
    });
  }
  return candidates;
}

function rankCandidates<T extends { score: number; sourceIndex: number }>(candidates: T[]): T[] {
  return [...candidates].sort((left, right) => left.sourceIndex - right.sourceIndex || right.score - left.score);
}

function searchQueryFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    for (const name of QUERY_PARAM_NAMES) {
      const value = parsed.searchParams.get(name)?.trim();
      if (value !== undefined && value.length > 0) {
        return value.replace(/\+/g, " ");
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function searchTerms(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,|/]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2 && !NAVIGATION_LABELS.has(term.toLowerCase()))
    )
  );
}

function matchedSearchTerms(title: string, terms: readonly string[]): string[] {
  const lowerTitle = title.toLowerCase();
  return terms.filter((term) => lowerTitle.includes(term.toLowerCase()));
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isCandidateTitle(title: string): boolean {
  if (title.length < 5 || title.length > 180) {
    return false;
  }
  if (NAVIGATION_LABELS.has(title.toLowerCase())) {
    return false;
  }
  return !/^(전체|검색옵션|관련도순|최신순|도구|메뉴|본문 바로가기)$/i.test(title);
}

function candidateSignals(title: string, url: string | undefined, matchedTerms: readonly string[]): string[] {
  const signals: string[] = [];
  if (matchedTerms.length > 0) {
    signals.push("query_term_match");
  }
  if (/내돈내산|리뷰|후기|솔직|방문/i.test(title)) {
    signals.push("review_intent");
  }
  if (/사진|이미지|가격|주차|음식|놀이시설|할인/.test(title)) {
    signals.push("detail_intent");
  }
  if (url !== undefined && /blog\.naver\.com|m\.blog\.naver\.com|post\.naver\.com/i.test(url)) {
    signals.push("naver_blog_source");
  }
  return Array.from(new Set(signals));
}

function scoreCandidate(matchedTerms: readonly string[], signals: readonly string[], url: string | undefined): number {
  const sourceBonus = url !== undefined && /blog\.naver\.com|m\.blog\.naver\.com|post\.naver\.com/i.test(url) ? 2 : 0;
  return matchedTerms.length * 4 + signals.length * 2 + sourceBonus;
}

function sourceHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function thumbnailEvidence(pageScreenshotCount: number): SearchResultCandidateThumbnailEvidence {
  return pageScreenshotCount > 0 ? "page_screenshot_present" : "not_captured";
}

function isLikelySearchSurface(url: string, text: string, query: string | undefined): boolean {
  if (query !== undefined) {
    return true;
  }
  return /검색 결과|검색옵션|관련도순|최신순|통합검색|search/i.test(`${url}\n${text}`);
}
