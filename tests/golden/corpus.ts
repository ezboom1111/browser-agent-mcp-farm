// Labeled golden corpus for the structured-extractor evidence-quality benchmark
// (master-plan P3). Each case is a minimal, self-contained HTML page with KNOWN
// ground-truth typed facts. The benchmark (tests/structured-benchmark.test.ts) runs
// the deterministic extractor over each page and scores precision / recall /
// exact-match against these labels, so extraction correctness is a measured number
// CI can regress against.
//
// Honesty notes baked into the corpus:
//  - `review-en` labels the TRUE review rating (5), which the current extractor does
//    NOT read (it only summarizes aggregateRating, not reviewRating) — a deliberate
//    recall gap that documents a real limitation instead of hiding it.
//  - `conflict-en` labels the JSON-LD price (a SITE CLAIM the extractor reports),
//    while the DOM body shows a different sale price. Surfacing that disagreement is a
//    follow-up slice; the corpus is already staged for it.
//  - `og-only-en` has NO JSON-LD, only Open Graph + <title>; it guards precision by
//    proving the extractor does not hallucinate a type/price from marketing meta.

import type { GoldenCase } from "../../src/structured-benchmark.js";

function page(opts: {
  title?: string;
  canonical?: string;
  og?: Record<string, string>;
  jsonLd?: unknown;
  bodyHtml?: string;
}): string {
  const head: string[] = ['<meta charset="utf-8">'];
  if (opts.title !== undefined) {
    head.push(`<title>${opts.title}</title>`);
  }
  if (opts.canonical !== undefined) {
    head.push(`<link rel="canonical" href="${opts.canonical}">`);
  }
  for (const [key, value] of Object.entries(opts.og ?? {})) {
    head.push(`<meta property="${key}" content="${value}">`);
  }
  if (opts.jsonLd !== undefined) {
    head.push(`<script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>`);
  }
  return `<!doctype html><html><head>${head.join("")}</head><body>${opts.bodyHtml ?? ""}</body></html>`;
}

export const GOLDEN_CORPUS: GoldenCase[] = [
  {
    id: "product-ko",
    category: "product",
    locale: "ko",
    html: page({
      title: "카페 메뉴 — 라떼",
      canonical: "https://example.co.kr/menu/latte",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "라떼",
        offers: { "@type": "Offer", price: "4500", priceCurrency: "KRW" },
        aggregateRating: { "@type": "AggregateRating", ratingValue: "4.5", bestRating: "5", ratingCount: "120" }
      },
      bodyHtml: "<main><h1>라떼</h1><p>가격 4,500원</p></main>"
    }),
    expected: {
      type: "Product",
      name: "라떼",
      "price.value": "4500",
      "price.currency": "KRW",
      "rating.value": "4.5",
      "rating.scale": "5",
      "rating.count": "120",
      title: "카페 메뉴 — 라떼",
      canonical: "https://example.co.kr/menu/latte"
    }
  },
  {
    id: "product-en",
    category: "product",
    locale: "en",
    html: page({
      title: "Wireless Mouse | Shop",
      canonical: "https://example.com/p/mouse",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Wireless Mouse",
        offers: { "@type": "Offer", price: "29.99", priceCurrency: "USD" },
        aggregateRating: { "@type": "AggregateRating", ratingValue: "4.2", bestRating: "5", ratingCount: "87" }
      },
      bodyHtml: "<main><h1>Wireless Mouse</h1></main>"
    }),
    expected: {
      type: "Product",
      name: "Wireless Mouse",
      "price.value": "29.99",
      "price.currency": "USD",
      "rating.value": "4.2",
      "rating.scale": "5",
      "rating.count": "87",
      title: "Wireless Mouse | Shop",
      canonical: "https://example.com/p/mouse"
    }
  },
  {
    id: "product-ja",
    category: "product",
    locale: "ja",
    html: page({
      title: "ワイヤレスイヤホン",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "ワイヤレスイヤホン",
        offers: { "@type": "Offer", price: "12800", priceCurrency: "JPY" }
      },
      bodyHtml: "<main><h1>ワイヤレスイヤホン</h1></main>"
    }),
    expected: {
      type: "Product",
      name: "ワイヤレスイヤホン",
      "price.value": "12800",
      "price.currency": "JPY",
      title: "ワイヤレスイヤホン"
    }
  },
  {
    id: "place-en",
    category: "place",
    locale: "en",
    html: page({
      title: "Blue Bottle Coffee — Oakland",
      canonical: "https://example.com/places/blue-bottle",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Restaurant",
        name: "Blue Bottle Coffee",
        aggregateRating: { "@type": "AggregateRating", ratingValue: "4.6", bestRating: "5", ratingCount: "340" }
      },
      bodyHtml: "<main><h1>Blue Bottle Coffee</h1></main>"
    }),
    expected: {
      type: "Restaurant",
      name: "Blue Bottle Coffee",
      "rating.value": "4.6",
      "rating.scale": "5",
      "rating.count": "340",
      title: "Blue Bottle Coffee — Oakland",
      canonical: "https://example.com/places/blue-bottle"
    }
  },
  {
    id: "place-ko",
    category: "place",
    locale: "ko",
    html: page({
      title: "스시 오마카세 예약",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Restaurant",
        name: "스시 오마카세",
        aggregateRating: { "@type": "AggregateRating", ratingValue: "4.8", bestRating: "5", ratingCount: "57" }
      },
      bodyHtml: "<main><h1>스시 오마카세</h1></main>"
    }),
    expected: {
      type: "Restaurant",
      name: "스시 오마카세",
      "rating.value": "4.8",
      "rating.scale": "5",
      "rating.count": "57",
      title: "스시 오마카세 예약"
    }
  },
  {
    id: "review-en",
    category: "review",
    locale: "en",
    note: "reviewRating is NOT read by the current extractor — labeled to document the recall gap.",
    html: page({
      title: "Review: Acme Espresso",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Review",
        name: "Excellent espresso",
        reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" }
      },
      bodyHtml: "<main><h1>Excellent espresso</h1></main>"
    }),
    expected: {
      type: "Review",
      name: "Excellent espresso",
      "rating.value": "5",
      title: "Review: Acme Espresso"
    }
  },
  {
    id: "news-en",
    category: "news",
    locale: "en",
    html: page({
      title: "Markets rally — Daily News",
      og: { "og:title": "Markets rally as tech leads gains" },
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        name: "Markets rally as tech leads gains"
      },
      bodyHtml: "<article><h1>Markets rally as tech leads gains</h1></article>"
    }),
    expected: {
      type: "NewsArticle",
      name: "Markets rally as tech leads gains",
      title: "Markets rally — Daily News"
    }
  },
  {
    id: "news-ja",
    category: "news",
    locale: "ja",
    html: page({
      title: "日経平均が上昇 - ニュース",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        name: "日経平均が上昇"
      },
      bodyHtml: "<article><h1>日経平均が上昇</h1></article>"
    }),
    expected: {
      type: "NewsArticle",
      name: "日経平均が上昇",
      title: "日経平均が上昇 - ニュース"
    }
  },
  {
    id: "conflict-en",
    category: "product",
    locale: "en",
    note: "JSON-LD price (site claim) is 19.99; DOM shows a 24.99 sale price. Disagreement surfacing is a follow-up slice.",
    html: page({
      title: "Travel Mug",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Travel Mug",
        offers: { "@type": "Offer", price: "19.99", priceCurrency: "USD" }
      },
      bodyHtml: "<main><h1>Travel Mug</h1><p class=\"price\">Now $24.99</p></main>"
    }),
    expected: {
      type: "Product",
      name: "Travel Mug",
      "price.value": "19.99",
      "price.currency": "USD",
      title: "Travel Mug"
    }
  },
  {
    id: "og-only-en",
    category: "news",
    locale: "en",
    note: "No JSON-LD — guards precision: the extractor must not hallucinate a type/price from Open Graph alone.",
    html: page({
      title: "Acme — Home",
      canonical: "https://acme.example/",
      og: { "og:title": "Acme Landing", "og:type": "website" },
      bodyHtml: "<main><h1>Welcome</h1></main>"
    }),
    expected: {
      title: "Acme — Home",
      canonical: "https://acme.example/"
    }
  }
];
