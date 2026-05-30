import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { extractStructuredData } from "../src/structured-extractor.js";
import { gradedFieldsOf, scoreCorpus } from "../src/structured-benchmark.js";
import { GOLDEN_CORPUS } from "./golden/corpus.js";

interface BenchmarkThresholds {
  precision: number;
  recall: number;
  exactMatch: number;
}

describe("structured-extractor golden benchmark", () => {
  it("meets the evidence-quality thresholds over the labeled corpus", async () => {
    const thresholdsPath = fileURLToPath(new URL("../structured-benchmark-thresholds.json", import.meta.url));
    const thresholds = JSON.parse(await readFile(thresholdsPath, "utf8")) as BenchmarkThresholds;

    const cases = GOLDEN_CORPUS.map((golden) => ({
      id: golden.id,
      expected: golden.expected,
      predicted: gradedFieldsOf(extractStructuredData(golden.html))
    }));
    const result = scoreCorpus(cases);

    const report = result.perCase
      .filter((entry) => entry.mismatches.length > 0)
      .map((entry) => `  ${entry.id}: ${entry.mismatches.join("; ")}`)
      .join("\n");
    const context = `\nprecision=${result.precision.toFixed(3)} recall=${result.recall.toFixed(3)} exact=${result.exactMatch.toFixed(3)}\n${report}`;

    expect(result.precision, `precision below floor${context}`).toBeGreaterThanOrEqual(thresholds.precision);
    expect(result.recall, `recall below floor${context}`).toBeGreaterThanOrEqual(thresholds.recall);
    expect(result.exactMatch, `exact-match below floor${context}`).toBeGreaterThanOrEqual(thresholds.exactMatch);
  });

  it("covers product/place/review/news across ko/en/ja", () => {
    const categories = [...new Set(GOLDEN_CORPUS.map((golden) => golden.category))].sort();
    const locales = [...new Set(GOLDEN_CORPUS.map((golden) => golden.locale))].sort();
    expect(categories).toEqual(["news", "place", "product", "review"]);
    expect(locales).toEqual(["en", "ja", "ko"]);
  });

  it("does not hallucinate typed facts when only Open Graph is present", () => {
    const ogOnly = GOLDEN_CORPUS.find((golden) => golden.id === "og-only-en");
    if (ogOnly === undefined) {
      throw new Error("expected an og-only fixture");
    }
    const predicted = gradedFieldsOf(extractStructuredData(ogOnly.html));
    expect(predicted.type).toBeUndefined();
    expect(predicted["price.value"]).toBeUndefined();
    expect(predicted.name).toBeUndefined();
  });
});
