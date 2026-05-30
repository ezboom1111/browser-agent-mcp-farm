# Threat Model — what the evidence gate and bundle prove (and do NOT)

The farm's trust primitives are deliberately honest about their limits. Read this
before relying on a claim, a gate verdict, or a bundle.

## The claim gate (`farm_run_claim_gate`, final mode)

**Proves:**
- Every registered artifact is present on disk and its bytes match the recorded
  SHA-256 (re-hashed at gate time) — no silent byte changes.
- Every final claim cites a registered, typed artifact, and the citation graph is
  well-formed (no uncited or orphan-cited claims; destination claims carry the
  full provenance chain).
- For an **anchored** claim, the claim's `text_span` quote (or, for
  derived/aggregated claims, its supporting tokens) is actually present in the
  cited artifact's bytes — the claim is *grounded in the evidence*.

**Does NOT prove:**
- That the captured bytes faithfully represent what the live page showed. Captures
  are stamped with wall-clock time and random IDs and are **not reproducible**, so
  the gate cannot re-derive the original capture. A producer could register
  fabricated bytes whose hash matches and pass. (Capture-provenance attestation —
  network response digests / HAR — is a planned mitigation; until then, trust the
  capture only as much as you trust the producer.)
- That an **un-anchored** claim is true. Without an anchor, the gate checks the
  citation graph and artifact integrity, not the claim's meaning.
- That the agent's free-text prose answer is correct — only claims written to the
  ledger (e.g. via `farm_add_claim`) are gated, not arbitrary chat output.

## The evidence bundle (`farm_export_bundle` / `farm_verify_bundle`)

**Proves (offline, no network):**
- Every artifact named in the manifest is present and its bytes match the
  manifest's SHA-256 (detects a tampered **file**).
- The Merkle root recomputed from the manifest's hashes matches the manifest's
  stored root (detects a tampered **manifest**).
- If signed and a public key is supplied: the Merkle root was signed by the holder
  of the corresponding Ed25519 private key (detects a forged manifest from someone
  without the key).

**Does NOT prove:**
- That the bytes are a faithful capture of the live page (same caveat as above —
  the signature attests *who sealed* the bytes, not that they are real).
- Portability beyond the runDir: this is currently a **manifest over the run on
  disk**, not a self-contained archive. The verifier needs the run's files present.
  A self-contained signed `.evb` archive is a planned next step.

## Non-goals (the farm refuses these by design)

- No login / CAPTCHA / paywall / age-gate bypass.
- No payments / bookings / account changes.
- No raw video or audio stream download.
- No claim of full video/audio understanding without transcript/audio evidence.

## Practical guidance

Treat a green gate / valid bundle as **"this evidence is internally consistent,
byte-stable, and the claims are grounded in it"** — a strong anti-tampering and
anti-uncited-claim guarantee. Do **not** read it as "this answer is true" or "these
bytes are a faithful record of the live web." For the latter, prefer official-API
evidence where available and corroborate across independent sources.
