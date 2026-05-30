import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FarmService } from "../src/farm-service.js";

// Bring-your-own-capture (v0.4.0): register_evidence is the universal intake — bytes from ANY
// external capturer (Firecrawl, an operator agent, a human paste, a mobile mitmproxy session)
// are hash-registered with caller-supplied, self-asserted provenance, and a claim citing them
// still passes through the same cite-or-fail gate. The farm verifies; it does not have to capture.

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
  roots = [];
});

async function newRun(): Promise<{ service: FarmService; runDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "farm-byo-"));
  roots.push(root);
  const runDir = join(root, "run-1");
  await mkdir(runDir, { recursive: true });
  return { service: new FarmService(), runDir };
}

interface ProvenanceRow {
  artifact_id: string;
  capture_method: string;
  captured_by?: string;
  captured_at?: string;
  kind: string;
}

describe("BYO-capture provenance on register_evidence", () => {
  it("records caller-supplied captureMethod / capturedBy / capturedAt on the artifact", async () => {
    const { service, runDir } = await newRun();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/product",
      text: "The price was 19,900 KRW.",
      evidenceKind: "page_text",
      captureMethod: "byo-firecrawl",
      capturedBy: "firecrawl@v2",
      capturedAt: "2026-05-31T00:00:00.000Z"
    });
    expect(reg.registered).toBe(true);

    const list = await service.listArtifacts({ runDir });
    const rows = list.artifacts as unknown as ProvenanceRow[];
    const row = rows.find((r) => r.artifact_id === reg.artifactId);
    expect(row?.capture_method).toBe("byo-firecrawl");
    expect(row?.captured_by).toBe("firecrawl@v2");
    expect(row?.captured_at).toBe("2026-05-31T00:00:00.000Z");
  });

  it("defaults to agent-authored provenance when none is supplied (backward compatible)", async () => {
    const { service, runDir } = await newRun();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/",
      text: "plain registered text",
      evidenceKind: "page_text"
    });
    const list = await service.listArtifacts({ runDir });
    const rows = list.artifacts as unknown as ProvenanceRow[];
    const row = rows.find((r) => r.artifact_id === reg.artifactId);
    expect(row?.capture_method).toBe("agent-authored");
    expect(row?.captured_by).toBeUndefined();
    expect(typeof row?.captured_at).toBe("string"); // stamped now
  });

  it("a grounded claim citing a BYO-captured artifact still passes the cite-or-fail gate", async () => {
    const { service, runDir } = await newRun();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://example.com/p",
      text: "Rating: 4.6 out of 5 from 1,204 reviews.",
      evidenceKind: "page_text",
      captureMethod: "byo-operator",
      capturedBy: "operator-agent-7"
    });
    const grounded = await service.addClaim({
      runDir,
      artifactId: reg.artifactId as string,
      claim: "The product is rated 4.6",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      anchor: { type: "text_span", quote: "4.6" }
    });
    expect(grounded.appended).toBe(true);
    expect((grounded as { gate?: { ok: boolean } }).gate?.ok).toBe(true);

    // An ungrounded claim (quote absent from the BYO bytes) must still be rejected.
    const ungrounded = await service.addClaim({
      runDir,
      artifactId: reg.artifactId as string,
      claim: "The product is rated 2.1",
      claimType: "text",
      evidenceKind: "page_text",
      verificationLevel: "grounded",
      anchor: { type: "text_span", quote: "2.1 out of 5" }
    });
    expect((ungrounded as { gate?: { ok: boolean } }).gate?.ok).toBe(false);
  });
});
