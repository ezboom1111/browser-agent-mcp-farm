import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";
import {
  buildBundleManifest,
  exportBundleArchive,
  merkleRoot,
  signManifest,
  verifyBundle,
  verifyBundleArchive,
  verifyManifestSignature
} from "../src/evidence-bundle.js";

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function makeRun(): Promise<{ runDir: string; textPath: string }> {
  const runDir = await mkdtemp(join(tmpdir(), "farm-bundle-"));
  dirs.push(runDir);
  const writer = new ArtifactWriter();
  const records = await writer.writeCaptureBundle({
    runDir, sourceUrl: "https://example.com/", contextToken: "ctx", pageId: "p", captureId: "c", text: "evidence one"
  });
  const textRecord = records.find((record) => record.kind === "text");
  if (!textRecord) {
    throw new Error("expected a text artifact");
  }
  return { runDir, textPath: textRecord.path };
}

function ed25519Pem(): { privPem: string; pubPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    pubPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

describe("evidence-bundle", () => {
  it("builds a manifest and verifies an intact run", async () => {
    const { runDir } = await makeRun();
    const manifest = await buildBundleManifest(runDir);
    expect(manifest.artifactCount).toBeGreaterThan(0);
    expect(manifest.merkleRoot).toMatch(/^[0-9a-f]{64}$/);

    const result = await verifyBundle(runDir, manifest);
    expect(result.ok).toBe(true);
    expect(result.merkleMatches).toBe(true);
    expect(result.tamperedArtifacts).toEqual([]);
    expect(result.missingArtifacts).toEqual([]);
  });

  it("detects a tampered artifact file", async () => {
    const { runDir, textPath } = await makeRun();
    const manifest = await buildBundleManifest(runDir);
    await writeFile(join(runDir, textPath), "TAMPERED", "utf8");

    const result = await verifyBundle(runDir, manifest);
    expect(result.ok).toBe(false);
    expect(result.tamperedArtifacts.length).toBeGreaterThan(0);
  });

  it("detects a tampered manifest (Merkle mismatch)", async () => {
    const { runDir } = await makeRun();
    const manifest = await buildBundleManifest(runDir);
    const forged = {
      ...manifest,
      artifacts: manifest.artifacts.map((artifact, index) =>
        index === 0 ? { ...artifact, sha256: "0".repeat(64) } : artifact)
    };

    const result = await verifyBundle(runDir, forged);
    expect(result.merkleMatches).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("signs and verifies with Ed25519, and rejects the wrong key", async () => {
    const { runDir } = await makeRun();
    const manifest = await buildBundleManifest(runDir);
    const { privPem, pubPem } = ed25519Pem();
    manifest.signature = signManifest(manifest, privPem);

    const result = await verifyBundle(runDir, manifest, pubPem);
    expect(result.signatureValid).toBe(true);
    expect(result.ok).toBe(true);

    const other = ed25519Pem();
    expect(verifyManifestSignature(manifest.merkleRoot, manifest.signature, other.pubPem)).toBe(false);
  });

  it("merkleRoot is deterministic and input-sensitive", () => {
    expect(merkleRoot(["a", "b"])).toBe(merkleRoot(["a", "b"]));
    expect(merkleRoot(["a", "b"])).not.toBe(merkleRoot(["a", "c"]));
  });
});

describe("evidence-bundle self-contained archive (.evb)", () => {
  it("verifies a signed archive FULLY OFFLINE after the runDir is deleted", async () => {
    const { runDir } = await makeRun();
    const { privPem, pubPem } = ed25519Pem();
    const archive = await exportBundleArchive(runDir, { privateKeyPem: privPem });

    expect(archive.format).toBe("evb-1");
    expect(Object.keys(archive.files).length).toBeGreaterThan(0);

    // Remove the original run entirely — the archive must still verify on its own.
    await rm(runDir, { recursive: true, force: true });

    const result = verifyBundleArchive(archive, pubPem);
    expect(result.ok).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.merkleMatches).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.tamperedArtifacts).toEqual([]);
  });

  it("detects a tampered embedded artifact", async () => {
    const { runDir } = await makeRun();
    const archive = await exportBundleArchive(runDir);
    const [firstPath] = Object.keys(archive.files);
    if (firstPath === undefined) {
      throw new Error("expected an embedded file");
    }
    archive.files[firstPath] = Buffer.from("tampered bytes").toString("base64");

    const result = verifyBundleArchive(archive);
    expect(result.ok).toBe(false);
    expect(result.tamperedArtifacts.length).toBeGreaterThan(0);
  });

  it("rejects an archive verified with the wrong public key", async () => {
    const { runDir } = await makeRun();
    const { privPem } = ed25519Pem();
    const archive = await exportBundleArchive(runDir, { privateKeyPem: privPem });

    const other = ed25519Pem();
    const result = verifyBundleArchive(archive, other.pubPem);
    expect(result.signatureValid).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("flags incompleteness when a file exceeds the embed size cap", async () => {
    const { runDir } = await makeRun();
    const archive = await exportBundleArchive(runDir, { maxFileBytes: 1 });
    expect(archive.omitted.length).toBeGreaterThan(0);

    const result = verifyBundleArchive(archive);
    expect(result.complete).toBe(false);
    expect(result.missingArtifacts.length).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });
});
