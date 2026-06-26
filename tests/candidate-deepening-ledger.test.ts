import { describe, expect, it } from "vitest";
import { planCandidateDeepeningLedger } from "../src/candidate-deepening-ledger.js";
import { planIntentProfile } from "../src/intent-profile.js";
import type { SearchResultCandidatesReport } from "../src/search-result-candidates.js";
import { describeSourceStrategy } from "../src/source-strategy.js";

describe("planCandidateDeepeningLedger", () => {
  it("scores review candidates by intent fit, evidence richness, and source diversity", () => {
    const sourceUrl = "https://search.naver.com/search.naver?query=%EB%A1%9C%EB%9D%BC%EB%B0%94%EC%9A%B4%EC%8A%A4%20%EB%82%B4%EB%8F%88%EB%82%B4%EC%82%B0";
    const sourceStrategy = describeSourceStrategy(sourceUrl);
    const intentProfile = planIntentProfile({
      url: sourceUrl,
      sourcePlatform: sourceStrategy.platform,
      sourceFamily: sourceStrategy.sourceFamily,
      intent: {
        decisionNeeded: "내돈내산 리뷰 신뢰성과 가격/주차/시설 단서 확인",
        targetScope: "네이버 공개 리뷰 후보",
        evidenceShapes: ["page_text", "ui_screenshot", "ocr_image_text"],
        successCriteria: "내돈내산, 가격, 주차, 시설 사진 단서가 있는 destination을 우선 연다",
        boundaries: "public only no login paywall CAPTCHA bypass"
      }
    });
    const candidates: SearchResultCandidatesReport = {
      schemaVersion: "1.0",
      sourceUrl,
      platform: "naver_search",
      status: "ok",
      query: "로라바운스 내돈내산",
      candidates: [
        {
          rank: 1,
          title: "로라바운스 천호점: 주차 가격 놀이시설 음식 리뷰 (내돈내산)",
          url: "https://blog.naver.com/kindly2day/223761018314",
          source: "blog.naver.com",
          matchedTerms: ["로라바운스", "내돈내산"],
          thumbnailEvidence: "page_screenshot_present",
          signals: ["query_term_match", "review_intent", "detail_intent", "naver_blog_source"]
        },
        {
          rank: 2,
          title: "로라바운스 리뷰왕 이벤트",
          url: "https://blog.naver.com/rollerbounce/224237135230",
          source: "blog.naver.com",
          matchedTerms: ["로라바운스"],
          thumbnailEvidence: "page_screenshot_present",
          signals: ["query_term_match", "review_intent", "naver_blog_source"]
        },
        {
          rank: 3,
          title: "안양 애플트리 로라바운스 <사진많음>",
          url: "https://cafe.naver.com/example/1",
          source: "cafe.naver.com",
          matchedTerms: ["로라바운스"],
          thumbnailEvidence: "page_screenshot_present",
          signals: ["query_term_match", "detail_intent"]
        }
      ],
      evidenceInputs: { textChars: 1000, visibleLinkCount: 3, pageScreenshotCount: 1 },
      caveats: []
    };

    const ledger = planCandidateDeepeningLedger({ sourceUrl, intentProfile, searchResultCandidates: candidates, maxSelected: 2 });

    expect(ledger.status).toBe("ok");
    expect(ledger.selectedCount).toBe(2);
    expect(ledger.decisions[0]).toMatchObject({
      candidateRank: 1,
      selected: true,
      priority: "must_open",
      nextAction: "open_destination_capture"
    });
    expect(ledger.decisions[0]?.reasons).toEqual(expect.arrayContaining(["review_intent_match", "visual_or_ocr_evidence_available", "detail_terms_present"]));
    expect(ledger.decisions.find((decision) => decision.source === "cafe.naver.com")?.warnings).toEqual(expect.arrayContaining(["possible_login_or_membership_wall"]));
  });

  it("records an empty ledger when no search candidates exist", () => {
    const sourceUrl = "https://example.com/search?q=none";
    const sourceStrategy = describeSourceStrategy(sourceUrl);
    const intentProfile = planIntentProfile({
      url: sourceUrl,
      sourcePlatform: sourceStrategy.platform,
      sourceFamily: sourceStrategy.sourceFamily
    });
    const ledger = planCandidateDeepeningLedger({
      sourceUrl,
      intentProfile,
      searchResultCandidates: {
        schemaVersion: "1.0",
        sourceUrl,
        platform: "generic",
        status: "empty",
        candidates: [],
        evidenceInputs: { textChars: 0, visibleLinkCount: 0, pageScreenshotCount: 0 },
        caveats: []
      }
    });

    expect(ledger.status).toBe("empty");
    expect(ledger.decisions).toEqual([]);
    expect(ledger.caveats.join("\n")).toContain("No candidates");
  });
});
