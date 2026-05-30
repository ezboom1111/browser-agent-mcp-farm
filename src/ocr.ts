import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EvidenceRunAbortError, throwIfAborted } from "./abort.js";
import { ArtifactWriter, sanitizeFileBase, type ArtifactRecord, type ArtifactStatus } from "./artifact-writer.js";
import { buildOcrTextProfile } from "./ocr-text-profile.js";
import type { OcrEvidenceMetadata, OcrWord } from "./schemas.js";

export interface OcrOptions {
  enabled: boolean;
  maxFrames: number;
  timeoutMs: number;
  language?: string;
  minConfidence?: number;
}

export interface OcrRunResult {
  records: ArtifactRecord[];
  warnings: string[];
}

export interface OcrWorker {
  recognize: (image: string | Uint8Array) => Promise<TesseractRecognizeResult>;
  terminate: () => Promise<void>;
}

export type OcrWorkerFactory = (language: string) => Promise<OcrWorker | undefined>;

interface NormalizedOcrOptions {
  enabled: boolean;
  maxFrames: number;
  timeoutMs: number;
  language: string;
  minConfidence: number;
}

interface TesseractRecognizeResult {
  data?: TesseractResultData;
}

interface TesseractResultData {
  text?: string;
  confidence?: number;
  words?: TesseractWord[];
}

interface TesseractWord {
  text?: string;
  confidence?: number;
  bbox?: unknown;
}

interface OcrExtraction {
  text: string;
  confidence?: number;
  words: OcrWord[];
}

type OcrArtifactStatus = {
  artifactStatus: ArtifactStatus;
  ocrStatus: OcrEvidenceMetadata["status"];
  note?: string;
};

const MAX_REPORTED_WORDS = 200;

export async function runOcrForFrameArtifacts(input: {
  runDir: string;
  sourceUrl: string;
  contextToken: string;
  pageId: string;
  baseCaptureId: string;
  frameRecords: ArtifactRecord[];
  options: OcrOptions;
  writer?: ArtifactWriter;
  workerFactory?: OcrWorkerFactory;
  signal?: AbortSignal | undefined;
}): Promise<OcrRunResult> {
  const options = normalizeOcrOptions(input.options);
  if (!options.enabled) {
    return { records: [], warnings: [] };
  }
  throwIfAborted(input.signal);

  const writer = input.writer ?? new ArtifactWriter();
  const records: ArtifactRecord[] = [];
  const warnings: string[] = [];
  const frameScreenshots = input.frameRecords.filter((record) => record.kind === "screenshot" && record.evidence_kind === "frame_screenshot").slice(0, options.maxFrames);

  if (frameScreenshots.length === 0) {
    records.push(
      ...(await writer.writeCaptureBundle({
        runDir: input.runDir,
        sourceUrl: input.sourceUrl,
        contextToken: input.contextToken,
        pageId: input.pageId,
        captureId: `${input.baseCaptureId}-ocr-no-frames`,
        status: "partial",
        metadata: {
          ocr: {
            status: "no_frames",
            language: options.language,
            minConfidence: options.minConfidence,
            requestedFrames: 0,
            reason: "no sampled frame screenshots were available for OCR"
          } satisfies OcrEvidenceMetadata
        },
        captureMethod: "browser-agent-mcp-farm ocr",
        toolName: "evidence_run_ocr",
        evidenceKind: "ocr_text",
        note: "OCR skipped; no sampled frame screenshots were available."
      }))
    );
    return { records, warnings };
  }

  const worker = await (input.workerFactory ?? createOptionalTesseractWorker)(options.language);
  if (worker === undefined) {
    warnings.push("OCR skipped because optional dependency tesseract.js is not installed or could not initialize.");
    records.push(
      ...(await writer.writeCaptureBundle({
        runDir: input.runDir,
        sourceUrl: input.sourceUrl,
        contextToken: input.contextToken,
        pageId: input.pageId,
        captureId: `${input.baseCaptureId}-ocr-unavailable`,
        status: "partial",
        metadata: {
          ocr: {
            status: "unavailable",
            language: options.language,
            minConfidence: options.minConfidence,
            reason: "optional dependency tesseract.js is not installed or could not initialize",
            requestedFrames: frameScreenshots.length
          } satisfies OcrEvidenceMetadata
        },
        captureMethod: "browser-agent-mcp-farm ocr",
        toolName: "evidence_run_ocr",
        evidenceKind: "ocr_text",
        note: "OCR unavailable; no visible text was extracted."
      }))
    );
    return { records, warnings };
  }

  const cache = new Map<string, OcrExtraction>();
  try {
    for (const [index, frame] of frameScreenshots.entries()) {
      throwIfAborted(input.signal);
      const cachedExtraction = cache.get(frame.sha256);
      const cacheHit = cachedExtraction !== undefined;
      let extraction = cachedExtraction;
      if (extraction === undefined) {
        const imagePath = join(input.runDir, frame.path);
        try {
          extraction = await recognizeWithTimeout(worker, imagePath, options, input.signal);
        } catch (error) {
          if (error instanceof EvidenceRunAbortError) {
            throw error;
          }
          const failureStatus = ocrFailureStatus(error);
          const reason = errorMessage(error);
          warnings.push(`OCR ${failureStatus} for ${frame.artifact_id}: ${reason}`);
          records.push(
            ...(await writer.writeCaptureBundle({
              runDir: input.runDir,
              sourceUrl: frame.source_url,
              contextToken: input.contextToken,
              pageId: input.pageId,
              captureId: `${input.baseCaptureId}-ocr-${String(index + 1).padStart(3, "0")}-${sanitizeFileBase(frame.artifact_id)}-${failureStatus}`,
              status: "partial",
              metadata: {
                ocr: buildFailedOcrMetadata({
                  status: failureStatus,
                  options,
                  frame,
                  reason
                })
              },
              captureMethod: "browser-agent-mcp-farm ocr",
              toolName: "evidence_run_ocr",
              evidenceKind: "ocr_text",
              note: `OCR ${failureStatus}: ${reason}`
            }))
          );
          continue;
        }
        cache.set(frame.sha256, extraction);
      }
      const status = classifyExtraction(extraction, options.minConfidence);
      const words = extraction.words.slice(0, MAX_REPORTED_WORDS);
      const metadata = buildOcrMetadata({
        status: status.ocrStatus,
        options,
        frame,
        cacheHit,
        extraction,
        words
      });
      records.push(
        ...(await writer.writeCaptureBundle({
          runDir: input.runDir,
          sourceUrl: frame.source_url,
          contextToken: input.contextToken,
          pageId: input.pageId,
          captureId: `${input.baseCaptureId}-ocr-${String(index + 1).padStart(3, "0")}-${sanitizeFileBase(frame.artifact_id)}`,
          status: status.artifactStatus,
          text: extraction.text,
          metadata: { ocr: metadata },
          captureMethod: "browser-agent-mcp-farm ocr",
          toolName: "evidence_run_ocr",
          evidenceKind: "ocr_text",
          ...(status.note === undefined ? {} : { note: status.note })
        }))
      );
    }
  } finally {
    await worker.terminate().catch(() => undefined);
  }

  return { records, warnings };
}

async function recognizeWithTimeout(worker: OcrWorker, imagePath: string, options: NormalizedOcrOptions, signal: AbortSignal | undefined): Promise<OcrExtraction> {
  throwIfAborted(signal);
  const bytes = await readFile(imagePath);
  const job = worker.recognize(bytes);
  let timeoutHandle: NodeJS.Timeout | undefined;
  let removeAbortListener: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`OCR timed out after ${options.timeoutMs}ms`)), options.timeoutMs);
  });
  const abort = new Promise<never>((_, reject) => {
    if (signal === undefined) {
      return;
    }
    const listener = () => reject(new EvidenceRunAbortError(signal.reason === undefined ? "OCR canceled" : String(signal.reason)));
    signal.addEventListener("abort", listener, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", listener);
  });
  try {
    const result = await Promise.race([job, timeout, abort]);
    return normalizeExtraction(result, options.minConfidence);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    removeAbortListener?.();
  }
}

function normalizeExtraction(result: TesseractRecognizeResult, minConfidence: number): OcrExtraction {
  const data = result.data ?? {};
  const text = data.text?.trim() ?? "";
  const words = (data.words ?? [])
    .map((word) => normalizeWord(word))
    .filter((word): word is OcrWord => word !== undefined)
    .filter((word) => word.confidence === undefined || word.confidence >= minConfidence);
  const extraction: OcrExtraction = { text, words };
  if (typeof data.confidence === "number" && Number.isFinite(data.confidence)) {
    extraction.confidence = clampConfidence(data.confidence);
  }
  return extraction;
}

function normalizeWord(word: TesseractWord): OcrWord | undefined {
  const text = word.text?.trim();
  if (!text) {
    return undefined;
  }
  const normalized: OcrWord = { text };
  if (typeof word.confidence === "number" && Number.isFinite(word.confidence)) {
    normalized.confidence = clampConfidence(word.confidence);
  }
  const bbox = normalizeBbox(word.bbox);
  if (bbox !== undefined) {
    normalized.bbox = bbox;
  }
  return normalized;
}

function normalizeBbox(value: unknown): OcrWord["bbox"] | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x0 = numberFromUnknown(record.x0);
  const y0 = numberFromUnknown(record.y0);
  const x1 = numberFromUnknown(record.x1);
  const y1 = numberFromUnknown(record.y1);
  if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined) {
    return undefined;
  }
  return {
    x0: Math.max(0, x0),
    y0: Math.max(0, y0),
    x1: Math.max(0, x1),
    y1: Math.max(0, y1)
  };
}

function classifyExtraction(extraction: OcrExtraction, minConfidence: number): OcrArtifactStatus {
  if (extraction.text.length === 0) {
    return {
      artifactStatus: "partial",
      ocrStatus: "empty_text",
      note: "OCR completed but extracted no visible text."
    };
  }
  if (extraction.confidence !== undefined && extraction.confidence < minConfidence) {
    return {
      artifactStatus: "partial",
      ocrStatus: "low_confidence",
      note: `OCR confidence ${extraction.confidence} is below minimum ${minConfidence}.`
    };
  }
  return {
    artifactStatus: "ok",
    ocrStatus: "ok"
  };
}

function buildOcrMetadata(input: { status: OcrEvidenceMetadata["status"]; options: NormalizedOcrOptions; frame: ArtifactRecord; cacheHit: boolean; extraction: OcrExtraction; words: OcrWord[] }): OcrEvidenceMetadata {
  const metadata: OcrEvidenceMetadata = {
    status: input.status,
    language: input.options.language,
    minConfidence: input.options.minConfidence,
    sourceArtifactId: input.frame.artifact_id,
    sourcePath: input.frame.path,
    cacheHit: input.cacheHit,
    textLength: input.extraction.text.length,
    wordCount: input.extraction.words.length,
    wordsReturned: input.words.length,
    wordsCapped: input.extraction.words.length > input.words.length,
    textProfile: buildOcrTextProfile(input.extraction.text),
    words: input.words
  };
  const timestampSec = timestampSecFromFramePath(input.frame.path);
  if (timestampSec !== undefined) {
    metadata.timestampSec = timestampSec;
  }
  if (input.extraction.confidence !== undefined) {
    metadata.confidence = input.extraction.confidence;
    metadata.confidenceMet = input.extraction.confidence >= input.options.minConfidence;
  }
  return metadata;
}

function buildFailedOcrMetadata(input: { status: "engine_error" | "timeout"; options: NormalizedOcrOptions; frame: ArtifactRecord; reason: string }): OcrEvidenceMetadata {
  const metadata: OcrEvidenceMetadata = {
    status: input.status,
    language: input.options.language,
    minConfidence: input.options.minConfidence,
    sourceArtifactId: input.frame.artifact_id,
    sourcePath: input.frame.path,
    cacheHit: false,
    textLength: 0,
    wordCount: 0,
    wordsReturned: 0,
    wordsCapped: false,
    textProfile: buildOcrTextProfile(""),
    words: [],
    reason: input.reason
  };
  const timestampSec = timestampSecFromFramePath(input.frame.path);
  if (timestampSec !== undefined) {
    metadata.timestampSec = timestampSec;
  }
  return metadata;
}

function ocrFailureStatus(error: unknown): "engine_error" | "timeout" {
  return /timed out/i.test(errorMessage(error)) ? "timeout" : "engine_error";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 500);
  }
  return String(error).trim().slice(0, 500) || "unknown OCR error";
}

function normalizeOcrOptions(options: OcrOptions): NormalizedOcrOptions {
  return {
    enabled: options.enabled,
    maxFrames: Math.max(1, Math.min(120, Math.trunc(options.maxFrames))),
    timeoutMs: Math.max(1, Math.min(60_000, Math.trunc(options.timeoutMs))),
    language: options.language?.trim() || "eng",
    minConfidence: clampConfidence(options.minConfidence ?? 0)
  };
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function timestampSecFromFramePath(path: string): number | undefined {
  const match = /-frame-\d{3}-(\d{6})s(?:(\d{3})ms)?\.png$/i.exec(path);
  const wholeRaw = match?.[1];
  if (wholeRaw === undefined) {
    return undefined;
  }
  const whole = Number(wholeRaw);
  const millis = match?.[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isFinite(whole) || !Number.isFinite(millis)) {
    return undefined;
  }
  return Math.round((whole + millis / 1000) * 1000) / 1000;
}

async function createOptionalTesseractWorker(language: string): Promise<OcrWorker | undefined> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    const module = (await dynamicImport("tesseract.js")) as { createWorker?: (language?: string) => Promise<OcrWorker> };
    if (typeof module.createWorker !== "function") {
      return undefined;
    }
    return await module.createWorker(language);
  } catch {
    return undefined;
  }
}
