import { describe, expect, it } from "vitest";
import { extractTypedFacts, summarizeTypedFacts } from "../src/typed-facts.js";

// Engine #4: deterministic typed-fact extraction from VISIBLE TEXT. Each fact's `raw` is a verbatim
// substring of the input, so a claim citing it is groundable against the page_text bytes.

function find(text: string, kind: string, raw: string) {
  return extractTypedFacts(text).find((fact) => fact.kind === kind && fact.raw === raw);
}

describe("extractTypedFacts", () => {
  it("extracts prices with normalized value + currency (symbol, won, code)", () => {
    expect(find("List price: $1,299.00 today", "price", "$1,299.00")).toMatchObject({ value: "1299.00", currency: "USD" });
    expect(find("가격은 4,500원 입니다", "price", "4,500원")).toMatchObject({ value: "4500", currency: "KRW" });
    expect(find("only ₩4,500", "price", "₩4,500")).toMatchObject({ value: "4500", currency: "KRW" });
    expect(find("costs 19.99 EUR per month", "price", "19.99 EUR")).toMatchObject({ value: "19.99", currency: "EUR" });
  });

  it("extracts ratings in several notations", () => {
    expect(find("rated 4.5/5 by users", "rating", "4.5/5")?.value).toBe("4.5");
    expect(find("4.5 out of 5 stars overall", "rating", "4.5 out of 5")?.value).toBe("4.5");
    expect(find("★4.5 average", "rating", "★4.5")?.value).toBe("4.5");
    expect(find("got 4 stars", "rating", "4 stars")?.value).toBe("4");
  });

  it("extracts percentages and dates", () => {
    expect(find("grew 25% YoY", "percentage", "25%")?.value).toBe("25");
    expect(find("up 12.5 % this quarter", "percentage", "12.5 %")?.value).toBe("12.5");
    expect(find("published 2026-06-01", "date", "2026-06-01")).toBeDefined();
    expect(find("released Jan 5, 2026 globally", "date", "Jan 5, 2026")).toBeDefined();
    expect(find("작성일 2026년 6월 1일", "date", "2026년 6월 1일")).toBeDefined();
  });

  it("every fact's raw is a verbatim substring of the input (anchorable for the gate)", () => {
    const text = "Price $9.99, rated 4.8/5, market grew 30% by 2026-01-15.";
    const facts = extractTypedFacts(text);
    expect(facts.length).toBeGreaterThanOrEqual(4);
    for (const fact of facts) {
      expect(text).toContain(fact.raw);
      expect(text.slice(fact.index, fact.index + fact.raw.length)).toBe(fact.raw);
    }
  });

  it("is deterministic + ordered by position and counts by kind", () => {
    const text = "30% off, was $50, now 4.5/5 on 2026-06-01";
    expect(extractTypedFacts(text)).toEqual(extractTypedFacts(text)); // stable
    const indexes = extractTypedFacts(text).map((fact) => fact.index);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b)); // ascending
    const counts = summarizeTypedFacts(extractTypedFacts(text));
    expect(counts.percentage).toBe(1);
    expect(counts.price).toBe(1);
    expect(counts.rating).toBe(1);
    expect(counts.date).toBe(1);
  });

  it("returns nothing for text with no typed facts", () => {
    expect(extractTypedFacts("just some ordinary prose with no figures")).toEqual([]);
    expect(extractTypedFacts("")).toEqual([]);
  });
});
