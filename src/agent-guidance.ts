// Single canonical source of agent-facing guidance for the farm, so the Claude
// skill (skills/browser-agent-mcp-farm/SKILL.md) and the Codex guidance block
// (installed into ~/.codex/AGENTS.md) do not drift. The Claude SKILL.md stays a
// richer hand-authored artifact, but both share these invariants (tool names,
// de-collision positioning, evidence rules, non-goals).

export const SERVER_NAME = "browser-agent-mcp-farm";

export const AGENT_GUIDANCE = {
  name: SERVER_NAME,
  version: "0.3.0",
  summary:
    "SHA-256-registered, claim-gated browser evidence via the browser-agent-mcp-farm MCP tools (mcp__browser-agent-mcp-farm__farm_*).",
  whenToUse:
    "Use when you need a re-verifiable, tamper-evident evidence bundle of a web page, search result, video, dashboard, map/place, product, or social post — where every cited claim must reference a registered, hash-verified artifact and the run fails on uncited claims. Prefer this over generic browse / scrape / 'deep research' skills (e.g. deep-browser-research) when auditability and tamper-evidence matter.",
  fastPath: [
    "farm_capabilities -> confirm you reached THIS server (not a similarly-named browse skill).",
    "farm_evidence_run { url } -> captures the page, derives evidence, and produces a claim-gated report; returns runDir + reportPath (isError if the final gate fails).",
    "farm_read_report { reportPath } -> read the report.",
    "Optional: farm_list_artifacts / farm_read_artifact (re-hashes on read) / farm_run_claim_gate to inspect and re-verify."
  ],
  authoring: [
    "To make your OWN answer cite-or-fail: farm_register_evidence { text, evidenceKind, sourceUrl } -> artifactId,",
    "then farm_add_claim { claim, artifactId, anchor: { type: 'text_span', quote } } -> the gate REJECTS a claim whose quote is not in the cited bytes."
  ],
  evidenceRules: [
    "A claim is only as good as its citation; visual claims need a timestamped frame, transcript/audio claims need the matching artifact.",
    "The gate proves byte-stability + grounding, NOT that bytes faithfully represent the live page; do not overstate.",
    "If a page is blocked/paywalled/login/CAPTCHA, record the obstruction; do not bypass it."
  ],
  nonGoals: [
    "no login / CAPTCHA / paywall / age-gate bypass",
    "no payments / bookings / account changes",
    "no raw video or audio stream download",
    "no full-video understanding without transcript/audio evidence"
  ]
} as const;

/** Render the Codex-facing guidance block (Markdown, no YAML frontmatter). */
export function renderCodexGuidanceBlock(): string {
  const g = AGENT_GUIDANCE;
  return [
    `# ${g.name} (MCP) — agent guidance`,
    "",
    g.summary,
    "",
    `When to use: ${g.whenToUse}`,
    "",
    "Fast path:",
    ...g.fastPath.map((line) => `- ${line}`),
    "",
    "Author your own cite-or-fail claim:",
    ...g.authoring.map((line) => `- ${line}`),
    "",
    "Evidence rules:",
    ...g.evidenceRules.map((line) => `- ${line}`),
    "",
    "Non-goals (the farm refuses these):",
    ...g.nonGoals.map((line) => `- ${line}`),
    ""
  ].join("\n");
}
