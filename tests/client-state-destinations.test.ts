import { describe, expect, it, vi } from "vitest";
import type { BrowserClientStateFrame, BrowserClientStateResult } from "../src/browser-pool.js";
import { extractClientStateDestinationCandidates, maybeExtractNaverPlaceApolloDestinations } from "../src/client-state-destinations.js";

function frame(json: unknown, overrides: Partial<BrowserClientStateFrame> = {}): BrowserClientStateFrame {
  return {
    frameIndex: 0,
    frameUrl: "https://m.place.naver.com/restaurant/list",
    found: true,
    truncated: false,
    json: json === undefined ? undefined : JSON.stringify(json),
    ...overrides
  };
}

function stateOf(frames: BrowserClientStateFrame[]): BrowserClientStateResult {
  return {
    ok: true,
    url: frames[0]?.frameUrl ?? "https://m.place.naver.com/restaurant/list",
    propertyName: "__APOLLO_STATE__",
    frameCount: frames.length,
    matchedFrameCount: frames.length,
    frames
  } as unknown as BrowserClientStateResult;
}

const opts = { extractor: "naver_place_apollo" as const, maxLinks: 10 };

function placeApollo(id: string, name: string, extra: Record<string, unknown> = { category: "한식" }): unknown {
  return { ROOT_QUERY: { [`PlaceBase:${id}`]: { __typename: "PlaceBase", id, name, ...extra } } };
}

describe("extractClientStateDestinationCandidates", () => {
  it("extracts a naver place candidate with resolved urls and joined text", () => {
    const result = extractClientStateDestinationCandidates(stateOf([frame(placeApollo("1234567", "호텔 아주레", { category: "호텔", roadAddress: "해변로 12" }))]), opts);
    expect(result.parsedFrameCount).toBe(1);
    expect(result.candidates).toHaveLength(1);
    const c = result.candidates[0];
    expect(c.url).toBe("https://map.naver.com/p/entry/place/1234567");
    expect(c.originalUrl).toBe("https://place.naver.com/restaurant/1234567");
    expect(c.urlResolutionMethod).toBe("naver_place_entry_fallback");
    expect(c.text).toBe("호텔 아주레 | 호텔 | 해변로 12");
    expect(c.sourceId).toBe("1234567");
  });

  it("requires a place signal beyond id+name", () => {
    const noSignal = extractClientStateDestinationCandidates(stateOf([frame({ ROOT: { id: "7654321", name: "Just A Name" } })]), opts);
    expect(noSignal.candidates).toHaveLength(0);
    const withSignal = extractClientStateDestinationCandidates(stateOf([frame({ ROOT: { id: "7654321", name: "Has Coords", x: "127.0", y: "37.5" } })]), opts);
    expect(withSignal.candidates).toHaveLength(1);
  });

  it("rejects ids that are not 5-20 digits", () => {
    const result = extractClientStateDestinationCandidates(stateOf([frame({ ROOT: { id: "123", name: "Too Short", category: "x" } }), frame({ ROOT: { id: "abc12345", name: "Not Digits", category: "x" } })]), opts);
    expect(result.candidates).toHaveLength(0);
  });

  it("resolves the place path from option, frame url, then default", () => {
    const byOption = extractClientStateDestinationCandidates(stateOf([frame(placeApollo("1111111", "A"))]), { ...opts, destinationPath: "hospital" });
    expect(byOption.candidates[0].originalUrl).toBe("https://place.naver.com/hospital/1111111");

    const byFrameUrl = extractClientStateDestinationCandidates(stateOf([frame(placeApollo("2222222", "B"), { frameUrl: "https://m.place.naver.com/accommodation/list?x=1" })]), opts);
    expect(byFrameUrl.candidates[0].originalUrl).toBe("https://place.naver.com/accommodation/2222222");

    const byDefault = extractClientStateDestinationCandidates(stateOf([frame(placeApollo("3333333", "C"), { frameUrl: "https://m.place.naver.com/unknownpath" })]), { ...opts, destinationPath: "not-a-known-path" });
    expect(byDefault.candidates[0].originalUrl).toBe("https://place.naver.com/restaurant/3333333");
  });

  it("counts truncated frames and skips invalid/empty json", () => {
    const result = extractClientStateDestinationCandidates(stateOf([frame(placeApollo("4444444", "Valid")), frame(undefined, { truncated: true, json: "{}" }), { frameIndex: 2, frameUrl: "x", found: true, truncated: false, json: "{not json" }, { frameIndex: 3, frameUrl: "x", found: false, truncated: false }]), opts);
    expect(result.parsedFrameCount).toBe(1);
    expect(result.truncatedFrameCount).toBe(1);
    expect(result.candidates).toHaveLength(1);
  });

  it("dedupes the same place across frames and honors maxLinks", () => {
    const deduped = extractClientStateDestinationCandidates(stateOf([frame(placeApollo("5555555", "Dup")), frame(placeApollo("5555555", "Dup"))]), opts);
    expect(deduped.rawCandidateCount).toBe(2);
    expect(deduped.uniqueCandidateCount).toBe(1);
    expect(deduped.candidates).toHaveLength(1);

    const capped = extractClientStateDestinationCandidates(stateOf([frame(placeApollo("6000001", "P1")), frame(placeApollo("6000002", "P2")), frame(placeApollo("6000003", "P3"))]), { ...opts, maxLinks: 2 });
    expect(capped.uniqueCandidateCount).toBe(3);
    expect(capped.candidates).toHaveLength(2);
  });
});

// The runtime capture pipeline (evidence-runner.ts) wiring: a gate that only re-queries the live
// page (readClientState, injected here so this is testable without a browser) when the ALREADY
// CAPTURED page_html shows an __APOLLO_STATE__ hint and the requested host is a known Naver
// map/place surface.
describe("maybeExtractNaverPlaceApolloDestinations (runtime pipeline gate)", () => {
  const htmlWithApollo = '<html><script>window.__APOLLO_STATE__ = {"ROOT_QUERY": {}}</script></html>';
  const htmlWithoutApollo = "<html><body>no hydration here</body></html>";

  it("does not re-query the live page for a non-Naver host, even with the hydration hint present", async () => {
    const readClientState = vi.fn(async (): Promise<BrowserClientStateResult> => stateOf([frame(placeApollo("1234567", "Should Not Run"))]));
    const result = await maybeExtractNaverPlaceApolloDestinations({ html: htmlWithApollo, hostname: "example.com", readClientState });
    expect(result).toBeUndefined();
    expect(readClientState).not.toHaveBeenCalled();
  });

  it("does not re-query the live page on a Naver host when the captured HTML has no __APOLLO_STATE__ hint", async () => {
    const readClientState = vi.fn(async (): Promise<BrowserClientStateResult> => stateOf([frame(placeApollo("1234567", "Should Not Run"))]));
    const result = await maybeExtractNaverPlaceApolloDestinations({ html: htmlWithoutApollo, hostname: "m.place.naver.com", readClientState });
    expect(result).toBeUndefined();
    expect(readClientState).not.toHaveBeenCalled();
  });

  it("re-queries the live page and returns candidates when both the hint and the host match", async () => {
    const readClientState = vi.fn(async (): Promise<BrowserClientStateResult> => stateOf([frame(placeApollo("1234567", "호텔 아주레", { category: "호텔", roadAddress: "해변로 12" }))]));
    const result = await maybeExtractNaverPlaceApolloDestinations({ html: htmlWithApollo, hostname: "map.naver.com", readClientState });
    expect(readClientState).toHaveBeenCalledTimes(1);
    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0]?.sourceId).toBe("1234567");
  });

  it("returns undefined when the gate opens but no candidates are found (no artifact should be registered)", async () => {
    const readClientState = vi.fn(async (): Promise<BrowserClientStateResult> => stateOf([frame({ ROOT: { id: "7654321", name: "No Place Signal" } })]));
    const result = await maybeExtractNaverPlaceApolloDestinations({ html: htmlWithApollo, hostname: "pcmap.place.naver.com", readClientState });
    expect(readClientState).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });
});
