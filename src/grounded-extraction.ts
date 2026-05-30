import type { EvidenceKind } from "./schemas.js";
import type { StructuredData } from "./structured-extractor.js";

// Verifiable generic-extraction loop (v0.4.0): turn deterministically-extracted typed values
// into text_span-ANCHORED claim proposals. The claim gate re-verifies each quote against the
// cited artifact's actual bytes, so a value the extractor invented (not present on the page) is
// never groundable — extraction PROPOSES, the gate DECIDES. This is the trust mechanism that
// lets a sector-agnostic extractor (today the deterministic structured-extractor; tomorrow a
// pluggable model-driven one) stay safe without per-site code: a hallucinated field is caught.

export interface GroundedClaimProposal {
  field: "name" | "price" | "rating";
  claim: string;
  claimType: "text";
  evidenceKind: EvidenceKind;
  anchor: { type: "text_span"; quote: string };
}

/**
 * Propose grounded claims for each typed value (name / price / rating) the extractor found,
 * anchored on a literal substring of the captured visible text. A value with no literal form in
 * the text is NOT proposed (it would fail the gate anyway), so proposals are pre-filtered to the
 * groundable set; the gate remains the final arbiter when these are added.
 */
export function proposeGroundedClaims(structured: StructuredData, visibleText: string, evidenceKind: EvidenceKind = "page_text"): GroundedClaimProposal[] {
  const proposals: GroundedClaimProposal[] = [];
  const summary = structured.summary;

  const consider = (field: GroundedClaimProposal["field"], label: string, value: string | undefined): void => {
    if (value === undefined || value.trim().length === 0) {
      return;
    }
    const quote = literalQuoteIn(visibleText, value.trim());
    if (quote !== undefined) {
      proposals.push({
        field,
        claim: `${label}: ${value.trim()}`,
        claimType: "text",
        evidenceKind,
        anchor: { type: "text_span", quote }
      });
    }
  };

  consider("name", "Name", summary.name);
  consider("price", "Price", summary.price?.value);
  consider("rating", "Rating", summary.rating?.value);
  return proposals;
}

/**
 * Return the literal substring of `text` that grounds `value`, trying the raw value and a
 * comma-grouped / de-grouped numeric variant (publisher markup often stores "19900" while the
 * rendered page shows "19,900"). undefined when no literal form of the value appears in the text.
 */
export function literalQuoteIn(text: string, value: string): string | undefined {
  return quoteCandidates(value).find((candidate) => text.includes(candidate));
}

function quoteCandidates(value: string): string[] {
  const candidates = [value];
  const digits = value.replace(/[,\s]/g, "");
  if (/^\d+(\.\d+)?$/.test(digits)) {
    candidates.push(digits);
    const [intPart, frac] = digits.split(".");
    const grouped = (intPart ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    candidates.push(frac !== undefined ? `${grouped}.${frac}` : grouped);
  }
  return [...new Set(candidates)];
}
