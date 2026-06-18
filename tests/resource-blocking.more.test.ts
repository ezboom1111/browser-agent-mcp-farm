import { describe, expect, it } from "vitest";
import { BLOCKED_HOST_SUFFIXES, BLOCKED_RESOURCE_TYPES, shouldBlockRequest } from "../src/resource-blocking.js";

describe("shouldBlockRequest", () => {
  it("blocks image/media/font resource types regardless of host", () => {
    expect(shouldBlockRequest("image", "https://example.com/a.png")).toBe(true);
    expect(shouldBlockRequest("media", "https://example.com/v.mp4")).toBe(true);
    expect(shouldBlockRequest("font", "https://example.com/f.woff2")).toBe(true);
  });
  it("blocks known ad/tracker hosts (exact and subdomain) for other resource types", () => {
    expect(shouldBlockRequest("script", "https://www.google-analytics.com/ga.js")).toBe(true);
    expect(shouldBlockRequest("xhr", "https://sub.doubleclick.net/track")).toBe(true);
    expect(shouldBlockRequest("script", "https://googlesyndication.com/x")).toBe(true);
  });
  it("does not block first-party documents/scripts or look-alike hosts", () => {
    expect(shouldBlockRequest("document", "https://example.com/page")).toBe(false);
    expect(shouldBlockRequest("script", "https://app.example.com/main.js")).toBe(false);
    expect(shouldBlockRequest("script", "https://notdoubleclick.net.evil.example/x")).toBe(false);
  });
  it("returns false for an unparseable url on a non-blocked type", () => {
    expect(shouldBlockRequest("xhr", "not a url")).toBe(false);
  });
  it("exposes the block lists it uses", () => {
    expect(BLOCKED_RESOURCE_TYPES.has("image")).toBe(true);
    expect(BLOCKED_RESOURCE_TYPES.has("document")).toBe(false);
    expect(BLOCKED_HOST_SUFFIXES).toContain("doubleclick.net");
  });
});
