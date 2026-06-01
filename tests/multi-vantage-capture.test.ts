import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactWriter } from "../src/artifact-writer.js";
import { LeaseManager, isBareEphemeralLease, type Lease } from "../src/lease-manager.js";
import { captureMultiVantage, type VantageCaptureFn, type VantageSpec } from "../src/multi-vantage-capture.js";

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function freshRun(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "farm-mv-"));
  dirs.push(dir);
  return dir;
}

const BASE = "The Aurora wireless headphones deliver forty hours of battery life with active noise cancellation tuned for open offices and long flights, shipping worldwide with a two year limited warranty and free returns.";
const withPrice = (p: string): string => `${BASE} The current price is ${p} including tax.`;

const VANTAGES: VantageSpec[] = [
  { vantageId: "eu-west", proxy: { server: "http://eu.proxy.example:8080", username: "euuser", password: "eusecret" } },
  { vantageId: "us-east", proxy: { server: "http://us.proxy.example:8080", username: "ususer", password: "ussecret" } },
  { vantageId: "ap-south", proxy: { server: "http://ap.proxy.example:8080", username: "apuser", password: "apsecret" } }
];

async function readAgreementArtifact(runDir: string, records: { evidence_kind?: string; path: string }[]): Promise<{ raw: string; parsed: Record<string, unknown> }> {
  const rec = records.find((r) => r.evidence_kind === "multi_vantage_agreement" && r.path.endsWith(".txt"));
  const raw = await readFile(join(runDir, rec?.path as string), "utf8");
  return { raw, parsed: JSON.parse(raw) as Record<string, unknown> };
}

const ON = { FARM_ENABLE_MULTI_VANTAGE: "1" } as NodeJS.ProcessEnv;

describe("multi-vantage capture orchestrator (D4)", () => {
  it("is fail-closed: disabled unless FARM_ENABLE_MULTI_VANTAGE=1", async () => {
    const runDir = await freshRun();
    const capture: VantageCaptureFn = async () => ({ text: withPrice("$899") });
    const result = await captureMultiVantage({ runDir, url: "https://shop.example/p", vantages: VANTAGES, capture, env: {} as NodeJS.ProcessEnv });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/disabled/);
    expect(result.records).toEqual([]);
  });

  it("fans the url across proxied leases, agrees, and writes a hash-registered artifact", async () => {
    const runDir = await freshRun();
    const proxiedLeases: Lease[] = [];
    const capture: VantageCaptureFn = async ({ lease }) => {
      proxiedLeases.push(lease);
      return { text: withPrice("$899"), status: 200 };
    };
    const result = await captureMultiVantage({ runDir, url: "https://shop.example/p", vantages: VANTAGES, capture, writer: new ArtifactWriter(), env: ON });

    expect(result.ok).toBe(true);
    expect(result.agreement?.verdict).toBe("agreed");
    expect(result.agreement?.successfulVantages).toBe(3);

    // One proxied lease per vantage, each carrying the real proxy (so it actually routes)...
    expect(proxiedLeases).toHaveLength(3);
    expect(proxiedLeases.map((l) => l.proxy?.server).sort()).toEqual(["http://ap.proxy.example:8080", "http://eu.proxy.example:8080", "http://us.proxy.example:8080"]);
    // ...and a proxied lease is NOT bare-ephemeral, so the C4 capture-cache never replays it (gate invariant).
    for (const lease of proxiedLeases) {
      expect(isBareEphemeralLease(lease)).toBe(false);
    }

    const rec = result.records.find((r) => r.evidence_kind === "multi_vantage_agreement" && r.path.endsWith(".txt"));
    expect(rec?.sha256).toMatch(/^[0-9a-f]{64}$/); // hash-registered
  });

  it("never writes proxy credentials to the artifact (redacted only)", async () => {
    const runDir = await freshRun();
    const capture: VantageCaptureFn = async () => ({ text: withPrice("$899") });
    const result = await captureMultiVantage({ runDir, url: "https://shop.example/p", vantages: VANTAGES, capture, env: ON });
    const { raw, parsed } = await readAgreementArtifact(runDir, result.records);

    // No secret anywhere in the serialized artifact.
    expect(raw).not.toContain("eusecret");
    expect(raw).not.toContain("ussecret");
    expect(raw).not.toContain("apsecret");
    expect(raw).not.toContain("euuser");
    const vantages = parsed.vantages as Array<{ vantageId: string; proxy: { username?: string; password?: string; server: string } }>;
    expect(vantages.every((v) => v.proxy.password === "***" || v.proxy.password === undefined)).toBe(true);
    expect(vantages.every((v) => v.proxy.username === "***" || v.proxy.username === undefined)).toBe(true);
  });

  it("flags 'split' and records the divergent vantage on price discrimination", async () => {
    const runDir = await freshRun();
    const priceByVantage: Record<string, string> = { "eu-west": "$899", "us-east": "$899", "ap-south": "$799" };
    const capture: VantageCaptureFn = async ({ vantageId }) => ({ text: withPrice(priceByVantage[vantageId] ?? "$899") });
    const result = await captureMultiVantage({ runDir, url: "https://shop.example/p", vantages: VANTAGES, capture, env: ON });

    expect(result.agreement?.verdict).toBe("split");
    const price = result.agreement?.facts.find((f) => f.kind === "price");
    expect(price?.distinctValues).toEqual(["799", "899"]);
    const { parsed } = await readAgreementArtifact(runDir, result.records);
    expect((parsed.agreement as { verdict: string }).verdict).toBe("split");
  });

  it("treats a capture error as a failed vantage (excluded from quorum, surfaced)", async () => {
    const runDir = await freshRun();
    const capture: VantageCaptureFn = async ({ vantageId }) => (vantageId === "ap-south" ? { error: "tier-0 declined: http 403" } : { text: withPrice("$899") });
    const result = await captureMultiVantage({ runDir, url: "https://shop.example/p", vantages: VANTAGES, capture, env: ON });

    expect(result.ok).toBe(true);
    expect(result.agreement?.successfulVantages).toBe(2);
    expect(result.agreement?.failedVantageIds).toEqual(["ap-south"]);
    expect(result.agreement?.verdict).toBe("agreed"); // the two reachable vantages agree
  });

  it("a thrown capture does not abort the run (fail-closed per vantage)", async () => {
    const runDir = await freshRun();
    const capture: VantageCaptureFn = async ({ vantageId }) => {
      if (vantageId === "us-east") {
        throw new Error("proxy connection refused");
      }
      return { text: withPrice("$899") };
    };
    const result = await captureMultiVantage({ runDir, url: "https://shop.example/p", vantages: VANTAGES, capture, env: ON });
    expect(result.ok).toBe(true);
    expect(result.agreement?.failedVantageIds).toEqual(["us-east"]);
  });

  it("rejects fewer than 2 vantages and duplicate vantage ids", async () => {
    const runDir = await freshRun();
    const capture: VantageCaptureFn = async () => ({ text: withPrice("$899") });
    const tooFew = await captureMultiVantage({ runDir, url: "https://shop.example/p", vantages: [VANTAGES[0] as VantageSpec], capture, env: ON });
    expect(tooFew.ok).toBe(false);
    expect(tooFew.reason).toMatch(/at least 2/);

    const dup = await captureMultiVantage({ runDir, url: "https://shop.example/p", vantages: [VANTAGES[0] as VantageSpec, VANTAGES[0] as VantageSpec], capture, env: ON });
    expect(dup.ok).toBe(false);
    expect(dup.reason).toMatch(/duplicate/);
  });

  it("releases every lease (no capacity leak across vantages)", async () => {
    const runDir = await freshRun();
    const leaseManager = new LeaseManager({ maxContexts: 1 }); // only 1 concurrent — proves each is released before the next
    const capture: VantageCaptureFn = async () => ({ text: withPrice("$899") });
    const result = await captureMultiVantage({ runDir, url: "https://shop.example/p", vantages: VANTAGES, capture, leaseManager, env: ON });
    expect(result.ok).toBe(true);
    expect(result.agreement?.successfulVantages).toBe(3); // all 3 ran despite maxContexts=1 => released each time
    expect(leaseManager.activeContextCount()).toBe(0);
  });
});
