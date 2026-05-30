import { sanitizeFileBase } from "./artifact-writer.js";
import { stripBom } from "./util/text.js";
import type { SourceFamily, SourcePlatform } from "./source-strategy.js";
import type { SourceNavigationCalibrationSummary } from "./source-navigation-calibration.js";

export interface SourceNavigationCalibrationBatchTarget {
  id: string;
  url: string;
  note?: string;
  parentPlatform?: SourcePlatform;
  parentSourceFamilies?: SourceFamily[];
  variantId?: string;
  detectedPlatform?: SourcePlatform;
  detectedSourceFamily?: SourceFamily;
}

export interface SourceNavigationCalibrationBatchAttempt {
  attemptId: string;
  targetId: string;
  targetIndex: number;
  repeatIndex: number;
  url: string;
  runDirName: string;
  note?: string;
}

export interface SourceNavigationCalibrationBatchAttemptResult extends SourceNavigationCalibrationBatchAttempt {
  runDir: string;
  status: "succeeded" | "failed";
  platform?: SourcePlatform;
  sourceFamily?: SourceFamily;
  calibrationSummary?: SourceNavigationCalibrationSummary;
  calibrationArtifactPaths: string[];
  error?: string;
}

export type SourceNavigationCalibrationStoragePolicy = "ephemeral" | "storage-state" | "persistent-profile";

export interface SourceNavigationCalibrationRuntime {
  headed: boolean;
  storagePolicy: SourceNavigationCalibrationStoragePolicy;
  profileName?: string;
  browserChannel?: string;
}

export interface SourceNavigationCalibrationBatchCatalogHint {
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  url: string;
  runDirs: string[];
  runtime: SourceNavigationCalibrationRuntime;
  catalogCommand: string;
  exportCommand: string;
}

export interface SourceNavigationCalibrationBatchManifest {
  schemaVersion: "1.0";
  executionPolicy: "read_only_selector_probe_batch";
  runRoot: string;
  targetCount: number;
  repeat: number;
  concurrency?: number;
  runtime: SourceNavigationCalibrationRuntime;
  selectorHintFiles?: string[];
  attemptCount: number;
  succeededCount: number;
  failedCount: number;
  attempts: SourceNavigationCalibrationBatchAttemptResult[];
  catalogHints: SourceNavigationCalibrationBatchCatalogHint[];
  warnings: string[];
}

export interface RunSourceNavigationCalibrationBatchAttemptsInput {
  attempts: SourceNavigationCalibrationBatchAttempt[];
  concurrency?: number | undefined;
  stopOnError?: boolean | undefined;
  runAttempt: (attempt: SourceNavigationCalibrationBatchAttempt) => Promise<SourceNavigationCalibrationBatchAttemptResult>;
  onProgress?: (results: SourceNavigationCalibrationBatchAttemptResult[]) => Promise<void> | void;
}

type JsonTarget =
  | string
  | {
      id?: unknown;
      url?: unknown;
      note?: unknown;
    };

export function parseSourceNavigationCalibrationBatchTargets(text: string): SourceNavigationCalibrationBatchTarget[] {
  const trimmed = stripBom(text).trim();
  if (trimmed.length === 0) {
    throw new Error("Calibration batch target file is empty.");
  }
  const targets = trimmed.startsWith("[") || trimmed.startsWith("{") ? parseJsonTargets(trimmed) : parseLineTargets(trimmed);
  if (targets.length === 0) {
    throw new Error("Calibration batch target file did not contain any targets.");
  }
  return dedupeTargetIds(targets);
}

export function parseSourceNavigationCalibrationBatchManifest(text: string): SourceNavigationCalibrationBatchManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch (error) {
    throw new Error(`Invalid calibration batch manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isSourceNavigationCalibrationBatchManifest(parsed)) {
    throw new Error("Calibration batch manifest must be a read-only source navigation calibration batch object.");
  }
  return parsed;
}

export function expandSourceNavigationCalibrationBatchAttempts(input: { targets: SourceNavigationCalibrationBatchTarget[]; repeat?: number | undefined }): SourceNavigationCalibrationBatchAttempt[] {
  const repeat = normalizeRepeat(input.repeat ?? 1);
  const attempts: SourceNavigationCalibrationBatchAttempt[] = [];
  for (const [targetIndex, target] of input.targets.entries()) {
    for (let repeatIndex = 1; repeatIndex <= repeat; repeatIndex += 1) {
      const attemptId = repeat === 1 ? target.id : `${target.id}-r${repeatIndex}`;
      attempts.push({
        attemptId,
        targetId: target.id,
        targetIndex: targetIndex + 1,
        repeatIndex,
        url: target.url,
        runDirName: sourceNavigationCalibrationBatchRunDirName(attemptId, target.url),
        ...(target.note === undefined ? {} : { note: target.note })
      });
    }
  }
  return attempts;
}

export function sourceNavigationCalibrationBatchRunDirName(attemptId: string, url: string): string {
  const host = new URL(url).hostname;
  return sanitizeFileBase(`${attemptId}-${host}`);
}

export function buildSourceNavigationCalibrationBatchManifest(input: {
  runRoot: string;
  targets: SourceNavigationCalibrationBatchTarget[];
  repeat?: number | undefined;
  concurrency?: number | undefined;
  attempts: SourceNavigationCalibrationBatchAttemptResult[];
  runtime?: SourceNavigationCalibrationRuntime | undefined;
  selectorHintFiles?: string[] | undefined;
}): SourceNavigationCalibrationBatchManifest {
  const repeat = normalizeRepeat(input.repeat ?? 1);
  const concurrency = normalizeSourceNavigationCalibrationBatchConcurrency(input.concurrency);
  const runtime = normalizeRuntime(input.runtime);
  const selectorHintFiles = normalizeSelectorHintFiles(input.selectorHintFiles);
  const catalogHints = catalogHintsFor(input.attempts, runtime);
  return {
    schemaVersion: "1.0",
    executionPolicy: "read_only_selector_probe_batch",
    runRoot: input.runRoot,
    targetCount: input.targets.length,
    repeat,
    concurrency,
    runtime,
    ...(selectorHintFiles.length === 0 ? {} : { selectorHintFiles }),
    attemptCount: input.attempts.length,
    succeededCount: input.attempts.filter((attempt) => attempt.status === "succeeded").length,
    failedCount: input.attempts.filter((attempt) => attempt.status === "failed").length,
    attempts: input.attempts,
    catalogHints,
    warnings: [
      "Batch calibration is read-only selector probing; it does not execute recipe actions.",
      "Use catalog hints only after reviewing the captured evidence and skipped/failed attempts.",
      ...(concurrency > 1 ? ["Batch calibration used bounded concurrency; keep profile-heavy or fragile platforms at concurrency 1 unless the targets were reviewed as safe read-only surfaces."] : []),
      ...(selectorHintFiles.length === 0 ? [] : ["Selector hint files were loaded only as manual read-only calibration candidates, not as maintained recipes."]),
      "Repeated stable selectors still require explicit opt-in recipe execution."
    ]
  };
}

export async function runSourceNavigationCalibrationBatchAttempts(input: RunSourceNavigationCalibrationBatchAttemptsInput): Promise<SourceNavigationCalibrationBatchAttemptResult[]> {
  const concurrency = normalizeSourceNavigationCalibrationBatchConcurrency(input.concurrency);
  const results: SourceNavigationCalibrationBatchAttemptResult[] = [];
  for (let offset = 0; offset < input.attempts.length; offset += concurrency) {
    const batch = input.attempts.slice(offset, offset + concurrency);
    const batchResults = await Promise.all(batch.map((attempt) => input.runAttempt(attempt)));
    results.push(...batchResults);
    await input.onProgress?.([...results]);
    if (input.stopOnError === true) {
      const failed = batchResults.find((result) => result.status === "failed");
      if (failed !== undefined) {
        throw new Error(`Calibration batch stopped after failed attempt ${failed.attemptId}: ${failed.error ?? "unknown error"}`);
      }
    }
  }
  return results;
}

function parseJsonTargets(text: string): SourceNavigationCalibrationBatchTarget[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid calibration batch target JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const maybeWrapped = parsed as { targets?: unknown };
  const rawTargets = Array.isArray(parsed) ? parsed : Array.isArray(maybeWrapped.targets) ? maybeWrapped.targets : undefined;
  if (rawTargets === undefined) {
    throw new Error("Calibration batch JSON must be an array or an object with a targets array.");
  }
  return rawTargets.map((target, index) => normalizeJsonTarget(target as JsonTarget, index));
}

function parseLineTargets(text: string): SourceNavigationCalibrationBatchTarget[] {
  const targets: SourceNavigationCalibrationBatchTarget[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const index = targets.length;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      targets.push(normalizeTarget({ id: defaultTargetId(index), url: trimmed }));
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      throw new Error(`Invalid calibration target line: ${trimmed}`);
    }
    const id = parts[0];
    const url = parts[1];
    if (id === undefined || url === undefined) {
      throw new Error(`Invalid calibration target line: ${trimmed}`);
    }
    targets.push(normalizeTarget({ id, url }));
  }
  return targets;
}

function normalizeJsonTarget(target: JsonTarget, index: number): SourceNavigationCalibrationBatchTarget {
  if (typeof target === "string") {
    return normalizeTarget({ id: defaultTargetId(index), url: target });
  }
  if (typeof target !== "object" || target === null || typeof target.url !== "string") {
    throw new Error(`Calibration batch target ${index + 1} must include a url string.`);
  }
  return normalizeTarget({
    id: typeof target.id === "string" && target.id.trim().length > 0 ? target.id : defaultTargetId(index),
    url: target.url,
    ...(typeof target.note === "string" && target.note.trim().length > 0 ? { note: target.note } : {})
  });
}

function normalizeTarget(input: { id: string; url: string; note?: string | undefined }): SourceNavigationCalibrationBatchTarget {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error(`Invalid calibration target URL: ${input.url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Calibration target URL must be http or https: ${input.url}`);
  }
  const id = sanitizeFileBase(input.id.trim());
  if (id.length === 0) {
    throw new Error(`Calibration target ID is empty for ${input.url}`);
  }
  return {
    id,
    url: parsed.toString(),
    ...(input.note === undefined ? {} : { note: input.note })
  };
}

function dedupeTargetIds(targets: SourceNavigationCalibrationBatchTarget[]): SourceNavigationCalibrationBatchTarget[] {
  const seen = new Map<string, number>();
  return targets.map((target) => {
    const count = (seen.get(target.id) ?? 0) + 1;
    seen.set(target.id, count);
    if (count === 1) {
      return target;
    }
    return {
      ...target,
      id: `${target.id}-${count}`
    };
  });
}

function catalogHintsFor(attempts: SourceNavigationCalibrationBatchAttemptResult[], runtime: SourceNavigationCalibrationRuntime): SourceNavigationCalibrationBatchCatalogHint[] {
  const groups = new Map<string, SourceNavigationCalibrationBatchAttemptResult[]>();
  for (const attempt of attempts) {
    if (attempt.status !== "succeeded" || attempt.platform === undefined || attempt.sourceFamily === undefined) {
      continue;
    }
    const key = `${attempt.platform}:${attempt.sourceFamily}`;
    const group = groups.get(key) ?? [];
    group.push(attempt);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    if (first === undefined || first.platform === undefined || first.sourceFamily === undefined) {
      throw new Error("Invalid empty catalog hint group.");
    }
    const runDirs = group.map((attempt) => attempt.runDir);
    const runDirsArg = runDirs.join(",");
    return {
      platform: first.platform,
      sourceFamily: first.sourceFamily,
      url: first.url,
      runDirs,
      runtime,
      catalogCommand: `node .\\dist\\cli.js source-navigation-catalog --url ${first.url} --calibration-run-dirs ${runDirsArg}`,
      exportCommand: `node .\\dist\\cli.js source-navigation-export-recipes --url ${first.url} --calibration-run-dirs ${runDirsArg}`
    };
  });
}

function normalizeRuntime(runtime: SourceNavigationCalibrationRuntime | undefined): SourceNavigationCalibrationRuntime {
  if (runtime === undefined) {
    return {
      headed: false,
      storagePolicy: "ephemeral"
    };
  }
  return {
    headed: runtime.headed,
    storagePolicy: runtime.profileName === undefined ? "ephemeral" : runtime.storagePolicy,
    ...(runtime.profileName === undefined ? {} : { profileName: runtime.profileName }),
    ...(runtime.browserChannel === undefined ? {} : { browserChannel: runtime.browserChannel })
  };
}

function normalizeSelectorHintFiles(files: string[] | undefined): string[] {
  if (files === undefined) {
    return [];
  }
  return [...new Set(files.map((file) => file.trim()).filter((file) => file.length > 0))];
}

function isSourceNavigationCalibrationBatchManifest(value: unknown): value is SourceNavigationCalibrationBatchManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const manifest = value as {
    schemaVersion?: unknown;
    executionPolicy?: unknown;
    runRoot?: unknown;
    attempts?: unknown;
    catalogHints?: unknown;
  };
  return manifest.schemaVersion === "1.0" && manifest.executionPolicy === "read_only_selector_probe_batch" && typeof manifest.runRoot === "string" && Array.isArray(manifest.attempts) && Array.isArray(manifest.catalogHints);
}

function normalizeRepeat(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error("Calibration batch repeat must be an integer between 1 and 20.");
  }
  return value;
}

export function normalizeSourceNavigationCalibrationBatchConcurrency(value: number | undefined): number {
  const normalized = value ?? 1;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 5) {
    throw new Error("Calibration batch concurrency must be an integer between 1 and 5.");
  }
  return normalized;
}

function defaultTargetId(index: number): string {
  return `target-${String(index + 1).padStart(3, "0")}`;
}
