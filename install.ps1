#Requires -Version 5.1
# Team onboarding bootstrap (Windows). Run from a cloned repo:
#   git clone https://github.com/ezboom1111/browser-agent-mcp-farm.git
#   cd browser-agent-mcp-farm
#   ./install.ps1
# It installs dependencies + the Chromium browser, builds, and registers the MCP server + skill into
# your local Codex/Claude config (timestamped backups are made before any config edit).
$ErrorActionPreference = 'Stop'

Write-Host '== browser-agent-mcp-farm setup ==' -ForegroundColor Cyan
Write-Host "node $(node --version)  npm $(npm --version)"

Write-Host '-> npm ci' -ForegroundColor Cyan
npm ci

Write-Host '-> playwright install chromium' -ForegroundColor Cyan
npx playwright install chromium

Write-Host '-> npm run build' -ForegroundColor Cyan
npm run build

Write-Host '-> register-all (writes your local Codex/Claude MCP config, with backups)' -ForegroundColor Cyan
node ./dist/cli.js register-all

Write-Host ''
Write-Host 'Done. Restart your agent (Codex/Claude) so the MCP server + skill load.' -ForegroundColor Green
Write-Host "Then call mcp__browser-agent-mcp-farm__farm_evidence_run with { url: 'https://example.com/' }."
