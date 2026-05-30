import { join, resolve } from "node:path";
import {
  buildSourceCoverageReadinessRetryPlan,
  buildSourceCoverageReadinessAudit,
  checkSourceCoverageReadinessRetryPlan,
  sourceCoverageReadinessCalibrationTargets,
  type SourceCoverageReadinessAudit,
  type SourceCoverageReadinessAuditInput,
  type SourceCoverageReadinessRetryPlanCheckOptions
} from "./source-coverage-readiness.js";
import type { SourceNavigationCalibrationBatchManifest, SourceNavigationCalibrationBatchTarget, SourceNavigationCalibrationRuntime } from "./source-navigation-calibration-batch.js";
import {
  annotateSourceNavigationCalibrationTargets,
  expandSearchCalibrationTargetVariants,
  summarizeSourceNavigationCalibrationTargetDetections,
  type SourceNavigationCalibrationTargetDetectionSummary
} from "./source-navigation-calibration-targets.js";
import type { SourceNavigationBlockedSignalCount, SourceNavigationPromotionEvidenceRunOptions, SourceNavigationPromotionReview, SourceNavigationPromotionSummary } from "./source-navigation-promotion.js";

export interface SourceCoverageCalibrationLoopPlanInput extends SourceCoverageReadinessAuditInput {
  promotionSummaries?: SourceNavigationPromotionSummary[] | undefined;
  targetFile: string;
  runRoot: string;
  promotionDir: string;
  repeat?: number | undefined;
  calibrationConcurrency?: number | undefined;
  calibrationRuntime?: SourceNavigationCalibrationRuntime | undefined;
  promotionReviewEvidenceRunOptions?: SourceNavigationPromotionEvidenceRunOptions | undefined;
  includeSearchVariants?: boolean | undefined;
  selectorHintFiles?: string[] | undefined;
}

export interface SourceCoverageCalibrationLoopCommands {
  calibrateBatch: string;
  promoteBatch: string;
  promotionReview: string;
  coverageReadinessAfterPromotion: string;
}

export interface SourceCoverageCalibrationLoopPlan {
  schemaVersion: "1.0";
  executionPolicy: "readiness_guided_read_only_calibration_loop";
  audit: SourceCoverageReadinessAudit;
  targetFile: string;
  runRoot: string;
  promotionDir: string;
  repeat: number;
  calibrationConcurrency: number;
  calibrationRuntime: SourceNavigationCalibrationRuntime;
  promotionReviewEvidenceRunOptions?: SourceNavigationPromotionEvidenceRunOptions | undefined;
  includeSearchVariants: boolean;
  selectorHintFiles: string[];
  targetCount: number;
  targetDetectionSummary: SourceNavigationCalibrationTargetDetectionSummary;
  targets: SourceNavigationCalibrationBatchTarget[];
  targetLines: string;
  commands: SourceCoverageCalibrationLoopCommands;
  warnings: string[];
}

export interface SourceCoverageCalibrationLoopReportInput {
  plan: SourceCoverageCalibrationLoopPlan;
  files: ReturnType<typeof sourceCoverageCalibrationLoopOutputPaths>;
  manifest?: SourceNavigationCalibrationBatchManifest | undefined;
  promotion?: SourceNavigationPromotionSummary | undefined;
  promotionReview?: SourceNavigationPromotionReview | undefined;
  finalAudit?: SourceCoverageReadinessAudit | undefined;
  retryPlanCheckOptions?: SourceCoverageReadinessRetryPlanCheckOptions | undefined;
}

export function buildSourceCoverageCalibrationLoopPlan(input: SourceCoverageCalibrationLoopPlanInput): SourceCoverageCalibrationLoopPlan {
  const audit = buildSourceCoverageReadinessAudit(input);
  const targets = annotateSourceNavigationCalibrationTargets(expandSearchCalibrationTargetVariants(sourceCoverageReadinessCalibrationTargets(audit), {
    query: audit.query,
    includeSearchVariants: input.includeSearchVariants
  }));
  const targetDetectionSummary = summarizeSourceNavigationCalibrationTargetDetections(targets);
  const targetFile = resolve(input.targetFile);
  const runRoot = resolve(input.runRoot);
  const promotionDir = resolve(input.promotionDir);
  const repeat = normalizeRepeat(input.repeat ?? 2);
  const calibrationConcurrency = normalizeCalibrationConcurrency(input.calibrationConcurrency);
  const calibrationRuntime = normalizeRuntime(input.calibrationRuntime);
  assertCalibrationConcurrencyCompatible(calibrationConcurrency, calibrationRuntime);
  const promotionReviewEvidenceRunOptions = normalizeEvidenceRunOptions(input.promotionReviewEvidenceRunOptions);
  const selectorHintFiles = normalizeSelectorHintFiles(input.selectorHintFiles);
  const manifestPath = join(runRoot, "calibration-batch-manifest.json");
  const promotionSummaryPath = join(promotionDir, "promotion-summary.json");
  return {
    schemaVersion: "1.0",
    executionPolicy: "readiness_guided_read_only_calibration_loop",
    audit,
    targetFile,
    runRoot,
    promotionDir,
    repeat,
    calibrationConcurrency,
    calibrationRuntime,
    ...(hasEvidenceRunOptions(promotionReviewEvidenceRunOptions) ? { promotionReviewEvidenceRunOptions } : {}),
    includeSearchVariants: input.includeSearchVariants === true,
    selectorHintFiles,
    targetCount: targets.length,
    targetDetectionSummary,
    targets,
    targetLines: formatTargets(targets),
    commands: {
      calibrateBatch: `node .\\dist\\cli.js source-navigation-calibrate-batch --urls-file ${quotePowerShellValue(targetFile)} --run-root ${quotePowerShellValue(runRoot)} --repeat ${repeat}${calibrationConcurrencyArgString(calibrationConcurrency)}${calibrationRuntimeArgString(calibrationRuntime)}${selectorHintArgString(selectorHintFiles)}`,
      promoteBatch: `node .\\dist\\cli.js source-navigation-promote-batch --calibration-batch-manifest ${quotePowerShellValue(manifestPath)} --output-dir ${quotePowerShellValue(promotionDir)}`,
      promotionReview: `node .\\dist\\cli.js source-navigation-promotion-review --promotion-summary ${quotePowerShellValue(promotionSummaryPath)}${promotionReviewEvidenceRunArgString(promotionReviewEvidenceRunOptions)}`,
      coverageReadinessAfterPromotion: `node .\\dist\\cli.js source-coverage-readiness${readinessArgString(input)} --promotion-summary ${quotePowerShellValue(promotionSummaryPath)}`
    },
    warnings: [
      "This loop only schedules read-only selector calibration and explicit promotion artifacts.",
      "It does not execute promoted source-navigation actions; use promotion review commands only after inspecting catalog/export output.",
      ...(calibrationConcurrency > 1 ? ["Calibration batch concurrency is enabled; keep profile-heavy, login, or fragile provider retries at concurrency 1 unless reviewed."] : []),
      ...(selectorHintFiles.length === 0 ? [] : ["Selector hint files are manual calibration inputs; they are not maintained recipes until repeated calibration and promotion pass."]),
      ...(input.includeSearchVariants === true ? ["Search variant targets are expanded for reviewed vertical calibration; review each variant before promotion."] : []),
      ...(targetDetectionSummary.crossPlatformVariantCount > 0 ? ["Some variant target URLs are detected as a different platform; promotion and review will group by detected browser-visible platform/source family."] : []),
      ...(targets.length === 0 ? ["No actionable not-ready calibration targets were found."] : [])
    ]
  };
}

export function sourceCoverageCalibrationLoopOutputPaths(runRoot: string): {
  runRoot: string;
  targetFile: string;
  planFile: string;
  initialReadinessFile: string;
  manifestFile: string;
  promotionDir: string;
  promotionSummaryFile: string;
  promotionReviewFile: string;
  finalReadinessFile: string;
  retryPlanFile: string;
  retryPlanJsonFile: string;
  retryPlanCheckFile: string;
  reportFile: string;
} {
  const resolvedRunRoot = resolve(runRoot);
  const promotionDir = join(resolvedRunRoot, "promotion");
  return {
    runRoot: resolvedRunRoot,
    targetFile: join(resolvedRunRoot, "calibration-targets.txt"),
    planFile: join(resolvedRunRoot, "coverage-calibration-plan.json"),
    initialReadinessFile: join(resolvedRunRoot, "coverage-readiness-before.json"),
    manifestFile: join(resolvedRunRoot, "calibration-batch-manifest.json"),
    promotionDir,
    promotionSummaryFile: join(promotionDir, "promotion-summary.json"),
    promotionReviewFile: join(resolvedRunRoot, "promotion-review.json"),
    finalReadinessFile: join(resolvedRunRoot, "coverage-readiness-after.json"),
    retryPlanFile: join(resolvedRunRoot, "profile-headed-retry-plan.md"),
    retryPlanJsonFile: join(resolvedRunRoot, "profile-headed-retry-plan.json"),
    retryPlanCheckFile: join(resolvedRunRoot, "profile-headed-retry-plan-check.json"),
    reportFile: join(resolvedRunRoot, "coverage-calibration-report.md")
  };
}

export function formatSourceCoverageCalibrationLoopReport(input: SourceCoverageCalibrationLoopReportInput): string {
  const finalAudit = input.finalAudit;
  const effectiveAudit = finalAudit ?? input.plan.audit;
  const retryPlanCheck = checkSourceCoverageReadinessRetryPlan(
    buildSourceCoverageReadinessRetryPlan(effectiveAudit),
    input.retryPlanCheckOptions
  );
  const lines = [
    "# Source Coverage Calibration Report",
    "",
    "## Summary",
    "",
    `- Mode: ${finalAudit === undefined ? "plan_only" : "executed"}`,
    `- Execution policy: ${input.plan.executionPolicy}`,
    `- Filter: ${JSON.stringify(input.plan.audit.filter)}`,
    `- Query: ${input.plan.audit.query}`,
    `- Repeat: ${input.plan.repeat}`,
    `- Calibration concurrency: ${input.plan.calibrationConcurrency}`,
    `- Browser mode: ${input.plan.calibrationRuntime.headed ? "headed" : "headless"}`,
    `- Browser channel: ${input.plan.calibrationRuntime.browserChannel ?? "chromium"}`,
    `- Profile mode: ${profileModeLine(input.plan.calibrationRuntime)}`,
    `- Promotion evidence-run options: ${promotionReviewEvidenceRunOptionLine(input.plan.promotionReviewEvidenceRunOptions)}`,
    `- Search variants: ${input.plan.includeSearchVariants ? "included" : "default-only"}`,
    `- Selector hint input files: ${input.plan.selectorHintFiles.length}`,
    `- Target count: ${input.plan.targetCount}`,
    `- Target detected platforms: ${detectionPlatformCountsLine(input.plan.targetDetectionSummary)}`,
    `- Target detected source families: ${detectionSourceFamilyCountsLine(input.plan.targetDetectionSummary)}`,
    `- Cross-platform variant targets: ${crossPlatformVariantLine(input.plan.targetDetectionSummary)}`,
    `- Ready count: ${effectiveAudit.readyCount}`,
    `- Not-ready actionable count: ${effectiveAudit.notReadyActionableCount}`,
    `- Destination extraction ready count: ${effectiveAudit.destinationExtractionReadyCount}`,
    `- Destination extraction not-ready count: ${effectiveAudit.destinationExtractionNotReadyCount}`,
    `- Destination extraction statuses: ${destinationExtractionStatusCountsLine(effectiveAudit)}`,
    `- Profile/headed retry check: ${retryPlanCheck.ok ? "ok" : "failed"} (${retryPlanCheck.errorCount} error(s), ${retryPlanCheck.warningCount} warning(s))`,
    `- Skipped count: ${effectiveAudit.skippedCount}`,
    "",
    "## Files",
    "",
    `- Run root: ${input.files.runRoot}`,
    `- Initial readiness: ${input.files.initialReadinessFile}`,
    `- Target file: ${input.files.targetFile}`,
    `- Loop plan: ${input.files.planFile}`,
    `- Batch manifest: ${input.files.manifestFile}`,
    `- Promotion summary: ${input.files.promotionSummaryFile}`,
    `- Promotion review: ${input.files.promotionReviewFile}`,
    `- Final readiness: ${input.files.finalReadinessFile}`,
    `- Profile/headed retry plan: ${input.files.retryPlanFile}`,
    `- Profile/headed retry plan JSON: ${input.files.retryPlanJsonFile}`,
    `- Profile/headed retry plan check: ${input.files.retryPlanCheckFile}`,
    "",
    "## Selector Hint Inputs",
    "",
    ...selectorHintInputLines(input.plan),
    "",
    "## Targets",
    "",
    ...targetLines(input.plan),
    "",
    "## Commands",
    "",
    "```powershell",
    input.plan.commands.calibrateBatch,
    input.plan.commands.promoteBatch,
    input.plan.commands.promotionReview,
    input.plan.commands.coverageReadinessAfterPromotion,
    "```",
    "",
    "## Readiness",
    "",
    ...readinessLines(effectiveAudit),
    "",
    "## Profile/Headed Retries",
    "",
    ...profileHeadedRetryLines(effectiveAudit),
    "",
    "## Profile/Headed Retry Check",
    "",
    ...retryPlanCheckLines(retryPlanCheck),
    "",
    "## Promotion",
    "",
    ...promotionLines(input.promotion, input.promotionReview),
    "",
    "## Selector Hints",
    "",
    ...selectorHintLines(effectiveAudit),
    "",
    "## Warnings",
    "",
    ...warningLines(input)
  ];
  return `${lines.join("\n")}\n`;
}

function formatTargets(targets: SourceNavigationCalibrationBatchTarget[]): string {
  return targets.map((target) => `${target.id} ${target.url}`).join("\n") + (targets.length > 0 ? "\n" : "");
}

function targetLines(plan: SourceCoverageCalibrationLoopPlan): string[] {
  if (plan.targets.length === 0) {
    return ["- No actionable calibration targets."];
  }
  return plan.targets.map((target) => {
    const detected = target.detectedPlatform === undefined || target.detectedSourceFamily === undefined
      ? ""
      : ` (detected ${target.detectedPlatform}/${target.detectedSourceFamily}${target.parentPlatform === undefined ? "" : `; parent ${target.parentPlatform}`}${target.variantId === undefined ? "" : `; variant ${target.variantId}`})`;
    return `- ${target.id}: ${target.url}${detected}`;
  });
}

function selectorHintInputLines(plan: SourceCoverageCalibrationLoopPlan): string[] {
  if (plan.selectorHintFiles.length === 0) {
    return ["- No selector hint input files were supplied for this calibration pass."];
  }
  return plan.selectorHintFiles.map((file) => `- ${file}`);
}

function readinessLines(audit: SourceCoverageReadinessAudit): string[] {
  if (audit.items.length === 0) {
    return ["- No registry entries matched the readiness audit filter."];
  }
  return audit.items.map((item) => {
    const destination = item.destinationExtraction;
    const readyKeys = destination.readyActionKeys.length === 0
      ? ""
      : `; keys: ${destination.readyActionKeys.join(", ")}`;
    const blockedSignals = item.blockedSignalCounts.length === 0
      ? ""
      : `; blocked signals: ${formatBlockedSignalCounts(item.blockedSignalCounts)}`;
    const clientStateProbe = destination.clientStateProbeRunCount <= 0
      ? ""
      : `; client-state probes: ${destination.clientStateProbeOkRunCount}/${destination.clientStateProbeRunCount} ok, ${destination.clientStateProbeUniqueCandidateCount} unique`;
    return `- ${item.platform}: ${item.status}; destination extraction: ${destination.status} (${destination.readyActionCount}/${destination.candidateCount} ready${readyKeys}${clientStateProbe})${blockedSignals} (${item.reasons[0] ?? "no reason recorded"})`;
  });
}

function profileHeadedRetryLines(audit: SourceCoverageReadinessAudit): string[] {
  const retryPlan = buildSourceCoverageReadinessRetryPlan(audit);
  if (retryPlan.items.length === 0) {
    return ["- No blocked source slots have profile/headed retry commands."];
  }
  return retryPlan.items.map((item) => {
    const setup = item.profileSetupPowerShellCommand ?? "not required";
    const selectorHints = item.selectorHintFiles.length === 0
      ? "none"
      : item.selectorHintFiles.join(", ");
    return `- ${item.order}. ${item.platform}: priority=${item.priority}${item.matchedTopRank === undefined ? "" : `; top-slot rank=${item.matchedTopRank}`}; profile=${item.profileName}; selector hints=${selectorHints}; blocked signals=${formatBlockedSignalCounts(item.blockedSignalCounts)}; setup=${setup}; retry=${item.powershellCommand}`;
  });
}

function retryPlanCheckLines(check: ReturnType<typeof checkSourceCoverageReadinessRetryPlan>): string[] {
  if (check.issues.length === 0) {
    return ["- No retry-plan check issues."];
  }
  return check.issues.map((issue) => {
    const item = issue.itemOrder === undefined ? "" : ` item=${issue.itemOrder}`;
    const platform = issue.platform === undefined ? "" : ` platform=${issue.platform}`;
    return `- ${issue.severity}: ${issue.code}${item}${platform}: ${issue.message}`;
  });
}

function formatBlockedSignalCounts(counts: SourceNavigationBlockedSignalCount[]): string {
  if (counts.length === 0) {
    return "none recorded";
  }
  return counts.slice(0, 8).map((entry) =>
    `${entry.signal}:${entry.count}${entry.actionKeys.length === 0 ? "" : ` (${entry.actionKeys.join(",")})`}`
  ).join(", ");
}

function promotionLines(
  promotion: SourceNavigationPromotionSummary | undefined,
  promotionReview: SourceNavigationPromotionReview | undefined
): string[] {
  if (promotion === undefined) {
    return ["- Promotion has not run yet."];
  }
  return [
    `- Groups: ${promotion.groupCount}`,
    `- Ready groups: ${promotion.readyGroupCount}`,
    `- Empty groups: ${promotion.emptyGroupCount}`,
    `- Ready action files: ${promotionReview?.readyActionFileCount ?? 0}`,
    `- Destination extraction ready actions: ${promotionDestinationExtractionReadyActionCount(promotionReview)}/${promotionDestinationExtractionCandidateCount(promotionReview)}`
  ];
}

function selectorHintLines(audit: SourceCoverageReadinessAudit): string[] {
  const lines = audit.items.flatMap((item) =>
    item.destinationExtraction.selectorHintFiles.map((file) =>
      `- ${item.platform}: ${file} (${item.destinationExtraction.discoverySelectorHintCount} hint(s))`
    )
  );
  if (lines.length === 0) {
    return ["- No selector hint files were reported by matching promotion groups."];
  }
  return lines;
}

function destinationExtractionStatusCountsLine(audit: SourceCoverageReadinessAudit): string {
  const counts = audit.destinationExtractionStatusCounts;
  return [
    `ready=${counts.ready}`,
    `blocked=${counts.blocked}`,
    `needs_repeated_calibration=${counts.needs_repeated_calibration}`,
    `not_promoted=${counts.not_promoted}`,
    `not_applicable=${counts.not_applicable}`
  ].join(", ");
}

function detectionPlatformCountsLine(summary: SourceNavigationCalibrationTargetDetectionSummary): string {
  if (summary.platformCounts.length === 0) {
    return "none";
  }
  return summary.platformCounts.map((entry) => `${entry.platform}=${entry.count}`).join(", ");
}

function detectionSourceFamilyCountsLine(summary: SourceNavigationCalibrationTargetDetectionSummary): string {
  if (summary.sourceFamilyCounts.length === 0) {
    return "none";
  }
  return summary.sourceFamilyCounts.map((entry) => `${entry.sourceFamily}=${entry.count}`).join(", ");
}

function crossPlatformVariantLine(summary: SourceNavigationCalibrationTargetDetectionSummary): string {
  if (summary.crossPlatformVariantCount === 0) {
    return "0";
  }
  return `${summary.crossPlatformVariantCount} (${summary.crossPlatformVariantTargets.join(", ")})`;
}

function promotionDestinationExtractionCandidateCount(
  promotionReview: SourceNavigationPromotionReview | undefined
): number {
  return promotionReview?.groups.reduce((sum, group) => sum + group.destinationExtraction.candidateCount, 0) ?? 0;
}

function promotionDestinationExtractionReadyActionCount(
  promotionReview: SourceNavigationPromotionReview | undefined
): number {
  return promotionReview?.groups.reduce((sum, group) => sum + group.destinationExtraction.readyActionCount, 0) ?? 0;
}

function warningLines(input: SourceCoverageCalibrationLoopReportInput): string[] {
  const warnings = [
    ...input.plan.warnings,
    ...input.plan.audit.warnings,
    ...(input.finalAudit?.warnings ?? []),
    ...(input.promotion?.warnings ?? []),
    ...(input.promotionReview?.warnings ?? [])
  ];
  const uniqueWarnings = [...new Set(warnings)];
  if (uniqueWarnings.length === 0) {
    return ["- None."];
  }
  return uniqueWarnings.map((warning) => `- ${warning}`);
}

function readinessArgString(input: SourceCoverageCalibrationLoopPlanInput): string {
  const args: string[] = [];
  if (input.category !== undefined) {
    args.push("--category", input.category);
  }
  if (input.locale !== undefined) {
    args.push("--locale", input.locale);
  }
  if (input.platform !== undefined) {
    args.push("--platform", input.platform);
  }
  if (input.sourceFamily !== undefined) {
    args.push("--family", input.sourceFamily);
  }
  if (input.minSupportTier !== undefined) {
    args.push("--min-tier", String(input.minSupportTier));
  }
  if (input.topRankMax !== undefined) {
    args.push("--top-rank", String(input.topRankMax));
  }
  if (input.query !== undefined) {
    args.push("--query", input.query);
  }
  return args.length === 0 ? "" : ` ${args.map(quotePowerShellArg).join(" ")}`;
}

function calibrationRuntimeArgString(runtime: SourceNavigationCalibrationRuntime): string {
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
  return args.length === 0 ? "" : ` ${args.map(quotePowerShellArg).join(" ")}`;
}

function calibrationConcurrencyArgString(concurrency: number): string {
  return concurrency <= 1 ? "" : ` --calibration-concurrency ${quotePowerShellValue(String(concurrency))}`;
}

function promotionReviewEvidenceRunArgString(options: SourceNavigationPromotionEvidenceRunOptions | undefined): string {
  if (options === undefined || !hasEvidenceRunOptions(options)) {
    return "";
  }
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
  return args.length === 0 ? "" : ` ${args.map(quotePowerShellArg).join(" ")}`;
}

function promotionReviewEvidenceRunOptionLine(options: SourceNavigationPromotionEvidenceRunOptions | undefined): string {
  if (options === undefined || !hasEvidenceRunOptions(options)) {
    return "default evidence-run source-navigation budgets";
  }
  return promotionReviewEvidenceRunArgString(options).trim();
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

function selectorHintArgString(files: string[]): string {
  if (files.length === 0) {
    return "";
  }
  if (files.length === 1) {
    return ` --selector-hints-file ${quotePowerShellValue(files[0]!)}`;
  }
  return ` --selector-hints-files ${quotePowerShellValue(files.join(","))}`;
}

function profileModeLine(runtime: SourceNavigationCalibrationRuntime): string {
  if (runtime.profileName === undefined) {
    return "none";
  }
  return `${runtime.storagePolicy}:${runtime.profileName}`;
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
  return [...new Set(files.map((file) => resolve(file)).filter((file) => file.length > 0))];
}

function quotePowerShellArg(value: string): string {
  return value.startsWith("--") ? value : quotePowerShellValue(value);
}

function quotePowerShellValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeRepeat(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error("Coverage calibration loop repeat must be an integer between 1 and 20.");
  }
  return value;
}

function normalizeCalibrationConcurrency(value: number | undefined): number {
  const normalized = value ?? 1;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 5) {
    throw new Error("Coverage calibration loop concurrency must be an integer between 1 and 5.");
  }
  return normalized;
}

function assertCalibrationConcurrencyCompatible(concurrency: number, runtime: SourceNavigationCalibrationRuntime): void {
  if (concurrency > 1 && runtime.storagePolicy === "persistent-profile") {
    throw new Error("Coverage calibration loop concurrency must be 1 when persistent-profile calibration is used.");
  }
}
