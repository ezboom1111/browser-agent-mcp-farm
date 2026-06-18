import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { resolveDestinationUrl } from "../src/destination-url.js";

describe("resolveDestinationUrl — search-engine redirect unwrapping", () => {
  it("unwraps a direct Bing /ck/a u= param", () => {
    const r = resolveDestinationUrl("https://www.bing.com/ck/a?u=https%3A%2F%2Fexample.com%2Fpage");
    expect(r.url).toBe("https://example.com/page");
    expect(r.method).toBe("bing_ck_u");
    expect(r.originalUrl).toContain("bing.com");
  });
  it("unwraps a base64url Bing u= with the a<digit> prefix", () => {
    const b64 = Buffer.from("https://example.com").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const r = resolveDestinationUrl(`https://www.bing.com/ck/a?u=a1${b64}`);
    expect(r.url).toBe("https://example.com/");
    expect(r.method).toBe("bing_ck_u");
  });
  it("unwraps Google /url and /aclk", () => {
    expect(resolveDestinationUrl("https://www.google.com/url?url=https%3A%2F%2Fexample.com").method).toBe("google_url_param");
    expect(resolveDestinationUrl("https://www.google.com/aclk?adurl=https%3A%2F%2Fads.example").url).toBe("https://ads.example/");
  });
  it("unwraps Naver and Yahoo redirects", () => {
    expect(resolveDestinationUrl("https://cr.naver.com/rd?u=https%3A%2F%2Fexample.com").method).toBe("naver_redirect_param");
    expect(resolveDestinationUrl("https://search.naver.com/p/crd/rd?u=https%3A%2F%2Fexample.com").method).toBe("naver_redirect_param");
    const yahoo = resolveDestinationUrl("https://r.search.yahoo.com/_ylt=A/RV=2/RU=https%3A%2F%2Fexample.com/RK=2/RS=x");
    expect(yahoo.url).toBe("https://example.com/");
    expect(yahoo.method).toBe("yahoo_ru_path");
  });
  it("follows up to a few nested redirects, reporting the last method", () => {
    const inner = `https://www.google.com/url?url=${encodeURIComponent("https://final.example/")}`;
    const outer = `https://www.bing.com/ck/a?u=${encodeURIComponent(inner)}`;
    const r = resolveDestinationUrl(outer);
    expect(r.url).toBe("https://final.example/");
    expect(r.method).toBe("google_url_param");
  });
  it("returns the url unchanged when there is nothing to unwrap or it is non-absolute", () => {
    expect(resolveDestinationUrl("https://example.com/")).toEqual({ url: "https://example.com/" });
    expect(resolveDestinationUrl("not a url")).toEqual({ url: "not a url" });
    expect(resolveDestinationUrl("/p", "https://example.com").url).toBe("https://example.com/p");
  });
  it("ignores redirect params that are not http(s)", () => {
    const r = resolveDestinationUrl("https://www.google.com/url?url=javascript:alert(1)");
    expect(r.method).toBeUndefined();
    expect(r.url).toBe("https://www.google.com/url?url=javascript:alert(1)");
  });
});
