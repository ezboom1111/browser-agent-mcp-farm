// Multi-vantage agreement (capture-binding Tier 2, the agreement core — PURE). The single-capture
// evidence model silently assumes the bytes a page served US are the bytes it serves EVERYONE. That is
// false for geo-fenced, cloaked, A/B-tested, price-discriminated, censored, or selectively-MITM'd pages.
// If the SAME url is captured from N independent egress points (vantages), agreement across them is a
// strong signal the bytes are not viewer-specific; DISAGREEMENT is the valuable flag the single capture
// would have missed. This module is the pure comparison core: given the per-vantage captures, it decides
// agreed / split / insufficient. The browser orchestration that actually fans the url across proxied
// leases lives separately (multi-vantage-capture.ts) so this stays deterministic and trivially testable.
//
// HONESTY (deliberate, no theater): agreement proves CONSISTENCY ACROSS VANTAGES, not TRUTH. It rules out
// per-viewer divergence (cloaking/geo/one-hop MITM), but N vantages that all reach an origin serving the
// same lie will all agree — agreement is a floor on "everyone sees this", not a ceiling on correctness.

import { contentShingles, jaccardSimilarity } from "./source-independence.js";
import { extractTypedFacts, type TypedFact, type TypedFactKind } from "./typed-facts.js";

const FACT_KINDS: TypedFactKind[] = ["price", "rating", "percentage", "date"];
const DEFAULT_MIN_VANTAGES = 2;
const DEFAULT_CONTENT_OVERLAP = 0.6;
const DEFAULT_AGREEMENT_THRESHOLD = 0.67;

/** One vantage's capture of the shared url. The caller MUST redact any secrets from vantageId. */
export interface VantageCapture {
  /** Label for the egress point (proxy/geo). Secrets (credentials in a proxy URL) must be redacted upstream. */
  vantageId: string;
  /** Visible text captured from this vantage. Absent/empty (or an error) => excluded from quorum. */
  text?: string;
  /** Typed facts from this vantage; derived from `text` when omitted. */
  typedFacts?: TypedFact[];
  status?: number;
  /** Present => this vantage failed (blocked, timeout, …); it does NOT count toward the quorum. */
  error?: string;
}

export type AgreementVerdict = "agreed" | "split" | "insufficient";

export interface FactKindAgreement {
  kind: TypedFactKind;
  /** The value-set the majority of reporting vantages agreed on, when it is a single value. */
  majorityValue?: string;
  /** (# vantages matching the majority value-set) / (# vantages reporting this kind). */
  agreementRatio: number;
  /** The union of distinct canonical values seen across vantages — >1 means the fact varies by viewer. */
  distinctValues: string[];
  reportingVantages: number;
}

export interface MultiVantageAgreement {
  verdict: AgreementVerdict;
  vantageCount: number;
  successfulVantages: number;
  /** (size of the largest near-duplicate content cluster) / successfulVantages. */
  contentAgreementRatio: number;
  largestAgreeingCluster: number;
  majorityVantageIds: string[];
  /** Successful vantages whose content diverged from the majority cluster — the flag. */
  divergentVantageIds: string[];
  /** Vantages that errored (excluded from quorum); surfaced because a per-egress block is itself a signal. */
  failedVantageIds: string[];
  facts: FactKindAgreement[];
  note: string;
}

export interface CompareVantagesOptions {
  minVantages?: number;
  contentOverlapThreshold?: number;
  agreementThreshold?: number;
}

const AGREED_NOTE = "Agreement across independent vantages: the captured bytes were consistent across egress points (not viewer-specific). Proves CONSISTENCY, not truth — a colluding/honest origin serving every vantage the same content (true or false) still agrees.";
const SPLIT_NOTE = "Vantages DISAGREE: the url served different content and/or different key facts depending on the egress point (geo-fence, cloaking, A/B test, price discrimination, censorship, or a one-hop MITM). The single-capture evidence model would have silently recorded one viewer's version as ground truth.";
const INSUFFICIENT_NOTE = "Too few successful vantages to judge agreement. A failed vantage (blocked/timeout at that egress) does not count toward the quorum.";

interface SuccessfulVantage {
  vantageId: string;
  shingles: Set<string>;
  facts: TypedFact[];
}

/** Largest near-duplicate content cluster (union-find over jaccard>threshold); deterministic tie-break. */
function largestContentCluster(vantages: SuccessfulVantage[], threshold: number): string[] {
  const n = vantages.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) {
      root = parent[root] as number;
    }
    return root;
  };
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (jaccardSimilarity((vantages[i] as SuccessfulVantage).shingles, (vantages[j] as SuccessfulVantage).shingles) > threshold) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, string[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    const ids = groups.get(root) ?? [];
    ids.push((vantages[i] as SuccessfulVantage).vantageId);
    groups.set(root, ids);
  }
  let best: string[] = [];
  for (const ids of groups.values()) {
    const sorted = [...ids].sort();
    // Larger cluster wins; on a tie, the cluster with the lexicographically smallest member (stable).
    if (sorted.length > best.length || (sorted.length === best.length && best.length > 0 && (sorted[0] as string) < (best[0] as string))) {
      best = sorted;
    }
  }
  return best;
}

/** Agreement of one fact kind across vantages, or undefined when no vantage reports that kind. */
function factAgreement(kind: TypedFactKind, vantages: SuccessfulVantage[], _threshold: number): FactKindAgreement | undefined {
  const perVantage = vantages.map((v) => ({ id: v.vantageId, values: new Set(v.facts.filter((f) => f.kind === kind).map((f) => f.value)) })).filter((pv) => pv.values.size > 0);
  if (perVantage.length === 0) {
    return undefined;
  }
  const sigCount = new Map<string, number>();
  for (const pv of perVantage) {
    const sig = [...pv.values].sort().join("|");
    sigCount.set(sig, (sigCount.get(sig) ?? 0) + 1);
  }
  const [majSig, majCount] = [...sigCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] as [string, number];
  const distinctValues = [...new Set(perVantage.flatMap((pv) => [...pv.values]))].sort();
  const result: FactKindAgreement = { kind, agreementRatio: majCount / perVantage.length, distinctValues, reportingVantages: perVantage.length };
  if (majSig.length > 0 && !majSig.includes("|")) {
    result.majorityValue = majSig;
  }
  return result;
}

/**
 * Compare N vantage captures of the same url and decide agreement. Pure + deterministic: no IO, no clock.
 * Failed vantages (carrying `error`) and empty captures are excluded from the quorum but surfaced. The
 * verdict is "agreed" only when BOTH the content majority and every reporting fact kind clear the
 * agreement threshold; any divergence (structural OR a single differing price) makes it "split".
 */
export function compareVantages(captures: VantageCapture[], options: CompareVantagesOptions = {}): MultiVantageAgreement {
  const minVantages = options.minVantages ?? DEFAULT_MIN_VANTAGES;
  const contentOverlapThreshold = options.contentOverlapThreshold ?? DEFAULT_CONTENT_OVERLAP;
  const agreementThreshold = options.agreementThreshold ?? DEFAULT_AGREEMENT_THRESHOLD;

  const failedVantageIds = captures
    .filter((c) => c.error !== undefined)
    .map((c) => c.vantageId)
    .sort();
  const successful: SuccessfulVantage[] = captures.filter((c) => c.error === undefined && (c.text ?? "").trim().length > 0).map((c) => ({ vantageId: c.vantageId, shingles: contentShingles(c.text ?? ""), facts: c.typedFacts ?? extractTypedFacts(c.text ?? "") }));

  const facts = FACT_KINDS.map((kind) => factAgreement(kind, successful, agreementThreshold)).filter((f): f is FactKindAgreement => f !== undefined);

  if (successful.length < minVantages) {
    return {
      verdict: "insufficient",
      vantageCount: captures.length,
      successfulVantages: successful.length,
      contentAgreementRatio: 0,
      largestAgreeingCluster: 0,
      majorityVantageIds: successful.map((v) => v.vantageId).sort(),
      divergentVantageIds: [],
      failedVantageIds,
      facts,
      note: INSUFFICIENT_NOTE
    };
  }

  const majority = largestContentCluster(successful, contentOverlapThreshold);
  const majoritySet = new Set(majority);
  const contentAgreementRatio = majority.length / successful.length;
  const divergentVantageIds = successful
    .map((v) => v.vantageId)
    .filter((id) => !majoritySet.has(id))
    .sort();
  const factsAgree = facts.every((f) => f.agreementRatio >= agreementThreshold);
  const verdict: AgreementVerdict = contentAgreementRatio >= agreementThreshold && factsAgree ? "agreed" : "split";

  return {
    verdict,
    vantageCount: captures.length,
    successfulVantages: successful.length,
    contentAgreementRatio,
    largestAgreeingCluster: majority.length,
    majorityVantageIds: majority,
    divergentVantageIds,
    failedVantageIds,
    facts,
    note: verdict === "agreed" ? AGREED_NOTE : SPLIT_NOTE
  };
}
