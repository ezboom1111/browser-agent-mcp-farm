// Worked agent-to-agent verifiable exchange (master-plan P5 M8). Demonstrates the
// trust handoff the .evb archive enables: Agent A captures evidence and seals a signed,
// self-contained bundle; Agent B — given ONLY the bundle bytes and A's PUBLIC key, never
// A's runDir, browser, or private key — verifies it FULLY OFFLINE and trusts the hashes,
// not the producer. B accepts a genuine bundle and rejects a forged or tampered one.

import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactWriter } from "../src/artifact-writer.js";
import { exportBundleArchive, verifyBundleArchive, type BundleArchive } from "../src/evidence-bundle.js";

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

function keypair(): { privPem: string; pubPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    pubPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

// Agent A: capture evidence into its own run and seal a signed, self-contained bundle.
async function agentAProducesBundle(privPem: string): Promise<BundleArchive> {
  const runDir = await mkdtemp(join(tmpdir(), "agent-a-run-"));
  dirs.push(runDir);
  const writer = new ArtifactWriter();
  await writer.writeCaptureBundle({
    runDir, sourceUrl: "https://example.com/menu", contextToken: "ctxA", pageId: "pA", captureId: "a1",
    text: "Latte — 4500 KRW"
  });
  const archive = await exportBundleArchive(runDir, { privateKeyPem: privPem });
  // A's run is then discarded; only the bundle travels to B.
  await rm(runDir, { recursive: true, force: true });
  dirs = dirs.filter((dir) => dir !== runDir);
  return archive;
}

// Agent B: receives only the serialized bundle bytes + A's public key.
function agentBReceives(serialized: string): BundleArchive {
  return JSON.parse(serialized) as BundleArchive;
}

describe("agent-to-agent .evb exchange", () => {
  it("Agent B verifies Agent A's signed bundle offline, trusting hashes not the producer", async () => {
    const a = keypair();
    const bundle = await agentAProducesBundle(a.privPem);

    // Only these two values cross the wire — no runDir, no browser, no private key.
    const onWire = JSON.stringify(bundle);
    const aPublicKey = a.pubPem;

    const received = agentBReceives(onWire);
    const verdict = verifyBundleArchive(received, aPublicKey);
    expect(verdict.ok).toBe(true);
    expect(verdict.complete).toBe(true);
    expect(verdict.signatureValid).toBe(true);
    expect(verdict.tamperedArtifacts).toEqual([]);
  });

  it("Agent B rejects a bundle whose evidence bytes were altered in transit", async () => {
    const a = keypair();
    const bundle = await agentAProducesBundle(a.privPem);

    const received = agentBReceives(JSON.stringify(bundle));
    const [firstPath] = Object.keys(received.files);
    received.files[firstPath as string] = Buffer.from("man-in-the-middle edit").toString("base64");

    const verdict = verifyBundleArchive(received, a.pubPem);
    expect(verdict.ok).toBe(false);
    expect(verdict.tamperedArtifacts.length).toBeGreaterThan(0);
  });

  it("Agent B rejects a bundle signed by an impostor key", async () => {
    const impostor = keypair();
    const bundle = await agentAProducesBundle(impostor.privPem);

    const aExpectedKey = keypair().pubPem; // B only trusts A's real key
    const verdict = verifyBundleArchive(agentBReceives(JSON.stringify(bundle)), aExpectedKey);
    expect(verdict.signatureValid).toBe(false);
    expect(verdict.ok).toBe(false);
  });
});
