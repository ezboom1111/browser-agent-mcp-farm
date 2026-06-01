import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";
import { acquireViaHttps, httpTier0Capture, type HttpsOneShot } from "../src/http-tier0-capture.js";
import type { SameConnectionTls } from "../src/tls-identity.js";

// D1 (capture-binding, opt-in FARM_BIND_TLS_SAMECONN=1): the tier-0 https transport captures the cert
// from the SAME socket that delivered the bytes. The same-socket-ness is structural — httpsOneShot reads
// res.socket.getPeerCertificate() on the very response socket — so it is asserted by code review. These
// tests pin the OTHER guarantees that can silently regress: (1) the redirect / content-type / byte-cap
// contract mirrors the fetch path, (2) the cert is bound from the FINAL hop, (3) a resumed session ({})
// records certPresent:false (never a hollow pin), (4) http never binds, (5) the flag wires the node
// transport end-to-end through the metadata writer. The transport is injected (no TLS server / no
// committed private key); the end-to-end test uses a plain-HTTP loopback so no cert plumbing is needed.

const PAGE = "<!doctype html><html><body><h1>Secure page</h1><p>Hello from a local server with plenty of server-rendered visible text so it is not treated as a client-rendered shell and tier-0 keeps the capture.</p></body></html>";

const FAKE_CERT = {
  subject: { CN: "example.com" },
  issuer: { CN: "R3", O: "Let's Encrypt" },
  valid_from: "Jan  1 00:00:00 2026 GMT",
  valid_to: "Apr  1 00:00:00 2026 GMT",
  fingerprint256: "DE:AD:BE:EF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB"
};

const SIGNAL = (): AbortSignal => new AbortController().signal;

function isDecline(r: unknown): r is { declineReason: string; status?: number } {
  return typeof r === "object" && r !== null && "declineReason" in r;
}
function tlsOf(r: unknown): SameConnectionTls | undefined {
  return (r as { sameConnectionTls?: SameConnectionTls }).sameConnectionTls;
}

describe("same-connection TLS binding — acquisition (D1, injected transport)", () => {
  it("binds the same-socket cert (https, cert present) with honest fields and the no-theater label", async () => {
    const oneShot: HttpsOneShot = async () => ({ status: 200, contentType: "text/html", body: PAGE, tooLarge: false, peerCert: FAKE_CERT, authorized: false, protocol: "TLSv1.3", authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT" });
    const r = await acquireViaHttps("https://example.com/", ["example.com"], SIGNAL(), 1_000_000, 5, oneShot);
    expect(isDecline(r)).toBe(false);
    const tls = tlsOf(r);
    expect(tls?.certPresent).toBe(true);
    expect(tls?.fingerprint256).toBe(FAKE_CERT.fingerprint256);
    expect(tls?.subjectCN).toBe("example.com");
    expect(tls?.issuerO).toBe("Let's Encrypt");
    expect(tls?.authorized).toBe(false);
    expect(tls?.authorizationError).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(tls?.protocol).toBe("TLSv1.3");
    expect(String(tls?.binding)).toMatch(/Same-socket/);
    expect(String(tls?.binding)).toMatch(/NOT a server signature/); // no-theater wording is load-bearing
  });

  it("binds the cert from the FINAL hop, not the redirecting hop", async () => {
    let call = 0;
    const oneShot: HttpsOneShot = async () => {
      call += 1;
      if (call === 1) {
        return { status: 302, location: "https://example.com/final", contentType: "", body: "", tooLarge: false, peerCert: { fingerprint256: "FIRST-HOP-CERT" }, authorized: true };
      }
      return { status: 200, contentType: "text/html", body: PAGE, tooLarge: false, peerCert: FAKE_CERT, authorized: false };
    };
    const r = await acquireViaHttps("https://example.com/", ["example.com"], SIGNAL(), 1_000_000, 5, oneShot);
    expect(isDecline(r)).toBe(false);
    expect((r as { finalUrl: string }).finalUrl).toBe("https://example.com/final");
    expect(tlsOf(r)?.fingerprint256).toBe(FAKE_CERT.fingerprint256); // the delivering hop's cert, not the redirect's
  });

  it("records certPresent:false for a resumed session (empty cert) — never a hollow pin", async () => {
    const oneShot: HttpsOneShot = async () => ({ status: 200, contentType: "text/html", body: PAGE, tooLarge: false, peerCert: {}, authorized: true });
    const r = await acquireViaHttps("https://example.com/", ["example.com"], SIGNAL(), 1_000_000, 5, oneShot);
    const tls = tlsOf(r);
    expect(tls).toBeDefined();
    expect(tls?.certPresent).toBe(false);
    expect(tls?.fingerprint256).toBeUndefined();
  });

  it("does NOT bind a cert on a plain-http hop even if one is supplied", async () => {
    const oneShot: HttpsOneShot = async () => ({ status: 200, contentType: "text/html", body: PAGE, tooLarge: false, peerCert: FAKE_CERT, authorized: false });
    const r = await acquireViaHttps("http://example.com/", ["example.com"], SIGNAL(), 1_000_000, 5, oneShot);
    expect(isDecline(r)).toBe(false);
    expect(tlsOf(r)).toBeUndefined();
  });

  it("mirrors the fetch contract: declines non-html, over-cap, and http errors", async () => {
    const nonHtml = await acquireViaHttps("https://example.com/", ["example.com"], SIGNAL(), 1_000_000, 5, async () => ({ status: 200, contentType: "application/json", body: "{}", tooLarge: false }));
    expect(isDecline(nonHtml) && nonHtml.declineReason).toMatch(/non-html/);
    const tooLarge = await acquireViaHttps("https://example.com/", ["example.com"], SIGNAL(), 1_000_000, 5, async () => ({ status: 200, contentType: "text/html", body: PAGE, tooLarge: true }));
    expect(isDecline(tooLarge) && tooLarge.declineReason).toMatch(/exceeds maxBytes/);
    const err = await acquireViaHttps("https://example.com/", ["example.com"], SIGNAL(), 1_000_000, 5, async () => ({ status: 503, contentType: "text/html", body: "", tooLarge: false }));
    expect(isDecline(err) && err.status).toBe(503);
  });
});

// End-to-end through httpTier0Capture + the metadata writer, exercising the REAL acquireViaHttps /
// httpsOneShot node transport (not the injected seam) over a plain-HTTP loopback. http never carries a
// peer cert, so sameConnectionTls is correctly absent — this proves the flag wires the node transport
// in without depending on a TLS server or a committed key.
describe("same-connection TLS binding — flag wiring (D1, real node transport, http loopback)", () => {
  let servers: Server[] = [];
  let roots: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    servers = [];
    await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
    roots = [];
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

  async function readMeta(runDir: string, records: { evidence_kind?: string; path: string }[]): Promise<Record<string, unknown>> {
    const rec = records.find((r) => r.evidence_kind === "metadata" && r.path.endsWith("cap.metadata.json"));
    return JSON.parse(await readFile(join(runDir, rec?.path as string), "utf8")) as Record<string, unknown>;
  }

  it("captures via the node transport when the flag is on (http hop → no cert recorded)", async () => {
    const port = await startHttp(PAGE);
    const runDir = await mkdtemp(join(tmpdir(), "farm-sameconn-"));
    roots.push(runDir);
    const prev = process.env.FARM_BIND_TLS_SAMECONN;
    process.env.FARM_BIND_TLS_SAMECONN = "1";
    try {
      const result = await httpTier0Capture({ runDir, url: `http://127.0.0.1:${port}/`, allowedDomains: ["127.0.0.1"], writer: new ArtifactWriter(), captureId: "cap", contextToken: "ctx", pageId: "pg" });
      expect(result.ok).toBe(true);
      const meta = await readMeta(runDir, result.records);
      expect(meta.captureTier).toBe("http_fetch");
      expect(meta.sameConnectionTls).toBeUndefined(); // http carries no peer cert — recorded honestly, no hollow pin
      expect(meta.serverTlsIdentity).toBeUndefined();
    } finally {
      if (prev === undefined) {
        delete process.env.FARM_BIND_TLS_SAMECONN;
      } else {
        process.env.FARM_BIND_TLS_SAMECONN = prev;
      }
    }
  });

  it("captures via fetch by default (flag off) with no same-connection record", async () => {
    const port = await startHttp(PAGE);
    const runDir = await mkdtemp(join(tmpdir(), "farm-sameconn-off-"));
    roots.push(runDir);
    const prev = process.env.FARM_BIND_TLS_SAMECONN;
    delete process.env.FARM_BIND_TLS_SAMECONN;
    try {
      const result = await httpTier0Capture({ runDir, url: `http://127.0.0.1:${port}/`, allowedDomains: ["127.0.0.1"], writer: new ArtifactWriter(), captureId: "cap", contextToken: "ctx", pageId: "pg" });
      expect(result.ok).toBe(true);
      const meta = await readMeta(runDir, result.records);
      expect(meta.sameConnectionTls).toBeUndefined();
    } finally {
      if (prev !== undefined) {
        process.env.FARM_BIND_TLS_SAMECONN = prev;
      }
    }
  });
});
