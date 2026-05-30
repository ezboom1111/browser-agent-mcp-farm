import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FarmService } from "../src/farm-service.js";
import { LeaseManager } from "../src/lease-manager.js";

// Self-contained direct-API coverage for FarmService's NON-browser methods and
// error branches (heartbeat, reapExpired, readReport, listArtifacts, runClaimGate,
// readArtifact missing/not-found/base64, addClaim optional-field branches, listRuns
// empty/unreadable/populated, extractStructured runDir+path, exportBundle signed,
// verifyBundle publicKeyEnv + tamper, evidenceRun headed-throw, shutdown). NO real
// Chromium, NO network, NO writes to a real user dir — every path stays under
// os.tmpdir() and is cleaned up in afterEach. Mirrors the temp-root fixture from
// tests/farm-service.test.ts (replicated locally; nothing imported from a *.test.ts).

describe("FarmService non-browser methods and error branches", () => {
  let roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
    roots = [];
    delete process.env.FARM_TEST_PRIV;
    delete process.env.FARM_TEST_PUB;
  });

  async function newRun(): Promise<{ service: FarmService; root: string; runDir: string }> {
    const root = await mkdtemp(join(tmpdir(), "farm-svc-cov-"));
    roots.push(root);
    const runDir = join(root, "run-1");
    await mkdir(runDir, { recursive: true });
    return { service: new FarmService(), root, runDir };
  }

  // ---- listArtifacts ----

  it("listArtifacts returns ledger rows newest-first and filters by evidenceKind", async () => {
    const { service, runDir } = await newRun();
    await service.registerEvidence({ runDir, sourceUrl: "https://example.com/", text: "first", evidenceKind: "page_text" });
    await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/",
      text: "<html><title>T</title></html>",
      evidenceKind: "page_html"
    });

    const all = await service.listArtifacts({ runDir });
    expect(all.ok).toBe(true);
    expect(all.runDir).toBe(runDir);
    expect(all).toHaveProperty("total");
    expect(all).toHaveProperty("returned");
    expect(Array.isArray(all.artifacts)).toBe(true);
    expect(all.returned).toBe(all.artifacts.length);
    // 2 registrations -> each writes a text/html record plus a sibling metadata.json record.
    expect(all.total).toBeGreaterThanOrEqual(4);

    const onlyText = await service.listArtifacts({ runDir, evidenceKind: "page_text", limit: 5 });
    expect(onlyText.total).toBeGreaterThanOrEqual(1);
    expect(onlyText.returned).toBe(onlyText.artifacts.length);
    expect(onlyText.artifacts.every((row) => (row as { evidence_kind?: string }).evidence_kind === "page_text")).toBe(true);
    expect(onlyText.returned).toBeLessThanOrEqual(5);
  });

  it("listArtifacts on a runDir with no artifacts.jsonl returns empty totals", async () => {
    const { service, runDir } = await newRun();
    const result = await service.listArtifacts({ runDir });
    expect(result.ok).toBe(true);
    expect(result.total).toBe(0);
    expect(result.returned).toBe(0);
    expect(result.artifacts).toEqual([]);
    expect(result.runDir).toBe(runDir);
  });

  // ---- runClaimGate ----

  it("runClaimGate proxies to claim-gate and returns ClaimGateResult counts shape", async () => {
    const { service, runDir } = await newRun();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/",
      text: "The price was 4500 KRW.",
      evidenceKind: "page_text"
    });
    await service.addClaim({
      runDir,
      artifactId: reg.artifactId as string,
      claim: "price 4500",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      anchor: { type: "text_span", quote: "4500" }
    });

    const gate = await service.runClaimGate({ runDir, mode: "final", minClaims: 1 });
    expect(gate).toHaveProperty("ok");
    expect(gate).toHaveProperty("counts");
    expect(gate.counts).toMatchObject({
      artifacts: expect.any(Number),
      claims: expect.any(Number),
      citations: expect.any(Number)
    });
    expect(Array.isArray(gate.errors)).toBe(true);
    expect(Array.isArray(gate.warnings)).toBe(true);
    expect(gate.counts.claims).toBe(1);
    expect(gate.counts.citations).toBe(1);
    expect(gate.ok).toBe(true);
  });

  // ---- readReport ----

  it("readReport reads a written report file and echoes path + content", async () => {
    const { service, runDir } = await newRun();
    const reportPath = join(runDir, "reports", "final.md");
    await mkdir(join(runDir, "reports"), { recursive: true });
    await writeFile(reportPath, "# Evidence Report\nbody", "utf8");

    const result = await service.readReport({ reportPath });
    expect(result.ok).toBe(true);
    expect(result.reportPath).toBe(reportPath);
    expect(result.content).toContain("# Evidence Report");
    expect(result.content).toContain("body");
  });

  // ---- readArtifact error/encoding branches ----

  it("readArtifact reports missingOnDisk when the ledger row's file is deleted", async () => {
    const { service, runDir } = await newRun();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/",
      text: "gone",
      evidenceKind: "page_text"
    });
    await rm(join(runDir, reg.path as string), { force: true });

    const read = await service.readArtifact({ runDir, artifactId: reg.artifactId as string });
    expect(read.ok).toBe(false);
    expect(read.found).toBe(true);
    expect((read as { missingOnDisk?: boolean }).missingOnDisk).toBe(true);
    expect((read as { path?: string }).path).toBe(reg.path);
  });

  it("readArtifact returns not-found for an unknown artifactId", async () => {
    const { service, runDir } = await newRun();
    await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/",
      text: "present",
      evidenceKind: "page_text"
    });

    const read = await service.readArtifact({ runDir, artifactId: "does-not-exist" });
    expect(read.ok).toBe(false);
    expect(read.found).toBe(false);
    expect((read as { runDir?: string }).runDir).toBe(runDir);
  });

  it("readArtifact returns base64-encoded content for a non-text evidence kind", async () => {
    const { service, runDir } = await newRun();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/",
      text: "binary-ish",
      evidenceKind: "media"
    });

    const read = await service.readArtifact({ runDir, artifactId: reg.artifactId as string });
    expect(read.found).toBe(true);
    expect((read as { encoding?: string }).encoding).toBe("base64");
    expect((read as { tampered?: boolean }).tampered).toBe(false);
    expect(read.ok).toBe(true);
    const content = (read as { content?: string }).content ?? "";
    expect(Buffer.from(content, "base64").toString("utf8")).toBe("binary-ish");
  });

  // ---- addClaim optional-field branches ----

  it("addClaim records optional anchor + claimTaxonomy branches for a derived claim", async () => {
    const { service, runDir } = await newRun();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/",
      text: "alpha beta gamma 4500",
      evidenceKind: "page_text"
    });

    const result = await service.addClaim({
      runDir,
      artifactId: reg.artifactId as string,
      claim: "mentions alpha and 4500",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      claimTaxonomy: "derived",
      anchor: { type: "text_span", quote: "alpha 4500", normalizedTokens: ["alpha", "4500"] }
    });
    expect(result.appended).toBe(true);
    expect(result.ok).toBe(true);
    expect((result as { claimId?: string }).claimId).toMatch(/^claim-/);
    expect((result as { gate?: unknown }).gate).toHaveProperty("ok");
    expect((result as { gate: { ok: boolean } }).gate.ok).toBe(true);
  });

  // ---- listRuns: empty / unreadable / populated ----

  it("listRuns on an empty root returns an empty runs list", async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), "farm-svc-empty-"));
    roots.push(emptyRoot);

    const result = await new FarmService().listRuns({ runRoot: emptyRoot, limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.runRoot).toBe(emptyRoot);
    expect(result.runs).toEqual([]);
  });

  it("listRuns on a non-existent root swallows the readdir error and returns empty", async () => {
    const missing = join(tmpdir(), `farm-svc-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);

    const result = await new FarmService().listRuns({ runRoot: missing, limit: 5 });
    expect(result.ok).toBe(true);
    expect(result.runRoot).toBe(missing);
    expect(result.runs).toEqual([]);
  });

  it("listRuns reports artifactCount/claimCount/hasReport for a populated run", async () => {
    const { service, root, runDir } = await newRun();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/",
      text: "abc 4500",
      evidenceKind: "page_text"
    });
    await service.addClaim({
      runDir,
      artifactId: reg.artifactId as string,
      claim: "abc 4500",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      anchor: { type: "text_span", quote: "4500" }
    });
    await mkdir(join(runDir, "reports"), { recursive: true });

    const result = await service.listRuns({ runRoot: root, limit: 10 });
    const found = result.runs.find((run) => run.runDir === runDir);
    expect(found).toBeDefined();
    expect(found?.artifactCount).toBeGreaterThanOrEqual(2);
    expect(found?.claimCount).toBe(1);
    expect(found?.hasReport).toBe(true);
  });

  // ---- extractStructured via runDir + path ----

  it("extractStructured loads HTML from a registered artifact via runDir + path", async () => {
    const { service, runDir } = await newRun();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/",
      text: '<html><head><title>Cafe</title><script type="application/ld+json">{"@type":"Product","name":"Latte","offers":{"price":"4500","priceCurrency":"KRW"}}</script></head></html>',
      evidenceKind: "page_html"
    });

    const result = await service.extractStructured({ runDir, path: reg.path as string });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.price?.value).toBe("4500");
      expect(result.title).toBe("Cafe");
      expect(result.note).toContain("Publisher markup");
    }
  });

  it("extractStructured returns an error when HTML cannot be loaded", async () => {
    const { service, runDir } = await newRun();
    const result = await service.extractStructured({ runDir, artifactId: "missing-artifact" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("could not load HTML (provide html, or a valid runDir + artifactId/path)");
    }
  });

  // ---- exportBundle signed + verifyBundle ----

  it("exportBundle signs the manifest when privateKeyEnv is set; verifyBundle validates the signature", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    process.env.FARM_TEST_PRIV = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.FARM_TEST_PUB = publicKey.export({ type: "spki", format: "pem" }).toString();

    const { service, runDir } = await newRun();
    await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/",
      text: "signed evidence",
      evidenceKind: "page_text"
    });

    const exported = await service.exportBundle({ runDir, privateKeyEnv: "FARM_TEST_PRIV" });
    expect(exported.ok).toBe(true);
    expect(exported.signed).toBe(true);
    expect(exported.manifest.signature).toBeTypeOf("string");
    expect(exported.manifest.version).toBe(1);
    expect(exported.manifest).toHaveProperty("merkleRoot");

    const verified = await service.verifyBundle({ runDir, manifest: exported.manifest, publicKeyEnv: "FARM_TEST_PUB" });
    expect(verified.ok).toBe(true);
    expect(verified.merkleMatches).toBe(true);
    expect(verified.signatureValid).toBe(true);
    expect(verified.tamperedArtifacts).toEqual([]);
    expect(verified.missingArtifacts).toEqual([]);
  });

  it("verifyBundle flags a tampered artifact after export", async () => {
    const { service, runDir } = await newRun();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/",
      text: "original bytes",
      evidenceKind: "page_text"
    });
    const exported = await service.exportBundle({ runDir });
    await writeFile(join(runDir, reg.path as string), "tampered", "utf8");

    const verified = await service.verifyBundle({ runDir, manifest: exported.manifest });
    expect(verified.ok).toBe(false);
    expect(verified.tamperedArtifacts.length).toBeGreaterThan(0);
    expect(verified.merkleMatches).toBe(true);
  });

  // ---- heartbeat (no browser) ----

  it("heartbeat refreshes an acquired lease and returns a redacted lease", () => {
    const service = new FarmService();
    const { lease } = service.acquireContext({ agentId: "a", runId: "r", artifactRunDir: "/tmp/run" });

    const result = service.heartbeat({ agentId: "a", contextToken: lease.contextToken });
    expect(result.ok).toBe(true);
    expect(result.lease.contextToken).toBe(lease.contextToken);
    expect(result.lease).toHaveProperty("expiresAt");
    expect(result.lease).toHaveProperty("lastHeartbeatAt");
    expect(typeof result.lease.lastHeartbeatAt).toBe("string");
  });

  // ---- reapExpired (deterministic clock, no browser) ----

  it("reapExpired returns expired redacted leases for a short-TTL lease", async () => {
    let t = 0;
    const lm = new LeaseManager({ now: () => new Date(t) });
    const service = new FarmService(lm);
    service.acquireContext({ agentId: "a", runId: "r", artifactRunDir: "/tmp/run", ttlMs: 1000 });
    t = 5000;

    const result = await service.reapExpired();
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.expired)).toBe(true);
    expect(result.expired.length).toBe(1);
    expect(result.expired[0]).toHaveProperty("contextToken");
    expect(result.expired[0]?.status).toBe("expired");
  });

  // ---- evidenceRun headed-throw (no browser launched) ----

  it("evidenceRun rejects headed mode without launching a browser", async () => {
    const service = new FarmService();
    await expect(service.evidenceRun({ url: "http://127.0.0.1/", headed: true })).rejects.toThrow("headed evidence-run is available through the CLI");
  });

  // ---- shutdown (no browser launched) ----

  it("shutdown resolves cleanly when no browser was launched", async () => {
    const service = new FarmService();
    await expect(service.shutdown()).resolves.toBeUndefined();
  });
});
