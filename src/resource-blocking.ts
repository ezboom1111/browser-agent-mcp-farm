// Opt-in resource-blocking fast-path (A3). On a `text` capture profile the BrowserPool aborts
// image / media / font subrequests and known ad/tracker hosts before they are fetched. This never
// changes page_html / page_text bytes (those come from the DOM, not the blocked subresources), so
// cite-or-fail is untouched and captures become MORE reproducible (fewer third-party requests). It
// is gated to text-only runs (no screenshot/frame/OCR), because a blocked image would corrupt a
// screenshot — so the `text` profile also skips the page screenshot.

export const BLOCKED_RESOURCE_TYPES: ReadonlySet<string> = new Set(["image", "media", "font"]);

// A small, conservative ad/tracker host-suffix list. Blocking these never affects the rendered
// HTML/text — it only removes third-party noise and speeds the capture.
export const BLOCKED_HOST_SUFFIXES: readonly string[] = ["doubleclick.net", "googlesyndication.com", "google-analytics.com", "googletagmanager.com", "adservice.google.com", "adnxs.com", "scorecardresearch.com", "amazon-adsystem.com", "facebook.net"];

export function shouldBlockRequest(resourceType: string, url: string): boolean {
  if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
    return true;
  }
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
