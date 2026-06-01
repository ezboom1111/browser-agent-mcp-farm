import { connect as tlsConnect } from "node:tls";

// Capture-binding (transcendence Tier 2, the self-contained piece). Records the TLS identity of the
// server a capture came from — certificate fingerprint, issuer, subject, validity — so a reader can pin
// the cert, detect a man-in-the-middle (an unexpected issuer), an expired/changed cert, or a host that
// silently moved CAs. Opt-in via FARM_BIND_TLS=1.
//
// HONESTY (deliberate, no theater): this is a SEPARATE handshake to the final host, so it is provenance
// ABOUT THE SERVER at capture time — it is NOT a cryptographic binding of the captured BYTES to this
// exact connection (that would require capturing the cert from the same socket that delivered the body,
// i.e. a TLS-aware capture transport). A trusted-timestamp anchor (RFC-3161 TSA) and multi-vantage
// agreement are the further, infrastructure-dependent steps and are deliberately not bolted into the
// deterministic core. The actual capture already enforced TLS; this records what was presented.

export interface TlsIdentity {
  host: string;
  port: number;
  protocol?: string;
  /** Whether the presented chain validated against the system trust store on the probe handshake. */
  authorized: boolean;
  fingerprint256?: string;
  subjectCN?: string;
  issuerCN?: string;
  issuerO?: string;
  validFrom?: string;
  validTo?: string;
  note: string;
}

interface PeerCertLike {
  subject?: { CN?: string };
  issuer?: { CN?: string; O?: string };
  valid_from?: string;
  valid_to?: string;
  fingerprint256?: string;
}

export interface TlsHandshakeResult {
  cert: PeerCertLike;
  protocol?: string | undefined;
  authorized: boolean;
}

/** Injectable so the parse/shape logic is testable without a live TLS server. */
export type TlsConnector = (host: string, port: number, timeoutMs: number) => Promise<TlsHandshakeResult | undefined>;

const NOTE = "Server TLS identity observed via a SEPARATE handshake at capture time — provenance about the server (cert pin / MITM / expiry detection), NOT a per-byte binding of the captured bytes to this exact connection.";

const defaultConnector: TlsConnector = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (value: TlsHandshakeResult | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve(value);
    };
    try {
      // rejectUnauthorized:false so we still RECORD an unusual/self-signed cert (with authorized=false)
      // rather than skipping it — the capture transport already enforced TLS; this is provenance only.
      const socket = tlsConnect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
        const cert = socket.getPeerCertificate() as PeerCertLike;
        const result: TlsHandshakeResult = { cert: cert ?? {}, authorized: socket.authorized };
        const protocol = socket.getProtocol();
        if (protocol !== null) {
          result.protocol = protocol;
        }
        socket.end();
        done(result);
      });
      // A hard backstop so a stalled/half-open handshake (e.g. a FIN mid-negotiation that emits neither
      // 'error' nor 'secureConnect') can never hang the probe.
      timer = setTimeout(() => {
        socket.destroy();
        done(undefined);
      }, timeoutMs + 500);
      socket.on("timeout", () => {
        socket.destroy();
        done(undefined);
      });
      socket.on("error", () => done(undefined));
      socket.on("close", () => done(undefined));
    } catch {
      done(undefined);
    }
  });

export function tlsBindingEnabled(): boolean {
  return process.env.FARM_BIND_TLS === "1";
}

export function sameConnectionTlsBindingEnabled(): boolean {
  return process.env.FARM_BIND_TLS_SAMECONN === "1";
}

export interface SameConnectionTls {
  host: string;
  port: number;
  protocol?: string;
  /** False when the peer presented no cert (e.g. TLS session resumption returns {}); never a hollow pin. */
  certPresent: boolean;
  /** Whether the presented chain validated against the system trust store. */
  authorized: boolean;
  authorizationError?: string;
  fingerprint256?: string;
  subjectCN?: string;
  issuerCN?: string;
  issuerO?: string;
  validFrom?: string;
  validTo?: string;
  binding: string;
}

const SAME_CONNECTION_NOTE = "Same-socket binding: this certificate was presented on the EXACT TLS connection whose socket also delivered these bytes (no second handshake). TLS transport provenance — NOT a server signature over the bytes; a terminating proxy/CDN holding the session keys is still trusted.";

/**
 * Shape the TLS identity captured from the SAME socket that delivered the bytes (D1, strong binding).
 * A resumed TLS session returns an empty cert ({}) — record certPresent:false rather than a hollow pin.
 */
export function shapeSameConnectionTls(host: string, port: number, cert: PeerCertLike, options: { authorized: boolean; authorizationError?: string | undefined; protocol?: string | undefined }): SameConnectionTls {
  const fingerprint = typeof cert.fingerprint256 === "string" && cert.fingerprint256.length > 0 ? cert.fingerprint256 : undefined;
  const identity: SameConnectionTls = { host, port, certPresent: fingerprint !== undefined, authorized: options.authorized, binding: SAME_CONNECTION_NOTE };
  if (options.protocol !== undefined) {
    identity.protocol = options.protocol;
  }
  if (options.authorizationError !== undefined) {
    identity.authorizationError = options.authorizationError;
  }
  if (fingerprint !== undefined) {
    identity.fingerprint256 = fingerprint;
  }
  if (cert.subject?.CN !== undefined) {
    identity.subjectCN = cert.subject.CN;
  }
  if (cert.issuer?.CN !== undefined) {
    identity.issuerCN = cert.issuer.CN;
  }
  if (cert.issuer?.O !== undefined) {
    identity.issuerO = cert.issuer.O;
  }
  if (cert.valid_from !== undefined) {
    identity.validFrom = cert.valid_from;
  }
  if (cert.valid_to !== undefined) {
    identity.validTo = cert.valid_to;
  }
  return identity;
}

/** Probe and shape the server TLS identity for an https URL. undefined for non-https / failure (best-effort). */
export async function captureTlsIdentity(url: string, connector: TlsConnector = defaultConnector, timeoutMs = 5000): Promise<TlsIdentity | undefined> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") {
    return undefined;
  }
  const host = parsed.hostname;
  const port = parsed.port.length > 0 ? Number(parsed.port) : 443;
  const result = await connector(host, port, timeoutMs);
  if (result === undefined) {
    return undefined;
  }
  const cert = result.cert;
  const identity: TlsIdentity = { host, port, authorized: result.authorized, note: NOTE };
  if (result.protocol !== undefined) {
    identity.protocol = result.protocol;
  }
  if (typeof cert.fingerprint256 === "string") {
    identity.fingerprint256 = cert.fingerprint256;
  }
  if (cert.subject?.CN !== undefined) {
    identity.subjectCN = cert.subject.CN;
  }
  if (cert.issuer?.CN !== undefined) {
    identity.issuerCN = cert.issuer.CN;
  }
  if (cert.issuer?.O !== undefined) {
    identity.issuerO = cert.issuer.O;
  }
  if (cert.valid_from !== undefined) {
    identity.validFrom = cert.valid_from;
  }
  if (cert.valid_to !== undefined) {
    identity.validTo = cert.valid_to;
  }
  return identity;
}
