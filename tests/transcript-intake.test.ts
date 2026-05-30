import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FarmService } from "../src/farm-service.js";

// Transcript intake (v0.4.x): ingest a video's spoken/caption track from ANY lawful source
// (YouTube auto-captions, yt-dlp, a transcript service, a human paste), register it as a
// transcript_cue artifact (WebVTT parsed into cues), then ground a spoken-content claim on the
// quoted phrase — so "what was said" becomes cite-or-fail, with no farm-side speech-to-text.

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
  roots = [];
});

async function newRun(): Promise<{ service: FarmService; runDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "farm-transcript-"));
  roots.push(root);
  const runDir = join(root, "run-1");
  await mkdir(runDir, { recursive: true });
  return { service: new FarmService(), runDir };
}

const SAMPLE_VTT = `WEBVTT

00:00:00.000 --> 00:00:03.000
Welcome to my Japan travel vlog

00:00:03.000 --> 00:00:06.500
We just arrived at the airport in Tokyo

00:00:06.500 --> 00:00:10.000
First stop is a ramen shop in Shinjuku
`;

describe("FarmService.registerTranscript + grounded spoken claims", () => {
  it("parses WebVTT into cues and registers a transcript_cue artifact", async () => {
    const { service, runDir } = await newRun();
    const result = await service.registerTranscript({
      runDir,
      sourceUrl: "https://www.youtube.com/watch?v=demo",
      vtt: SAMPLE_VTT,
      captureMethod: "byo-youtube-auto-caption",
      capturedBy: "yt-caption-fetch"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cueCount).toBe(3);
    expect(result.evidenceKind).toBe("transcript_cue");
    expect(result.artifactId).toBeTruthy();
  });

  it("grounds a spoken-content claim whose quote is in the transcript", async () => {
    const { service, runDir } = await newRun();
    const tr = await service.registerTranscript({ runDir, sourceUrl: "https://www.youtube.com/watch?v=demo", vtt: SAMPLE_VTT });
    if (!tr.ok) throw new Error("transcript registration failed");

    const grounded = await service.addClaim({
      runDir,
      artifactId: tr.artifactId as string,
      claim: "The narrator says they arrived at the airport in Tokyo.",
      claimType: "text",
      evidenceKind: "transcript_cue",
      verificationLevel: "transcript_cue",
      anchor: { type: "text_span", quote: "arrived at the airport in Tokyo" }
    });
    expect((grounded as { gate?: { ok: boolean } }).gate?.ok).toBe(true);
  });

  it("rejects a spoken-content claim about something never said", async () => {
    const { service, runDir } = await newRun();
    const tr = await service.registerTranscript({ runDir, sourceUrl: "https://www.youtube.com/watch?v=demo", vtt: SAMPLE_VTT });
    if (!tr.ok) throw new Error("transcript registration failed");

    const ungrounded = await service.addClaim({
      runDir,
      artifactId: tr.artifactId as string,
      claim: "The narrator visited Osaka Castle.",
      claimType: "text",
      evidenceKind: "transcript_cue",
      verificationLevel: "transcript_cue",
      anchor: { type: "text_span", quote: "visited Osaka Castle" }
    });
    expect((ungrounded as { gate?: { ok: boolean } }).gate?.ok).toBe(false);
  });

  it("accepts a plain-text transcript when WebVTT is not available", async () => {
    const { service, runDir } = await newRun();
    const result = await service.registerTranscript({
      runDir,
      sourceUrl: "https://example.com/video",
      text: "speaker one: the product launches next quarter"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cueCount).toBe(0); // plain text has no parsed cues
  });

  it("errors when neither vtt nor text is supplied", async () => {
    const { service, runDir } = await newRun();
    const result = await service.registerTranscript({ runDir, sourceUrl: "https://example.com/v" });
    expect(result.ok).toBe(false);
  });
});
