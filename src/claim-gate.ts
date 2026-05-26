import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface ArtifactLedgerRow {
  artifact_id?: string;
  path?: string;
  sha256?: string;
}

interface ClaimLedgerRow {
  claim_id?: string;
  claim?: string;
  evidence?: string;
}

interface CitationLedgerRow {
  claim_id?: string;
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

  for (const artifact of artifacts) {
    if (artifact.artifact_id) {
      registeredIds.add(artifact.artifact_id);
    }
    if (artifact.path) {
      registeredPaths.add(artifact.path);
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

  for (const claim of claims) {
    const claimLabel = claim.claim_id ?? claim.claim ?? "unknown claim";
    if (!claim.evidence) {
      errors.push(`claim has no evidence: ${claimLabel}`);
      continue;
    }

    if (claim.claim_id && !citationIds.has(claim.claim_id)) {
      errors.push(`claim has no matching citation: ${claim.claim_id}`);
    }

    const evidenceRef = normalizeEvidenceRef(claim.evidence);
    if (registeredIds.has(evidenceRef) || registeredPaths.has(evidenceRef)) {
      continue;
    }

    errors.push(`claim evidence is not registered: ${claimLabel} -> ${claim.evidence}`);
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

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}
