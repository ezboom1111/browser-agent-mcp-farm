import { createHash } from "node:crypto";
import { createServer as createHttpServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactWriter } from "../src/artifact-writer.js";
import { buildCaptureTranscript, captureTranscriptEnabled, CAPTURE_TRANSCRIPT_SCHEMA, sha256Hex, type CaptureTranscript } from "../src/capture-transcript.js";
import { runClaimGate } from "../src/claim-gate.js";
import { httpTier0Capture } from "../src/http-tier0-capture.js";

let dirs: string[] = [];
let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  servers = [];
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

const PAGE = "<!doctype html><html><body><h1>Secure page</h1><p>Hello from a local server with plenty of server-rendered visible text so tier-0 keeps the capture and does not treat it as a client-rendered shell.</p></body></html>";

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

// Build a minimal run dir by hand: a page_html artifact + an optional capture_transcript artifact, with a
// correct artifacts.jsonl (so the gate's per-artifact re-hash passes and only the cross-check is exercised).
async function writeRun(opts: { transcriptBody?: string; transcriptKind?: string } = {}): Promise<{ dir: string; htmlSha: string }> {
  const dir = await mkdtemp(join(tmpdir(), "farm-ct-"));
  dirs.push(dir);
  await mkdir(join(dir, "raw"), { recursive: true });
  await writeFile(join(dir, "raw/page.html"), PAGE, "utf8");
  const htmlSha = sha(PAGE);
  const rows: Record<string, unknown>[] = [{ artifact_id: "a-html", path: "raw/page.html", sha256: htmlSha, evidence_kind: "page_html", source_url: "https://example.test/p" }];
  if (opts.transcriptBody !== undefined) {
    await mkdir(join(dir, "structured"), { recursive: true });
    await writeFile(join(dir, "structured/t.txt"), opts.transcriptBody, "utf8");
    rows.push({ artifact_id: "a-t", path: "structured/t.txt", sha256: sha(opts.transcriptBody), evidence_kind: opts.transcriptKind ?? "capture_transcript", source_url: "https://example.test/p" });
  }
  await writeFile(join(dir, "artifacts.jsonl"), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  await writeFile(join(dir, "claims.jsonl"), "", "utf8");
  return { dir, htmlSha };
}

const transcriptBody = (binds: { path: string; sha256: string }): string => JSON.stringify(buildCaptureTranscript({ finalUrl: "https://example.test/p", pageBody: PAGE, responses: [{ url: "https://example.test/p", status: 200, bodySha256: binds.sha256 }], binds }));

describe("capture transcript — builder (Phase 0)", () => {
  it("builds a discriminated, honestly-labeled transcript bound to the page artifact", () => {
    const t = buildCaptureTranscript({ finalUrl: "https://x/p", pageBody: PAGE, responses: [{ url: "https://x/p", status: 200 }], binds: { path: "raw/page.html", sha256: "abc" } });
    expect(t.schema).toBe(CAPTURE_TRANSCRIPT_SCHEMA);
    expect(t.pageBodySha256).toBe(sha256Hex(PAGE));
    expect(t.binds).toEqual({ path: "raw/page.html", sha256: "abc" });
    expect(t.note).toMatch(/Capturer-attested/);
    expect(t.note).toMatch(/NOT origin proof/);
  });

  it("captureTranscriptEnabled reads the exact opt-in flag", () => {
    expect(captureTranscriptEnabled({ FARM_CAPTURE_TRANSCRIPT: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(captureTranscriptEnabled({ FARM_CAPTURE_TRANSCRIPT: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(captureTranscriptEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("capture transcript — gate consistency check (Phase 0)", () => {
  it("passes when the transcript's bound digest matches the registered page artifact", async () => {
    const { dir } = await writeRun({ transcriptBody: transcriptBody({ path: "raw/page.html", sha256: sha(PAGE) }) });
    const result = await runClaimGate(dir, { mode: "smoke" });
    expect(result.ok).toBe(true);
    expect(result.counts.captureTranscripts).toBe(1);
  });

  it("FAILS when the transcript binds a digest that differs from the registered bytes", async () => {
    const { dir } = await writeRun({ transcriptBody: transcriptBody({ path: "raw/page.html", sha256: "0".repeat(64) }) });
    const result = await runClaimGate(dir, { mode: "smoke" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /digest mismatch/.test(e))).toBe(true);
  });

  it("FAILS when the transcript binds an unregistered artifact", async () => {
    const { dir } = await writeRun({ transcriptBody: transcriptBody({ path: "raw/missing.html", sha256: sha(PAGE) }) });
    const result = await runClaimGate(dir, { mode: "smoke" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /binds an unregistered artifact/.test(e))).toBe(true);
  });

  it("FAILS when a discriminated transcript has no binding reference", async () => {
    const noBinds = JSON.stringify({ schema: CAPTURE_TRANSCRIPT_SCHEMA, finalUrl: "https://example.test/p", responses: [] });
    const { dir } = await writeRun({ transcriptBody: noBinds });
    const result = await runClaimGate(dir, { mode: "smoke" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /missing a bound-artifact reference/.test(e))).toBe(true);
  });

  it("SKIPS a capture_transcript-tagged blob that is not the discriminated body (the metadata sidecar)", async () => {
    const sidecar = JSON.stringify({ sourceUrl: "https://example.test/p", status: "ok" }); // no schema marker
    const { dir } = await writeRun({ transcriptBody: sidecar });
    const result = await runClaimGate(dir, { mode: "smoke" });
    expect(result.ok).toBe(true);
    expect(result.counts.captureTranscripts).toBeUndefined(); // not counted as a transcript body
  });

  it("is a no-op when no transcript is present (default unchanged)", async () => {
    const { dir } = await writeRun();
    const result = await runClaimGate(dir, { mode: "smoke" });
    expect(result.ok).toBe(true);
    expect(result.counts.captureTranscripts).toBeUndefined();
  });
});

async function startHttp(body: string): Promise<number> {
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("capture transcript — tier-0 emission (Phase 0, opt-in)", () => {
  it("emits a capture_transcript bound to the page_html artifact when the flag is on", async () => {
    const port = await startHttp(PAGE);
    const runDir = await mkdtemp(join(tmpdir(), "farm-ct-emit-"));
    dirs.push(runDir);
    const prev = process.env.FARM_CAPTURE_TRANSCRIPT;
    process.env.FARM_CAPTURE_TRANSCRIPT = "1";
    try {
      const result = await httpTier0Capture({ runDir, url: `http://127.0.0.1:${port}/`, allowedDomains: ["127.0.0.1"], writer: new ArtifactWriter(), captureId: "cap", contextToken: "ctx", pageId: "pg" });
      expect(result.ok).toBe(true);
      const txt = result.records.find((r) => r.evidence_kind === "capture_transcript" && r.path.endsWith(".txt"));
      const html = result.records.find((r) => r.path.endsWith(".html"));
      expect(txt).toBeDefined();
      expect(html).toBeDefined();
      const transcript = JSON.parse(await readFile(join(runDir, txt?.path as string), "utf8")) as CaptureTranscript;
      expect(transcript.schema).toBe(CAPTURE_TRANSCRIPT_SCHEMA);
      expect(transcript.binds.path).toBe(html?.path);
      expect(transcript.binds.sha256).toBe(html?.sha256); // bound to the exact registered page bytes
      expect(transcript.pageBodySha256).toBe(html?.sha256);
    } finally {
      if (prev === undefined) {
        delete process.env.FARM_CAPTURE_TRANSCRIPT;
      } else {
        process.env.FARM_CAPTURE_TRANSCRIPT = prev;
      }
    }
  });

  it("emits NO capture_transcript by default (flag off)", async () => {
    const port = await startHttp(PAGE);
    const runDir = await mkdtemp(join(tmpdir(), "farm-ct-off-"));
    dirs.push(runDir);
    const prev = process.env.FARM_CAPTURE_TRANSCRIPT;
    delete process.env.FARM_CAPTURE_TRANSCRIPT;
    try {
      const result = await httpTier0Capture({ runDir, url: `http://127.0.0.1:${port}/`, allowedDomains: ["127.0.0.1"], writer: new ArtifactWriter(), captureId: "cap", contextToken: "ctx", pageId: "pg" });
      expect(result.ok).toBe(true);
      expect(result.records.some((r) => r.evidence_kind === "capture_transcript")).toBe(false);
    } finally {
      if (prev !== undefined) {
        process.env.FARM_CAPTURE_TRANSCRIPT = prev;
      }
    }
  });
});
