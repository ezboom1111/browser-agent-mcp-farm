import { describe, expect, it } from "vitest";
import { extractSearchResultCandidates } from "../src/search-result-candidates.js";

describe("extractSearchResultCandidates", () => {
  it("derives ranked Naver review candidates from visible links and screenshot presence", () => {
    const report = extractSearchResultCandidates({
      sourceUrl: "https://search.naver.com/search.naver?where=image&query=%EC%98%88%EC%8B%9C%ED%8C%8C%ED%81%AC%20%EB%82%B4%EB%8F%88%EB%82%B4%EC%82%B0%20%EC%82%AC%EC%A7%84",
      platform: "naver",
      text: "예시파크 본점: 주차 가격 놀이시설 음식 리뷰 (내돈내산)\n7살 내돈내산 키즈카페 추천 : 예시파크 서울 본점",
      visibleLinks: [
        { index: 0, url: "https://search.naver.com/", text: "검색" },
        { index: 1, url: "https://blog.naver.com/blogger_a/223761018314", text: "예시파크 본점: 주차 가격 놀이시설 음식 리뷰 (내돈내산)" },
        { index: 2, url: "https://blog.naver.com/blogger_b/224301853584", text: "7살 내돈내산 키즈카페 추천 : 예시파크 서울 본점" }
      ],
      pageScreenshotCount: 1
    });

    expect(report.status).toBe("ok");
    expect(report.query).toBe("예시파크 내돈내산 사진");
    expect(report.candidates).toHaveLength(2);
    expect(report.candidates[0]).toMatchObject({
      rank: 1,
      title: "예시파크 본점: 주차 가격 놀이시설 음식 리뷰 (내돈내산)",
      url: "https://blog.naver.com/blogger_a/223761018314",
      source: "blog.naver.com",
      thumbnailEvidence: "page_screenshot_present"
    });
    expect(report.candidates[0]?.matchedTerms).toEqual(expect.arrayContaining(["예시파크", "내돈내산"]));
  });

  it("falls back to captured text lines when links are unavailable", () => {
    const report = extractSearchResultCandidates({
      sourceUrl: "https://search.naver.com/search.naver?query=%EC%98%88%EC%8B%9C%ED%8C%8C%ED%81%AC%20%EB%82%B4%EB%8F%88%EB%82%B4%EC%82%B0",
      platform: "naver",
      text: "VIEW\n[중앙]예시파크 키즈카페 방문후기_내돈내산\n서울 강동 대형 키즈카페 예시파크 본점 내돈내산 솔직 리뷰 50% 할인 이벤트",
      visibleLinks: [],
      pageScreenshotCount: 0
    });

    expect(report.status).toBe("ok");
    expect(report.candidates.map((candidate) => candidate.title)).toEqual(["[중앙]예시파크 키즈카페 방문후기_내돈내산", "서울 강동 대형 키즈카페 예시파크 본점 내돈내산 솔직 리뷰 50% 할인 이벤트"]);
    expect(report.candidates[0]?.url).toBeUndefined();
    expect(report.candidates[0]?.thumbnailEvidence).toBe("not_captured");
  });
});
