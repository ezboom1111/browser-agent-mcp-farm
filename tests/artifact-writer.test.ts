import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";

let runDirs: string[] = [];

describe("ArtifactWriter", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("writes a capture bundle and registers artifacts with hashes", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-artifacts-"));
    runDirs.push(runDir);

    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "example",
      html: "<html><body>Hello</body></html>",
      text: "Hello",
      screenshot: Buffer.from("fake-png"),
      metadata: { title: "Example" },
      networkEvents: [{ url: "https://example.com/", status: 200 }],
      consoleEvents: []
    });

    expect(records).toHaveLength(6);
    expect(records.every((record) => record.sha256.length === 64)).toBe(true);

    const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
    expect(ledger).toContain("raw/example.html");
    expect(ledger).toContain("screenshots/example.png");
  });

  it("never auto-produces an audio_transcription artifact (lawful provider-supplied only; no speech-to-text)", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-no-audio-"));
    runDirs.push(runDir);

    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "audio-guard",
      html: "<html><body><audio src=\"clip.mp3\"></audio>spoken words</body></html>",
      text: "spoken words",
      screenshot: Buffer.from("fake-png"),
      metadata: { title: "Audio page" },
      mediaIndex: [{ url: "https://example.com/clip.mp3", type: "audio" }],
      networkEvents: [],
      consoleEvents: []
    });

    // The autonomous pipeline only emits captions as transcript_cue; audio_transcription
    // is reachable only via an explicit operator-registered provider transcript.
    expect(records.some((record) => record.evidence_kind === "audio_transcription")).toBe(false);
  });

  it("records partial failures as structured artifacts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-failure-"));
    runDirs.push(runDir);

    const writer = new ArtifactWriter();
    const records = await writer.recordFailure({
      runDir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "failed",
      error: "timeout",
      status: "timeout"
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe("timeout");
    const metadata = await readFile(join(runDir, "structured", "failed.metadata.json"), "utf8");
    expect(metadata).toContain("timeout");
  });

  it("writes media artifacts and a media index", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-media-artifacts-"));
    runDirs.push(runDir);

    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/media",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "media",
      text: "Media page",
      mediaIndex: [
        { url: "https://example.com/image.png", mime: "image/png", resourceType: "image", captured: true, skipped: false },
        { url: "https://example.com/clip.mp4", mime: "video/mp4", resourceType: "media", captured: false, skipped: true, reason: "non_capturable_stream_or_binary_media" }
      ],
      mediaArtifacts: [
        {
          url: "https://example.com/image.png",
          bytes: Buffer.from("fake-image"),
          mime: "image/png",
          resourceType: "image"
        }
      ]
    });

    expect(records.some((record) => record.kind === "media")).toBe(true);
    expect(records.some((record) => record.path === "structured/media.media-index.json")).toBe(true);
    await expect(readFile(join(runDir, "media", "media", "001-image.png"), "utf8")).resolves.toBe("fake-image");

    const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
    expect(ledger).toContain("\"kind\":\"media\"");
    expect(ledger).toContain("media/media/001-image.png");
  });

  it("parses captured WebVTT media into structured transcript evidence", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-transcript-artifacts-"));
    runDirs.push(runDir);

    const writer = new ArtifactWriter();
    const records = await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/video",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "captioned",
      mediaArtifacts: [
        {
          url: "https://example.com/captions.vtt",
          bytes: Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\ncaption text\n", "utf8"),
          mime: "text/vtt",
          resourceType: "media"
        }
      ]
    });

    expect(records.some((record) => record.path === "structured/captioned.transcripts/001-captions.json")).toBe(true);
    const transcript = await readFile(join(runDir, "structured", "captioned.transcripts", "001-captions.json"), "utf8");
    expect(transcript).toContain("\"cueCount\": 1");
    expect(transcript).toContain("caption text");

    const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
    expect(ledger).toContain("captioned.transcripts/001-captions.json");
  });
});
