// QA/QC harness: run the farm end-to-end across 12 sectors x {structured, semi-structured,
// unstructured} local fixtures. For each: tier-0 capture -> check page_html/page_text/structured_data
// -> typed-fact + structured extraction -> cite-or-fail gate (a GROUNDED claim must PASS, a FABRICATED
// claim must FAIL = hallucination prevention) -> cross-source corroboration. Deterministic + offline.
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactWriter } from "../dist/artifact-writer.js";
import { httpTier0Capture } from "../dist/http-tier0-capture.js";
import { runClaimGate } from "../dist/claim-gate.js";
import { crossCheckStructured, extractStructuredData } from "../dist/structured-extractor.js";
import { extractTypedFacts, summarizeTypedFacts } from "../dist/typed-facts.js";
import { FarmService } from "../dist/farm-service.js";

const page = (title, body, head = "") => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
const jsonld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const nextData = (obj) => `<div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(obj)}</script>`;

// 12 sectors across the three data-structure classes. Each fixture is server-rendered HTML.
const FIXTURES = [
  // ---- STRUCTURED (정형): machine-readable markup / tables ----
  {
    id: "ecommerce",
    sector: "E-commerce",
    dataClass: "structured",
    html: page(
      "Aero Headphones",
      `<h1>Aero Headphones</h1><p>Premium wireless headphones. Price $1,299.00, rated 4.6/5 by 2,340 reviewers.</p>` +
        jsonld({ "@context": "https://schema.org", "@type": "Product", name: "Aero Headphones", offers: { "@type": "Offer", price: "1299.00", priceCurrency: "USD" }, aggregateRating: { "@type": "AggregateRating", ratingValue: "4.6", reviewCount: "2340" } })
    ),
    grounded: "Price $1,299.00, rated 4.6/5",
    fabricated: "Price $49.00 with a lifetime warranty",
    expectFacts: ["price", "rating"],
    expectStructured: "jsonLd"
  },
  {
    id: "finance",
    sector: "Finance / Markets",
    dataClass: "structured",
    html: page(
      "Index Movers",
      `<h1>Today's Movers</h1><table><caption>Top movers</caption><thead><tr><th>Ticker</th><th>Price</th><th>Change</th></tr></thead><tbody><tr><td>ACME</td><td>$182.40</td><td>+3.2%</td></tr><tr><td>GLOB</td><td>$57.90</td><td>-1.8%</td></tr></tbody></table><p>As of 2026-03-15, ACME rose 3.2% to $182.40.</p>`
    ),
    grounded: "ACME rose 3.2% to $182.40",
    fabricated: "ACME crashed 40% on a fraud probe",
    expectFacts: ["price", "percentage", "date"],
    expectStructured: "tables"
  },
  {
    id: "jobs",
    sector: "Jobs / Hiring",
    dataClass: "structured",
    html: page(
      "Senior Engineer",
      `<h1>Senior Engineer</h1><p>Remote role. Base salary $185,000, posted 2026-02-01.</p>` +
        jsonld({ "@context": "https://schema.org", "@type": "JobPosting", title: "Senior Engineer", datePosted: "2026-02-01", baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", value: "185000", unitText: "YEAR" } } })
    ),
    grounded: "Base salary $185,000, posted 2026-02-01",
    fabricated: "Base salary $900,000 with equity guarantee",
    expectFacts: ["price", "date"],
    expectStructured: "jsonLd"
  },
  // ---- SEMI-STRUCTURED (반정형): hydration / OG / table + prose ----
  {
    id: "saas",
    sector: "SaaS / Pricing",
    dataClass: "semi-structured",
    // Realistic SSR'd pricing page: the plans are rendered in HTML (so tier-0 keeps it) AND the page
    // also hydrates via __NEXT_DATA__. (A thin client-only shell would instead be declined by tier-0.)
    html: page(
      "CloudFlow Pricing",
      `<h1>CloudFlow Pricing</h1><p>CloudFlow offers three plans for teams of every size. The Starter plan is $19/mo for individuals and small projects. The Pro plan is $49/mo and adds advanced analytics, audit logs, and priority support. The Team plan is $99/mo with unlimited seats, SSO, and a dedicated success manager. Pay annually and get 25% off any plan. All plans include a 14-day free trial with no credit card required.</p>` +
        nextData({
          props: {
            pageProps: {
              plans: [
                { name: "Starter", price: 19 },
                { name: "Pro", price: 49 },
                { name: "Team", price: 99 }
              ]
            }
          }
        })
    ),
    grounded: "The Pro plan is $49/mo",
    fabricated: "Enterprise plan is free forever",
    expectFacts: ["price", "percentage"],
    expectStructured: "hydration"
  },
  {
    id: "news",
    sector: "News / Media",
    dataClass: "semi-structured",
    html: page("Policy Shift", `<article><h1>Regulator unveils new policy</h1><p>Published 2026-01-20. The agency said compliance costs could rise 12% for affected firms.</p></article>`, `<meta property="og:title" content="Regulator unveils new policy"><meta property="og:type" content="article">`),
    grounded: "compliance costs could rise 12%",
    fabricated: "the policy was repealed the next day",
    expectFacts: ["percentage", "date"],
    expectStructured: "openGraph"
  },
  {
    id: "realestate",
    sector: "Real Estate",
    dataClass: "semi-structured",
    html: page("3BR Condo", `<h1>3BR Condo, Riverside</h1><table><tr><th>Beds</th><td>3</td></tr><tr><th>Baths</th><td>2</td></tr><tr><th>Price</th><td>$540,000</td></tr></table><p>Listed 2026-04-02. Bright 3-bedroom condo with a river view, asking $540,000.</p>`),
    grounded: "asking $540,000",
    fabricated: "includes a private helipad and a vineyard",
    expectFacts: ["price", "date"],
    expectStructured: "tables"
  },
  {
    id: "travel",
    sector: "Travel / Hospitality",
    dataClass: "semi-structured",
    html: page("Hotel Azure", `<h1>Hotel Azure</h1><p>Beachfront hotel rated 4.4/5. Rooms from $230/night.</p>` + jsonld({ "@context": "https://schema.org", "@type": "Hotel", name: "Hotel Azure", aggregateRating: { "@type": "AggregateRating", ratingValue: "4.4" } })),
    grounded: "rated 4.4/5. Rooms from $230/night",
    fabricated: "offers free private island transfers",
    expectFacts: ["price", "rating"],
    expectStructured: "jsonLd"
  },
  // ---- UNSTRUCTURED (비정형): prose only ----
  {
    id: "healthcare",
    sector: "Healthcare / Research",
    dataClass: "unstructured",
    html: page("Trial Readout", `<h1>Phase II readout</h1><p>In the study published 2026-03-10, the treatment arm showed a 31% reduction in symptom severity versus placebo over 12 weeks.</p>`),
    grounded: "31% reduction in symptom severity",
    fabricated: "cured the disease in 100% of patients",
    expectFacts: ["percentage", "date"],
    expectStructured: "none"
  },
  {
    id: "forum",
    sector: "Community / Forum (planning)",
    dataClass: "unstructured",
    html: page("Feature requests", `<h1>What are we missing?</h1><p>User A: the export is way too slow and there is no dark mode. User B: I would pay 20% more for an offline mode.</p>`),
    grounded: "there is no dark mode",
    fabricated: "everyone loves the current export speed",
    expectFacts: ["percentage"],
    expectStructured: "none"
  },
  {
    id: "restaurant",
    sector: "Food / Restaurant",
    dataClass: "unstructured",
    html: page("Bistro review", `<h1>Bistro Verde</h1><p>A cozy spot, rated 4.2/5 across 800 reviews. The tasting menu runs $85 per person and was worth it.</p>`),
    grounded: "tasting menu runs $85 per person",
    fabricated: "the restaurant is permanently closed",
    expectFacts: ["price", "rating"],
    expectStructured: "none"
  },
  {
    id: "automotive",
    sector: "Automotive",
    dataClass: "unstructured",
    html: page("EV launch", `<h1>Model V revealed</h1><p>Announced 2026-05-01, the Model V starts at $42,990 and delivers a claimed 18% efficiency gain over the prior model.</p>`),
    grounded: "Model V starts at $42,990",
    fabricated: "the Model V flies and runs on water",
    expectFacts: ["price", "percentage", "date"],
    expectStructured: "none"
  },
  {
    id: "education",
    sector: "Education",
    dataClass: "unstructured",
    html: page("Course", `<h1>Data Engineering Bootcamp</h1><p>A 12-week cohort, tuition $7,500, rated 4.7/5 by past students. Next start 2026-06-15.</p>`),
    grounded: "tuition $7,500, rated 4.7/5",
    fabricated: "guarantees a $1,000,000 starting salary",
    expectFacts: ["price", "rating", "date"],
    expectStructured: "none"
  }
];

const results = [];
function check(name, pass, detail = "") {
  return { name, pass, detail };
}

async function run() {
  const server = createServer((req, res) => {
    const id = (req.url ?? "/").replace(/^\//, "").split("?")[0];
    // Adversarial routes (data-integrity / SSRF / decline behaviour).
    if (id === "adv-redirect") {
      res.writeHead(302, { location: "https://evil.example/x" });
      res.end("");
      return;
    }
    if (id === "adv-pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end("%PDF-1.4 fake");
      return;
    }
    if (id === "adv-shell") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page("Shell", `<div id="__next"></div><script id="__NEXT_DATA__" type="application/json">{"props":{"x":1}}</script>`));
      return;
    }
    if (id === "adv-contradict") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page("Deal", `<h1>Widget</h1><p>The price shown on the page is $1,299.00 today.</p>` + jsonld({ "@context": "https://schema.org", "@type": "Product", name: "Widget", offers: { "@type": "Offer", price: "999.00", priceCurrency: "USD" } })));
      return;
    }
    if (id === "adv-korean") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page("한국어", `<h1>제품 상세</h1><p>이 제품의 가격은 49,000원이며, 평점은 4.5/5 입니다. 2026년 6월 1일 기준입니다.</p>`));
      return;
    }
    const fx = FIXTURES.find((f) => f.id === id);
    res.writeHead(fx ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(fx ? fx.html : "not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const host = "127.0.0.1";
  const base = `http://${host}:${port}`;
  const tmpRoots = [];

  for (const fx of FIXTURES) {
    const runDir = await mkdtemp(join(tmpdir(), `qa-${fx.id}-`));
    tmpRoots.push(runDir);
    const checks = [];
    const writer = new ArtifactWriter();

    // 1) tier-0 capture
    const cap = await httpTier0Capture({ runDir, url: `${base}/${fx.id}`, allowedDomains: [host], writer, captureId: `${fx.id}-page-capture`, contextToken: "qa", pageId: "pg" });
    const kinds = cap.records.map((r) => r.evidence_kind);
    checks.push(check("capture.ok", cap.ok === true, cap.reason ?? ""));
    checks.push(check("has page_html+page_text", kinds.includes("page_html") && kinds.includes("page_text")));

    // 2) structured extraction signal
    const structured = extractStructuredData(fx.html);
    const sig = { jsonLd: structured.jsonLd.length > 0, hydration: structured.hydration.length > 0, openGraph: Object.keys(structured.openGraph).length > 0, tables: structured.tables.length > 0, none: true };
    checks.push(check(`structured:${fx.expectStructured}`, fx.expectStructured === "none" ? true : sig[fx.expectStructured] === true));

    // 3) typed-fact extraction over the captured visible text
    const textRec = cap.records.find((r) => r.evidence_kind === "page_text");
    const visibleText = textRec ? await readFile(join(runDir, textRec.path), "utf8") : "";
    checks.push(check("captured visible text", visibleText.length > 0, visibleText.length ? "" : `tier-0 declined: ${cap.reason ?? "?"}`));

    if (visibleText.length > 0) {
      const facts = extractTypedFacts(visibleText);
      const factKinds = new Set(facts.map((f) => f.kind));
      const missingFacts = fx.expectFacts.filter((k) => !factKinds.has(k));
      checks.push(check(`typedFacts[${fx.expectFacts.join(",")}]`, missingFacts.length === 0, missingFacts.length ? `missing ${missingFacts.join(",")}` : JSON.stringify(summarizeTypedFacts(facts))));

      // 4) HALLUCINATION GATE — grounded claim PASSES, fabricated claim FAILS (separate run dirs)
      const svc = new FarmService();
      const gRun = await mkdtemp(join(tmpdir(), `qa-g-${fx.id}-`));
      tmpRoots.push(gRun);
      const reg = await svc.registerEvidence({ runDir: gRun, sourceUrl: `${base}/${fx.id}`, text: visibleText, evidenceKind: "page_text" });
      const grounded = await svc.addClaim({ runDir: gRun, artifactId: reg.artifactId, claim: `Grounded: ${fx.grounded}`, claimType: "text", evidenceKind: "page_text", verificationLevel: "grounded", anchor: { type: "text_span", quote: fx.grounded } });
      checks.push(check("gate: grounded PASSES", grounded.ok === true, grounded.ok ? "" : JSON.stringify(grounded.gate?.errors)));
      const fRun = await mkdtemp(join(tmpdir(), `qa-f-${fx.id}-`));
      tmpRoots.push(fRun);
      const reg2 = await svc.registerEvidence({ runDir: fRun, sourceUrl: `${base}/${fx.id}`, text: visibleText, evidenceKind: "page_text" });
      const fabricated = await svc.addClaim({ runDir: fRun, artifactId: reg2.artifactId, claim: `Fabricated: ${fx.fabricated}`, claimType: "text", evidenceKind: "page_text", verificationLevel: "grounded", anchor: { type: "text_span", quote: fx.fabricated } });
      checks.push(check("gate: fabricated BLOCKED", fabricated.ok === false, fabricated.ok ? "LEAKED — hallucination passed!" : ""));
    }

    const pass = checks.every((c) => c.pass);
    results.push({ fx, checks, pass });
  }

  // 5) Cross-source corroboration (independent domains pass; same domain fails)
  const corr = { checks: [] };
  const svc = new FarmService();
  const cRun = await mkdtemp(join(tmpdir(), "qa-corr-"));
  tmpRoots.push(cRun);
  const a = await svc.registerEvidence({ runDir: cRun, sourceUrl: "https://source-a.example.com/x", text: "the market is about $5 billion in 2026", evidenceKind: "page_text" });
  const b = await svc.registerEvidence({ runDir: cRun, sourceUrl: "https://source-b.example.org/y", text: "analysts size the market near $5 billion", evidenceKind: "page_text" });
  const corrOk = await svc.addClaim({
    runDir: cRun,
    artifactId: a.artifactId,
    claim: "Market ~$5B",
    claimType: "metadata",
    evidenceKind: "page_text",
    verificationLevel: "grounded",
    anchor: { type: "text_span", quote: "$5 billion" },
    corroboration: { sources: [{ artifactId: b.artifactId, quote: "$5 billion" }], minIndependentSources: 2 }
  });
  corr.checks.push(check("corroboration: 2 independent domains PASSES", corrOk.ok === true, corrOk.ok ? "" : JSON.stringify(corrOk.gate?.errors)));
  const cRun2 = await mkdtemp(join(tmpdir(), "qa-corr2-"));
  tmpRoots.push(cRun2);
  const c1 = await svc.registerEvidence({ runDir: cRun2, sourceUrl: "https://www.same.example.com/x", text: "fig $5 billion", evidenceKind: "page_text" });
  const c2 = await svc.registerEvidence({ runDir: cRun2, sourceUrl: "https://news.same.example.com/y", text: "fig $5 billion too", evidenceKind: "page_text" });
  const corrBad = await svc.addClaim({ runDir: cRun2, artifactId: c1.artifactId, claim: "Market ~$5B", claimType: "metadata", evidenceKind: "page_text", verificationLevel: "grounded", corroboration: { sources: [{ artifactId: c2.artifactId }], minIndependentSources: 2 } });
  corr.checks.push(check("corroboration: same domain BLOCKED", corrBad.ok === false, corrBad.ok ? "LEAKED — fake independence passed!" : ""));

  // ---- ADVERSARIAL & EDGE battery (the real test of integrity + hallucination prevention) ----
  const adv = { checks: [] };
  const aw = new ArtifactWriter();
  const advRun = async () => {
    const d = await mkdtemp(join(tmpdir(), "qa-adv-"));
    tmpRoots.push(d);
    return d;
  };

  // A. SSRF / off-domain redirect -> tier-0 declines.
  const rRedirect = await httpTier0Capture({ runDir: await advRun(), url: `${base}/adv-redirect`, allowedDomains: [host], writer: aw, captureId: "a", contextToken: "q", pageId: "p" });
  adv.checks.push(check("off-domain redirect DECLINED (SSRF guard)", rRedirect.ok === false));
  // B. Non-HTML content -> declines.
  const rPdf = await httpTier0Capture({ runDir: await advRun(), url: `${base}/adv-pdf`, allowedDomains: [host], writer: aw, captureId: "a", contextToken: "q", pageId: "p" });
  adv.checks.push(check("non-HTML (pdf) DECLINED", rPdf.ok === false));
  // C. Client-rendered shell -> declines (would escalate to a real browser).
  const rShell = await httpTier0Capture({ runDir: await advRun(), url: `${base}/adv-shell`, allowedDomains: [host], writer: aw, captureId: "a", contextToken: "q", pageId: "p" });
  adv.checks.push(check("client-rendered shell DECLINED (escalate to browser)", rShell.ok === false));
  // D. Markup that CONTRADICTS the visible text -> crossCheck flags it (don't trust contradictory JSON-LD).
  const sData = extractStructuredData(`<h1>Widget</h1>` + jsonld({ "@type": "Product", name: "Widget", offers: { "@type": "Offer", price: "999.00", priceCurrency: "USD" } }));
  const cc = crossCheckStructured(sData, "The price shown on the page is $1,299.00 today.");
  const priceCC = cc.find((c) => c.field === "price.value");
  adv.checks.push(check("contradictory JSON-LD price flagged uncorroborated", priceCC !== undefined && priceCC.corroborated === false, JSON.stringify(cc)));
  // E. NEAR-MISS fabrication ($1,290 vs page's $1,299) -> gate BLOCKS.
  const svcA = new FarmService();
  const nmRun = await advRun();
  const nm = await svcA.registerEvidence({ runDir: nmRun, sourceUrl: "https://shop.example.com/w", text: "The price is $1,299.00 with free shipping.", evidenceKind: "page_text" });
  const nmClaim = await svcA.addClaim({ runDir: nmRun, artifactId: nm.artifactId, claim: "price", claimType: "text", evidenceKind: "page_text", verificationLevel: "grounded", anchor: { type: "text_span", quote: "$1,290.00" } });
  adv.checks.push(check("near-miss fabrication ($1,290 vs $1,299) BLOCKED", nmClaim.ok === false));
  // F. BYTE TAMPERING — mutate a registered artifact on disk -> read-back flags it / gate fails on hash.
  const tRun = await advRun();
  const treg = await svcA.registerEvidence({ runDir: tRun, sourceUrl: "https://x.example.com/y", text: "original trustworthy bytes", evidenceKind: "page_text" });
  const trows = (await readFile(join(tRun, "artifacts.jsonl"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((l) => JSON.parse(l));
  const tpath = trows.find((r) => r.artifact_id === treg.artifactId).path; // tamper the exact artifact we read back
  await writeFile(join(tRun, tpath), "TAMPERED bytes injected after registration", "utf8");
  const tread = await svcA.readArtifact({ runDir: tRun, artifactId: treg.artifactId });
  adv.checks.push(check("post-registration byte tampering DETECTED", tread.tampered === true));
  const tgate = await runClaimGate(tRun, { mode: "final", minClaims: 0 });
  adv.checks.push(check("gate flags tampered artifact hash mismatch", tgate.ok === false && JSON.stringify(tgate.errors).includes("hash mismatch")));
  // G. KOREAN / non-ASCII — typed facts (원) + grounded vs fabricated.
  const kRun = await advRun();
  const kcap = await httpTier0Capture({ runDir: kRun, url: `${base}/adv-korean`, allowedDomains: [host], writer: aw, captureId: "k", contextToken: "q", pageId: "p" });
  const kTextRec = kcap.records.find((r) => r.evidence_kind === "page_text");
  const kText = kTextRec ? await readFile(join(kRun, kTextRec.path), "utf8") : "";
  const kFacts = new Set(extractTypedFacts(kText).map((f) => f.kind));
  adv.checks.push(check("Korean typed facts (원 price + rating + date)", kFacts.has("price") && kFacts.has("rating") && kFacts.has("date"), JSON.stringify([...kFacts])));
  const kRun2 = await advRun();
  const kReg2 = await svcA.registerEvidence({ runDir: kRun2, sourceUrl: `${base}/adv-korean`, text: kText, evidenceKind: "page_text" });
  const kG = await svcA.addClaim({ runDir: kRun2, artifactId: kReg2.artifactId, claim: "k", claimType: "text", evidenceKind: "page_text", verificationLevel: "grounded", anchor: { type: "text_span", quote: "가격은 49,000원" } });
  adv.checks.push(check("Korean grounded claim PASSES", kG.ok === true, kG.ok ? "" : JSON.stringify(kG.gate?.errors)));
  const kRun3 = await advRun();
  const kReg3 = await svcA.registerEvidence({ runDir: kRun3, sourceUrl: `${base}/adv-korean`, text: kText, evidenceKind: "page_text" });
  const kF = await svcA.addClaim({ runDir: kRun3, artifactId: kReg3.artifactId, claim: "k", claimType: "text", evidenceKind: "page_text", verificationLevel: "grounded", anchor: { type: "text_span", quote: "가격은 999원" } });
  adv.checks.push(check("Korean fabricated claim BLOCKED", kF.ok === false));
  // H. Zero-claim final gate -> fails (no uncited-by-omission free pass).
  const zRun = await advRun();
  await svcA.registerEvidence({ runDir: zRun, sourceUrl: "https://z.example.com", text: "some bytes", evidenceKind: "page_text" });
  const zGate = await runClaimGate(zRun, { mode: "final", minClaims: 1 });
  adv.checks.push(check("zero-claim final gate FAILS", zGate.ok === false));

  await new Promise((r) => server.close(r));
  await Promise.all(tmpRoots.map((d) => rm(d, { recursive: true, force: true })));

  // ---- REPORT ----
  console.log("\n================ FARM QA/QC — 12 sectors x {structured | semi-structured | unstructured} ================\n");
  const col = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(col("SECTOR", 30) + col("CLASS", 18) + "RESULT");
  console.log("-".repeat(72));
  for (const r of results) {
    const failed = r.checks.filter((c) => !c.pass);
    console.log(col(r.fx.sector, 30) + col(r.fx.dataClass, 18) + (r.pass ? "✅ PASS" : `❌ ${failed.map((c) => c.name).join(", ")}`));
    for (const c of failed) console.log("      ↳ " + c.name + (c.detail ? `: ${c.detail}` : ""));
  }
  console.log("\n---- cross-source corroboration ----");
  for (const c of corr.checks) console.log((c.pass ? "✅ " : "❌ ") + c.name + (c.detail ? ` — ${c.detail}` : ""));

  console.log("\n---- adversarial & edge battery (integrity + hallucination prevention) ----");
  for (const c of adv.checks) console.log((c.pass ? "✅ " : "❌ ") + c.name + (c.detail && !c.pass ? ` — ${c.detail}` : ""));

  const sectorPass = results.filter((r) => r.pass).length;
  const allChecks = results.flatMap((r) => r.checks).concat(corr.checks, adv.checks);
  const gateChecks = allChecks.filter((c) => c.name.startsWith("gate:") || c.name.startsWith("corroboration:"));
  const gatePass = gateChecks.filter((c) => c.pass).length;
  console.log("\n================ SUMMARY ================");
  console.log(`Sectors fully passing:        ${sectorPass}/${results.length}`);
  console.log(`Total checks passing:         ${allChecks.filter((c) => c.pass).length}/${allChecks.length}`);
  console.log(`Hallucination-gate checks:    ${gatePass}/${gateChecks.length}  (grounded-pass + fabricated-block + corroboration)`);
  console.log(`Adversarial/edge checks:      ${adv.checks.filter((c) => c.pass).length}/${adv.checks.length}  (SSRF, non-HTML, shell, contradiction, near-miss, tamper, Korean, zero-claim)`);
  const dataClasses = ["structured", "semi-structured", "unstructured"];
  for (const dc of dataClasses) {
    const rs = results.filter((r) => r.fx.dataClass === dc);
    console.log(`  ${col(dc, 16)} ${rs.filter((r) => r.pass).length}/${rs.length} sectors pass`);
  }
  const allPass = allChecks.every((c) => c.pass);
  console.log("\nVERDICT: " + (allPass ? "USABLE — data collected across all 3 classes & 12 sectors; every fabricated/near-miss/tampered/contradictory claim was blocked or flagged; SSRF/non-HTML/shell declined; Korean works." : "REVIEW NEEDED — see failures above."));
}

run().catch((e) => {
  console.error("QA HARNESS ERROR:", e);
  process.exitCode = 1;
});
