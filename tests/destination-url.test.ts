import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { resolveDestinationUrl } from "../src/destination-url.js";

describe("resolveDestinationUrl", () => {
  it("unwraps Bing ck redirect URLs", () => {
    const destination = "https://www.agoda.com/ko-kr/travel-guides/japan/tokyo/";
    const encoded = Buffer.from(destination, "utf8").toString("base64url");

    expect(resolveDestinationUrl(`https://www.bing.com/ck/a?u=a1${encoded}&ntb=1`)).toEqual({
      url: destination,
      originalUrl: `https://www.bing.com/ck/a?u=a1${encoded}&ntb=1`,
      method: "bing_ck_u"
    });
  });

  it("unwraps Google organic and ad redirect params", () => {
    expect(resolveDestinationUrl("https://www.google.com/url?sa=t&q=https%3A%2F%2Fexample.com%2Fsource%3Fx%3D1")).toEqual({
      url: "https://example.com/source?x=1",
      originalUrl: "https://www.google.com/url?sa=t&q=https%3A%2F%2Fexample.com%2Fsource%3Fx%3D1",
      method: "google_url_param"
    });
    expect(resolveDestinationUrl("https://www.googleadservices.com/aclk?adurl=https%3A%2F%2Fmerchant.example%2Foffer")).toEqual({
      url: "https://merchant.example/offer",
      originalUrl: "https://www.googleadservices.com/aclk?adurl=https%3A%2F%2Fmerchant.example%2Foffer",
      method: "google_url_param"
    });
  });

  it("unwraps Naver desktop/mobile redirect params", () => {
    expect(resolveDestinationUrl("https://search.naver.com/p/crd/rd?m=1&u=https%3A%2F%2Fblog.naver.com%2Fpost%2F123")).toEqual({
      url: "https://blog.naver.com/post/123",
      originalUrl: "https://search.naver.com/p/crd/rd?m=1&u=https%3A%2F%2Fblog.naver.com%2Fpost%2F123",
      method: "naver_redirect_param"
    });
    expect(resolveDestinationUrl("https://m.search.naver.com/p/crd/rd?url=https%3A%2F%2Fplace.naver.com%2Frestaurant%2F42")).toEqual({
      url: "https://place.naver.com/restaurant/42",
      originalUrl: "https://m.search.naver.com/p/crd/rd?url=https%3A%2F%2Fplace.naver.com%2Frestaurant%2F42",
      method: "naver_redirect_param"
    });
  });

  it("unwraps Yahoo and Yahoo Japan RU path redirects", () => {
    expect(resolveDestinationUrl("https://r.search.yahoo.com/_ylt=Awr/RU=https%3A%2F%2Fpublisher.example%2Farticle/RK=2/RS=x")).toEqual({
      url: "https://publisher.example/article",
      originalUrl: "https://r.search.yahoo.com/_ylt=Awr/RU=https%3A%2F%2Fpublisher.example%2Farticle/RK=2/RS=x",
      method: "yahoo_ru_path"
    });
    expect(resolveDestinationUrl("https://r.search.yahoo.co.jp/RV=1/RU=https%3A%2F%2Ftravel.example.jp%2Ftokyo/RK=2")).toEqual({
      url: "https://travel.example.jp/tokyo",
      originalUrl: "https://r.search.yahoo.co.jp/RV=1/RU=https%3A%2F%2Ftravel.example.jp%2Ftokyo/RK=2",
      method: "yahoo_ru_path"
    });
  });

  it("resolves nested search redirects up to the bounded depth", () => {
    const google = "https://www.google.com/url?q=https%3A%2F%2Fofficial.example%2Fpage";
    const bing = `https://www.bing.com/ck/a?u=a1${Buffer.from(google, "utf8").toString("base64url")}`;

    expect(resolveDestinationUrl(bing)).toEqual({
      url: "https://official.example/page",
      originalUrl: bing,
      method: "google_url_param"
    });
  });
});
