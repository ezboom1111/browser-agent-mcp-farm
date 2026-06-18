import { describe, expect, it } from "vitest";
import { buildCaptureTranscript, CAPTURE_TRANSCRIPT_SCHEMA, captureTranscriptEnabled, sha256Hex } from "../src/capture-transcript.js";

describe("captureTranscriptEnabled", () => {
  it("is opt-in via FARM_CAPTURE_TRANSCRIPT=1 only", () => {
    expect(captureTranscriptEnabled({ FARM_CAPTURE_TRANSCRIPT: "1" })).toBe(true);
    expect(captureTranscriptEnabled({ FARM_CAPTURE_TRANSCRIPT: "0" })).toBe(false);
    expect(captureTranscriptEnabled({})).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("computes a deterministic 64-hex digest", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toHaveLength(64);
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});

describe("buildCaptureTranscript", () => {
  it("binds the page-body digest and includes the schema + honesty note", () => {
    const t = buildCaptureTranscript({
      finalUrl: "https://example.com/",
      pageBody: "abc",
      responses: [{ url: "https://example.com/", status: 200, contentType: "text/html" }],
      binds: { path: "raw/page.html", sha256: "deadbeef" }
    });
    expect(t.schema).toBe(CAPTURE_TRANSCRIPT_SCHEMA);
    expect(t.finalUrl).toBe("https://example.com/");
    expect(t.pageBodySha256).toBe(sha256Hex("abc"));
    expect(t.binds.sha256).toBe("deadbeef");
    expect(t.certIdentity).toBeUndefined();
    expect(t.note).toContain("Capturer-attested");
  });
  it("carries optional cert identity when provided", () => {
    const t = buildCaptureTranscript({
      finalUrl: "https://x/",
      pageBody: "y",
      responses: [],
      binds: { path: "p", sha256: "s" },
      certIdentity: { tlsVersion: "1.3" }
    });
    expect(t.certIdentity).toEqual({ tlsVersion: "1.3" });
  });
});
