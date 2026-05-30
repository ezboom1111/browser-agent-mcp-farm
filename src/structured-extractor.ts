// Deterministic structured-data extraction over already-captured HTML (master-plan
// P3). No network, no DOM dependency: it reparses bytes the farm already holds, so
// results are byte-reproducible. Publisher markup (JSON-LD / Open Graph) is a SITE
// CLAIM, not ground truth — callers should cross-check it against DOM/OCR.

export interface StructuredData {
  jsonLd: unknown[];
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  canonical?: string;
  title?: string;
}

export function extractStructuredData(html: string): StructuredData {
  const data: StructuredData = {
    jsonLd: extractJsonLd(html),
    openGraph: extractMeta(html, "property", "og:"),
    twitter: extractMeta(html, "name", "twitter:")
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
