# External-bridge tier (caged external capture)

> Off by default. Set `FARM_ENABLE_EXTERNAL_BRIDGE=1` to enable. This document is the threat model
> and operator guide; it is intentionally neutral and technical.

## What it is

`storagePolicy: "external-bridge"` is a lease tier for a **powerful but untrusted** capturer — an
external/aggressive agent or tool that may behave unpredictably. It exists so that capability can be
used **without** weakening the farm's trust model. The bytes it produces are registered through the
normal `register_evidence` path (tag `captureMethod: "byo-bridge"`) and **re-verified by the same
deterministic claim gate** as every other source. The tier is never the trusted capture path; it is
provenance-tagged, gate-checked evidence.

## Why the cage holds (the security boundary is the gate, not an AI)

The trust boundary is the deterministic hash + anchor claim gate, which re-hashes the cited bytes and
re-matches every `text_span` anchor. It cannot be talked out of a verdict and is reproducible
offline. An AI supervisor is deliberately **not** used as the boundary: it is non-deterministic (a
third party could not re-verify the bundle) and is itself a prompt-injection target.

The lease tier neutralizes a compromised capturer four ways, all enforced at `acquire()`:

1. **Zero credentials / identity.** A `proxy`, `profileName`, `storageStatePath`, `userDataDir`, or
   `fingerprint` is rejected (`external_bridge_no_persistence`). There is nothing to steal, and the
   context is a fresh isolated ephemeral context (no saved session is ever loaded).
2. **Disposable.** It uses no persistent profile and takes no profile lock, so it leaves nothing on
   disk and cannot collide with a real credentialed profile.
3. **Domain-fenced.** A non-empty `allowedDomains` allow-list is required
   (`external_bridge_requires_domains`) and enforced at navigation.
4. **Read-only + short-lived.** Capability is forced to `read-only` and the TTL is clamped to ≤ 5
   minutes.

And it is **off by default**: `acquire()` rejects an external-bridge lease with
`external_bridge_disabled` unless `FARM_ENABLE_EXTERNAL_BRIDGE` is exactly `"1"` (any other value —
unset, `"0"`, `"true"`, malformed — leaves it disabled; default-off is the failure mode).
`farm_capabilities` reports `externalBridgeEnabled` so an agent can see whether the tier is available.

## What it is NOT

It does **not** attach to or drive the user's real, logged-in browser — that remains a hard non-goal
(session-hijack surface + non-isolated/non-reproducible). The CDP cookie import stays CLI-only and
export-only and is never exposed over MCP. A prompt-injected external bridge has no real session
handle, nothing to exfiltrate, no way to tamper the hash-chained ledger, and no path out of its
domain fence.
