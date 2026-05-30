#!/usr/bin/env node
// Raise (never lower) coverage thresholds to the just-measured integer floor, so
// coverage is monotonic-upward toward the 80% target. Run after a coverage run
// (it reads coverage/coverage-summary.json). Auto-raises are capped at 80; the
// final push to/past 80 is a deliberate manual bump.

import { readFileSync, writeFileSync } from "node:fs";

const root = process.cwd();
const thresholdsPath = `${root}/coverage-thresholds.json`;
const TARGET = 80;

let summary;
try {
  summary = JSON.parse(readFileSync(`${root}/coverage/coverage-summary.json`, "utf8"));
} catch {
  console.log("ratchet: no coverage summary found, skipping.");
  process.exit(0);
}

const total = summary.total ?? {};
const current = JSON.parse(readFileSync(thresholdsPath, "utf8"));
let raised = false;
for (const key of ["lines", "statements", "functions", "branches"]) {
  const measured = Math.floor(total[key]?.pct ?? 0);
  const next = Math.min(measured, TARGET);
  if (next > current[key]) {
    current[key] = next;
    raised = true;
  }
}

writeFileSync(thresholdsPath, `${JSON.stringify(current, null, 2)}\n`);
console.log(raised ? `ratchet: raised coverage thresholds -> ${JSON.stringify(current)}` : `ratchet: coverage thresholds unchanged (${JSON.stringify(current)})`);
