// Typed-fact extraction (engine #4). The JSON-LD/OG summary captures facts a site MARKS UP; this
// captures facts that appear in the RENDERED VISIBLE TEXT — prices, ratings, percentages, dates — which
// many pages expose without any structured markup. Each fact's `raw` is a verbatim substring of the
// input text, so a claim citing it can carry a text_span anchor that the gate grounds against the
// page_text bytes. Deterministic + byte-reproducible (pure regex, no model), domain-neutral so any lens
// (market_scan prices, product_planning percentages, …) can query the same typed layer. A SITE CLAIM,
// like the JSON-LD summary: it says "this value is on the page", not "this value is true".

export type TypedFactKind = "price" | "rating" | "percentage" | "date";

export interface TypedFact {
  kind: TypedFactKind;
  /** Normalized canonical value (price/rating/percentage: numeric string; date: the matched text). */
  value: string;
  /** The verbatim matched substring of the input text (anchorable for cite-or-fail). */
  raw: string;
  /** Character offset of the match in the input text. */
  index: number;
  /** Currency for a price, when recognizable (ISO-ish code or symbol mapping). */
  currency?: string;
}

const MAX_FACTS = 500;

const SYMBOL_CURRENCY: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₩": "KRW", "₹": "INR" };

// One global-flagged pattern per fact kind. `build` turns a match into a TypedFact (or null to skip).
interface FactPattern {
  kind: TypedFactKind;
  regex: RegExp;
  build: (match: RegExpExecArray) => Omit<TypedFact, "kind" | "index"> | null;
}

function numericValue(raw: string): string {
  // Strip everything but digits and a decimal point; collapse thousands separators.
  const cleaned = raw.replace(/[^0-9.,]/g, "");
  // If both separators present, assume comma = thousands, dot = decimal.
  const normalized = cleaned.includes(",") && cleaned.includes(".") ? cleaned.replace(/,/g, "") : cleaned.replace(/,(?=\d{3}\b)/g, "");
  return normalized.replace(/[.,]$/, "");
}

const PATTERNS: FactPattern[] = [
  // Symbol-prefixed price: $1,299.00  ₩4,500  €19,99
  {
    kind: "price",
    regex: /([$€£¥₩₹])\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g,
    build: (match) => {
      const symbol = match[1] ?? "";
      const result: Omit<TypedFact, "kind" | "index"> = { value: numericValue(match[2] ?? ""), raw: match[0] };
      const currency = SYMBOL_CURRENCY[symbol];
      if (currency !== undefined) {
        result.currency = currency;
      }
      return result;
    }
  },
  // Korean won suffix: 4,500원
  {
    kind: "price",
    regex: /(\d{1,3}(?:,\d{3})*|\d+)\s?원/g,
    build: (match) => ({ value: numericValue(match[1] ?? ""), raw: match[0], currency: "KRW" })
  },
  // Code-suffixed price: 1299 USD  19.99 EUR
  {
    kind: "price",
    regex: /(\d{1,3}(?:[.,]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s?(USD|EUR|GBP|JPY|KRW|CNY|INR)\b/g,
    build: (match) => ({ value: numericValue(match[1] ?? ""), raw: match[0], currency: match[2] ?? "" })
  },
  // Rating: 4.5/5   4.5 out of 5   4.5 stars   ★4.5
  {
    kind: "rating",
    regex: /(\d(?:\.\d{1,2})?)\s?(?:\/\s?\d|out of\s?\d|stars?)|★\s?(\d(?:\.\d{1,2})?)/gi,
    build: (match) => {
      const value = match[1] ?? match[2];
      return value === undefined ? null : { value, raw: match[0] };
    }
  },
  // Percentage: 25%   12.5 %   30 percent
  {
    kind: "percentage",
    regex: /(\d{1,3}(?:\.\d{1,2})?)\s?(?:%|percent\b)/gi,
    build: (match) => ({ value: match[1] ?? "", raw: match[0] })
  },
  // Dates: 2026-06-01   2026년 6월 1일   Jan 5, 2026   5 January 2026
  {
    kind: "date",
    regex: /\d{4}-\d{2}-\d{2}|\d{4}년\s?\d{1,2}월\s?\d{1,2}일|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s?\d{1,2},?\s?\d{4}|\d{1,2}\s?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s?\d{4}/gi,
    build: (match) => ({ value: match[0], raw: match[0] })
  }
];

/** Extract typed facts (prices, ratings, percentages, dates) from visible text. Deterministic + ordered. */
export function extractTypedFacts(text: string): TypedFact[] {
  const facts: TypedFact[] = [];
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.regex.exec(text);
    while (match !== null) {
      const built = pattern.build(match);
      if (built !== null) {
        facts.push({ kind: pattern.kind, index: match.index, ...built });
      }
      if (match.index === pattern.regex.lastIndex) {
        pattern.regex.lastIndex += 1; // guard against a zero-width match stalling the loop
      }
      if (facts.length >= MAX_FACTS) {
        break;
      }
      match = pattern.regex.exec(text);
    }
    if (facts.length >= MAX_FACTS) {
      break;
    }
  }
  // Stable order by position, then kind, so the output is deterministic regardless of pattern order.
  facts.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
  return facts.slice(0, MAX_FACTS);
}

/** Count typed facts by kind (handy for a lens to see what a page exposes). */
export function summarizeTypedFacts(facts: TypedFact[]): Record<TypedFactKind, number> {
  const counts: Record<TypedFactKind, number> = { price: 0, rating: 0, percentage: 0, date: 0 };
  for (const fact of facts) {
    counts[fact.kind] += 1;
  }
  return counts;
}
