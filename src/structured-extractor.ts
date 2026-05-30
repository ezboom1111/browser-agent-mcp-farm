// Deterministic structured-data extraction over already-captured HTML (master-plan
// P3). No network, no DOM dependency: it reparses bytes the farm already holds, so
// results are byte-reproducible. Publisher markup (JSON-LD / Open Graph) is a SITE
// CLAIM, not ground truth — callers should cross-check it against DOM/OCR.

export interface StructuredSummary {
  type?: string;
  name?: string;
  price?: { value: string; currency?: string };
  rating?: { value: string; scale?: string; count?: string };
}

export interface StructuredData {
  jsonLd: unknown[];
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  canonical?: string;
  title?: string;
  summary: StructuredSummary;
}

export function extractStructuredData(html: string): StructuredData {
  const jsonLd = extractJsonLd(html);
  const data: StructuredData = {
    jsonLd,
    openGraph: extractMeta(html, "property", "og:"),
    twitter: extractMeta(html, "name", "twitter:"),
    summary: summarizeJsonLd(jsonLd)
  };
  const canonical = extractCanonical(html);
  if (canonical !== undefined) {
    data.canonical = canonical;
  }
  const title = extractTitle(html);
  if (title !== undefined) {
    data.title = title;
  }
  return data;
}

// Pull a few common typed facts out of JSON-LD (Product/Offer/Place/Review nodes)
// so a price/rating becomes a typed value, not a fuzzy regex hit. A SITE CLAIM.
function summarizeJsonLd(jsonLd: unknown[]): StructuredSummary {
  const summary: StructuredSummary = {};
  for (const node of jsonLd) {
    if (typeof node !== "object" || node === null) {
      continue;
    }
    const record = node as Record<string, unknown>;
    if (summary.type === undefined && typeof record["@type"] === "string") {
      summary.type = record["@type"];
    }
    if (summary.name === undefined && typeof record.name === "string") {
      summary.name = record.name;
    }
    if (summary.price === undefined) {
      const offer = Array.isArray(record.offers) ? record.offers[0] : record.offers;
      if (offer !== null && typeof offer === "object") {
        const offerRecord = offer as Record<string, unknown>;
        const price = offerRecord.price ?? offerRecord.lowPrice;
        if (price !== undefined) {
          summary.price = { value: String(price) };
          if (typeof offerRecord.priceCurrency === "string") {
            summary.price.currency = offerRecord.priceCurrency;
          }
        }
      }
    }
    if (summary.rating === undefined && record.aggregateRating !== null && typeof record.aggregateRating === "object") {
      const ratingRecord = record.aggregateRating as Record<string, unknown>;
      if (ratingRecord.ratingValue !== undefined) {
        summary.rating = { value: String(ratingRecord.ratingValue) };
        if (ratingRecord.bestRating !== undefined) {
          summary.rating.scale = String(ratingRecord.bestRating);
        }
        if (ratingRecord.ratingCount !== undefined) {
          summary.rating.count = String(ratingRecord.ratingCount);
        }
      }
    }
  }
  return summary;
}

function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const blockRe = /<script\b[^>]*type\s*=\s*("|')application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    const raw = (match[2] ?? "").trim();
    if (raw.length === 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      // A block may itself be an array of nodes; flatten one level.
      if (Array.isArray(parsed)) {
        out.push(...parsed);
      } else {
        out.push(parsed);
      }
    } catch {
      // skip malformed JSON-LD rather than failing the whole extraction
    }
  }
  return out;
}

function extractMeta(html: string, keyAttr: "property" | "name", prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tagRe = /<meta\b[^>]*>/gi;
  for (const tag of html.match(tagRe) ?? []) {
    const key = attrValue(tag, keyAttr);
    const content = attrValue(tag, "content");
    if (key !== undefined && content !== undefined && key.toLowerCase().startsWith(prefix)) {
      out[key.toLowerCase()] = content;
    }
  }
  return out;
}

function extractCanonical(html: string): string | undefined {
  const linkRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkRe) ?? []) {
    const rel = attrValue(tag, "rel");
    if (rel !== undefined && rel.toLowerCase() === "canonical") {
      return attrValue(tag, "href");
    }
  }
  return undefined;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (match?.[1] === undefined) {
    return undefined;
  }
  const title = match[1].replace(/\s+/g, " ").trim();
  return title.length > 0 ? title : undefined;
}

function attrValue(tag: string, attr: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  if (match === null) {
    return undefined;
  }
  return match[2] ?? match[3];
}
