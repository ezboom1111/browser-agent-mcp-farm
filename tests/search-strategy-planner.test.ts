import { describe, expect, it } from "vitest";
import { planIntentProfile } from "../src/intent-profile.js";
import { planSearchStrategy } from "../src/search-strategy-planner.js";
import { describeSourceStrategy } from "../src/source-strategy.js";

describe("planSearchStrategy", () => {
  it("plans visual Korean review search arms without hard-coding a selector harness", () => {
    const sourceUrl = "https://search.naver.com/search.naver?where=image&query=%EB%A1%9C%EB%9D%BC%EB%B0%94%EC%9A%B4%EC%8A%A4%20%EB%A6%AC%EB%B7%B0%20%EB%82%B4%EB%8F%88%EB%82%B4%EC%82%B0%20%EC%82%AC%EC%A7%84";
    const sourceStrategy = describeSourceStrategy(sourceUrl);
    const intentProfile = planIntentProfile({
      url: sourceUrl,
      sourcePlatform: sourceStrategy.platform,
      sourceFamily: sourceStrategy.sourceFamily,
      intent: {
        decisionNeeded: "로라바운스 내돈내산 리뷰 신뢰성과 사진 단서를 확인",
        targetScope: "한국어 공개 검색 결과",
        evidenceShapes: ["page_text", "semi_structured_dom", "ui_screenshot", "ocr_image_text"],
        successCriteria: "내돈내산, 가격/주차/시설/음식 이미지 단서를 가진 후보를 찾는다",
        boundaries: "public only no login paywall CAPTCHA bypass"
      }
    });

    const plan = planSearchStrategy({
      sourceUrl,
      sourceStrategy,
      intentProfile,
      trendTerms: ["로라바운스", "내돈내산", "리뷰"]
    });

    expect(plan.status).toBe("ok");
    expect(plan.baseQuery).toBe("로라바운스 리뷰 내돈내산 사진");
    expect(plan.arms.map((arm) => arm.armId)).toEqual(expect.arrayContaining(["current_surface", "naver_view_review", "naver_image_visual", "google_cross_check", "dissent_probe"]));
    expect(plan.arms.find((arm) => arm.armId === "naver_image_visual")).toMatchObject({
      platform: "naver_search",
      purpose: "visual",
      status: "try"
    });
    expect(plan.arms.find((arm) => arm.armId === "dissent_probe")?.query).toContain("단점");
    expect(plan.antiHarnessGuard).toContain("Search arms are hypotheses");
  });

  it("keeps social/video arms as cautious public leads for multimodal trend work", () => {
    const sourceUrl = "https://www.google.com/search?q=creator+trend";
    const sourceStrategy = describeSourceStrategy(sourceUrl);
    const intentProfile = planIntentProfile({
      url: sourceUrl,
      sourcePlatform: sourceStrategy.platform,
      sourceFamily: sourceStrategy.sourceFamily,
      intent: {
        decisionNeeded: "creator momentum trend watch",
        targetScope: "public social/video surfaces",
        evidenceShapes: ["page_text", "video_frames", "captions_transcript"],
        successCriteria: "Find public video/social leads with served captions or frame evidence",
        boundaries: "public only; no login/CAPTCHA bypass"
      }
    });

    const plan = planSearchStrategy({ sourceUrl, sourceStrategy, intentProfile, trendTerms: ["creator", "trend"] });

    expect(plan.arms.map((arm) => arm.armId)).toEqual(expect.arrayContaining(["youtube_video", "tiktok_public_lead", "x_threads_public_lead"]));
    expect(plan.arms.find((arm) => arm.armId === "youtube_video")).toMatchObject({ status: "try", purpose: "video" });
    expect(plan.arms.find((arm) => arm.armId === "tiktok_public_lead")).toMatchObject({ status: "defer", risk: "medium" });
    expect(plan.caveats.join("\n")).toContain("Search arms do not prove coverage");
  });
});
