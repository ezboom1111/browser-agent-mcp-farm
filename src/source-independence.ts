// Source independence (engine #2, corroboration). To judge whether several cited artifacts are
// INDEPENDENT sources — not N captures of the same site — we reduce each source URL to its registrable
// domain (roughly eTLD+1) and count the distinct ones. This is a deterministic heuristic, NOT a full
// Public Suffix List: it strips a leading "www." and treats a small set of known two-level public
// suffixes (co.uk, com.au, …) as part of the suffix, falling back to the last two labels. Two distinct
// registrable domains => independent. It deliberately UNDER-counts (a multi-brand publisher network is
// still one domain) rather than over-counting independence, which is the safe bias for a trust signal.

const TWO_LEVEL_SUFFIXES = new Set(["co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "co.jp", "or.jp", "ne.jp", "go.jp", "co.kr", "or.kr", "go.kr", "com.au", "net.au", "org.au", "gov.au", "edu.au", "com.br", "com.cn", "net.cn", "org.cn", "co.in", "co.nz", "com.tr", "co.za", "com.mx", "com.sg", "com.hk", "com.tw"]);

/**
 * The registrable domain (~eTLD+1) for a URL, or undefined if it has no usable host. Caveat: a
 * hosted-user-content host (e.g. `a.blogspot.com`, `b.github.io`) collapses to one registrable domain
 * even though its subdomains are different authors — a deliberate trust-conservative under-count (it
 * treats them as one source rather than risk over-stating independence). A full PSL would split these.
 */
export function registrableDomain(url: string): string | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  host = host.replace(/^www\./, "");
  if (host.length === 0) {
    return undefined;
  }
  const labels = host.split(".").filter((label) => label.length > 0);
  if (labels.length <= 2) {
    return labels.join(".");
  }
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

/** Count the distinct registrable domains among the given source URLs (the independent-source count). */
export function independentSourceCount(urls: Array<string | undefined>): number {
  const domains = new Set<string>();
  for (const url of urls) {
    if (url === undefined) {
      continue;
    }
    const domain = registrableDomain(url);
    if (domain !== undefined) {
      domains.add(domain);
    }
  }
  return domains.size;
}

const SHINGLE_SIZE = 5;
const DEFAULT_OVERLAP_THRESHOLD = 0.6;

/** Normalized k-word shingles of a text — its content fingerprint for near-duplicate detection. */
export function contentShingles(text: string, k: number = SHINGLE_SIZE): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0);
  const shingles = new Set<string>();
  if (words.length <= k) {
    if (words.length > 0) {
      shingles.add(words.join(" "));
    }
    return shingles;
  }
  for (let i = 0; i + k <= words.length; i += 1) {
    shingles.add(words.slice(i, i + k).join(" "));
  }
  return shingles;
}

/** Jaccard similarity of two shingle sets (|∩| / |∪|); 0 when both empty. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const shingle of a) {
    if (b.has(shingle)) {
      intersection += 1;
    }
  }
  return intersection / (a.size + b.size - intersection);
}

/**
 * Content-aware independent-source count (Tier 3 hardening). Two sources are NOT independent when they
 * share a registrable domain OR their content is a near-duplicate (a syndicated wire story echoed
 * across domains is one source, not many). Union-find groups sources by either condition and returns
 * the number of distinct groups, so corroboration/judgment cannot be inflated by echoes. A source with
 * neither a usable domain nor text does not count.
 */
export function independentSourceGroups(sources: Array<{ url?: string | undefined; text?: string | undefined }>, overlapThreshold: number = DEFAULT_OVERLAP_THRESHOLD): number {
  const n = sources.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) {
      root = parent[root] as number;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const domains = sources.map((source) => (source.url === undefined ? undefined : registrableDomain(source.url)));
  const fingerprints = sources.map((source) => (source.text === undefined || source.text.length === 0 ? undefined : contentShingles(source.text)));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (domains[i] !== undefined && domains[i] === domains[j]) {
        union(i, j);
        continue;
      }
      const fa = fingerprints[i];
      const fb = fingerprints[j];
      if (fa !== undefined && fb !== undefined && jaccardSimilarity(fa, fb) > overlapThreshold) {
        union(i, j);
      }
    }
  }
  const roots = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    if (domains[i] !== undefined || fingerprints[i] !== undefined) {
      roots.add(find(i));
    }
  }
  return roots.size;
}
