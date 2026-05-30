import { describe, it, expect } from "vitest";

import { crossCheckStructured, extractStructuredData } from "../src/structured-extractor.js";
import { GOLDEN_CORPUS } from "./golden/corpus.js";

// Approximate the rendered visible text the way the farm captures it: drop script /
// style content and tags, collapse whitespace.
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fixture(id: string): { html: string } {
  const found = GOLDEN_CORPUS.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`missing corpus fixture: ${id}`);
  }
  return found;
}

describe("structured cross-check vs visible text", () => {
  it("flags a JSON-LD price that disagrees with the rendered DOM", () => {
    const conflict = fixture("conflict-en");
    const data = extractStructuredData(conflict.html);
    const checks = crossCheckStructured(data, visibleText(conflict.html));

    const price = checks.find((check) => check.field === "price.value");
    expect(price?.claimed).toBe("19.99");
    expect(price?.corroborated).toBe(false); // the DOM body shows a 24.99 sale price

    const name = checks.find((check) => check.field === "name");
    expect(name?.corroborated).toBe(true);
  });

  it("corroborates a price that matches the DOM despite comma formatting", () => {
    const product = fixture("product-ko");
    const data = extractStructuredData(product.html);
    const checks = crossCheckStructured(data, visibleText(product.html));

    const price = checks.find((check) => check.field === "price.value");
    expect(price?.claimed).toBe("4500");
    expect(price?.corroborated).toBe(true); // body renders "4,500원"
  });

  it("returns no checks when there is no JSON-LD summary", () => {
    const data = extractStructuredData("<html><head><title>x</title></head><body>hello</body></html>");
    expect(crossCheckStructured(data, "hello")).toEqual([]);
  });
});
