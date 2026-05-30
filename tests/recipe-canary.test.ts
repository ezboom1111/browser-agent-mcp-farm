import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendRecipeCanaryResult,
  evaluateRecipeCanary,
  latestCanaryByRecipe,
  loadRecipeCanaryLedger,
  runRecipeCanary,
  type RecipeCanaryGolden,
  type RecipeCanaryObservation,
  type RecipeCanaryResult
} from "../src/recipe-canary.js";

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

const golden: RecipeCanaryGolden = {
  recipeKey: "google_search/result_links",
  requiredSelectors: ["#search a", "div.g h3"],
  forbiddenObstructions: ["consent_wall", "captcha"],
  capturedAt: "2026-05-01T00:00:00.000Z"
};

describe("evaluateRecipeCanary", () => {
  it("passes when every required selector resolves and no forbidden obstruction is present", () => {
    const observation: RecipeCanaryObservation = { presentSelectors: ["#search a", "div.g h3"], obstructionSignals: [] };
    const result = evaluateRecipeCanary(golden, observation, "2026-05-30T00:00:00.000Z");
    expect(result.verdict).toBe("pass");
    expect(result.missingSelectors).toEqual([]);
    expect(result.unexpectedObstructions).toEqual([]);
    expect(result.recipeKey).toBe("google_search/result_links");
    expect(result.verifiedAt).toBe("2026-05-30T00:00:00.000Z");
  });

  it("demotes to needs_recalibration when a required selector is missing (broken-selector QA)", () => {
    const observation: RecipeCanaryObservation = { presentSelectors: ["#search a"], obstructionSignals: [] };
    const result = evaluateRecipeCanary(golden, observation, "2026-05-30T00:00:00.000Z");
    expect(result.verdict).toBe("needs_recalibration");
    expect(result.missingSelectors).toEqual(["div.g h3"]);
  });

  it("demotes to needs_recalibration when a forbidden obstruction appears", () => {
    const observation: RecipeCanaryObservation = {
      presentSelectors: ["#search a", "div.g h3"],
      obstructionSignals: ["consent_wall"]
    };
    const result = evaluateRecipeCanary(golden, observation, "2026-05-30T00:00:00.000Z");
    expect(result.verdict).toBe("needs_recalibration");
    expect(result.unexpectedObstructions).toEqual(["consent_wall"]);
  });

  it("ignores obstruction signals that are not on the forbidden list", () => {
    const observation: RecipeCanaryObservation = {
      presentSelectors: ["#search a", "div.g h3"],
      obstructionSignals: ["benign_cookie_toast"]
    };
    expect(evaluateRecipeCanary(golden, observation, "2026-05-30T00:00:00.000Z").verdict).toBe("pass");
  });
});

describe("runRecipeCanary", () => {
  it("observes via the injected probe and evaluates against the golden", async () => {
    let probedUrl = "";
    let probedSelectors: string[] = [];
    const result = await runRecipeCanary(golden, "https://example.test/q", async (url, selectors) => {
      probedUrl = url;
      probedSelectors = selectors;
      return { presentSelectors: selectors, obstructionSignals: [] };
    }, "2026-05-30T00:00:00.000Z");
    expect(probedUrl).toBe("https://example.test/q");
    expect(probedSelectors).toEqual(golden.requiredSelectors);
    expect(result.verdict).toBe("pass");
  });
});

describe("recipe canary ledger", () => {
  it("round-trips appended results and returns [] for a missing ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-canary-"));
    dirs.push(dir);
    const ledger = join(dir, "canary.ndjson");

    expect(await loadRecipeCanaryLedger(join(dir, "missing.ndjson"))).toEqual([]);

    const a: RecipeCanaryResult = { recipeKey: "r1", verdict: "pass", verifiedAt: "2026-05-29T00:00:00.000Z", missingSelectors: [], unexpectedObstructions: [] };
    const b: RecipeCanaryResult = { recipeKey: "r1", verdict: "needs_recalibration", verifiedAt: "2026-05-30T00:00:00.000Z", missingSelectors: ["x"], unexpectedObstructions: [] };
    await appendRecipeCanaryResult(ledger, a);
    await appendRecipeCanaryResult(ledger, b);

    const loaded = await loadRecipeCanaryLedger(ledger);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toMatchObject({ recipeKey: "r1", verdict: "pass" });
  });

  it("skips malformed ledger lines without throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-canary-bad-"));
    dirs.push(dir);
    const ledger = join(dir, "canary.ndjson");
    await writeFile(ledger, `{"recipeKey":"r1","verdict":"pass","verifiedAt":"2026-05-30T00:00:00.000Z","missingSelectors":[],"unexpectedObstructions":[]}\nnot-json\n`, "utf8");
    const loaded = await loadRecipeCanaryLedger(ledger);
    expect(loaded).toHaveLength(1);
  });

  it("latestCanaryByRecipe keeps the newest verifiedAt per recipe", () => {
    const entries: RecipeCanaryResult[] = [
      { recipeKey: "r1", verdict: "pass", verifiedAt: "2026-05-01T00:00:00.000Z", missingSelectors: [], unexpectedObstructions: [] },
      { recipeKey: "r1", verdict: "needs_recalibration", verifiedAt: "2026-05-30T00:00:00.000Z", missingSelectors: ["x"], unexpectedObstructions: [] },
      { recipeKey: "r2", verdict: "pass", verifiedAt: "2026-05-15T00:00:00.000Z", missingSelectors: [], unexpectedObstructions: [] }
    ];
    const latest = latestCanaryByRecipe(entries);
    expect(latest.r1?.verdict).toBe("needs_recalibration");
    expect(latest.r2?.verdict).toBe("pass");
  });
});
