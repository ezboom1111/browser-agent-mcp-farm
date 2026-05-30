import { describe, expect, it } from "vitest";
import { extractStructuredData } from "../src/structured-extractor.js";

describe("extractStructuredData", () => {
  it("extracts JSON-LD, Open Graph, Twitter, canonical, and title", () => {
    const html = `
      <html><head>
        <title>  Acme Cafe — Open Now  </title>
        <link rel="canonical" href="https://example.com/acme">
        <meta property="og:title" content="Acme Cafe">
        <meta property="og:price:amount" content="38000">
        <meta name="twitter:card" content="summary">
        <script type="application/ld+json">{"@type":"Product","name":"Latte","offers":{"@type":"Offer","price":"4500","priceCurrency":"KRW"}}</script>
      </head><body>...</body></html>`;
    const data = extractStructuredData(html);
    expect(data.title).toBe("Acme Cafe — Open Now");
    expect(data.canonical).toBe("https://example.com/acme");
    expect(data.openGraph["og:title"]).toBe("Acme Cafe");
    expect(data.openGraph["og:price:amount"]).toBe("38000");
    expect(data.twitter["twitter:card"]).toBe("summary");
    expect(data.jsonLd.length).toBe(1);
    expect((data.jsonLd[0] as { offers?: { priceCurrency?: string } }).offers?.priceCurrency).toBe("KRW");
  });

  it("flattens a JSON-LD array and skips malformed blocks", () => {
    const html = `
      <script type='application/ld+json'>[{"@type":"A"},{"@type":"B"}]</script>
      <script type="application/ld+json">{ not valid json </script>
      <script type="application/ld+json">{"@type":"C"}</script>`;
    const data = extractStructuredData(html);
    const types = data.jsonLd.map((node) => (node as { "@type"?: string })["@type"]);
    expect(types).toEqual(["A", "B", "C"]);
  });

  it("returns empty structures for plain HTML", () => {
    const data = extractStructuredData("<html><body><p>hello</p></body></html>");
    expect(data.jsonLd).toEqual([]);
    expect(data.openGraph).toEqual({});
    expect(data.twitter).toEqual({});
    expect(data.summary).toEqual({});
    expect(data.canonical).toBeUndefined();
    expect(data.title).toBeUndefined();
  });

  it("summarizes typed price and rating from JSON-LD", () => {
    const html = '<script type="application/ld+json">{"@type":"Product","name":"Latte","offers":{"@type":"Offer","price":"4500","priceCurrency":"KRW"},"aggregateRating":{"ratingValue":"4.6","bestRating":"5","ratingCount":"1200"}}</script>';
    const data = extractStructuredData(html);
    expect(data.summary.type).toBe("Product");
    expect(data.summary.name).toBe("Latte");
    expect(data.summary.price).toEqual({ value: "4500", currency: "KRW" });
    expect(data.summary.rating).toEqual({ value: "4.6", scale: "5", count: "1200" });
  });
});
