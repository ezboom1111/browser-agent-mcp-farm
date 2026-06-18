import { describe, expect, it } from "vitest";
import { extractTypedFacts, summarizeTypedFacts, type TypedFact } from "../src/typed-facts.js";

function only(facts: TypedFact[], kind: TypedFact["kind"]): TypedFact[] {
  return facts.filter((f) => f.kind === kind);
}

describe("typed-facts (additional branch coverage)", () => {
  it("maps every currency symbol and the won/code suffixes", () => {
    expect(only(extractTypedFacts("Total: $1,299.00"), "price")[0]).toMatchObject({ value: "1299.00", currency: "USD" });
    expect(only(extractTypedFacts("€19,99"), "price")[0].currency).toBe("EUR");
    expect(only(extractTypedFacts("£10"), "price")[0].currency).toBe("GBP");
    expect(only(extractTypedFacts("¥500"), "price")[0].currency).toBe("JPY");
    expect(only(extractTypedFacts("₩4,500"), "price")[0]).toMatchObject({ value: "4500", currency: "KRW" });
    expect(only(extractTypedFacts("₹999"), "price")[0].currency).toBe("INR");
    expect(only(extractTypedFacts("4,500원"), "price")[0]).toMatchObject({ value: "4500", currency: "KRW" });
    expect(only(extractTypedFacts("1299 USD"), "price")[0]).toMatchObject({ value: "1299", currency: "USD" });
  });
  it("reads ratings from each rating shape and skips a bare number", () => {
    expect(only(extractTypedFacts("4.5/5"), "rating")[0].value).toBe("4.5");
    expect(only(extractTypedFacts("4.2 out of 5"), "rating")[0].value).toBe("4.2");
    expect(only(extractTypedFacts("4 stars"), "rating")[0].value).toBe("4");
    expect(only(extractTypedFacts("★4.8"), "rating")[0].value).toBe("4.8");
    expect(only(extractTypedFacts("the number 42"), "rating")).toEqual([]);
  });
  it("reads percentages and several date formats", () => {
    expect(only(extractTypedFacts("12.5 %"), "percentage")[0].value).toBe("12.5");
    expect(only(extractTypedFacts("up 30 percent"), "percentage")[0].value).toBe("30");
    expect(only(extractTypedFacts("2026-12-31"), "date")[0].value).toBe("2026-12-31");
    expect(only(extractTypedFacts("5 January 2026"), "date").length).toBe(1);
    expect(only(extractTypedFacts("2026년 6월 1일"), "date")[0].raw).toBe("2026년 6월 1일");
  });
  it("orders mixed facts by index and summarizes them", () => {
    const text = "Sale: $5.00, 20% off, rated 4.5/5, ends 2026-06-01";
    const facts = extractTypedFacts(text);
    for (let i = 1; i < facts.length; i += 1) {
      expect(facts[i].index).toBeGreaterThanOrEqual(facts[i - 1].index);
    }
    const s = summarizeTypedFacts(facts);
    expect(s.price + s.percentage + s.rating + s.date).toBe(facts.length);
    expect(s.date).toBe(1);
  });
});
