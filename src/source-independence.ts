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
