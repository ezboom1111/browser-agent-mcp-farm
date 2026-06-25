import type { SourceFamily, SourcePlatform } from "./source-strategy.js";

export type TrendSignalKind = "topic" | "recency" | "engagement" | "local" | "commerce" | "finance" | "search_surface";

export interface TrendTerm {
  term: string;
  count: number;
  score: number;
}

export interface TrendSignal {
  kind: TrendSignalKind;
  label: string;
  count: number;
}

export interface TrendAnalysisReport {
  schemaVersion: "1.0";
  sourceUrl: string;
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  status: "ok" | "empty";
  textProfile: {
    charCount: number;
    tokenCount: number;
    uniqueTermCount: number;
  };
  surface: {
    searchResult: boolean;
    articleBody: boolean;
    financeSurface: boolean;
  };
  topTerms: TrendTerm[];
  signals: TrendSignal[];
  summary: string;
  caveats: string[];
}

export interface TrendAnalysisInput {
  sourceUrl: string;
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  text?: string | undefined;
  title?: string | undefined;
}

const STOPWORDS = new Set([
  "naver",
  "keep",
  "keep에",
  "저장",
  "네이버",
  "검색",
  "블로그",
  "메뉴",
  "본문",
  "바로가기",
  "공유하기",
  "이웃추가",
  "목록열기",
  "옵션",
  "선택됨",
  "닫기",
  "이전",
  "다음",
  "입니다",
  "합니다",
  "있습니다",
  "이미지입니다",
  "존재하지",
  "않는",
  "그리고",
  "이번",
  "직접",
  "정보",
  "후기까지",
  "기록하는",
  "기록하",
  "맛으로",
  "있는",
  "하루",
  "보내기"
]);

const DOMAIN_SIGNALS: Record<Exclude<TrendSignalKind, "topic" | "recency" | "search_surface">, string[]> = {
  engagement: ["댓글", "공감", "리뷰", "후기", "평점", "공유"],
  local: ["위치", "주소", "지도", "주차", "도보", "운영시간", "라스트오더", "맛집"],
  commerce: ["가격", "요금", "할인", "구매", "배송", "디저트", "메뉴", "예약"],
  finance: ["주가", "시세", "종목", "거래량", "코스피", "코스닥", "상승", "하락", "전일", "고가", "저가"]
};

const DATE_RE = /\b20\d{2}\s*[.\-/년]\s*\d{1,2}\s*(?:[.\-/월]\s*\d{1,2})?/g;
const TOKEN_RE = /[가-힣A-Za-z][가-힣A-Za-z0-9+._-]{1,}/g;
const FINANCE_CORE_RE = /Npay 증권|국내증시|주가|시세|종목|거래량|코스피|코스닥/;

export function analyzeTrendSignals(input: TrendAnalysisInput): TrendAnalysisReport {
  const text = normalizeText([input.title, input.text].filter((value): value is string => typeof value === "string" && value.length > 0).join(" "));
  if (text.length === 0) {
    return {
      schemaVersion: "1.0",
      sourceUrl: input.sourceUrl,
      platform: input.platform,
      sourceFamily: input.sourceFamily,
      status: "empty",
      textProfile: { charCount: 0, tokenCount: 0, uniqueTermCount: 0 },
      surface: { searchResult: false, articleBody: false, financeSurface: false },
      topTerms: [],
      signals: [],
      summary: "No readable text was available for deterministic trend-signal extraction.",
      caveats: ["No readable page text was available; trend signals were not inferred."]
    };
  }

  const tokens = tokenize(text);
  const topTerms = rankTerms(tokens).slice(0, 12);
  const hasFinanceCore = FINANCE_CORE_RE.test(text) || /finance\.naver\.com/i.test(input.sourceUrl);
  const signals = dedupeSignals([...topTerms.slice(0, 8).map((term): TrendSignal => ({ kind: "topic", label: term.term, count: term.count })), ...recencySignals(text), ...surfaceSignals(text), ...domainSignals(text, hasFinanceCore)]);
  const financeSignalCount = signals.filter((signal) => signal.kind === "finance").reduce((sum, signal) => sum + signal.count, 0);
  const searchResult = /검색 결과|검색옵션|관련도순|최신순|통합검색/.test(text);
  const surface = {
    searchResult,
    articleBody: !searchResult && /본문|댓글|공감|이웃추가|목록열기|작성자|블로그 카테고리/.test(text),
    financeSurface: hasFinanceCore || financeSignalCount >= 2
  };

  return {
    schemaVersion: "1.0",
    sourceUrl: input.sourceUrl,
    platform: input.platform,
    sourceFamily: input.sourceFamily,
    status: "ok",
    textProfile: {
      charCount: text.length,
      tokenCount: tokens.length,
      uniqueTermCount: new Set(tokens).size
    },
    surface,
    topTerms,
    signals,
    summary: summarizeTrend(surface, topTerms, signals),
    caveats: ["Trend analysis is a deterministic signal summary from captured text, not a prediction or popularity measurement by itself."]
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return Array.from(text.matchAll(TOKEN_RE), (match) => match[0] ?? "")
    .map((token) => token.toLowerCase())
    .map((token) => token.replace(/^[._-]+|[._-]+$/g, ""))
    .map(normalizeKoreanParticle)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function normalizeKoreanParticle(token: string): string {
  if (!/^[가-힣]+$/.test(token) || token.length < 4) {
    return token;
  }
  return token.replace(/(?:에서는|으로는|에게는|에는|에서|으로|에게|부터|까지|처럼|보다|은|는|이|가|을|를|와|과)$/u, "");
}

function rankTerms(tokens: readonly string[]): TrendTerm[] {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([term, count]) => ({ term, count, score: count * Math.log2(2 + term.length) }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term, "ko"));
}

function recencySignals(text: string): TrendSignal[] {
  const signals: TrendSignal[] = [];
  const dates = Array.from(text.matchAll(DATE_RE), (match) => normalizeDateLabel(match[0] ?? "")).filter((value) => value.length > 0);
  for (const date of new Set(dates).values()) {
    signals.push({ kind: "recency", label: date, count: dates.filter((value) => value === date).length });
  }
  for (const label of ["오늘", "어제", "최신", "실시간", "인기", "급상승"]) {
    const count = countOccurrences(text, label);
    if (count > 0) {
      signals.push({ kind: "recency", label, count });
    }
  }
  return signals;
}

function surfaceSignals(text: string): TrendSignal[] {
  const signals: TrendSignal[] = [];
  if (/검색 결과|검색옵션|관련도순|최신순|통합검색/.test(text)) {
    signals.push({ kind: "search_surface", label: "검색 결과", count: 1 });
  }
  return signals;
}

function domainSignals(text: string, hasFinanceCore: boolean): TrendSignal[] {
  const signals: TrendSignal[] = [];
  for (const [kind, labels] of Object.entries(DOMAIN_SIGNALS) as Array<[Exclude<TrendSignalKind, "topic" | "recency" | "search_surface">, string[]]>) {
    const kindSignals: TrendSignal[] = [];
    for (const label of labels) {
      const count = countOccurrences(text, label);
      if (count > 0) {
        kindSignals.push({ kind, label, count });
      }
    }
    if (kind === "finance" && !hasFinanceCore) {
      continue;
    }
    if (kind === "finance" && kindSignals.reduce((sum, signal) => sum + signal.count, 0) < 2) {
      continue;
    }
    signals.push(...kindSignals);
  }
  return signals;
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(needle, offset);
    if (index < 0) {
      return count;
    }
    count += 1;
    offset = index + needle.length;
  }
}

function dedupeSignals(signals: readonly TrendSignal[]): TrendSignal[] {
  const merged = new Map<string, TrendSignal>();
  for (const signal of signals) {
    const key = `${signal.kind}:${signal.label}`;
    const existing = merged.get(key);
    merged.set(key, existing === undefined ? { ...signal } : { ...existing, count: existing.count + signal.count });
  }
  return Array.from(merged.values()).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label, "ko"));
}

function normalizeDateLabel(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[년월]/g, ".")
    .replace(/\s*\.\s*/g, ". ")
    .replace(/\s+$/g, "")
    .replace(/\.$/, "");
}

function summarizeTrend(surface: TrendAnalysisReport["surface"], topTerms: readonly TrendTerm[], signals: readonly TrendSignal[]): string {
  const surfaceLabel = surface.searchResult ? "search_result" : surface.articleBody ? "article_body" : surface.financeSurface ? "finance_surface" : "generic_text";
  const terms = topTerms
    .slice(0, 5)
    .map((term) => term.term)
    .join(", ");
  const domains = Array.from(new Set(signals.filter((signal) => signal.kind !== "topic").map((signal) => signal.kind))).join(", ") || "none";
  return `${surfaceLabel}; recurring_terms=${terms || "none"}; signal_groups=${domains}`;
}
