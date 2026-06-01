import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { captureTlsIdentity, tlsBindingEnabled, type TlsConnector } from "../src/tls-identity.js";

// Tier 2 (capture-binding): record the server's TLS identity as provenance (cert pin / MITM / expiry).
// The parse/shape logic is tested with an injected connector; a guarded live handshake exercises the
// real default connector against a local TCP server (which fails the handshake -> undefined, covering
// the error path).

const fakeConnector: TlsConnector = async (host, port) => ({
  cert: { subject: { CN: host }, issuer: { CN: "Test Issuer", O: "Test CA" }, valid_from: "Jan 1 00:00:00 2026 GMT", valid_to: "Jan 1 00:00:00 2027 GMT", fingerprint256: "AA:BB:CC" },
  protocol: "TLSv1.3",
  authorized: true
});

describe("captureTlsIdentity", () => {
  it("shapes a server TLS identity from the handshake result", async () => {
    const id = await captureTlsIdentity("https://example.com:8443/page", fakeConnector);
    expect(id).toMatchObject({ host: "example.com", port: 8443, protocol: "TLSv1.3", authorized: true, fingerprint256: "AA:BB:CC", subjectCN: "example.com", issuerCN: "Test Issuer", issuerO: "Test CA", validFrom: "Jan 1 00:00:00 2026 GMT", validTo: "Jan 1 00:00:00 2027 GMT" });
    expect(id?.note).toMatch(/NOT a per-byte binding/i); // honesty scope in the record itself
  });

  it("defaults the port to 443 for an https url with no explicit port", async () => {
    let seenPort = -1;
    const probe: TlsConnector = async (_host, port) => {
      seenPort = port;
      return { cert: {}, authorized: false };
    };
    await captureTlsIdentity("https://example.com/x", probe);
    expect(seenPort).toBe(443);
  });

  it("returns undefined for a non-https url (without probing)", async () => {
    let called = false;
    const probe: TlsConnector = async () => {
      called = true;
      return undefined;
    };
    expect(await captureTlsIdentity("http://example.com/x", probe)).toBeUndefined();
    expect(await captureTlsIdentity("not a url", probe)).toBeUndefined();
    expect(called).toBe(false);
  });

  it("returns undefined when the handshake fails (best-effort)", async () => {
    const failing: TlsConnector = async () => undefined;
    expect(await captureTlsIdentity("https://example.com/x", failing)).toBeUndefined();
  });

  it("the real default connector fails closed (undefined) against a closed port", async () => {
    // Reserve a port, then close it so nothing listens -> the real tls.connect gets ECONNREFUSED fast.
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const id = await captureTlsIdentity(`https://127.0.0.1:${port}/x`, undefined, 1500);
    expect(id).toBeUndefined();
  });
});

describe("tlsBindingEnabled", () => {
  it("is opt-in via FARM_BIND_TLS=1", () => {
    const prev = process.env.FARM_BIND_TLS;
    try {
      delete process.env.FARM_BIND_TLS;
      expect(tlsBindingEnabled()).toBe(false);
      process.env.FARM_BIND_TLS = "1";
      expect(tlsBindingEnabled()).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.FARM_BIND_TLS;
      } else {
        process.env.FARM_BIND_TLS = prev;
      }
    }
  });
});
