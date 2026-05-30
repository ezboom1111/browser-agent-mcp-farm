import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sanitizeFileBase } from "./artifact-writer.js";
import type { SourceNavigationCalibrationBatchManifest, SourceNavigationCalibrationRuntime } from "./source-navigation-calibration-batch.js";
import { loadSourceNavigationCalibrationReports } from "./source-navigation-calibration-loader.js";
import type { SourceNavigationClientStateProbeCatalogSummary, SourceNavigationDestinationDiscoveryCatalogSummary } from "./source-navigation-recipe-catalog.js";
import { describeSourceNavigationPlan } from "./source-navigation.js";
import { buildSourceNavigationRecipeCatalog, exportMaintainedSourceNavigationRecipes, formatSourceNavigationDestinationSelectorHintsAsLines, type SourceNavigationMaintainedRecipeExport, type SourceNavigationRecipeCatalog } from "./source-navigation-recipe-catalog.js";
import { describeSourceNavigationRecipePlan } from "./source-navigation-recipes.js";
import { describeSourceStrategy, type SourceFamily, type SourcePlatform } from "./source-strategy.js";

export interface SourceNavigationPromotionGroup {
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  url: string;
  runDirs: string[];
  runtime: SourceNavigationCalibrationRuntime;
  status: "ready" | "empty";
  actionCount: number;
  catalogSummary: SourceNavigationRecipeCatalog["summary"];
  destinationExtraction?: SourceNavigationDestinationExtractionPromotionSummary | undefined;
  blockedSignalCounts?: SourceNavigationBlockedSignalCount[] | undefined;
  files: {
    catalog: string;
    export: string;
    actions: string;
    selectorHints?: string;
  };
  warnings: string[];
}

export interface SourceNavigationPromotionSummary {
  schemaVersion: "1.0";
  executionPolicy: "explicit_opt_in_only";
  outputDir: string;
  groupCount: number;
  readyGroupCount: number;
  emptyGroupCount: number;
  actionFileCount: number;
  groups: SourceNavigationPromotionGroup[];
  warnings: string[];
}

export type SourceNavigationPromotionReviewStatus = "ready" | "blocked" | "needs_repeated_calibration" | "manual_review_required" | "empty";

export interface SourceNavigationPromotionEvidenceRunCommand {
  url: string;
  actionsFile: string;
  argv: string[];
  powershellCommand: string;
  sourceNavigationOptions?: SourceNavigationPromotionEvidenceRunOptions | undefined;
}

export interface SourceNavigationPromotionEvidenceRunOptions {
  maxFollowUps?: number | undefined;
  maxFollowUpsPerDomain?: number | undefined;
  followUpConcurrency?: number | undefined;
  fallbackFollowUps?: boolean | undefined;
  maxFallbackFollowUps?: number | undefined;
  maxDepth?: number | undefined;
  maxDeepeningRuns?: number | undefined;
  maxDeepeningRunsPerDomain?: number | undefined;
  deepeningConcurrency?: number | undefined;
  deepeningTimeoutMs?: number | undefined;
  maxDeepeningArtifacts?: number | undefined;
}

export interface SourceNavigationPromotionReviewOptions {
  evidenceRunOptions?: SourceNavigationPromotionEvidenceRunOptions | undefined;
}

export interface SourceNavigationDestinationExtractionPromotionSummary {
  candidateCount: number;
  readyActionCount: number;
  readyActionKeys: string[];
  maintainedReadyCount: number;
  singleRunReadyCount: number;
  calibrationRequiredCount: number;
  blockedCount: number;
  manualReviewCount: number;
  manualValueCount: number;
  discoveryRunCount: number;
  discoveryPromotableCandidateCount: number;
  discoveryNonPromotableCandidateCount: number;
  discoverySelectorHintCount: number;
  discoveryWarningCounts: Array<{ warning: string; count: number }>;
  clientStateProbeRunCount: number;
  clientStateProbeOkRunCount: number;
  clientStateProbeUniqueCandidateCount: number;
}

export interface SourceNavigationBlockedSignalCount {
  signal: string;
  count: number;
  actionKeys: string[];
}

export interface SourceNavigationPromotionGroupReview {
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  url: string;
  status: SourceNavigationPromotionReviewStatus;
  actionCount: number;
  files: SourceNavigationPromotionGroup["files"];
  catalogSummary: SourceNavigationPromotionGroup["catalogSummary"];
  destinationExtraction: SourceNavigationDestinationExtractionPromotionSummary;
  blockedSignalCounts: SourceNavigationBlockedSignalCount[];
  runtime: SourceNavigationCalibrationRuntime;
  reasons: string[];
  warnings: string[];
  evidenceRun?: SourceNavigationPromotionEvidenceRunCommand;
}

export interface SourceNavigationPromotionReadyActionFile {
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  url: string;
  actionCount: number;
  actionsFile: string;
  evidenceRun: SourceNavigationPromotionEvidenceRunCommand;
}

export interface SourceNavigationPromotionReview {
  schemaVersion: "1.0";
  executionPolicy: "explicit_opt_in_only";
  promotionOutputDir: string;
  groupCount: number;
  readyGroupCount: number;
  blockedGroupCount: number;
  needsRepeatedCalibrationGroupCount: number;
  manualReviewRequiredGroupCount: number;
  emptyGroupCount: number;
  readyActionFileCount: number;
  readyActionFiles: SourceNavigationPromotionReadyActionFile[];
  groups: SourceNavigationPromotionGroupReview[];
  evidenceRunOptions?: SourceNavigationPromotionEvidenceRunOptions | undefined;
  warnings: string[];
}

export async function promoteSourceNavigationCalibrationBatch(input: { manifest: SourceNavigationCalibrationBatchManifest; outputDir: string }): Promise<SourceNavigationPromotionSummary> {
  const outputDir = resolve(input.outputDir);
  await mkdir(outputDir, { recursive: true });
  const groups: SourceNavigationPromotionGroup[] = [];
  const warnings: string[] = ["Promotion writes explicit action files only; it does not execute browser actions.", "Review catalog/export files before passing generated actions into evidence-run."];

  for (const hint of input.manifest.catalogHints) {
    const groupDir = join(outputDir, sanitizeFileBase(`${hint.platform}-${hint.sourceFamily}`));
    await mkdir(groupDir, { recursive: true });
    const sourceStrategy = describeSourceStrategy(hint.url);
    const sourceNavigationPlan = describeSourceNavigationPlan({ sourceStrategy });
    const recipePlan = describeSourceNavigationRecipePlan(sourceNavigationPlan);
    const calibrationInputs = await loadSourceNavigationCalibrationReports({ runDirs: hint.runDirs });
    const catalog = buildSourceNavigationRecipeCatalog({
      recipePlan,
      calibrationReports: calibrationInputs.reports
    });
    const exportBundle = exportMaintainedSourceNavigationRecipes(catalog);
    const catalogPath = join(groupDir, "catalog.json");
    const exportPath = join(groupDir, "export.json");
    const actionsPath = join(groupDir, "actions.json");
    const selectorHintsPath = join(groupDir, "selector-hints.tsv");
    await writeJson(catalogPath, catalog);
    await writeJson(exportPath, exportBundle);
    await writeJson(actionsPath, exportBundle.actions);
    await writeTextFile(selectorHintsPath, formatSourceNavigationDestinationSelectorHintsAsLines(catalog));
    groups.push({
      platform: hint.platform,
      sourceFamily: hint.sourceFamily,
      url: hint.url,
      runDirs: hint.runDirs.map((runDir) => resolve(runDir)),
      runtime: normalizeRuntime(hint.runtime ?? input.manifest.runtime),
      status: exportBundle.status,
      actionCount: exportBundle.actionCount,
      catalogSummary: catalog.summary,
      destinationExtraction: summarizeDestinationExtraction(catalog, exportBundle),
      blockedSignalCounts: summarizeBlockedSignals(catalog),
      files: {
        catalog: catalogPath,
        export: exportPath,
        actions: actionsPath,
        selectorHints: selectorHintsPath
      },
      warnings: [...calibrationInputs.warnings, ...catalog.warnings, ...exportBundle.warnings]
    });
  }

  return {
    schemaVersion: "1.0",
    executionPolicy: "explicit_opt_in_only",
    outputDir,
    groupCount: groups.length,
    readyGroupCount: groups.filter((group) => group.status === "ready").length,
    emptyGroupCount: groups.filter((group) => group.status === "empty").length,
    actionFileCount: groups.length,
    groups,
    warnings
  };
}

export function reviewSourceNavigationPromotion(summary: SourceNavigationPromotionSummary, options: SourceNavigationPromotionReviewOptions = {}): SourceNavigationPromotionReview {
  const evidenceRunOptions = normalizeEvidenceRunOptions(options.evidenceRunOptions);
  const groups = summary.groups.map((group) => reviewPromotionGroup(group, evidenceRunOptions));
  const readyActionFiles = groups
    .filter((group): group is SourceNavigationPromotionGroupReview & { evidenceRun: SourceNavigationPromotionEvidenceRunCommand } => group.evidenceRun !== undefined)
    .map((group) => ({
      platform: group.platform,
      sourceFamily: group.sourceFamily,
      url: group.url,
      actionCount: group.actionCount,
      actionsFile: group.files.actions,
      evidenceRun: group.evidenceRun
    }));
  return {
    schemaVersion: "1.0",
    executionPolicy: "explicit_opt_in_only",
    promotionOutputDir: summary.outputDir,
    groupCount: groups.length,
    readyGroupCount: groups.filter((group) => group.status === "ready").length,
    blockedGroupCount: groups.filter((group) => group.status === "blocked").length,
    needsRepeatedCalibrationGroupCount: groups.filter((group) => group.status === "needs_repeated_calibration").length,
    manualReviewRequiredGroupCount: groups.filter((group) => group.status === "manual_review_required").length,
    emptyGroupCount: groups.filter((group) => group.status === "empty").length,
    readyActionFileCount: readyActionFiles.length,
    readyActionFiles,
    groups,
    ...(hasEvidenceRunOptions(evidenceRunOptions) ? { evidenceRunOptions } : {}),
    warnings: [...summary.warnings, "Run the generated evidence-run commands only after reviewing the matching catalog/export files.", ...(readyActionFiles.length === 0 ? ["No ready action files were found in this promotion summary."] : [])]
  };
}

export function parseSourceNavigationPromotionSummary(input: string): SourceNavigationPromotionSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonBom(input));
  } catch (error) {
    throw new Error(`Invalid source navigation promotion summary JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== "1.0" || parsed.executionPolicy !== "explicit_opt_in_only") {
    throw new Error("Promotion summary must be a source-navigation promotion summary with schemaVersion 1.0");
  }
  const groupsValue = parsed.groups;
  if (!Array.isArray(groupsValue)) {
    throw new Error("Promotion summary groups must be an array");
  }
  const groups = groupsValue.map(parsePromotionGroup);
  return {
    schemaVersion: "1.0",
    executionPolicy: "explicit_opt_in_only",
    outputDir: stringField(parsed, "outputDir"),
    groupCount: numberField(parsed, "groupCount"),
    readyGroupCount: numberField(parsed, "readyGroupCount"),
    emptyGroupCount: numberField(parsed, "emptyGroupCount"),
    actionFileCount: numberField(parsed, "actionFileCount"),
    groups,
    warnings: stringArrayField(parsed, "warnings")
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeTextFile(path: string, value: string): Promise<void> {
  await writeFile(path, value, "utf8");
}

function stripJsonBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

function reviewPromotionGroup(group: SourceNavigationPromotionGroup, evidenceRunOptions: SourceNavigationPromotionEvidenceRunOptions): SourceNavigationPromotionGroupReview {
  const runtime = normalizeRuntime(group.runtime);
  const status = classifyPromotionGroup(group);
  const reasons = reasonsForPromotionGroup(group, status);
  const evidenceRun = status === "ready" ? buildEvidenceRunCommand(group.url, group.files.actions, runtime, evidenceRunOptions) : undefined;
  const destinationExtraction = group.destinationExtraction ?? emptyDestinationExtractionSummary();
  const blockedSignalCounts = group.blockedSignalCounts ?? [];
  return {
    platform: group.platform,
    sourceFamily: group.sourceFamily,
    url: group.url,
    status,
    actionCount: group.actionCount,
    files: group.files,
    catalogSummary: group.catalogSummary,
    destinationExtraction,
    blockedSignalCounts,
    runtime,
    reasons,
    warnings: group.warnings,
    ...(evidenceRun === undefined ? {} : { evidenceRun })
  };
}

function classifyPromotionGroup(group: SourceNavigationPromotionGroup): SourceNavigationPromotionReviewStatus {
  if (group.catalogSummary.blockedCount > 0) {
    return "blocked";
  }
  if (group.status === "ready" && group.actionCount > 0) {
    return "ready";
  }
  if (group.catalogSummary.calibrationReportCount < group.catalogSummary.minimumCalibrationRunsRequired || group.catalogSummary.singleRunReadyCount > 0 || group.catalogSummary.calibrationRequiredCount > 0) {
    return "needs_repeated_calibration";
  }
  if (group.catalogSummary.manualReviewCount > 0 || group.catalogSummary.manualValueCount > 0) {
    return "manual_review_required";
  }
  return "empty";
}

function reasonsForPromotionGroup(group: SourceNavigationPromotionGroup, status: SourceNavigationPromotionReviewStatus): string[] {
  if (status === "ready") {
    return [`${group.actionCount} maintained read-only action(s) are ready for explicit evidence-run execution.`, "Review catalog.json and export.json before using the generated actions.json file."];
  }
  const reasons: string[] = ["No maintained read-only action file is ready for this group."];
  if (status === "blocked") {
    reasons.push(`${group.catalogSummary.blockedCount} catalog entr${group.catalogSummary.blockedCount === 1 ? "y" : "ies"} saw blocked browser-visible signals during calibration.`);
    if ((group.blockedSignalCounts ?? []).length > 0) {
      reasons.push(`Blocked signal pressure: ${formatBlockedSignalCounts(group.blockedSignalCounts ?? [])}.`);
    }
  }
  if (status === "needs_repeated_calibration") {
    reasons.push(`Calibration reports: ${group.catalogSummary.calibrationReportCount}/${group.catalogSummary.minimumCalibrationRunsRequired} minimum required for maintained recipe promotion.`);
    if (group.catalogSummary.singleRunReadyCount > 0) {
      reasons.push(`${group.catalogSummary.singleRunReadyCount} action(s) are only single-run-ready and need repeated stable calibration before maintained export.`);
    }
    if (group.catalogSummary.calibrationRequiredCount > 0) {
      reasons.push(`${group.catalogSummary.calibrationRequiredCount} action(s) still require browser-visible calibration evidence.`);
    }
    if ((group.destinationExtraction?.discoveryPromotableCandidateCount ?? 0) > 0) {
      const hintCount = group.destinationExtraction?.discoverySelectorHintCount ?? 0;
      reasons.push(`Global destination discovery found ${group.destinationExtraction?.discoveryPromotableCandidateCount ?? 0} promotable destination target(s) and ${hintCount} selector hint(s), but no maintained extract_destinations action is ready; add or promote narrower selectors from catalog sample targets.`);
    } else if ((group.destinationExtraction?.discoveryNonPromotableCandidateCount ?? 0) > 0) {
      reasons.push(`Global destination discovery found only non-promotable destination target(s); inspect discovery warning counts before adding selectors.`);
    }
  }
  if (status === "manual_review_required") {
    reasons.push("Remaining visible actions require human review or user-supplied values and are intentionally excluded from maintained export.");
  }
  return reasons;
}

function summarizeBlockedSignals(catalog: SourceNavigationRecipeCatalog): SourceNavigationBlockedSignalCount[] {
  const grouped = new Map<string, { count: number; actionKeys: Set<string> }>();
  for (const entry of catalog.entries) {
    for (const signal of entry.blockedSignals) {
      if (signal.status !== "present") {
        continue;
      }
      const existing = grouped.get(signal.signal) ?? { count: 0, actionKeys: new Set<string>() };
      existing.count += 1;
      existing.actionKeys.add(signal.actionKey);
      grouped.set(signal.signal, existing);
    }
  }
  return [...grouped.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .map(([signal, summary]) => ({
      signal,
      count: summary.count,
      actionKeys: [...summary.actionKeys].sort()
    }));
}

function formatBlockedSignalCounts(counts: SourceNavigationBlockedSignalCount[]): string {
  return counts
    .slice(0, 8)
    .map((entry) => `${entry.signal}:${entry.count}${entry.actionKeys.length === 0 ? "" : ` (${entry.actionKeys.join(",")})`}`)
    .join(", ");
}

function summarizeDestinationExtraction(catalog: SourceNavigationRecipeCatalog, exportBundle: SourceNavigationMaintainedRecipeExport): SourceNavigationDestinationExtractionPromotionSummary {
  const destinationEntries = catalog.entries.filter((entry) => isDestinationExtractionOperation(entry.operation));
  const readyActions = exportBundle.actions.filter((action) => isDestinationExtractionOperation(action.operation));
  const discovery = summarizeDestinationDiscovery(destinationEntries.map((entry) => entry.destinationDiscovery).filter((entry): entry is SourceNavigationDestinationDiscoveryCatalogSummary => entry !== undefined));
  const clientStateProbe = summarizeClientStateProbes(destinationEntries.map((entry) => entry.clientStateProbe).filter((entry): entry is SourceNavigationClientStateProbeCatalogSummary => entry !== undefined));
  return {
    candidateCount: destinationEntries.length,
    readyActionCount: readyActions.length,
    readyActionKeys: readyActions.map((action) => action.actionKey),
    maintainedReadyCount: destinationEntries.filter((entry) => entry.readiness === "maintained_recipe_ready").length,
    singleRunReadyCount: destinationEntries.filter((entry) => entry.readiness === "single_run_ready").length,
    calibrationRequiredCount: destinationEntries.filter((entry) => entry.readiness === "calibration_required").length,
    blockedCount: destinationEntries.filter((entry) => entry.readiness === "blocked_signal_detected").length,
    manualReviewCount: destinationEntries.filter((entry) => entry.readiness === "manual_review_required").length,
    manualValueCount: destinationEntries.filter((entry) => entry.readiness === "manual_value_required").length,
    discoveryRunCount: discovery.discoveryRunCount,
    discoveryPromotableCandidateCount: discovery.discoveryPromotableCandidateCount,
    discoveryNonPromotableCandidateCount: discovery.discoveryNonPromotableCandidateCount,
    discoverySelectorHintCount: discovery.discoverySelectorHintCount,
    discoveryWarningCounts: discovery.discoveryWarningCounts,
    clientStateProbeRunCount: clientStateProbe.clientStateProbeRunCount,
    clientStateProbeOkRunCount: clientStateProbe.clientStateProbeOkRunCount,
    clientStateProbeUniqueCandidateCount: clientStateProbe.clientStateProbeUniqueCandidateCount
  };
}

function isDestinationExtractionOperation(operation: SourceNavigationRecipeCatalog["entries"][number]["operation"]): boolean {
  return operation === "extract_destinations" || operation === "extract_client_state_destinations";
}

function summarizeDestinationDiscovery(
  summaries: SourceNavigationDestinationDiscoveryCatalogSummary[]
): Pick<SourceNavigationDestinationExtractionPromotionSummary, "discoveryRunCount" | "discoveryPromotableCandidateCount" | "discoveryNonPromotableCandidateCount" | "discoverySelectorHintCount" | "discoveryWarningCounts"> {
  return {
    discoveryRunCount: summaries.reduce((sum, summary) => sum + summary.runCount, 0),
    discoveryPromotableCandidateCount: summaries.reduce((sum, summary) => sum + summary.totalPromotableCandidateCount, 0),
    discoveryNonPromotableCandidateCount: summaries.reduce((sum, summary) => sum + summary.totalNonPromotableCandidateCount, 0),
    discoverySelectorHintCount: summaries.reduce((sum, summary) => sum + (summary.selectorHints?.length ?? 0), 0),
    discoveryWarningCounts: mergeWarningCounts(summaries.flatMap((summary) => summary.warningCounts))
  };
}

function summarizeClientStateProbes(summaries: SourceNavigationClientStateProbeCatalogSummary[]): Pick<SourceNavigationDestinationExtractionPromotionSummary, "clientStateProbeRunCount" | "clientStateProbeOkRunCount" | "clientStateProbeUniqueCandidateCount"> {
  return {
    clientStateProbeRunCount: summaries.reduce((sum, summary) => sum + summary.runCount, 0),
    clientStateProbeOkRunCount: summaries.reduce((sum, summary) => sum + summary.okRunCount, 0),
    clientStateProbeUniqueCandidateCount: summaries.reduce((sum, summary) => sum + summary.totalUniqueCandidateCount, 0)
  };
}

function mergeWarningCounts(warnings: Array<{ warning: string; count: number }>): Array<{ warning: string; count: number }> {
  const counts = new Map<string, number>();
  for (const warning of warnings) {
    counts.set(warning.warning, (counts.get(warning.warning) ?? 0) + warning.count);
  }
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([warning, count]) => ({ warning, count }));
}

function buildEvidenceRunCommand(url: string, actionsFile: string, runtime: SourceNavigationCalibrationRuntime, sourceNavigationOptions: SourceNavigationPromotionEvidenceRunOptions): SourceNavigationPromotionEvidenceRunCommand {
  const runtimeArgs = evidenceRunRuntimeArgs(runtime);
  const sourceNavigationArgs = evidenceRunSourceNavigationArgs(sourceNavigationOptions);
  return {
    url,
    actionsFile,
    argv: ["node", ".\\dist\\cli.js", "evidence-run", "--url", url, ...runtimeArgs, ...sourceNavigationArgs, "--source-navigation", "--source-navigation-actions-file", actionsFile],
    powershellCommand: `node .\\dist\\cli.js evidence-run --url ${quotePowerShellValue(url)}${formatRuntimeArgsForPowerShell(runtime)}${formatSourceNavigationArgsForPowerShell(sourceNavigationOptions)} --source-navigation --source-navigation-actions-file ${quotePowerShellValue(actionsFile)}`,
    ...(hasEvidenceRunOptions(sourceNavigationOptions) ? { sourceNavigationOptions } : {})
  };
}

function quotePowerShellValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function evidenceRunRuntimeArgs(runtime: SourceNavigationCalibrationRuntime): string[] {
  const args: string[] = [];
  if (runtime.headed) {
    args.push("--headed");
  }
  if (runtime.browserChannel !== undefined) {
    args.push("--browser-channel", runtime.browserChannel);
  }
  if (runtime.profileName !== undefined) {
    args.push("--profile", runtime.profileName);
    if (runtime.storagePolicy === "persistent-profile") {
      args.push("--persistent-profile");
    }
  }
  return args;
}

function formatRuntimeArgsForPowerShell(runtime: SourceNavigationCalibrationRuntime): string {
  const args = evidenceRunRuntimeArgs(runtime);
  if (args.length === 0) {
    return "";
  }
  return ` ${args.map((arg) => (arg.startsWith("--") ? arg : quotePowerShellValue(arg))).join(" ")}`;
}

function evidenceRunSourceNavigationArgs(options: SourceNavigationPromotionEvidenceRunOptions): string[] {
  const args: string[] = [];
  pushNumberArg(args, "--source-navigation-max-followups", options.maxFollowUps);
  pushNumberArg(args, "--source-navigation-max-followups-per-domain", options.maxFollowUpsPerDomain);
  pushNumberArg(args, "--source-navigation-followup-concurrency", options.followUpConcurrency);
  if (options.fallbackFollowUps === true) {
    args.push("--source-navigation-fallback-followups");
  }
  pushNumberArg(args, "--source-navigation-max-fallback-followups", options.maxFallbackFollowUps);
  pushNumberArg(args, "--source-navigation-max-depth", options.maxDepth);
  pushNumberArg(args, "--source-navigation-max-deepening-runs", options.maxDeepeningRuns);
  pushNumberArg(args, "--source-navigation-max-deepening-runs-per-domain", options.maxDeepeningRunsPerDomain);
  pushNumberArg(args, "--source-navigation-deepening-concurrency", options.deepeningConcurrency);
  pushNumberArg(args, "--source-navigation-deepening-timeout-ms", options.deepeningTimeoutMs);
  pushNumberArg(args, "--source-navigation-max-deepening-artifacts", options.maxDeepeningArtifacts);
  return args;
}

function formatSourceNavigationArgsForPowerShell(options: SourceNavigationPromotionEvidenceRunOptions): string {
  const args = evidenceRunSourceNavigationArgs(options);
  if (args.length === 0) {
    return "";
  }
  return ` ${args.join(" ")}`;
}

function pushNumberArg(args: string[], name: string, value: number | undefined): void {
  if (value !== undefined) {
    args.push(name, String(value));
  }
}

function normalizeEvidenceRunOptions(options: SourceNavigationPromotionEvidenceRunOptions | undefined): SourceNavigationPromotionEvidenceRunOptions {
  if (options === undefined) {
    return {};
  }
  return {
    ...(options.maxFollowUps === undefined ? {} : { maxFollowUps: boundedInteger("--source-navigation-max-followups", options.maxFollowUps, 0, 5) }),
    ...(options.maxFollowUpsPerDomain === undefined ? {} : { maxFollowUpsPerDomain: boundedInteger("--source-navigation-max-followups-per-domain", options.maxFollowUpsPerDomain, 0, 5) }),
    ...(options.followUpConcurrency === undefined ? {} : { followUpConcurrency: boundedInteger("--source-navigation-followup-concurrency", options.followUpConcurrency, 1, 5) }),
    ...(options.fallbackFollowUps === undefined ? {} : { fallbackFollowUps: options.fallbackFollowUps }),
    ...(options.maxFallbackFollowUps === undefined ? {} : { maxFallbackFollowUps: boundedInteger("--source-navigation-max-fallback-followups", options.maxFallbackFollowUps, 0, 5) }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: boundedInteger("--source-navigation-max-depth", options.maxDepth, 1, 2) }),
    ...(options.maxDeepeningRuns === undefined ? {} : { maxDeepeningRuns: boundedInteger("--source-navigation-max-deepening-runs", options.maxDeepeningRuns, 0, 5) }),
    ...(options.maxDeepeningRunsPerDomain === undefined ? {} : { maxDeepeningRunsPerDomain: boundedInteger("--source-navigation-max-deepening-runs-per-domain", options.maxDeepeningRunsPerDomain, 0, 5) }),
    ...(options.deepeningConcurrency === undefined ? {} : { deepeningConcurrency: boundedInteger("--source-navigation-deepening-concurrency", options.deepeningConcurrency, 1, 5) }),
    ...(options.deepeningTimeoutMs === undefined ? {} : { deepeningTimeoutMs: boundedInteger("--source-navigation-deepening-timeout-ms", options.deepeningTimeoutMs, 1, 120_000) }),
    ...(options.maxDeepeningArtifacts === undefined ? {} : { maxDeepeningArtifacts: boundedInteger("--source-navigation-max-deepening-artifacts", options.maxDeepeningArtifacts, 1, 1_000) })
  };
}

function boundedInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function hasEvidenceRunOptions(options: SourceNavigationPromotionEvidenceRunOptions): boolean {
  return Object.values(options).some((value) => value !== undefined && value !== false);
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

function parsePromotionGroup(value: unknown): SourceNavigationPromotionGroup {
  if (!isRecord(value)) {
    throw new Error("Promotion summary group must be an object");
  }
  const status = stringField(value, "status");
  if (status !== "ready" && status !== "empty") {
    throw new Error("Promotion summary group status must be ready or empty");
  }
  const files = objectField(value, "files");
  const catalogSummary = objectField(value, "catalogSummary");
  const selectorHintsFile = optionalStringField(files, "selectorHints");
  const blockedSignalCounts = parseBlockedSignalCounts(value.blockedSignalCounts);
  return {
    platform: stringField(value, "platform") as SourcePlatform,
    sourceFamily: stringField(value, "sourceFamily") as SourceFamily,
    url: stringField(value, "url"),
    runDirs: stringArrayField(value, "runDirs"),
    runtime: parseRuntime(value.runtime),
    status,
    actionCount: numberField(value, "actionCount"),
    catalogSummary: {
      entryCount: numberField(catalogSummary, "entryCount"),
      calibrationReportCount: numberField(catalogSummary, "calibrationReportCount"),
      skippedCalibrationReportCount: numberField(catalogSummary, "skippedCalibrationReportCount"),
      maintainedRecipeReadyCount: numberField(catalogSummary, "maintainedRecipeReadyCount"),
      singleRunReadyCount: numberField(catalogSummary, "singleRunReadyCount"),
      manualReviewCount: numberField(catalogSummary, "manualReviewCount"),
      manualValueCount: numberField(catalogSummary, "manualValueCount"),
      calibrationRequiredCount: numberField(catalogSummary, "calibrationRequiredCount"),
      blockedCount: numberField(catalogSummary, "blockedCount"),
      notSupportedCount: numberField(catalogSummary, "notSupportedCount"),
      recommendedActionCount: numberField(catalogSummary, "recommendedActionCount"),
      maintainedDefaultReadyCount: numberField(catalogSummary, "maintainedDefaultReadyCount"),
      minimumCalibrationRunsRequired: numberField(catalogSummary, "minimumCalibrationRunsRequired")
    },
    destinationExtraction: parseDestinationExtraction(value.destinationExtraction),
    blockedSignalCounts,
    files: {
      catalog: stringField(files, "catalog"),
      export: stringField(files, "export"),
      actions: stringField(files, "actions"),
      ...(selectorHintsFile === undefined ? {} : { selectorHints: selectorHintsFile })
    },
    warnings: stringArrayField(value, "warnings")
  };
}

function parseBlockedSignalCounts(value: unknown): SourceNavigationBlockedSignalCount[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("blockedSignalCounts must be an array");
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("blockedSignalCounts entries must be objects");
    }
    return {
      signal: stringField(entry, "signal"),
      count: numberField(entry, "count"),
      actionKeys: stringArrayField(entry, "actionKeys")
    };
  });
}

function parseRuntime(value: unknown): SourceNavigationCalibrationRuntime {
  if (!isRecord(value)) {
    return {
      headed: false,
      storagePolicy: "ephemeral"
    };
  }
  const storagePolicy = value.storagePolicy;
  const profileName = value.profileName;
  const browserChannel = value.browserChannel;
  return normalizeRuntime({
    headed: value.headed === true,
    storagePolicy: storagePolicy === "storage-state" || storagePolicy === "persistent-profile" ? storagePolicy : "ephemeral",
    ...(typeof profileName === "string" && profileName.length > 0 ? { profileName } : {}),
    ...(typeof browserChannel === "string" && browserChannel.length > 0 ? { browserChannel } : {})
  });
}

function parseDestinationExtraction(value: unknown): SourceNavigationDestinationExtractionPromotionSummary {
  if (!isRecord(value)) {
    return emptyDestinationExtractionSummary();
  }
  return {
    candidateCount: numberField(value, "candidateCount"),
    readyActionCount: numberField(value, "readyActionCount"),
    readyActionKeys: stringArrayField(value, "readyActionKeys"),
    maintainedReadyCount: numberField(value, "maintainedReadyCount"),
    singleRunReadyCount: numberField(value, "singleRunReadyCount"),
    calibrationRequiredCount: numberField(value, "calibrationRequiredCount"),
    blockedCount: numberField(value, "blockedCount"),
    manualReviewCount: numberField(value, "manualReviewCount"),
    manualValueCount: numberField(value, "manualValueCount"),
    discoveryRunCount: optionalNumberField(value, "discoveryRunCount", 0),
    discoveryPromotableCandidateCount: optionalNumberField(value, "discoveryPromotableCandidateCount", 0),
    discoveryNonPromotableCandidateCount: optionalNumberField(value, "discoveryNonPromotableCandidateCount", 0),
    discoverySelectorHintCount: optionalNumberField(value, "discoverySelectorHintCount", 0),
    discoveryWarningCounts: warningCountsField(value, "discoveryWarningCounts"),
    clientStateProbeRunCount: optionalNumberField(value, "clientStateProbeRunCount", 0),
    clientStateProbeOkRunCount: optionalNumberField(value, "clientStateProbeOkRunCount", 0),
    clientStateProbeUniqueCandidateCount: optionalNumberField(value, "clientStateProbeUniqueCandidateCount", 0)
  };
}

function emptyDestinationExtractionSummary(): SourceNavigationDestinationExtractionPromotionSummary {
  return {
    candidateCount: 0,
    readyActionCount: 0,
    readyActionKeys: [],
    maintainedReadyCount: 0,
    singleRunReadyCount: 0,
    calibrationRequiredCount: 0,
    blockedCount: 0,
    manualReviewCount: 0,
    manualValueCount: 0,
    discoveryRunCount: 0,
    discoveryPromotableCandidateCount: 0,
    discoveryNonPromotableCandidateCount: 0,
    discoverySelectorHintCount: 0,
    discoveryWarningCounts: [],
    clientStateProbeRunCount: 0,
    clientStateProbeOkRunCount: 0,
    clientStateProbeUniqueCandidateCount: 0
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const fieldValue = value[field];
  if (!isRecord(fieldValue)) {
    throw new Error(`Promotion summary field ${field} must be an object`);
  }
  return fieldValue;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string") {
    throw new Error(`Promotion summary field ${field} must be a string`);
  }
  return fieldValue;
}

function optionalStringField(value: Record<string, unknown>, field: string): string | undefined {
  const fieldValue = value[field];
  if (fieldValue === undefined) {
    return undefined;
  }
  if (typeof fieldValue !== "string") {
    throw new Error(`Promotion summary field ${field} must be a string`);
  }
  return fieldValue;
}

function numberField(value: Record<string, unknown>, field: string): number {
  const fieldValue = value[field];
  if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
    throw new Error(`Promotion summary field ${field} must be a finite number`);
  }
  return fieldValue;
}

function optionalNumberField(value: Record<string, unknown>, field: string, fallback: number): number {
  const fieldValue = value[field];
  if (fieldValue === undefined) {
    return fallback;
  }
  if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
    throw new Error(`Promotion summary field ${field} must be a finite number`);
  }
  return fieldValue;
}

function stringArrayField(value: Record<string, unknown>, field: string): string[] {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue) || !fieldValue.every((item): item is string => typeof item === "string")) {
    throw new Error(`Promotion summary field ${field} must be a string array`);
  }
  return fieldValue;
}

function warningCountsField(value: Record<string, unknown>, field: string): Array<{ warning: string; count: number }> {
  const fieldValue = value[field];
  if (fieldValue === undefined) {
    return [];
  }
  if (!Array.isArray(fieldValue)) {
    throw new Error(`Promotion summary field ${field} must be a warning-count array`);
  }
  return fieldValue.map((item) => {
    if (!isRecord(item)) {
      throw new Error(`Promotion summary field ${field} entries must be objects`);
    }
    return {
      warning: stringField(item, "warning"),
      count: numberField(item, "count")
    };
  });
}
