import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Verifiable evidence bundle (master-plan P5, down-scoped honestly): a manifest
// over a run's artifacts carrying a Merkle root of their SHA-256 hashes and an
// optional Ed25519 signature. verifyBundle re-reads the artifacts in place and
// re-hashes them, so it detects BOTH a tampered file (byte != recorded hash) and
// a tampered manifest (recomputed Merkle root != claimed root). The bytes stay in
// the runDir (this is manifest-over-runDir, not a self-contained zip yet), and the
// check needs no network — a second agent can verify a run it has on disk.

export interface BundleArtifact {
  artifact_id: string;
  path?: string;
  sha256: string;
}

export interface BundleManifest {
  version: 1;
  artifactCount: number;
  artifacts: BundleArtifact[];
  merkleRoot: string;
  claimCount: number;
  citationCount: number;
  signature?: string;
}

export interface BundleVerification {
  ok: boolean;
  merkleMatches: boolean;
  tamperedArtifacts: string[];
  missingArtifacts: string[];
  signatureValid?: boolean;
}

// A self-contained `.evb` archive: the manifest PLUS the artifact bytes embedded as
// base64, so one cooperating second agent can verify it FULLY OFFLINE — no runDir, no
// network. Files over a size cap are omitted (recorded in `omitted`); their hashes stay
// in the manifest but they are not offline-verifiable, so the verifier flags `complete`.
export interface BundleArchive {
  format: "evb-1";
  manifest: BundleManifest;
  files: Record<string, string>;
  omitted: Array<{ path: string; reason: string }>;
}

export interface BundleArchiveVerification {
  ok: boolean;
  merkleMatches: boolean;
  tamperedArtifacts: string[];
  missingArtifacts: string[];
  complete: boolean;
  signatureValid?: boolean;
}

const DEFAULT_MAX_EMBED_BYTES = 25 * 1024 * 1024;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** Merkle root over the leaf hashes; duplicates the last node on odd levels. */
export function merkleRoot(leafValues: string[]): string {
  if (leafValues.length === 0) {
    return sha256Hex("");
  }
  let level = leafValues.map((value) => sha256Hex(value));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as string;
      const right = level[i + 1] ?? left;
      next.push(sha256Hex(`${left}${right}`));
    }
    level = next;
  }
  return level[0] as string;
}

async function readJsonlRows(path: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })
    .filter((row): row is Record<string, unknown> => row !== undefined);
}

export async function buildBundleManifest(runDir: string): Promise<BundleManifest> {
  const artifactRows = await readJsonlRows(join(runDir, "artifacts.jsonl"));
  const artifacts: BundleArtifact[] = artifactRows
    .filter((row) => typeof row.artifact_id === "string" && typeof row.sha256 === "string")
    .map((row) => {
      const artifact: BundleArtifact = { artifact_id: row.artifact_id as string, sha256: row.sha256 as string };
      if (typeof row.path === "string") {
        artifact.path = row.path;
      }
      return artifact;
    })
    // Sort for a deterministic Merkle root regardless of ledger order.
    .sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));

  const claimCount = (await readJsonlRows(join(runDir, "claims.jsonl"))).length;
  const citationCount = (await readJsonlRows(join(runDir, "citations.jsonl"))).length;

  return {
    version: 1,
    artifactCount: artifacts.length,
    artifacts,
    merkleRoot: merkleRoot(artifacts.map((artifact) => artifact.sha256)),
    claimCount,
    citationCount
  };
}

// Build a self-contained archive: manifest + embedded artifact bytes (base64), signed
// if a private key is supplied. Large files are omitted with a recorded reason.
export async function exportBundleArchive(runDir: string, options: { privateKeyPem?: string; maxFileBytes?: number } = {}): Promise<BundleArchive> {
  const manifest = await buildBundleManifest(runDir);
  if (options.privateKeyPem !== undefined && options.privateKeyPem.length > 0) {
    manifest.signature = signManifest(manifest, options.privateKeyPem);
  }

  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_EMBED_BYTES;
  const files: Record<string, string> = {};
  const omitted: Array<{ path: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (artifact.path === undefined || seen.has(artifact.path)) {
      continue;
    }
    seen.add(artifact.path);
    let bytes: Buffer;
    try {
      bytes = await readFile(join(runDir, artifact.path));
    } catch {
      omitted.push({ path: artifact.path, reason: "unreadable" });
      continue;
    }
    if (bytes.length > maxBytes) {
      omitted.push({ path: artifact.path, reason: "too_large" });
      continue;
    }
    files[artifact.path] = bytes.toString("base64");
  }

  return { format: "evb-1", manifest, files, omitted };
}

// Verify a self-contained archive offline: re-hash each embedded artifact, recompute the
// Merkle root over the manifest hashes, and (if a public key is given) check the
// signature. No runDir, no network.
export function verifyBundleArchive(archive: BundleArchive, publicKeyPem?: string): BundleArchiveVerification {
  const tamperedArtifacts: string[] = [];
  const missingArtifacts: string[] = [];
  for (const artifact of archive.manifest.artifacts) {
    if (artifact.path === undefined) {
      missingArtifacts.push(artifact.artifact_id);
      continue;
    }
    const embedded = archive.files[artifact.path];
    if (embedded === undefined) {
      missingArtifacts.push(artifact.artifact_id);
      continue;
    }
    const recomputed = createHash("sha256").update(Buffer.from(embedded, "base64")).digest("hex");
    if (recomputed !== artifact.sha256) {
      tamperedArtifacts.push(artifact.artifact_id);
    }
  }

  const merkleMatches = merkleRoot(archive.manifest.artifacts.map((artifact) => artifact.sha256)) === archive.manifest.merkleRoot;

  let signatureValid: boolean | undefined;
  if (archive.manifest.signature !== undefined && publicKeyPem !== undefined) {
    signatureValid = verifyManifestSignature(archive.manifest.merkleRoot, archive.manifest.signature, publicKeyPem);
  }

  const complete = missingArtifacts.length === 0;
  const ok = tamperedArtifacts.length === 0 && complete && merkleMatches && signatureValid !== false;
  const verification: BundleArchiveVerification = { ok, merkleMatches, tamperedArtifacts, missingArtifacts, complete };
  if (signatureValid !== undefined) {
    verification.signatureValid = signatureValid;
  }
  return verification;
}

export function signManifest(manifest: BundleManifest, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  // Ed25519 uses a null digest algorithm.
  return sign(null, Buffer.from(manifest.merkleRoot, "utf8"), key).toString("base64");
}

export function verifyManifestSignature(merkleRootValue: string, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(null, Buffer.from(merkleRootValue, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

export async function verifyBundle(runDir: string, manifest: BundleManifest, publicKeyPem?: string): Promise<BundleVerification> {
  const tamperedArtifacts: string[] = [];
  const missingArtifacts: string[] = [];
  for (const artifact of manifest.artifacts) {
    if (artifact.path === undefined) {
      missingArtifacts.push(artifact.artifact_id);
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(join(runDir, artifact.path));
    } catch {
      missingArtifacts.push(artifact.artifact_id);
      continue;
    }
    const recomputed = createHash("sha256").update(bytes).digest("hex");
    if (recomputed !== artifact.sha256) {
      tamperedArtifacts.push(artifact.artifact_id);
    }
  }

  const merkleMatches = merkleRoot(manifest.artifacts.map((artifact) => artifact.sha256)) === manifest.merkleRoot;

  let signatureValid: boolean | undefined;
  if (manifest.signature !== undefined && publicKeyPem !== undefined) {
    signatureValid = verifyManifestSignature(manifest.merkleRoot, manifest.signature, publicKeyPem);
  }

  const ok = tamperedArtifacts.length === 0 && missingArtifacts.length === 0 && merkleMatches && signatureValid !== false;

  const verification: BundleVerification = { ok, merkleMatches, tamperedArtifacts, missingArtifacts };
  if (signatureValid !== undefined) {
    verification.signatureValid = signatureValid;
  }
  return verification;
}
