# Host Adapter Guide

This package is host-neutral. Claude, Codex, or another agent host can use it
through one of two modes.

## Mode A: Parent-Driven Farm

Use this when subagents cannot call MCP tools directly.

Flow:

```text
parent agent
  -> starts browser-agent-mcp-farm serve
  -> acquires context leases
  -> opens pages and captures artifacts
  -> releases contexts
  -> gives saved artifacts to analyzer/critic subagents
```

Properties:

- safest default
- works even when subagents have no MCP access
- keeps browser control in one place
- subagents reason from saved files, not volatile browser state

Use for Codex when subagents cannot directly receive MCP tools.

## Mode B: Browser-Worker Subagents

Use this only when the host can explicitly grant farm MCP tools to the worker
agent.

Required worker contract:

```text
1. receive one task and domain allowlist
2. acquire context with its own agentId
3. open only allowed URLs
4. capture artifacts
5. release context in finally block
6. return artifact ids and coverage gaps to parent
```

Worker agents must not:

- reuse another agent's context token
- browse outside the domain allowlist
- summarize without saving artifacts
- perform payment actions

Worker agents may use read-write tools when the parent grants
`capability: "read-write"`.

When workers need authenticated access, assign a dedicated `profileName` per
site/account. The farm locks a profile while a lease is active so two workers do
not write the same cookie jar or storage-state file at the same time.

When workers need proxy or fingerprint variance, pass proxy/fingerprint settings
on `farm_acquire_context`; they are lease-scoped and do not change other
workers.

## Claude Notes

Claude can use this package as a stronger replacement for single-profile
Chrome tab browsing when it is registered as an MCP server. Claude subagents
still need explicit tool permissions. If the subagent has no farm tools, use
Mode A.

Local registration:

```powershell
node .\dist\cli.js register-claude
claude mcp get browser-agent-mcp-farm
```

## Codex Notes

Codex can run the package locally and use the CLI today:

```powershell
npm run build
node .\dist\cli.js smoke --run-dir <run>
node .\dist\cli.js smoke-web --run-dir <run> --timeout-ms 10000
node .\dist\cli.js smoke-proxy --run-dir <run>
node .\dist\cli.js claim-gate --run-dir <run>
node .\dist\cli.js html-preview --run-dir <run>
node .\dist\cli.js auth-login --profile <name> --url <login-url>
```

For local MCP use, register automatically:

```powershell
node .\dist\cli.js register-codex
```

The command writes a managed marker block to `~/.codex/config.toml` and backs up
the previous config. Manual equivalent:

```json
{
  "mcpServers": {
    "browser-agent-mcp-farm": {
      "command": "node",
      "args": ["<package>/dist/cli.js", "serve"]
    }
  }
}
```

Exact registration location depends on the host. Do not store credentials in
the MCP config.

## Login Profile Flow

For ordinary services that require browser login:

```powershell
node .\dist\cli.js auth-login --profile service-name --url https://service.example/login --wait-ms 180000
```

The command opens a visible browser. Finish login, OAuth consent, or "connect
account" popups manually, then press Enter in the terminal. Future leases can
reuse `profileName: "service-name"`. For sites that store auth outside normal
storage-state, add `--persistent-profile`.

Do not use the farm for payment, card, checkout, billing, or purchase flows.

## Version Sync Rule

Keep these shared across hosts:

- lease schema
- artifact schema
- claim gate behavior
- HTML preview behavior
- smoke tests
- authenticated storage-state profiles
- payment guard behavior

Allow host-specific docs or subagent frontmatter to differ.
