import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FarmService } from "../src/farm-service.js";

describe("FarmService secret redaction", () => {
  it("redacts proxy credentials and absolute profile paths from acquireContext", () => {
    const service = new FarmService();
    const { lease } = service.acquireContext({
      agentId: "a",
      runId: "r",
      artifactRunDir: "/tmp/run",
      storagePolicy: "persistent-profile",
      userDataDir: "/home/secretuser/profile/user-data",
      proxy: { server: "http://puser:ppass@proxy.example:8080", username: "puser", password: "ppass" }
    });

    expect(lease.proxy?.password).toBe("***");
    expect(lease.proxy?.username).toBe("***");
    expect(lease.proxy?.server).not.toContain("ppass");
    expect(lease.userDataDir).toBe("[redacted path]");
    // No secret value or absolute profile path bytes survive into the tool result.
    const serialized = JSON.stringify(lease);
    expect(serialized).not.toContain("ppass");
    expect(serialized).not.toContain("secretuser");
  });

  it("redacts secrets from listLeases output", () => {
    const service = new FarmService();
    service.acquireContext({
      agentId: "a",
      runId: "r",
      artifactRunDir: "/tmp/run",
      proxy: { server: "http://proxy.example:1", password: "topsecret" }
    });

    const { leases } = service.listLeases();
    expect(JSON.stringify(leases)).not.toContain("topsecret");
  });
});

describe("FarmService cite-or-fail authoring surface", () => {
  let roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
    roots = [];
  });

  async function newRun(): Promise<{ service: FarmService; root: string; runDir: string }> {
    const root = await mkdtemp(join(tmpdir(), "farm-svc-loop-"));
    roots.push(root);
    const runDir = join(root, "run-1");
    await mkdir(runDir, { recursive: true });
    return { service: new FarmService(), root, runDir };
  }

  it("register -> read -> add grounded claim passes; an ungrounded claim fails", async () => {
    const { service, runDir } = await newRun();

    const reg = await service.registerEvidence({ runDir, sourceUrl: "https://example.com/", text: "The price was 4500 KRW.", evidenceKind: "page_text" });
    expect(reg.registered).toBe(true);
    const artifactId = reg.artifactId as string;

    const read = await service.readArtifact({ runDir, artifactId });
    expect(read.found).toBe(true);
    expect(read.tampered).toBe(false);
    expect(read.content).toContain("4500");

    const grounded = await service.addClaim({
      runDir,
      artifactId,
      claim: "The price was 4500 KRW",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      anchor: { type: "text_span", quote: "4500" }
    });
    expect(grounded.appended).toBe(true);
    expect(grounded.ok).toBe(true);

    const ungrounded = await service.addClaim({
      runDir,
      artifactId,
      claim: "The shop is permanently closed",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      anchor: { type: "text_span", quote: "permanently closed" }
    });
    expect(ungrounded.appended).toBe(true);
    expect(ungrounded.ok).toBe(false); // quote absent from the cited bytes
  });

  it("rejects a claim citing an unregistered artifact", async () => {
    const { service, runDir } = await newRun();
    const result = await service.addClaim({
      runDir,
      artifactId: "nope",
      claim: "x",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      anchor: { type: "text_span", quote: "x" }
    });
    expect(result.appended).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("readArtifact flags a post-registration byte mutation as tampered", async () => {
    const { service, runDir } = await newRun();
    const reg = await service.registerEvidence({ runDir, sourceUrl: "https://example.com/", text: "original", evidenceKind: "page_text" });
    await writeFile(join(runDir, reg.path as string), "mutated bytes", "utf8");

    const read = await service.readArtifact({ runDir, artifactId: reg.artifactId as string });
    expect(read.tampered).toBe(true);
    expect(read.ok).toBe(false);
  });

  it("capabilities advertises server identity, evidence kinds, and non-goals", () => {
    const caps = new FarmService().capabilities();
    expect(caps.serverName).toBe("browser-agent-mcp-farm");
    expect(caps.evidenceKinds).toContain("structured_data");
    expect(caps.nonGoals.join(" ")).toMatch(/bypass/);
  });

  it("listRuns discovers a run under a root", async () => {
    const { service, root, runDir } = await newRun();
    await service.registerEvidence({ runDir, sourceUrl: "https://example.com/", text: "x", evidenceKind: "page_text" });

    const result = await service.listRuns({ runRoot: root, limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.runs.some((run) => run.runDir === runDir)).toBe(true);
  });

  it("extractStructured parses JSON-LD from inline HTML", async () => {
    const result = await new FarmService().extractStructured({
      html: '<script type="application/ld+json">{"@type":"Product","name":"Latte","offers":{"price":"4500","priceCurrency":"KRW"}}</script>'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.price?.value).toBe("4500");
    }
  });

  it("exportBundle then verifyBundle round-trips for a run", async () => {
    const { service, runDir } = await newRun();
    await service.registerEvidence({ runDir, sourceUrl: "https://example.com/", text: "evidence", evidenceKind: "page_text" });

    const exported = await service.exportBundle({ runDir });
    expect(exported.ok).toBe(true);
    const verified = await service.verifyBundle({ runDir, manifest: exported.manifest });
    expect(verified.ok).toBe(true);
  });
});
