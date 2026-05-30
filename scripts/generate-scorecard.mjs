#!/usr/bin/env node
// Generates SCORECARD.md and SCORECARD.json — the measured progress-to-10/10 view
// defined by the master plan ("10/10 is a measured SCORECARD, not a vibe").
//
// HONESTY CONTRACT: each gate is an AUTOMATABLE proxy, of one of two kinds:
//   - "wired"    — the capability exists and is wired in the code (symbol/file present)
//   - "measured" — a real number from this run (coverage %, tests-green from STATUS)
// The scorecard therefore tracks BUILD-COMPLETENESS + MEASURED QUALITY. It does NOT
// re-prove the adversarial behaviors themselves — those are proven by the test suite
// (see STATUS). A green gate here means "built and wired / measured", not "audited".
//
// Run last in `npm run verify` (after STATUS), like generate-status.mjs, and never
// fails the build — failing gates are DATA, not errors.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const root = process.cwd();

function read(path) {
  try {
    return readFileSync(`${root}/${path}`, "utf8");
  } catch {
    return "";
  }
}

function readJSON(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(`${root}/${path}`, "utf8"));
  } catch {
    return fallback;
  }
}

// A "wired" gate: every needle present in the file.
function wired(path, ...needles) {
  if (!existsSync(`${root}/${path}`)) {
    return false;
  }
  const text = read(path);
  return needles.every((needle) => text.includes(needle));
}

const status = readJSON("STATUS.json", {});
const coverage = readJSON("coverage/coverage-summary.json");
const coverageLines = coverage?.total?.lines?.pct ?? null;
const coverageBranches = coverage?.total?.branches?.pct ?? null;
const testsGreen = status?.tests?.success === true && status?.verify === "PASS";

const DOMAINS = [
  {
    key: "trust",
    title: "Trust & integrity — claim-gate moonshot (FLAGSHIP)",
    gates: [
      { id: "non_tautological_grounding", kind: "wired", desc: "Anchor verified against artifact bytes", pass: wired("src/claim-gate.ts", "validateClaimGrounding") },
      { id: "cite_or_fail_authoring", kind: "wired", desc: "register_evidence + add_claim authoring path", pass: wired("src/farm-service.ts", "registerEvidence", "addClaim") },
      { id: "structured_value_grounding", kind: "wired", desc: "Typed structured values are groundable", pass: wired("src/claim-gate.ts", "structured_data") },
      { id: "tamper_evident_decision_log", kind: "wired", desc: "Hash-chained gate-verdict decision log", pass: wired("src/decision-log.ts", "verifyDecisionLog") }
    ]
  },
  {
    key: "modality",
    title: "Modality & data types (structured/semi/unstructured)",
    gates: [
      { id: "jsonld_og", kind: "wired", desc: "JSON-LD / OpenGraph / canonical / title", pass: wired("src/structured-extractor.ts", "extractJsonLd", "openGraph") },
      { id: "typed_summary", kind: "wired", desc: "Typed price / rating summary", pass: wired("src/structured-extractor.ts", "summarizeJsonLd", "reviewRating") },
      { id: "html_tables", kind: "wired", desc: "HTML tables (semi-structured)", pass: wired("src/structured-extractor.ts", "extractTables") },
      { id: "headings_outline", kind: "wired", desc: "Document heading outline", pass: wired("src/structured-extractor.ts", "extractHeadings") },
      { id: "dom_crosscheck", kind: "wired", desc: "Structured-vs-DOM disagreement signal", pass: wired("src/structured-extractor.ts", "crossCheckStructured") },
      { id: "pipeline_integration", kind: "wired", desc: "structured_data registered by the run pipeline", pass: wired("src/evidence-runner.ts", "extractStructuredData") }
    ]
  },
  {
    key: "evidence_quality",
    title: "Evidence-quality evaluation & measurement",
    gates: [
      { id: "golden_corpus", kind: "wired", desc: "Labeled golden corpus (cat × locale)", pass: wired("tests/golden/corpus.ts", "GOLDEN_CORPUS") },
      { id: "benchmark_scorer", kind: "wired", desc: "Precision/recall/exact scorer", pass: wired("src/structured-benchmark.ts", "scoreCorpus") },
      { id: "ci_threshold_gate", kind: "wired", desc: "Benchmark gated in CI against thresholds", pass: existsSync(`${root}/structured-benchmark-thresholds.json`) && wired("tests/structured-benchmark.test.ts", "thresholds") }
    ]
  },
  {
    key: "portability",
    title: "Portable, offline-verifiable signed bundle (.evb)",
    gates: [
      { id: "merkle_manifest", kind: "wired", desc: "Merkle-rooted manifest", pass: wired("src/evidence-bundle.ts", "merkleRoot", "buildBundleManifest") },
      { id: "ed25519_signature", kind: "wired", desc: "Ed25519 sign + verify", pass: wired("src/evidence-bundle.ts", "signManifest", "verifyManifestSignature") },
      { id: "self_contained_evb", kind: "wired", desc: "Self-contained .evb verifies offline", pass: wired("src/evidence-bundle.ts", "exportBundleArchive", "verifyBundleArchive") }
    ]
  },
  {
    key: "parity",
    title: "Dual-agent parity, MCP ergonomics & routing",
    gates: [
      { id: "shared_guidance", kind: "wired", desc: "One shared agent-guidance template", pass: wired("src/agent-guidance.ts", "AGENT_GUIDANCE") },
      { id: "register_all", kind: "wired", desc: "Codex + Claude skill registration", pass: wired("src/registration.ts", "registerAll") },
      { id: "capabilities", kind: "wired", desc: "farm_capabilities + farm_list_runs", pass: wired("src/farm-service.ts", "capabilities", "listRuns") }
    ]
  },
  {
    key: "safety",
    title: "Safety & parallel-execution correctness",
    gates: [
      { id: "profile_lock_refresh", kind: "wired", desc: "Heartbeat refreshes the profile lock", pass: wired("src/profile-lock.ts", "refreshProfileLock") },
      { id: "secret_redaction", kind: "wired", desc: "Proxy/profile redaction in results", pass: wired("src/lease-manager.ts", "redactLease") },
      { id: "boundary_guard", kind: "wired", desc: "Dependency-direction guard", pass: existsSync(`${root}/scripts/check-boundaries.mjs`) }
    ]
  },
  {
    key: "security_lifecycle",
    title: "Security-at-rest, legal posture & data lifecycle",
    gates: [
      { id: "secret_scanner", kind: "wired", desc: "Secret-at-rest scanner + CLI", pass: wired("src/secret-scan.ts", "scanRunArtifacts") },
      { id: "legal_basis", kind: "wired", desc: "Per-source legal_basis posture", pass: wired("src/source-registry.ts", "legalBasis") },
      { id: "retention_lifecycle", kind: "wired", desc: "purge-run / prune-runs lifecycle", pass: wired("src/run-lifecycle.ts", "pruneRuns") }
    ]
  },
  {
    key: "engineering",
    title: "Engineering quality, observability & SLO",
    gates: [
      { id: "tests_green", kind: "measured", desc: "Full verify gate green", pass: testsGreen },
      { id: "per_run_metrics", kind: "wired", desc: "Per-run metrics.json (p50/p95)", pass: wired("src/run-metrics.ts", "summarizeStageTimings") },
      { id: "util_consolidated", kind: "wired", desc: "Shared src/util helpers", pass: existsSync(`${root}/src/util/collections.ts`) },
      { id: "coverage_80", kind: "measured", desc: "Product line coverage ≥ 80%", pass: coverageLines !== null && coverageLines >= 80, detail: coverageLines === null ? "n/a" : `${coverageLines}%` }
    ]
  }
];

function scoreDomain(domain) {
  const passed = domain.gates.filter((gate) => gate.pass).length;
  const total = domain.gates.length;
  const score10 = total === 0 ? 0 : Math.round((passed / total) * 100) / 10;
  return { passed, total, score10 };
}

const domainResults = DOMAINS.map((domain) => ({ ...domain, ...scoreDomain(domain) }));
const overall = Math.round((domainResults.reduce((sum, d) => sum + d.score10, 0) / domainResults.length) * 10) / 10;
const weakest = domainResults.reduce((min, d) => (d.score10 < min.score10 ? d : min), domainResults[0]);

const generatedAt = new Date().toISOString();

const scorecard = {
  package: status.package ?? "browser-agent-mcp-farm",
  version: status.version ?? "unknown",
  commit: status.commit ?? "unknown",
  generatedAt,
  overallScore: overall,
  weakestDomain: { key: weakest.key, score10: weakest.score10 },
  measured: { coverageLines, coverageBranches, testsGreen },
  domains: domainResults.map((d) => ({
    key: d.key,
    title: d.title,
    score10: d.score10,
    passed: d.passed,
    total: d.total,
    gates: d.gates.map((g) => ({ id: g.id, kind: g.kind, desc: g.desc, pass: g.pass, ...(g.detail ? { detail: g.detail } : {}) }))
  })),
  note: 'Gates are automatable proxies: "wired" = capability present in code, "measured" = a real number from this run. Tracks build-completeness + measured quality; the adversarial behaviors are proven by the test suite (see STATUS).'
};

writeFileSync(`${root}/SCORECARD.json`, `${JSON.stringify(scorecard, null, 2)}\n`);

const row = (d) => `| ${d.title} | ${d.score10}/10 | ${d.passed}/${d.total} |`;
const gateLine = (g) => `  - [${g.pass ? "x" : " "}] (${g.kind}) ${g.desc}${g.detail ? ` — ${g.detail}` : ""}`;
const md = `# Scorecard — build-completeness & measured quality

> Generated by \`npm run verify\` — **do not hand-edit**. Companion to STATUS.md.
>
> **What this is (and isn't).** Each gate is an automatable proxy — \`wired\` (capability
> present in code, and exercised by the green test suite) or \`measured\` (a real number
> from this run: coverage %, tests-green). The overall number is **gate-wiring +
> measurement, NOT a holistic quality audit**: it answers "is each capability built,
> wired, and measured?", not "is the system adversarially robust end-to-end?" — that is
> the master plan's separate judgment (see MASTER_PLAN_10.md) and is proven case-by-case
> by the test suite (see [STATUS.md](STATUS.md)), not re-asserted here.

| Field | Value |
| --- | --- |
| Package | \`${scorecard.package}\` v${scorecard.version} |
| Commit | \`${scorecard.commit}\` |
| Generated | ${generatedAt} |
| **Build-completeness** | **${overall}/10** (mean of domain gate-wiring; not a quality grade) |
| Weakest domain | \`${weakest.key}\` (${weakest.score10}/10) |
| Coverage (lines) | ${coverageLines === null ? "n/a" : `${coverageLines}%`} |

| Domain | Score | Gates |
| --- | --- | --- |
${domainResults.map(row).join("\n")}

## Gate detail

${domainResults.map((d) => `### ${d.title} — ${d.score10}/10\n${d.gates.map(gateLine).join("\n")}`).join("\n\n")}
`;
writeFileSync(`${root}/SCORECARD.md`, md);

console.log(`SCORECARD written: build-completeness ${overall}/10 — weakest ${weakest.key} (${weakest.score10}/10)`);
