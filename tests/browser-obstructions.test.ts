import { describe, expect, it } from "vitest";
import { classifyBrowserObstructions } from "../src/browser-obstructions.js";

describe("classifyBrowserObstructions", () => {
  it("detects Instagram login walls with social-platform confidence boost", () => {
    const report = classifyBrowserObstructions({
      platform: "instagram",
      url: "https://www.instagram.com/p/example/",
      title: "Login required",
      text: "Log in to continue. Sign up to view this content."
    });

    expect(report.status).toBe("detected");
    expect(report.detections).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "login_wall", confidence: "high" })]));
  });

  it("detects app-open interstitials", () => {
    const report = classifyBrowserObstructions({
      platform: "tiktok",
      url: "https://www.tiktok.com/@user/video/123",
      text: "Open the app to continue. Download the app for the full experience."
    });

    expect(report.status).toBe("detected");
    expect(report.detections).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "app_interstitial", confidence: "high" })]));
  });

  it("detects TikTok server-error pages as unavailable media", () => {
    const report = classifyBrowserObstructions({
      platform: "tiktok",
      url: "https://www.tiktok.com/search?q=tokyo+travel",
      text: "Something went wrong. Sorry, something wrong with the server, please try again. Try again Log in"
    });

    expect(report.status).toBe("detected");
    expect(report.detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "media_unavailable",
          confidence: "high",
          matchedSignals: expect.arrayContaining(["something went wrong", "something wrong with the server"])
        })
      ])
    );
  });

  it("detects bot blocks", () => {
    const report = classifyBrowserObstructions({
      platform: "generic",
      url: "https://example.com/",
      text: "Checking your browser. Verify you are human before continuing."
    });

    expect(report.status).toBe("detected");
    expect(report.detections).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "bot_block", confidence: "high" })]));
  });

  it("detects Korean marketplace access and bot-check blocks", () => {
    const naverShopping = classifyBrowserObstructions({
      platform: "naver_shopping",
      url: "https://shopping.naver.com/search/all?query=test",
      text: "\uC1FC\uD551 \uC11C\uBE44\uC2A4 \uC811\uC18D\uC774 \uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uBE44\uC815\uC0C1\uC801\uC778 \uC811\uADFC\uC774 \uAC10\uC9C0\uB418\uC5C8\uC2B5\uB2C8\uB2E4."
    });
    const gmarket = classifyBrowserObstructions({
      platform: "gmarket",
      url: "https://browse.gmarket.co.kr/search?keyword=test",
      text: "\uC6D0\uD65C\uD55C \uC11C\uBE44\uC2A4 \uC774\uC6A9\uC744 \uC704\uD55C \uAC04\uB2E8\uD55C \uD655\uC778 \uC548\uB0B4. \uBD07(Bot)\uC774\uB780?"
    });

    for (const report of [naverShopping, gmarket]) {
      expect(report.status).toBe("detected");
      expect(report.detections).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "bot_block", confidence: "high" })]));
    }
  });

  it("detects Korean travel bot/access limitation pages", () => {
    const report = classifyBrowserObstructions({
      platform: "tripadvisor",
      url: "https://www.tripadvisor.com/Hotels-g298184-Tokyo_Tokyo_Prefecture_Kanto-Hotels.html",
      title: "tripadvisor.com",
      text: "\uC561\uC138\uC2A4\uAC00 \uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uADC0\uD558\uC758 \uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uBE44\uC815\uC0C1\uC801\uC778 \uD589\uB3D9\uC774 \uAC80\uCD9C\uB418\uC5B4 \uCD94\uAC00 \uAC80\uC99D\uC774 \uD544\uC694\uD569\uB2C8\uB2E4. \uADC0\uD558\uC758 \uD074\uB9AD\uC218\uC640 \uBE0C\uB77C\uC6B0\uC9D5 \uC18D\uB3C4\uAC00 \uBE44\uC815\uC0C1\uC801\uC73C\uB85C \uBE68\uB77C \uB85C\uBD07\uC73C\uB85C \uC758\uC2EC\uB418\uB294 IP \uC8FC\uC18C\uAC00 \uADC0\uD558\uC758 \uB124\uD2B8\uC6CC\uD06C\uC5D0\uC11C \uBC1C\uACAC \uB418\uC5C8\uC74C\uC744 \uC54C\uB824\uB4DC\uB9BD\uB2C8\uB2E4."
    });

    expect(report.status).toBe("detected");
    expect(report.detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "bot_block",
          confidence: "high",
          matchedSignals: expect.arrayContaining(["\uC561\uC138\uC2A4\uAC00 \uC77C\uC2DC\uC801\uC73C\uB85C \uC81C\uD55C", "\uCD94\uAC00 \uAC80\uC99D\uC774 \uD544\uC694", "\uB85C\uBD07\uC73C\uB85C \uC758\uC2EC"])
        })
      ])
    );
  });

  it("detects Naver Map service-limit pages as bot blocks", () => {
    const report = classifyBrowserObstructions({
      platform: "generic",
      url: "https://map.naver.com/p/entry/place/1790076538",
      title: "\uC820\uC820 \uC131\uC218\uC810 - \uB124\uC774\uBC84\uC9C0\uB3C4",
      text: "\uC11C\uBE44\uC2A4 \uC774\uC6A9\uC774 \uC81C\uD55C\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uACFC\uB3C4\uD55C \uC811\uADFC \uC694\uCCAD\uC73C\uB85C \uC11C\uBE44\uC2A4 \uC774\uC6A9\uC774 \uC81C\uD55C\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574\uC8FC\uC138\uC694."
    });

    expect(report.status).toBe("detected");
    expect(report.detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "bot_block",
          confidence: "high",
          matchedSignals: expect.arrayContaining(["\uC11C\uBE44\uC2A4 \uC774\uC6A9\uC774 \uC81C\uD55C", "\uACFC\uB3C4\uD55C \uC811\uADFC \uC694\uCCAD"])
        })
      ])
    );
  });

  it("detects global travel security and access blocks", () => {
    const report = classifyBrowserObstructions({
      platform: "booking_com",
      url: "https://www.booking.com/searchresults.html?ss=tokyo",
      title: "Pardon Our Interruption",
      text: "Access to this page has been denied. Please complete the security check and enable cookies to continue."
    });

    expect(report.status).toBe("detected");
    expect(report.detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "bot_block",
          confidence: "high",
          matchedSignals: expect.arrayContaining(["access to this page has been denied", "complete the security check", "enable cookies to continue"])
        })
      ])
    );
  });

  it("detects Cloudflare-style security verification and network security blocks", () => {
    const cloudflare = classifyBrowserObstructions({
      platform: "stack_overflow",
      url: "https://stackoverflow.com/search?q=tokyo+travel",
      title: "Performing security verification",
      text: "This website uses a security service to protect against malicious bots. This page is displayed while the website verifies you are not a bot. Ray ID: abc. Performance and Security by Cloudflare."
    });
    const networkSecurity = classifyBrowserObstructions({
      platform: "reddit",
      url: "https://www.reddit.com/search/?q=tokyo+travel",
      text: "You've been blocked by network security. If you think you've been blocked by mistake, file a ticket below."
    });

    for (const report of [cloudflare, networkSecurity]) {
      expect(report.status).toBe("detected");
      expect(report.detections).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "bot_block", confidence: "high" })]));
    }
    expect(cloudflare.detections.find((detection) => detection.kind === "bot_block")?.matchedSignals).toEqual(expect.arrayContaining(["performing security verification", "security service to protect against malicious bots", "verifies you are not a bot", "ray id:"]));
    expect(networkSecurity.detections.find((detection) => detection.kind === "bot_block")?.matchedSignals).toEqual(expect.arrayContaining(["you've been blocked by network security", "blocked by network security"]));
  });

  it("detects DataDome captcha-delivery challenge shells", () => {
    const report = classifyBrowserObstructions({
      platform: "generic",
      url: "https://www.reuters.com/site-search/?query=AI%20policy",
      finalUrl: "https://www.reuters.com/site-search/?query=AI%20policy",
      text: "var dd={'rt':'c','host':'geo.captcha-delivery.com','cid':'challenge'}; DataDome challenge required."
    });

    expect(report.status).toBe("detected");
    expect(report.detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "bot_block",
          confidence: "high",
          matchedSignals: expect.arrayContaining(["datadome", "captcha-delivery.com", "geo.captcha-delivery.com", "var dd="])
        })
      ])
    );
  });

  it("detects Expedia human-or-bot challenge pages", () => {
    const report = classifyBrowserObstructions({
      platform: "expedia",
      url: "https://www.expedia.com/Hotel-Search?destination=Tokyo",
      title: "Bot or Not?",
      text: "Show us your human side. We can't tell if you're a human or a bot."
    });

    expect(report.status).toBe("detected");
    expect(report.detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "bot_block",
          confidence: "high",
          matchedSignals: expect.arrayContaining(["show us your human side", "human or a bot", "can't tell if you're a human or a bot", "bot or not?"])
        })
      ])
    );
  });

  it("detects Bing-style solve-the-task search challenges", () => {
    const report = classifyBrowserObstructions({
      platform: "generic",
      url: "https://www.bing.com/search?q=tokyo+hotel",
      title: "tokyo hotel - Bing",
      text: "Skip to content Rewards To continue, solve the task below. \uACC4\uC18D\uD558\uB824\uBA74 \uC544\uB798 \uACFC\uC81C \uD574\uACB0"
    });

    expect(report.status).toBe("detected");
    expect(report.detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "bot_block",
          confidence: "high",
          matchedSignals: expect.arrayContaining(["solve the task below", "\uACC4\uC18D\uD558\uB824\uBA74 \uC544\uB798 \uACFC\uC81C", "\uC544\uB798 \uACFC\uC81C \uD574\uACB0"])
        })
      ])
    );
  });

  it("does not classify a stray robot token as a bot block", () => {
    const report = classifyBrowserObstructions({
      platform: "generic",
      url: "https://cafe.naver.com/ca-fe/home/search/articles?q=test",
      title: "Naver Cafe",
      text: "Public cafe search page. robots meta tag and robot asset strings are present in the document shell."
    });

    expect(report.status).toBe("clear");
    expect(report.detections).toHaveLength(0);
  });

  it("returns clear for normal browser-visible content", () => {
    const report = classifyBrowserObstructions({
      platform: "generic",
      url: "https://example.com/",
      title: "Example Domain",
      text: "This domain is for use in illustrative examples in documents."
    });

    expect(report.status).toBe("clear");
    expect(report.detections).toHaveLength(0);
  });

  it("does not treat travel page chrome as a blocking login or app wall", () => {
    const booking = classifyBrowserObstructions({
      platform: "generic",
      url: "https://www.booking.com/searchresults.html?ss=Tokyo",
      title: "10 Best Tokyo Hotels, Japan",
      text: "USD Register Sign in Search hotels in Tokyo Onyado Nono Asakusa Annex Hotel in Taito, Tokyo.",
      html: "<script>Sign in to continue with a loyalty prompt</script>"
    });
    const agoda = classifyBrowserObstructions({
      platform: "generic",
      url: "https://www.agoda.com/city/tokyo-jp.html",
      title: "11 Best Hotels in Tokyo, Japan",
      text: "Get the app. Tokyo hotels and places to stay. Could not load one image. Mitsui Garden Hotel Nihonbashi Premier."
    });

    expect(booking.status).toBe("clear");
    expect(booking.detections).toHaveLength(0);
    expect(agoda.status).toBe("clear");
    expect(agoda.detections).toHaveLength(0);
  });
});
