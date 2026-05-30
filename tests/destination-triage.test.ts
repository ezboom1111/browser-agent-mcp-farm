import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  buildDestinationDeepeningCandidates,
  buildDestinationDeepeningProposals,
  buildDestinationTriage,
  classifyDestinationChildUsefulness,
  classifyDestinationProbeCandidate,
  matchingDestinationQueryTokens,
  selectedDestinationRequests,
  summarizeDestinationTriageResult,
  type DestinationChildEvidenceSummary,
  type DestinationChildRunResult
} from "../src/destination-triage.js";

function childEvidence(overrides: Partial<DestinationChildEvidenceSummary> = {}): DestinationChildEvidenceSummary {
  return {
    artifactCount: 5,
    claimCount: 2,
    browserCaptureRecords: 1,
    obstructionCount: 0,
    pageTextLength: 200,
    queryOverlapTokenCount: 3,
    matchedQueryTokens: ["coffee"],
    deeperCandidateCount: 0,
    evidenceSignals: [],
    evidenceWarnings: [],
    ...overrides
  };
}

function okResult(evidence: DestinationChildEvidenceSummary | undefined): DestinationChildRunResult {
  return { actionKey: "a", url: "https://example.com/", status: "ok", ...(evidence === undefined ? {} : { childEvidence: evidence }) };
}

function errResult(error: string): DestinationChildRunResult {
  return { actionKey: "a", url: "https://example.com/", status: "error", error };
}

describe("classifyDestinationChildUsefulness", () => {
  it("treats a missing result or missing evidence as useful (benefit of the doubt)", () => {
    expect(classifyDestinationChildUsefulness(undefined, "coffee")).toBe("useful");
    expect(classifyDestinationChildUsefulness(okResult(undefined), "coffee")).toBe("useful");
  });

  it("classifies good evidence as useful", () => {
    expect(classifyDestinationChildUsefulness(okResult(childEvidence()), "coffee")).toBe("useful");
  });

  it("flags obstructions as blocked", () => {
    expect(classifyDestinationChildUsefulness(okResult(childEvidence({ obstructionCount: 1 })), "coffee")).toBe("blocked");
    expect(classifyDestinationChildUsefulness(okResult(childEvidence({ evidenceWarnings: ["browser_obstruction_detected"] })), "coffee")).toBe("blocked");
  });

  it("flags empty captures/text/claims as low_value", () => {
    expect(classifyDestinationChildUsefulness(okResult(childEvidence({ claimCount: 0 })), "coffee")).toBe("low_value");
    expect(classifyDestinationChildUsefulness(okResult(childEvidence({ browserCaptureRecords: 0 })), "coffee")).toBe("low_value");
    expect(classifyDestinationChildUsefulness(okResult(childEvidence({ pageTextLength: 0 })), "coffee")).toBe("low_value");
  });

  it("flags zero query overlap as off_topic", () => {
    expect(classifyDestinationChildUsefulness(okResult(childEvidence({ queryOverlapTokenCount: 0 })), "coffee")).toBe("off_topic");
  });

  it("maps error surfaces to paywalled / private / blocked", () => {
    expect(classifyDestinationChildUsefulness(errResult("subscribe to read this paywalled article"), "x")).toBe("paywalled");
    expect(classifyDestinationChildUsefulness(errResult("please sign in to your account to continue"), "x")).toBe("private");
    expect(classifyDestinationChildUsefulness(errResult("navigation timeout"), "x")).toBe("blocked");
  });
});

describe("matchingDestinationQueryTokens", () => {
  it("returns the overlapping query tokens", () => {
    expect(matchingDestinationQueryTokens("coffee shop", "the best coffee in town")).toEqual(["coffee"]);
  });

  it("returns nothing when there is no overlap", () => {
    expect(matchingDestinationQueryTokens("airline tickets", "vintage guitar amplifier")).toEqual([]);
  });
});

describe("buildDestinationTriage", () => {
  it("selects useful query-matching destinations over low-value navigation links", () => {
    const requests = [
      {
        actionKey: "destination-followup",
        url: "https://example.com/privacy",
        linkText: "Privacy policy"
      },
      {
        actionKey: "destination-followup",
        url: "https://official.example.com/seoul-station-coffee",
        linkText: "Official Seoul Station coffee guide"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=coffee+near+Seoul+Station",
      platform: "google_search",
      sourceFamily: "search",
      requests,
      maxSelected: 1
    });

    expect(triage).toMatchObject({
      executionPolicy: "bounded_destination_triage",
      candidateCount: 2,
      selectedCount: 1,
      rejectedCount: 1
    });
    expect(triage.selected[0]).toMatchObject({
      url: "https://official.example.com/seoul-station-coffee",
      usefulness: "useful",
      reasonCodes: {
        positive: expect.arrayContaining(["query_overlap", "official_domain_match", "source_family_fit"])
      }
    });
    expect(triage.selected[0]?.signals).toEqual(expect.arrayContaining(["query_overlap", "authority_hint"]));
    expect(triage.rejected[0]).toMatchObject({
      url: "https://example.com/privacy",
      usefulness: "low_value",
      reasonCodes: {
        negative: expect.arrayContaining(["portal_shell"])
      }
    });
    expect(triage.summary).toMatchObject({
      positiveReasonCounts: expect.arrayContaining([
        { reasonCode: "query_overlap", count: 1 },
        { reasonCode: "official_domain_match", count: 1 }
      ]),
      negativeReasonCounts: expect.arrayContaining([{ reasonCode: "portal_shell", count: 1 }])
    });
    expect(selectedDestinationRequests(triage, requests)).toEqual([requests[1]]);
  });

  it("deduplicates destinations and marks child errors as blocked", () => {
    const requests = [
      {
        actionKey: "first",
        url: "https://news.example.com/story?id=1#section",
        linkText: "Publisher article"
      },
      {
        actionKey: "second",
        url: "https://news.example.com/story?id=1",
        linkText: "Same publisher article"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://search.naver.com/search.naver?where=news&query=AI+policy",
      platform: "naver_search",
      sourceFamily: "search",
      requests,
      maxSelected: 2,
      childResults: [
        {
          actionKey: "first",
          url: "https://news.example.com/story?id=1#section",
          status: "error",
          error: "network security block"
        }
      ]
    });

    expect(triage.selected[0]).toMatchObject({
      actionKey: "first",
      usefulness: "blocked",
      reasonCodes: {
        negative: expect.arrayContaining(["blocked_surface"])
      }
    });
    expect(triage.rejected[0]).toMatchObject({
      actionKey: "second",
      usefulness: "duplicate",
      reasonCodes: {
        negative: expect.arrayContaining(["duplicate"])
      }
    });

    const summary = summarizeDestinationTriageResult({
      selected: triage.selected,
      rejected: triage.rejected,
      candidateCount: triage.candidateCount,
      maxSelected: triage.maxSelected,
      maxPerDomain: triage.maxPerDomain,
      records: 2
    });
    expect(summary).toMatchObject({
      status: "partial",
      blockedCount: 1,
      duplicateCount: 1,
      negativeReasonCounts: expect.arrayContaining([
        { reasonCode: "blocked_surface", count: 1 },
        { reasonCode: "duplicate", count: 1 }
      ]),
      records: 2
    });
  });

  it("limits selected destinations per domain before child evidence runs", () => {
    const requests = [
      {
        actionKey: "first",
        url: "https://same.example.com/official-seoul-station-coffee-one",
        linkText: "Official Seoul Station coffee guide"
      },
      {
        actionKey: "second",
        url: "https://same.example.com/official-seoul-station-coffee-two",
        linkText: "Official Seoul Station coffee menu"
      },
      {
        actionKey: "third",
        url: "https://other.example.org/seoul-station-coffee-three",
        linkText: "Seoul Station coffee details"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=coffee+near+Seoul+Station",
      platform: "google_search",
      sourceFamily: "search",
      requests,
      maxSelected: 2,
      maxPerDomain: 1
    });

    expect(triage.selected.map((candidate) => candidate.domain)).toEqual(["same.example.com", "other.example.org"]);
    expect(triage.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionKey: "first",
          usefulness: "budget_limited",
          rejectionReason: "Candidate was outside the per-domain destination budget of 1.",
          reasonCodes: expect.objectContaining({
            negative: expect.arrayContaining(["domain_budget"])
          })
        })
      ])
    );
    expect(triage.summary).toMatchObject({
      status: "selected",
      candidateCount: 3,
      selectedCount: 2,
      rejectedCount: 1,
      budgetLimitedCount: 1,
      maxSelected: 2,
      maxPerDomain: 1
    });
    expect(selectedDestinationRequests(triage, requests)).toEqual([requests[1], requests[2]]);
  });

  it("resolves Bing redirect destinations before scoring and follow-up execution", () => {
    const agoda = "https://www.agoda.com/ko-kr/travel-guides/japan/tokyo/things-to-do-in-tokyo-japan/";
    const trip = "https://kr.trip.com/blog/tokyo-japan/";
    const agodaRedirect = bingRedirectUrl(agoda);
    const tripRedirect = bingRedirectUrl(trip);
    const requests = [
      {
        actionKey: "destination-followup",
        url: agodaRedirect,
        linkText: "Things to do in Tokyo travel guide"
      },
      {
        actionKey: "destination-followup",
        url: tripRedirect,
        linkText: "Tokyo Japan travel blog"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://www.bing.com/search?q=tokyo+hotel",
      platform: "bing",
      sourceFamily: "search",
      requests,
      maxSelected: 2,
      maxPerDomain: 1
    });

    expect(triage.selected.map((candidate) => candidate.url)).toEqual([agoda, trip]);
    expect(triage.selected.map((candidate) => candidate.domain)).toEqual(["www.agoda.com", "kr.trip.com"]);
    expect(triage.selected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalUrl: agodaRedirect,
          urlResolutionMethod: "bing_ck_u",
          signals: expect.arrayContaining(["external_destination"])
        })
      ])
    );
    expect(selectedDestinationRequests(triage, requests)).toEqual([expect.objectContaining({ url: agoda, originalUrl: agodaRedirect, urlResolutionMethod: "bing_ck_u" }), expect.objectContaining({ url: trip, originalUrl: tripRedirect, urlResolutionMethod: "bing_ck_u" })]);
    expect(triage.summary).toMatchObject({
      selectedCount: 2,
      budgetLimitedCount: 0
    });
  });

  it("does not treat Google Maps authuser place URLs as login surfaces", () => {
    const requests = [
      {
        actionKey: "place",
        url: "https://www.google.com/maps/place/Cafe/data=!4m7!3m6!1s0x123?authuser=0&hl=ko&rclk=1",
        linkText: "Cafe map place reviews"
      },
      {
        actionKey: "signin",
        url: "https://accounts.google.com/signin",
        linkText: "Sign in to Google"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://www.google.com/maps/search/seongsu%20cafe",
      platform: "google_maps",
      sourceFamily: "map",
      requests,
      maxSelected: 1
    });

    expect(triage.query).toBe("seongsu cafe");
    expect(triage.selected[0]).toMatchObject({
      actionKey: "place",
      usefulness: "useful",
      warnings: expect.not.arrayContaining(["login_or_account_surface"]),
      reasonCodes: {
        positive: expect.arrayContaining(["local_place_match", "source_family_fit"]),
        negative: expect.not.arrayContaining(["private_or_login_surface"])
      }
    });
    expect(triage.rejected[0]).toMatchObject({
      actionKey: "signin",
      usefulness: "private",
      reasonCodes: {
        negative: expect.arrayContaining(["private_or_login_surface"])
      }
    });
  });

  it("rejects map provider boilerplate links while keeping place destinations", () => {
    const requests = [
      {
        actionKey: "provider-home",
        url: "https://www.naver.com/",
        linkText: "Naver"
      },
      {
        actionKey: "help",
        url: "https://help.naver.com/service/5622",
        linkText: "Naver Map help"
      },
      {
        actionKey: "place",
        url: "https://place.naver.com/restaurant/12345",
        linkText: "Seongsu cafe place reviews"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://map.naver.com/p/search/seongsu%20cafe",
      platform: "naver_map",
      sourceFamily: "map",
      requests,
      maxSelected: 1
    });

    expect(triage.selected[0]).toMatchObject({
      actionKey: "place",
      candidateKind: "map_place",
      reasonCodes: {
        positive: expect.arrayContaining(["local_place_match", "source_family_fit"])
      }
    });
    expect(triage.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionKey: "provider-home",
          usefulness: "low_value",
          reasonCodes: expect.objectContaining({
            negative: expect.arrayContaining(["portal_shell"])
          })
        }),
        expect.objectContaining({
          actionKey: "help",
          usefulness: "low_value",
          reasonCodes: expect.objectContaining({
            negative: expect.arrayContaining(["portal_shell"])
          })
        })
      ])
    );
  });

  it("keeps Naver map entry fallback candidates as place evidence with canonical provenance", () => {
    const requests = [
      {
        actionKey: "place-entry",
        url: "https://map.naver.com/p/entry/place/12345",
        originalUrl: "https://place.naver.com/restaurant/12345",
        urlResolutionMethod: "naver_place_entry_fallback" as const,
        linkText: "Seongsu cafe place reviews"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://map.naver.com/p/search/seongsu%20cafe",
      platform: "naver_map",
      sourceFamily: "map",
      requests,
      maxSelected: 1
    });

    expect(triage.selected[0]).toMatchObject({
      actionKey: "place-entry",
      url: "https://map.naver.com/p/entry/place/12345",
      originalUrl: "https://place.naver.com/restaurant/12345",
      urlResolutionMethod: "naver_place_entry_fallback",
      candidateKind: "map_place",
      reasonCodes: {
        positive: expect.arrayContaining(["local_place_match", "source_family_fit"]),
        negative: expect.not.arrayContaining(["portal_shell"])
      }
    });
    expect(selectedDestinationRequests(triage, requests)).toEqual([requests[0]]);
  });

  it("classifies same-page and map shell hash anchors as non-promotable probes", () => {
    const samePage = classifyDestinationProbeCandidate({
      parentUrl: "https://search.example.com/results?q=ramen",
      sourceFamily: "search",
      url: "https://search.example.com/results?q=ramen#top",
      linkText: "Back to top"
    });
    const naverShell = classifyDestinationProbeCandidate({
      parentUrl: "https://map.naver.com/p/search/seongsu%20cafe",
      sourceFamily: "map",
      url: "https://map.naver.com/p/#section_content",
      linkText: "본문 바로가기"
    });
    const naverPlace = classifyDestinationProbeCandidate({
      parentUrl: "https://map.naver.com/p/search/seongsu%20cafe",
      sourceFamily: "map",
      url: "https://place.naver.com/restaurant/12345",
      linkText: "Seongsu cafe place"
    });

    expect(samePage).toMatchObject({
      promotable: false,
      warnings: expect.arrayContaining(["low_value_navigation_surface"])
    });
    expect(naverShell).toMatchObject({
      promotable: false,
      warnings: expect.arrayContaining(["low_value_navigation_surface"])
    });
    expect(naverPlace).toMatchObject({
      promotable: true,
      warnings: []
    });
  });

  it("classifies provider vertical search links as non-promotable probes", () => {
    const yahooNews = classifyDestinationProbeCandidate({
      parentUrl: "https://search.yahoo.com/search?p=tokyo+hotel",
      sourceFamily: "search",
      url: "https://news.search.yahoo.com/search?p=tokyo+hotel",
      linkText: "News"
    });
    const yahooImage = classifyDestinationProbeCandidate({
      parentUrl: "https://images.search.yahoo.com/search/images?p=tokyo+hotel",
      sourceFamily: "search",
      url: "https://video.search.yahoo.com/search/video?p=tokyo+hotel",
      linkText: "Videos"
    });
    const bingNews = classifyDestinationProbeCandidate({
      parentUrl: "https://www.bing.com/search?q=tokyo+hotel",
      sourceFamily: "search",
      url: "https://www.bing.com/news/search?q=tokyo+hotel",
      linkText: "News"
    });
    const googleHome = classifyDestinationProbeCandidate({
      parentUrl: "https://www.google.com/search?q=tokyo+hotel",
      sourceFamily: "search",
      url: "https://www.google.com/webhp?hl=en",
      linkText: "Go to Google Home"
    });
    const googleLabs = classifyDestinationProbeCandidate({
      parentUrl: "https://www.google.com/search?q=tokyo+hotel",
      sourceFamily: "search",
      url: "https://labs.google.com/search?source=srp",
      linkText: "Search Labs"
    });
    const googleApps = classifyDestinationProbeCandidate({
      parentUrl: "https://www.google.com/search?q=tokyo+hotel",
      sourceFamily: "search",
      url: "https://www.google.co.kr/intl/en/about/products?tab=wh",
      linkText: "Google apps"
    });
    const googleImages = classifyDestinationProbeCandidate({
      parentUrl: "https://www.google.com/search?q=tokyo+hotel",
      sourceFamily: "search",
      url: "https://www.google.com/search?q=tokyo+hotel&udm=2",
      linkText: "Images"
    });
    const googleMapsVertical = classifyDestinationProbeCandidate({
      parentUrl: "https://www.google.com/search?q=tokyo+hotel",
      sourceFamily: "search",
      url: "https://maps.google.com/maps?output=search&q=tokyo+hotel",
      linkText: "Maps"
    });
    const yahooHome = classifyDestinationProbeCandidate({
      parentUrl: "https://search.yahoo.com/search?p=tokyo+hotel",
      sourceFamily: "search",
      url: "https://www.yahoo.com/",
      linkText: "Yahoo"
    });
    const yahooFeedback = classifyDestinationProbeCandidate({
      parentUrl: "https://search.yahoo.com/search?p=tokyo+hotel",
      sourceFamily: "search",
      url: "https://yahoo.uservoice.com/forums/193847-search",
      linkText: "Feedback"
    });
    const publisher = classifyDestinationProbeCandidate({
      parentUrl: "https://news.search.yahoo.com/search?p=tokyo+hotel",
      sourceFamily: "search",
      url: "https://news.yahoo.com/tokyo-hotel-story-2026",
      linkText: "Publisher Tokyo hotel story"
    });
    const googleTravel = classifyDestinationProbeCandidate({
      parentUrl: "https://www.google.com/search?q=tokyo+hotel",
      sourceFamily: "search",
      url: "https://www.google.com/travel/hotels/Tokyo",
      linkText: "Tokyo hotels"
    });

    for (const result of [yahooNews, yahooImage, bingNews, googleHome, googleLabs, googleApps, googleImages, googleMapsVertical, yahooHome, yahooFeedback]) {
      expect(result).toMatchObject({
        promotable: false,
        warnings: expect.arrayContaining(["low_value_navigation_surface"])
      });
    }
    expect(publisher).toMatchObject({
      promotable: true,
      warnings: []
    });
    expect(googleTravel).toMatchObject({
      promotable: true
    });
    expect(googleTravel.warnings).not.toContain("low_value_navigation_surface");
  });

  it("classifies Google News shell navigation as non-promotable while preserving article read links", () => {
    const parentUrl = "https://news.google.com/search?q=AI+policy";
    const home = classifyDestinationProbeCandidate({
      parentUrl,
      sourceFamily: "portal",
      url: "https://news.google.com/home?hl=en-US&gl=US&ceid=US%3Aen",
      linkText: "Home"
    });
    const following = classifyDestinationProbeCandidate({
      parentUrl,
      sourceFamily: "portal",
      url: "https://news.google.com/my/library?hl=en-US&gl=US&ceid=US%3Aen",
      linkText: "Following"
    });
    const googleApps = classifyDestinationProbeCandidate({
      parentUrl,
      sourceFamily: "portal",
      url: "https://www.google.co.kr/intl/en/about/products?tab=nh",
      linkText: "Google apps"
    });
    const article = classifyDestinationProbeCandidate({
      parentUrl,
      sourceFamily: "portal",
      url: "https://news.google.com/read/CBMiFixtureArticle?hl=en-US&gl=US&ceid=US%3Aen",
      linkText: "AI policy publisher article"
    });

    for (const result of [home, following, googleApps]) {
      expect(result).toMatchObject({
        promotable: false,
        warnings: expect.arrayContaining(["low_value_navigation_surface"])
      });
    }
    expect(article).toMatchObject({
      promotable: true,
      warnings: []
    });
  });

  it("classifies Reuters section/search utility links as non-promotable while preserving dated article links", () => {
    const parentUrl = "https://www.reuters.com/site-search/?query=AI%20policy";
    const section = classifyDestinationProbeCandidate({
      parentUrl,
      sourceFamily: "portal",
      url: "https://www.reuters.com/world/",
      linkText: "World"
    });
    const search = classifyDestinationProbeCandidate({
      parentUrl,
      sourceFamily: "portal",
      url: "https://www.reuters.com/site-search/?query=AI%20policy",
      linkText: "Search Reuters"
    });
    const utility = classifyDestinationProbeCandidate({
      parentUrl,
      sourceFamily: "portal",
      url: "https://www.thomsonreuters.com/en/privacy-statement.html",
      linkText: "Privacy"
    });
    const article = classifyDestinationProbeCandidate({
      parentUrl,
      sourceFamily: "portal",
      url: "https://www.reuters.com/world/us/ai-policy-lawmakers-debate-new-rules-2026-05-28/",
      linkText: "AI policy lawmakers debate new rules"
    });

    for (const result of [section, search, utility]) {
      expect(result).toMatchObject({
        promotable: false,
        warnings: expect.arrayContaining(["low_value_navigation_surface"])
      });
    }
    expect(article).toMatchObject({
      promotable: true,
      warnings: []
    });
  });

  it("classifies Yahoo Japan vertical search links as non-promotable probes", () => {
    const yahooJapanNewsVertical = classifyDestinationProbeCandidate({
      parentUrl: "https://search.yahoo.co.jp/search?p=tokyo+hotel",
      sourceFamily: "search",
      url: "https://news.yahoo.co.jp/search?p=tokyo+hotel",
      linkText: "ニュース"
    });
    const yahooJapanShoppingVertical = classifyDestinationProbeCandidate({
      parentUrl: "https://news.yahoo.co.jp/search?p=tokyo+hotel",
      sourceFamily: "search",
      url: "https://shopping.yahoo.co.jp/search?p=tokyo+hotel",
      linkText: "ショッピング"
    });
    const yahooJapanArticle = classifyDestinationProbeCandidate({
      parentUrl: "https://news.yahoo.co.jp/search?p=tokyo+hotel",
      sourceFamily: "search",
      url: "https://news.yahoo.co.jp/articles/1234567890abcdef",
      linkText: "Tokyo hotel publisher article"
    });
    const yahooJapanQuestion = classifyDestinationProbeCandidate({
      parentUrl: "https://chiebukuro.yahoo.co.jp/search?p=tokyo+hotel",
      sourceFamily: "search",
      url: "https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q123456789",
      linkText: "Tokyo hotel Q&A"
    });

    for (const result of [yahooJapanNewsVertical, yahooJapanShoppingVertical]) {
      expect(result).toMatchObject({
        promotable: false,
        warnings: expect.arrayContaining(["low_value_navigation_surface"])
      });
    }
    for (const result of [yahooJapanArticle, yahooJapanQuestion]) {
      expect(result).toMatchObject({
        promotable: true
      });
      expect(result.warnings).not.toContain("low_value_navigation_surface");
    }
  });

  it("extracts map search queries from known path-based map URLs", () => {
    const triage = buildDestinationTriage({
      parentUrl: "https://map.naver.com/p/search/%EC%84%B1%EC%88%98%20%EC%B9%B4%ED%8E%98",
      platform: "naver_map",
      sourceFamily: "map",
      requests: [],
      maxSelected: 1
    });

    expect(triage.query).toBe("성수 카페");
  });

  it("downgrades selected child destinations that lack query-relevant visible evidence", () => {
    const requests = [
      {
        actionKey: "first",
        url: "https://news.example.com/story",
        linkText: "Publisher ramen article"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://search.naver.com/search.naver?where=news&query=ramen",
      platform: "naver_search",
      sourceFamily: "search",
      requests,
      maxSelected: 1,
      childResults: [
        {
          actionKey: "first",
          url: "https://news.example.com/story",
          status: "ok",
          childEvidence: {
            artifactCount: 12,
            claimCount: 4,
            browserCaptureRecords: 6,
            obstructionCount: 0,
            pageTextLength: 120,
            queryOverlapTokenCount: 0,
            matchedQueryTokens: [],
            evidenceSignals: ["claim_gate_ok", "browser_capture", "visible_text", "claims_registered"],
            evidenceWarnings: ["no_query_overlap"],
            title: "unrelated fixture",
            textSnippet: "This destination talks about unrelated weather content."
          }
        }
      ]
    });

    expect(triage.selected[0]).toMatchObject({
      actionKey: "first",
      usefulness: "off_topic",
      reasonCodes: {
        negative: expect.arrayContaining(["off_topic"])
      },
      childResult: {
        childEvidence: expect.objectContaining({
          queryOverlapTokenCount: 0,
          evidenceWarnings: expect.arrayContaining(["no_query_overlap"])
        })
      }
    });
    expect(triage.summary).toMatchObject({
      status: "partial",
      usefulCount: 0,
      offTopicCount: 1
    });
    expect(triage.warnings).toContain("At least one selected child destination was downgraded after browser-visible child evidence review.");
  });

  it("preserves possible query script mismatch diagnostics on child evidence", () => {
    const requests = [
      {
        actionKey: "place",
        url: "https://place.example.com/seongsu-cafe",
        linkText: "Seongsu cafe place"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://map.example.com/search?q=seongsu+cafe",
      platform: "generic",
      sourceFamily: "map",
      requests,
      maxSelected: 1,
      childResults: [
        {
          actionKey: "place",
          url: "https://place.example.com/seongsu-cafe",
          status: "ok",
          childEvidence: {
            artifactCount: 12,
            claimCount: 4,
            browserCaptureRecords: 6,
            obstructionCount: 0,
            pageTextLength: 160,
            queryOverlapTokenCount: 0,
            matchedQueryTokens: [],
            queryScriptFamilies: ["latin"],
            evidenceScriptFamilies: ["hangul"],
            queryEvidenceScriptMismatch: true,
            deeperCandidateCount: 0,
            evidenceSignals: ["claim_gate_ok", "browser_capture", "visible_text", "claims_registered"],
            evidenceWarnings: ["no_query_overlap", "query_script_mismatch_possible"],
            title: "성수 카페 장소 정보",
            textSnippet: "성수 카페 영업시간 주소 리뷰 정보"
          }
        }
      ]
    });

    expect(triage.selected[0]).toMatchObject({
      actionKey: "place",
      usefulness: "off_topic",
      reasonCodes: {
        negative: expect.arrayContaining(["off_topic", "query_script_mismatch_possible"])
      },
      childResult: {
        childEvidence: expect.objectContaining({
          queryScriptFamilies: ["latin"],
          evidenceScriptFamilies: ["hangul"],
          queryEvidenceScriptMismatch: true,
          evidenceWarnings: expect.arrayContaining(["query_script_mismatch_possible"])
        })
      }
    });
    expect(triage.summary).toMatchObject({
      status: "partial",
      offTopicCount: 1,
      negativeReasonCounts: expect.arrayContaining([{ reasonCode: "query_script_mismatch_possible", count: 1 }])
    });
  });

  it("surfaces unattempted fallback candidates when the selected child evidence is downgraded", () => {
    const requests = [
      {
        actionKey: "official",
        url: "https://official.example.com/ramen-homepage",
        linkText: "Official ramen homepage"
      },
      {
        actionKey: "blog",
        url: "https://blog.example.com/ramen-review",
        linkText: "Ramen blog review"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=ramen",
      platform: "google_search",
      sourceFamily: "search",
      requests,
      maxSelected: 1,
      childResults: [
        {
          actionKey: "official",
          url: "https://official.example.com/ramen-homepage",
          status: "ok",
          childEvidence: {
            artifactCount: 4,
            claimCount: 0,
            browserCaptureRecords: 0,
            obstructionCount: 0,
            pageTextLength: 0,
            queryOverlapTokenCount: 0,
            matchedQueryTokens: [],
            deeperCandidateCount: 0,
            evidenceSignals: [],
            evidenceWarnings: ["empty_visible_text", "missing_browser_capture", "missing_claims"],
            title: "official ramen homepage"
          }
        }
      ]
    });

    expect(triage.selected[0]).toMatchObject({
      actionKey: "official",
      usefulness: "low_value",
      reasonCodes: {
        negative: expect.arrayContaining(["thin_content"])
      }
    });
    expect(triage.rejected[0]).toMatchObject({
      actionKey: "blog",
      usefulness: "budget_limited",
      reasonCodes: {
        negative: expect.arrayContaining(["top_k_budget"])
      }
    });
    expect(triage.summary).toMatchObject({
      status: "partial",
      usefulCount: 0,
      lowValueCount: 1,
      budgetLimitedCount: 1,
      unattemptedFallbackCount: 1,
      fallbackCandidates: [
        expect.objectContaining({
          candidateId: "destination-candidate-2",
          actionKey: "blog",
          url: "https://blog.example.com/ramen-review",
          candidateKind: "blog",
          budgetReason: "top_k_budget"
        })
      ],
      retryRecommended: true,
      retryAdvice: {
        recommendedMaxSelected: 2,
        recommendedMaxPerDomain: 1,
        cliFlags: ["--source-navigation-max-followups", "2", "--source-navigation-max-followups-per-domain", "1"],
        reasons: ["increase_max_followups"]
      }
    });
    expect(triage.warnings).toContain("Selected child evidence was downgraded while unattempted fallback candidates remain; rerun with a higher maxFollowUps value or narrower destination selectors to test additional sources.");
  });

  it("surfaces per-domain budget fallback candidates when selected same-domain child evidence is downgraded", () => {
    const requests = [
      {
        actionKey: "first",
        url: "https://same.example.com/official-noodle-homepage",
        linkText: "Official noodle homepage"
      },
      {
        actionKey: "second",
        url: "https://same.example.com/noodle-review",
        linkText: "Noodle review details"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=noodle",
      platform: "google_search",
      sourceFamily: "search",
      requests,
      maxSelected: 2,
      maxPerDomain: 1,
      childResults: [
        {
          actionKey: "first",
          url: "https://same.example.com/official-noodle-homepage",
          status: "ok",
          childEvidence: {
            artifactCount: 4,
            claimCount: 0,
            browserCaptureRecords: 0,
            obstructionCount: 0,
            pageTextLength: 0,
            queryOverlapTokenCount: 0,
            matchedQueryTokens: [],
            deeperCandidateCount: 0,
            evidenceSignals: [],
            evidenceWarnings: ["empty_visible_text", "missing_browser_capture", "missing_claims"],
            title: "official noodle homepage"
          }
        }
      ]
    });

    expect(triage.rejected[0]).toMatchObject({
      actionKey: "second",
      usefulness: "budget_limited",
      reasonCodes: {
        negative: expect.arrayContaining(["domain_budget"])
      }
    });
    expect(triage.summary).toMatchObject({
      retryRecommended: true,
      unattemptedFallbackCount: 1,
      fallbackCandidates: [
        expect.objectContaining({
          actionKey: "second",
          url: "https://same.example.com/noodle-review",
          budgetReason: "domain_budget"
        })
      ],
      retryAdvice: {
        recommendedMaxSelected: 2,
        recommendedMaxPerDomain: 2,
        cliFlags: ["--source-navigation-max-followups", "2", "--source-navigation-max-followups-per-domain", "2"],
        reasons: ["increase_max_followups_per_domain"]
      }
    });
  });

  it("keeps selected child destinations useful when browser-visible child evidence overlaps the query", () => {
    const requests = [
      {
        actionKey: "first",
        url: "https://blog.example.com/ramen",
        linkText: "Ramen blog review"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=ramen",
      platform: "google_search",
      sourceFamily: "search",
      requests,
      maxSelected: 1,
      childResults: [
        {
          actionKey: "first",
          url: "https://blog.example.com/ramen",
          status: "ok",
          childEvidence: {
            artifactCount: 14,
            claimCount: 4,
            browserCaptureRecords: 6,
            obstructionCount: 0,
            pageTextLength: 160,
            queryOverlapTokenCount: 1,
            matchedQueryTokens: ["ramen"],
            evidenceSignals: ["claim_gate_ok", "browser_capture", "visible_text", "claims_registered", "query_overlap", "ocr_evidence"],
            evidenceWarnings: [],
            title: "ramen review fixture",
            textSnippet: "Ramen review destination evidence."
          }
        }
      ]
    });

    expect(triage.selected[0]).toMatchObject({
      actionKey: "first",
      usefulness: "useful",
      reasonCodes: {
        positive: expect.arrayContaining(["query_overlap", "transcript_or_ocr_hit"])
      },
      childResult: {
        childEvidence: expect.objectContaining({
          matchedQueryTokens: ["ramen"],
          evidenceSignals: expect.arrayContaining(["query_overlap"])
        })
      }
    });
    expect(triage.summary).toMatchObject({
      status: "selected",
      usefulCount: 1,
      offTopicCount: 0
    });
  });

  it("downgrades entity/media children that only overlap a commerce hotel query by name", () => {
    const requests = [
      {
        actionKey: "wiki",
        url: "https://en.wikipedia.org/wiki/Tokio_Hotel",
        linkText: "Tokio Hotel"
      },
      {
        actionKey: "booking",
        url: "https://www.booking.com/city/jp/tokyo.html",
        linkText: "Tokyo hotels deals"
      },
      {
        actionKey: "video",
        url: "https://www.youtube.com/watch?v=Le_IyYLrUtQ",
        linkText: "Tokio Hotel - Monsoon"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=tokyo+hotel",
      platform: "google_search",
      sourceFamily: "search",
      requests,
      maxSelected: 3,
      childResults: [
        {
          actionKey: "wiki",
          url: "https://en.wikipedia.org/wiki/Tokio_Hotel",
          status: "ok",
          childEvidence: {
            artifactCount: 20,
            claimCount: 4,
            browserCaptureRecords: 8,
            obstructionCount: 0,
            pageTextLength: 1200,
            queryOverlapTokenCount: 2,
            matchedQueryTokens: ["tokyo", "hotel"],
            deeperCandidateCount: 0,
            evidenceSignals: ["claim_gate_ok", "browser_capture", "visible_text", "claims_registered", "query_overlap"],
            evidenceWarnings: [],
            title: "Tokio Hotel - Wikipedia",
            textSnippet: "Tokio Hotel is a German pop rock band with albums, tours, and songs."
          }
        },
        {
          actionKey: "booking",
          url: "https://www.booking.com/city/jp/tokyo.html",
          status: "ok",
          childEvidence: {
            artifactCount: 24,
            claimCount: 4,
            browserCaptureRecords: 8,
            obstructionCount: 0,
            pageTextLength: 1400,
            queryOverlapTokenCount: 2,
            matchedQueryTokens: ["tokyo", "hotel"],
            deeperCandidateCount: 0,
            evidenceSignals: ["claim_gate_ok", "browser_capture", "visible_text", "claims_registered", "query_overlap"],
            evidenceWarnings: [],
            title: "10 Best Tokyo Hotels",
            textSnippet: "Search hotels in Tokyo, compare room rates, availability, deals, and booking offers."
          }
        },
        {
          actionKey: "video",
          url: "https://www.youtube.com/watch?v=Le_IyYLrUtQ",
          status: "ok",
          childEvidence: {
            artifactCount: 30,
            claimCount: 4,
            browserCaptureRecords: 10,
            obstructionCount: 0,
            pageTextLength: 900,
            queryOverlapTokenCount: 1,
            matchedQueryTokens: ["hotel"],
            deeperCandidateCount: 0,
            evidenceSignals: ["claim_gate_ok", "browser_capture", "visible_text", "claims_registered", "query_overlap"],
            evidenceWarnings: [],
            title: "Tokio Hotel - Monsoon - YouTube",
            textSnippet: "Music video by Tokio Hotel performing Monsoon."
          }
        }
      ]
    });

    expect(triage.selected.find((candidate) => candidate.actionKey === "booking")).toMatchObject({
      candidateKind: "commerce",
      queryIntent: "commerce_offer",
      usefulness: "useful"
    });
    expect(triage.selected.find((candidate) => candidate.actionKey === "wiki")).toMatchObject({
      candidateKind: "generic",
      queryIntent: "commerce_offer",
      usefulness: "off_topic",
      reasonCodes: {
        negative: expect.arrayContaining(["off_topic"])
      }
    });
    expect(triage.selected.find((candidate) => candidate.actionKey === "video")).toMatchObject({
      candidateKind: "media",
      queryIntent: "commerce_offer",
      usefulness: "off_topic",
      reasonCodes: {
        negative: expect.arrayContaining(["off_topic"])
      }
    });
    expect(triage.summary).toMatchObject({
      usefulCount: 1,
      offTopicCount: 2,
      queryIntentCounts: [{ queryIntent: "commerce_offer", count: 3 }]
    });
  });

  it("prefers authoritative fresh destinations over higher-ranked generic results", () => {
    const currentYear = new Date().getUTCFullYear();
    const requests = [
      {
        actionKey: "first",
        url: "https://directory.example.com/seoul-hotel-2018",
        linkText: "Seoul hotel directory 2018"
      },
      {
        actionKey: "second",
        url: "https://official.example.com/seoul-hotel",
        linkText: `Official Seoul hotel homepage updated ${currentYear}`
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=seoul+hotel",
      platform: "google_search",
      sourceFamily: "search",
      requests,
      maxSelected: 1
    });

    expect(triage.selected[0]).toMatchObject({
      actionKey: "second",
      usefulness: "useful",
      signals: expect.arrayContaining(["official_authority_hint", "freshness_recent_hint", "publisher_authority_hint", "source_family_fit"]),
      visibleMetadata: expect.objectContaining({
        textSnippet: `Official Seoul hotel homepage updated ${currentYear}`,
        years: [currentYear],
        hasRecentYearHint: true,
        hasStaleYearHint: false,
        hasPublisherLikeText: true
      }),
      scoreBreakdown: expect.objectContaining({
        profile: "search_general",
        authority: expect.any(Number),
        freshness: expect.any(Number),
        sourceFamilyFit: 8
      })
    });
    expect(triage.selected[0]?.scoreBreakdown.authority).toBeGreaterThan(0);
    expect(triage.selected[0]?.scoreBreakdown.freshness).toBeGreaterThan(0);
    expect(triage.rejected[0]).toMatchObject({
      actionKey: "first",
      usefulness: "budget_limited",
      warnings: expect.arrayContaining(["stale_date_hint"]),
      visibleMetadata: expect.objectContaining({
        years: [2018],
        hasRecentYearHint: false,
        hasStaleYearHint: true
      })
    });
    expect(triage.summary.visibleMetadata).toMatchObject({
      candidateCount: 2,
      textSnippetCount: 2,
      recentYearHintCount: 1,
      staleYearHintCount: 1,
      priceLikeCount: 0,
      ratingLikeCount: 0,
      reviewLikeCount: 0,
      localPlaceLikeCount: 0,
      publisherLikeCount: 1
    });
    expect(triage.summary).toMatchObject({
      candidateKindCounts: [
        { candidateKind: "generic", count: 1 },
        { candidateKind: "official", count: 1 }
      ],
      selectedKindCounts: [{ candidateKind: "official", count: 1 }],
      usefulKindCounts: [{ candidateKind: "official", count: 1 }],
      rejectedKindCounts: [{ candidateKind: "generic", count: 1 }]
    });
  });

  it("uses source-family fit and freshness to avoid stale mismatched destinations", () => {
    const currentYear = new Date().getUTCFullYear();
    const requests = [
      {
        actionKey: "news",
        url: "https://news.example.com/tokyo-hotel-2018",
        linkText: "Tokyo hotel news 2018"
      },
      {
        actionKey: "offer",
        url: "https://booking.example.com/hotel-tokyo",
        linkText: `Tokyo hotel offer ${currentYear}`
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://www.booking.com/searchresults.html?ss=Tokyo+hotel",
      platform: "booking_com",
      sourceFamily: "travel_booking",
      requests,
      maxSelected: 1
    });

    expect(triage.selected[0]).toMatchObject({
      actionKey: "offer",
      signals: expect.arrayContaining(["source_family_fit", "freshness_recent_hint", "price_or_offer_hint"]),
      visibleMetadata: expect.objectContaining({
        years: [currentYear],
        hasPriceLikeText: true,
        hasRecentYearHint: true
      }),
      reasonCodes: {
        positive: expect.arrayContaining(["price_or_offer_visible", "source_family_fit"])
      }
    });
    expect(triage.rejected[0]).toMatchObject({
      actionKey: "news",
      warnings: expect.arrayContaining(["source_family_weak_fit", "stale_date_hint"]),
      scoreBreakdown: expect.objectContaining({
        profile: "travel_booking"
      })
    });
    expect(triage.selected[0]?.scoreBreakdown).toMatchObject({
      profile: "travel_booking",
      profileAdjustment: 8
    });
    expect(triage.rejected[0]?.scoreBreakdown.sourceFamilyFit).toBeLessThan(-12);
    expect(triage.rejected[0]?.scoreBreakdown.freshness).toBeLessThan(0);
  });

  it("uses the map/local scoring profile to prefer place evidence over a generic official page", () => {
    const requests = [
      {
        actionKey: "official",
        url: "https://official.example.com/seoul-cafe",
        linkText: "Official Seoul cafe homepage"
      },
      {
        actionKey: "place",
        url: "https://maps.example.com/place/seoul-cafe",
        linkText: "Seoul cafe map place reviews"
      }
    ];

    const triage = buildDestinationTriage({
      parentUrl: "https://map.naver.com/p/search/seoul+cafe",
      platform: "naver_map",
      sourceFamily: "map",
      requests,
      maxSelected: 1,
      query: "Seoul cafe"
    });

    expect(triage.selected[0]).toMatchObject({
      actionKey: "place",
      candidateKind: "map_place",
      reasonCodes: {
        positive: expect.arrayContaining(["local_place_match", "source_family_fit"])
      },
      scoreBreakdown: expect.objectContaining({
        profile: "map_local",
        profileAdjustment: 18
      })
    });
    expect(triage.rejected[0]).toMatchObject({
      actionKey: "official",
      usefulness: "budget_limited",
      scoreBreakdown: expect.objectContaining({
        profile: "map_local",
        profileAdjustment: 0
      })
    });
    expect(triage.selected[0]?.score).toBeGreaterThan(triage.rejected[0]?.score ?? 0);
  });

  it("uses query intent to change the preferred child source kind", () => {
    const newsRequests = [
      {
        actionKey: "official",
        url: "https://official.example.com/ramen-policy",
        linkText: "Official ramen policy"
      },
      {
        actionKey: "news",
        url: "https://news.example.com/latest-ramen-policy-2026",
        linkText: "Latest ramen policy news article 2026 publisher"
      },
      {
        actionKey: "blog",
        url: "https://blog.example.com/ramen-policy-experience",
        linkText: "Ramen policy experience blog"
      }
    ];
    const reviewRequests = [
      {
        actionKey: "official",
        url: "https://official.example.com/ramen-guide",
        linkText: "Official ramen guide"
      },
      {
        actionKey: "blog",
        url: "https://blog.example.com/best-ramen-review",
        linkText: "Best ramen review experience blog"
      },
      {
        actionKey: "news",
        url: "https://news.example.com/ramen-review-news",
        linkText: "Ramen review news article"
      }
    ];

    const newsTriage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=latest+ramen+policy+news",
      platform: "google_search",
      sourceFamily: "search",
      requests: newsRequests,
      maxSelected: 1
    });
    const reviewTriage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=best+ramen+review+experience",
      platform: "google_search",
      sourceFamily: "search",
      requests: reviewRequests,
      maxSelected: 1
    });

    expect(newsTriage.selected[0]).toMatchObject({
      actionKey: "news",
      candidateKind: "news",
      queryIntent: "fresh_news",
      signals: expect.arrayContaining(["query_intent_fresh_news", "query_intent_match"]),
      reasonCodes: {
        positive: expect.arrayContaining(["query_intent_match", "fresh_publisher_article"])
      },
      scoreBreakdown: expect.objectContaining({
        queryIntent: 22
      })
    });
    expect(newsTriage.summary.queryIntentCounts).toEqual([{ queryIntent: "fresh_news", count: 3 }]);
    expect(reviewTriage.selected[0]).toMatchObject({
      actionKey: "blog",
      candidateKind: "blog",
      queryIntent: "experience_review",
      signals: expect.arrayContaining(["query_intent_experience_review", "query_intent_match"]),
      reasonCodes: {
        positive: expect.arrayContaining(["query_intent_match"])
      },
      scoreBreakdown: expect.objectContaining({
        queryIntent: 22
      })
    });
    expect(reviewTriage.summary.queryIntentCounts).toEqual([{ queryIntent: "experience_review", count: 3 }]);
  });

  it("detects Korean and Japanese query intents before choosing child source kinds", () => {
    const koreanReviewTriage = buildDestinationTriage({
      parentUrl: "https://search.naver.com/search.naver?query=%EC%84%B1%EC%88%98+%EC%B9%B4%ED%8E%98+%ED%9B%84%EA%B8%B0",
      platform: "naver_search",
      sourceFamily: "search",
      query: "성수 카페 후기 추천",
      requests: [
        {
          actionKey: "place",
          url: "https://maps.example.com/place/seongsu-cafe",
          linkText: "성수 카페 장소 지도"
        },
        {
          actionKey: "blog",
          url: "https://blog.example.com/seongsu-cafe-review",
          linkText: "성수 카페 후기 블로그 추천"
        },
        {
          actionKey: "official",
          url: "https://official.example.com/seongsu-cafe",
          linkText: "성수 카페 공식 홈페이지"
        }
      ],
      maxSelected: 1
    });
    const japaneseCommerceTriage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=%E6%9D%B1%E4%BA%AC+%E3%83%9B%E3%83%86%E3%83%AB+%E4%BE%A1%E6%A0%BC",
      platform: "google_search",
      sourceFamily: "search",
      query: "東京 ホテル 価格 予約",
      requests: [
        {
          actionKey: "blog",
          url: "https://blog.example.com/tokyo-hotel-review",
          linkText: "東京ホテルレビュー"
        },
        {
          actionKey: "offer",
          url: "https://booking.example.com/tokyo-hotel",
          linkText: "東京 ホテル 価格 予約"
        }
      ],
      maxSelected: 1
    });

    expect(koreanReviewTriage.selected[0]).toMatchObject({
      actionKey: "blog",
      candidateKind: "blog",
      queryIntent: "experience_review",
      signals: expect.arrayContaining(["query_intent_experience_review", "query_intent_match"]),
      reasonCodes: {
        positive: expect.arrayContaining(["query_intent_match"])
      }
    });
    expect(koreanReviewTriage.summary.queryIntentCounts).toEqual([{ queryIntent: "experience_review", count: 3 }]);
    expect(japaneseCommerceTriage.selected[0]).toMatchObject({
      actionKey: "offer",
      candidateKind: "commerce",
      queryIntent: "commerce_offer",
      signals: expect.arrayContaining(["query_intent_commerce_offer", "query_intent_match"]),
      reasonCodes: {
        positive: expect.arrayContaining(["query_intent_match", "price_or_offer_visible"])
      }
    });
    expect(japaneseCommerceTriage.summary.queryIntentCounts).toEqual([{ queryIntent: "commerce_offer", count: 2 }]);
  });

  it("classifies Korean and Japanese visible destination text without provider URL hints", () => {
    const currentYear = new Date().getUTCFullYear();
    const koreanReviewTriage = buildDestinationTriage({
      parentUrl: "https://search.naver.com/search.naver?query=%EC%84%B1%EC%88%98+%EC%B9%B4%ED%8E%98+%ED%9B%84%EA%B8%B0",
      platform: "naver_search",
      sourceFamily: "search",
      query: "성수 카페 후기 추천",
      requests: [
        {
          actionKey: "official",
          url: "https://example.kr/a",
          linkText: "성수 카페 공식 홈페이지"
        },
        {
          actionKey: "blog",
          url: "https://example.kr/b",
          linkText: "성수 카페 후기 블로그 추천"
        },
        {
          actionKey: "place",
          url: "https://example.kr/c",
          linkText: "성수 카페 주소 영업시간 메뉴"
        }
      ],
      maxSelected: 1
    });
    const koreanNewsTriage = buildDestinationTriage({
      parentUrl: "https://search.naver.com/search.naver?where=news&query=%EC%A0%95%EC%B1%85+%EB%89%B4%EC%8A%A4",
      platform: "naver_search",
      sourceFamily: "search",
      query: "최신 정책 뉴스",
      requests: [
        {
          actionKey: "official",
          url: "https://example.kr/policy",
          linkText: "정책 공식 문서"
        },
        {
          actionKey: "news",
          url: "https://example.kr/story",
          linkText: `최신 정책 뉴스 기사 보도 ${currentYear}`
        }
      ],
      maxSelected: 1
    });
    const japaneseCommerceTriage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=%E6%9D%B1%E4%BA%AC+%E3%83%9B%E3%83%86%E3%83%AB+%E4%BE%A1%E6%A0%BC",
      platform: "google_search",
      sourceFamily: "search",
      query: "東京 ホテル 価格 予約",
      requests: [
        {
          actionKey: "review",
          url: "https://example.jp/review",
          linkText: "東京駅 口コミ 評価"
        },
        {
          actionKey: "offer",
          url: "https://example.jp/offer",
          linkText: "東京 ホテル 価格 予約 割引"
        }
      ],
      maxSelected: 1
    });

    expect(koreanReviewTriage.selected[0]).toMatchObject({
      actionKey: "blog",
      candidateKind: "blog",
      queryIntent: "experience_review",
      visibleMetadata: expect.objectContaining({
        hasReviewLikeText: true,
        hasLocalPlaceLikeText: true
      }),
      signals: expect.arrayContaining(["query_intent_match", "review_or_rating_hint"])
    });
    expect(koreanNewsTriage.selected[0]).toMatchObject({
      actionKey: "news",
      candidateKind: "news",
      queryIntent: "fresh_news",
      visibleMetadata: expect.objectContaining({
        hasPublisherLikeText: true,
        hasRecentYearHint: true
      }),
      reasonCodes: {
        positive: expect.arrayContaining(["fresh_publisher_article", "query_intent_match"])
      }
    });
    expect(japaneseCommerceTriage.selected[0]).toMatchObject({
      actionKey: "offer",
      candidateKind: "commerce",
      queryIntent: "commerce_offer",
      visibleMetadata: expect.objectContaining({
        hasPriceLikeText: true
      }),
      reasonCodes: {
        positive: expect.arrayContaining(["price_or_offer_visible", "query_intent_match"])
      }
    });
  });

  it("matches common English transliteration queries against Korean and Japanese visible text", () => {
    const koreanTriage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=seongsu+cafe",
      platform: "google_search",
      sourceFamily: "search",
      query: "seongsu cafe",
      requests: [
        {
          actionKey: "place",
          url: "https://example.kr/place",
          linkText: "성수 카페 주소 영업시간"
        },
        {
          actionKey: "generic",
          url: "https://example.kr/other",
          linkText: "서울 여행 일반 정보"
        }
      ],
      maxSelected: 1
    });
    const japaneseTriage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=tokyo+hotel+price",
      platform: "google_search",
      sourceFamily: "search",
      query: "tokyo hotel price",
      requests: [
        {
          actionKey: "offer",
          url: "https://example.jp/offer",
          linkText: "東京 ホテル 価格 予約"
        }
      ],
      maxSelected: 1
    });

    expect(koreanTriage.selected[0]).toMatchObject({
      actionKey: "place",
      signals: expect.arrayContaining(["query_overlap"]),
      reasonCodes: {
        positive: expect.arrayContaining(["query_overlap"])
      }
    });
    expect(japaneseTriage.selected[0]).toMatchObject({
      actionKey: "offer",
      signals: expect.arrayContaining(["query_overlap", "price_or_offer_hint"]),
      reasonCodes: {
        positive: expect.arrayContaining(["query_overlap", "price_or_offer_visible"])
      }
    });
  });

  it("builds proposal-only deeper-hop candidates for useful child evidence", () => {
    const deeperCandidates = buildDestinationDeepeningCandidates({
      childUrl: "https://official.example.com/ramen",
      query: "ramen",
      links: [
        { index: 0, url: "https://official.example.com/source-document", text: "Official ramen source document" },
        { index: 1, url: "https://official.example.com/privacy", text: "Privacy policy" }
      ]
    });

    const triage = buildDestinationTriage({
      parentUrl: "https://www.google.com/search?q=ramen",
      platform: "google_search",
      sourceFamily: "search",
      requests: [
        {
          actionKey: "destination-followup",
          url: "https://official.example.com/ramen",
          linkText: "Official ramen guide"
        }
      ],
      maxSelected: 1,
      childResults: [
        {
          actionKey: "destination-followup",
          url: "https://official.example.com/ramen",
          status: "ok",
          childEvidence: {
            artifactCount: 14,
            claimCount: 4,
            browserCaptureRecords: 6,
            obstructionCount: 0,
            pageTextLength: 160,
            queryOverlapTokenCount: 1,
            matchedQueryTokens: ["ramen"],
            deeperCandidateCount: deeperCandidates.length,
            deeperCandidates,
            evidenceSignals: ["claim_gate_ok", "browser_capture", "visible_text", "claims_registered", "query_overlap", "deeper_candidates_visible"],
            evidenceWarnings: [],
            title: "official ramen guide"
          }
        }
      ]
    });

    const proposals = buildDestinationDeepeningProposals({ triage });
    const optInProposals = buildDestinationDeepeningProposals({ triage, maxDepth: 2 });

    expect(deeperCandidates).toHaveLength(1);
    expect(proposals).toEqual([
      expect.objectContaining({
        executionPolicy: "proposal_only",
        sourceCandidateId: "destination-candidate-1",
        currentDepth: 1,
        proposedDepth: 2,
        maxDepth: 1,
        proposedCount: 1,
        reason: "child_page_has_source_document",
        candidates: [
          expect.objectContaining({
            url: "https://official.example.com/source-document",
            signals: expect.arrayContaining(["depth_2_proposal", "query_overlap", "source_document_hint"]),
            warnings: expect.arrayContaining(["proposal_only_not_executed"])
          })
        ]
      })
    ]);
    expect(optInProposals[0]).toMatchObject({
      executionPolicy: "explicit_opt_in_requested",
      maxDepth: 2
    });
  });

  it("omits map provider boilerplate from deeper-hop proposals", () => {
    const deeperCandidates = buildDestinationDeepeningCandidates({
      childUrl: "https://place.map.kakao.com/105541267#review",
      query: "seongsu cafe",
      links: [
        { index: 0, url: "https://www.kakaocorp.com/page/service/service/KakaoMap", text: "KakaoMap service" },
        { index: 1, url: "https://cs.kakao.com/helps?service=101", text: "Customer support" },
        { index: 2, url: "https://www.instagram.com/highline_seongsu", text: "Highline Seongsu Instagram" }
      ]
    });

    expect(deeperCandidates).toEqual([
      expect.objectContaining({
        url: "https://www.instagram.com/highline_seongsu",
        candidateKind: "media",
        signals: expect.arrayContaining(["depth_2_proposal", "query_overlap"])
      })
    ]);
  });

  it("preserves blocked child recovery candidates without promoting deepening proposals", () => {
    const recoveryCandidate = {
      url: "https://pcmap.place.naver.com/restaurant/1790076538/home?from=map",
      normalizedUrl: "https://pcmap.place.naver.com/restaurant/1790076538/home?from=map",
      domain: "pcmap.place.naver.com",
      visibleText: "젠젠 성수점 네이버 플레이스 홈",
      rank: 1,
      candidateKind: "map_place" as const,
      signals: ["map_place", "depth_2_proposal", "external_destination"],
      warnings: ["proposal_only_not_executed", "external_depth_2_destination"]
    };
    const triage = buildDestinationTriage({
      parentUrl: "https://map.naver.com/p/search/seongsu%20cafe",
      platform: "naver_map",
      sourceFamily: "map",
      query: "seongsu cafe",
      requests: [
        {
          actionKey: "destination-followup",
          url: "https://map.naver.com/p/entry/place/1790076538",
          linkText: "젠젠 성수점"
        }
      ],
      maxSelected: 1,
      childResults: [
        {
          actionKey: "destination-followup",
          url: "https://map.naver.com/p/entry/place/1790076538",
          status: "ok",
          childEvidence: {
            artifactCount: 12,
            claimCount: 2,
            browserCaptureRecords: 6,
            obstructionCount: 1,
            pageTextLength: 120,
            queryOverlapTokenCount: 0,
            matchedQueryTokens: [],
            deeperCandidateCount: 1,
            deeperCandidates: [recoveryCandidate],
            evidenceSignals: ["browser_capture", "visible_text", "browser_obstruction", "deeper_candidates_visible"],
            evidenceWarnings: ["browser_obstruction_detected", "no_query_overlap"],
            title: "젠젠 성수점 - 네이버지도"
          }
        }
      ]
    });

    expect(triage.selected[0]?.usefulness).toBe("blocked");
    expect(triage.summary).toMatchObject({
      status: "partial",
      blockedCount: 1,
      blockedChildRecoveryCandidateCount: 1,
      blockedChildRecoveryCandidates: [
        {
          sourceCandidateId: "destination-candidate-1",
          actionKey: "destination-followup",
          childUrl: "https://map.naver.com/p/entry/place/1790076538",
          childUsefulness: "blocked",
          url: "https://pcmap.place.naver.com/restaurant/1790076538/home?from=map",
          domain: "pcmap.place.naver.com",
          candidateKind: "map_place",
          visibleText: "젠젠 성수점 네이버 플레이스 홈"
        }
      ],
      blockedChildRecoveryAdvice: {
        recommendedAction: "profile_headed_retry",
        profileName: "pcmap.place.naver.com-recovery-profile",
        storagePolicy: "persistent-profile",
        browserChannel: "chrome",
        candidateCount: 1,
        sampleUrls: ["https://pcmap.place.naver.com/restaurant/1790076538/home?from=map"],
        profileSetupUrl: "https://map.naver.com/p/entry/place/1790076538",
        recoveryUrl: "https://pcmap.place.naver.com/restaurant/1790076538/home?from=map",
        profileSetupArgv: ["node", ".\\dist\\cli.js", "auth-login", "--profile", "pcmap.place.naver.com-recovery-profile", "--url", "https://map.naver.com/p/entry/place/1790076538", "--wait-ms", "120000", "--browser-channel", "chrome", "--persistent-profile"],
        evidenceRunArgv: [
          "node",
          ".\\dist\\cli.js",
          "evidence-run",
          "--url",
          "https://pcmap.place.naver.com/restaurant/1790076538/home?from=map",
          "--wait-ms",
          "3000",
          "--timeout-ms",
          "30000",
          "--headed",
          "--browser-channel",
          "chrome",
          "--profile",
          "pcmap.place.naver.com-recovery-profile",
          "--persistent-profile",
          "--no-frames"
        ],
        steps: [
          expect.objectContaining({
            step: "profile_setup",
            purpose: expect.stringContaining("user-controlled Chrome persistent profile"),
            argv: expect.arrayContaining(["auth-login", "--browser-channel", "chrome"])
          }),
          expect.objectContaining({
            step: "recovery_evidence_run",
            purpose: expect.stringContaining("same Chrome persistent profile"),
            argv: expect.arrayContaining(["evidence-run", "--headed", "--browser-channel", "chrome"])
          })
        ],
        reasons: ["blocked_child_exposes_deeper_candidates", "profile_headed_review_required", "default_depth_2_execution_disabled"]
      },
      retryRecommended: true
    });
    expect(triage.summary.blockedChildRecoveryAdvice?.profileSetupPowerShellCommand).toContain("'auth-login' '--profile' 'pcmap.place.naver.com-recovery-profile'");
    expect(triage.summary.blockedChildRecoveryAdvice?.profileSetupPowerShellCommand).toContain("'--browser-channel' 'chrome'");
    expect(triage.summary.blockedChildRecoveryAdvice?.evidenceRunPowerShellCommand).toContain("'evidence-run' '--url' 'https://pcmap.place.naver.com/restaurant/1790076538/home?from=map'");
    expect(triage.summary.blockedChildRecoveryAdvice?.evidenceRunPowerShellCommand).toContain("'--headed' '--browser-channel' 'chrome' '--profile' 'pcmap.place.naver.com-recovery-profile'");
    expect(triage.summary.blockedChildRecoveryAdvice?.commandHints).toEqual([triage.summary.blockedChildRecoveryAdvice?.profileSetupPowerShellCommand, triage.summary.blockedChildRecoveryAdvice?.evidenceRunPowerShellCommand]);
    expect(buildDestinationDeepeningProposals({ triage })).toEqual([]);
  });
});

function bingRedirectUrl(destinationUrl: string): string {
  const encoded = Buffer.from(destinationUrl, "utf8").toString("base64url");
  return `https://www.bing.com/ck/a?u=a1${encoded}&ntb=1`;
}
