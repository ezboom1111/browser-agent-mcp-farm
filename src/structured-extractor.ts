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

export interface StructuredCrossCheck {
  field: "name" | "price.value" | "rating.value";
  claimed: string;
  corroborated: boolean;
}

export interface StructuredTable {
  caption?: string;
  headers: string[];
  rows: string[][];
  truncated?: boolean;
}

export interface StructuredData {
  jsonLd: unknown[];
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  canonical?: string;
  title?: string;
  summary: StructuredSummary;
  tables: StructuredTable[];
  // Set only by callers that have the page's visible text (see crossCheckStructured);
  // NOT produced by extractStructuredData, which stays byte-reproducible from HTML.
  crossCheck?: StructuredCrossCheck[];
}

export function extractStructuredData(html: string): StructuredData {
  const jsonLd = extractJsonLd(html);
  const data: StructuredData = {
    jsonLd,
    openGraph: extractMeta(html, "property", "og:"),
    twitter: extractMeta(html, "name", "twitter:"),
    summary: summarizeJsonLd(jsonLd),
    tables: extractTables(html)
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

// Heuristic, deterministic cross-check of the publisher's SITE CLAIM (the JSON-LD
// summary) against the page's visible text. Markup is marketing-controlled and can
// disagree with what a human actually sees (a stale or pre-sale price), so a typed
// fact that does NOT appear in the rendered text is flagged uncorroborated. This is a
// disagreement SIGNAL, not proof that either value is correct. Number formatting
// (commas / spaces) is normalized away, so "4500" corroborates a visible "4,500".
export function crossCheckStructured(data: StructuredData, visibleText: string): StructuredCrossCheck[] {
  const haystack = normalizeForCorroboration(visibleText);
  const checks: StructuredCrossCheck[] = [];
  const consider = (field: StructuredCrossCheck["field"], claimed: string | undefined): void => {
    if (claimed === undefined) {
      return;
    }
    const needle = normalizeForCorroboration(claimed);
    checks.push({ field, claimed, corroborated: needle.length > 0 && haystack.includes(needle) });
  };
  consider("name", data.summary.name);
  consider("price.value", data.summary.price?.value);
  consider("rating.value", data.summary.rating?.value);
  return checks;
}

function normalizeForCorroboration(value: string): string {
  return value.toLowerCase().replace(/[\s,]+/g, "");
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

// Deterministic HTML-table extraction (semi-structured data). Best-effort and
// byte-reproducible from the captured HTML: each <table> becomes {caption, headers,
// rows}. A leading all-<th> row is treated as the header. Bounded (tables/rows/cols/
// cell length) so a pathological page can't bloat the artifact; truncation is flagged.
// Caveat: nested tables are not disentangled (the non-greedy match stops at the first
// </table>), which is acceptable for the data tables this targets.
const MAX_TABLES = 20;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLS = 50;
const MAX_CELL_CHARS = 500;

export function extractTables(html: string): StructuredTable[] {
  const tables: StructuredTable[] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(html)) !== null && tables.length < MAX_TABLES) {
    const inner = match[1] ?? "";
    const captionMatch = inner.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    const parsedRows: Array<{ cells: string[]; isHeader: boolean }> = [];
    let truncated = false;

    for (const rowMatch of inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (parsedRows.length >= MAX_TABLE_ROWS) {
        truncated = true;
        break;
      }
      const cells: string[] = [];
      let allHeader = true;
      let sawCell = false;
      for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)) {
        sawCell = true;
        if ((cellMatch[1] ?? "").toLowerCase() !== "th") {
          allHeader = false;
        }
        if (cells.length >= MAX_TABLE_COLS) {
          truncated = true;
          break;
        }
        cells.push(cellText(cellMatch[2] ?? ""));
      }
      if (sawCell) {
        parsedRows.push({ cells, isHeader: allHeader });
      }
    }

    if (parsedRows.length === 0) {
      continue;
    }
    const headerRow = parsedRows[0];
    const hasHeader = headerRow !== undefined && headerRow.isHeader;
    const table: StructuredTable = {
      headers: hasHeader ? headerRow.cells : [],
      rows: (hasHeader ? parsedRows.slice(1) : parsedRows).map((row) => row.cells)
    };
    const caption = captionMatch?.[1] === undefined ? undefined : cellText(captionMatch[1]);
    if (caption !== undefined && caption.length > 0) {
      table.caption = caption;
    }
    if (truncated) {
      table.truncated = true;
    }
    tables.push(table);
  }
  return tables;
}

function cellText(raw: string): string {
  const stripped = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > MAX_CELL_CHARS ? stripped.slice(0, MAX_CELL_CHARS) : stripped;
}

function attrValue(tag: string, attr: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  if (match === null) {
    return undefined;
  }
  return match[2] ?? match[3];
}
