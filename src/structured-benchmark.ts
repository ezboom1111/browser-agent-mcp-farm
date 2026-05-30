// Evidence-quality measurement for the deterministic structured extractor (master-plan
// P3). It scores extracted typed facts against a labeled golden corpus by
// precision / recall / exact-match over a FIXED set of graded fields, so extraction
// correctness becomes a measured, falsifiable number that CI can regress against —
// not a vibe. Only the graded fields are scored (the extractor emits many more keys,
// e.g. every og:/twitter: tag, which are intentionally NOT graded here).

import type { StructuredData } from "./structured-extractor.js";

// The typed facts we hold the extractor accountable for. A fixed schema keeps
// precision honest: an unlabeled field the extractor happens to emit is not graded,
// and a labeled field it fails to emit is a recall miss.
export const GRADED_FIELDS = ["type", "name", "price.value", "price.currency", "rating.value", "rating.scale", "rating.count", "title", "canonical"] as const;

export type GradedField = (typeof GRADED_FIELDS)[number];

export type GoldenLabels = Partial<Record<GradedField, string>>;

export interface GoldenCase {
  id: string;
  category: "product" | "place" | "review" | "news";
  locale: "ko" | "en" | "ja";
  note?: string;
  html: string;
  expected: GoldenLabels;
}

// Flatten the rich StructuredData into just the graded fields so the corpus labels
// and the prediction are compared on the same fixed key set.
export function gradedFieldsOf(data: StructuredData): GoldenLabels {
  const out: GoldenLabels = {};
  const summary = data.summary;
  if (summary.type !== undefined) {
    out.type = summary.type;
  }
  if (summary.name !== undefined) {
    out.name = summary.name;
  }
  if (summary.price?.value !== undefined) {
    out["price.value"] = summary.price.value;
  }
  if (summary.price?.currency !== undefined) {
    out["price.currency"] = summary.price.currency;
  }
  if (summary.rating?.value !== undefined) {
    out["rating.value"] = summary.rating.value;
  }
  if (summary.rating?.scale !== undefined) {
    out["rating.scale"] = summary.rating.scale;
  }
  if (summary.rating?.count !== undefined) {
    out["rating.count"] = summary.rating.count;
  }
  if (data.title !== undefined) {
    out.title = data.title;
  }
  if (data.canonical !== undefined) {
    out.canonical = data.canonical;
  }
  return out;
}

export interface FieldTally {
  tp: number;
  fp: number;
  fn: number;
  exact: number;
  expected: number;
}

export interface CaseScore {
  id: string;
  tp: number;
  fp: number;
  fn: number;
  exact: number;
  expected: number;
  mismatches: string[];
}

export interface BenchmarkResult {
  precision: number;
  recall: number;
  exactMatch: number;
  tp: number;
  fp: number;
  fn: number;
  exactCount: number;
  expectedCount: number;
  perField: Record<GradedField, FieldTally>;
  perCase: CaseScore[];
}

// Score one predicted label set against its gold labels over the fixed graded fields.
// Wrong value counts as BOTH a false positive (predicted a bad value) and a false
// negative (missed the right one) — the standard treatment for value extraction.
export function scoreCase(id: string, predicted: GoldenLabels, expected: GoldenLabels): CaseScore {
  const score: CaseScore = { id, tp: 0, fp: 0, fn: 0, exact: 0, expected: 0, mismatches: [] };
  for (const field of GRADED_FIELDS) {
    const want = expected[field];
    const got = predicted[field];
    if (want !== undefined) {
      score.expected += 1;
    }
    if (want !== undefined && got !== undefined) {
      if (want === got) {
        score.tp += 1;
        score.exact += 1;
      } else {
        score.fp += 1;
        score.fn += 1;
        score.mismatches.push(`${field}: expected "${want}" got "${got}"`);
      }
    } else if (want !== undefined) {
      score.fn += 1;
      score.mismatches.push(`${field}: expected "${want}" got nothing`);
    } else if (got !== undefined) {
      score.fp += 1;
      score.mismatches.push(`${field}: expected nothing got "${got}"`);
    }
  }
  return score;
}

function emptyFieldTally(): FieldTally {
  return { tp: 0, fp: 0, fn: 0, exact: 0, expected: 0 };
}

// Aggregate per-case scores into corpus-level precision / recall / exact-match plus a
// per-field breakdown so a regression points at the exact field that decayed.
export function scoreCorpus(cases: Array<{ id: string; predicted: GoldenLabels; expected: GoldenLabels }>): BenchmarkResult {
  const perField = Object.fromEntries(GRADED_FIELDS.map((f) => [f, emptyFieldTally()])) as Record<GradedField, FieldTally>;
  const perCase: CaseScore[] = [];
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let exactCount = 0;
  let expectedCount = 0;

  for (const item of cases) {
    const caseScore = scoreCase(item.id, item.predicted, item.expected);
    perCase.push(caseScore);
    tp += caseScore.tp;
    fp += caseScore.fp;
    fn += caseScore.fn;
    exactCount += caseScore.exact;
    expectedCount += caseScore.expected;

    for (const field of GRADED_FIELDS) {
      const want = item.expected[field];
      const got = item.predicted[field];
      const tally = perField[field];
      if (want !== undefined) {
        tally.expected += 1;
      }
      if (want !== undefined && got !== undefined) {
        if (want === got) {
          tally.tp += 1;
          tally.exact += 1;
        } else {
          tally.fp += 1;
          tally.fn += 1;
        }
      } else if (want !== undefined) {
        tally.fn += 1;
      } else if (got !== undefined) {
        tally.fp += 1;
      }
    }
  }

  return {
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    exactMatch: expectedCount === 0 ? 1 : exactCount / expectedCount,
    tp,
    fp,
    fn,
    exactCount,
    expectedCount,
    perField,
    perCase
  };
}
