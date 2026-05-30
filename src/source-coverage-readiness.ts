import { buildSourceNavigationCalibrationTargetPlan } from "./source-navigation-calibration-targets.js";
import { uniqueSorted as uniqueStrings } from "./util/collections.js";
import { reviewSourceNavigationPromotion, type SourceNavigationBlockedSignalCount, type SourceNavigationDestinationExtractionPromotionSummary, type SourceNavigationPromotionGroupReview, type SourceNavigationPromotionReviewStatus, type SourceNavigationPromotionSummary } from "./source-navigation-promotion.js";
import { describeSourceNavigationPlan } from "./source-navigation.js";
import { describeSourceNavigationRecipePlan } from "./source-navigation-recipes.js";
import { listSourceRegistryEntries, type InformationCategory, type LocaleSegment, type SourceRegistryEntry, type SourceRegistryFilter, type SourceRegistryTopSlot, type SourceSupportTier } from "./source-registry.js";
import type { SourceNavigationCalibrationBatchTarget } from "./source-navigation-calibration-batch.js";
import { describeSourceStrategy, type SourceFamily, type SourcePlatform } from "./source-strategy.js";

export type SourceCoverageReadinessStatus = "ready" | "blocked" | "needs_repeated_calibration" | "manual_review_required" | "promoted_empty" | "not_promoted" | "skipped_derivative" | "skipped_private" | "planning_only";

export interface SourceCoverageReadinessAuditInput {
  category?: InformationCategory | undefined;
  locale?: LocaleSegment | undefined;
  platform?: SourcePlatform | undefined;
  sourceFamily?: SourceFamily | undefined;
  minSupportTier?: SourceSupportTier | undefined;
  topRankMax?: number | undefined;
  query?: string | undefined;
  promotionSummaries?: SourceNavigationPromotionSummary[] | undefined;
}

export interface SourceCoverageReadinessProfileHeadedRetryCommand {
  strategy: "profile_headed_calibration";
  profileName: string;
  storagePolicy: "persistent-profile";
  browserChannel: "chrome";
  selectorHintFiles: string[];
  profileSetupUrl?: string;
  profileSetupArgv?: string[];
  profileSetupPowerShellCommand?: string;
  argv: string[];
  powershellCommand: string;
}

export type SourceCoverageDestinationExtractionReadinessStatus = "ready" | "blocked" | "needs_repeated_calibration" | "not_promoted" | "not_applicable";

export interface SourceCoverageDestinationExtractionReadiness {
  status: SourceCoverageDestinationExtractionReadinessStatus;
  candidateCount: number;
  readyActionCount: number;
  readyActionKeys: string[];
  maintainedReadyCount: number;
  singleRunReadyCount: number;
  calibrationRequiredCount: number;
  blockedCount: number;
  discoveryRunCount: number;
  discoveryPromotableCandidateCount: number;
  discoveryNonPromotableCandidateCount: number;
  discoverySelectorHintCount: number;
  selectorHintFiles: string[];
  discoveryWarningCounts: Array<{ warning: string; count: number }>;
  clientStateProbeRunCount: number;
  clientStateProbeOkRunCount: number;
  clientStateProbeUniqueCandidateCount: number;
  reasons: string[];
  nextActions: string[];
}

export interface SourceCoverageReadinessItem {
  platform: SourcePlatform;
  displayName: string;
  status: SourceCoverageReadinessStatus;
  supportTier: SourceSupportTier;
  evidenceRole: SourceRegistryEntry["evidenceRole"];
  informationCategories: InformationCategory[];
  sourceFamilies: SourceFamily[];
  localeSegments: LocaleSegment[];
  matchedTopSlots: SourceRegistryTopSlot[];
  reasons: string[];
  nextActions: string[];
  matchedPromotionGroups: SourceNavigationPromotionGroupReview[];
  blockedSignalCounts: SourceNavigationBlockedSignalCount[];
  destinationExtraction: SourceCoverageDestinationExtractionReadiness;
  calibrationTarget?: SourceNavigationCalibrationBatchTarget;
  profileHeadedRetry?: SourceCoverageReadinessProfileHeadedRetryCommand;
}

export interface SourceCoverageReadinessAudit {
  schemaVersion: "1.0";
  executionPolicy: "coverage_readiness_audit_only";
  filter: SourceRegistryFilter;
  topRankMax?: number;
  query: string;
  ok: boolean;
  entryCount: number;
  actionableEntryCount: number;
  readyCount: number;
  notReadyActionableCount: number;
  skippedCount: number;
  profileHeadedRetryCount: number;
  destinationExtractionReadyCount: number;
  destinationExtractionNotReadyCount: number;
  destinationExtractionStatusCounts: Record<SourceCoverageDestinationExtractionReadinessStatus, number>;
  statusCounts: Record<SourceCoverageReadinessStatus, number>;
  items: SourceCoverageReadinessItem[];
  warnings: string[];
}

export type SourceCoverageReadinessRetryPriority = "top_slot_blocked" | "blocked";

export interface SourceCoverageReadinessRetryPlanItem {
  order: number;
  platform: SourcePlatform;
  displayName: string;
  priority: SourceCoverageReadinessRetryPriority;
  matchedTopRank?: number;
  supportTier: SourceSupportTier;
  profileName: string;
  browserChannel: "chrome";
  storagePolicy: "persistent-profile";
  selectorHintFiles: string[];
  profileSetupPowerShellCommand?: string;
  powershellCommand: string;
  blockedSignalCounts: SourceNavigationBlockedSignalCount[];
  reasons: string[];
  nextActions: string[];
}

export interface SourceCoverageReadinessRetryPlan {
  schemaVersion: "1.0";
  executionPolicy: "profile_headed_retry_plan_only";
  query: string;
  itemCount: number;
  items: SourceCoverageReadinessRetryPlanItem[];
  warnings: string[];
}

export type SourceCoverageReadinessRetryPlanCommandFormat = "commands" | "setup-commands" | "retry-commands";

export interface SourceCoverageReadinessRetryPlanFilter {
  platform?: SourcePlatform | undefined;
  priority?: SourceCoverageReadinessRetryPriority | undefined;
  limit?: number | undefined;
}

export type SourceCoverageReadinessRetryPlanCheckSeverity = "error" | "warning";

export interface SourceCoverageReadinessRetryPlanCheckIssue {
  severity: SourceCoverageReadinessRetryPlanCheckSeverity;
  code: string;
  message: string;
  itemOrder?: number | undefined;
  platform?: SourcePlatform | undefined;
}

export interface SourceCoverageReadinessRetryPlanCheck {
  schemaVersion: "1.0";
  executionPolicy: "profile_headed_retry_plan_check";
  ok: boolean;
  itemCount: number;
  errorCount: number;
  warningCount: number;
  issues: SourceCoverageReadinessRetryPlanCheckIssue[];
  warnings: string[];
}

export interface SourceCoverageReadinessRetryPlanCheckOptions {
  selectorHintFileExists?: ((filePath: string) => boolean) | undefined;
  profileExists?: ((profileName: string) => boolean) | undefined;
}

const STATUS_ORDER: SourceCoverageReadinessStatus[] = ["ready", "blocked", "needs_repeated_calibration", "manual_review_required", "promoted_empty", "not_promoted", "skipped_derivative", "skipped_private", "planning_only"];

const PROMOTION_STATUS_ORDER: SourceNavigationPromotionReviewStatus[] = ["ready", "blocked", "needs_repeated_calibration", "manual_review_required", "empty"];

const DESTINATION_EXTRACTION_STATUS_ORDER: SourceCoverageDestinationExtractionReadinessStatus[] = ["ready", "blocked", "needs_repeated_calibration", "not_promoted", "not_applicable"];

export function buildSourceCoverageReadinessAudit(input: SourceCoverageReadinessAuditInput = {}): SourceCoverageReadinessAudit {
  const filter: SourceRegistryFilter = {
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    ...(input.platform === undefined ? {} : { platform: input.platform }),
    ...(input.sourceFamily === undefined ? {} : { sourceFamily: input.sourceFamily }),
    ...(input.minSupportTier === undefined ? {} : { minSupportTier: input.minSupportTier })
  };
  const topRankMax = normalizeTopRankMax(input.topRankMax, input.category, input.locale);
  const query = input.query?.trim() || defaultCoverageQuery(input.category, input.locale, input.sourceFamily);
  const promotionGroups = (input.promotionSummaries ?? []).flatMap((summary) => reviewSourceNavigationPromotion(summary).groups);
  const entries = sortEntries(listSourceRegistryEntries(filter), input.category, input.locale).filter((entry) => matchesTopRank(entry, input.category, input.locale, topRankMax));
  const items = entries.map((entry) =>
    buildReadinessItem(entry, {
      category: input.category,
      locale: input.locale,
      query,
      topRankMax,
      promotionGroups
    })
  );
  const statusCounts = countStatuses(items);
  const actionableEntryCount = items.filter((item) => isActionableStatus(item.status)).length;
  const readyCount = statusCounts.ready;
  const notReadyActionableCount = actionableEntryCount - readyCount;
  const profileHeadedRetryCount = items.filter((item) => item.profileHeadedRetry !== undefined).length;
  const destinationExtractionStatusCounts = countDestinationExtractionStatuses(items);
  const destinationExtractionReadyCount = destinationExtractionStatusCounts.ready;
  const destinationExtractionNotReadyCount = items.filter((item) => item.destinationExtraction.status !== "ready" && item.destinationExtraction.status !== "not_applicable").length;
  return {
    schemaVersion: "1.0",
    executionPolicy: "coverage_readiness_audit_only",
    filter,
    ...(topRankMax === undefined ? {} : { topRankMax }),
    query,
    ok: notReadyActionableCount === 0,
    entryCount: items.length,
    actionableEntryCount,
    readyCount,
    notReadyActionableCount,
    skippedCount: items.length - actionableEntryCount,
    profileHeadedRetryCount,
    destinationExtractionReadyCount,
    destinationExtractionNotReadyCount,
    destinationExtractionStatusCounts,
    statusCounts,
    items,
    warnings: [
      "Coverage readiness is a QA planning audit; it does not execute browser actions.",
      "Ready means a promotion summary contains maintained explicit actions for the matching platform/source family.",
      "Destination extraction readiness is tracked separately from general capture readiness; a source can be ready for capture while still needing repeated destination-extraction calibration.",
      "Registry top-slot ranks are planning seeds, not refreshed live market-share claims.",
      ...(profileHeadedRetryCount === 0 ? [] : ["Blocked actionable source slots include profile/headed retry commands; prepare the named profile with auth-login first when credentials or user consent are required."]),
      ...(notReadyActionableCount === 0 ? [] : ["Some actionable source slots still need calibration, promotion, or manual review before maintained evidence-run execution."])
    ]
  };
}

export function formatSourceCoverageReadinessTargetsAsLines(audit: SourceCoverageReadinessAudit): string {
  const targets = sourceCoverageReadinessCalibrationTargets(audit);
  return targets.map((target) => `${target.id} ${target.url}`).join("\n") + (targets.length > 0 ? "\n" : "");
}

export function formatSourceCoverageReadinessRetryCommandsAsLines(audit: SourceCoverageReadinessAudit): string {
  const commands = audit.items.flatMap((item) => {
    const retry = item.profileHeadedRetry;
    if (retry === undefined) {
      return [];
    }
    return [...(retry.profileSetupPowerShellCommand === undefined ? [] : [retry.profileSetupPowerShellCommand]), retry.powershellCommand];
  });
  return commands.join("\n") + (commands.length > 0 ? "\n" : "");
}

export function buildSourceCoverageReadinessRetryPlan(audit: SourceCoverageReadinessAudit): SourceCoverageReadinessRetryPlan {
  const retryItems = audit.items
    .filter((item): item is SourceCoverageReadinessItem & { profileHeadedRetry: SourceCoverageReadinessProfileHeadedRetryCommand } => item.profileHeadedRetry !== undefined)
    .sort(compareRetryItems)
    .map((item, index): SourceCoverageReadinessRetryPlanItem => {
      const matchedTopRank = minimumTopRank(item);
      return {
        order: index + 1,
        platform: item.platform,
        displayName: item.displayName,
        priority: item.matchedTopSlots.length > 0 ? "top_slot_blocked" : "blocked",
        ...(matchedTopRank === undefined ? {} : { matchedTopRank }),
        supportTier: item.supportTier,
        profileName: item.profileHeadedRetry.profileName,
        browserChannel: item.profileHeadedRetry.browserChannel,
        storagePolicy: item.profileHeadedRetry.storagePolicy,
        selectorHintFiles: item.profileHeadedRetry.selectorHintFiles,
        ...(item.profileHeadedRetry.profileSetupPowerShellCommand === undefined
          ? {}
          : {
              profileSetupPowerShellCommand: item.profileHeadedRetry.profileSetupPowerShellCommand
            }),
        powershellCommand: item.profileHeadedRetry.powershellCommand,
        blockedSignalCounts: item.blockedSignalCounts,
        reasons: item.reasons,
        nextActions: item.nextActions
      };
    });
  return {
    schemaVersion: "1.0",
    executionPolicy: "profile_headed_retry_plan_only",
    query: audit.query,
    itemCount: retryItems.length,
    items: retryItems,
    warnings: [
      "Retry plans are QA handoffs; they do not execute browser actions.",
      "Run profile setup in a visible browser only when the user approves login or consent handling.",
      "Preserved selector-hints files are calibration inputs only; they do not become maintained evidence-run actions without repeated promotion."
    ]
  };
}

export function formatSourceCoverageReadinessRetryPlanAsMarkdown(audit: SourceCoverageReadinessAudit, check?: SourceCoverageReadinessRetryPlanCheck | undefined): string {
  return formatSourceCoverageReadinessRetryPlanMarkdown(buildSourceCoverageReadinessRetryPlan(audit), check);
}

export function checkSourceCoverageReadinessRetryPlan(plan: SourceCoverageReadinessRetryPlan, options: SourceCoverageReadinessRetryPlanCheckOptions = {}): SourceCoverageReadinessRetryPlanCheck {
  const issues: SourceCoverageReadinessRetryPlanCheckIssue[] = [];
  plan.items.forEach((item, index) => {
    const expectedOrder = index + 1;
    if (item.order !== expectedOrder) {
      issues.push(retryPlanIssue("error", "order_mismatch", item, `Retry item order ${item.order} should be ${expectedOrder}.`));
    }
    if (item.profileName.trim().length === 0) {
      issues.push(retryPlanIssue("error", "profile_name_missing", item, "Retry item profileName must not be empty."));
    }
    checkProfileExists(item, issues, options);
    checkRetryCommand(item, issues, options);
    checkSetupCommand(item, issues);
  });
  if (plan.items.length === 0) {
    issues.push({
      severity: "warning",
      code: "empty_retry_plan",
      message: "Retry plan has no profile/headed retry items."
    });
  }
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  return {
    schemaVersion: "1.0",
    executionPolicy: "profile_headed_retry_plan_check",
    ok: errorCount === 0,
    itemCount: plan.items.length,
    errorCount,
    warningCount,
    issues,
    warnings: [
      "Retry-plan checks validate generated command handoffs only; they do not execute browser actions.",
      "User-visible login, consent, or challenge handling still requires explicit user control.",
      ...(options.selectorHintFileExists === undefined ? [] : ["Selector-hint file existence was checked for this run."]),
      ...(options.profileExists === undefined ? [] : ["Saved browser profile existence was checked for this run."])
    ]
  };
}

export function filterSourceCoverageReadinessRetryPlan(plan: SourceCoverageReadinessRetryPlan, filter: SourceCoverageReadinessRetryPlanFilter = {}): SourceCoverageReadinessRetryPlan {
  const limit = filter.limit === undefined ? undefined : normalizeRetryPlanLimit(filter.limit);
  const filteredItems = plan.items
    .filter((item) => filter.platform === undefined || item.platform === filter.platform)
    .filter((item) => filter.priority === undefined || item.priority === filter.priority)
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      order: index + 1
    }));
  return {
    ...plan,
    itemCount: filteredItems.length,
    items: filteredItems,
    warnings: [...plan.warnings, ...(hasRetryPlanFilter(filter) ? [`Retry plan filtered from ${plan.itemCount} to ${filteredItems.length} item(s).`] : [])]
  };
}

export function filterSourceCoverageReadinessRetryPlanByCheck(plan: SourceCoverageReadinessRetryPlan, options: SourceCoverageReadinessRetryPlanCheckOptions = {}): SourceCoverageReadinessRetryPlan {
  const check = checkSourceCoverageReadinessRetryPlan(plan, options);
  const failingItemOrders = new Set(check.issues.filter((issue) => issue.severity === "error" && issue.itemOrder !== undefined).map((issue) => issue.itemOrder!));
  const filteredItems = plan.items
    .filter((item) => !failingItemOrders.has(item.order))
    .map((item, index) => ({
      ...item,
      order: index + 1
    }));
  return {
    ...plan,
    itemCount: filteredItems.length,
    items: filteredItems,
    warnings: [...plan.warnings, `Retry plan check filter removed ${plan.items.length - filteredItems.length} item(s) with preflight errors.`]
  };
}

export function formatSourceCoverageReadinessRetryPlanMarkdown(plan: SourceCoverageReadinessRetryPlan, check?: SourceCoverageReadinessRetryPlanCheck | undefined): string {
  const lines = ["# Source Coverage Profile/Headed Retry Plan", "", `- Query: ${plan.query}`, `- Retry item count: ${plan.itemCount}`, ""];
  if (plan.items.length === 0) {
    lines.push("No blocked source slots have profile/headed retry commands.", "");
  }
  for (const item of plan.items) {
    lines.push(
      `## ${item.order}. ${item.displayName} (${item.platform})`,
      "",
      `- Priority: ${item.priority}${item.matchedTopRank === undefined ? "" : `; top-slot rank ${item.matchedTopRank}`}`,
      `- Support tier: ${item.supportTier}`,
      `- Profile: ${item.profileName}`,
      `- Browser: headed ${item.browserChannel}; ${item.storagePolicy}`,
      `- Selector hints: ${item.selectorHintFiles.length === 0 ? "none" : item.selectorHintFiles.join(", ")}`,
      `- Setup: ${item.profileSetupPowerShellCommand ?? "not required"}`,
      `- Retry: ${item.powershellCommand}`,
      `- Blocked signals: ${formatBlockedSignalCounts(item.blockedSignalCounts)}`,
      `- Reasons: ${item.reasons.join(" | ") || "none"}`,
      `- Next actions: ${item.nextActions.join(" | ") || "none"}`,
      ""
    );
  }
  lines.push("## Warnings", "", ...plan.warnings.map((warning) => `- ${warning}`), "");
  if (check !== undefined) {
    appendSourceCoverageRetryPlanCheckMarkdown(lines, check);
  }
  return lines.join("\n");
}

function appendSourceCoverageRetryPlanCheckMarkdown(lines: string[], check: SourceCoverageReadinessRetryPlanCheck): void {
  lines.push("## Preflight Check", "", `- OK: ${check.ok ? "yes" : "no"}`, `- Items checked: ${check.itemCount}`, `- Errors: ${check.errorCount}`, `- Warnings: ${check.warningCount}`, "");
  if (check.issues.length === 0) {
    lines.push("No preflight check issues were found.", "");
  } else {
    lines.push("### Preflight Issues", "");
    lines.push(...check.issues.map((issue) => formatSourceCoverageRetryPlanCheckIssueMarkdown(issue)), "");
  }
  if (check.warnings.length > 0) {
    lines.push("### Preflight Notes", "");
    lines.push(...check.warnings.map((warning) => `- ${warning}`), "");
  }
}

function formatSourceCoverageRetryPlanCheckIssueMarkdown(issue: SourceCoverageReadinessRetryPlanCheckIssue): string {
  const details = [issue.severity, `\`${issue.code}\``, ...(issue.itemOrder === undefined ? [] : [`item ${issue.itemOrder}`]), ...(issue.platform === undefined ? [] : [`platform \`${issue.platform}\``])].join(" ");
  return `- ${details}: ${issue.message}`;
}

function normalizeRetryPlanLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Retry plan limit must be a positive integer");
  }
  return limit;
}

function hasRetryPlanFilter(filter: SourceCoverageReadinessRetryPlanFilter): boolean {
  return filter.platform !== undefined || filter.priority !== undefined || filter.limit !== undefined;
}

function checkRetryCommand(item: SourceCoverageReadinessRetryPlanItem, issues: SourceCoverageReadinessRetryPlanCheckIssue[], options: SourceCoverageReadinessRetryPlanCheckOptions): void {
  const command = item.powershellCommand;
  requireCommandPart(command, "source-coverage-calibrate", "retry_command_missing_calibrate", item, issues);
  requireCommandPart(command, "--platform", "retry_command_missing_platform_flag", item, issues);
  requireCommandPart(command, item.platform, "retry_command_missing_platform_value", item, issues);
  requireCommandPart(command, "--headed", "retry_command_missing_headed", item, issues);
  requireCommandPart(command, "--browser-channel", "retry_command_missing_browser_channel_flag", item, issues);
  requireCommandPart(command, item.browserChannel, "retry_command_missing_browser_channel_value", item, issues);
  requireCommandPart(command, "--profile", "retry_command_missing_profile_flag", item, issues);
  requireCommandPart(command, item.profileName, "retry_command_missing_profile_value", item, issues);
  requireCommandPart(command, "--persistent-profile", "retry_command_missing_persistent_profile", item, issues);
  for (const selectorHintFile of item.selectorHintFiles) {
    requireCommandPart(command, "--selector-hints-file", "retry_command_missing_selector_hints_flag", item, issues);
    requireCommandPart(command, selectorHintFile, "retry_command_missing_selector_hint_file", item, issues);
    if (options.selectorHintFileExists !== undefined && !options.selectorHintFileExists(selectorHintFile)) {
      issues.push(retryPlanIssue("error", "selector_hint_file_missing", item, `Selector hint file does not exist: ${selectorHintFile}.`));
    }
  }
}

function checkProfileExists(item: SourceCoverageReadinessRetryPlanItem, issues: SourceCoverageReadinessRetryPlanCheckIssue[], options: SourceCoverageReadinessRetryPlanCheckOptions): void {
  if (options.profileExists === undefined || item.profileName.trim().length === 0) {
    return;
  }
  if (!options.profileExists(item.profileName)) {
    issues.push(retryPlanIssue("error", "profile_missing", item, `Saved browser profile does not exist: ${item.profileName}. Run the setup command before the retry command.`));
  }
}

function checkSetupCommand(item: SourceCoverageReadinessRetryPlanItem, issues: SourceCoverageReadinessRetryPlanCheckIssue[]): void {
  const command = item.profileSetupPowerShellCommand;
  if (command === undefined) {
    issues.push(retryPlanIssue("warning", "setup_command_missing", item, "Retry item has no auth-login setup command."));
    return;
  }
  requireCommandPart(command, "auth-login", "setup_command_missing_auth_login", item, issues);
  requireCommandPart(command, "--profile", "setup_command_missing_profile_flag", item, issues);
  requireCommandPart(command, item.profileName, "setup_command_missing_profile_value", item, issues);
  requireCommandPart(command, "--persistent-profile", "setup_command_missing_persistent_profile", item, issues);
  requireCommandPart(command, "--browser-channel", "setup_command_missing_browser_channel_flag", item, issues);
  requireCommandPart(command, item.browserChannel, "setup_command_missing_browser_channel_value", item, issues);
  requireCommandPart(command, "--url", "setup_command_missing_url", item, issues);
}

function requireCommandPart(command: string, expected: string, code: string, item: SourceCoverageReadinessRetryPlanItem, issues: SourceCoverageReadinessRetryPlanCheckIssue[]): void {
  if (!command.includes(expected)) {
    issues.push(retryPlanIssue("error", code, item, `Command for ${item.platform} is missing ${expected}.`));
  }
}

function retryPlanIssue(severity: SourceCoverageReadinessRetryPlanCheckSeverity, code: string, item: SourceCoverageReadinessRetryPlanItem, message: string): SourceCoverageReadinessRetryPlanCheckIssue {
  return {
    severity,
    code,
    message,
    itemOrder: item.order,
    platform: item.platform
  };
}

export function formatSourceCoverageReadinessRetryPlanCommandsAsLines(plan: SourceCoverageReadinessRetryPlan, format: SourceCoverageReadinessRetryPlanCommandFormat = "commands"): string {
  const commands = plan.items.flatMap((item) => {
    const lines: string[] = [];
    if (format !== "retry-commands" && item.profileSetupPowerShellCommand !== undefined) {
      lines.push(item.profileSetupPowerShellCommand);
    }
    if (format !== "setup-commands") {
      lines.push(item.powershellCommand);
    }
    return lines;
  });
  return commands.join("\n") + (commands.length > 0 ? "\n" : "");
}

export function parseSourceCoverageReadinessRetryPlan(input: string): SourceCoverageReadinessRetryPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonBom(input));
  } catch (error) {
    throw new Error(`Invalid source coverage retry plan JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== "1.0" || parsed.executionPolicy !== "profile_headed_retry_plan_only") {
    throw new Error("Retry plan must be a source coverage profile/headed retry plan with schemaVersion 1.0");
  }
  const itemsValue = parsed.items;
  if (!Array.isArray(itemsValue)) {
    throw new Error("Retry plan items must be an array");
  }
  const items = itemsValue.map(parseRetryPlanItem);
  const itemCount = numberField(parsed, "itemCount");
  if (itemCount !== items.length) {
    throw new Error(`Retry plan itemCount ${itemCount} does not match items length ${items.length}`);
  }
  return {
    schemaVersion: "1.0",
    executionPolicy: "profile_headed_retry_plan_only",
    query: stringField(parsed, "query"),
    itemCount,
    items,
    warnings: stringArrayField(parsed, "warnings")
  };
}

export function sourceCoverageReadinessCalibrationTargets(audit: SourceCoverageReadinessAudit): SourceNavigationCalibrationBatchTarget[] {
  return audit.items.filter((item): item is SourceCoverageReadinessItem & { calibrationTarget: SourceNavigationCalibrationBatchTarget } => item.calibrationTarget !== undefined && shouldCalibrateStatus(item.status)).map((item) => item.calibrationTarget);
}

function compareRetryItems(left: SourceCoverageReadinessItem & { profileHeadedRetry: SourceCoverageReadinessProfileHeadedRetryCommand }, right: SourceCoverageReadinessItem & { profileHeadedRetry: SourceCoverageReadinessProfileHeadedRetryCommand }): number {
  const leftRank = minimumTopRank(left) ?? Number.POSITIVE_INFINITY;
  const rightRank = minimumTopRank(right) ?? Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  if (left.supportTier !== right.supportTier) {
    return right.supportTier - left.supportTier;
  }
  return left.platform.localeCompare(right.platform);
}

function minimumTopRank(item: SourceCoverageReadinessItem): number | undefined {
  if (item.matchedTopSlots.length === 0) {
    return undefined;
  }
  return Math.min(...item.matchedTopSlots.map((slot) => slot.rank));
}

function buildReadinessItem(
  entry: SourceRegistryEntry,
  input: {
    category?: InformationCategory | undefined;
    locale?: LocaleSegment | undefined;
    query: string;
    topRankMax?: number | undefined;
    promotionGroups: SourceNavigationPromotionGroupReview[];
  }
): SourceCoverageReadinessItem {
  const matchedTopSlots = matchingTopSlots(entry, input.category, input.locale, input.topRankMax);
  const matchingPromotionGroups = matchingGroups(entry, input.promotionGroups);
  const status = classifyEntry(entry, matchingPromotionGroups);
  const calibrationTarget = calibrationTargetFor(entry, input.query, input.category, input.locale);
  const retryUrl = calibrationTarget?.url ?? matchingPromotionGroups[0]?.url;
  const selectorHintFiles = selectorHintFilesForGroups(matchingPromotionGroups);
  const blockedSignalCounts = blockedSignalCountsForGroups(matchingPromotionGroups);
  const profileHeadedRetry = status === "blocked" ? buildProfileHeadedRetryCommand(entry.platform, input.query, retryUrl, selectorHintFiles) : undefined;
  const destinationExtraction = destinationExtractionReadinessFor({
    calibrationTarget,
    matchingPromotionGroups,
    sourceStatus: status
  });
  return {
    platform: entry.platform,
    displayName: entry.displayName,
    status,
    supportTier: entry.supportTier,
    evidenceRole: entry.evidenceRole,
    informationCategories: entry.informationCategories,
    sourceFamilies: entry.sourceFamilies,
    localeSegments: entry.localeSegments,
    matchedTopSlots,
    reasons: reasonsForEntry(entry, status, matchingPromotionGroups),
    nextActions: nextActionsForStatus(status),
    matchedPromotionGroups: matchingPromotionGroups,
    blockedSignalCounts,
    destinationExtraction,
    ...(calibrationTarget === undefined ? {} : { calibrationTarget }),
    ...(profileHeadedRetry === undefined ? {} : { profileHeadedRetry })
  };
}

function blockedSignalCountsForGroups(groups: SourceNavigationPromotionGroupReview[]): SourceNavigationBlockedSignalCount[] {
  const grouped = new Map<string, { count: number; actionKeys: Set<string> }>();
  for (const group of groups) {
    for (const item of group.blockedSignalCounts) {
      const existing = grouped.get(item.signal) ?? { count: 0, actionKeys: new Set<string>() };
      existing.count += item.count;
      for (const actionKey of item.actionKeys) {
        existing.actionKeys.add(actionKey);
      }
      grouped.set(item.signal, existing);
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
  if (counts.length === 0) {
    return "none recorded";
  }
  return counts
    .slice(0, 8)
    .map((entry) => `${entry.signal}:${entry.count}${entry.actionKeys.length === 0 ? "" : ` (${entry.actionKeys.join(",")})`}`)
    .join(", ");
}

function destinationExtractionReadinessFor(input: { calibrationTarget: SourceNavigationCalibrationBatchTarget | undefined; matchingPromotionGroups: SourceNavigationPromotionGroupReview[]; sourceStatus: SourceCoverageReadinessStatus }): SourceCoverageDestinationExtractionReadiness {
  const plannedCandidateCount = input.calibrationTarget === undefined ? 0 : destinationExtractionCandidateCountForUrl(input.calibrationTarget.url);
  const merged = mergeDestinationExtractionSummaries(input.matchingPromotionGroups.map((group) => group.destinationExtraction));
  const selectorHintFiles = uniqueStrings(input.matchingPromotionGroups.flatMap((group) => (group.files.selectorHints === undefined ? [] : [group.files.selectorHints])));
  const candidateCount = Math.max(plannedCandidateCount, merged.candidateCount);
  const base = {
    candidateCount,
    readyActionCount: merged.readyActionCount,
    readyActionKeys: merged.readyActionKeys,
    maintainedReadyCount: merged.maintainedReadyCount,
    singleRunReadyCount: merged.singleRunReadyCount,
    calibrationRequiredCount: merged.calibrationRequiredCount,
    blockedCount: merged.blockedCount,
    discoveryRunCount: merged.discoveryRunCount,
    discoveryPromotableCandidateCount: merged.discoveryPromotableCandidateCount,
    discoveryNonPromotableCandidateCount: merged.discoveryNonPromotableCandidateCount,
    discoverySelectorHintCount: merged.discoverySelectorHintCount,
    selectorHintFiles,
    discoveryWarningCounts: merged.discoveryWarningCounts,
    clientStateProbeRunCount: merged.clientStateProbeRunCount,
    clientStateProbeOkRunCount: merged.clientStateProbeOkRunCount,
    clientStateProbeUniqueCandidateCount: merged.clientStateProbeUniqueCandidateCount
  };

  if (candidateCount === 0) {
    return {
      status: "not_applicable",
      ...base,
      reasons: ["No destination-extraction candidate is planned for this source slot."],
      nextActions: []
    };
  }

  if (input.matchingPromotionGroups.length === 0) {
    return {
      status: "not_promoted",
      ...base,
      reasons: ["Destination extraction candidates exist, but no matching promotion summary was supplied."],
      nextActions: ["Run repeated read-only calibration and promotion, then verify whether destination-extraction actions are exported."]
    };
  }

  if (merged.readyActionCount > 0) {
    return {
      status: "ready",
      ...base,
      reasons: [`${merged.readyActionCount} maintained destination-extraction action(s) are ready for explicit evidence-run execution.`],
      nextActions: ["Review the promoted actions file and run evidence-run with source navigation enabled."]
    };
  }

  if (input.sourceStatus === "blocked" || merged.blockedCount > 0) {
    return {
      status: "blocked",
      ...base,
      reasons: ["Destination extraction could not be promoted because calibration saw browser-visible blocked signals."],
      nextActions: ["Retry calibration with profile/headed runtime when user-visible login, consent, or bot-check handling is required."]
    };
  }

  return {
    status: "needs_repeated_calibration",
    ...base,
    reasons: ["Destination extraction candidates exist, but no maintained destination-extraction action has been promoted yet.", ...destinationDiscoveryReadinessReasons(merged)],
    nextActions: ["Run repeated read-only calibration until stable destination selectors can be promoted.", ...destinationDiscoveryNextActions(merged)]
  };
}

function destinationExtractionCandidateCountForUrl(url: string): number {
  try {
    const sourceStrategy = describeSourceStrategy(url);
    const sourceNavigationPlan = describeSourceNavigationPlan({ sourceStrategy });
    const recipePlan = describeSourceNavigationRecipePlan(sourceNavigationPlan);
    return recipePlan.actionCandidates.filter((candidate) => isDestinationExtractionOperation(candidate.operation)).length;
  } catch {
    return 0;
  }
}

function isDestinationExtractionOperation(operation: string): boolean {
  return operation === "extract_destinations" || operation === "extract_client_state_destinations";
}

function mergeDestinationExtractionSummaries(summaries: SourceNavigationDestinationExtractionPromotionSummary[]): SourceNavigationDestinationExtractionPromotionSummary {
  const readyActionKeys = new Set<string>();
  const merged: SourceNavigationDestinationExtractionPromotionSummary = {
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
  for (const summary of summaries) {
    merged.candidateCount += summary.candidateCount;
    merged.readyActionCount += summary.readyActionCount;
    merged.maintainedReadyCount += summary.maintainedReadyCount;
    merged.singleRunReadyCount += summary.singleRunReadyCount;
    merged.calibrationRequiredCount += summary.calibrationRequiredCount;
    merged.blockedCount += summary.blockedCount;
    merged.manualReviewCount += summary.manualReviewCount;
    merged.manualValueCount += summary.manualValueCount;
    merged.discoveryRunCount += summary.discoveryRunCount ?? 0;
    merged.discoveryPromotableCandidateCount += summary.discoveryPromotableCandidateCount ?? 0;
    merged.discoveryNonPromotableCandidateCount += summary.discoveryNonPromotableCandidateCount ?? 0;
    merged.discoverySelectorHintCount += summary.discoverySelectorHintCount ?? 0;
    merged.clientStateProbeRunCount += summary.clientStateProbeRunCount ?? 0;
    merged.clientStateProbeOkRunCount += summary.clientStateProbeOkRunCount ?? 0;
    merged.clientStateProbeUniqueCandidateCount += summary.clientStateProbeUniqueCandidateCount ?? 0;
    merged.discoveryWarningCounts = mergeWarningCounts([...merged.discoveryWarningCounts, ...(summary.discoveryWarningCounts ?? [])]);
    for (const actionKey of summary.readyActionKeys) {
      readyActionKeys.add(actionKey);
    }
  }
  merged.readyActionKeys = [...readyActionKeys].sort();
  return merged;
}

function destinationDiscoveryReadinessReasons(merged: SourceNavigationDestinationExtractionPromotionSummary): string[] {
  if (merged.discoveryPromotableCandidateCount > 0) {
    return [`Global destination discovery found ${merged.discoveryPromotableCandidateCount} promotable destination target(s) and ${merged.discoverySelectorHintCount} selector hint(s), but the maintained selector catalog has not captured them yet.`];
  }
  if (merged.discoveryNonPromotableCandidateCount > 0) {
    const warningText = merged.discoveryWarningCounts.length === 0 ? "no warning counts" : merged.discoveryWarningCounts.map((entry) => `${entry.warning}:${entry.count}`).join(", ");
    return [`Global destination discovery found only non-promotable destination target(s); warning pressure: ${warningText}.`];
  }
  return [];
}

function destinationDiscoveryNextActions(merged: SourceNavigationDestinationExtractionPromotionSummary): string[] {
  if (merged.discoveryPromotableCandidateCount > 0) {
    return ["Inspect catalog destinationDiscovery selector hints and sample targets, add narrower provider selectors, then rerun repeated calibration and promotion."];
  }
  if (merged.discoveryNonPromotableCandidateCount > 0) {
    return ["Inspect provider-shell/login/low-value warning counts before adding any destination selector candidate."];
  }
  return [];
}

function mergeWarningCounts(warnings: Array<{ warning: string; count: number }>): Array<{ warning: string; count: number }> {
  const counts = new Map<string, number>();
  for (const warning of warnings) {
    counts.set(warning.warning, (counts.get(warning.warning) ?? 0) + warning.count);
  }
  return [...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([warning, count]) => ({ warning, count }));
}

function selectorHintFilesForGroups(groups: SourceNavigationPromotionGroupReview[]): string[] {
  return uniqueStrings(groups.flatMap((group) => (group.files.selectorHints === undefined ? [] : [group.files.selectorHints])));
}

function classifyEntry(entry: SourceRegistryEntry, matchingPromotionGroups: SourceNavigationPromotionGroupReview[]): SourceCoverageReadinessStatus {
  if (entry.evidenceRole === "user_controlled") {
    return "skipped_private";
  }
  if (entry.evidenceRole === "derivative") {
    return "skipped_derivative";
  }
  if (entry.evidenceRole === "planning_only" || entry.supportTier === 0) {
    return "planning_only";
  }
  const promotionStatus = bestPromotionStatus(matchingPromotionGroups);
  if (promotionStatus === undefined) {
    return "not_promoted";
  }
  if (promotionStatus === "empty") {
    return "promoted_empty";
  }
  return promotionStatus;
}

function bestPromotionStatus(groups: SourceNavigationPromotionGroupReview[]): SourceNavigationPromotionReviewStatus | undefined {
  for (const status of PROMOTION_STATUS_ORDER) {
    if (groups.some((group) => group.status === status)) {
      return status;
    }
  }
  return undefined;
}

function matchingGroups(entry: SourceRegistryEntry, groups: SourceNavigationPromotionGroupReview[]): SourceNavigationPromotionGroupReview[] {
  return groups.filter((group) => group.platform === entry.platform && entry.sourceFamilies.includes(group.sourceFamily));
}

function reasonsForEntry(entry: SourceRegistryEntry, status: SourceCoverageReadinessStatus, matchingPromotionGroups: SourceNavigationPromotionGroupReview[]): string[] {
  if (status === "ready") {
    return ["At least one matching promotion group has maintained explicit read-only actions."];
  }
  if (status === "skipped_private") {
    return ["Private or messenger-like sources require explicit user-visible capture and are excluded from unattended calibration."];
  }
  if (status === "skipped_derivative") {
    return ["AI answer/search sources are derivative evidence; follow their cited primary sources before final factual claims."];
  }
  if (status === "planning_only") {
    return ["This registry entry is planning-only or support tier 0 until a user-controlled workflow is designed."];
  }
  if (matchingPromotionGroups.length === 0) {
    return [`No promotion summary group matched ${entry.platform} with source families ${entry.sourceFamilies.join(", ")}.`];
  }
  return matchingPromotionGroups.flatMap((group) => group.reasons);
}

function nextActionsForStatus(status: SourceCoverageReadinessStatus): string[] {
  switch (status) {
    case "ready":
      return ["Review catalog/export artifacts, then run the generated evidence-run command from promotion review."];
    case "blocked":
      return ["Inspect obstruction or blocked-signal artifacts, then retry calibration with the generated profile/headed command when user-visible login, consent, or bot-check handling is required."];
    case "needs_repeated_calibration":
      return ["Run repeated read-only calibration for the target, then promote the batch again."];
    case "manual_review_required":
      return ["Manually review click/value actions; keep maintained export limited to read-only recipes."];
    case "promoted_empty":
      return ["Inspect catalog/export reasons; add fixture coverage or repeated calibration before retrying promotion."];
    case "not_promoted":
      return ["Generate calibration targets, run source-navigation-calibrate-batch, then promote the resulting manifest."];
    case "skipped_derivative":
      return ["Use derivative results only as source-discovery hints and capture primary source artifacts separately."];
    case "skipped_private":
      return ["Use explicit user-controlled visible capture only; do not run unattended batch calibration."];
    case "planning_only":
      return ["Design a supported capture workflow before adding this source to unattended QA."];
  }
}

function buildProfileHeadedRetryCommand(platform: SourcePlatform, query: string, profileSetupUrl: string | undefined, selectorHintFiles: string[] = []): SourceCoverageReadinessProfileHeadedRetryCommand {
  const profileName = `${safeProfileName(platform)}-profile`;
  const profileSetupArgv = profileSetupUrl === undefined ? undefined : ["node", ".\\dist\\cli.js", "auth-login", "--profile", profileName, "--url", profileSetupUrl, "--wait-ms", "120000", "--browser-channel", "chrome", "--persistent-profile"];
  const argv = ["node", ".\\dist\\cli.js", "source-coverage-calibrate", "--platform", platform, "--query", query, "--repeat", "2", "--headed", "--browser-channel", "chrome", "--profile", profileName, "--persistent-profile", ...selectorHintFiles.flatMap((file) => ["--selector-hints-file", file])];
  return {
    strategy: "profile_headed_calibration",
    profileName,
    storagePolicy: "persistent-profile",
    browserChannel: "chrome",
    selectorHintFiles,
    ...(profileSetupUrl === undefined ? {} : { profileSetupUrl }),
    ...(profileSetupArgv === undefined
      ? {}
      : {
          profileSetupArgv,
          profileSetupPowerShellCommand: profileSetupArgv.map(quotePowerShellArg).join(" ")
        }),
    argv,
    powershellCommand: argv.map(quotePowerShellArg).join(" ")
  };
}

function safeProfileName(platform: SourcePlatform): string {
  return (
    platform
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "source"
  );
}

function calibrationTargetFor(entry: SourceRegistryEntry, query: string, category: InformationCategory | undefined, locale: LocaleSegment | undefined): SourceNavigationCalibrationBatchTarget | undefined {
  const plan = buildSourceNavigationCalibrationTargetPlan({
    platform: entry.platform,
    category,
    locale,
    query,
    limit: 1
  });
  return plan.targets[0];
}

function matchingTopSlots(entry: SourceRegistryEntry, category: InformationCategory | undefined, locale: LocaleSegment | undefined, topRankMax: number | undefined): SourceRegistryTopSlot[] {
  return entry.topSlots.filter((slot) => (category === undefined || slot.category === category) && (locale === undefined || slot.segment === locale) && (topRankMax === undefined || slot.rank <= topRankMax));
}

function matchesTopRank(entry: SourceRegistryEntry, category: InformationCategory | undefined, locale: LocaleSegment | undefined, topRankMax: number | undefined): boolean {
  if (topRankMax === undefined) {
    return true;
  }
  return matchingTopSlots(entry, category, locale, topRankMax).length > 0;
}

function sortEntries(entries: SourceRegistryEntry[], category: InformationCategory | undefined, locale: LocaleSegment | undefined): SourceRegistryEntry[] {
  return [...entries].sort((left, right) => {
    const leftRank = rankingScore(left, category, locale);
    const rightRank = rankingScore(right, category, locale);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    if (left.supportTier !== right.supportTier) {
      return right.supportTier - left.supportTier;
    }
    return left.platform.localeCompare(right.platform);
  });
}

function rankingScore(entry: SourceRegistryEntry, category: InformationCategory | undefined, locale: LocaleSegment | undefined): number {
  const slots = matchingTopSlots(entry, category, locale, undefined);
  if (slots.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.min(...slots.map((slot) => slot.rank));
}

function normalizeTopRankMax(topRankMax: number | undefined, category: InformationCategory | undefined, locale: LocaleSegment | undefined): number | undefined {
  if (topRankMax === undefined) {
    return category !== undefined && locale !== undefined ? 3 : undefined;
  }
  if (!Number.isInteger(topRankMax) || topRankMax < 1 || topRankMax > 50) {
    throw new Error("Coverage readiness top rank must be an integer between 1 and 50.");
  }
  return topRankMax;
}

function defaultCoverageQuery(category: InformationCategory | undefined, locale: LocaleSegment | undefined, sourceFamily: SourceFamily | undefined): string {
  if (locale === "ko-KR" && (category === "map_local" || category === "review_reputation" || sourceFamily === "map")) {
    return "seongsu cafe";
  }
  if (category === "marketplace_transaction" || sourceFamily === "travel_booking") {
    return locale === "ko-KR" ? "seoul hotel" : "Seoul hotel";
  }
  if (category === "social_feed" || category === "content_media" || sourceFamily === "video_social") {
    return "tokyo travel";
  }
  if (locale === "ko-KR") {
    return "seoul hotel";
  }
  if (locale === "ja-JP") {
    return "tokyo hotel";
  }
  return "tokyo hotel";
}

function countStatuses(items: SourceCoverageReadinessItem[]): Record<SourceCoverageReadinessStatus, number> {
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<SourceCoverageReadinessStatus, number>;
  for (const item of items) {
    counts[item.status] += 1;
  }
  return counts;
}

function countDestinationExtractionStatuses(items: SourceCoverageReadinessItem[]): Record<SourceCoverageDestinationExtractionReadinessStatus, number> {
  const counts = Object.fromEntries(DESTINATION_EXTRACTION_STATUS_ORDER.map((status) => [status, 0])) as Record<SourceCoverageDestinationExtractionReadinessStatus, number>;
  for (const item of items) {
    counts[item.destinationExtraction.status] += 1;
  }
  return counts;
}

function isActionableStatus(status: SourceCoverageReadinessStatus): boolean {
  return status !== "skipped_derivative" && status !== "skipped_private" && status !== "planning_only";
}

function shouldCalibrateStatus(status: SourceCoverageReadinessStatus): boolean {
  return status === "not_promoted" || status === "needs_repeated_calibration" || status === "promoted_empty" || status === "blocked";
}

function quotePowerShellArg(value: string): string {
  return value.startsWith("--") || value === "node" || value === ".\\dist\\cli.js" || value === "source-coverage-calibrate" || value === "auth-login" ? value : quotePowerShellValue(value);
}

function quotePowerShellValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseRetryPlanItem(value: unknown): SourceCoverageReadinessRetryPlanItem {
  if (!isRecord(value)) {
    throw new Error("Retry plan items must be objects");
  }
  const priority = stringField(value, "priority");
  if (priority !== "top_slot_blocked" && priority !== "blocked") {
    throw new Error(`Unsupported retry plan priority: ${priority}`);
  }
  const browserChannel = stringField(value, "browserChannel");
  if (browserChannel !== "chrome") {
    throw new Error(`Unsupported retry plan browser channel: ${browserChannel}`);
  }
  const storagePolicy = stringField(value, "storagePolicy");
  if (storagePolicy !== "persistent-profile") {
    throw new Error(`Unsupported retry plan storage policy: ${storagePolicy}`);
  }
  const matchedTopRank = optionalNumberField(value, "matchedTopRank");
  const profileSetupPowerShellCommand = optionalStringField(value, "profileSetupPowerShellCommand");
  return {
    order: numberField(value, "order"),
    platform: stringField(value, "platform") as SourcePlatform,
    displayName: stringField(value, "displayName"),
    priority,
    ...(matchedTopRank === undefined ? {} : { matchedTopRank }),
    supportTier: numberField(value, "supportTier") as SourceSupportTier,
    profileName: stringField(value, "profileName"),
    browserChannel,
    storagePolicy,
    selectorHintFiles: stringArrayField(value, "selectorHintFiles"),
    ...(profileSetupPowerShellCommand === undefined ? {} : { profileSetupPowerShellCommand }),
    powershellCommand: stringField(value, "powershellCommand"),
    blockedSignalCounts: parseBlockedSignalCounts(value.blockedSignalCounts),
    reasons: stringArrayField(value, "reasons"),
    nextActions: stringArrayField(value, "nextActions")
  };
}

function parseBlockedSignalCounts(value: unknown): SourceNavigationBlockedSignalCount[] {
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

function stripJsonBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return fieldValue;
}

function optionalStringField(value: Record<string, unknown>, field: string): string | undefined {
  const fieldValue = value[field];
  if (fieldValue === undefined) {
    return undefined;
  }
  if (typeof fieldValue !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return fieldValue;
}

function numberField(value: Record<string, unknown>, field: string): number {
  const fieldValue = value[field];
  if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
    throw new Error(`${field} must be a finite number`);
  }
  return fieldValue;
}

function optionalNumberField(value: Record<string, unknown>, field: string): number | undefined {
  const fieldValue = value[field];
  if (fieldValue === undefined) {
    return undefined;
  }
  if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
    throw new Error(`${field} must be a finite number`);
  }
  return fieldValue;
}

function stringArrayField(value: Record<string, unknown>, field: string): string[] {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue) || fieldValue.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return fieldValue;
}
