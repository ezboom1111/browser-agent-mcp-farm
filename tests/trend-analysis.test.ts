import { describe, expect, it } from "vitest";

import { analyzeTrendSignals } from "../src/trend-analysis.js";

describe("analyzeTrendSignals", () => {
  it("extracts topical, recency, engagement, and local-commerce signals from a Naver Blog article body", () => {
    const report = analyzeTrendSignals({
      sourceUrl: "https://blog.naver.com/daae0206/224313319058",
      platform: "naver_blog",
      sourceFamily: "blog",
      title: "성수 대형 카페 추천 카페씨떼 주차 디저트 후기",
      text: [
        "성수 대형 카페 추천 카페씨떼 주차 디저트 후기 다에 ・ 2026. 6. 11.",
        "공감 45 댓글 28 공유하기",
        "성수역 카페씨떼 방문 후기 성수에서 카페를 찾다 보면 규모가 크고 여유로운 곳을 찾게 됩니다.",
        "주차 정보와 디저트, 내부 분위기, 직접 다녀온 후기까지 정리합니다.",
        "카페씨떼 기본 정보 위치 서울 성동구 성수이로 71 주3동 운영시간 10:00 ~ 22:00 라스트오더"
      ].join(" ")
    });

    expect(report.status).toBe("ok");
    expect(report.surface.articleBody).toBe(true);
    expect(report.topTerms.map((term) => term.term)).toEqual(expect.arrayContaining(["카페씨떼", "성수", "카페"]));
    expect(report.signals).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "recency", label: "2026. 6. 11" }), expect.objectContaining({ kind: "engagement", label: "댓글" }), expect.objectContaining({ kind: "local", label: "주차" }), expect.objectContaining({ kind: "commerce", label: "디저트" })]));
  });

  it("recognizes a Naver search result surface and finance/search terms", () => {
    const report = analyzeTrendSignals({
      sourceUrl: "https://search.naver.com/search.naver?query=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90",
      platform: "naver_search",
      sourceFamily: "search",
      text: "삼성전자 : 네이버 검색 검색 결과 검색옵션 정렬 관련도순 최신순 블로그 카페 뉴스 삼성전자 주가 시세 종목 거래량 코스피 삼성전자 삼성전자"
    });

    expect(report.surface.searchResult).toBe(true);
    expect(report.surface.articleBody).toBe(false);
    expect(report.signals).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "search_surface", label: "검색 결과" }), expect.objectContaining({ kind: "finance", label: "주가" })]));
    expect(report.topTerms[0]).toMatchObject({ term: "삼성전자" });
  });

  it("returns an empty report without inventing trend signals", () => {
    const report = analyzeTrendSignals({
      sourceUrl: "https://example.com/empty",
      platform: "generic",
      sourceFamily: "generic_web",
      text: "   "
    });

    expect(report.status).toBe("empty");
    expect(report.topTerms).toEqual([]);
    expect(report.signals).toEqual([]);
    expect(report.caveats).toContain("No readable page text was available; trend signals were not inferred.");
  });
});
