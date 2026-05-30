import { readdir, readFile } from "node:fs/promises";
import { uniqueNonEmpty as uniqueStrings } from "./util/collections.js";
import { stripBom } from "./util/text.js";
import type { Dirent } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { SourceNavigationCalibrationReport } from "./source-navigation-calibration.js";

export type SourceNavigationCalibrationReportSourceKind =
  | "file"
  | "batch_manifest"
  | "run_dir_manifest"
  | "run_dir_fallback";

export interface SourceNavigationCalibrationReportSource {
  input: string;
  kind: SourceNavigationCalibrationReportSourceKind;
  path: string;
}

export interface SourceNavigationCalibrationReportLoadResult {
  reports: SourceNavigationCalibrationReport[];
  sources: SourceNavigationCalibrationReportSource[];
  warnings: string[];
}

interface ArtifactLedgerRecord {
  path?: unknown;
  kind?: unknown;
  format?: unknown;
  tool_name?: unknown;
  evidence_kind?: unknown;
}

interface BatchManifestAttemptRecord {
  attemptId?: unknown;
  runDir?: unknown;
  status?: unknown;
  error?: unknown;
}

interface BatchManifestRecord {
  schemaVersion?: unknown;
  executionPolicy?: unknown;
  attempts?: unknown;
}

export async function loadSourceNavigationCalibrationReports(input: {
  files?: string[] | undefined;
  runDirs?: string[] | undefined;
  batchManifests?: string[] | undefined;
}): Promise<SourceNavigationCalibrationReportLoadResult> {
  const files = uniqueStrings(input.files ?? []);
  const runDirs = uniqueStrings(input.runDirs ?? []);
  const batchManifests = uniqueStrings(input.batchManifests ?? []);
  const result: SourceNavigationCalibrationReportLoadResult = {
    reports: [],
    sources: [],
    warnings: []
  };

  for (const file of files) {
    result.reports.push(parseSourceNavigationCalibrationReport(await readFile(file, "utf8")));
    result.sources.push({ input: file, kind: "file", path: resolve(file) });
  }

  const runDirsFromBatchManifests: string[] = [];
  for (const batchManifest of batchManifests) {
    const loadedRunDirs = await runDirsFromBatchManifest(batchManifest, result.warnings);
    result.sources.push({ input: batchManifest, kind: "batch_manifest", path: resolve(batchManifest) });
    runDirsFromBatchManifests.push(...loadedRunDirs);
  }

  for (const runDir of uniqueStrings([...runDirs, ...runDirsFromBatchManifests])) {
    const loaded = await loadCalibrationReportsFromRunDir(runDir);
    result.reports.push(...loaded.reports);
    result.sources.push(...loaded.sources);
    result.warnings.push(...loaded.warnings);
  }

  if (files.length + runDirs.length + batchManifests.length > 0 && result.reports.length === 0) {
    throw new Error("No source navigation calibration reports were found in the supplied inputs.");
  }

  return result;
}

export function parseSourceNavigationCalibrationReport(text: string): SourceNavigationCalibrationReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch (error) {
    throw new Error(`Invalid calibration report JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const maybeWrapped = parsed as { sourceNavigationCalibration?: unknown };
  const report = maybeWrapped.sourceNavigationCalibration ?? parsed;
  if (!isSourceNavigationCalibrationReport(report)) {
    throw new Error("Calibration report must be a source_navigation_calibration JSON object");
  }
  return report;
}

async function runDirsFromBatchManifest(path: string, warnings: string[]): Promise<string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(await readFile(path, "utf8")));
  } catch (error) {
    throw new Error(`Invalid calibration batch manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isCalibrationBatchManifest(parsed)) {
    throw new Error("Calibration batch manifest must be a source_navigation read-only calibration batch JSON object.");
  }
  const runDirs: string[] = [];
  for (const [index, attempt] of parsed.attempts.entries()) {
    if (attempt.status === "failed") {
      const label = typeof attempt.attemptId === "string" ? attempt.attemptId : `attempt ${index + 1}`;
      const error = typeof attempt.error === "string" ? `: ${attempt.error}` : "";
      warnings.push(`Skipped failed calibration batch attempt ${label}${error}`);
      continue;
    }
    if (attempt.status !== "succeeded") {
      const label = typeof attempt.attemptId === "string" ? attempt.attemptId : `attempt ${index + 1}`;
      warnings.push(`Skipped calibration batch attempt ${label} with status ${String(attempt.status)}`);
      continue;
    }
    if (typeof attempt.runDir !== "string" || attempt.runDir.trim().length === 0) {
      const label = typeof attempt.attemptId === "string" ? attempt.attemptId : `attempt ${index + 1}`;
      warnings.push(`Skipped calibration batch attempt ${label} because runDir is missing.`);
      continue;
    }
    runDirs.push(resolve(attempt.runDir));
  }
  return uniqueStrings(runDirs);
}

function isCalibrationBatchManifest(value: unknown): value is { attempts: BatchManifestAttemptRecord[] } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as BatchManifestRecord;
  return record.schemaVersion === "1.0"
    && record.executionPolicy === "read_only_selector_probe_batch"
    && Array.isArray(record.attempts);
}

async function loadCalibrationReportsFromRunDir(runDir: string): Promise<SourceNavigationCalibrationReportLoadResult> {
  const resolvedRunDir = resolve(runDir);
  const result: SourceNavigationCalibrationReportLoadResult = {
    reports: [],
    sources: [],
    warnings: []
  };
  const manifestPath = join(resolvedRunDir, "artifacts.jsonl");
  const manifestCandidates = await candidateArtifactPathsFromManifest(resolvedRunDir, manifestPath, result.warnings);
  const paths = manifestCandidates.length > 0
    ? manifestCandidates
    : await fallbackCalibrationPaths(resolvedRunDir, result.warnings);

  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    try {
      result.reports.push(parseSourceNavigationCalibrationReport(await readFile(path, "utf8")));
      result.sources.push({
        input: runDir,
        kind: manifestCandidates.length > 0 ? "run_dir_manifest" : "run_dir_fallback",
        path
      });
    } catch (error) {
      result.warnings.push(`Skipped invalid calibration artifact ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (result.reports.length === 0) {
    result.warnings.push(`No source_navigation_calibration artifacts were found under ${resolvedRunDir}.`);
  }
  return result;
}

async function candidateArtifactPathsFromManifest(
  runDir: string,
  manifestPath: string,
  warnings: string[]
): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch (error) {
    warnings.push(`Could not read ${manifestPath}; falling back to raw/structured artifact discovery.`);
    return [];
  }

  const rawTextPaths: string[] = [];
  const structuredPaths: string[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    let parsed: ArtifactLedgerRecord;
    try {
      parsed = JSON.parse(line) as ArtifactLedgerRecord;
    } catch (error) {
      warnings.push(`Skipped invalid artifacts.jsonl line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!isCalibrationArtifactRecord(parsed) || typeof parsed.path !== "string") {
      continue;
    }
    let resolvedPath: string;
    try {
      resolvedPath = resolveInside(runDir, parsed.path);
    } catch (error) {
      warnings.push(`Skipped calibration artifact outside run dir: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (parsed.kind === "text" || parsed.format === "txt" || parsed.path.toLowerCase().endsWith(".txt")) {
      rawTextPaths.push(resolvedPath);
      continue;
    }
    if (parsed.kind === "structured" || parsed.format === "json" || parsed.path.toLowerCase().endsWith(".json")) {
      structuredPaths.push(resolvedPath);
    }
  }
  return rawTextPaths.length > 0 ? uniqueStrings(rawTextPaths) : uniqueStrings(structuredPaths);
}

function isCalibrationArtifactRecord(record: ArtifactLedgerRecord): boolean {
  return record.evidence_kind === "source_navigation_calibration" || record.tool_name === "source_navigation_calibration";
}

async function fallbackCalibrationPaths(runDir: string, warnings: string[]): Promise<string[]> {
  const roots = [join(runDir, "raw"), join(runDir, "structured")];
  const paths: string[] = [];
  for (const root of roots) {
    paths.push(...await findCalibrationFiles(root, warnings, 0));
  }
  const rawPaths = paths.filter((path) => path.toLowerCase().endsWith(".txt"));
  return rawPaths.length > 0 ? uniqueStrings(rawPaths) : uniqueStrings(paths);
}

async function findCalibrationFiles(dir: string, warnings: string[], depth: number): Promise<string[]> {
  if (depth > 4) {
    return [];
  }
  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await findCalibrationFiles(path, warnings, depth + 1));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name.toLowerCase();
    if (name.includes("source-navigation-calibration") && (name.endsWith(".txt") || name.endsWith(".json"))) {
      paths.push(path);
    }
  }
  return paths;
}

function isSourceNavigationCalibrationReport(value: unknown): value is SourceNavigationCalibrationReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const report = value as {
    schemaVersion?: unknown;
    executionPolicy?: unknown;
    actionCalibrations?: unknown;
    summary?: unknown;
  };
  return report.schemaVersion === "1.0"
    && report.executionPolicy === "read_only_selector_probe"
    && Array.isArray(report.actionCalibrations)
    && typeof report.summary === "object"
    && report.summary !== null;
}

function resolveInside(root: string, relPath: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, relPath);
  const rootForCompare = resolvedRoot.toLowerCase();
  const pathForCompare = resolvedPath.toLowerCase();
  if (pathForCompare !== rootForCompare && !pathForCompare.startsWith(`${rootForCompare}${sep}`)) {
    throw new Error(relPath);
  }
  return resolvedPath;
}
