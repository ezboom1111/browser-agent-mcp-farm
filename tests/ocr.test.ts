import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactRecord } from "../src/artifact-writer.js";
import { runOcrForFrameArtifacts, type OcrWorker } from "../src/ocr.js";

let runDirs: string[] = [];

describe("runOcrForFrameArtifacts", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("records no_frames without initializing OCR when no frame screenshots exist", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-ocr-no-frames-"));
    runDirs.push(runDir);
    let workerRequested = false;

    const result = await runOcrForFrameArtifacts({
      runDir,
      sourceUrl: "https://example.com/video",
      contextToken: "ctx_test",
      pageId: "ocr",
      baseCaptureId: "ocr-test",
      frameRecords: [],
      options: { enabled: true, maxFrames: 20, timeoutMs: 1_000, language: "eng", minConfidence: 0 },
      workerFactory: async () => {
        workerRequested = true;
        return undefined;
      }
    });

    expect(workerRequested).toBe(false);
    const metadata = await readOcrMetadata(runDir, result.records);
    expect(metadata.ocr.status).toBe("no_frames");
    expect(metadata.ocr.language).toBe("eng");
  });

  it("OCRs page screenshots when no frame screenshots exist", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-ocr-page-screenshot-"));
    runDirs.push(runDir);
    const screenshotPath = "screenshots/page-capture.png";
    await writeFrameImage(runDir, screenshotPath);

    let recognizeCalls = 0;
    const worker: OcrWorker = {
      recognize: async () => {
        recognizeCalls += 1;
        return {
          data: {
            text: "로라바운스 내돈내산 이미지 리뷰",
            confidence: 93,
            words: [{ text: "로라바운스", confidence: 94 }]
          }
        };
      },
      terminate: async () => undefined
    };

    const result = await runOcrForFrameArtifacts({
      runDir,
      sourceUrl: "https://search.naver.com/search.naver?query=%EB%A1%9C%EB%9D%BC%EB%B0%94%EC%9A%B4%EC%8A%A4",
      contextToken: "ctx_test",
      pageId: "ocr",
      baseCaptureId: "ocr-page-test",
      frameRecords: [],
      imageRecords: [pageScreenshotRecord("page-1", screenshotPath, "page-sha")],
      options: { enabled: true, maxFrames: 20, timeoutMs: 1_000, language: "kor+eng", minConfidence: 50 },
      workerFactory: async () => worker
    });

    expect(recognizeCalls).toBe(1);
    const textRecord = result.records.find((record) => record.kind === "text");
    expect(textRecord?.status).toBe("ok");
    expect(await readFile(join(runDir, textRecord?.path ?? ""), "utf8")).toBe("로라바운스 내돈내산 이미지 리뷰");
    const metadata = await readOcrMetadata(runDir, result.records);
    expect(metadata.ocr).toMatchObject({
      status: "ok",
      language: "kor+eng",
      sourceArtifactId: "page-1",
      sourcePath: screenshotPath,
      textLength: "로라바운스 내돈내산 이미지 리뷰".length
    });
    expect(metadata.ocr.timestampSec).toBeUndefined();
  });

  it("records OCR language, confidence, word boxes, and cache hits", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-ocr-ok-"));
    runDirs.push(runDir);
    const framePath = "screenshots/frame-sample-frame-001-000012s500ms.png";
    await writeFrameImage(runDir, framePath);

    let recognizeCalls = 0;
    let terminated = false;
    let requestedLanguage = "";
    const worker: OcrWorker = {
      recognize: async () => {
        recognizeCalls += 1;
        return {
          data: {
            text: " HELLO OCR \n",
            confidence: 92,
            words: [
              { text: "HELLO", confidence: 93, bbox: { x0: 1, y0: 2, x1: 30, y1: 14 } },
              { text: "low", confidence: 10, bbox: { x0: 40, y0: 2, x1: 60, y1: 14 } }
            ]
          }
        };
      },
      terminate: async () => {
        terminated = true;
      }
    };

    const result = await runOcrForFrameArtifacts({
      runDir,
      sourceUrl: "https://example.com/video",
      contextToken: "ctx_test",
      pageId: "ocr",
      baseCaptureId: "ocr-test",
      frameRecords: [frameRecord("frame-1", framePath, "same-sha"), frameRecord("frame-2", framePath, "same-sha")],
      options: { enabled: true, maxFrames: 20, timeoutMs: 1_000, language: "eng+kor", minConfidence: 50 },
      workerFactory: async (language) => {
        requestedLanguage = language;
        return worker;
      }
    });

    expect(requestedLanguage).toBe("eng+kor");
    expect(recognizeCalls).toBe(1);
    expect(terminated).toBe(true);
    const textRecords = result.records.filter((record) => record.kind === "text");
    expect(textRecords).toHaveLength(2);
    expect(textRecords.every((record) => record.status === "ok")).toBe(true);
    expect(await readFile(join(runDir, textRecords[0]!.path), "utf8")).toBe("HELLO OCR");

    const metadataRecords = result.records.filter((record) => record.kind === "structured");
    expect(metadataRecords).toHaveLength(2);
    const firstMetadata = JSON.parse(await readFile(join(runDir, metadataRecords[0]!.path), "utf8"));
    const secondMetadata = JSON.parse(await readFile(join(runDir, metadataRecords[1]!.path), "utf8"));
    expect(firstMetadata.ocr.status).toBe("ok");
    expect(firstMetadata.ocr.language).toBe("eng+kor");
    expect(firstMetadata.ocr.minConfidence).toBe(50);
    expect(firstMetadata.ocr.timestampSec).toBe(12.5);
    expect(firstMetadata.ocr.confidence).toBe(92);
    expect(firstMetadata.ocr.confidenceMet).toBe(true);
    expect(firstMetadata.ocr.textProfile).toMatchObject({
      lineCount: 1,
      hasDigits: false,
      hasCurrency: false,
      hasPriceLikeText: false,
      priceLikeTokenCount: 0,
      hasPercentLikeText: false,
      hasMapLikeText: false,
      hasTravelOrCommerceLikeText: false,
      hasRatingLikeText: false,
      hasDistanceLikeText: false,
      hasBusinessHoursLikeText: false,
      hasContactLikeText: false
    });
    expect(firstMetadata.ocr.textProfile.scripts).toEqual(["latin"]);
    expect(firstMetadata.ocr.wordCount).toBe(1);
    expect(firstMetadata.ocr.words).toEqual([{ text: "HELLO", confidence: 93, bbox: { x0: 1, y0: 2, x1: 30, y1: 14 } }]);
    expect(secondMetadata.ocr.cacheHit).toBe(true);
  });

  it("marks low-confidence OCR text partial so it cannot become verified OCR evidence", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-ocr-low-confidence-"));
    runDirs.push(runDir);
    await writeFrameImage(runDir, "screenshots/frame.png");
    const worker: OcrWorker = {
      recognize: async () => ({ data: { text: "weak", confidence: 10, words: [{ text: "weak", confidence: 10 }] } }),
      terminate: async () => undefined
    };

    const result = await runOcrForFrameArtifacts({
      runDir,
      sourceUrl: "https://example.com/video",
      contextToken: "ctx_test",
      pageId: "ocr",
      baseCaptureId: "ocr-test",
      frameRecords: [frameRecord("frame-1", "screenshots/frame.png", "sha")],
      options: { enabled: true, maxFrames: 20, timeoutMs: 1_000, language: "eng", minConfidence: 50 },
      workerFactory: async () => worker
    });

    const textRecord = result.records.find((record) => record.kind === "text");
    expect(textRecord?.status).toBe("partial");
    const metadata = await readOcrMetadata(runDir, result.records);
    expect(metadata.ocr.status).toBe("low_confidence");
    expect(metadata.ocr.confidenceMet).toBe(false);
  });

  it("marks empty OCR text partial and records an empty text profile", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-ocr-empty-text-"));
    runDirs.push(runDir);
    await writeFrameImage(runDir, "screenshots/frame-empty.png");
    const worker: OcrWorker = {
      recognize: async () => ({ data: { text: "   \n  ", confidence: 88, words: [] } }),
      terminate: async () => undefined
    };

    const result = await runOcrForFrameArtifacts({
      runDir,
      sourceUrl: "https://example.com/video",
      contextToken: "ctx_test",
      pageId: "ocr",
      baseCaptureId: "ocr-empty-test",
      frameRecords: [frameRecord("frame-empty", "screenshots/frame-empty.png", "empty-sha")],
      options: { enabled: true, maxFrames: 20, timeoutMs: 1_000, language: "eng", minConfidence: 50 },
      workerFactory: async () => worker
    });

    const textRecord = result.records.find((record) => record.kind === "text");
    expect(textRecord?.status).toBe("partial");
    const metadata = await readOcrMetadata(runDir, result.records);
    expect(metadata.ocr.status).toBe("empty_text");
    expect(metadata.ocr.confidenceMet).toBe(true);
    expect(metadata.ocr.textProfile).toMatchObject({
      lineCount: 0,
      nonWhitespaceCharCount: 0,
      hasDigits: false,
      hasCurrency: false,
      hasPriceLikeText: false,
      priceLikeTokenCount: 0,
      hasPercentLikeText: false,
      hasMapLikeText: false,
      hasTravelOrCommerceLikeText: false,
      hasRatingLikeText: false,
      hasDistanceLikeText: false,
      hasBusinessHoursLikeText: false,
      hasContactLikeText: false
    });
  });

  it("records script and price profile metadata for map and travel screenshots", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-ocr-profile-"));
    runDirs.push(runDir);
    const framePath = "screenshots/frame-sample-frame-001-000007s250ms.png";
    await writeFrameImage(runDir, framePath);
    const worker: OcrWorker = {
      recognize: async () => ({
        data: {
          text: "Naver Map\n네이버 지도\n東京駅\nAgoda ₩120,000\nTrip.com JPY 12,300",
          confidence: 91,
          words: [
            { text: "Naver", confidence: 95 },
            { text: "네이버", confidence: 92 },
            { text: "東京駅", confidence: 90 },
            { text: "₩120,000", confidence: 89 },
            { text: "JPY", confidence: 88 }
          ]
        }
      }),
      terminate: async () => undefined
    };

    const result = await runOcrForFrameArtifacts({
      runDir,
      sourceUrl: "https://example.com/travel-map",
      contextToken: "ctx_test",
      pageId: "ocr",
      baseCaptureId: "ocr-profile-test",
      frameRecords: [frameRecord("frame-1", framePath, "profile-sha")],
      options: { enabled: true, maxFrames: 20, timeoutMs: 1_000, language: "eng+kor+jpn", minConfidence: 50 },
      workerFactory: async () => worker
    });

    const textRecord = result.records.find((record) => record.kind === "text");
    expect(textRecord?.status).toBe("ok");
    const metadata = await readOcrMetadata(runDir, result.records);
    expect(metadata.ocr.language).toBe("eng+kor+jpn");
    expect(metadata.ocr.timestampSec).toBe(7.25);
    expect(metadata.ocr.textProfile).toMatchObject({
      lineCount: 5,
      hasDigits: true,
      hasCurrency: true,
      hasPriceLikeText: true,
      priceLikeTokenCount: 2,
      hasMapLikeText: true,
      hasTravelOrCommerceLikeText: true,
      hasRatingLikeText: false
    });
    expect((metadata.ocr.textProfile as { scripts: string[] }).scripts).toEqual(expect.arrayContaining(["latin", "hangul", "cjk", "digit", "currency"]));
  });

  it("records per-frame OCR engine failures and continues with later frames", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-ocr-engine-error-"));
    runDirs.push(runDir);
    await writeFrameImage(runDir, "screenshots/frame-sample-frame-001-000001s000ms.png");
    await writeFrameImage(runDir, "screenshots/frame-sample-frame-002-000002s000ms.png");
    let recognizeCalls = 0;
    let terminated = false;
    const worker: OcrWorker = {
      recognize: async () => {
        recognizeCalls += 1;
        if (recognizeCalls === 1) {
          throw new Error("engine crashed on frame");
        }
        return { data: { text: "RECOVERED OCR", confidence: 91, words: [{ text: "RECOVERED", confidence: 91 }] } };
      },
      terminate: async () => {
        terminated = true;
      }
    };

    const result = await runOcrForFrameArtifacts({
      runDir,
      sourceUrl: "https://example.com/video",
      contextToken: "ctx_test",
      pageId: "ocr",
      baseCaptureId: "ocr-engine-error-test",
      frameRecords: [frameRecord("frame-1", "screenshots/frame-sample-frame-001-000001s000ms.png", "sha-1"), frameRecord("frame-2", "screenshots/frame-sample-frame-002-000002s000ms.png", "sha-2")],
      options: { enabled: true, maxFrames: 20, timeoutMs: 1_000, language: "eng", minConfidence: 50 },
      workerFactory: async () => worker
    });

    expect(recognizeCalls).toBe(2);
    expect(terminated).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("OCR engine_error for frame-1")]));
    const metadata = await readOcrMetadataRecords(runDir, result.records);
    expect(metadata.map((entry) => entry.ocr.status)).toEqual(["engine_error", "ok"]);
    expect(metadata[0]?.ocr).toMatchObject({
      reason: "engine crashed on frame",
      sourceArtifactId: "frame-1",
      timestampSec: 1,
      textLength: 0,
      wordCount: 0,
      wordsReturned: 0,
      wordsCapped: false
    });
    expect(metadata[0]?.ocr.textProfile).toMatchObject({
      lineCount: 0,
      nonWhitespaceCharCount: 0
    });
    expect(metadata[1]?.ocr).toMatchObject({
      sourceArtifactId: "frame-2",
      timestampSec: 2,
      textLength: "RECOVERED OCR".length,
      wordCount: 1
    });
  });

  it("records OCR timeouts as partial artifacts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-ocr-timeout-"));
    runDirs.push(runDir);
    await writeFrameImage(runDir, "screenshots/frame-sample-frame-001-000003s000ms.png");
    let terminated = false;
    const worker: OcrWorker = {
      recognize: async () => new Promise(() => undefined),
      terminate: async () => {
        terminated = true;
      }
    };

    const result = await runOcrForFrameArtifacts({
      runDir,
      sourceUrl: "https://example.com/video",
      contextToken: "ctx_test",
      pageId: "ocr",
      baseCaptureId: "ocr-timeout-test",
      frameRecords: [frameRecord("frame-timeout", "screenshots/frame-sample-frame-001-000003s000ms.png", "timeout-sha")],
      options: { enabled: true, maxFrames: 20, timeoutMs: 1, language: "eng", minConfidence: 50 },
      workerFactory: async () => worker
    });

    expect(terminated).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("OCR timeout for frame-timeout")]));
    const metadata = await readOcrMetadata(runDir, result.records);
    expect(metadata.ocr).toMatchObject({
      status: "timeout",
      reason: "OCR timed out after 1ms",
      sourceArtifactId: "frame-timeout",
      timestampSec: 3,
      textLength: 0
    });
    expect(result.records.find((record) => record.kind === "structured")?.status).toBe("partial");
  });
});

async function writeFrameImage(runDir: string, relPath: string): Promise<void> {
  const path = join(runDir, relPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from("fake-png"));
}

function frameRecord(artifactId: string, relPath: string, sha256: string): ArtifactRecord {
  return {
    artifact_id: artifactId,
    path: relPath,
    bytes: 8,
    sha256,
    kind: "screenshot",
    format: "png",
    mime: "image/png",
    source_url: "https://example.com/video",
    capture_method: "browser-agent-mcp-farm frame-sample",
    role: "evidence",
    status: "ok",
    backend: "playwright-mcp",
    tool_name: "farm_sample_frames",
    evidence_kind: "frame_screenshot"
  };
}

function pageScreenshotRecord(artifactId: string, relPath: string, sha256: string): ArtifactRecord {
  return {
    artifact_id: artifactId,
    path: relPath,
    bytes: 8,
    sha256,
    kind: "screenshot",
    format: "png",
    mime: "image/png",
    source_url: "https://search.naver.com/search.naver?query=%EB%A1%9C%EB%9D%BC%EB%B0%94%EC%9A%B4%EC%8A%A4",
    capture_method: "browser-agent-mcp-farm capture",
    role: "evidence",
    status: "ok",
    backend: "playwright-mcp",
    tool_name: "farm_capture",
    evidence_kind: "page_screenshot"
  };
}

async function readOcrMetadata(runDir: string, records: ArtifactRecord[]): Promise<{ ocr: Record<string, unknown> }> {
  const metadataRecord = records.find((record) => record.kind === "structured");
  if (metadataRecord === undefined) {
    throw new Error("Expected OCR metadata record");
  }
  return JSON.parse(await readFile(join(runDir, metadataRecord.path), "utf8")) as { ocr: Record<string, unknown> };
}

async function readOcrMetadataRecords(runDir: string, records: ArtifactRecord[]): Promise<Array<{ ocr: Record<string, unknown> }>> {
  const metadataRecords = records.filter((record) => record.kind === "structured");
  return Promise.all(metadataRecords.map(async (record) => JSON.parse(await readFile(join(runDir, record.path), "utf8")) as { ocr: Record<string, unknown> }));
}
