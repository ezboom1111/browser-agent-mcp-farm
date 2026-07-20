# Capture-Binding (Tier 2)

How strongly are a run's captured **bytes** bound to *where, when, and from whom*
they came? The deterministic floor of this farm already proves **content
integrity** (SHA-256 re-hash) and **citation grounding** (a claim's quote must
re-match the bytes). Capture-binding adds *provenance* on top — and does so with
**no theater**: every record states exactly what it proves and what it does
**not**. This page is the honest map of what is shipped, what each piece is worth,
and what is deliberately deferred (and why).

> Rule of the tier: capture-binding never *upgrades trust by itself*. The
> deterministic gate stays the trust boundary. These records let a **reader**
> detect tampering, viewer-specific divergence, or a moved CA — they do not make
> the farm assert the bytes are *true*.

All of it is **opt-in** and **off by default**; the default capture path is
byte-for-byte unchanged.

## Shipped

| Piece | Flag / entry point | Proves | Does **not** prove |
| --- | --- | --- | --- |
| **Server TLS identity** (separate handshake) | `FARM_BIND_TLS=1` → `metadata.serverTlsIdentity` | The cert a *second* probe to the final host presented (cert pin, MITM/issuer change, expiry detection). | That the cert was on the *same* connection that delivered the bytes — a second probe can hit a different edge node or a rotated cert. |
| **Same-connection TLS binding** | `FARM_BIND_TLS_SAMECONN=1` → `metadata.sameConnectionTls` | The cert presented on the **exact socket** that delivered the bytes (no second handshake). Tier-0 (`node:https`) only. | A server *signature over the bytes*. A terminating proxy/CDN holding the session keys is still trusted; TLS is transport provenance, not a payload signature. |
| **Bundle transparency log** (ordering anchor) | `export-bundle --anchor-log <f>`; `verify-timestamp-log` | The **relative order** of anchored bundle Merkle roots, and that the log was not edited after the fact (hash-chained, tamper-evident). | **Absolute wall-clock time** — the `at` field is the untrusted local clock. Ordering ≠ timestamping. |
| **Multi-vantage agreement** | `FARM_ENABLE_MULTI_VANTAGE=1` → `multi_vantage_agreement` artifact | **Consistency across N independent egress points** — flags cloaking / geo-fencing / A-B / price discrimination / one-hop MITM that a single capture records silently. | **Truth.** N vantages reaching an origin that serves everyone the same content (true or false) still agree. Browser path only (see deferred). |

The two-layer model still holds: a **deterministic floor** (hash + span
citation) plus a **caged ceiling** (the LLM judge proposes; the gate verifies
spans + quorum). Capture-binding is provenance *beside* that floor, never a
replacement for it.

## Deferred (and why) — the honest limits

These are **known gaps**, not oversights. Each has a designed opt-in path; none
is wired into the default suite.

### 1. Live RFC-3161 trusted timestamp (transparency-log "Layer 2")

The transparency log proves *ordering*, not *time*. A genuine time proof needs an
external **RFC-3161 TSA** token over the entry hash. The **seam is already
shipped**: `appendAnchor(logPath, input, tsaClient?)` accepts an injected
`TsaClient`, and a token is stored **outside** the chain hash (so a tamperer can
only *strip* it — degrading `tsa` → `ordering`, a weaker claim — never forge
one).

**Why deferred:** the farm must **not hand-roll ASN.1 / RFC-3161 crypto** — that
would be false assurance. The intended wiring delegates to vetted crypto
(`openssl ts`):

- A `TsaClient` that POSTs the entry hash to a TSA (`FARM_TSA_URL`) and returns
  the DER token.
- Offline verification via `openssl ts -verify` against the TSA CA
  (`FARM_TSA_CAFILE`).
- An opt-in offline fixture (an `openssl ts -reply` token) exercised in a
  **separate vitest config** (the `vitest.ocr.config.ts` pattern), **never** in
  the default gate, so the suite stays hermetic and network-free.

Until wired, every anchor is honestly labeled `ordering`.

### 2. Tier-0 (browserless) per-vantage proxy egress

Multi-vantage capture is **browser-path only**. The tier-0 browserless transport
(global `fetch`, i.e. undici) cannot route through a per-vantage proxy without a
`ProxyAgent`, and **`undici` is not importable** in this runtime
(`MODULE_NOT_FOUND`) — global fetch is undici, but the module is not exposed.
Adding it would mean a **fourth runtime dependency** (currently only
`@modelcontextprotocol/sdk`, `playwright`, `zod`).

**Why deferred:** the three-dependency budget is a deliberate supply-chain
constraint. The browser path already gives real per-egress rendering through a
proxied Playwright context (`LeaseManager.acquire({ proxy })`), which is also the
*stronger* signal (it sees what a real browser at that egress sees). Tier-0
multi-vantage would only add a faster, weaker variant.

### 3. Browser-path TLS fingerprint

Same-connection TLS binding is **tier-0 (`node:https`) only**. Playwright's
`response.securityDetails()` exposes issuer / subjectName / validFrom / validTo /
protocol — but **no certificate fingerprint** (no `fingerprint256`). So a capture
rendered through the browser cannot record the cert *pin* that the `node:https`
path can.

**Why deferred:** there is no fingerprint to read from Playwright's API; closing
this would require a TLS-aware capture transport under the browser, which is a
much larger surface than the value warrants. Documented as a known gap; the
browser path can still record the weaker `securityDetails` provenance if needed.

## Where the code lives

| Concern | Module |
| --- | --- |
| Server + same-connection TLS shaping | `src/tls-identity.ts` |
| Tier-0 https transport (same-socket cert) | `src/http-tier0-capture.ts` (`acquireViaHttps` / `httpsOneShot`) |
| Transparency log + TSA seam | `src/timestamp-anchor.ts` |
| Agreement core (pure) | `src/multi-vantage-agreement.ts` |

The more aggressive **origin-binding** line (proving captured bytes came from
origin X to a capturer-distrusting third party) is a separate design whose
**decision is to stop at Phase 0** — see
[`ORIGIN_BINDING_DESIGN.md`](ORIGIN_BINDING_DESIGN.md) for the decision record and
why a neutral notary (zkTLS), not any client-only layer, is the only gap-closer.

See [`docs/THREAT_MODEL.md`](THREAT_MODEL.md) for the surrounding trust model and
[`CHANGELOG.md`](../CHANGELOG.md) for the per-build history.
