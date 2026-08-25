# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via **GitHub Security Advisories**
("Report a vulnerability" on this repository) rather than opening a public
issue. You should receive an initial response within a week. Please include a
minimal reproduction and the version (`browser-agent-mcp-farm --version` /
`package.json`).

## Supported versions

This is a pre-1.0 project maintained by one person. Only the **latest published
release** receives security fixes.

## Security posture (summary)

- **Local-first.** The MCP server runs over stdio for a local host by default.
  The optional HTTP mode (`serve-http`) binds to loopback; starting it on a
  non-loopback interface without a token is refused, and when `FARM_HTTP_TOKEN`
  (or `--token`) is set, every route requires the Bearer token.
- **Lawful refusal by design.** The farm does not bypass logins, CAPTCHAs,
  paywalls, or age gates, and refuses payment/booking/account-change flows.
  Authenticated capture only happens through a user-consented, per-profile
  login flow (`auth-login`).
- **Credentials at rest.** Browser profiles live in an owner-only directory
  (`0700` / Windows ACL). On Windows, `FARM_ENCRYPT_STORAGE_STATE=1` wraps the
  Playwright storage state with DPAPI (CurrentUser). See
  [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for exactly what this does and
  does not defend against.
- **Evidence integrity ≠ truth.** The claim gate and Merkle bundle prove
  byte-integrity and citation-grounding of registered evidence — they do NOT
  prove the captured bytes faithfully represent the live page. The threat model
  documents this boundary honestly; please read it before relying on a bundle
  in a dispute.

## Scope notes for researchers

Findings we consider in scope: token-auth bypass on `serve-http`, path
traversal in artifact read/write, claim-gate integrity bypass (a tampered
artifact or manifest passing verification), credential-at-rest handling bugs,
and prompt-injection vectors that cause the farm itself to exceed its refusal
boundaries. Out of scope: the honesty limits already documented in
`docs/THREAT_MODEL.md` (e.g., a malicious *producer* registering fabricated
bytes — the gate does not claim to prevent that).
