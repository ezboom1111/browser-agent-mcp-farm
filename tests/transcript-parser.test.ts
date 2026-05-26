import { describe, expect, it } from "vitest";
import { parseWebVtt } from "../src/transcript-parser.js";

describe("parseWebVtt", () => {
  it("parses cues, timestamps, settings, and cue identifiers", () => {
    const parsed = parseWebVtt(`WEBVTT

intro
00:00:00.000 --> 00:00:02.500 align:start
hello

00:01:03.250 --> 00:01:04.000
world
`);

    expect(parsed.cueCount).toBe(2);
    expect(parsed.text).toBe("hello\nworld");
    expect(parsed.cues[0]).toEqual({ startSec: 0, endSec: 2.5, text: "hello" });
    expect(parsed.cues[1]).toEqual({ startSec: 63.25, endSec: 64, text: "world" });
  });
});
