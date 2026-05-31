import { describe, expect, it } from "vitest";
import { extractStructuredData } from "../src/structured-extractor.js";

// A2 (v0.5.0): SSR hydration payloads (__NEXT_DATA__ / __NUXT_DATA__ / generic application/json
// scripts) are parsed into StructuredData.hydration — the structured data a client-rendered page
// commits to the HTML before JS runs. Pure JSON.parse (no eval), byte-reproducible, ld+json excluded.

const NEXT = `<!doctype html><html><head><title>P</title></head><body>
<h1>Widget</h1>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"product":{"name":"Widget","price":42}}}}</script>
</body></html>`;

describe("hydration extraction (A2)", () => {
  it("parses a Next.js __NEXT_DATA__ payload into hydration", () => {
    const data = extractStructuredData(NEXT);
    expect(data.hydration.length).toBe(1);
    expect(data.hydration[0]).toEqual({ props: { pageProps: { product: { name: "Widget", price: 42 } } } });
  });

  it("parses a Nuxt __NUXT_DATA__ application/json payload", () => {
    const html = `<script type="application/json" id="__NUXT_DATA__">[{"a":1},"x"]</script>`;
    const data = extractStructuredData(html);
    expect(data.hydration).toEqual([[{ a: 1 }, "x"]]);
  });

  it("does NOT treat application/ld+json as hydration (that is jsonLd)", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"L"}</script>`;
    const data = extractStructuredData(html);
    expect(data.hydration).toEqual([]);
    expect(data.jsonLd.length).toBe(1);
  });

  it("skips malformed hydration without failing extraction", () => {
    const html = `<script type="application/json">{not json}</script><script type="application/json">{"ok":true}</script>`;
    const data = extractStructuredData(html);
    expect(data.hydration).toEqual([{ ok: true }]);
  });

  it("is byte-reproducible: identical HTML yields identical hydration", () => {
    expect(JSON.stringify(extractStructuredData(NEXT).hydration)).toBe(JSON.stringify(extractStructuredData(NEXT).hydration));
  });

  it("yields empty hydration for a page with none", () => {
    expect(extractStructuredData("<html><body><p>plain</p></body></html>").hydration).toEqual([]);
  });
});
