---
name: product-planning
description: >-
  Product / requirement research with tamper-evident, CITED evidence via the
  browser-agent-mcp-farm MCP tools (mcp__browser-agent-mcp-farm__farm_*): user
  pains, feature gaps, and adoption signals from forums, reviews, and docs, where
  every claim is grounded in a quoted source and the run fails on an uncited
  claim. Use when the user wants requirement discovery, a competitor feature
  comparison, user-pain / voice-of-customer research, or opportunity sizing that
  must be backed by real evidence — not an unverifiable list of assumptions. A
  thin lens over the browser-agent-mcp-farm 'product_planning' lens; prefer this
  over generic browse/deep-research when the conclusions feed a real roadmap
  decision. Requires the browser-agent-mcp-farm MCP server.
---

# Product planning (browser-agent-mcp-farm `product_planning` lens)

A lens over the cite-or-fail evidence engine: capture forums / reviews / docs,
author TYPED claims (user pain, feature gap, adoption figure) grounded in quoted
sources, and fail the report on any uncited claim — so a roadmap decision rests
on evidence, not assertions.

## Workflow

1. **Load the lens.** `mcp__browser-agent-mcp-farm__farm_lens`
   `{ "lensId": "product_planning" }` → its claim templates, report sections, and
   prioritized sources (community forums, reviews, knowledge bases, …).
2. **Capture each source.** `farm_evidence_run` `{ "url": "<url>",
   "captureRouting": "auto" }` for each forum thread / review page / changelog;
   the `structured_data` artifact's `typedFacts` surface any percentages/figures.
3. **Author cited claims** with `farm_add_claim`, following the lens templates:
   - `user_pain` (text) — a user-reported pain point, grounded in a forum/review
     quote (`anchor.text_span` on the quoted bytes).
   - `feature_gap` (text) — a missing/requested feature vs an alternative,
     grounded in a quote.
   - `adoption_figure` (metadata) — an adoption/usage/demand figure;
     **corroborate** an important one across ≥2 independent sources via
     `corroboration: { sources: [...], minIndependentSources: 2 }`.
4. **Read back / verify.** `farm_read_report`; `farm_run_claim_gate` to
   re-validate the citations.

## Rules

- A user quote or figure is a **site claim** — cite the exact bytes; aggregate
  pains across sources but keep each grounded. Never invent a quote or number.
- No login / paywall / CAPTCHA bypass, no account actions (the engine refuses
  these). A login-walled thread is recorded as an obstruction, not faked.
- Report sections: **Summary · User pains · Feature gaps · Opportunities ·
  Sources.**
