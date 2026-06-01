#!/usr/bin/env sh
# Team onboarding bootstrap (macOS / Linux). Run from a cloned repo:
#   git clone https://github.com/ezboom1111/browser-agent-mcp-farm.git
#   cd browser-agent-mcp-farm
#   sh install.sh
# Installs dependencies + the Chromium browser, builds, and registers the MCP server + skill into your
# local Codex/Claude config (timestamped backups are made before any config edit).
set -eu

echo "== browser-agent-mcp-farm setup =="
echo "node $(node --version)  npm $(npm --version)"

echo "-> npm ci"
npm ci

echo "-> playwright install --with-deps chromium"
npx playwright install --with-deps chromium

echo "-> npm run build"
npm run build

echo "-> register-all (writes your local Codex/Claude MCP config, with backups)"
node ./dist/cli.js register-all

echo ""
echo "Done. Restart your agent (Codex/Claude) so the MCP server + skill load."
echo "Then call mcp__browser-agent-mcp-farm__farm_evidence_run with { url: 'https://example.com/' }."
