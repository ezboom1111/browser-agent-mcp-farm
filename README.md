# Browser-Agent MCP Farm

Local generic browser research farm exposed as an MCP stdio server.

## Scope

This package implements the local v0.2 slice:

- Playwright BrowserContext per lease
- lease ownership, TTL, heartbeat, max page, and domain checks
- read-only page open/capture
- read-write browser actions except payment-like pages
- storage-state and persistent-profile modes
- profile lock to prevent concurrent writes to the same saved login state
- proxy and fingerprint options per lease
- artifact bundle writer with hashes, including image-like media artifacts and media indexes
- structured transcript artifacts parsed from legitimately captured WebVTT files
- MCP stdio server wrapper
- Codex and Claude MCP auto-registration
- wait, selector wait, scroll, and capture-after-idle tools
- timestamped browser-visible frame sampling for media elements
- unit and smoke tests

Out of scope:

- payment actions
- DRM bypass or raw platform video download
- remote multi-user server
- packaged distribution

## Commands

```powershell
npm install
npm test
npm run build
npm run verify
node .\dist\cli.js serve
node .\dist\cli.js smoke
node .\dist\cli.js smoke-web --timeout-ms 10000
node .\dist\cli.js smoke-media
node .\dist\cli.js smoke-proxy
node .\dist\cli.js claim-gate --run-dir <path> --mode final --min-claims 1
node .\dist\cli.js html-preview --run-dir <path>
node .\dist\cli.js critique-next --queue <path>
node .\dist\cli.js critique-complete --queue <path> --task-id MEDIA-CRIT-01
node .\dist\cli.js platform-capabilities --url https://www.youtube.com/watch?v=dQw4w9WgXcQ
node .\dist\cli.js evidence-run --url https://www.youtube.com/watch?v=dQw4w9WgXcQ --timestamps-sec 0,10
node .\dist\cli.js auth-login --profile my-site --url https://example.com/login --wait-ms 120000
node .\dist\cli.js profile-list
node .\dist\cli.js register-all
```

`claim-gate` exits non-zero when a claim cites missing or unregistered
evidence. In `--mode final`, it also fails zero-claim reports by default.

`smoke-media` serves a local page with PNG, SVG, poster, VTT, and video
resources. Image-like resources and VTT files are written under `media/`;
captured VTT files are also parsed into `structured/*.transcripts/*.json`.
Video/audio/stream resources are indexed in `structured/*.media-index.json`
unless a legitimate byte source is captured without bypassing platform limits.

`html-preview` writes `html/farm-evidence-preview.html` with screenshot
thumbnails and links to raw artifacts.

`critique-next` prints exactly one next media critical review task. It does not
mutate the queue. `critique-complete` advances the queue only when that task's
configured output file exists and is non-empty, so a 10-round review cannot be
collapsed into one untracked response.

`platform-capabilities` prints a static, source-linked capability map for
YouTube, Instagram, TikTok, or a generic browser fallback. It does not fetch the
URL; it labels each evidence path as `available`, `unavailable`, or
`not_attempted` with credential and legal constraints.

`evidence-run` is the first-class workflow wrapper: it writes platform
capability artifacts, attempts a browser page capture, samples timestamped
browser-visible frames unless `--no-frames` is set, writes an assessment report,
adds claim/citation ledgers, and runs the final claim gate. Audio and transcript
understanding remain marked unverified unless an authorized caption body or
audio transcription artifact exists in the run.

`auth-login` opens a visible browser and saves storage state under
`~/.gstack/browser-profiles/<profile>/storage-state.json`. Use it for normal
service login flows: the site opens its login/consent popup, the user finishes
login manually, then the saved profile can be reused by farm leases. Add
`--persistent-profile` when the site needs a full Chromium user data directory
instead of storage-state only.

Only one active lease may use a given saved profile at a time. This prevents two
browser workers from overwriting the same cookies, localStorage, or IndexedDB
snapshot.

Payment pages remain blocked for write actions.

`register-all` installs the MCP server into the local Codex and Claude user
configs and creates timestamped backups before editing config files.

## GStack Upgrade Safety

This farm is stored in this project at `.gstack/tools/browser-agent-mcp-farm/`
and runs from the absolute path registered in Codex/Claude config. A normal
gstack skill upgrade updates `~/.codex/skills/gstack*`; it should not overwrite
this local package or the MCP config marker block.

After any gstack or agent-host upgrade, run:

```powershell
npm run verify
node .\dist\cli.js register-all
claude mcp get browser-agent-mcp-farm
```

If Codex does not expose `mcp__browser_agent_mcp_farm__*` tools after an
upgrade, restart Codex once and run `register-all` again.

## MCP Write Tools

Write tools require a lease with `capability: "read-write"`:

- `farm_click`
- `farm_fill`
- `farm_press`
- `farm_select_option`

Read/navigation helpers are available for slower dynamic pages and long-scroll
research pages:

- `farm_wait`
- `farm_wait_for_selector`
- `farm_scroll`
- `farm_capture_after_idle`
- `farm_sample_frames`

`farm_sample_frames` seeks a browser-visible media element to timestamped
positions and writes one screenshot bundle per frame. It does not download raw
video bytes. Each frame metadata includes timestamp, seek result, and active
caption cues when the page exposes them. It also records available `<track>`
elements and text-track metadata in the summary artifact.

The payment guard blocks write actions on URLs, selectors, and target element
text/attributes containing payment-like terms such as `checkout`, `payment`,
`billing`, `credit-card`, `card number`, `cvv`, `pay now`, or `결제`.
