import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile, appendFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { FarmError } from "./farm-error.js";
import type { EvidenceKind } from "./schemas.js";
import { parseWebVtt } from "./transcript-parser.js";

export type ArtifactKind = "text" | "structured" | "screenshot" | "html" | "raw" | "media";
export type ArtifactStatus = "ok" | "partial" | "timeout" | "blocked" | "error";

export interface ArtifactRecord {
  artifact_id: string;
  path: string;
  bytes: number;
  sha256: string;
  kind: ArtifactKind;
  format: string;
  mime: string;
  source_url: string;
  capture_method: string;
  role: "evidence";
  status: ArtifactStatus;
  note?: string;
  backend: "playwright-mcp";
  tool_name: string;
  session_ref?: string;
  evidence_kind?: EvidenceKind;
}

export interface CaptureBundleInput {
  runDir: string;
  sourceUrl: string;
  contextToken: string;
  pageId: string;
  captureId?: string;
  status?: ArtifactStatus;
  html?: string;
  text?: string;
  screenshot?: Uint8Array;
  metadata?: Record<string, unknown>;
  networkEvents?: unknown[];
  consoleEvents?: unknown[];
  mediaArtifacts?: MediaArtifactInput[];
  mediaIndex?: unknown[];
  note?: string;
  captureMethod?: string;
  toolName?: string;
  evidenceKind?: EvidenceKind;
}

export interface MediaArtifactInput {
  url: string;
  bytes: Uint8Array;
  mime: string;
  resourceType: string;
  suggestedName?: string;
  status?: ArtifactStatus;
  note?: string;
}

export class ArtifactWriter {
  async writeCaptureBundle(input: CaptureBundleInput): Promise<ArtifactRecord[]> {
    const captureId = sanitizeFileBase(input.captureId ?? `capture-${new URL(input.sourceUrl).hostname}-${randomUUID()}`);
    const status = input.status ?? "ok";
    const records: ArtifactRecord[] = [];

    const metadata = {
      sourceUrl: input.sourceUrl,
      contextToken: input.contextToken,
      pageId: input.pageId,
      capturedAt: new Date().toISOString(),
      status,
      ...input.metadata
    };

    records.push(await this.writeJson(input.runDir, `structured/${captureId}.metadata.json`, metadata, input, status));

    if (input.html !== undefined) {
      records.push(await this.writeText(input.runDir, `raw/${captureId}.html`, input.html, "html", "html", "text/html", input, status));
    }

    if (input.text !== undefined) {
      records.push(await this.writeText(input.runDir, `raw/${captureId}.txt`, input.text, "text", "txt", "text/plain", input, status));
    }

    if (input.screenshot !== undefined) {
      records.push(await this.writeBytes(input.runDir, `screenshots/${captureId}.png`, input.screenshot, "screenshot", "png", "image/png", input, status));
    }

    if (input.networkEvents !== undefined) {
      records.push(await this.writeJsonl(input.runDir, `structured/${captureId}.network.jsonl`, input.networkEvents, input, status, "network log"));
    }

    if (input.consoleEvents !== undefined) {
      records.push(await this.writeJsonl(input.runDir, `structured/${captureId}.console.jsonl`, input.consoleEvents, input, status, "console log"));
    }

    if (input.mediaIndex !== undefined) {
      records.push(await this.writeJson(input.runDir, `structured/${captureId}.media-index.json`, input.mediaIndex, input, status));
    }

    if (input.mediaArtifacts !== undefined) {
      for (const [index, media] of input.mediaArtifacts.entries()) {
        const format = extensionForMedia(media.mime, media.url);
        const mediaInput: CaptureBundleInput = {
          ...input,
          captureId,
          sourceUrl: media.url
        };
        const mediaNote = media.note ?? input.note;
        if (mediaNote !== undefined) {
          mediaInput.note = mediaNote;
        }
        records.push(await this.writeBytes(
          input.runDir,
          `media/${captureId}/${mediaFileName(media, index, format)}`,
          media.bytes,
          "media",
          format,
          media.mime,
          mediaInput,
          media.status ?? status
        ));
        const transcript = transcriptForMedia(media);
        if (transcript !== undefined) {
          records.push(await this.writeJson(
            input.runDir,
            `structured/${captureId}.transcripts/${mediaFileName(media, index, "json")}`,
            {
              sourceUrl: media.url,
              mime: media.mime,
              resourceType: media.resourceType,
              ...transcript
            },
            {
              ...input,
              captureId,
              sourceUrl: media.url,
              note: media.note ?? "parsed transcript from captured caption artifact",
              captureMethod: input.captureMethod ?? "browser-agent-mcp-farm transcript-parse",
              toolName: input.toolName ?? "farm_capture"
            },
            media.status ?? status
          ));
        }
      }
    }

    await appendJsonl(join(input.runDir, "artifacts.jsonl"), records);
    await appendJsonl(join(input.runDir, "manifest.jsonl"), [
      {
        event: "capture_bundle_registered",
        type: "artifact",
        source_url: input.sourceUrl,
        method: input.captureMethod ?? "browser-agent-mcp-farm capture",
        artifact: captureId,
        status,
        count: records.length,
        note: input.note
      }
    ]);

    return records;
  }

  async recordFailure(input: Omit<CaptureBundleInput, "html" | "text" | "screenshot" | "networkEvents" | "consoleEvents" | "mediaArtifacts" | "mediaIndex"> & { error: string }): Promise<ArtifactRecord[]> {
    return this.writeCaptureBundle({
      ...input,
      status: input.status ?? "error",
      metadata: {
        ...input.metadata,
        error: input.error
      },
      note: input.note ?? input.error
    });
  }

  private async writeJson(
    runDir: string,
    relPath: string,
    value: unknown,
    input: CaptureBundleInput,
    status: ArtifactStatus
  ): Promise<ArtifactRecord> {
    return this.writeText(runDir, relPath, `${JSON.stringify(value, null, 2)}\n`, "structured", "json", "application/json", input, status);
  }

  private async writeJsonl(
    runDir: string,
    relPath: string,
    rows: unknown[],
    input: CaptureBundleInput,
    status: ArtifactStatus,
    note: string
  ): Promise<ArtifactRecord> {
    const text = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "");
    return this.writeText(runDir, relPath, text, "structured", "jsonl", "application/jsonl", { ...input, note }, status);
  }

  private async writeText(
    runDir: string,
    relPath: string,
    text: string,
    kind: ArtifactKind,
    format: string,
    mime: string,
    input: CaptureBundleInput,
    status: ArtifactStatus
  ): Promise<ArtifactRecord> {
    return this.writeBytes(runDir, relPath, Buffer.from(text, "utf8"), kind, format, mime, input, status);
  }

  private async writeBytes(
    runDir: string,
    relPath: string,
    bytes: Uint8Array,
    kind: ArtifactKind,
    format: string,
    mime: string,
    input: CaptureBundleInput,
    status: ArtifactStatus
  ): Promise<ArtifactRecord> {
    const path = resolveInside(runDir, relPath);
    await atomicWrite(path, bytes);
    const record: ArtifactRecord = {
      artifact_id: `${input.captureId ?? "capture"}-${format}-${randomUUID()}`,
      path: normalizeRel(runDir, path),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      kind,
      format,
      mime,
      source_url: input.sourceUrl,
      capture_method: input.captureMethod ?? "browser-agent-mcp-farm capture",
      role: "evidence",
      status,
      backend: "playwright-mcp",
      tool_name: input.toolName ?? "farm_capture",
      session_ref: input.contextToken
    };
    const evidenceKind = input.evidenceKind ?? inferEvidenceKind(kind, relPath, input);
    if (evidenceKind !== undefined) {
      record.evidence_kind = evidenceKind;
    }
    if (input.note !== undefined) {
      record.note = input.note;
    }
    return record;
  }
}

function inferEvidenceKind(kind: ArtifactKind, relPath: string, input: CaptureBundleInput): EvidenceKind | undefined {
  if (relPath.includes(".transcripts/")) {
    return "transcript_cue";
  }
  if (relPath.includes(".ocr/")) {
    return "ocr_text";
  }
  if (relPath.includes(".api-cache")) {
    return "api_cache";
  }
  if (input.captureMethod?.includes("source-strategy")) {
    return "source_strategy";
  }
  if (input.captureMethod?.includes("source-registry")) {
    return "source_registry";
  }
  if (input.captureMethod?.includes("source-navigation-execution-plan")) {
    return "source_navigation_execution_plan";
  }
  if (input.captureMethod?.includes("source-navigation-recipe-plan")) {
    return "source_navigation_recipe_plan";
  }
  if (input.captureMethod?.includes("source-navigation-calibration")) {
    return "source_navigation_calibration";
  }
  if (input.captureMethod?.includes("source-navigation-action")) {
    return "source_navigation_action";
  }
  if (input.captureMethod?.includes("source-navigation-followup")) {
    return "source_navigation_followup";
  }
  if (input.captureMethod?.includes("destination-candidate")) {
    return "destination_candidate";
  }
  if (input.captureMethod?.includes("destination-triage")) {
    return "destination_triage";
  }
  if (input.captureMethod?.includes("source-navigation")) {
    return "source_navigation_plan";
  }
  if (input.captureMethod?.includes("official-api")) {
    return "official_api_metadata";
  }
  if (input.captureMethod?.includes("obstruction")) {
    return "browser_obstruction";
  }
  if (input.captureMethod?.includes("overlay-dismissal")) {
    return "browser_overlay_dismissal";
  }
  if (kind === "screenshot" && input.toolName === "farm_sample_frames") {
    return "frame_screenshot";
  }
  if (kind === "screenshot") {
    return "page_screenshot";
  }
  if (kind === "text") {
    return "page_text";
  }
  if (kind === "html") {
    return "page_html";
  }
  if (kind === "media") {
    return "media";
  }
  if (kind === "structured" && relPath.includes(".media-index.")) {
    return "media_index";
  }
  if (kind === "structured") {
    return "metadata";
  }
  return undefined;
}

export const SANITIZED_FILE_BASE_MAX_LENGTH = 96;

export function sanitizeFileBase(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, SANITIZED_FILE_BASE_MAX_LENGTH) || `capture-${randomUUID()}`;
}

export function extensionForMedia(mime: string, url: string): string {
  const normalizedMime = mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const byMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/x-icon": "ico",
    "text/vtt": "vtt",
    "application/json": "json"
  };
  if (byMime[normalizedMime] !== undefined) {
    return byMime[normalizedMime];
  }

  const fromUrl = extname(urlPathname(url)).replace(/^\./, "").toLowerCase();
  if (/^[a-z0-9]{1,8}$/.test(fromUrl)) {
    return fromUrl;
  }

  return "bin";
}

function mediaFileName(media: MediaArtifactInput, index: number, format: string): string {
  const sourceName = media.suggestedName ?? basename(urlPathname(media.url)) ?? `media-${index + 1}`;
  const withoutExtension = sourceName.replace(/\.[a-z0-9]{1,8}$/i, "");
  const base = sanitizeFileBase(`${String(index + 1).padStart(3, "0")}-${withoutExtension || "media"}`);
  return `${base}.${format}`;
}

function transcriptForMedia(media: MediaArtifactInput): ReturnType<typeof parseWebVtt> | undefined {
  const normalizedMime = media.mime.split(";", 1)[0]?.trim().toLowerCase();
  if (normalizedMime !== "text/vtt") {
    return undefined;
  }
  const transcript = parseWebVtt(Buffer.from(media.bytes).toString("utf8"));
  return transcript.cueCount > 0 ? transcript : undefined;
}

function urlPathname(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return url.split("?", 1)[0] ?? url;
  }
}

function resolveInside(root: string, relPath: string): string {
  const rootPath = resolve(root);
  const target = resolve(rootPath, relPath);
  if (!target.startsWith(rootPath)) {
    throw new FarmError("artifact_path_escape", `Artifact path escapes run directory: ${relPath}`);
  }
  return target;
}

function normalizeRel(root: string, path: string): string {
  return relative(resolve(root), path).replaceAll("\\", "/");
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

async function appendJsonl(path: string, rows: unknown[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const text = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await appendFile(path, text, "utf8");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
