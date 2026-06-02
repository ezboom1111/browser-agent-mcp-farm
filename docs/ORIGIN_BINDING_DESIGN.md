# Origin-Bound Capture Attestation — Design (DRAFT)

> Status: **design draft for review** (no code yet). Produced from a focused
> technical review of capture provenance, TLS limits, repo integration, and
> design red-team constraints. This document covers only the technical design
> and its honest limits.

## 1. The problem: the open roof (fabrication-at-capture)

The cite-or-fail gate proves a claim's quote literally re-matches the **SHA-256-registered
bytes**, and re-hashes every artifact over an untrusted run dir. It therefore catches
**hallucination** — the model inventing a quote that is not in the bytes.

It does **not** prove those bytes are a faithful capture of the live page. `THREAT_MODEL.md`
already concedes this: *"a producer could register fabricated bytes whose hash matches and
pass — trust the capture only as much as you trust the producer."* So the gate is blind to
**fabrication-at-capture**: a model/producer that controls the bytes can capture a real page,
edit the captured artifact, register the doctored bytes, quote them perfectly, and the gate
goes green. As models get more agentic this path gets *easier*, not harder.

Consequence: the strong form of "don't trust the model" — *"the model can't lie about what
the web said"* — is **half-open**. Closing it needs **origin-bound capture attestation**:
proof that the registered bytes actually came from origin X over a real connection,
verifiable by a third party who does **not** trust the capturer.

## 2. The load-bearing crypto fact (why this is hard)

TLS gives confidentiality, integrity, and endpoint **authentication**, but deliberately
**not non-repudiation**. Session keys are symmetric/shared; records are authenticated with
HMAC/AEAD under those shared keys. So **after** a session, either party can forge an
arbitrary transcript consistent with the keys (TLS "deniability" is intentional). Therefore:

> **Any client-only capture — including the farm's shipped same-connection TLS pin (D1) —
> can prove "I had a real TLS session with a valid cert for host X" but CANNOT prove to a
> distrusting third party "these exact bytes are what X sent."**

This is exactly why D1 is honestly labeled *"transport provenance, NOT a signature over the
bytes."* The only way to bind bytes to an origin verifiably-against-an-untrusted-capturer is
to put a **neutral party into the live TLS session** (an MPC/2PC handshake or a recording
proxy-witness + ZK consistency proof). That is the zkTLS / MPC-TLS family
(TLSNotary, DECO, Reclaim, zkPass, Opacity, Pluto).

## 3. The design: four layers, only Layer 2 closes the gap

All opt-in, default behavior byte-unchanged, each honestly labeled.

| Layer | What it records | Closes the gap? | Third-party verifiable? | Origin-bound? | New deps |
| --- | --- | --- | --- | --- | --- |
| **Phase 0** — capturer-attested transcript | per-response `{url,status,headers,sha256(body)}` + page-body sha256 + same-conn cert, as a `capture_transcript` artifact | **No** — only internal byte-consistency | yes (re-readable) | **no** | 0 |
| **Phase 1** — browser-path cert identity | Playwright `securityDetails()` (issuer/subject/validity/protocol) on the real render path | **No** — client-side, weaker than tier-0 D1 (no `fingerprint256`) | yes | **no** | 0 |
| **L3 (optional, defer)** — terminating recording proxy | real upstream cert **fingerprint** + full transcript on the browser path (node:tls, on existing multi-vantage proxy plumbing) | **No** — proxy holds its own keys | yes | **no** | 0 (hand-rolled) |
| **Phase 2 (seam now, wire later)** — neutral notary (zkTLS) | TLSNotary proxy/MPC attestation binding ciphertext→authenticated origin | **Yes**, but only for {TLS-1.2, single node-side request, notary-not-colluding} | **yes** | **yes** | optional sub-pkg |

### Phase 0 — capturer-attested network transcript (ship first)
- New `capture_transcript` evidence kind: a deterministic JSON of per-response
  `{url, status, headers, sha256(body)}` + the final page-body sha256 + the same-connection
  cert. Browser path reuses the existing `networkEvents` recorder
  (`browser-pool.ts` `requestfinished`); tier-0 reuses `acquireViaHttps`/`httpsOneShot`.
- **Gate check** (new deterministic verifier over the untrusted run dir, modeled on
  `validateClaimGrounding`): recompute `sha256` of the cited `page_html`/`page_text` bytes on
  disk and assert it equals the digest the transcript recorded for the final URL. This proves
  the transcript is **internally consistent** with the registered bytes — nothing more.
- Capture the CDP `signedCertificateTimestampList` (CT **SCTs**) as an **opaque** field a
  reader can check against CT logs out-of-band — the one partial *independent* anchor
  available client-side. Do **not** hand-roll ASN.1 to parse it in-core.
- **What it is NOT:** origin proof. The producer controls every byte that goes into the
  transcript and can write both the bytes and their digest. It fills the
  `THREAT_MODEL.md` "network response digests / HAR" slot — a **capture-richness** slot, not
  an origin-binding one.

### Phase 1 — same-connection cert identity on the browser path (ship with Phase 0)
- Record `Response.securityDetails()` (issuer/subject/validFrom/validTo/protocol) for the
  real navigation. Ends the *"strongest provenance runs on the weakest (tier-0) path"* irony
  and gives cheap MITM/expiry/issuer-drift detection on the path that actually renders.
- **Honest label, exact:** *"cert identity on the real render path — NO fingerprint pin,
  weaker than the tier-0 node:https same-connection binding, and NOT origin-binding."*
  Playwright exposes no `fingerprint256` (documented deferred gap #3), so this is cert
  *identity*, not a cert *pin*. Do not let "same-connection" imply a socket artifact the farm
  does not hold.

### L3 — terminating recording proxy (optional, defer the build)
- A local `node:tls` MITM-style recorder (own CA, trusted only by the farm's own Chromium)
  on the existing multi-vantage proxy plumbing recovers the **real upstream fingerprint** +
  full transcript on the browser path — D1-parity on the real path, zero new runtime deps.
- **Still client-side**: it holds its own session keys → no non-repudiation, fabricable
  post-hoc. Record-only; **never** for stealth / pinning-defeat (non-goal). It only becomes
  origin-binding when the proxy role is played by a **neutral notary** (Phase 2).

### Phase 2 — neutral notary seam (design now, wire later)
- Inject a `NotaryClient` seam **copied verbatim from the shipped `TsaClient` pattern**
  (`timestamp-anchor.ts`): a single function type, default `undefined`, the attestation
  stored **beside** the artifact (like `manifest.engine` sits outside the Merkle
  root/signature in `evidence-bundle.ts`), **strip-only / downgrade-not-forge**.
- **Gate check is ONLY** "the attestation is well-formed and binds *this* artifact's sha256."
  The heavy cryptographic verification is delegated **out-of-process** to a vendored verifier
  — exactly as RFC-3161 verification is delegated to `openssl ts -verify`. The core never
  imports or hand-rolls MPC/ZK/SNARK crypto.
- Heavy zkTLS lives in an **optional, separately-installed sub-package** via
  `peerDependenciesMeta.optional` (the proven `tesseract.js` precedent). Absent sub-package →
  Phase 2 simply unavailable, default byte-unchanged, core stays at **3 runtime deps**.
- **Back-end target:** TLSNotary **proxy mode** or Reclaim first (faster ~1.6 s, lighter, more
  mature; its no-collusion assumption *is* the neutral-verifier story the farm already tells);
  MPC mode as the stronger/slower option. **Attach on the tier-0 node:https path.**
- **Honest label, exact:** *"origin-bound for TLS-1.2 single node-side requests only; trusts a
  neutral notary not to collude; experimental/alpha upstream; does NOT cover the browser path
  or TLS 1.3."*

## 4. The HARD INVARIANT (what keeps the fuzzer at 0-leak)

> **The gate must NEVER raise its verdict because a transcript or attestation is present.**
> Presence enables a stronger **label** only; absence or a stripped field only **downgrades**
> the label. The gate still only enforces the byte-self-consistency it already enforces.

This is the whole safety argument. A fabricator who writes a fake transcript field gains
nothing past the byte-self-consistency the gate already checks, so `qa-fuzz` stays 0-leak.
(Verified: the gate currently only re-hashes bytes and has no path where a present field
raises the verdict.) Any implementation that lets an attestation *upgrade* a pass re-opens
the exact hole this effort exists to close.

## 5. Rejected / opportunistic

- **ADD (free, never a path):** opportunistic **RFC 9421** response-signature verification
  with `node:crypto` when a `Signature`/`Signature-Input` header is present → record
  "origin-signed" provenance. The cleanest binding when it exists, but response-signing
  adoption is ~zero today (adoption is *request*-signing by agents), so it is a cheap bonus,
  never the primary path.
- **REJECT:** Signed HTTP Exchanges / Web Bundles (deprecated; Cloudflare removing SXG from
  Oct 2025), Opacity-style **TEE + chain** (wrong trust root: hardware vendor + restaking),
  and any chain-coupled zkTLS SDK (wrong dependency profile). DECO is the academic root —
  cite it as the *why*, integrate TLSNotary/Reclaim instead.

## 6. Honest limits (residual gaps no phase closes)

1. **origin-served ≠ true.** A perfect notary proof says only "origin X served these exact
   bytes." It says nothing about accuracy, an honest origin, upstream spoofing, or claim
   correctness. Origin-binding moves the wall from *trust the capturer* to *trust the origin*
   — it does not reach truth. (The gate's `green ≠ true` rule already says this.)
2. **dynamic / personalized / authenticated pages.** A notary attests what the origin served
   *to this session*. A/B buckets, geo-fencing, logged-in personalization, time-varying
   prices all produce a perfectly origin-bound capture of a page no one else sees. Multi-vantage
   detects *divergence* but agreeing vantages on a uniformly-served lie still agree.
3. **notary trust & centralization.** Phase 2 relocates trust to the notary (no-collusion +
   no-MITM-on-the-verifier-hop; a forged notary key forges every proof). A network diffuses
   but does not eliminate this.
4. **the TLS-1.3 / browser-path hole.** Every shipping zkTLS is **TLS-1.2-only** and binds a
   node-side mediated fetch, not a Playwright render with subresource fan-out. So for most
   modern (TLS-1.3) origins **and** for the browser path we flagged as the real concern,
   Phase 2 provides **no** origin-binding. The strongest primitive runs on the narrowest slice.
5. **heavy-dep / alpha risk.** Real origin-binding needs Rust/WASM MPC or a ZK stack + a
   running notary — incompatible with the 3-dep core. The optional sub-package contains the
   supply-chain blast radius; it does not make the upstream mature (it is alpha/unaudited).
6. **capture-completeness gaps that survive every phase.** CDP `getResponseBody` returns the
   browser's *decoded* reconstruction (not raw wire bytes) and is **missing** for OOPIF
   iframes / service workers; `recordHar` minimal mode drops the security block. A transcript
   that must "mark incomplete rather than drop" is honest but provably partial — an adversary
   can push fabrication-relevant content into exactly the subresources it could not capture.

## 7. The biggest risk: LABEL DRIFT

A `capture_transcript` showing green next to a passing gate **will** be read — by users and by
our own future selves — as *"the model proved what the web said."* For Phase 0/1 it proved
nothing past byte-self-consistency; for Phase 2 it proves origin-*served* only for a TLS-1.2
node-side slice under a notary-trust assumption, never on the browser path. **If we ship one
thing, ship the honest labels and the present-never-raises-verdict invariant; the cryptography
can wait, but a mislabel silently re-opens the hole.** `THREAT_MODEL.md` and
`CAPTURE_BINDING.md` must distinguish "capturer-attested transcript (Phase 0/1)" from
"origin-bound (Phase 2, narrow slice)" as part of shipping, not after.

## 8. Recommended build order

1. **Ship now (zero deps):** Phase 0 `capture_transcript` + gate consistency check + the
   present-never-raises-verdict invariant + the honest labels. Fills the named `THREAT_MODEL`
   slot and gives the gate a real new deterministic check.
2. **Ship with #1 (zero deps):** Phase 1 browser-path cert identity + exact label.
3. **Ship cheap (zero deps):** opportunistic RFC 9421 response-signature verify.
4. **Design now, wire later:** the Phase 2 `NotaryClient` seam (TsaClient twin; optional
   sub-package; gate checks well-formedness + sha256 binding only). Defer the live zkTLS.
5. **Consider, defer:** L3 terminating recording proxy for browser-path fingerprint parity.

Net: origin-binding is worth building the **seam** for and worth being **honest** about.
Phases 0/1 are strictly better **capture** (richer, signed, tamper-evident-after-sealing) but
they do **not** close fabrication-at-capture — only the Phase 2 neutral notary does, and only
on a narrow slice.

---
See [`docs/CAPTURE_BINDING.md`](CAPTURE_BINDING.md) for the shipped capture-binding tier and
[`docs/THREAT_MODEL.md`](THREAT_MODEL.md) for the surrounding trust model.
