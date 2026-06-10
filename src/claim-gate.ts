import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ClaimAnchorSchema, ClaimTypeSchema, EvidenceKindSchema, type ClaimType, type EvidenceKind } from "./schemas.js";
import { independentSourceGroups, registrableDomain } from "./source-independence.js";
import { CAPTURE_TRANSCRIPT_SCHEMA } from "./capture-transcript.js";

interface ArtifactLedgerRow {
  artifact_id?: string;
  path?: string;
  sha256?: string;
  kind?: string;
  evidence_kind?: EvidenceKind;
  source_url?: string;
  capture_method?: string;
}

interface ClaimCorroboration {
  sources?: Array<{ artifactId?: string; quote?: string }>;
  minIndependentSources?: number;
}

interface JudgmentSpan {
  artifactId?: string;
  quote?: string;
}

interface JudgmentLedgerRow {
  judgment_id?: string;
  claim?: string;
  verdict?: string;
  support?: JudgmentSpan[];
  refute?: JudgmentSpan[];
  min_independent_sources?: number;
}

interface ClaimLedgerRow {
  schema_version?: string;
  claim_id?: string;
  claim_type?: ClaimType;
  claim?: string;
  evidence?: string;
  artifact_id?: string;
  evidence_kind?: EvidenceKind;
  timestampSec?: number;
  verification_level?: string;
  anchor?: unknown;
  claim_taxonomy?: string;
  corroboration?: ClaimCorroboration;
}

interface CitationLedgerRow {
  claim_id?: string;
  evidence?: string;
  artifact_id?: string;
  evidence_kind?: EvidenceKind;
}

interface CitationEvidence {
  ref: string;
  evidenceKind?: EvidenceKind | undefined;
}

export interface ClaimGateResult {
  ok: boolean;
  counts: {
    artifacts: number;
    claims: number;
    citations: number;
    judgments?: number;
    captureTranscripts?: number;
  };
  errors: string[];
  warnings: string[];
}

export interface ClaimGateOptions {
  mode?: "smoke" | "final";
  minClaims?: number;
  /**
   * Structured-provenance enforcement. The measured "structured-in-disguise" hole: agents repackaged
   * news text into hand-assembled JSON to satisfy a structured-evidence expectation (~36% genuine in
   * QA). The gate reads the ledger's capture_method: `agent-authored` structured_data is self-asserted,
   * while farm-derived structured_data ("structured-extractor" / "http-fetch-structured") was produced
   * deterministically from witnessed bytes. Default false = warn only (no pass/fail flip for existing
   * consumers); true = an agent-authored structured_data citation is a hard error.
   */
  strictProvenance?: boolean;
}

export async function runClaimGate(runDir: string, options: ClaimGateOptions = {}): Promise<ClaimGateResult> {
  const mode = options.mode ?? "smoke";
  const minClaims = options.minClaims ?? (mode === "final" ? 1 : 0);
  const artifacts = await readJsonl<ArtifactLedgerRow>(join(runDir, "artifacts.jsonl"));
  const claims = await readJsonl<ClaimLedgerRow>(join(runDir, "claims.jsonl"));
  const citations = await readJsonl<CitationLedgerRow>(join(runDir, "citations.jsonl"));
  const judgments = await readJsonl<JudgmentLedgerRow>(join(runDir, "judgments.jsonl"));
  const errors: string[] = [];
  const warnings: string[] = [];
  const registeredIds = new Set<string>();
  const registeredPaths = new Set<string>();
  const artifactsByRef = new Map<string, ArtifactLedgerRow>();

  for (const artifact of artifacts) {
    if (artifact.artifact_id) {
      registeredIds.add(artifact.artifact_id);
      artifactsByRef.set(artifact.artifact_id, artifact);
    }
    if (artifact.path) {
      registeredPaths.add(artifact.path);
      artifactsByRef.set(artifact.path, artifact);
      if (artifact.sha256) {
        const actualHash = await sha256File(join(runDir, artifact.path)).catch(() => undefined);
        if (actualHash === undefined) {
          errors.push(`artifact missing on disk: ${artifact.path}`);
        } else if (actualHash !== artifact.sha256) {
          errors.push(`artifact hash mismatch: ${artifact.path}`);
        }
      }
    } else {
      errors.push("artifact missing path");
    }
  }

  // Capture-transcript consistency (origin-binding Phase 0). A capturer-attested transcript binds itself
  // to a registered page artifact; here we cross-check that the transcript's recorded digest equals that
  // artifact's registered (and already re-hashed) sha256. This is an INTEGRITY check — it only ever ADDS
  // an error on inconsistency, never raises a verdict — so it runs in both modes and cannot let a bad run
  // pass (preserving the 0-leak property). It is NOT origin proof: see capture-transcript.ts / the design.
  let captureTranscriptCount = 0;
  for (const artifact of artifacts) {
    if (artifact.evidence_kind === "capture_transcript" && artifact.path !== undefined) {
      if (await validateCaptureTranscript(runDir, artifact, artifactsByRef, artifact.path, errors)) {
        captureTranscriptCount += 1;
      }
    }
  }

  const citationIds = new Set(citations.map((citation) => citation.claim_id).filter((value): value is string => Boolean(value)));
  const citationsByClaimId = new Map<string, CitationEvidence[]>();
  for (const citation of citations) {
    if (citation.claim_id === undefined) {
      continue;
    }
    const citationRef = citationEvidenceRef(citation);
    if (citationRef === undefined) {
      continue;
    }
    const normalizedRef = normalizeEvidenceRef(citationRef);
    const artifact = artifactsByRef.get(normalizedRef);
    const existing = citationsByClaimId.get(citation.claim_id) ?? [];
    existing.push({
      ref: normalizedRef,
      evidenceKind: citation.evidence_kind ?? artifact?.evidence_kind
    });
    citationsByClaimId.set(citation.claim_id, existing);
    if (!registeredIds.has(normalizedRef) && !registeredPaths.has(normalizedRef)) {
      errors.push(`citation evidence is not registered: ${citation.claim_id} -> ${citationRef}`);
    }
  }

  for (const claim of claims) {
    const claimLabel = claim.claim_id ?? claim.claim ?? "unknown claim";
    if (!claim.evidence) {
      errors.push(`claim has no evidence: ${claimLabel}`);
      continue;
    }

    if (claim.claim_id) {
      const claimCitations = citationsByClaimId.get(claim.claim_id);
      // claim.evidence is guaranteed defined here (the `!claim.evidence` guard
      // above `continue`s). Hoist the normalized ref so the narrowing survives
      // the `.some()` closure below.
      const claimEvidenceRef = normalizeEvidenceRef(claim.evidence);
      if (!citationIds.has(claim.claim_id)) {
        errors.push(`claim has no matching citation: ${claim.claim_id}`);
      } else if (claimCitations === undefined || claimCitations.length === 0) {
        // A citation row exists for this claim id but none carries a usable
        // evidence/artifact reference, so it cannot actually back the claim.
        // Previously the per-claim match below was disabled whenever the GLOBAL
        // citation-ref set was empty, silently passing such malformed ledgers.
        errors.push(`claim citation has no usable evidence reference: ${claim.claim_id}`);
      } else if (!claimCitations.some((citation) => citation.ref === claimEvidenceRef)) {
        errors.push(`claim citation does not match evidence: ${claim.claim_id} -> ${claim.evidence}`);
      }
    }

    const evidenceRef = normalizeEvidenceRef(claim.evidence);
    const artifact = artifactsByRef.get(evidenceRef);
    if (!registeredIds.has(evidenceRef) && !registeredPaths.has(evidenceRef)) {
      errors.push(`claim evidence is not registered: ${claimLabel} -> ${claim.evidence}`);
      continue;
    }

    if (mode === "final") {
      validateTypedClaim(claim, artifact, claimLabel, errors);
      validateDestinationProvenanceClaim(claim, citationsByClaimId.get(claim.claim_id ?? ""), claimLabel, errors);
      validateStructuredProvenance(artifact, artifacts, claimLabel, options.strictProvenance === true ? errors : warnings);
      if (claim.anchor !== undefined) {
        await validateClaimGrounding(runDir, claim, artifact, claimLabel, errors, warnings);
      } else if (artifact !== undefined && (artifact.evidence_kind === "official_api_metadata" || artifact.evidence_kind === "metadata")) {
        // The "999999" hole: a metadata-kind artifact carries no text-groundable span, so a claim that
        // cites it WITHOUT an anchor is never byte-checked — a wrong value (e.g. 999999) would pass.
        // Hard-warn (not a hard error): destination-provenance claims legitimately carry no text_span
        // and are validated separately, and flipping the pass/fail contract for every farm consumer
        // would need a deprecation cycle. To actually verify the number, re-register the field as
        // page_text or structured_data and cite it with a text_span anchor.
        warnings.push(`claim cites ${artifact.evidence_kind} with no anchor — its value is NOT byte-verified (a wrong number would pass the gate); re-register the field as page_text or structured_data and add a text_span anchor: ${claimLabel}`);
      }
      await validateClaimCorroboration(runDir, claim, artifactsByRef, claimLabel, errors, warnings);
    } else {
      validateSmokeTypedClaim(claim, artifact, claimLabel, warnings);
    }
  }

  // Caged-judge verification (final mode): each judgment's support/refute spans must verify against
  // their sources' bytes, and the verdict must be structurally consistent with what verified.
  if (mode === "final") {
    for (const judgment of judgments) {
      await validateJudgment(runDir, judgment, artifactsByRef, judgment.judgment_id ?? judgment.claim ?? "unknown judgment", errors, warnings);
    }
  }

  if (claims.length < minClaims) {
    errors.push(`claim count below required minimum for ${mode} mode: ${claims.length} < ${minClaims}`);
  } else if (claims.length === 0) {
    warnings.push("no claims were present for claim-gate validation");
  }

  return {
    ok: errors.length === 0,
    counts: {
      artifacts: artifacts.length,
      claims: claims.length,
      citations: citations.length,
      ...(judgments.length > 0 ? { judgments: judgments.length } : {}),
      ...(captureTranscriptCount > 0 ? { captureTranscripts: captureTranscriptCount } : {})
    },
    errors,
    warnings
  };
}

function validateSmokeTypedClaim(claim: ClaimLedgerRow, artifact: ArtifactLedgerRow | undefined, claimLabel: string, warnings: string[]): void {
  if (claim.claim_type !== undefined && !ClaimTypeSchema.safeParse(claim.claim_type).success) {
    warnings.push(`claim has unknown claim_type: ${claimLabel}`);
  }
  if (claim.evidence_kind !== undefined && !EvidenceKindSchema.safeParse(claim.evidence_kind).success) {
    warnings.push(`claim has unknown evidence_kind: ${claimLabel}`);
  }
  if (claim.evidence_kind !== undefined && artifact?.evidence_kind !== undefined && claim.evidence_kind !== artifact.evidence_kind) {
    warnings.push(`claim evidence_kind does not match artifact: ${claimLabel} -> ${claim.evidence_kind} != ${artifact.evidence_kind}`);
  }
}

function validateTypedClaim(claim: ClaimLedgerRow, artifact: ArtifactLedgerRow | undefined, claimLabel: string, errors: string[]): void {
  if (claim.schema_version !== "1.0") {
    errors.push(`final claim is missing supported schema_version: ${claimLabel}`);
  }
  if (!claim.artifact_id) {
    errors.push(`final claim is missing artifact_id: ${claimLabel}`);
  }
  if (claim.artifact_id && claim.evidence && normalizeEvidenceRef(claim.evidence) !== claim.artifact_id) {
    errors.push(`final claim artifact_id does not match evidence: ${claimLabel}`);
  }
  if (!claim.claim_type || !ClaimTypeSchema.safeParse(claim.claim_type).success) {
    errors.push(`final claim is missing valid claim_type: ${claimLabel}`);
  }
  if (!claim.evidence_kind || !EvidenceKindSchema.safeParse(claim.evidence_kind).success) {
    errors.push(`final claim is missing valid evidence_kind: ${claimLabel}`);
  }
  if (claim.evidence_kind !== undefined && artifact?.evidence_kind !== claim.evidence_kind) {
    errors.push(`final claim evidence_kind does not match artifact: ${claimLabel} -> ${claim.evidence_kind} != ${artifact?.evidence_kind ?? "missing"}`);
  }
  if (claim.claim_type === "visual") {
    if (artifact?.evidence_kind !== "frame_screenshot") {
      errors.push(`visual claim must cite a timestamped frame screenshot artifact: ${claimLabel}`);
    }
    if (typeof claim.timestampSec !== "number" || !Number.isFinite(claim.timestampSec)) {
      errors.push(`visual claim must include timestampSec: ${claimLabel}`);
    }
  }
  if (claim.evidence_kind === "transcript_cue" && claim.claim_type !== "text") {
    errors.push(`transcript cue evidence must support a text claim: ${claimLabel}`);
  }
  if (claim.claim_type === "text" && claim.evidence_kind === "transcript_cue" && artifact?.evidence_kind !== "transcript_cue") {
    errors.push(`transcript claim must cite a transcript cue artifact: ${claimLabel}`);
  }
  if (claim.claim_type === "audio" && artifact?.evidence_kind !== "audio_transcription") {
    // audio_transcription is a lawful provider/operator-supplied transcript only; the
    // farm never performs speech-to-text (non-goal). Captured captions are transcript_cue.
    errors.push(`audio claim must cite a lawful provider-supplied audio_transcription artifact (the farm performs no speech-to-text): ${claimLabel}`);
  }
}

/**
 * Structured-provenance check (closes the measured "structured-in-disguise" hole, ~36% genuine in QA).
 * A structured_data artifact registered via farm_register_evidence carries capture_method
 * "agent-authored" — its JSON shape is self-asserted, not derived by the farm. Farm-derived
 * structured_data ("structured-extractor", "http-fetch-structured") was produced deterministically
 * from witnessed page bytes and is never flagged. When the agent-authored JSON's source domain matches
 * an already-registered non-structured page artifact in the same run, the message names the likely
 * repackaging and points at the deterministic alternative. Severity is the caller's: default mode
 * passes `warnings`, strictProvenance passes `errors`. (A producer could forge capture_method in the
 * ledger — this check raises the cost of the lazy failure mode from accidental to deliberate; it is
 * not origin proof, see THREAT_MODEL.md.)
 */
function validateStructuredProvenance(artifact: ArtifactLedgerRow | undefined, artifacts: ArtifactLedgerRow[], claimLabel: string, sink: string[]): void {
  if (artifact?.evidence_kind !== "structured_data" || artifact.capture_method !== "agent-authored") {
    return;
  }
  const structuredDomain = artifact.source_url === undefined ? undefined : registrableDomain(artifact.source_url);
  const repackagedFrom =
    structuredDomain === undefined
      ? undefined
      : artifacts.find((candidate) => candidate !== artifact && candidate.evidence_kind !== undefined && candidate.evidence_kind !== "structured_data" && candidate.evidence_kind !== "metadata" && candidate.source_url !== undefined && registrableDomain(candidate.source_url) === structuredDomain);
  if (repackagedFrom !== undefined) {
    sink.push(
      `claim cites agent-authored structured_data whose source domain (${structuredDomain}) matches an already-registered page artifact — likely repackaged from that page (the measured structured-in-disguise failure mode); derive it with the farm instead (farm_evidence_run structured extraction / farm_extract_structured on the registered page): ${claimLabel}`
    );
    return;
  }
  sink.push(`claim cites agent-authored structured_data (self-asserted provenance, not farm-witnessed): ${claimLabel} — the measured structured-in-disguise failure mode (~36% genuine in QA); prefer a farm-derived structured artifact (farm_evidence_run / official API capture) or corroborate across independent domains`);
}

function validateDestinationProvenanceClaim(claim: ClaimLedgerRow, citations: CitationEvidence[] | undefined, claimLabel: string, errors: string[]): void {
  const requiredKinds = requiredDestinationProvenanceKinds(claim.evidence_kind);
  if (requiredKinds.length === 0) {
    return;
  }
  const citedKinds = new Set((citations ?? []).map((citation) => citation.evidenceKind).filter((value): value is EvidenceKind => value !== undefined));
  for (const requiredKind of requiredKinds) {
    if (!citedKinds.has(requiredKind)) {
      errors.push(`destination claim missing provenance citation: ${claimLabel} requires ${requiredKind}`);
    }
  }
}

function requiredDestinationProvenanceKinds(evidenceKind: EvidenceKind | undefined): EvidenceKind[] {
  switch (evidenceKind) {
    case "destination_candidate":
      return ["source_navigation_action"];
    case "source_navigation_followup":
      return ["source_navigation_action", "destination_candidate"];
    case "destination_triage":
      return ["source_navigation_action", "destination_candidate", "source_navigation_followup"];
    case "destination_deepening_proposal":
      return ["source_navigation_action", "destination_candidate", "source_navigation_followup"];
    case "destination_deepening_run":
      return ["source_navigation_action", "destination_candidate", "source_navigation_followup", "destination_deepening_proposal"];
    default:
      return [];
  }
}

/**
 * Grounding check (master-plan flagship). When a final-mode claim carries an
 * anchor, verify it against the CITED ARTIFACT'S ACTUAL BYTES, not just the
 * ledger graph. For a text_span this opens the artifact and confirms the quote
 * (or, for derived/aggregated claims, the supporting tokens) actually appear in
 * it — so the gate proves a claim is grounded in evidence, not merely that the
 * citation graph is well-formed. Other anchor types are checked structurally
 * (the cited artifact's kind must match the anchor).
 */
async function validateClaimGrounding(runDir: string, claim: ClaimLedgerRow, artifact: ArtifactLedgerRow | undefined, claimLabel: string, errors: string[], warnings: string[]): Promise<void> {
  const parsed = ClaimAnchorSchema.safeParse(claim.anchor);
  if (!parsed.success) {
    errors.push(`claim anchor is malformed: ${claimLabel}`);
    return;
  }
  const anchor = parsed.data;
  const kind = artifact?.evidence_kind;

  if (anchor.type === "ocr_bbox") {
    if (kind !== "ocr_text") {
      errors.push(`ocr_bbox anchor requires an ocr_text artifact: ${claimLabel}`);
    }
    return;
  }
  if (anchor.type === "transcript_cue") {
    if (kind !== "transcript_cue") {
      errors.push(`transcript_cue anchor requires a transcript_cue artifact: ${claimLabel}`);
    }
    return;
  }
  if (anchor.type === "frame") {
    if (kind !== "frame_screenshot") {
      errors.push(`frame anchor requires a frame_screenshot artifact: ${claimLabel}`);
    }
    return;
  }

  // text_span: actually open the artifact bytes and check the quote/tokens.
  if (!isTextGroundableKind(kind)) {
    errors.push(`text_span anchor requires a text/HTML/OCR/transcript artifact: ${claimLabel}`);
    return;
  }
  const content = await readArtifactText(runDir, artifact);
  if (content === undefined) {
    errors.push(`claim grounding artifact could not be read: ${claimLabel}`);
    return;
  }
  const normContent = normalizeForMatch(content);
  if (claim.claim_taxonomy === "derived" || claim.claim_taxonomy === "aggregated") {
    const tokens = anchor.normalizedTokens !== undefined && anchor.normalizedTokens.length > 0 ? anchor.normalizedTokens : tokenizeForMatch(anchor.quote);
    const normalizedTokens = tokens.map((token) => normalizeForMatch(token));
    const missing = normalizedTokens.filter((token) => !normContent.includes(token));
    if (missing.length > 0) {
      errors.push(`claim grounding tokens not found in cited artifact: ${claimLabel} -> ${missing.slice(0, 5).join(", ")}`);
      return;
    }
    // Token-presence grounding (paraphrase/aggregation) is weaker than a contiguous span: every token
    // is on the page, but their ARRANGEMENT is not verified, so a recombination of real tokens across
    // unrelated content (e.g. "<EntityA> grew <PctOfEntityB>") can pass. Deterministic NLU is out of
    // scope, but we can flag SCATTER: if the smallest window covering all tokens is far larger than the
    // claim, warn (not block — legitimate cross-page synthesis exists). For a high-assurance claim,
    // prefer a text_span quote (contiguous, 0 leak) or corroboration across independent sources.
    if (normalizedTokens.length >= 2) {
      const span = minWindowCoverChars(normContent, normalizedTokens);
      const threshold = Math.max(160, normalizeForMatch(anchor.quote).length * 6);
      if (span > threshold) {
        warnings.push(`aggregated/derived claim tokens are scattered across ~${span} chars of the artifact (token-presence grounding; possible recombination — prefer a text_span quote or corroboration): ${claimLabel}`);
      }
    }
    return;
  }
  if (!normContent.includes(normalizeForMatch(anchor.quote))) {
    errors.push(`claim text not found in cited artifact: ${claimLabel} -> "${anchor.quote.slice(0, 80)}"`);
  }
}

/**
 * Cross-source corroboration (engine #2). When a final-mode claim carries a `corroboration` block,
 * verify each cited supporting source is REGISTERED, verify any per-source quote against THAT source's
 * actual bytes, and count the distinct registrable domains across the primary + supporting sources. If
 * the independent-source count is below the required minimum the claim fails. This proves the claim
 * cites N independent, hash-verified sources (and any quoted support is present in each) — it does NOT
 * prove the sources semantically agree, which is beyond a deterministic gate.
 */
async function validateClaimCorroboration(runDir: string, claim: ClaimLedgerRow, artifactsByRef: Map<string, ArtifactLedgerRow>, claimLabel: string, errors: string[], warnings: string[]): Promise<void> {
  const corroboration = claim.corroboration;
  if (corroboration === undefined || corroboration.sources === undefined || corroboration.sources.length === 0) {
    return;
  }
  // Clamp the required minimum at the gate READ path: the gate re-verifies untrusted run directories
  // (e.g. farm_run_claim_gate on a dir written elsewhere), and claims.jsonl is not re-parsed through the
  // authoring Zod schema — so a hand-written `minIndependentSources: 1` must not be honoured. Corroboration
  // means at least two independent sources; anything lower is forced back to 2.
  const requestedMin = corroboration.minIndependentSources;
  const minIndependent = typeof requestedMin === "number" && Number.isInteger(requestedMin) && requestedMin >= 2 ? requestedMin : 2;
  // Collect {url, text} per source so independence is content-aware: a syndicated wire story echoed
  // across domains collapses to one source (Tier 3), not many.
  const sources: Array<{ url?: string | undefined; text?: string | undefined }> = [];
  const primary = claim.artifact_id === undefined ? undefined : artifactsByRef.get(normalizeEvidenceRef(claim.artifact_id));
  sources.push({ url: primary?.source_url, text: primary === undefined ? undefined : await readArtifactText(runDir, primary) });

  for (const source of corroboration.sources) {
    if (source.artifactId === undefined) {
      errors.push(`corroboration source missing artifactId: ${claimLabel}`);
      continue;
    }
    const artifact = artifactsByRef.get(normalizeEvidenceRef(source.artifactId));
    if (artifact === undefined) {
      errors.push(`corroboration source not registered: ${claimLabel} -> ${source.artifactId}`);
      continue;
    }
    if (artifact.source_url === undefined) {
      // A registered source with no recorded source_url cannot contribute a domain, so the count would
      // silently come up short. Surface that as an actionable warning rather than a cryptic shortfall.
      warnings.push(`corroboration source has no source_url (its domain is not counted): ${claimLabel} -> ${source.artifactId}`);
    }
    const content = await readArtifactText(runDir, artifact);
    sources.push({ url: artifact.source_url, text: content });
    if (source.quote !== undefined && (content === undefined || !normalizeForMatch(content).includes(normalizeForMatch(source.quote)))) {
      errors.push(`corroboration quote not found in source: ${claimLabel} -> ${source.artifactId} -> "${source.quote.slice(0, 80)}"`);
    }
  }

  const independent = independentSourceGroups(sources);
  if (independent < minIndependent) {
    errors.push(`claim corroboration below required independent sources: ${claimLabel} -> ${independent} < ${minIndependent} (after collapsing same-domain + near-duplicate echoes)`);
  }
  // A satisfied corroboration is a SUCCESS, not a warning — it is signalled by the absence of an error
  // here (the claim row keeps its corroboration sources for a report layer to count), so nothing is
  // pushed to warnings on the pass path.
}

/**
 * Caged-judge verification (the semantic ceiling, deterministically caged). A judgment asserts a
 * verdict over a claim and cites SUPPORTING and/or REFUTING spans. The gate verifies every cited span
 * literally appears in its source's bytes (so a fabricated or recombined span cannot back a verdict),
 * then enforces a structural quorum: a 'supported' verdict needs >= minIndependent verified supporting
 * spans from distinct registrable domains AND no verified refuting span (an inconsistency the judge
 * itself surfaced); a 'refuted' verdict needs a verified refuting span. The gate does NOT (and cannot)
 * verify the verdict is semantically correct — that is the external judge's job — but an untrusted
 * judge cannot make 'supported' stand on evidence that does not exist or that it contradicts.
 */
async function validateJudgment(runDir: string, judgment: JudgmentLedgerRow, artifactsByRef: Map<string, ArtifactLedgerRow>, label: string, errors: string[], warnings: string[]): Promise<void> {
  const verdict = judgment.verdict;
  if (verdict !== "supported" && verdict !== "refuted" && verdict !== "insufficient") {
    errors.push(`judgment has an invalid verdict: ${label} -> ${String(verdict)}`);
    return;
  }
  // Returns the VERIFIED distinct sources (deduped by artifact) as {url, text}, so independence can be
  // computed content-aware (a syndicated echo across domains collapses to one source).
  const verifySpans = async (spans: JudgmentSpan[] | undefined, role: string): Promise<Array<{ url?: string | undefined; text?: string | undefined }>> => {
    const verified: Array<{ url?: string | undefined; text?: string | undefined }> = [];
    const seen = new Set<string>();
    for (const span of spans ?? []) {
      if (span.artifactId === undefined || span.quote === undefined) {
        errors.push(`judgment ${role} span missing artifactId/quote: ${label}`);
        continue;
      }
      const ref = normalizeEvidenceRef(span.artifactId);
      const artifact = artifactsByRef.get(ref);
      if (artifact === undefined) {
        errors.push(`judgment ${role} span source not registered: ${label} -> ${span.artifactId}`);
        continue;
      }
      const content = await readArtifactText(runDir, artifact);
      if (content === undefined || !normalizeForMatch(content).includes(normalizeForMatch(span.quote))) {
        errors.push(`judgment ${role} span quote not found in source: ${label} -> ${span.artifactId} -> "${span.quote.slice(0, 80)}"`);
        continue;
      }
      if (!seen.has(ref)) {
        seen.add(ref);
        verified.push({ url: artifact.source_url, text: content });
      }
    }
    return verified;
  };

  const verifiedSupport = await verifySpans(judgment.support, "support");
  const verifiedRefute = await verifySpans(judgment.refute, "refute");
  // Clamp to >= 1 at the gate READ path (judgments.jsonl is not re-parsed through the authoring schema):
  // a single-source 'supported' verdict is legal but lower-assurance (it is warned below); the default
  // remains 2. A hand-written min of 0 / non-integer is forced back up to the default.
  const rawMin = judgment.min_independent_sources;
  const minIndependent = typeof rawMin === "number" && Number.isInteger(rawMin) && rawMin >= 1 ? rawMin : 2;
  const independentSupport = independentSourceGroups(verifiedSupport);

  if (verdict === "supported") {
    if (verifiedSupport.length === 0) {
      errors.push(`'supported' judgment has no verified supporting span: ${label}`);
    } else if (independentSupport < minIndependent) {
      errors.push(`'supported' judgment below required independent supporting sources: ${label} -> ${independentSupport} < ${minIndependent} (after collapsing same-domain + near-duplicate echoes)`);
    } else if (independentSupport < 2) {
      warnings.push(`'supported' judgment rests on a single independent source (lower assurance; prefer >= 2 independent sources): ${label}`);
    }
    if (verifiedRefute.length > 0) {
      errors.push(`'supported' judgment is contradicted by a verified refuting span (inconsistent verdict): ${label}`);
    }
  } else if (verdict === "refuted") {
    if (verifiedRefute.length === 0) {
      errors.push(`'refuted' judgment has no verified refuting span: ${label}`);
    }
  } else if (verifiedSupport.length === 0 && verifiedRefute.length === 0) {
    warnings.push(`'insufficient' judgment cites no verified spans: ${label}`);
  }
}

/**
 * Capture-transcript consistency (origin-binding Phase 0). A `capture_transcript` artifact carries a
 * `binds: {path, sha256}` reference to the registered page artifact it was captured alongside. The gate
 * verifies that bound digest equals the page artifact's REGISTERED sha256 (which the gate already
 * re-hashed against disk). A mismatch means the transcript is desynced from the bytes — an integrity
 * failure. This ONLY adds errors; it never raises a verdict. It is schema-discriminated so the bundle's
 * metadata sidecar (also tagged capture_transcript) is skipped. It is NOT origin proof — a producer that
 * controls the bytes can write a self-consistent transcript (TLS deniability); see the design doc.
 */
async function validateCaptureTranscript(runDir: string, artifact: ArtifactLedgerRow, artifactsByRef: Map<string, ArtifactLedgerRow>, label: string, errors: string[]): Promise<boolean> {
  const content = await readArtifactText(runDir, artifact);
  if (content === undefined) {
    return false; // unreadable/non-text — the artifact re-hash already covers post-registration tamper
  }
  let parsed: { schema?: unknown; binds?: { path?: unknown; sha256?: unknown } };
  try {
    parsed = JSON.parse(content) as { schema?: unknown; binds?: { path?: unknown; sha256?: unknown } };
  } catch {
    return false; // not JSON (the metadata sidecar IS JSON, but a stray text artifact may not be) — skip
  }
  if (parsed.schema !== CAPTURE_TRANSCRIPT_SCHEMA) {
    return false; // the bundle's metadata sidecar (or some other capture_transcript-tagged blob), not the body
  }
  const binds = parsed.binds;
  if (binds === undefined || typeof binds.path !== "string" || typeof binds.sha256 !== "string") {
    errors.push(`capture_transcript missing a bound-artifact reference: ${label}`);
    return true;
  }
  const bound = artifactsByRef.get(normalizeEvidenceRef(binds.path));
  if (bound === undefined) {
    errors.push(`capture_transcript binds an unregistered artifact: ${label} -> ${binds.path}`);
    return true;
  }
  if (bound.sha256 !== undefined && bound.sha256 !== binds.sha256) {
    errors.push(`capture_transcript bound-artifact digest mismatch (transcript inconsistent with registered bytes): ${label} -> ${binds.path}`);
  }
  return true;
}

function isTextGroundableKind(kind: EvidenceKind | undefined): boolean {
  return kind === "page_text" || kind === "page_html" || kind === "ocr_text" || kind === "transcript_cue" || kind === "audio_transcription" || kind === "structured_data";
}

async function readArtifactText(runDir: string, artifact: ArtifactLedgerRow | undefined): Promise<string | undefined> {
  if (artifact?.path === undefined) {
    return undefined;
  }
  try {
    return await readFile(join(runDir, artifact.path), "utf8");
  } catch {
    return undefined;
  }
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenizeForMatch(value: string): string[] {
  return normalizeForMatch(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

// Smallest character window in `content` that contains an occurrence of EVERY token (a classic
// minimum-window cover). Infinity if any token is absent. Used to measure how scattered an
// aggregated claim's supporting tokens are (a proxy for likely recombination).
function minWindowCoverChars(content: string, tokens: string[]): number {
  const occurrences: Array<{ start: number; end: number; token: number }> = [];
  tokens.forEach((token, tokenIndex) => {
    let index = content.indexOf(token);
    while (index !== -1) {
      occurrences.push({ start: index, end: index + token.length, token: tokenIndex });
      index = content.indexOf(token, index + 1);
    }
  });
  if (occurrences.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  occurrences.sort((a, b) => a.start - b.start);
  const need = new Set(tokens.map((_, i) => i)).size;
  const counts = new Map<number, number>();
  let have = 0;
  let best = Number.POSITIVE_INFINITY;
  let left = 0;
  for (let right = 0; right < occurrences.length; right += 1) {
    const tokenIndex = occurrences[right]?.token ?? 0;
    counts.set(tokenIndex, (counts.get(tokenIndex) ?? 0) + 1);
    if (counts.get(tokenIndex) === 1) {
      have += 1;
    }
    while (have === need) {
      const windowStart = occurrences[left]?.start ?? 0;
      best = Math.min(best, (occurrences[right]?.end ?? 0) - windowStart);
      const leftToken = occurrences[left]?.token ?? 0;
      counts.set(leftToken, (counts.get(leftToken) ?? 0) - 1);
      if (counts.get(leftToken) === 0) {
        have -= 1;
      }
      left += 1;
    }
  }
  return best;
}

async function readJsonl<T>(path: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }

  // Tolerate a malformed line (skip it) rather than throwing the whole gate: the gate re-verifies
  // UNTRUSTED run directories, so a single corrupt byte in a ledger must not crash verification. A
  // wholesale-corrupt ledger yields [] (e.g. no claims -> the final gate fails on minClaims), so this
  // never lets a bad run pass.
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return undefined;
      }
    })
    .filter((row): row is T => row !== undefined);
}

function normalizeEvidenceRef(value: string): string {
  return value.split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? value.trim();
}

function citationEvidenceRef(citation: CitationLedgerRow): string | undefined {
  return citation.evidence ?? citation.artifact_id;
}

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}
