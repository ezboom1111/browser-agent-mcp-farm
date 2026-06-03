// Property-based fuzz QA: generate thousands of randomized pages with KNOWN injected facts and KNOWN
// fabrications, then measure whether the cite-or-fail gate EVER passes a fabrication (the hallucination
// leak rate) and how much it recalls. A seeded PRNG makes it deterministic/reproducible; the randomized
// generator is the oracle, removing the "self-authored fixture" bias of the hand-written sector suite.
//
// The seeds come from a VERSIONED CORPUS (scripts/fuzz-corpus.json): every seed runs on every pass
// (regression), and a new hard case is added by appending a seed — never by removing one. The gate is
// enforced on the POOLED result across the whole corpus: any span-mode hallucination leak, any
// false-reject of a real fact, or pooled typed-fact recall below 99% exits non-zero.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FarmService } from "../dist/farm-service.js";
import { extractTypedFacts } from "../dist/typed-facts.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ENTITIES = ["Alpha", "Bravo", "Cortex", "Delta", "Equinox", "Falcon", "Granite", "Helio", "Ionix", "Jasper"];
const WORDS = ["market", "growth", "revenue", "users", "launch", "study", "report", "quarter", "region", "product", "service", "update", "trend", "sector", "value", "result", "cohort", "segment", "forecast", "demand", "margin", "retention"];
const withCommas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// One deterministic seed's full battery: gate trials (fabrication / near-miss / recombination) + typed-fact
// recall. Identical semantics to the original single-seed harness; only the seed and budgets are injected.
async function runSeed(svc, seed, nGate, nRecall) {
  const rng = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
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

  const tally = { groundedPass: 0, groundedN: 0, fabBlocked: 0, fabN: 0, nearBlocked: 0, nearN: 0, recombSpanBlocked: 0, recombSpanN: 0, recombAggPass: 0, recombAggN: 0, recombAggWarned: 0 };
  const leaks = [];
  for (let i = 0; i < nGate; i++) {
    const pg = genPage();
    const url = `https://fuzz-${seed}-${i}.example.com/p`;
    const newDir = async () => mkdtemp(join(tmpdir(), `fuzz-${seed}-${i}-`));
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
  for (let i = 0; i < nRecall; i++) {
    const pg = genPage();
    const found = new Set(extractTypedFacts(pg.text).map((f) => `${f.kind}:${f.raw}`));
    for (const f of pg.facts) {
      recall[f.kind].n++;
      if (found.has(`${f.kind}:${f.raw}`)) recall[f.kind].hit++;
    }
  }

  const spanLeaks = tally.fabN - tally.fabBlocked + (tally.nearN - tally.nearBlocked) + (tally.recombSpanN - tally.recombSpanBlocked);
  return { tally, recall, leaks, spanLeaks };
}

async function run() {
  const corpus = JSON.parse(await readFile(join(HERE, "fuzz-corpus.json"), "utf8"));
  // Per-seed budgets are split so the whole corpus costs ~the same as the original single seed
  // (total gate pages ~= seeds * N_GATE). Override for a deeper local sweep.
  const N_GATE = Number(process.env.FARM_FUZZ_GATE_PAGES ?? 50); // pages/seed through the full register -> add_claim -> gate path
  const N_RECALL = Number(process.env.FARM_FUZZ_RECALL_PAGES ?? 1000); // pages/seed through pure typed-fact extraction (fast)

  const svc = new FarmService();
  const agg = { groundedPass: 0, groundedN: 0, fabBlocked: 0, fabN: 0, nearBlocked: 0, nearN: 0, recombSpanBlocked: 0, recombSpanN: 0, recombAggPass: 0, recombAggN: 0, recombAggWarned: 0 };
  const aggRecall = { price: { hit: 0, n: 0 }, rating: { hit: 0, n: 0 }, percentage: { hit: 0, n: 0 }, date: { hit: 0, n: 0 } };
  let aggSpanLeaks = 0;
  const allLeaks = [];
  const perSeed = [];

  for (const entry of corpus.seeds) {
    const r = await runSeed(svc, entry.seed >>> 0, N_GATE, N_RECALL);
    for (const k of Object.keys(agg)) agg[k] += r.tally[k];
    for (const k of Object.keys(aggRecall)) {
      aggRecall[k].hit += r.recall[k].hit;
      aggRecall[k].n += r.recall[k].n;
    }
    aggSpanLeaks += r.spanLeaks;
    for (const l of r.leaks) allLeaks.push(`[${entry.hex}] ${l}`);
    perSeed.push({ hex: entry.hex, spanLeaks: r.spanLeaks });
  }

  // ---- REPORT ----
  const pct = (a, b) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`);
  const totalSpanTrials = agg.fabN + agg.nearN + agg.recombSpanN;
  console.log("\n================ PROPERTY-BASED FUZZ QA (versioned corpus, seed-deterministic) ================\n");
  console.log(`Corpus v${corpus.version}: ${corpus.seeds.length} seeds.   Per seed: ${N_GATE} gate pages, ${N_RECALL} recall pages.`);
  console.log(`Totals: ${corpus.seeds.length * N_GATE} gate pages, ${totalSpanTrials} span-mode trials, ${corpus.seeds.length * N_RECALL} recall pages.\n`);
  console.log("-- GATE PRECISION (the hallucination leak rate, pooled across the corpus) --");
  console.log(`  grounded span (control) PASS:      ${agg.groundedPass}/${agg.groundedN}  (${pct(agg.groundedPass, agg.groundedN)})  [want 100% — real facts accepted]`);
  console.log(`  pure fabrication BLOCKED:          ${agg.fabBlocked}/${agg.fabN}  (${pct(agg.fabBlocked, agg.fabN)})  [want 100%]`);
  console.log(`  near-miss BLOCKED:                 ${agg.nearBlocked}/${agg.nearN}  (${pct(agg.nearBlocked, agg.nearN)})  [want 100%]`);
  console.log(`  recombination (SPAN) BLOCKED:      ${agg.recombSpanBlocked}/${agg.recombSpanN}  (${pct(agg.recombSpanBlocked, agg.recombSpanN)})  [want 100%]`);
  console.log(`\n  >>> SPAN-MODE HALLUCINATION LEAKS: ${aggSpanLeaks} / ${totalSpanTrials}  (default quote mode, pooled)`);
  console.log(`  recombination (AGGREGATED token mode) PASS: ${agg.recombAggPass}/${agg.recombAggN}  (${pct(agg.recombAggPass, agg.recombAggN)})  [KNOWN WEAKNESS — tokens present, meaning false]`);
  console.log(`  ...of which the gate WARNED (scatter):     ${agg.recombAggWarned}/${agg.recombAggN}  (${pct(agg.recombAggWarned, agg.recombAggN)})  [hardening surfaces the recombination]`);
  console.log("\n-- TYPED-FACT RECALL (pooled) --");
  for (const k of ["price", "rating", "percentage", "date"]) console.log(`  ${k.padEnd(11)} ${pct(aggRecall[k].hit, aggRecall[k].n)}  (${aggRecall[k].hit}/${aggRecall[k].n})`);
  console.log("\n-- PER-SEED SPAN LEAKS --");
  for (const s of perSeed) console.log(`  ${s.hex.padEnd(12)} ${s.spanLeaks} leak(s)`);
  if (allLeaks.length) {
    console.log("\n-- SPAN LEAK SAMPLES --");
    for (const l of allLeaks.slice(0, 8)) console.log(`  ! ${l}`);
  }

  console.log("\n================ VERDICT ================");
  console.log(aggSpanLeaks === 0 ? `SPAN MODE: 0 hallucination leaks across all ${totalSpanTrials} fabrication/near-miss/recombination trials over ${corpus.seeds.length} corpus seeds — the default cite-or-fail boundary held.` : `SPAN MODE: ${aggSpanLeaks} LEAK(S) — investigate.`);
  console.log(`AGGREGATED MODE: ${pct(agg.recombAggPass, agg.recombAggN)} of semantically-false recombinations passed (the documented token-match weakness; quantified — use farm_judge_claim / text_span for high assurance).`);

  // Tier 4: this is a regression GATE, not just a report. Any span-mode hallucination leak, any
  // false-reject of a real fact, or pooled recall below 99% on the generated formats exits non-zero.
  const recallOk = ["price", "rating", "percentage", "date"].every((k) => aggRecall[k].n === 0 || aggRecall[k].hit / aggRecall[k].n >= 0.99);
  const noFalseReject = agg.groundedPass === agg.groundedN;
  const pass = aggSpanLeaks === 0 && noFalseReject && recallOk;
  console.log(`\nGATE: ${pass ? "PASS" : "FAIL"}  (span leaks=${aggSpanLeaks}, grounded ${agg.groundedPass}/${agg.groundedN}, recall>=99%=${recallOk})`);
  if (!pass) {
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error("FUZZ ERROR:", e);
  process.exitCode = 1;
});
