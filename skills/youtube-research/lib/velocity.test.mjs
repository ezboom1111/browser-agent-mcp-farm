// Unit tests for the youtube-research velocity helper. Pure: fake fetch only, NO live key,
// NO network. Auto-discovered by the default vitest glob, so it runs inside `npm run test:ci`
// (the verify gate). The subject (.mjs under skills/) is outside coverage include (src/**/*.ts),
// so these tests exercise the security-critical logic without moving the coverage ratchet.
import { describe, expect, it } from "vitest";
import { buildStatsRequest, fetchSnapshots, parseStatsResponse, redactKey, validateVideoIds, viewVelocityPerHour } from "./velocity.mjs";

// Synthetic key: matches the AIza... shape at RUNTIME (so the redactor's regex fires) but is
// assembled by concatenation so the SOURCE carries no AIza-shaped token (keeps scan-secrets clean).
const FAKE_KEY = ["AIza", "SyDUMMY0123456789ABCDEFGHIJKLMNOPQRSTUV"].join("");
const VALID_ID = "dQw4w9WgXcQ";

describe("velocity: viewVelocityPerHour", () => {
  it("computes delta-views per hour on the happy path", () => {
    const prev = { viewCount: 1000, at: "2026-01-01T00:00:00.000Z" };
    const next = { viewCount: 4000, at: "2026-01-01T02:00:00.000Z" };
    expect(viewVelocityPerHour(prev, next)).toBe(1500);
  });

  it("guards a zero or non-increasing time gap (no divide-by-zero)", () => {
    const a = { viewCount: 1000, at: "2026-01-01T00:00:00.000Z" };
    const same = { viewCount: 4000, at: "2026-01-01T00:00:00.000Z" };
    const earlier = { viewCount: 4000, at: "2025-12-31T23:00:00.000Z" };
    expect(viewVelocityPerHour(a, same)).toBe(0);
    expect(viewVelocityPerHour(a, earlier)).toBe(0);
  });

  it("clamps a decreasing view count to 0 (API recount), never negative or NaN", () => {
    const prev = { viewCount: 5000, at: "2026-01-01T00:00:00.000Z" };
    const next = { viewCount: 4000, at: "2026-01-01T02:00:00.000Z" };
    const v = viewVelocityPerHour(prev, next);
    expect(v).toBe(0);
    expect(Number.isNaN(v)).toBe(false);
  });

  it("returns 0 on unparseable timestamps", () => {
    expect(viewVelocityPerHour({ viewCount: 1, at: "nope" }, { viewCount: 9, at: "also-nope" })).toBe(0);
  });
});

describe("velocity: parseStatsResponse", () => {
  it("returns [] on malformed or unexpected shapes (never crashes)", () => {
    expect(parseStatsResponse(null)).toEqual([]);
    expect(parseStatsResponse({})).toEqual([]);
    expect(parseStatsResponse({ items: null })).toEqual([]);
    expect(parseStatsResponse({ items: [{ id: VALID_ID }] })).toEqual([]);
    expect(parseStatsResponse("oops")).toEqual([]);
  });

  it("maps valid items and coerces a string viewCount", () => {
    const out = parseStatsResponse({ items: [{ id: VALID_ID, statistics: { viewCount: "1700000000" } }] }, "2026-01-01T00:00:00.000Z");
    expect(out).toEqual([{ videoId: VALID_ID, viewCount: 1_700_000_000, at: "2026-01-01T00:00:00.000Z" }]);
  });
});

describe("velocity: validateVideoIds", () => {
  it("rejects injection / malformed ids and an empty list", () => {
    expect(() => validateVideoIds(["a,b"])).toThrow();
    expect(() => validateVideoIds(["../x"])).toThrow();
    expect(() => validateVideoIds([""])).toThrow();
    expect(() => validateVideoIds(["x".repeat(33)])).toThrow();
    expect(() => validateVideoIds([])).toThrow();
  });

  it("keeps valid ids and caps the list at 50", () => {
    expect(validateVideoIds([VALID_ID, "abc123def45"])).toEqual([VALID_ID, "abc123def45"]);
    const many = Array.from({ length: 60 }, (_, i) => `vid${String(i).padStart(8, "0")}`);
    expect(validateVideoIds(many)).toHaveLength(50);
  });
});

describe("velocity: buildStatsRequest + redactKey", () => {
  it("pins the public part allowlist and comma-joins validated ids", () => {
    const { url } = buildStatsRequest([VALID_ID, "abc123def45"], FAKE_KEY);
    expect(url).toContain("part=snippet,statistics,contentDetails,status");
    expect(url).toContain(`id=${VALID_ID},abc123def45`);
    expect(url.startsWith("https://www.googleapis.com/youtube/v3/videos?")).toBe(true);
  });

  it("redacts the key from the displayed URL, error bodies, and JSON snapshots", () => {
    const { url, redactedUrl } = buildStatsRequest([VALID_ID], FAKE_KEY);
    expect(url).toContain(FAKE_KEY);
    expect(redactedUrl).not.toContain(FAKE_KEY);
    expect(redactedUrl).toContain("AIza");
    const errorBody = `400: keyInvalid for request ?key=${FAKE_KEY}`;
    expect(redactKey(errorBody, FAKE_KEY)).not.toContain(FAKE_KEY);
    expect(redactKey(JSON.stringify({ leaked: FAKE_KEY }), FAKE_KEY)).not.toContain(FAKE_KEY);
  });

  it("requires the key from the caller (the module reads no env)", () => {
    expect(() => buildStatsRequest([VALID_ID], "")).toThrow();
  });
});

describe("velocity: fetchSnapshots (injected fetch, no global)", () => {
  it("uses the injected fetch and maps both videos", async () => {
    const payload = JSON.stringify({
      items: [
        { id: VALID_ID, statistics: { viewCount: "100" } },
        { id: "abc123def45", statistics: { viewCount: "200" } }
      ]
    });
    const fakeFetch = async () => ({ ok: true, status: 200, text: async () => payload });
    const out = await fetchSnapshots([VALID_ID, "abc123def45"], FAKE_KEY, fakeFetch, "2026-01-01T00:00:00.000Z");
    expect(out).toHaveLength(2);
    expect(out[0]?.videoId).toBe(VALID_ID);
  });

  it("throws (never falls back to a global fetch) when no fetch is injected", async () => {
    await expect(fetchSnapshots([VALID_ID], FAKE_KEY, /** @type {never} */ (undefined))).rejects.toThrow();
  });

  it("redacts the key from a failed-request error", async () => {
    const fakeFetch = async () => ({ ok: false, status: 403, text: async () => `forbidden for key=${FAKE_KEY}` });
    let caught;
    try {
      await fetchSnapshots([VALID_ID], FAKE_KEY, fakeFetch);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain(FAKE_KEY);
    expect(String(caught)).toContain("AIza");
  });
});
