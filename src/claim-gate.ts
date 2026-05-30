import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ClaimTypeSchema, EvidenceKindSchema, type ClaimType, type EvidenceKind } from "./schemas.js";

interface ArtifactLedgerRow {
  artifact_id?: string;
  path?: string;
  sha256?: string;
  kind?: string;
  evidence_kind?: EvidenceKind;
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
  };
  errors: string[];
  warnings: string[];
}

export interface ClaimGateOptions {
  mode?: "smoke" | "final";
  minClaims?: number;
}

export async function runClaimGate(runDir: string, options: ClaimGateOptions = {}): Promise<ClaimGateResult> {
  const mode = options.mode ?? "smoke";
  const minClaims = options.minClaims ?? (mode === "final" ? 1 : 0);
  const artifacts = await readJsonl<ArtifactLedgerRow>(join(runDir, "artifacts.jsonl"));
  const claims = await readJsonl<ClaimLedgerRow>(join(runDir, "claims.jsonl"));
  const citations = await readJsonl<CitationLedgerRow>(join(runDir, "citations.jsonl"));
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

  const citationIds = new Set(citations.map((citation) => citation.claim_id).filter((value): value is string => Boolean(value)));
  const citationRefs = new Set<string>();
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
    citationRefs.add(`${citation.claim_id}\u0000${normalizedRef}`);
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

    if (claim.claim_id && !citationIds.has(claim.claim_id)) {
      errors.push(`claim has no matching citation: ${claim.claim_id}`);
    }
    if (claim.claim_id && claim.evidence && citationRefs.size > 0 && !citationRefs.has(`${claim.claim_id}\u0000${normalizeEvidenceRef(claim.evidence)}`)) {
      errors.push(`claim citation does not match evidence: ${claim.claim_id} -> ${claim.evidence}`);
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
    } else {
      validateSmokeTypedClaim(claim, artifact, claimLabel, warnings);
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
      citations: citations.length
    },
    errors,
    warnings
  };
}

function validateSmokeTypedClaim(
  claim: ClaimLedgerRow,
  artifact: ArtifactLedgerRow | undefined,
  claimLabel: string,
  warnings: string[]
): void {
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

function validateTypedClaim(
  claim: ClaimLedgerRow,
  artifact: ArtifactLedgerRow | undefined,
  claimLabel: string,
  errors: string[]
): void {
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
    errors.push(`audio claim must cite an audio transcription artifact: ${claimLabel}`);
  }
}

function validateDestinationProvenanceClaim(
  claim: ClaimLedgerRow,
  citations: CitationEvidence[] | undefined,
  claimLabel: string,
  errors: string[]
): void {
  const requiredKinds = requiredDestinationProvenanceKinds(claim.evidence_kind);
  if (requiredKinds.length === 0) {
    return;
  }
  const citedKinds = new Set((citations ?? [])
    .map((citation) => citation.evidenceKind)
    .filter((value): value is EvidenceKind => value !== undefined));
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

async function readJsonl<T>(path: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
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
