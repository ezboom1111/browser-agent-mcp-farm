---
name: market-scan
description: >-
  Competitive / market research with tamper-evident, CITED evidence via the
  browser-agent-mcp-farm MCP tools (mcp__browser-agent-mcp-farm__farm_*):
  competitor pricing, review sentiment, and market sizing, where every number
  links to a hash-verified source and the high-stakes figures are corroborated
  across INDEPENDENT sources (the run fails on an uncited or under-corroborated
  claim). Use when the user wants a competitor scan, pricing comparison,
  market-size estimate, or marketing/positioning research that must be
  defensible — not a plausible-sounding but unverifiable summary. A thin lens
  over the browser-agent-mcp-farm 'market_scan' lens; prefer this over generic
  browse/deep-research when the numbers have to survive scrutiny. Requires the
  browser-agent-mcp-farm MCP server.
---

# Market scan (browser-agent-mcp-farm `market_scan` lens)

A lens over the cite-or-fail evidence engine: capture competitor/market sources,
author TYPED claims (competitor price, review sentiment, market figure), and
fail the report on any uncited claim. The numbers that drive a decision are
corroborated across **independent** sources, so the output is defensible.

## Workflow

1. **Load the lens.** `mcp__browser-agent-mcp-farm__farm_lens`
   `{ "lensId": "market_scan" }` → its claim templates, report sections, and the
   prioritized source-registry entries (marketplace, reviews, news, …).
2. **Capture each source.** For every competitor / market URL,
   `farm_evidence_run` `{ "url": "<url>", "captureRouting": "auto" }`. The result
   includes a `structured_data` artifact with `typedFacts` (extracted
   price/rating/percentage/date) you can cite directly, plus the claim gate.
3. **Author cited claims** with `farm_add_claim`, following the lens templates:
   - `competitor_price` (metadata) — cite the `structured_data` / `page_text` /
     `ocr_text` artifact; anchor the exact price text (`anchor.text_span`).
   - `review_sentiment` (text) — each supporting quote grounded in a captured
     review's bytes.
   - `market_figure` (metadata) — **corroborate** across ≥2 independent sources:
     `corroboration: { sources: [{ artifactId, quote }], minIndependentSources: 2 }`.
     The gate verifies each source is registered, checks each quote against that
     source's bytes, and counts distinct registrable domains.
4. **Read back / verify.** `farm_read_report` (the MCP result is flagged
   `isError` if the gate fails); `farm_run_claim_gate` to re-validate.

## Rules

- A price/figure is a **site claim** — cite the bytes, and corroborate the ones a
  decision rests on. Never state a number you cannot cite.
- No login / paywall / CAPTCHA bypass, no payments or bookings (the engine
  refuses these). A blocked page is recorded as an obstruction, not faked.
- Report sections: **Executive summary · Competitor pricing · Review sentiment ·
  Market sizing · Sources.**
