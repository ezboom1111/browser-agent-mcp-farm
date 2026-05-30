import { readdir, readFile } from "node:fs/promises";
import { unique as uniqueStrings } from "./util/collections.js";
import { join, resolve, sep } from "node:path";
import type { DestinationBlockedChildRecoveryAdvice, DestinationBlockedChildRecoveryCandidateSummary } from "./destination-triage.js";

export type DestinationRecoveryPlanCommandFormat =
  | "commands"
  | "setup-commands"
  | "retry-commands";

export interface DestinationRecoveryPlanItem {
  order: number;
  artifactId?: string | undefined;
  artifactPath: string;
  sourceUrl?: string | undefined;
  adviceSource: "artifact_advice" | "recovery_candidates";
  synthesized: boolean;
  profileName: string;
  browserChannel: "chrome";
  storagePolicy: "persistent-profile";
  candidateCount: number;
  sampleUrls: string[];
  profileSetupUrl: string;
  recoveryUrl: string;
  advice: DestinationBlockedChildRecoveryAdvice;
}

export interface DestinationRecoveryPlan {
  schemaVersion: "1.0";
  executionPolicy: "destination_blocked_child_recovery_plan_only";
  runDir: string;
  itemCount: number;
  items: DestinationRecoveryPlanItem[];
  warnings: string[];
}

export type DestinationRecoveryPlanCheckSeverity = "error" | "warning";

export interface DestinationRecoveryPlanCheckIssue {
  severity: DestinationRecoveryPlanCheckSeverity;
  code: string;
  message: string;
  itemOrder?: number | undefined;
  profileName?: string | undefined;
}

export interface DestinationRecoveryPlanCheck {
  schemaVersion: "1.0";
  executionPolicy: "destination_blocked_child_recovery_plan_check";
  ok: boolean;
  itemCount: number;
  errorCount: number;
  warningCount: number;
  issues: DestinationRecoveryPlanCheckIssue[];
  warnings: string[];
}

export interface DestinationRecoveryPlanCheckOptions {
  profileExists?: ((profileName: string) => boolean) | undefined;
}

interface ArtifactLedgerRecord {
  artifact_id?: unknown;
  path?: unknown;
  kind?: unknown;
  format?: unknown;
  source_url?: unknown;
  tool_name?: unknown;
  evidence_kind?: unknown;
}

interface ExtractedBlockedChildRecoveryAdvice {
  advice: DestinationBlockedChildRecoveryAdvice;
  synthesized: boolean;
}

export async function buildDestinationRecoveryPlanFromRunDir(runDir: string): Promise<DestinationRecoveryPlan> {
  const resolvedRunDir = resolve(runDir);
  const warnings: string[] = [];
  const artifactPaths = await candidateDestinationTriageArtifactPaths(resolvedRunDir, warnings);
  const items: DestinationRecoveryPlanItem[] = [];
  const seenCommands = new Set<string>();

  for (const artifact of artifactPaths) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripLeadingBom(await readFile(artifact.path, "utf8")));
    } catch (error) {
      warnings.push(`Skipped invalid destination triage artifact ${artifact.path}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const extracted = extractBlockedChildRecoveryAdvice(parsed);
    if (extracted === undefined) {
      continue;
    }
    const advice = extracted.advice;
    if (extracted.synthesized) {
      warnings.push(`Synthesized blocked child recovery advice from recovery candidates in ${artifact.path}.`);
    }
    const dedupeKey = advice.evidenceRunPowerShellCommand;
    if (seenCommands.has(dedupeKey)) {
      continue;
    }
    seenCommands.add(dedupeKey);
    items.push({
      order: items.length + 1,
      ...(artifact.artifactId === undefined ? {} : { artifactId: artifact.artifactId }),
      artifactPath: artifact.path,
      ...(artifact.sourceUrl === undefined ? {} : { sourceUrl: artifact.sourceUrl }),
      adviceSource: extracted.synthesized ? "recovery_candidates" : "artifact_advice",
      synthesized: extracted.synthesized,
      profileName: advice.profileName,
      browserChannel: advice.browserChannel,
      storagePolicy: advice.storagePolicy,
      candidateCount: advice.candidateCount,
      sampleUrls: advice.sampleUrls,
      profileSetupUrl: advice.profileSetupUrl,
      recoveryUrl: advice.recoveryUrl,
      advice
    });
  }

  if (items.length === 0) {
    warnings.push(`No blocked child recovery advice was found under ${resolvedRunDir}.`);
  }

  return {
    schemaVersion: "1.0",
    executionPolicy: "destination_blocked_child_recovery_plan_only",
    runDir: resolvedRunDir,
    itemCount: items.length,
    items,
    warnings
  };
}

export function formatDestinationRecoveryPlanCommandsAsLines(
  plan: DestinationRecoveryPlan,
  format: DestinationRecoveryPlanCommandFormat = "commands"
): string {
  const lines: string[] = [];
  for (const item of plan.items) {
    for (const step of item.advice.steps) {
      if (format === "setup-commands" && step.step !== "profile_setup") {
        continue;
      }
      if (format === "retry-commands" && step.step !== "recovery_evidence_run") {
        continue;
      }
      lines.push(step.powershellCommand);
    }
  }
  return `${lines.join("\n")}${lines.length === 0 ? "" : "\n"}`;
}

export function formatDestinationRecoveryPlanMarkdown(
  plan: DestinationRecoveryPlan,
  check?: DestinationRecoveryPlanCheck | undefined
): string {
  const lines = [
    "# Destination Blocked Child Recovery Plan",
    "",
    `Run dir: ${plan.runDir}`,
    `Items: ${plan.itemCount}`,
    ""
  ];
  if (plan.items.length === 0) {
    lines.push("No blocked child recovery advice was found.", "");
  }
  for (const item of plan.items) {
    lines.push(
      `## ${item.order}. ${item.profileName}`,
      "",
      `- Artifact: ${item.artifactPath}`,
      `- Advice source: ${item.adviceSource}${item.synthesized ? " (synthesized)" : ""}`,
      `- Browser: headed ${item.browserChannel}; ${item.storagePolicy}`,
      `- Setup URL: ${item.profileSetupUrl}`,
      `- Recovery URL: ${item.recoveryUrl}`,
      `- Candidates: ${item.candidateCount}`,
      `- Reasons: ${item.advice.reasons.join(", ")}`,
      ""
    );
    for (const step of item.advice.steps) {
      lines.push(
        `### ${step.step}`,
        "",
        step.purpose,
        "",
        "```powershell",
        step.powershellCommand,
        "```",
        ""
      );
    }
  }
  if (plan.warnings.length > 0) {
    lines.push("## Warnings", "");
    lines.push(...plan.warnings.map((warning) => `- ${warning}`), "");
  }
  if (check !== undefined) {
    appendDestinationRecoveryPlanCheckMarkdown(lines, check);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function checkDestinationRecoveryPlan(
  plan: DestinationRecoveryPlan,
  options: DestinationRecoveryPlanCheckOptions = {}
): DestinationRecoveryPlanCheck {
  const issues: DestinationRecoveryPlanCheckIssue[] = [];
  plan.items.forEach((item, index) => {
    const expectedOrder = index + 1;
    if (item.order !== expectedOrder) {
      issues.push(recoveryPlanIssue("error", "order_mismatch", item, `Recovery item order ${item.order} should be ${expectedOrder}.`));
    }
    if (item.profileName.trim().length === 0) {
      issues.push(recoveryPlanIssue("error", "profile_name_missing", item, "Recovery item profileName must not be empty."));
    }
    checkRecoveryProfileExists(item, issues, options);
    checkRecoverySetupStep(item, issues);
    checkRecoveryEvidenceRunStep(item, issues);
  });
  if (plan.items.length === 0) {
    issues.push({
      severity: "warning",
      code: "empty_recovery_plan",
      message: "Recovery plan has no blocked-child recovery items."
    });
  }
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  return {
    schemaVersion: "1.0",
    executionPolicy: "destination_blocked_child_recovery_plan_check",
    ok: errorCount === 0,
    itemCount: plan.items.length,
    errorCount,
    warningCount,
    issues,
    warnings: [
      "Destination recovery checks validate command handoffs only; they do not execute browser actions.",
      "User-visible login, consent, or challenge handling still requires explicit user control.",
      ...(options.profileExists === undefined ? [] : ["Saved browser profile existence was checked for this run."])
    ]
  };
}

export function filterDestinationRecoveryPlanByCheck(
  plan: DestinationRecoveryPlan,
  options: DestinationRecoveryPlanCheckOptions = {}
): DestinationRecoveryPlan {
  const check = checkDestinationRecoveryPlan(plan, options);
  const failingItemOrders = new Set(check.issues
    .filter((issue) => issue.severity === "error" && issue.itemOrder !== undefined)
    .map((issue) => issue.itemOrder!));
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
    warnings: [
      ...plan.warnings,
      `Recovery plan check filter removed ${plan.items.length - filteredItems.length} item(s) with preflight errors.`
    ]
  };
}

function appendDestinationRecoveryPlanCheckMarkdown(lines: string[], check: DestinationRecoveryPlanCheck): void {
  lines.push(
    "## Preflight Check",
    "",
    `- OK: ${check.ok ? "yes" : "no"}`,
    `- Items checked: ${check.itemCount}`,
    `- Errors: ${check.errorCount}`,
    `- Warnings: ${check.warningCount}`,
    ""
  );
  if (check.issues.length === 0) {
    lines.push("No preflight check issues were found.", "");
  } else {
    lines.push("### Preflight Issues", "");
    lines.push(...check.issues.map((issue) => formatDestinationRecoveryPlanCheckIssueMarkdown(issue)), "");
  }
  if (check.warnings.length > 0) {
    lines.push("### Preflight Notes", "");
    lines.push(...check.warnings.map((warning) => `- ${warning}`), "");
  }
}

function formatDestinationRecoveryPlanCheckIssueMarkdown(issue: DestinationRecoveryPlanCheckIssue): string {
  const details = [
    issue.severity,
    `\`${issue.code}\``,
    ...(issue.itemOrder === undefined ? [] : [`item ${issue.itemOrder}`]),
    ...(issue.profileName === undefined ? [] : [`profile \`${issue.profileName}\``])
  ].join(" ");
  return `- ${details}: ${issue.message}`;
}

async function candidateDestinationTriageArtifactPaths(
  runDir: string,
  warnings: string[]
): Promise<Array<{ artifactId?: string; path: string; sourceUrl?: string }>> {
  const manifestCandidates = await candidateArtifactPathsFromManifest(runDir, warnings);
  if (manifestCandidates.length > 0) {
    return manifestCandidates;
  }
  return (await fallbackDestinationTriagePaths(runDir)).map((path) => ({ path }));
}

async function candidateArtifactPathsFromManifest(
  runDir: string,
  warnings: string[]
): Promise<Array<{ artifactId?: string; path: string; sourceUrl?: string }>> {
  let text: string;
  const manifestPath = join(runDir, "artifacts.jsonl");
  try {
    text = await readFile(manifestPath, "utf8");
  } catch {
    warnings.push(`Could not read ${manifestPath}; falling back to raw/structured artifact discovery.`);
    return [];
  }

  const rawText: Array<{ artifactId?: string; path: string; sourceUrl?: string }> = [];
  const structured: Array<{ artifactId?: string; path: string; sourceUrl?: string }> = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    let parsed: ArtifactLedgerRecord;
    try {
      parsed = JSON.parse(stripLeadingBom(line)) as ArtifactLedgerRecord;
    } catch (error) {
      warnings.push(`Skipped invalid artifacts.jsonl line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!isDestinationTriageRecord(parsed) || typeof parsed.path !== "string") {
      continue;
    }
    let path: string;
    try {
      path = resolveInside(runDir, parsed.path);
    } catch (error) {
      warnings.push(`Skipped destination triage artifact outside run dir: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const item = {
      ...(typeof parsed.artifact_id === "string" ? { artifactId: parsed.artifact_id } : {}),
      path,
      ...(typeof parsed.source_url === "string" ? { sourceUrl: parsed.source_url } : {})
    };
    if (parsed.kind === "text" || parsed.format === "txt" || parsed.path.toLowerCase().endsWith(".txt")) {
      rawText.push(item);
    } else {
      structured.push(item);
    }
  }
  return uniquePathItems(rawText.length > 0 ? rawText : structured);
}

function isDestinationTriageRecord(record: ArtifactLedgerRecord): boolean {
  return record.evidence_kind === "destination_triage" || record.tool_name === "destination_triage";
}

async function fallbackDestinationTriagePaths(runDir: string): Promise<string[]> {
  const paths = [
    ...await findDestinationTriageFiles(join(runDir, "raw"), 0),
    ...await findDestinationTriageFiles(join(runDir, "structured"), 0)
  ];
  const rawText = paths.filter((path) => path.toLowerCase().endsWith(".txt"));
  return uniqueStrings(rawText.length > 0 ? rawText : paths);
}

async function findDestinationTriageFiles(dir: string, depth: number): Promise<string[]> {
  if (depth > 4) {
    return [];
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await findDestinationTriageFiles(path, depth + 1));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name.toLowerCase();
    if (name.includes("destination-triage") && (name.endsWith(".txt") || name.endsWith(".json"))) {
      paths.push(path);
    }
  }
  return paths;
}

function extractBlockedChildRecoveryAdvice(value: unknown): ExtractedBlockedChildRecoveryAdvice | undefined {
  const candidates = [
    value,
    recordValue(value, "destinationTriage"),
    recordValue(recordValue(value, "metadata"), "destinationTriage")
  ];
  for (const candidate of candidates) {
    const summary = recordValue(candidate, "summary");
    const advice = recordValue(summary, "blockedChildRecoveryAdvice");
    if (isDestinationBlockedChildRecoveryAdvice(advice)) {
      return { advice, synthesized: false };
    }
    const synthesized = synthesizeBlockedChildRecoveryAdvice(summary);
    if (synthesized !== undefined) {
      return { advice: synthesized, synthesized: true };
    }
  }
  return undefined;
}

function synthesizeBlockedChildRecoveryAdvice(summary: unknown): DestinationBlockedChildRecoveryAdvice | undefined {
  const candidateValues = recordValue(summary, "blockedChildRecoveryCandidates");
  if (!Array.isArray(candidateValues)) {
    return undefined;
  }
  const candidates = candidateValues.filter(isDestinationBlockedChildRecoveryCandidateSummary);
  const first = candidates[0];
  if (first === undefined) {
    return undefined;
  }
  const candidateCountValue = recordValue(summary, "blockedChildRecoveryCandidateCount");
  const candidateCount = typeof candidateCountValue === "number" && Number.isFinite(candidateCountValue) && candidateCountValue > 0
    ? candidateCountValue
    : candidates.length;
  const profileName = `${safeProfileName(first.domain)}-recovery-profile`;
  const sampleUrls = [...new Set(candidates.map((candidate) => candidate.url))].slice(0, 5);
  const profileSetupArgv = [
    "node",
    ".\\dist\\cli.js",
    "auth-login",
    "--profile",
    profileName,
    "--url",
    first.childUrl,
    "--wait-ms",
    "120000",
    "--browser-channel",
    "chrome",
    "--persistent-profile"
  ];
  const evidenceRunArgv = [
    "node",
    ".\\dist\\cli.js",
    "evidence-run",
    "--url",
    first.url,
    "--wait-ms",
    "3000",
    "--timeout-ms",
    "30000",
    "--headed",
    "--browser-channel",
    "chrome",
    "--profile",
    profileName,
    "--persistent-profile",
    "--no-frames"
  ];
  const profileSetupPowerShellCommand = profileSetupArgv.map(quotePowershellArgument).join(" ");
  const evidenceRunPowerShellCommand = evidenceRunArgv.map(quotePowershellArgument).join(" ");
  const steps: DestinationBlockedChildRecoveryAdvice["steps"] = [
    {
      step: "profile_setup",
      purpose: "Open the blocked child page in a user-controlled Chrome persistent profile so login, consent, or bot-check handling can be completed visibly.",
      argv: profileSetupArgv,
      powershellCommand: profileSetupPowerShellCommand
    },
    {
      step: "recovery_evidence_run",
      purpose: "Capture the sampled recovery URL with the same Chrome persistent profile in headed mode, preserving normal evidence and claim gates.",
      argv: evidenceRunArgv,
      powershellCommand: evidenceRunPowerShellCommand
    }
  ];
  return {
    recommendedAction: "profile_headed_retry",
    profileName,
    storagePolicy: "persistent-profile",
    browserChannel: "chrome",
    candidateCount,
    sampleUrls,
    profileSetupUrl: first.childUrl,
    recoveryUrl: first.url,
    steps,
    profileSetupArgv,
    profileSetupPowerShellCommand,
    evidenceRunArgv,
    evidenceRunPowerShellCommand,
    commandHints: steps.map((step) => step.powershellCommand),
    reasons: [
      "blocked_child_exposes_deeper_candidates",
      "profile_headed_review_required",
      "default_depth_2_execution_disabled"
    ]
  };
}

function isDestinationBlockedChildRecoveryCandidateSummary(value: unknown): value is DestinationBlockedChildRecoveryCandidateSummary {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.sourceCandidateId === "string"
    && typeof value.actionKey === "string"
    && typeof value.childUrl === "string"
    && typeof value.childUsefulness === "string"
    && typeof value.url === "string"
    && typeof value.domain === "string"
    && typeof value.candidateKind === "string"
    && typeof value.visibleText === "string"
    && Array.isArray(value.warnings)
    && value.warnings.every((warning) => typeof warning === "string");
}

function isDestinationBlockedChildRecoveryAdvice(value: unknown): value is DestinationBlockedChildRecoveryAdvice {
  if (!isRecord(value)) {
    return false;
  }
  return value.recommendedAction === "profile_headed_retry"
    && typeof value.profileName === "string"
    && value.storagePolicy === "persistent-profile"
    && value.browserChannel === "chrome"
    && typeof value.candidateCount === "number"
    && Array.isArray(value.sampleUrls)
    && typeof value.profileSetupUrl === "string"
    && typeof value.recoveryUrl === "string"
    && Array.isArray(value.steps)
    && value.steps.every(isRecoveryCommandStep)
    && Array.isArray(value.profileSetupArgv)
    && typeof value.profileSetupPowerShellCommand === "string"
    && Array.isArray(value.evidenceRunArgv)
    && typeof value.evidenceRunPowerShellCommand === "string"
    && Array.isArray(value.commandHints)
    && Array.isArray(value.reasons);
}

function isRecoveryCommandStep(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (value.step === "profile_setup" || value.step === "recovery_evidence_run")
    && typeof value.purpose === "string"
    && Array.isArray(value.argv)
    && value.argv.every((item) => typeof item === "string")
    && typeof value.powershellCommand === "string";
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stripLeadingBom(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

function quotePowershellArgument(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function safeProfileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "destination";
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

function uniquePathItems<T extends { path: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.path)) {
      return false;
    }
    seen.add(item.path);
    return true;
  });
}

function checkRecoveryProfileExists(
  item: DestinationRecoveryPlanItem,
  issues: DestinationRecoveryPlanCheckIssue[],
  options: DestinationRecoveryPlanCheckOptions
): void {
  if (options.profileExists === undefined || item.profileName.trim().length === 0) {
    return;
  }
  if (!options.profileExists(item.profileName)) {
    issues.push(recoveryPlanIssue("error", "profile_missing", item, `Saved browser profile does not exist: ${item.profileName}. Run the profile_setup step before the recovery_evidence_run step.`));
  }
}

function checkRecoverySetupStep(
  item: DestinationRecoveryPlanItem,
  issues: DestinationRecoveryPlanCheckIssue[]
): void {
  const setup = item.advice.steps.find((step) => step.step === "profile_setup");
  if (setup === undefined) {
    issues.push(recoveryPlanIssue("error", "setup_step_missing", item, "Recovery item has no profile_setup step."));
    return;
  }
  requireCommandPart(setup.powershellCommand, "auth-login", "setup_command_missing_auth_login", item, issues);
  requireCommandPart(setup.powershellCommand, "--profile", "setup_command_missing_profile_flag", item, issues);
  requireCommandPart(setup.powershellCommand, item.profileName, "setup_command_missing_profile_value", item, issues);
  requireCommandPart(setup.powershellCommand, "--url", "setup_command_missing_url", item, issues);
  requireCommandPart(setup.powershellCommand, item.profileSetupUrl, "setup_command_missing_setup_url", item, issues);
  requireCommandPart(setup.powershellCommand, "--browser-channel", "setup_command_missing_browser_channel_flag", item, issues);
  requireCommandPart(setup.powershellCommand, item.browserChannel, "setup_command_missing_browser_channel_value", item, issues);
  requireCommandPart(setup.powershellCommand, "--persistent-profile", "setup_command_missing_persistent_profile", item, issues);
}

function checkRecoveryEvidenceRunStep(
  item: DestinationRecoveryPlanItem,
  issues: DestinationRecoveryPlanCheckIssue[]
): void {
  const retry = item.advice.steps.find((step) => step.step === "recovery_evidence_run");
  if (retry === undefined) {
    issues.push(recoveryPlanIssue("error", "retry_step_missing", item, "Recovery item has no recovery_evidence_run step."));
    return;
  }
  requireCommandPart(retry.powershellCommand, "evidence-run", "retry_command_missing_evidence_run", item, issues);
  requireCommandPart(retry.powershellCommand, "--url", "retry_command_missing_url_flag", item, issues);
  requireCommandPart(retry.powershellCommand, item.recoveryUrl, "retry_command_missing_recovery_url", item, issues);
  requireCommandPart(retry.powershellCommand, "--headed", "retry_command_missing_headed", item, issues);
  requireCommandPart(retry.powershellCommand, "--browser-channel", "retry_command_missing_browser_channel_flag", item, issues);
  requireCommandPart(retry.powershellCommand, item.browserChannel, "retry_command_missing_browser_channel_value", item, issues);
  requireCommandPart(retry.powershellCommand, "--profile", "retry_command_missing_profile_flag", item, issues);
  requireCommandPart(retry.powershellCommand, item.profileName, "retry_command_missing_profile_value", item, issues);
  requireCommandPart(retry.powershellCommand, "--persistent-profile", "retry_command_missing_persistent_profile", item, issues);
}

function requireCommandPart(
  command: string,
  expected: string,
  code: string,
  item: DestinationRecoveryPlanItem,
  issues: DestinationRecoveryPlanCheckIssue[]
): void {
  if (!command.includes(expected)) {
    issues.push(recoveryPlanIssue("error", code, item, `Recovery command for ${item.profileName} is missing ${expected}.`));
  }
}

function recoveryPlanIssue(
  severity: DestinationRecoveryPlanCheckSeverity,
  code: string,
  item: DestinationRecoveryPlanItem,
  message: string
): DestinationRecoveryPlanCheckIssue {
  return {
    severity,
    code,
    message,
    itemOrder: item.order,
    profileName: item.profileName
  };
}
