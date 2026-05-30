import { appendFile, readFile } from "node:fs/promises";

import { stripBom } from "./util/text.js";

// Recipe canary (master-plan P4): re-verify a maintained source-navigation recipe's
// selector/obstruction health against a stored golden assertion, so a decayed "ready"
// slot is auto-demoted instead of silently rotting. The browser-driving "observe" step
// is INJECTED (RecipeCanaryProbe) so the comparison + ledger logic stays pure and fully
// testable without Chromium; the CLI wires a real BrowserPool-backed probe.
//
// SAFETY: the canary only re-checks that EXISTING recipe selectors still resolve and that
// no new obstruction appeared. It performs no login/CAPTCHA/paywall bypass and no payment
// or account action — it is a read-only health probe of a page the farm can already see.

export interface RecipeCanaryGolden {
  /** platform/actionKey this golden pins (e.g. "google_search/result_links"). */
  recipeKey: string;
  /** selectors that MUST still resolve for the recipe to be considered healthy. */
  requiredSelectors: string[];
  /** obstruction signal ids that, if observed, fail the canary (overlay/blocked/etc.). */
  forbiddenObstructions?: string[];
  /** ISO timestamp the golden was captured. */
  capturedAt: string;
}

export interface RecipeCanaryObservation {
  /** which of the golden's requiredSelectors actually resolved on the live page. */
  presentSelectors: string[];
  /** obstruction signal ids observed on the live page. */
  obstructionSignals: string[];
}

export type RecipeCanaryVerdict = "pass" | "needs_recalibration";

export interface RecipeCanaryResult {
  recipeKey: string;
  verdict: RecipeCanaryVerdict;
  verifiedAt: string;
  missingSelectors: string[];
  unexpectedObstructions: string[];
}

/**
 * Pure comparison: a canary passes only when every required selector still resolves AND
 * no forbidden obstruction appeared. A missing selector or a new obstruction demotes the
 * slot to `needs_recalibration` (the QA target: a broken-selector fixture flips ready→
 * needs_recalibration).
 */
export function evaluateRecipeCanary(golden: RecipeCanaryGolden, observation: RecipeCanaryObservation, verifiedAt: string): RecipeCanaryResult {
  const present = new Set(observation.presentSelectors);
  const missingSelectors = golden.requiredSelectors.filter((selector) => !present.has(selector));
  const forbidden = new Set(golden.forbiddenObstructions ?? []);
  const unexpectedObstructions = observation.obstructionSignals.filter((signal) => forbidden.has(signal));
  const verdict: RecipeCanaryVerdict = missingSelectors.length === 0 && unexpectedObstructions.length === 0 ? "pass" : "needs_recalibration";
  return { recipeKey: golden.recipeKey, verdict, verifiedAt, missingSelectors, unexpectedObstructions };
}

/** A page-observing probe. Injected so the canary core never imports the browser pool. */
export type RecipeCanaryProbe = (url: string, requiredSelectors: string[]) => Promise<RecipeCanaryObservation>;

/**
 * Run one canary end-to-end: observe the live page via the injected probe, then evaluate
 * against the golden. Quota/rate concerns are the caller's (the CLI rate-caps invocations).
 */
export async function runRecipeCanary(golden: RecipeCanaryGolden, url: string, probe: RecipeCanaryProbe, verifiedAt: string): Promise<RecipeCanaryResult> {
  const observation = await probe(url, golden.requiredSelectors);
  return evaluateRecipeCanary(golden, observation, verifiedAt);
}

// ---- Append-only canary ledger (lastVerifiedAt + last verdict per recipe) ----

export async function appendRecipeCanaryResult(ledgerPath: string, result: RecipeCanaryResult): Promise<void> {
  await appendFile(ledgerPath, `${JSON.stringify(result)}\n`, "utf8");
}

export async function loadRecipeCanaryLedger(ledgerPath: string): Promise<RecipeCanaryResult[]> {
  let raw: string;
  try {
    raw = await readFile(ledgerPath, "utf8");
  } catch {
    return [];
  }
  const results: RecipeCanaryResult[] = [];
  for (const line of stripBom(raw).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      results.push(JSON.parse(trimmed) as RecipeCanaryResult);
    } catch {
      // Skip a malformed ledger line rather than failing the whole report.
    }
  }
  return results;
}

/** Fold the ledger to the latest result per recipeKey (newest verifiedAt wins). */
export function latestCanaryByRecipe(entries: RecipeCanaryResult[]): Record<string, RecipeCanaryResult> {
  const latest: Record<string, RecipeCanaryResult> = {};
  for (const entry of entries) {
    const prior = latest[entry.recipeKey];
    if (prior === undefined || entry.verifiedAt >= prior.verifiedAt) {
      latest[entry.recipeKey] = entry;
    }
  }
  return latest;
}
