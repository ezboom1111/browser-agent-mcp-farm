// Property-based fuzz QA: generate thousands of randomized pages with KNOWN injected facts and KNOWN
// fabrications, then measure whether the cite-or-fail gate EVER passes a fabrication (the hallucination
// leak rate) and how much it recalls. A seeded PRNG makes it deterministic/reproducible; the randomized
// generator is the oracle, removing the "self-authored fixture" bias of the hand-written sector suite.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FarmService } from "../dist/farm-service.js";
import { extractTypedFacts } from "../dist/typed-facts.js";

const SEED = 0x9e3779b9;
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

const ENTITIES = ["Alpha", "Bravo", "Cortex", "Delta", "Equinox", "Falcon", "Granite", "Helio", "Ionix", "Jasper"];
const WORDS = ["market", "growth", "revenue", "users", "launch", "study", "report", "quarter", "region", "product", "service", "update", "trend", "sector", "value", "result", "cohort", "segment", "forecast", "demand", "margin", "retention"];
const withCommas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const genPrice = () => `$${withCommas(int(1000, 99999))}.${String(int(0, 99)).padStart(2, "0")}`;
const genRating = () => `${int(1, 4)}.${int(0, 9)}/5`;
const genPct = () => `${int(1, 99)}%`;
const genDate = () => `20${int(20, 29)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;
const sentence = () => Array.from({ length: int(5, 11) }, () => pick(WORDS)).join(" ");

// A page with: two "<Entity> grew <pct>" sentences (for the recombination attack), plus random
// price/rating/date facts embedded in prose. Returns the visible text + the ground-truth facts.
function genPage() {
  const facts = [];
  const e1 = pick(ENTITIES);
  let e2 = pick(ENTITIES);
  while (e2 === e1) e2 = pick(ENTITIES);
  const p1 = genPct();
  let p2 = genPct();
  while (p2 === p1) p2 = genPct();
  const lines = [`${e1} grew ${p1} last year.`, `${e2} grew ${p2} this year.`];
  facts.push({ kind: "percentage", raw: p1 }, { kind: "percentage", raw: p2 });
  for (const [kind, gen] of [
    ["price", genPrice],
    ["rating", genRating],
    ["date", genDate]
  ]) {
    if (rng() < 0.85) {
      const raw = gen();
      lines.push(`The ${pick(WORDS)} ${kind} is ${raw} as observed.`);
      facts.push({ kind, raw });
    }
  }
  for (let i = 0; i < int(2, 5); i++) lines.splice(int(0, lines.length), 0, `${sentence()}.`);
  return { text: lines.join(" "), facts, e1, e2, p1, p2 };
}

// Mutate a fact's last digit so it is a NEAR-MISS not present verbatim in the text.
function nearMiss(raw, text) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const digits = [...raw].map((c, i) => ({ c, i })).filter((x) => /\d/.test(x.c));
    const d = pick(digits);
    const newDigit = String((Number(d.c) + int(1, 8)) % 10);
    const mutated = raw.slice(0, d.i) + newDigit + raw.slice(d.i + 1);
    if (mutated !== raw && !text.includes(mutated)) return mutated;
  }
  return null;
}

async function run() {
  const svc = new FarmService();
  const N_GATE = 400; // pages through the full register -> add_claim -> gate path
  const N_RECALL = 5000; // pages through pure typed-fact extraction (fast)

  // ---- Gate precision: does a fabrication EVER pass? (the hallucination leak rate) ----
  const tally = { groundedPass: 0, groundedN: 0, fabBlocked: 0, fabN: 0, nearBlocked: 0, nearN: 0, recombSpanBlocked: 0, recombSpanN: 0, recombAggPass: 0, recombAggN: 0, recombAggWarned: 0 };
  const leaks = [];
  for (let i = 0; i < N_GATE; i++) {
    const pg = genPage();
    const url = `https://fuzz-${i}.example.com/p`;
    const newDir = async () => mkdtemp(join(tmpdir(), `fuzz-${i}-`));
    const dirs = [];
    const claim = async (anchor, taxonomy) => {
      const d = await newDir();
      dirs.push(d);
      const reg = await svc.registerEvidence({ runDir: d, sourceUrl: url, text: pg.text, evidenceKind: "page_text" });
      return svc.addClaim({ runDir: d, artifactId: reg.artifactId, claim: "c", claimType: "text", evidenceKind: "page_text", verificationLevel: "grounded", ...(taxonomy ? { claimTaxonomy: taxonomy } : {}), anchor });
    };

    // 1) GROUNDED span (control): a real fact verbatim -> must PASS.
    const realFact = pick(pg.facts);
    tally.groundedN++;
    if ((await claim({ type: "text_span", quote: realFact.raw })).ok) tally.groundedPass++;

    // 2) PURE FABRICATION span: a generated value not present -> must BLOCK.
    let fab = genPrice();
    while (pg.text.includes(fab)) fab = genPrice();
    tally.fabN++;
    if (!(await claim({ type: "text_span", quote: fab })).ok) tally.fabBlocked++;
    else leaks.push(`fab span passed: ${fab}`);

    // 3) NEAR-MISS span: a real fact with one digit changed -> must BLOCK.
    const nm = nearMiss(realFact.raw, pg.text);
    if (nm) {
      tally.nearN++;
      if (!(await claim({ type: "text_span", quote: nm })).ok) tally.nearBlocked++;
      else leaks.push(`near-miss span passed: ${nm} (real ${realFact.raw})`);
    }

    // 4) RECOMBINATION as a SPAN quote: "<e1> grew <p2>" (each token real, phrase FALSE) -> must BLOCK.
    const falsePhrase = `${pg.e1} grew ${pg.p2}`; // e1 actually grew p1, not p2
    if (!pg.text.includes(falsePhrase)) {
      tally.recombSpanN++;
      if (!(await claim({ type: "text_span", quote: falsePhrase })).ok) tally.recombSpanBlocked++;
      else leaks.push(`recomb span passed: ${falsePhrase}`);
    }

    // 5) RECOMBINATION as an AGGREGATED claim (token-match mode): tokens all present, meaning FALSE.
    //    Token-presence passes (the weakness), but the new scatter WARNING should fire.
    tally.recombAggN++;
    const ra = await claim({ type: "text_span", quote: falsePhrase, normalizedTokens: [pg.e1.toLowerCase(), "grew", pg.p2] }, "aggregated");
    if (ra.ok) tally.recombAggPass++;
    if ((ra.gate?.warnings ?? []).some((w) => /scattered/.test(w))) tally.recombAggWarned++;

    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  }

  // ---- Typed-fact recall over many pages (pure, fast) ----
  const recall = { price: { hit: 0, n: 0 }, rating: { hit: 0, n: 0 }, percentage: { hit: 0, n: 0 }, date: { hit: 0, n: 0 } };
  for (let i = 0; i < N_RECALL; i++) {
    const pg = genPage();
    const found = new Set(extractTypedFacts(pg.text).map((f) => `${f.kind}:${f.raw}`));
    for (const f of pg.facts) {
      recall[f.kind].n++;
      if (found.has(`${f.kind}:${f.raw}`)) recall[f.kind].hit++;
    }
  }

  // ---- REPORT ----
  const pct = (a, b) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`);
  console.log("\n================ PROPERTY-BASED FUZZ QA (seed-deterministic) ================\n");
  console.log(`Gate trials: ${N_GATE} pages.   Recall trials: ${N_RECALL} pages.\n`);
  console.log("-- GATE PRECISION (the hallucination leak rate) --");
  console.log(`  grounded span (control) PASS:      ${tally.groundedPass}/${tally.groundedN}  (${pct(tally.groundedPass, tally.groundedN)})  [want 100% — real facts accepted]`);
  console.log(`  pure fabrication BLOCKED:          ${tally.fabBlocked}/${tally.fabN}  (${pct(tally.fabBlocked, tally.fabN)})  [want 100%]`);
  console.log(`  near-miss BLOCKED:                 ${tally.nearBlocked}/${tally.nearN}  (${pct(tally.nearBlocked, tally.nearN)})  [want 100%]`);
  console.log(`  recombination (SPAN) BLOCKED:      ${tally.recombSpanBlocked}/${tally.recombSpanN}  (${pct(tally.recombSpanBlocked, tally.recombSpanN)})  [want 100%]`);
  const spanLeaks = tally.fabN - tally.fabBlocked + (tally.nearN - tally.nearBlocked) + (tally.recombSpanN - tally.recombSpanBlocked);
  console.log(`\n  >>> SPAN-MODE HALLUCINATION LEAKS: ${spanLeaks} / ${tally.fabN + tally.nearN + tally.recombSpanN}  (default quote mode)`);
  console.log(`  recombination (AGGREGATED token mode) PASS: ${tally.recombAggPass}/${tally.recombAggN}  (${pct(tally.recombAggPass, tally.recombAggN)})  [KNOWN WEAKNESS — tokens present, meaning false]`);
  console.log(`  ...of which the gate WARNED (scatter):     ${tally.recombAggWarned}/${tally.recombAggN}  (${pct(tally.recombAggWarned, tally.recombAggN)})  [new hardening surfaces the recombination]`);
  console.log("\n-- TYPED-FACT RECALL --");
  for (const k of ["price", "rating", "percentage", "date"]) console.log(`  ${k.padEnd(11)} ${pct(recall[k].hit, recall[k].n)}  (${recall[k].hit}/${recall[k].n})`);
  if (leaks.length) {
    console.log("\n-- SPAN LEAK SAMPLES --");
    for (const l of leaks.slice(0, 8)) console.log("  ! " + l);
  }
  console.log("\n================ VERDICT ================");
  console.log(spanLeaks === 0 ? "SPAN MODE: 0 hallucination leaks across all fabrication/near-miss/recombination trials — the default cite-or-fail boundary held." : `SPAN MODE: ${spanLeaks} LEAK(S) — investigate.`);
  console.log(`AGGREGATED MODE: ${pct(tally.recombAggPass, tally.recombAggN)} of semantically-false recombinations passed (the documented token-match weakness; quantified — use farm_judge_claim / text_span for high assurance).`);

  // Tier 4: this is a regression GATE, not just a report. Any span-mode hallucination leak, any
  // false-reject of a real fact, or recall below 99% on the generated formats exits non-zero.
  const recallOk = ["price", "rating", "percentage", "date"].every((k) => recall[k].n === 0 || recall[k].hit / recall[k].n >= 0.99);
  const noFalseReject = tally.groundedPass === tally.groundedN;
  const pass = spanLeaks === 0 && noFalseReject && recallOk;
  console.log(`\nGATE: ${pass ? "PASS" : "FAIL"}  (span leaks=${spanLeaks}, grounded ${tally.groundedPass}/${tally.groundedN}, recall>=99%=${recallOk})`);
  if (!pass) {
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error("FUZZ ERROR:", e);
  process.exitCode = 1;
});
