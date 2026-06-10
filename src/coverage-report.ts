// The recipe-canary RUNNER was removed with the selector subsystem
// (docs/SELECTOR_STACK_EXCISION.md). The ledger entry format and the latest-per-recipe
// fold live here so old canary ledgers still classify; without a runner nothing new
// becomes autonomous_ready — honest degradation, not implied support.

export type RecipeCanaryVerdict = "pass" | "needs_recalibration";

export interface RecipeCanaryResult {
  recipeKey: string;
  verdict: RecipeCanaryVerdict;
  verifiedAt: string;
  missingSelectors: string[];
  unexpectedObstructions: string[];
}

/** Fold the ledger to the latest result per recipeKey (newest verifiedAt wins). */
export function latestCanaryByRecipe(entries: RecipeCanaryResult[]): Record<string, RecipeCanaryResult> {
  const latest: Record<string, RecipeCanaryResult> = {};
  for (const entry of entries) {
    const prior = latest[entry.recipeKey];
    if (prior === undefined || entry.verifiedAt >= prior.verifiedAt) {
      latest[entry.recipeKey] = entry;
    }
  }
  return latest;
}

// Coverage report (master-plan P4): a single honest surface that classifies each source
// into exactly one coverage class. "autonomous_ready" REQUIRES a maintained recipe with a
// PASSING canary inside the freshness window — a decayed or stale slot is auto-demoted to
// "headed_only" (recalibration required), and anything outside the actively-canaried
// maintenance budget is honestly labelled "unmaintained" rather than implied-supported.

export type CoverageClass = "autonomous_ready" | "api_backed" | "headed_only" | "blocked" | "unmaintained";

export const COVERAGE_CLASSES: CoverageClass[] = ["autonomous_ready", "api_backed", "headed_only", "blocked", "unmaintained"];

// The honest, explicitly-named maintenance budget: the free, sustainable search sources
// the project commits to actively canarying. Everything else is "unmaintained" unless a
// caller widens the set via --maintenance. Kept small on purpose (master-plan P4: a named
// actively-canaried set, not an implied-everything claim).
export const DEFAULT_CANARY_MAINTENANCE_SET: string[] = ["google_search", "naver_search", "daum_search"];

// Platforms covered by a lawful official-API connector (env-keyed, no browser). Overridable
// via --api-backed.
export const DEFAULT_API_BACKED_PLATFORMS: string[] = ["youtube"];

export interface CoverageReportSource {
  platform: string;
  displayName: string;
  /** readiness status distilled from the source-coverage readiness audit. */
  readinessStatus: string;
  /** the audit produced a profile-headed retry command for this source. */
  requiresHeadedProfile: boolean;
  /** canary recipe key for this source (defaults to the platform id). */
  recipeKey?: string;
}

export interface CoverageReportInput {
  sources: CoverageReportSource[];
  /** platforms inside the active canary maintenance budget. */
  maintenanceSet: string[];
  /** platforms covered by a lawful official-API connector (no browser). */
  apiBackedPlatforms?: string[];
  /** raw canary ledger entries (latest-per-recipe is computed here). */
  canaryLedger?: RecipeCanaryResult[];
  freshnessWindowMs: number;
  /** ISO timestamp; injected so the report is deterministic and testable. */
  now: string;
}

export interface CoverageReportEntry {
  platform: string;
  displayName: string;
  coverageClass: CoverageClass;
  inMaintenanceSet: boolean;
  lastVerifiedAt?: string;
  canaryVerdict?: RecipeCanaryVerdict;
  fresh: boolean;
  reasons: string[];
}

export interface CoverageReport {
  schemaVersion: "1.0";
  generatedAt: string;
  freshnessWindowMs: number;
  maintenanceBudget: number;
  classCounts: Record<CoverageClass, number>;
  autonomousReadyCount: number;
  entries: CoverageReportEntry[];
}

interface ClassifyContext {
  maintenanceSet: Set<string>;
  apiBacked: Set<string>;
  latestCanary: Record<string, RecipeCanaryResult>;
  freshnessWindowMs: number;
  nowMs: number;
}

export function classifyCoverageSource(source: CoverageReportSource, ctx: ClassifyContext): CoverageReportEntry {
  const recipeKey = source.recipeKey ?? source.platform;
  const inMaintenanceSet = ctx.maintenanceSet.has(source.platform);
  const canary = ctx.latestCanary[recipeKey];
  const verifiedMs = canary !== undefined ? Date.parse(canary.verifiedAt) : Number.NaN;
  const fresh = Number.isFinite(verifiedMs) && ctx.nowMs - verifiedMs <= ctx.freshnessWindowMs;
  const reasons: string[] = [];
  let coverageClass: CoverageClass;

  if (ctx.apiBacked.has(source.platform)) {
    coverageClass = "api_backed";
    reasons.push("covered by a lawful official-API connector (no browser)");
  } else if (inMaintenanceSet) {
    if (canary?.verdict === "pass" && fresh) {
      coverageClass = "autonomous_ready";
      reasons.push(`canary passed and is fresh (verified ${canary.verifiedAt})`);
    } else {
      coverageClass = "headed_only";
      if (canary === undefined) {
        reasons.push("maintained but never canaried — recalibration required");
      } else if (canary.verdict !== "pass") {
        const missing = canary.missingSelectors.length > 0 ? canary.missingSelectors.join(", ") : "none";
        reasons.push(`canary demoted to needs_recalibration (missing selectors: ${missing})`);
      } else {
        reasons.push(`canary stale (verified ${canary.verifiedAt}, beyond the freshness window)`);
      }
    }
  } else if (source.readinessStatus === "blocked") {
    coverageClass = "blocked";
    reasons.push("blocked and outside the maintenance budget");
  } else if (source.requiresHeadedProfile) {
    coverageClass = "headed_only";
    reasons.push("requires a headed profile calibration");
  } else {
    coverageClass = "unmaintained";
    reasons.push("outside the actively-canaried maintenance budget (honestly unmaintained)");
  }

  const entry: CoverageReportEntry = {
    platform: source.platform,
    displayName: source.displayName,
    coverageClass,
    inMaintenanceSet,
    fresh,
    reasons
  };
  if (canary !== undefined) {
    entry.lastVerifiedAt = canary.verifiedAt;
    entry.canaryVerdict = canary.verdict;
  }
  return entry;
}

export function buildCoverageReport(input: CoverageReportInput): CoverageReport {
  const ctx: ClassifyContext = {
    maintenanceSet: new Set(input.maintenanceSet),
    apiBacked: new Set(input.apiBackedPlatforms ?? []),
    latestCanary: latestCanaryByRecipe(input.canaryLedger ?? []),
    freshnessWindowMs: input.freshnessWindowMs,
    nowMs: Date.parse(input.now)
  };
  const entries = input.sources.map((source) => classifyCoverageSource(source, ctx));
  const classCounts = Object.fromEntries(COVERAGE_CLASSES.map((c) => [c, 0])) as Record<CoverageClass, number>;
  for (const entry of entries) {
    classCounts[entry.coverageClass] += 1;
  }
  return {
    schemaVersion: "1.0",
    generatedAt: input.now,
    freshnessWindowMs: input.freshnessWindowMs,
    maintenanceBudget: ctx.maintenanceSet.size,
    classCounts,
    autonomousReadyCount: classCounts.autonomous_ready,
    entries
  };
}

export function formatCoverageReportAsLines(report: CoverageReport): string {
  const header = COVERAGE_CLASSES.map((c) => `${c}=${report.classCounts[c]}`).join("  ");
  const lines = [`# coverage-report (${report.entries.length} sources; ${header})`];
  for (const entry of report.entries) {
    const freshness = entry.lastVerifiedAt !== undefined ? ` verified=${entry.lastVerifiedAt}${entry.fresh ? "" : " (stale)"}` : "";
    lines.push(`${entry.coverageClass}\t${entry.platform}\t${entry.displayName}${freshness}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatCoverageReportAsMarkdown(report: CoverageReport): string {
  const lines = [
    "# Coverage Report",
    "",
    `- Sources: ${report.entries.length}`,
    `- Maintenance budget: ${report.maintenanceBudget}`,
    `- Autonomous-ready: ${report.autonomousReadyCount}`,
    "",
    "| Class | Count |",
    "| --- | --- |",
    ...COVERAGE_CLASSES.map((c) => `| ${c} | ${report.classCounts[c]} |`),
    "",
    "| Source | Class | Last verified | Fresh |",
    "| --- | --- | --- | --- |",
    ...report.entries.map((e) => `| ${e.displayName} (${e.platform}) | ${e.coverageClass} | ${e.lastVerifiedAt ?? "—"} | ${e.lastVerifiedAt === undefined ? "—" : e.fresh ? "yes" : "no"} |`)
  ];
  return `${lines.join("\n")}\n`;
}
