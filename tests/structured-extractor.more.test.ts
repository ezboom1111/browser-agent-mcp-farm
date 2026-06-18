import { describe, expect, it } from "vitest";
import { attachTypedFacts, crossCheckStructured, extractHeadings, extractStructuredData, extractTables, type StructuredData } from "../src/structured-extractor.js";

const HTML = `<!doctype html><html><head>
<title>  Best Hotel  </title>
<link rel="canonical" href="https://example.com/hotel">
<meta property="og:title" content="OG Hotel">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@type":"Product","name":"Hotel Azure","offers":{"price":"230","priceCurrency":"USD"},"aggregateRating":{"ratingValue":"4.4","bestRating":"5","ratingCount":"120"}}</script>
<script type="application/json">{"props":{"x":1}}</script>
</head><body>
<h1>Main Title</h1><h2>Section</h2>
<table><caption>Rooms</caption><tr><th>Type</th><th>Price</th></tr><tr><td>Deluxe</td><td>$230</td></tr></table>
</body></html>`;

describe("extractStructuredData", () => {
  const data = extractStructuredData(HTML);
  it("summarizes JSON-LD product/offer/rating", () => {
    expect(data.summary).toEqual({
      type: "Product",
      name: "Hotel Azure",
      price: { value: "230", currency: "USD" },
      rating: { value: "4.4", scale: "5", count: "120" }
    });
  });
  it("reads OG/twitter meta, canonical, title", () => {
    expect(data.openGraph).toEqual({ "og:title": "OG Hotel" });
    expect(data.twitter).toEqual({ "twitter:card": "summary" });
    expect(data.canonical).toBe("https://example.com/hotel");
    expect(data.title).toBe("Best Hotel");
  });
  it("separates JSON-LD from hydration JSON", () => {
    expect(data.jsonLd).toHaveLength(1);
    expect(data.hydration).toEqual([{ props: { x: 1 } }]);
  });
  it("extracts headings and a captioned, header-rowed table", () => {
    expect(data.headings).toEqual([
      { level: 1, text: "Main Title" },
      { level: 2, text: "Section" }
    ]);
    expect(data.tables).toEqual([{ caption: "Rooms", headers: ["Type", "Price"], rows: [["Deluxe", "$230"]] }]);
  });
});

describe("JSON-LD edge cases", () => {
  it("flattens an array block and skips malformed JSON", () => {
    const html = `<script type="application/ld+json">[{"@type":"A"},{"name":"two"}]</script><script type="application/ld+json">{bad json</script>`;
    const d = extractStructuredData(html);
    expect(d.jsonLd).toHaveLength(2);
    expect(d.summary.type).toBe("A");
    expect(d.summary.name).toBe("two");
  });
  it("uses lowPrice and a standalone reviewRating fallback", () => {
    const html = `<script type="application/ld+json">{"@type":"Offer","offers":[{"lowPrice":"99"}],"reviewRating":{"ratingValue":"3.5"}}</script>`;
    const d = extractStructuredData(html);
    expect(d.summary.price).toEqual({ value: "99" });
    expect(d.summary.rating).toEqual({ value: "3.5" });
  });
});

describe("crossCheckStructured / attachTypedFacts", () => {
  it("corroborates summary fields present in the visible text (number-format agnostic)", () => {
    const data = extractStructuredData(HTML);
    const checks = crossCheckStructured(data, "Hotel Azure, rooms from 230 USD, rated 4.4 overall");
    expect(checks).toEqual([
      { field: "name", claimed: "Hotel Azure", corroborated: true },
      { field: "price.value", claimed: "230", corroborated: true },
      { field: "rating.value", claimed: "4.4", corroborated: true }
    ]);
  });
  it("flags a field that is absent from the text as uncorroborated", () => {
    const data = extractStructuredData(HTML);
    const checks = crossCheckStructured(data, "Hotel Azure only, no numbers here");
    expect(checks.find((c) => c.field === "price.value")?.corroborated).toBe(false);
  });
  it("attaches typed facts from visible text, no-op on empty", () => {
    const data: StructuredData = { jsonLd: [], hydration: [], openGraph: {}, twitter: {}, summary: {}, headings: [], tables: [] };
    attachTypedFacts(data, "");
    expect(data.typedFacts).toBeUndefined();
    attachTypedFacts(data, "the price is $19.99 today");
    expect(data.typedFacts?.some((f) => f.kind === "price")).toBe(true);
  });
});

describe("extractHeadings / extractTables edge cases", () => {
  it("captures levels h1-h6 and skips empty headings", () => {
    expect(extractHeadings("<h1>A</h1><h3>B</h3><h2>   </h2>")).toEqual([
      { level: 1, text: "A" },
      { level: 3, text: "B" }
    ]);
  });
  it("treats a table with no th header row as all-rows, no headers", () => {
    const [table] = extractTables("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>");
    expect(table.headers).toEqual([]);
    expect(table.rows).toEqual([
      ["a", "b"],
      ["c", "d"]
    ]);
  });
  it("decodes entities and collapses whitespace in cells", () => {
    const [table] = extractTables("<table><tr><td>a &amp;  b</td></tr></table>");
    expect(table.rows[0][0]).toBe("a & b");
  });
  it("returns no tables / no headings for HTML without them", () => {
    expect(extractTables("<p>no tables</p>")).toEqual([]);
    expect(extractHeadings("<p>no headings</p>")).toEqual([]);
  });
});
