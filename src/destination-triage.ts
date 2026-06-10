import type { ArtifactWriter, ArtifactRecord, ArtifactStatus } from "./artifact-writer.js";
import { safeUrl } from "./util/url.js";
import { resolveDestinationUrl, type DestinationUrlResolutionMethod } from "./destination-url.js";
import type { SourceFamily, SourcePlatform } from "./source-strategy.js";

// Inlined from the removed source-navigation executor (docs/SELECTOR_STACK_EXCISION.md):
// triage still scores destination requests authored by hand or by historical runs.
export interface SourceNavigationFollowUpRequest {
  actionKey: string;
  url: string;
  originalUrl?: string | undefined;
  urlResolutionMethod?: DestinationUrlResolutionMethod | undefined;
  selector?: string | undefined;
  linkText?: string | undefined;
  captureId?: string | undefined;
  note?: string | undefined;
}

export type DestinationCandidateKind = "news" | "blog" | "official" | "map_place" | "review" | "community" | "commerce" | "media" | "generic";

export type DestinationUsefulness = "useful" | "low_value" | "duplicate" | "off_topic" | "budget_limited" | "blocked" | "paywalled" | "private" | "unsupported";

export type DestinationScoringProfileName = "search_general" | "map_local" | "blog_content" | "portal_news" | "travel_booking" | "commerce" | "video_social" | "generic_web";

export type DestinationQueryIntent = "general" | "fresh_news" | "official_fact" | "experience_review" | "local_place" | "commerce_offer" | "media_content";

export type DestinationDeepeningReason = "child_page_has_relevant_official_link" | "child_page_has_source_document" | "child_page_has_related_review_or_map_link" | "child_page_has_primary_media_link" | "manual_review_required";

export type DestinationTextScriptFamily = "latin" | "hangul" | "hiragana" | "katakana" | "han" | "digit";

export type DestinationDecisionReasonCode =
  | "query_overlap"
  | "official_domain_match"
  | "fresh_publisher_article"
  | "local_place_match"
  | "price_or_offer_visible"
  | "transcript_or_ocr_hit"
  | "source_family_fit"
  | "query_intent_match"
  | "duplicate"
  | "portal_shell"
  | "thin_content"
  | "blocked_surface"
  | "private_or_login_surface"
  | "paywalled_surface"
  | "unsupported_destination"
  | "domain_budget"
  | "top_k_budget"
  | "off_topic"
  | "query_script_mismatch_possible"
  | "stale_or_mismatched_source";

export interface DestinationDecisionReasons {
  positive: DestinationDecisionReasonCode[];
  negative: DestinationDecisionReasonCode[];
}

export interface DestinationReasonCodeCount {
  reasonCode: DestinationDecisionReasonCode;
  count: number;
}

export interface DestinationCandidate {
  schemaVersion: "1.0";
  candidateId: string;
  requestIndex: number;
  actionKey: string;
  parentUrl: string;
  url: string;
  originalUrl?: string | undefined;
  urlResolutionMethod?: DestinationUrlResolutionMethod | undefined;
  normalizedUrl: string;
  domain: string;
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  candidateKind: DestinationCandidateKind;
  queryIntent: DestinationQueryIntent;
  rank: number;
  score: number;
  scoreBreakdown: DestinationCandidateScoreBreakdown;
  visibleMetadata: DestinationVisibleMetadata;
  signals: string[];
  warnings: string[];
  reasonCodes: DestinationDecisionReasons;
  sourceArtifactIds: string[];
  selector?: string | undefined;
  linkText?: string | undefined;
  captureId?: string | undefined;
  note?: string | undefined;
}

export interface DestinationCandidateScoreBreakdown {
  profile: DestinationScoringProfileName;
  base: number;
  rank: number;
  kind: number;
  query: number;
  authority: number;
  freshness: number;
  sourceFamilyFit: number;
  queryIntent: number;
  profileAdjustment: number;
  externalDestination: number;
  warnings: number;
  total: number;
}

export interface DestinationVisibleMetadata {
  textSnippet?: string | undefined;
  years: number[];
  hasRecentYearHint: boolean;
  hasStaleYearHint: boolean;
  hasPriceLikeText: boolean;
  hasRatingLikeText: boolean;
  hasReviewLikeText: boolean;
  hasLocalPlaceLikeText: boolean;
  hasPublisherLikeText: boolean;
}

interface DestinationScoringProfile {
  name: DestinationScoringProfileName;
  rankMultiplier: number;
  queryMultiplier: number;
  authorityMultiplier: number;
  freshnessMultiplier: number;
  sourceFamilyFitMultiplier: number;
  externalDestinationMultiplier: number;
  kindAdjustments: Partial<Record<DestinationCandidateKind, number>>;
}

export interface DestinationSelectedCandidate extends DestinationCandidate {
  selectionStatus: "selected";
  selectionReason: string;
  usefulness: DestinationUsefulness;
  childResult?: DestinationChildRunResult | undefined;
}

export interface DestinationRejectedCandidate extends DestinationCandidate {
  selectionStatus: "rejected";
  usefulness: DestinationUsefulness;
  rejectionReason: string;
}

export interface DestinationChildEvidenceSummary {
  artifactCount: number;
  claimCount: number;
  browserCaptureRecords: number;
  browserCaptureFailedRecords?: number | undefined;
  obstructionCount: number;
  pageTextLength: number;
  queryOverlapTokenCount: number;
  matchedQueryTokens: string[];
  queryScriptFamilies?: DestinationTextScriptFamily[] | undefined;
  evidenceScriptFamilies?: DestinationTextScriptFamily[] | undefined;
  queryEvidenceScriptMismatch?: boolean | undefined;
  deeperCandidateCount: number;
  deeperCandidates?: DestinationDeepeningCandidate[] | undefined;
  evidenceSignals: string[];
  evidenceWarnings: string[];
  title?: string | undefined;
  finalUrl?: string | undefined;
  textSnippet?: string | undefined;
}

export interface DestinationChildRunResult {
  actionKey: string;
  url: string;
  status: "ok" | "error";
  runDir?: string | undefined;
  reportPath?: string | undefined;
  childEvidence?: DestinationChildEvidenceSummary | undefined;
  error?: string | undefined;
}

interface DestinationChildUsefulnessContext {
  candidateKind: DestinationCandidateKind;
  queryIntent: DestinationQueryIntent;
}

export interface DestinationVisibleLink {
  index: number;
  url: string;
  text: string;
}

export interface DestinationProbeCandidateClassification {
  promotable: boolean;
  warnings: string[];
}

export interface DestinationDeepeningCandidate {
  url: string;
  normalizedUrl: string;
  domain: string;
  visibleText: string;
  rank: number;
  candidateKind: DestinationCandidateKind;
  signals: string[];
  warnings: string[];
}

export interface DestinationDeepeningProposal {
  schemaVersion: "1.0";
  executionPolicy: "proposal_only" | "explicit_opt_in_requested";
  parentUrl: string;
  childUrl: string;
  sourceCandidateId: string;
  actionKey: string;
  currentDepth: 1;
  proposedDepth: 2;
  maxDepth: number;
  proposedCount: number;
  reason: DestinationDeepeningReason;
  candidates: DestinationDeepeningCandidate[];
}

export interface DestinationDeepeningExecutionResult {
  sourceCandidateId: string;
  actionKey: string;
  proposalReason: DestinationDeepeningReason;
  candidateIndex: number;
  url: string;
  candidateKind: DestinationCandidateKind;
  status: "ok" | "error";
  usefulness: DestinationUsefulness;
  durationMs?: number | undefined;
  timeoutMs?: number | undefined;
  maxArtifacts?: number | undefined;
  artifactCount?: number | undefined;
  artifactBudgetExceeded?: boolean | undefined;
  timeoutExceeded?: boolean | undefined;
  runDir?: string | undefined;
  reportPath?: string | undefined;
  childEvidence?: DestinationChildEvidenceSummary | undefined;
  error?: string | undefined;
}

export interface DestinationDeepeningExecutionSummary {
  status: "not_requested" | "not_enabled" | "no_proposals" | "ok" | "partial";
  maxDepth: number;
  maxRuns: number;
  maxPerDomain: number;
  concurrency: number;
  timeoutMs: number;
  maxArtifacts: number;
  proposalCount: number;
  candidateCount: number;
  attemptedCount: number;
  completedCount: number;
  failedCount: number;
  omittedCount: number;
  usefulCount: number;
  offTopicCount: number;
  blockedCount: number;
  budgetLimitedCount: number;
  timeoutCount: number;
  records: number;
  results: DestinationDeepeningExecutionResult[];
}

export interface DestinationDeepeningProposalSummary {
  status: "not_requested" | "no_proposals" | "proposed";
  proposalCount: number;
  candidateCount: number;
  records: number;
}

export interface DestinationBlockedChildRecoveryCandidateSummary {
  sourceCandidateId: string;
  actionKey: string;
  childUrl: string;
  childUsefulness: DestinationUsefulness;
  url: string;
  domain: string;
  candidateKind: DestinationCandidateKind;
  visibleText: string;
  warnings: string[];
}

export interface DestinationTriageResult {
  schemaVersion: "1.0";
  executionPolicy: "bounded_destination_triage";
  parentUrl: string;
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  query?: string | undefined;
  maxSelected: number;
  maxPerDomain: number;
  candidateCount: number;
  selectedCount: number;
  rejectedCount: number;
  selected: DestinationSelectedCandidate[];
  rejected: DestinationRejectedCandidate[];
  summary: DestinationTriageSummary;
  warnings: string[];
}

export interface DestinationTriageSummary {
  status: "not_requested" | "no_candidates" | "selected" | "partial";
  candidateCount: number;
  selectedCount: number;
  rejectedCount: number;
  usefulCount: number;
  blockedCount: number;
  lowValueCount: number;
  duplicateCount: number;
  offTopicCount: number;
  budgetLimitedCount: number;
  unsupportedCount: number;
  maxSelected: number;
  maxPerDomain: number;
  unattemptedFallbackCount: number;
  fallbackCandidates: DestinationFallbackCandidateSummary[];
  blockedChildRecoveryCandidateCount: number;
  blockedChildRecoveryCandidates: DestinationBlockedChildRecoveryCandidateSummary[];
  blockedChildRecoveryAdvice?: DestinationBlockedChildRecoveryAdvice | undefined;
  retryRecommended: boolean;
  retryAdvice?: DestinationRetryAdvice | undefined;
  positiveReasonCounts: DestinationReasonCodeCount[];
  negativeReasonCounts: DestinationReasonCodeCount[];
  visibleMetadata: DestinationVisibleMetadataSummary;
  candidateKindCounts: DestinationCandidateKindCount[];
  selectedKindCounts: DestinationCandidateKindCount[];
  usefulKindCounts: DestinationCandidateKindCount[];
  rejectedKindCounts: DestinationCandidateKindCount[];
  queryIntentCounts: DestinationQueryIntentCount[];
  records: number;
}

export interface DestinationQueryIntentCount {
  queryIntent: DestinationQueryIntent;
  count: number;
}

export interface DestinationCandidateKindCount {
  candidateKind: DestinationCandidateKind;
  count: number;
}

export interface DestinationVisibleMetadataSummary {
  candidateCount: number;
  textSnippetCount: number;
  recentYearHintCount: number;
  staleYearHintCount: number;
  priceLikeCount: number;
  ratingLikeCount: number;
  reviewLikeCount: number;
  localPlaceLikeCount: number;
  publisherLikeCount: number;
}

export interface DestinationFallbackCandidateSummary {
  candidateId: string;
  actionKey: string;
  url: string;
  domain: string;
  candidateKind: DestinationCandidateKind;
  score: number;
  budgetReason: "top_k_budget" | "domain_budget";
}

export interface DestinationRetryAdvice {
  recommendedMaxSelected: number;
  recommendedMaxPerDomain: number;
  cliFlags: string[];
  reasons: DestinationRetryAdviceReason[];
}

export interface DestinationBlockedChildRecoveryAdvice {
  recommendedAction: "profile_headed_retry";
  profileName: string;
  storagePolicy: "persistent-profile";
  browserChannel: "chrome";
  candidateCount: number;
  sampleUrls: string[];
  profileSetupUrl: string;
  recoveryUrl: string;
  steps: DestinationBlockedChildRecoveryCommandStep[];
  profileSetupArgv: string[];
  profileSetupPowerShellCommand: string;
  evidenceRunArgv: string[];
  evidenceRunPowerShellCommand: string;
  commandHints: string[];
  reasons: DestinationBlockedChildRecoveryAdviceReason[];
}

export interface DestinationBlockedChildRecoveryCommandStep {
  step: "profile_setup" | "recovery_evidence_run";
  purpose: string;
  argv: string[];
  powershellCommand: string;
}

export type DestinationRetryAdviceReason = "increase_max_followups" | "increase_max_followups_per_domain" | "narrow_destination_selectors";

export type DestinationBlockedChildRecoveryAdviceReason = "blocked_child_exposes_deeper_candidates" | "profile_headed_review_required" | "default_depth_2_execution_disabled";

export interface BuildDestinationTriageInput {
  parentUrl: string;
  platform: SourcePlatform;
  sourceFamily: SourceFamily;
  requests: SourceNavigationFollowUpRequest[];
  maxSelected: number;
  maxPerDomain?: number | undefined;
  sourceArtifactIds?: string[] | undefined;
  query?: string | undefined;
  childResults?: DestinationChildRunResult[] | undefined;
}

export function buildDestinationTriage(input: BuildDestinationTriageInput): DestinationTriageResult {
  const query = normalizedQuery(input.query ?? queryFromUrl(input.parentUrl));
  const maxSelected = normalizeMaxSelected(input.maxSelected);
  const maxPerDomain = normalizeMaxPerDomain(input.maxPerDomain, maxSelected);
  const candidates = input.requests.map((request, index) =>
    buildCandidate({
      parentUrl: input.parentUrl,
      platform: input.platform,
      sourceFamily: input.sourceFamily,
      request,
      index,
      query,
      sourceArtifactIds: input.sourceArtifactIds ?? []
    })
  );
  const childResultByKeyUrl = new Map((input.childResults ?? []).map((result) => [childResultKey(result.actionKey, result.url), result]));
  const seen = new Set<string>();
  const preRejected: DestinationRejectedCandidate[] = [];
  const eligible: DestinationCandidate[] = [];

  for (const candidate of candidates) {
    const hardReject = hardRejectionFor(candidate);
    if (seen.has(candidate.normalizedUrl)) {
      preRejected.push(rejectCandidate(candidate, "duplicate", "Duplicate normalized destination URL.", "duplicate"));
      continue;
    }
    seen.add(candidate.normalizedUrl);
    if (hardReject !== undefined) {
      preRejected.push(rejectCandidate(candidate, hardReject.usefulness, hardReject.reason, hardReject.reasonCode));
      continue;
    }
    eligible.push(candidate);
  }

  const sorted = [...eligible].sort((left, right) => {
    const scoreDelta = right.score - left.score;
    return scoreDelta !== 0 ? scoreDelta : left.rank - right.rank;
  });
  const { selectedBase, domainLimitedIds } = selectWithinBudgets(sorted, maxSelected, maxPerDomain);
  const selectedIds = new Set(selectedBase.map((candidate) => candidate.candidateId));
  const budgetRejected = sorted
    .filter((candidate) => !selectedIds.has(candidate.candidateId))
    .map((candidate) =>
      domainLimitedIds.has(candidate.candidateId) ? rejectCandidate(candidate, "budget_limited", `Candidate was outside the per-domain destination budget of ${maxPerDomain}.`, "domain_budget") : rejectCandidate(candidate, "budget_limited", "Candidate was outside the bounded top-K destination budget.", "top_k_budget")
    );
  const selected = selectedBase.map((candidate): DestinationSelectedCandidate => {
    const childResult = childResultByKeyUrl.get(childResultKey(candidate.actionKey, candidate.url));
    const usefulness = classifyDestinationChildUsefulness(childResult, input.query ?? query, {
      candidateKind: candidate.candidateKind,
      queryIntent: candidate.queryIntent
    });
    return {
      ...candidate,
      selectionStatus: "selected",
      selectionReason: "Selected by deterministic destination score within the top-K and per-domain budgets.",
      usefulness,
      reasonCodes: mergeDecisionReasons(candidate.reasonCodes, childDecisionReasons(childResult, usefulness)),
      ...(childResult === undefined ? {} : { childResult })
    };
  });
  const rejected = [...preRejected, ...budgetRejected];
  const warnings = destinationTriageWarnings(input, candidates, selected, rejected);
  const summary = summarizeDestinationTriageResult({
    selected,
    rejected,
    candidateCount: candidates.length,
    maxSelected,
    maxPerDomain,
    records: 0
  });

  return {
    schemaVersion: "1.0",
    executionPolicy: "bounded_destination_triage",
    parentUrl: input.parentUrl,
    platform: input.platform,
    sourceFamily: input.sourceFamily,
    ...(query === undefined ? {} : { query }),
    maxSelected,
    maxPerDomain,
    candidateCount: candidates.length,
    selectedCount: selected.length,
    rejectedCount: rejected.length,
    selected,
    rejected,
    summary,
    warnings
  };
}

export function buildDestinationDeepeningCandidates(input: { childUrl: string; links: DestinationVisibleLink[]; query?: string | undefined; maxCandidates?: number | undefined }): DestinationDeepeningCandidate[] {
  const maxCandidates = Math.max(0, Math.min(10, Math.trunc(input.maxCandidates ?? 5)));
  const seen = new Set<string>();
  const candidates: DestinationDeepeningCandidate[] = [];
  const childNormalizedUrl = normalizeDestinationUrl(resolveDestinationUrl(input.childUrl).url);
  for (const link of input.links) {
    if (candidates.length >= maxCandidates) {
      break;
    }
    const rawUrl = absoluteUrl(link.url, input.childUrl);
    const url = resolveDestinationUrl(rawUrl).url;
    const normalizedUrl = normalizeDestinationUrl(url);
    if (normalizedUrl === childNormalizedUrl || seen.has(normalizedUrl)) {
      continue;
    }
    seen.add(normalizedUrl);
    if (!/^https?:\/\//i.test(url)) {
      continue;
    }
    const haystack = `${url} ${link.text}`;
    if (lowValuePattern().test(haystack) || loginOrAccountSurface(haystack) || providerBoilerplateSurface(input.childUrl, url, link.text)) {
      continue;
    }
    const parsed = safeUrl(url);
    const domain = parsed?.hostname.toLowerCase() ?? "unknown-host";
    const candidateKind = candidateKindFor(url, link.text);
    const signals = destinationDeepeningSignals({
      childUrl: input.childUrl,
      url,
      domain,
      candidateKind,
      linkText: link.text,
      query: input.query
    });
    const warnings = destinationDeepeningWarnings({
      childUrl: input.childUrl,
      url,
      linkText: link.text
    });
    candidates.push({
      url,
      normalizedUrl,
      domain,
      visibleText: link.text,
      rank: link.index + 1,
      candidateKind,
      signals,
      warnings
    });
  }
  return candidates;
}

export function buildDestinationDeepeningProposals(input: { triage: DestinationTriageResult; maxDepth?: number | undefined }): DestinationDeepeningProposal[] {
  const maxDepth = Math.max(1, Math.min(2, Math.trunc(input.maxDepth ?? 1)));
  const proposals: DestinationDeepeningProposal[] = [];
  for (const candidate of input.triage.selected) {
    const childEvidence = candidate.childResult?.childEvidence;
    if (candidate.usefulness !== "useful" || childEvidence?.deeperCandidates === undefined || childEvidence.deeperCandidates.length === 0) {
      continue;
    }
    proposals.push({
      schemaVersion: "1.0",
      executionPolicy: maxDepth > 1 ? "explicit_opt_in_requested" : "proposal_only",
      parentUrl: input.triage.parentUrl,
      childUrl: candidate.childResult?.url ?? candidate.url,
      sourceCandidateId: candidate.candidateId,
      actionKey: candidate.actionKey,
      currentDepth: 1,
      proposedDepth: 2,
      maxDepth,
      proposedCount: childEvidence.deeperCandidates.length,
      reason: destinationDeepeningReason(childEvidence.deeperCandidates),
      candidates: childEvidence.deeperCandidates
    });
  }
  return proposals;
}

export function summarizeDestinationDeepeningProposals(proposals: DestinationDeepeningProposal[], records: number): DestinationDeepeningProposalSummary {
  return {
    status: proposals.length === 0 ? "no_proposals" : "proposed",
    proposalCount: proposals.length,
    candidateCount: proposals.reduce((count, proposal) => count + proposal.candidates.length, 0),
    records
  };
}

export function selectedDestinationRequests(triage: DestinationTriageResult, requests: SourceNavigationFollowUpRequest[]): SourceNavigationFollowUpRequest[] {
  return triage.selected
    .map((candidate) => {
      const request = requests[candidate.requestIndex];
      if (request === undefined || candidate.url === request.url) {
        return request;
      }
      return {
        ...request,
        url: candidate.url,
        originalUrl: candidate.originalUrl ?? request.url,
        ...(candidate.urlResolutionMethod === undefined ? {} : { urlResolutionMethod: candidate.urlResolutionMethod })
      };
    })
    .filter((request): request is SourceNavigationFollowUpRequest => request !== undefined);
}

export function summarizeDestinationTriageResult(input: { selected: DestinationSelectedCandidate[]; rejected: DestinationRejectedCandidate[]; candidateCount: number; maxSelected: number; maxPerDomain?: number | undefined; records: number }): DestinationTriageSummary {
  const rejected = input.rejected;
  const selected = input.selected;
  const blockedCount = selected.filter((item) => ["blocked", "paywalled", "private"].includes(item.usefulness)).length + rejected.filter((item) => item.usefulness === "blocked" || item.usefulness === "paywalled" || item.usefulness === "private").length;
  const lowValueCount = selected.filter((item) => item.usefulness === "low_value").length + rejected.filter((item) => item.usefulness === "low_value").length;
  const duplicateCount = rejected.filter((item) => item.usefulness === "duplicate").length;
  const offTopicCount = selected.filter((item) => item.usefulness === "off_topic").length + rejected.filter((item) => item.usefulness === "off_topic").length;
  const budgetLimitedCount = rejected.filter((item) => item.usefulness === "budget_limited").length;
  const unsupportedCount = selected.filter((item) => item.usefulness === "unsupported").length + rejected.filter((item) => item.usefulness === "unsupported").length;
  const usefulCount = selected.filter((item) => item.usefulness === "useful").length;
  const selectedDowngradedCount = selected.filter((item) => item.usefulness !== "useful").length;
  const fallbackCandidates = selectedDowngradedCount > 0 ? rejected.filter((item) => item.usefulness === "budget_limited" && fallbackBudgetReason(item) !== undefined).map(fallbackCandidateSummary) : [];
  const blockedChildRecoveryCandidates = blockedChildRecoveryCandidateSummaries(selected);
  const blockedChildRecoveryAdvice = destinationBlockedChildRecoveryAdvice(blockedChildRecoveryCandidates);
  const maxPerDomain = input.maxPerDomain ?? normalizeMaxPerDomain(undefined, normalizeMaxSelected(input.maxSelected));
  const retryAdvice = destinationRetryAdvice({
    fallbackCandidates,
    maxSelected: input.maxSelected,
    maxPerDomain
  });
  const reasonCounts = summarizeDestinationReasonCodes([...selected, ...rejected]);
  const visibleMetadata = summarizeDestinationVisibleMetadata([...selected, ...rejected]);
  const candidateKindCounts = summarizeDestinationCandidateKinds([...selected, ...rejected]);
  const selectedKindCounts = summarizeDestinationCandidateKinds(selected);
  const usefulKindCounts = summarizeDestinationCandidateKinds(selected.filter((candidate) => candidate.usefulness === "useful"));
  const rejectedKindCounts = summarizeDestinationCandidateKinds(rejected);
  const queryIntentCounts = summarizeDestinationQueryIntents([...selected, ...rejected]);
  const status = input.candidateCount === 0 ? "no_candidates" : blockedCount > 0 || selected.length === 0 || usefulCount < selected.length ? "partial" : "selected";

  return {
    status,
    candidateCount: input.candidateCount,
    selectedCount: selected.length,
    rejectedCount: rejected.length,
    usefulCount,
    blockedCount,
    lowValueCount,
    duplicateCount,
    offTopicCount,
    budgetLimitedCount,
    unsupportedCount,
    maxSelected: input.maxSelected,
    maxPerDomain,
    unattemptedFallbackCount: fallbackCandidates.length,
    fallbackCandidates,
    blockedChildRecoveryCandidateCount: blockedChildRecoveryCandidates.totalCount,
    blockedChildRecoveryCandidates: blockedChildRecoveryCandidates.samples,
    ...(blockedChildRecoveryAdvice === undefined ? {} : { blockedChildRecoveryAdvice }),
    retryRecommended: fallbackCandidates.length > 0 || blockedChildRecoveryAdvice !== undefined,
    ...(retryAdvice === undefined ? {} : { retryAdvice }),
    positiveReasonCounts: reasonCounts.positive,
    negativeReasonCounts: reasonCounts.negative,
    visibleMetadata,
    candidateKindCounts,
    selectedKindCounts,
    usefulKindCounts,
    rejectedKindCounts,
    queryIntentCounts,
    records: input.records
  };
}

function blockedChildRecoveryCandidateSummaries(selected: DestinationSelectedCandidate[]): { totalCount: number; samples: DestinationBlockedChildRecoveryCandidateSummary[] } {
  const summaries: DestinationBlockedChildRecoveryCandidateSummary[] = [];
  let totalCount = 0;
  for (const candidate of selected) {
    const evidence = candidate.childResult?.childEvidence;
    const deeperCandidates = evidence?.deeperCandidates ?? [];
    if (deeperCandidates.length === 0 || !isBlockedChildCandidate(candidate, evidence)) {
      continue;
    }
    totalCount += deeperCandidates.length;
    for (const deeperCandidate of deeperCandidates) {
      if (summaries.length >= 10) {
        continue;
      }
      summaries.push({
        sourceCandidateId: candidate.candidateId,
        actionKey: candidate.actionKey,
        childUrl: candidate.childResult?.url ?? candidate.url,
        childUsefulness: candidate.usefulness,
        url: deeperCandidate.url,
        domain: deeperCandidate.domain,
        candidateKind: deeperCandidate.candidateKind,
        visibleText: deeperCandidate.visibleText,
        warnings: deeperCandidate.warnings
      });
    }
  }
  return { totalCount, samples: summaries };
}

function destinationBlockedChildRecoveryAdvice(candidates: { totalCount: number; samples: DestinationBlockedChildRecoveryCandidateSummary[] }): DestinationBlockedChildRecoveryAdvice | undefined {
  if (candidates.totalCount === 0) {
    return undefined;
  }
  const sampleUrls = [...new Set(candidates.samples.map((candidate) => candidate.url))].slice(0, 5);
  const first = candidates.samples[0];
  if (first === undefined) {
    return undefined;
  }
  const profileName = `${safeProfileName(first.domain)}-recovery-profile`;
  const profileSetupArgv = ["node", ".\\dist\\cli.js", "auth-login", "--profile", profileName, "--url", first.childUrl, "--wait-ms", "120000", "--browser-channel", "chrome", "--persistent-profile"];
  const evidenceRunArgv = ["node", ".\\dist\\cli.js", "evidence-run", "--url", first.url, "--wait-ms", "3000", "--timeout-ms", "30000", "--headed", "--browser-channel", "chrome", "--profile", profileName, "--persistent-profile", "--no-frames"];
  const profileSetupPowerShellCommand = profileSetupArgv.map(quotePowershellArgument).join(" ");
  const evidenceRunPowerShellCommand = evidenceRunArgv.map(quotePowershellArgument).join(" ");
  const steps: DestinationBlockedChildRecoveryCommandStep[] = [
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
    candidateCount: candidates.totalCount,
    sampleUrls,
    profileSetupUrl: first.childUrl,
    recoveryUrl: first.url,
    steps,
    profileSetupArgv,
    profileSetupPowerShellCommand,
    evidenceRunArgv,
    evidenceRunPowerShellCommand,
    commandHints: steps.map((step) => step.powershellCommand),
    reasons: ["blocked_child_exposes_deeper_candidates", "profile_headed_review_required", "default_depth_2_execution_disabled"]
  };
}

function isBlockedChildCandidate(candidate: DestinationSelectedCandidate, evidence: DestinationChildEvidenceSummary | undefined): boolean {
  return candidate.usefulness === "blocked" || candidate.usefulness === "paywalled" || candidate.usefulness === "private" || (evidence?.evidenceWarnings.includes("browser_obstruction_detected") ?? false);
}

function summarizeDestinationQueryIntents(candidates: Array<{ queryIntent: DestinationQueryIntent }>): DestinationQueryIntentCount[] {
  const counts = new Map<DestinationQueryIntent, number>();
  for (const candidate of candidates) {
    counts.set(candidate.queryIntent, (counts.get(candidate.queryIntent) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => {
      const countDelta = right[1] - left[1];
      return countDelta !== 0 ? countDelta : left[0].localeCompare(right[0]);
    })
    .map(([queryIntent, count]) => ({ queryIntent, count }));
}

function summarizeDestinationCandidateKinds(candidates: Array<{ candidateKind: DestinationCandidateKind }>): DestinationCandidateKindCount[] {
  const counts = new Map<DestinationCandidateKind, number>();
  for (const candidate of candidates) {
    counts.set(candidate.candidateKind, (counts.get(candidate.candidateKind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => {
      const countDelta = right[1] - left[1];
      return countDelta !== 0 ? countDelta : left[0].localeCompare(right[0]);
    })
    .map(([candidateKind, count]) => ({ candidateKind, count }));
}

function summarizeDestinationVisibleMetadata(candidates: Array<{ visibleMetadata?: DestinationVisibleMetadata | undefined }>): DestinationVisibleMetadataSummary {
  return {
    candidateCount: candidates.length,
    textSnippetCount: candidates.filter((candidate) => candidate.visibleMetadata?.textSnippet !== undefined).length,
    recentYearHintCount: candidates.filter((candidate) => candidate.visibleMetadata?.hasRecentYearHint === true).length,
    staleYearHintCount: candidates.filter((candidate) => candidate.visibleMetadata?.hasStaleYearHint === true).length,
    priceLikeCount: candidates.filter((candidate) => candidate.visibleMetadata?.hasPriceLikeText === true).length,
    ratingLikeCount: candidates.filter((candidate) => candidate.visibleMetadata?.hasRatingLikeText === true).length,
    reviewLikeCount: candidates.filter((candidate) => candidate.visibleMetadata?.hasReviewLikeText === true).length,
    localPlaceLikeCount: candidates.filter((candidate) => candidate.visibleMetadata?.hasLocalPlaceLikeText === true).length,
    publisherLikeCount: candidates.filter((candidate) => candidate.visibleMetadata?.hasPublisherLikeText === true).length
  };
}

function fallbackCandidateSummary(candidate: DestinationRejectedCandidate): DestinationFallbackCandidateSummary {
  const budgetReason = fallbackBudgetReason(candidate);
  if (budgetReason === undefined) {
    throw new Error("Fallback candidate summary requires a budget-limited candidate.");
  }
  return {
    candidateId: candidate.candidateId,
    actionKey: candidate.actionKey,
    url: candidate.url,
    domain: candidate.domain,
    candidateKind: candidate.candidateKind,
    score: candidate.score,
    budgetReason
  };
}

function fallbackBudgetReason(candidate: DestinationRejectedCandidate): DestinationFallbackCandidateSummary["budgetReason"] | undefined {
  if (candidate.usefulness !== "budget_limited") {
    return undefined;
  }
  if (candidate.reasonCodes.negative.includes("domain_budget")) {
    return "domain_budget";
  }
  if (candidate.reasonCodes.negative.includes("top_k_budget")) {
    return "top_k_budget";
  }
  return undefined;
}

function destinationRetryAdvice(input: { fallbackCandidates: DestinationFallbackCandidateSummary[]; maxSelected: number; maxPerDomain: number }): DestinationRetryAdvice | undefined {
  if (input.fallbackCandidates.length === 0) {
    return undefined;
  }
  const topKBudgetMisses = input.fallbackCandidates.filter((candidate) => candidate.budgetReason === "top_k_budget").length;
  const domainBudgetMisses = input.fallbackCandidates.filter((candidate) => candidate.budgetReason === "domain_budget").length;
  const recommendedMaxSelected = topKBudgetMisses > 0 ? Math.min(5, input.maxSelected + topKBudgetMisses) : input.maxSelected;
  const recommendedMaxPerDomain = domainBudgetMisses > 0 ? Math.min(recommendedMaxSelected, input.maxPerDomain + domainBudgetMisses) : input.maxPerDomain;
  const reasons: DestinationRetryAdviceReason[] = [];
  if (topKBudgetMisses > 0 && recommendedMaxSelected > input.maxSelected) {
    reasons.push("increase_max_followups");
  }
  if (domainBudgetMisses > 0 && recommendedMaxPerDomain > input.maxPerDomain) {
    reasons.push("increase_max_followups_per_domain");
  }
  if (reasons.length === 0) {
    reasons.push("narrow_destination_selectors");
  }
  return {
    recommendedMaxSelected,
    recommendedMaxPerDomain,
    cliFlags: ["--source-navigation-max-followups", String(recommendedMaxSelected), "--source-navigation-max-followups-per-domain", String(recommendedMaxPerDomain)],
    reasons
  };
}

function quotePowershellArgument(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function safeProfileName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "destination"
  );
}

export async function writeDestinationCandidateArtifact(input: { writer: ArtifactWriter; runDir: string; parentUrl: string; contextToken: string; baseCaptureId: string; triage: DestinationTriageResult; signal?: AbortSignal | undefined }): Promise<ArtifactRecord[]> {
  if (input.triage.candidateCount === 0) {
    return [];
  }
  return input.writer.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: input.parentUrl,
    contextToken: input.contextToken,
    pageId: "destination-candidates",
    captureId: `${input.baseCaptureId}-destination-candidates`,
    metadata: { destinationCandidates: [...input.triage.selected, ...input.triage.rejected] },
    text: `${JSON.stringify(
      {
        schemaVersion: "1.0",
        parentUrl: input.parentUrl,
        candidates: [...input.triage.selected, ...input.triage.rejected]
      },
      null,
      2
    )}\n`,
    captureMethod: "browser-agent-mcp-farm destination-candidate",
    toolName: "destination_candidate",
    evidenceKind: "destination_candidate",
    note: `destination candidates: ${input.triage.candidateCount}`
  });
}

export async function writeDestinationTriageArtifact(input: { writer: ArtifactWriter; runDir: string; parentUrl: string; contextToken: string; baseCaptureId: string; triage: DestinationTriageResult; records: number; signal?: AbortSignal | undefined }): Promise<ArtifactRecord[]> {
  if (input.triage.candidateCount === 0) {
    return [];
  }
  const triage = {
    ...input.triage,
    summary: {
      ...input.triage.summary,
      records: input.records
    }
  };
  return input.writer.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: input.parentUrl,
    contextToken: input.contextToken,
    pageId: "destination-triage",
    captureId: `${input.baseCaptureId}-destination-triage`,
    status: artifactStatusForDestinationTriage(triage.summary),
    metadata: { destinationTriage: triage },
    text: `${JSON.stringify(triage, null, 2)}\n`,
    captureMethod: "browser-agent-mcp-farm destination-triage",
    toolName: "destination_triage",
    evidenceKind: "destination_triage",
    note: `destination triage: ${triage.summary.status}, selected=${triage.selectedCount}, rejected=${triage.rejectedCount}`
  });
}

export async function writeDestinationDeepeningProposalArtifact(input: { writer: ArtifactWriter; runDir: string; parentUrl: string; contextToken: string; baseCaptureId: string; proposals: DestinationDeepeningProposal[]; signal?: AbortSignal | undefined }): Promise<ArtifactRecord[]> {
  if (input.proposals.length === 0) {
    return [];
  }
  return input.writer.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: input.parentUrl,
    contextToken: input.contextToken,
    pageId: "destination-deepening-proposals",
    captureId: `${input.baseCaptureId}-destination-deepening-proposals`,
    metadata: { destinationDeepeningProposals: input.proposals },
    text: `${JSON.stringify(
      {
        schemaVersion: "1.0",
        parentUrl: input.parentUrl,
        proposals: input.proposals
      },
      null,
      2
    )}\n`,
    captureMethod: "browser-agent-mcp-farm destination-deepening-proposal",
    toolName: "destination_deepening_proposal",
    evidenceKind: "destination_deepening_proposal",
    note: `destination deepening proposals: ${input.proposals.length}`
  });
}

export async function writeDestinationDeepeningRunArtifact(input: { writer: ArtifactWriter; runDir: string; parentUrl: string; contextToken: string; baseCaptureId: string; summary: DestinationDeepeningExecutionSummary; signal?: AbortSignal | undefined }): Promise<ArtifactRecord[]> {
  if (input.summary.status === "not_requested" || input.summary.status === "not_enabled") {
    return [];
  }
  return input.writer.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: input.parentUrl,
    contextToken: input.contextToken,
    pageId: "destination-deepening-run",
    captureId: `${input.baseCaptureId}-destination-deepening-run`,
    status: artifactStatusForDestinationDeepeningExecution(input.summary),
    metadata: { destinationDeepeningExecution: input.summary },
    text: `${JSON.stringify(
      {
        schemaVersion: "1.0",
        parentUrl: input.parentUrl,
        execution: input.summary
      },
      null,
      2
    )}\n`,
    captureMethod: "browser-agent-mcp-farm destination-deepening-run",
    toolName: "destination_deepening_run",
    evidenceKind: "destination_deepening_run",
    note: `destination deepening run: ${input.summary.status}, attempted=${input.summary.attemptedCount}, omitted=${input.summary.omittedCount}`
  });
}

function buildCandidate(input: { parentUrl: string; platform: SourcePlatform; sourceFamily: SourceFamily; request: SourceNavigationFollowUpRequest; index: number; query?: string | undefined; sourceArtifactIds: string[] }): DestinationCandidate {
  const rawUrl = absoluteUrl(input.request.url, input.parentUrl);
  const resolution = resolveDestinationUrl(rawUrl);
  const url = resolution.url;
  const originalUrl = resolution.originalUrl ?? input.request.originalUrl;
  const urlResolutionMethod = resolution.method ?? input.request.urlResolutionMethod;
  const parsed = safeUrl(url);
  const normalizedUrl = normalizeDestinationUrl(url);
  const domain = parsed?.hostname.toLowerCase() ?? "unknown-host";
  const candidateKind = candidateKindFor(url, input.request.linkText);
  const queryIntent = destinationQueryIntent(input.query, input.parentUrl);
  const visibleMetadata = destinationVisibleMetadata(url, input.request.linkText);
  const signals = candidateSignals({
    parentUrl: input.parentUrl,
    url,
    domain,
    sourceFamily: input.sourceFamily,
    candidateKind,
    queryIntent,
    request: input.request,
    query: input.query
  });
  const warnings = candidateWarnings({
    parentUrl: input.parentUrl,
    sourceFamily: input.sourceFamily,
    candidateKind,
    url,
    request: input.request
  });
  const scoreBreakdown = scoreCandidate({
    rank: input.index + 1,
    candidateKind,
    queryIntent,
    signals,
    warnings,
    sourceFamily: input.sourceFamily,
    platform: input.platform
  });
  const reasonCodes = candidateDecisionReasons({
    url,
    candidateKind,
    signals,
    warnings,
    request: input.request
  });
  return {
    schemaVersion: "1.0",
    candidateId: `destination-candidate-${input.index + 1}`,
    requestIndex: input.index,
    actionKey: input.request.actionKey,
    parentUrl: input.parentUrl,
    url,
    ...(originalUrl === undefined ? {} : { originalUrl }),
    ...(urlResolutionMethod === undefined ? {} : { urlResolutionMethod }),
    normalizedUrl,
    domain,
    platform: input.platform,
    sourceFamily: input.sourceFamily,
    candidateKind,
    queryIntent,
    rank: input.index + 1,
    score: scoreBreakdown.total,
    scoreBreakdown,
    visibleMetadata,
    signals,
    warnings,
    reasonCodes,
    sourceArtifactIds: input.sourceArtifactIds,
    ...(input.request.selector === undefined ? {} : { selector: input.request.selector }),
    ...(input.request.linkText === undefined ? {} : { linkText: input.request.linkText }),
    ...(input.request.captureId === undefined ? {} : { captureId: input.request.captureId }),
    ...(input.request.note === undefined ? {} : { note: input.request.note })
  };
}

function candidateSignals(input: { parentUrl: string; url: string; domain: string; sourceFamily: SourceFamily; candidateKind: DestinationCandidateKind; queryIntent: DestinationQueryIntent; request: SourceNavigationFollowUpRequest; query?: string | undefined }): string[] {
  const signals: string[] = [input.candidateKind];
  const parentHost = safeUrl(input.parentUrl)?.hostname.toLowerCase();
  if (parentHost !== undefined && parentHost !== input.domain) {
    signals.push("external_destination");
  }
  if (input.request.selector !== undefined) {
    signals.push("selector_resolved");
  }
  if ((input.request.linkText ?? "").trim().length > 0) {
    signals.push("visible_link_text");
  }
  if (input.query !== undefined && tokenOverlap(input.query, `${input.request.linkText ?? ""} ${input.url}`) > 0) {
    signals.push("query_overlap");
  }
  if (input.queryIntent !== "general") {
    signals.push(`query_intent_${input.queryIntent}`);
    if (queryIntentFitsCandidateKind(input.queryIntent, input.candidateKind)) {
      signals.push("query_intent_match");
    }
  }
  if (/official|homepage|home page|publisher|article|post|review|menu|예약|공식|홈페이지|公式|ホームページ|記事|投稿|レビュー|メニュー|予約/i.test(input.request.linkText ?? "")) {
    signals.push("authority_hint");
  }
  const visibleMetadata = destinationVisibleMetadata(input.url, input.request.linkText);
  if (visibleMetadata.hasPriceLikeText) {
    signals.push("price_or_offer_hint");
  }
  if (visibleMetadata.hasRatingLikeText || visibleMetadata.hasReviewLikeText) {
    signals.push("review_or_rating_hint");
  }
  if (visibleMetadata.hasLocalPlaceLikeText) {
    signals.push("local_authority_hint");
  }
  if (visibleMetadata.hasPublisherLikeText) {
    signals.push("publisher_authority_hint");
  }
  signals.push(...authoritySignals(input.url, input.request.linkText, input.candidateKind));
  signals.push(...freshnessSignals(`${input.url} ${input.request.linkText ?? ""}`));
  signals.push(sourceFamilyFits(input.sourceFamily, input.candidateKind) ? "source_family_fit" : "source_family_weak_fit");
  return [...new Set(signals)];
}

function candidateWarnings(input: { parentUrl: string; sourceFamily: SourceFamily; candidateKind: DestinationCandidateKind; url: string; request: SourceNavigationFollowUpRequest }): string[] {
  const warnings: string[] = [];
  const parentHost = safeUrl(input.parentUrl)?.hostname.toLowerCase();
  const childHost = safeUrl(input.url)?.hostname.toLowerCase();
  if (parentHost !== undefined && childHost !== undefined && parentHost === childHost) {
    warnings.push("same_host_as_parent");
  }
  if (lowValuePattern().test(`${input.url} ${input.request.linkText ?? ""}`)) {
    warnings.push("low_value_navigation_surface");
  }
  if (providerBoilerplateSurface(input.parentUrl, input.url, input.request.linkText)) {
    warnings.push("low_value_navigation_surface");
  }
  if (loginOrAccountSurface(`${input.url} ${input.request.linkText ?? ""}`)) {
    warnings.push("login_or_account_surface");
  }
  if (staleYearHint(`${input.url} ${input.request.linkText ?? ""}`)) {
    warnings.push("stale_date_hint");
  }
  if (!sourceFamilyFits(input.sourceFamily, input.candidateKind)) {
    warnings.push("source_family_weak_fit");
  }
  return warnings;
}

function candidateDecisionReasons(input: { url: string; candidateKind: DestinationCandidateKind; signals: string[]; warnings: string[]; request: SourceNavigationFollowUpRequest }): DestinationDecisionReasons {
  const positive: DestinationDecisionReasonCode[] = [];
  const negative: DestinationDecisionReasonCode[] = [];
  const haystack = `${input.url} ${input.request.linkText ?? ""}`;

  if (input.signals.includes("query_overlap")) {
    positive.push("query_overlap");
  }
  if (input.candidateKind === "official" || input.signals.includes("official_authority_hint") || input.signals.includes("institutional_authority_hint")) {
    positive.push("official_domain_match");
  }
  if (input.candidateKind === "news" && input.signals.includes("freshness_recent_hint") && (input.signals.includes("publisher_authority_hint") || input.signals.includes("authority_hint"))) {
    positive.push("fresh_publisher_article");
  }
  if (input.candidateKind === "map_place" || input.signals.includes("local_authority_hint")) {
    positive.push("local_place_match");
  }
  if (input.candidateKind === "commerce" || input.signals.includes("price_or_offer_hint") || commerceEvidencePattern().test(haystack)) {
    positive.push("price_or_offer_visible");
  }
  if (input.signals.includes("source_family_fit")) {
    positive.push("source_family_fit");
  }
  if (input.signals.includes("query_intent_match")) {
    positive.push("query_intent_match");
  }

  if (input.warnings.includes("low_value_navigation_surface")) {
    negative.push("portal_shell");
  }
  if (input.warnings.includes("login_or_account_surface")) {
    negative.push("private_or_login_surface");
  }
  if (input.warnings.includes("stale_date_hint") || input.warnings.includes("source_family_weak_fit")) {
    negative.push("stale_or_mismatched_source");
  }
  if (!/^https?:\/\//i.test(input.url)) {
    negative.push("unsupported_destination");
  }

  return {
    positive: uniqueDecisionReasonCodes(positive),
    negative: uniqueDecisionReasonCodes(negative)
  };
}

function childDecisionReasons(result: DestinationChildRunResult | undefined, usefulness: DestinationUsefulness): DestinationDecisionReasons {
  const positive: DestinationDecisionReasonCode[] = [];
  const negative: DestinationDecisionReasonCode[] = [];
  const evidence = result?.childEvidence;

  if (evidence !== undefined) {
    if (evidence.queryOverlapTokenCount > 0 || evidence.evidenceSignals.includes("query_overlap")) {
      positive.push("query_overlap");
    }
    if (evidence.evidenceSignals.includes("ocr_evidence") || evidence.evidenceSignals.includes("transcript_evidence") || evidence.evidenceSignals.includes("transcript_cue")) {
      positive.push("transcript_or_ocr_hit");
    }
    if (commerceEvidencePattern().test(`${evidence.title ?? ""} ${evidence.finalUrl ?? ""} ${evidence.textSnippet ?? ""}`.toLowerCase())) {
      positive.push("price_or_offer_visible");
    }
    if (evidence.evidenceWarnings.includes("empty_visible_text") || evidence.evidenceWarnings.includes("missing_browser_capture") || evidence.evidenceWarnings.includes("missing_claims")) {
      negative.push("thin_content");
    }
    if (evidence.evidenceWarnings.includes("browser_obstruction_detected")) {
      negative.push("blocked_surface");
    }
    if (evidence.evidenceWarnings.includes("no_query_overlap")) {
      negative.push("off_topic");
    }
    if (evidence.evidenceWarnings.includes("query_script_mismatch_possible")) {
      negative.push("query_script_mismatch_possible");
    }
  }

  switch (usefulness) {
    case "blocked":
      negative.push("blocked_surface");
      break;
    case "paywalled":
      negative.push("paywalled_surface");
      break;
    case "private":
      negative.push("private_or_login_surface");
      break;
    case "unsupported":
      negative.push("unsupported_destination");
      break;
    case "low_value":
      negative.push("thin_content");
      break;
    case "off_topic":
      negative.push("off_topic");
      break;
    case "duplicate":
      negative.push("duplicate");
      break;
    case "budget_limited":
      negative.push("top_k_budget");
      break;
    case "useful":
      break;
  }

  return {
    positive: uniqueDecisionReasonCodes(positive),
    negative: uniqueDecisionReasonCodes(negative)
  };
}

function rejectionDecisionReasonCodes(usefulness: DestinationUsefulness, rejectionReason: string): DestinationDecisionReasonCode[] {
  if (usefulness === "duplicate") {
    return ["duplicate"];
  }
  if (usefulness === "budget_limited") {
    return rejectionReason.includes("per-domain") ? ["domain_budget"] : ["top_k_budget"];
  }
  if (usefulness === "private") {
    return ["private_or_login_surface"];
  }
  if (usefulness === "paywalled") {
    return ["paywalled_surface"];
  }
  if (usefulness === "unsupported") {
    return ["unsupported_destination"];
  }
  if (usefulness === "blocked") {
    return ["blocked_surface"];
  }
  if (usefulness === "low_value") {
    return ["portal_shell"];
  }
  if (usefulness === "off_topic") {
    return ["off_topic"];
  }
  return [];
}

function mergeDecisionReasons(base: DestinationDecisionReasons, next: DestinationDecisionReasons): DestinationDecisionReasons {
  return {
    positive: uniqueDecisionReasonCodes([...base.positive, ...next.positive]),
    negative: uniqueDecisionReasonCodes([...base.negative, ...next.negative])
  };
}

function uniqueDecisionReasonCodes(codes: DestinationDecisionReasonCode[]): DestinationDecisionReasonCode[] {
  return [...new Set(codes)];
}

function summarizeDestinationReasonCodes(candidates: Array<{ reasonCodes: DestinationDecisionReasons }>): { positive: DestinationReasonCodeCount[]; negative: DestinationReasonCodeCount[] } {
  return {
    positive: countDestinationReasonCodes(candidates.flatMap((candidate) => candidate.reasonCodes.positive)),
    negative: countDestinationReasonCodes(candidates.flatMap((candidate) => candidate.reasonCodes.negative))
  };
}

function countDestinationReasonCodes(codes: DestinationDecisionReasonCode[]): DestinationReasonCodeCount[] {
  const counts = new Map<DestinationDecisionReasonCode, number>();
  for (const code of codes) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => {
      const countDelta = right[1] - left[1];
      return countDelta !== 0 ? countDelta : left[0].localeCompare(right[0]);
    })
    .map(([reasonCode, count]) => ({ reasonCode, count }));
}

function destinationQueryIntent(query: string | undefined, parentUrl: string): DestinationQueryIntent {
  const haystack = `${query ?? ""} ${parentUrl}`.toLowerCase();
  if (/\b(price|deal|booking|book|buy|shop|shopping|product|offer|rate|room|availability|coupon|discount|shipping|return|hotel)\b/.test(haystack) || /가격|요금|구매|쇼핑|상품|할인|쿠폰|배송|반품|호텔|숙박|料金|価格|購入|通販|商品|割引|クーポン|配送|返品|ホテル|宿泊/.test(haystack)) {
    return "commerce_offer";
  }
  if (/\b(latest|recent|today|breaking|news|article|reported|report|update|publisher|press)\b/.test(haystack) || /최신|최근|오늘|속보|뉴스|기사|보도|언론|신문|発表|最新|最近|今日|速報|ニュース|記事|報道|新聞/.test(haystack) || /[?&]tbm=nws\b/.test(haystack) || /[?&]where=news\b/.test(haystack)) {
    return "fresh_news";
  }
  if (/\b(review|reviews|rating|ratings|experience|blog|forum|community|thread|opinion|compare|comparison|best|recommend)\b/.test(haystack) || /후기|리뷰|평점|경험|블로그|카페글|커뮤니티|게시글|의견|비교|추천|口コミ|レビュー|評価|体験|ブログ|掲示板|コミュニティ|比較|おすすめ/.test(haystack)) {
    return "experience_review";
  }
  if (/\b(video|youtube|instagram|tiktok|reel|reels|shorts|image|images|photo|photos|watch)\b/.test(haystack) || /영상|동영상|유튜브|인스타|틱톡|릴스|쇼츠|이미지|사진|動画|映像|ユーチューブ|インスタ|ティックトック|画像|写真/.test(haystack)) {
    return "media_content";
  }
  if (/\b(official|homepage|home page|contact|policy|spec|specs|manual|documentation|source|primary)\b/.test(haystack) || /공식|홈페이지|연락처|정책|사양|스펙|매뉴얼|문서|원문|출처|公式|ホームページ|連絡先|仕様|マニュアル|文書|原文|出典/.test(haystack)) {
    return "official_fact";
  }
  if (/\b(near|nearby|map|maps|place|address|hours|open now|route|directions|menu|reservation|restaurant|cafe)\b/.test(haystack) || /근처|주변|지도|장소|주소|영업시간|길찾기|메뉴|예약|식당|맛집|카페|近く|周辺|地図|場所|住所|営業時間|経路|行き方|メニュー|予約|レストラン|カフェ/.test(haystack)) {
    return "local_place";
  }
  return "general";
}

function queryIntentFitsCandidateKind(intent: DestinationQueryIntent, candidateKind: DestinationCandidateKind): boolean {
  switch (intent) {
    case "fresh_news":
      return candidateKind === "news";
    case "official_fact":
      return candidateKind === "official";
    case "experience_review":
      return ["blog", "review", "community"].includes(candidateKind);
    case "local_place":
      return ["map_place", "review"].includes(candidateKind);
    case "commerce_offer":
      return ["commerce", "review"].includes(candidateKind);
    case "media_content":
      return candidateKind === "media";
    case "general":
      return false;
  }
}

function queryIntentScore(intent: DestinationQueryIntent, candidateKind: DestinationCandidateKind): number {
  switch (intent) {
    case "fresh_news":
      return candidateKind === "news" ? 22 : candidateKind === "official" ? 4 : 0;
    case "official_fact":
      return candidateKind === "official" ? 22 : candidateKind === "map_place" ? 8 : 0;
    case "experience_review":
      return ["blog", "review", "community"].includes(candidateKind) ? 22 : candidateKind === "media" ? 6 : 0;
    case "local_place":
      return candidateKind === "map_place" ? 22 : candidateKind === "review" ? 10 : candidateKind === "official" ? 5 : 0;
    case "commerce_offer":
      return candidateKind === "commerce" ? 22 : candidateKind === "review" ? 8 : candidateKind === "official" ? 4 : 0;
    case "media_content":
      return candidateKind === "media" ? 22 : candidateKind === "community" ? 6 : 0;
    case "general":
      return 0;
  }
}

function scoreCandidate(input: { rank: number; candidateKind: DestinationCandidateKind; queryIntent: DestinationQueryIntent; signals: string[]; warnings: string[]; sourceFamily: SourceFamily; platform: SourcePlatform }): DestinationCandidateScoreBreakdown {
  const profile = scoringProfileFor(input.sourceFamily, input.platform);
  const base = 50;
  const rank = Math.round(Math.max(0, 12 - input.rank) * profile.rankMultiplier);
  const kind = ["official", "news", "blog", "community", "review"].includes(input.candidateKind) ? 12 : ["commerce", "map_place", "media"].includes(input.candidateKind) ? 8 : 0;
  const query = Math.round((input.signals.includes("query_overlap") ? 14 : 0) * profile.queryMultiplier);
  const authority = Math.round(authorityScore(input.signals) * profile.authorityMultiplier);
  const freshness = Math.round(freshnessScore(input.signals, input.warnings) * profile.freshnessMultiplier);
  const sourceFamilyFit = Math.round((input.signals.includes("source_family_fit") ? 8 : -12) * profile.sourceFamilyFitMultiplier);
  const queryIntent = queryIntentScore(input.queryIntent, input.candidateKind);
  const profileAdjustment = profile.kindAdjustments[input.candidateKind] ?? 0;
  const externalDestination = Math.round((input.signals.includes("external_destination") ? 4 : 0) * profile.externalDestinationMultiplier);
  let warnings = 0;
  if (input.warnings.includes("same_host_as_parent")) {
    warnings -= 5;
  }
  if (input.warnings.includes("low_value_navigation_surface")) {
    warnings -= 50;
  }
  if (input.warnings.includes("login_or_account_surface")) {
    warnings -= 40;
  }
  if (input.warnings.includes("stale_date_hint")) {
    warnings -= 8;
  }
  const total = base + rank + kind + query + authority + freshness + sourceFamilyFit + queryIntent + profileAdjustment + externalDestination + warnings;
  return {
    profile: profile.name,
    base,
    rank,
    kind,
    query,
    authority,
    freshness,
    sourceFamilyFit,
    queryIntent,
    profileAdjustment,
    externalDestination,
    warnings,
    total
  };
}

function scoringProfileFor(sourceFamily: SourceFamily, platform: SourcePlatform): DestinationScoringProfile {
  switch (sourceFamily) {
    case "search":
      return {
        name: "search_general",
        rankMultiplier: 1,
        queryMultiplier: 1,
        authorityMultiplier: 1,
        freshnessMultiplier: 1,
        sourceFamilyFitMultiplier: 1,
        externalDestinationMultiplier: 1,
        kindAdjustments: {}
      };
    case "map":
      return {
        name: "map_local",
        rankMultiplier: 0.8,
        queryMultiplier: 0.8,
        authorityMultiplier: 1.1,
        freshnessMultiplier: 0.6,
        sourceFamilyFitMultiplier: 1.3,
        externalDestinationMultiplier: 1,
        kindAdjustments: {
          map_place: 18,
          review: 8,
          official: 0
        }
      };
    case "blog":
      return {
        name: "blog_content",
        rankMultiplier: 0.9,
        queryMultiplier: 1,
        authorityMultiplier: 0.8,
        freshnessMultiplier: 1.1,
        sourceFamilyFitMultiplier: 1.2,
        externalDestinationMultiplier: 1,
        kindAdjustments: {
          blog: 6,
          community: 4,
          media: 3,
          official: 3
        }
      };
    case "portal":
      if (platform === "yelp" || platform === "tripadvisor") {
        return {
          name: "map_local",
          rankMultiplier: 0.8,
          queryMultiplier: 0.8,
          authorityMultiplier: 1.1,
          freshnessMultiplier: 0.6,
          sourceFamilyFitMultiplier: 1.3,
          externalDestinationMultiplier: 1,
          kindAdjustments: {
            map_place: 18,
            review: 8,
            official: 0
          }
        };
      }
      return {
        name: "portal_news",
        rankMultiplier: 1,
        queryMultiplier: 1,
        authorityMultiplier: 1.2,
        freshnessMultiplier: 1.3,
        sourceFamilyFitMultiplier: 1.1,
        externalDestinationMultiplier: 1,
        kindAdjustments: {
          news: 6,
          community: 4,
          review: 4,
          official: 3
        }
      };
    case "travel_booking":
      return {
        name: "travel_booking",
        rankMultiplier: 0.8,
        queryMultiplier: 1.1,
        authorityMultiplier: 0.8,
        freshnessMultiplier: 1.5,
        sourceFamilyFitMultiplier: 1.4,
        externalDestinationMultiplier: 1,
        kindAdjustments: {
          commerce: 8,
          review: 5,
          map_place: 5,
          official: 3
        }
      };
    case "commerce":
      return {
        name: "commerce",
        rankMultiplier: 0.8,
        queryMultiplier: 1.1,
        authorityMultiplier: 0.8,
        freshnessMultiplier: 1.5,
        sourceFamilyFitMultiplier: 1.4,
        externalDestinationMultiplier: 1,
        kindAdjustments: {
          commerce: 8,
          review: 5,
          official: 3
        }
      };
    case "video_social":
      return {
        name: "video_social",
        rankMultiplier: 0.9,
        queryMultiplier: 1,
        authorityMultiplier: 0.9,
        freshnessMultiplier: 1.2,
        sourceFamilyFitMultiplier: 1.2,
        externalDestinationMultiplier: 1,
        kindAdjustments: {
          media: 8,
          community: 5,
          official: 3
        }
      };
    case "generic_web":
      return {
        name: "generic_web",
        rankMultiplier: 1,
        queryMultiplier: 1,
        authorityMultiplier: 1,
        freshnessMultiplier: 1,
        sourceFamilyFitMultiplier: 1,
        externalDestinationMultiplier: 1,
        kindAdjustments: {
          official: 4,
          news: 3,
          blog: 3
        }
      };
  }
}

function authoritySignals(url: string, linkText: string | undefined, candidateKind: DestinationCandidateKind): string[] {
  const parsed = safeUrl(url);
  const host = parsed?.hostname.toLowerCase() ?? "";
  const path = parsed?.pathname.toLowerCase() ?? "";
  const text = (linkText ?? "").toLowerCase();
  const haystack = `${host} ${path} ${text}`;
  const signals: string[] = [];
  if (/official|homepage|home page|home-page|publisher|공식|홈페이지|公式|ホームページ/.test(haystack) || host.startsWith("official.")) {
    signals.push("official_authority_hint");
  }
  if (/\.(gov|edu)$/i.test(host) || /\.(go|ac)\.kr$/i.test(host) || /\.go\.jp$/i.test(host)) {
    signals.push("institutional_authority_hint");
  }
  if (candidateKind === "news" && /news|reuters|bloomberg|bbc|yonhap|publisher|article|뉴스|기사|보도|언론|신문|ニュース|記事|報道|新聞/.test(haystack)) {
    signals.push("publisher_authority_hint");
  }
  if (candidateKind === "map_place" && /official|menu|place|map|hours|address|review|메뉴|장소|지도|영업시간|주소|리뷰|メニュー|場所|地図|営業時間|住所|レビュー/.test(haystack)) {
    signals.push("local_authority_hint");
  }
  return signals;
}

function destinationVisibleMetadata(url: string, linkText: string | undefined): DestinationVisibleMetadata {
  const text = normalizedWhitespace(linkText ?? "");
  const haystack = `${url} ${text}`;
  const years = [...new Set(yearHints(haystack))].sort((left, right) => left - right);
  const currentYear = new Date().getUTCFullYear();
  return {
    ...(text.length === 0 ? {} : { textSnippet: text.slice(0, 240) }),
    years,
    hasRecentYearHint: years.some((year) => year >= currentYear - 1 && year <= currentYear + 1),
    hasStaleYearHint: staleYearHint(haystack),
    hasPriceLikeText: priceLikePattern().test(haystack),
    hasRatingLikeText: ratingLikePattern().test(haystack),
    hasReviewLikeText: reviewLikePattern().test(haystack),
    hasLocalPlaceLikeText: localPlaceLikePattern().test(haystack),
    hasPublisherLikeText: publisherLikePattern().test(haystack)
  };
}

function normalizedWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function priceLikePattern(): RegExp {
  return /(?:[$₩¥€£]\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:usd|krw|jpy|won|yen|eur|gbp)\b|\d[\d,.]*\s?(?:원|엔|円|만원|천원)|\b(?:price|offer|deal|rate|room|fee|tax|coupon|discount)\b|가격|요금|금액|예약|숙박|호텔|할인|쿠폰|배송|반품|料金|価格|金額|予約|宿泊|ホテル|割引|クーポン|配送|返品|%)/i;
}

function ratingLikePattern(): RegExp {
  return /(?:\b(?:[0-5](?:\.\d)?\s?(?:\/\s?5|stars?)|rating\s?[0-5](?:\.\d)?)\b|평점\s?[0-5](?:\.\d)?|[0-5](?:\.\d)?\s?점|별점|評価\s?[0-5](?:\.\d)?|[0-5](?:\.\d)?\s?点|星\s?[0-5](?:\.\d)?)/i;
}

function reviewLikePattern(): RegExp {
  return /(?:\b(?:reviews?|reviewed|comments?|testimonials?)\b|후기|리뷰|평가|평점|댓글|방문기|사용기|口コミ|レビュー|評価|評判|体験談|コメント)/i;
}

function localPlaceLikePattern(): RegExp {
  return /(?:\b(?:address|hours|menu|reservation|place|map|nearby|route|directions)\b|주소|영업시간|메뉴|예약|지도|장소|근처|주변|길찾기|전화|매장|식당|맛집|카페|병원|地図|場所|住所|営業時間|メニュー|予約|近く|周辺|経路|行き方|電話|店舗|レストラン|カフェ)/i;
}

function publisherLikePattern(): RegExp {
  return /(?:\b(?:news|article|publisher|press|reported|byline|updated|editorial)\b|뉴스|기사|보도|언론|신문|기자|입력|수정|발표|ニュース|記事|報道|新聞|記者|発表|更新)/i;
}

function freshnessSignals(value: string): string[] {
  const years = yearHints(value);
  if (years.length === 0) {
    return [];
  }
  const currentYear = new Date().getUTCFullYear();
  const signals = ["dated_content_hint"];
  if (years.some((year) => year >= currentYear - 1 && year <= currentYear + 1)) {
    signals.push("freshness_recent_hint");
  }
  return signals;
}

function authorityScore(signals: string[]): number {
  let score = 0;
  if (signals.includes("authority_hint")) {
    score += 8;
  }
  if (signals.includes("official_authority_hint")) {
    score += 12;
  }
  if (signals.includes("institutional_authority_hint")) {
    score += 10;
  }
  if (signals.includes("publisher_authority_hint")) {
    score += 8;
  }
  if (signals.includes("local_authority_hint")) {
    score += 6;
  }
  return Math.min(score, 20);
}

function freshnessScore(signals: string[], warnings: string[]): number {
  let score = 0;
  if (signals.includes("freshness_recent_hint")) {
    score += 8;
  } else if (signals.includes("dated_content_hint")) {
    score += 2;
  }
  if (warnings.includes("stale_date_hint")) {
    score -= 8;
  }
  return score;
}

function sourceFamilyFits(sourceFamily: SourceFamily, candidateKind: DestinationCandidateKind): boolean {
  switch (sourceFamily) {
    case "search":
    case "generic_web":
      return true;
    case "map":
      return ["map_place", "review", "official"].includes(candidateKind);
    case "blog":
      return ["blog", "community", "media", "official"].includes(candidateKind);
    case "portal":
      return ["news", "blog", "community", "review", "official"].includes(candidateKind);
    case "travel_booking":
      return ["commerce", "review", "map_place", "official"].includes(candidateKind);
    case "commerce":
      return ["commerce", "review", "official"].includes(candidateKind);
    case "video_social":
      return ["media", "community", "official"].includes(candidateKind);
  }
}

function staleYearHint(value: string): boolean {
  const years = yearHints(value);
  if (years.length === 0) {
    return false;
  }
  const currentYear = new Date().getUTCFullYear();
  return years.every((year) => year < currentYear - 3);
}

function yearHints(value: string): number[] {
  return [...value.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1])).filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2099);
}

function hardRejectionFor(candidate: DestinationCandidate):
  | {
      usefulness: DestinationUsefulness;
      reason: string;
      reasonCode: DestinationDecisionReasonCode;
    }
  | undefined {
  const haystack = `${candidate.url} ${candidate.linkText ?? ""}`;
  if (loginOrAccountSurface(haystack)) {
    return {
      usefulness: "private",
      reason: "Destination appears to require login or account access.",
      reasonCode: "private_or_login_surface"
    };
  }
  if (candidate.warnings.includes("low_value_navigation_surface") || lowValuePattern().test(haystack)) {
    return {
      usefulness: "low_value",
      reason: "Destination is a low-value navigation or policy surface.",
      reasonCode: "portal_shell"
    };
  }
  if (!/^https?:\/\//i.test(candidate.url)) {
    return {
      usefulness: "unsupported",
      reason: "Destination is not an HTTP(S) URL.",
      reasonCode: "unsupported_destination"
    };
  }
  return undefined;
}

function rejectCandidate(candidate: DestinationCandidate, usefulness: DestinationUsefulness, rejectionReason: string, reasonCode?: DestinationDecisionReasonCode | undefined): DestinationRejectedCandidate {
  return {
    ...candidate,
    selectionStatus: "rejected",
    usefulness,
    rejectionReason,
    reasonCodes: mergeDecisionReasons(candidate.reasonCodes, {
      positive: [],
      negative: reasonCode === undefined ? rejectionDecisionReasonCodes(usefulness, rejectionReason) : [reasonCode]
    })
  };
}

export function classifyDestinationChildUsefulness(result: DestinationChildRunResult | undefined, query: string | undefined, context?: DestinationChildUsefulnessContext | undefined): DestinationUsefulness {
  if (result === undefined) {
    return "useful";
  }
  if (result.status === "ok") {
    const evidence = result.childEvidence;
    if (evidence === undefined) {
      return "useful";
    }
    if (evidence.obstructionCount > 0 || evidence.evidenceWarnings.includes("browser_obstruction_detected")) {
      return "blocked";
    }
    if (evidence.browserCaptureRecords === 0 || evidence.pageTextLength === 0 || evidence.claimCount === 0) {
      return "low_value";
    }
    if (query !== undefined && evidence.queryOverlapTokenCount === 0) {
      return "off_topic";
    }
    if (context !== undefined && context.queryIntent !== "general" && !queryIntentFitsCandidateKind(context.queryIntent, context.candidateKind) && !childEvidenceSupportsQueryIntent(evidence, context.queryIntent)) {
      return "off_topic";
    }
    return "useful";
  }
  const error = result.error ?? "";
  if (/paywall|subscribe|subscription/i.test(error)) {
    return "paywalled";
  }
  if (loginOrAccountSurface(error)) {
    return "private";
  }
  return "blocked";
}

function childEvidenceSupportsQueryIntent(evidence: DestinationChildEvidenceSummary, intent: DestinationQueryIntent): boolean {
  const haystack = `${evidence.title ?? ""} ${evidence.finalUrl ?? ""} ${evidence.textSnippet ?? ""}`.toLowerCase();
  switch (intent) {
    case "commerce_offer":
      return commerceEvidencePattern().test(haystack);
    case "fresh_news":
      return /\b(news|article|reported|publisher|press|updated|breaking)\b|뉴스|기사|보도|언론|신문|ニュース|記事|報道|新聞/.test(haystack);
    case "experience_review":
      return /\b(review|reviews|rating|ratings|experience|blog|forum|thread|opinion|recommend)\b|후기|리뷰|평점|경험|블로그|추천|レビュー|口コミ|評判|体験/.test(haystack);
    case "local_place":
      return /\b(map|place|address|hours|open now|directions|menu|reservation|restaurant|cafe)\b|장소|지도|주소|영업시간|메뉴|예약|식당|카페|場所|地図|住所|営業時間|メニュー|予約|レストラン|カフェ/.test(haystack);
    case "media_content":
      return /\b(video|youtube|watch|music|song|official video|reel|shorts|image|photo)\b|영상|동영상|유튜브|음악|노래|이미지|사진|動画|音楽|曲|画像|写真/.test(haystack);
    case "official_fact":
      return /\b(official|homepage|contact|about|source|primary|documentation)\b|공식|홈페이지|연락처|출처|公式|ホームページ|連絡先|出典/.test(haystack);
    case "general":
      return true;
  }
}

export function classifyDestinationProbeCandidate(input: { parentUrl: string; sourceFamily: SourceFamily; url: string; linkText?: string | undefined }): DestinationProbeCandidateClassification {
  const warnings: string[] = [];
  const url = resolveDestinationUrl(input.url, input.parentUrl).url;
  const haystack = `${url} ${input.url} ${input.linkText ?? ""}`;
  const parsed = safeUrl(url);
  if (parsed === undefined || !/^https?:$/i.test(parsed.protocol)) {
    warnings.push("unsupported_destination");
  }
  if (lowValuePattern().test(haystack) || providerBoilerplateSurface(input.parentUrl, url, input.linkText)) {
    warnings.push("low_value_navigation_surface");
  }
  if (loginOrAccountSurface(haystack)) {
    warnings.push("login_or_account_surface");
  }
  const candidateKind = candidateKindFor(url, input.linkText);
  if (!sourceFamilyFits(input.sourceFamily, candidateKind)) {
    warnings.push("source_family_weak_fit");
  }
  const hardWarnings = new Set(["unsupported_destination", "low_value_navigation_surface", "login_or_account_surface"]);
  return {
    promotable: warnings.every((warning) => !hardWarnings.has(warning)),
    warnings
  };
}

function artifactStatusForDestinationDeepeningExecution(summary: DestinationDeepeningExecutionSummary): ArtifactStatus {
  return summary.status === "partial" ? "partial" : "ok";
}

function destinationTriageWarnings(input: BuildDestinationTriageInput, candidates: DestinationCandidate[], selected: DestinationSelectedCandidate[], rejected: DestinationRejectedCandidate[]): string[] {
  const maxSelected = normalizeMaxSelected(input.maxSelected);
  const maxPerDomain = normalizeMaxPerDomain(input.maxPerDomain, maxSelected);
  const warnings = ["Destination triage is bounded evidence selection, not autonomous crawling.", "Portal result evidence and destination content evidence must remain separately cited."];
  if (candidates.length > selected.length) {
    warnings.push("Some destination candidates were rejected or omitted by the top-K budget.");
  }
  if (input.requests.length > maxSelected) {
    warnings.push(`maxSelected limited child runs to ${maxSelected} of ${input.requests.length} request(s).`);
  }
  if (maxSelected > 0 && maxPerDomain < maxSelected && rejected.some((candidate) => candidate.usefulness === "budget_limited")) {
    warnings.push(`maxPerDomain limited child runs to ${maxPerDomain} per destination domain.`);
  }
  if (rejected.some((candidate) => candidate.usefulness === "private" || candidate.usefulness === "paywalled")) {
    warnings.push("Private, login, and paywalled destinations are recorded as evidence but not bypassed.");
  }
  if (selected.some((candidate) => candidate.usefulness !== "useful")) {
    warnings.push("At least one selected child destination was downgraded after browser-visible child evidence review.");
  }
  if (selected.some((candidate) => candidate.usefulness !== "useful") && rejected.some((candidate) => candidate.usefulness === "budget_limited" && candidate.reasonCodes.negative.includes("top_k_budget"))) {
    warnings.push("Selected child evidence was downgraded while unattempted fallback candidates remain; rerun with a higher maxFollowUps value or narrower destination selectors to test additional sources.");
  }
  return warnings;
}

function selectWithinBudgets(sorted: DestinationCandidate[], maxSelected: number, maxPerDomain: number): { selectedBase: DestinationCandidate[]; domainLimitedIds: Set<string> } {
  const selectedBase: DestinationCandidate[] = [];
  const domainCounts = new Map<string, number>();
  const domainLimitedIds = new Set<string>();
  for (const candidate of sorted) {
    if (selectedBase.length >= maxSelected) {
      break;
    }
    const domainCount = domainCounts.get(candidate.domain) ?? 0;
    if (maxPerDomain >= 0 && domainCount >= maxPerDomain) {
      domainLimitedIds.add(candidate.candidateId);
      continue;
    }
    selectedBase.push(candidate);
    domainCounts.set(candidate.domain, domainCount + 1);
  }
  return { selectedBase, domainLimitedIds };
}

function normalizeMaxSelected(value: number): number {
  return Math.max(0, Math.min(5, Math.trunc(value)));
}

function normalizeMaxPerDomain(value: number | undefined, maxSelected: number): number {
  if (maxSelected === 0) {
    return 0;
  }
  if (value === undefined) {
    return Math.min(2, maxSelected);
  }
  return Math.max(0, Math.min(maxSelected, Math.trunc(value)));
}

function candidateKindFor(url: string, linkText: string | undefined): DestinationCandidateKind {
  const parsed = safeUrl(url);
  const host = parsed?.hostname.toLowerCase() ?? "";
  const path = parsed?.pathname.toLowerCase() ?? "";
  const text = (linkText ?? "").toLowerCase();
  const haystack = `${host} ${path} ${text}`;
  const strongMapSurface = /maps?|place|local|restaurant|menu|place\.naver|map\.naver|map\.kakao|google\.[^ ]*\/maps/.test(haystack);
  const localTextSurface =
    /near|nearby|address|hours|open now|route|directions|reservation|restaurant|cafe|주소|영업시간|길찾기|메뉴|예약|식당|맛집|카페|병원|近く|周辺|住所|営業時間|経路|行き方|メニュー|予約|レストラン|カフェ/.test(haystack) ||
    /(?:지도|장소|地図|場所).*(?:주소|영업시간|메뉴|예약|리뷰|후기|카페|식당|맛집|住所|営業時間|メニュー|予約|レビュー|口コミ|カフェ|レストラン)/.test(haystack);

  if (/news|article|publisher|n\.news\.naver|v\.daum\.net|reuters|bloomberg|bbc|yonhap|뉴스|기사|보도|언론|신문|ニュース|記事|報道|新聞/.test(haystack)) {
    return "news";
  }
  if (/blog|post|medium|tistory|brunch|블로그|포스트|브런치|ブログ|投稿/.test(haystack)) {
    return "blog";
  }
  if (strongMapSurface) {
    return "map_place";
  }
  if (/reddit|quora|stack|dcinside|cafe\.naver|kin\.naver|forum|thread|answer|카페글|커뮤니티|게시판|게시글|질문|답변|지식인|掲示板|コミュニティ|質問|回答/.test(haystack)) {
    return "community";
  }
  if (/youtube|youtu\.be|instagram|tiktok|twitter|x\.com|threads|video|watch|reels|music|song/.test(haystack)) {
    return "media";
  }
  if (/official|homepage|home page/.test(haystack)) {
    return "official";
  }
  if (/review|rating|tripadvisor|yelp/.test(haystack)) {
    return "review";
  }
  if (commerceDestinationPattern(host, haystack)) {
    return "commerce";
  }
  if (/\btokio[_\s-]?hotel\b|tokiohotel|hotelwikipedia|[_/-]hotel(?:[_/-]|$)/.test(haystack)) {
    return "generic";
  }
  if (/\bhotel\b/.test(haystack)) {
    return "generic";
  }
  if (/booking|agoda|trip\.com|expedia|amazon|coupang|gmarket|shop|shopping|commerce|product|hotel|가격|요금|구매|쇼핑|상품|할인|쿠폰|배송|반품|호텔|숙박|料金|価格|購入|通販|商品|割引|クーポン|配送|返品|ホテル|宿泊/.test(haystack)) {
    return "commerce";
  }
  if (/youtube|youtu\.be|instagram|tiktok|twitter|x\.com|threads|video|watch|reels|영상|동영상|유튜브|인스타|틱톡|릴스|쇼츠|이미지|사진|動画|映像|ユーチューブ|インスタ|ティックトック|画像|写真/.test(haystack)) {
    return "media";
  }
  if (/official|homepage|home page|공식|홈페이지|公式|ホームページ/.test(haystack)) {
    return "official";
  }
  if (/review|rating|tripadvisor|yelp|후기|리뷰|평점|평가|口コミ|レビュー|評価/.test(haystack)) {
    return "review";
  }
  if (localTextSurface) {
    return "map_place";
  }
  return "generic";
}

function commerceDestinationPattern(host: string, haystack: string): boolean {
  if (/booking|agoda|trip\.com|expedia|amazon|coupang|gmarket|walmart|ebay|shop|shopping|commerce|product/.test(host)) {
    return true;
  }
  if (/\b(shop|shopping|commerce|product|products|buy|price|prices|offer|offers|deal|deals|booking|book now|availability|rate|rates|room|rooms|hotel\s+offer|hotels|lodging|accommodation|stays?)\b/.test(haystack)) {
    return true;
  }
  return /가격|요금|구매|쇼핑|상품|할인|쿠폰|배송|반품|호텔|숙박|객실|예약|料金|価格|購入|通販|商品|割引|クーポン|配送|返品|ホテル|宿泊|客室|予約/.test(haystack);
}

function commerceEvidencePattern(): RegExp {
  return /\b(price|prices|offer|offers|booking|book now|availability|rate|rates|room|rooms|deal|deals|fee|tax|usd|krw|jpy|won|yen|hotels|lodging|accommodation|stays?)\b|가격|요금|할인|쿠폰|숙박|객실|예약|호텔|料金|価格|割引|クーポン|宿泊|客室|予約|ホテル/;
}

function queryFromUrl(url: string): string | undefined {
  const parsed = safeUrl(url);
  if (parsed === undefined) {
    return undefined;
  }
  for (const key of ["q", "query", "keyword", "search_query", "p", "text", "destination"]) {
    const value = parsed.searchParams.get(key);
    if (value !== null && value.trim().length > 0) {
      return value.trim();
    }
  }
  const pathQuery = queryFromKnownSearchPath(parsed);
  if (pathQuery !== undefined) {
    return pathQuery;
  }
  return undefined;
}

function queryFromKnownSearchPath(parsed: URL): string | undefined {
  const patterns = [/\/maps\/search\/([^/?#]+)/i, /\/p\/search\/([^/?#]+)/i];
  for (const pattern of patterns) {
    const match = parsed.pathname.match(pattern);
    const raw = match?.[1];
    if (raw === undefined) {
      continue;
    }
    const decoded = decodeUrlPathQuerySegment(raw);
    if (decoded !== undefined) {
      return decoded;
    }
  }
  return undefined;
}

function decodeUrlPathQuerySegment(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value.replace(/\+/g, " ")).replace(/\s+/g, " ").trim();
    return decoded.length === 0 ? undefined : decoded;
  } catch {
    const fallback = value.replace(/\+/g, " ").replace(/\s+/g, " ").trim();
    return fallback.length === 0 ? undefined : fallback;
  }
}

function normalizedQuery(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function tokenOverlap(query: string, value: string): number {
  return matchingDestinationQueryTokens(query, value).length;
}

export function matchingDestinationQueryTokens(query: string, value: string): string[] {
  const valueTokens = expandedTokenSet(tokens(value));
  return [...new Set(tokens(query).filter((token) => expandedTokensFor(token).some((expanded) => valueTokens.has(expanded))))];
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9가-힣ぁ-んァ-ン一-龥]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

const CROSS_SCRIPT_QUERY_ALIAS_GROUPS = [
  ["seoul", "서울"],
  ["gangnam", "강남"],
  ["hongdae", "홍대"],
  ["myeongdong", "명동"],
  ["seongsu", "성수"],
  ["tokyo", "東京"],
  ["shinjuku", "新宿"],
  ["shibuya", "渋谷"],
  ["osaka", "大阪"],
  ["kyoto", "京都"],
  ["cafe", "coffee", "카페", "커피", "カフェ", "コーヒー"],
  ["restaurant", "food", "dining", "식당", "맛집", "음식", "レストラン", "グルメ", "食事"],
  ["hotel", "stay", "room", "호텔", "숙박", "객실", "ホテル", "宿泊", "部屋"],
  ["price", "fee", "rate", "deal", "가격", "요금", "할인", "料金", "価格", "割引"],
  ["booking", "reservation", "예약", "予約"],
  ["review", "reviews", "rating", "후기", "리뷰", "평점", "口コミ", "レビュー", "評価"],
  ["menu", "메뉴", "メニュー"],
  ["map", "place", "address", "지도", "장소", "주소", "地図", "場所", "住所"],
  ["news", "article", "뉴스", "기사", "ニュース", "記事"],
  ["video", "image", "photo", "동영상", "영상", "이미지", "사진", "動画", "画像", "写真"],
  ["official", "homepage", "공식", "홈페이지", "公式", "ホームページ"],
  ["ramen", "라멘", "라면", "ラーメン"],
  ["sushi", "초밥", "스시", "寿司"]
] as const;

const CROSS_SCRIPT_QUERY_ALIAS_MAP: ReadonlyMap<string, readonly string[]> = buildCrossScriptQueryAliasMap();

function buildCrossScriptQueryAliasMap(): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (const group of CROSS_SCRIPT_QUERY_ALIAS_GROUPS) {
    const normalized = group.map((token) => token.toLowerCase());
    for (const token of normalized) {
      map.set(
        token,
        normalized.filter((candidate) => candidate !== token)
      );
    }
  }
  return map;
}

function expandedTokenSet(sourceTokens: string[]): Set<string> {
  const expanded = new Set<string>();
  for (const token of sourceTokens) {
    for (const value of expandedTokensFor(token)) {
      expanded.add(value);
    }
  }
  return expanded;
}

function expandedTokensFor(token: string): string[] {
  return [token, ...(CROSS_SCRIPT_QUERY_ALIAS_MAP.get(token) ?? [])];
}

function absoluteUrl(url: string, parentUrl: string): string {
  try {
    return new URL(url, parentUrl).href;
  } catch {
    return url;
  }
}

function normalizeDestinationUrl(url: string): string {
  const parsed = safeUrl(url);
  if (parsed === undefined) {
    return url.trim();
  }
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.searchParams.sort();
  return parsed.href;
}

function childResultKey(actionKey: string, url: string): string {
  return `${actionKey}\u0000${normalizeDestinationUrl(url)}`;
}

function lowValuePattern(): RegExp {
  return /privacy|terms|cookie|cookies|advertis|careers|jobs|help|support|feedback|preferences/i;
}

function providerBoilerplateSurface(parentUrl: string, destinationUrl: string, linkText: string | undefined): boolean {
  const parent = safeUrl(parentUrl);
  const destination = safeUrl(destinationUrl);
  if (parent === undefined || destination === undefined) {
    return false;
  }
  const parentHost = parent.hostname.toLowerCase();
  const parentPath = parent.pathname.toLowerCase();
  const destinationHost = destination.hostname.toLowerCase();
  const destinationPath = destination.pathname.toLowerCase();
  const haystack = `${destinationHost} ${destinationPath} ${linkText ?? ""}`.toLowerCase();

  if (sameDocumentAnchorSurface(parent, destination)) {
    return true;
  }

  if (isKakaoMapHost(parentHost)) {
    if (destinationHost === "place.map.kakao.com") {
      return false;
    }
    if (/(^|\.)kakaocorp\.com$/.test(destinationHost) || /(^|\.)kakao\.com$/.test(destinationHost) || /(^|\.)daum\.net$/.test(destinationHost)) {
      return /corp|company|about|support|help|customer|cs|policy|terms|privacy|notice|business|service/.test(haystack);
    }
  }

  if (isNaverMapHost(parentHost)) {
    if (destinationHost === "place.naver.com" || destinationHost === "booking.naver.com" || destinationHost === "smartplace.naver.com") {
      return false;
    }
    if (isNaverMapShellAnchor(destinationHost, destinationPath, destination.hash)) {
      return true;
    }
    if ((destinationHost === "www.naver.com" || destinationHost === "naver.com") && (destinationPath === "/" || destinationPath.length === 0)) {
      return true;
    }
    if (/(^|\.)navercorp\.com$/.test(destinationHost) || /(^|\.)help\.naver\.com$/.test(destinationHost) || /(^|\.)policy\.naver\.com$/.test(destinationHost)) {
      return true;
    }
  }

  if (isGoogleMapHost(parentHost, parentPath)) {
    if (destinationHost === "www.google.com" && destinationPath.includes("/maps/place")) {
      return false;
    }
    if (/(^|\.)support\.google\.com$/.test(destinationHost) || /(^|\.)policies\.google\.com$/.test(destinationHost) || /(^|\.)accounts\.google\.com$/.test(destinationHost)) {
      return true;
    }
    if (destinationHost === "www.google.com" && /\/preferences|\/intl|\/services/.test(destinationPath)) {
      return true;
    }
  }

  if (isGoogleSearchHost(parentHost, parentPath)) {
    if (isGoogleUtilitySurface(destinationHost, destinationPath)) {
      return true;
    }
    if (destinationHost === "labs.google.com" && destinationPath.startsWith("/search")) {
      return true;
    }
    if ((destinationHost === "maps.google.com" || destinationHost === "www.google.com") && destinationPath === "/maps") {
      return true;
    }
    if (isGoogleHost(destinationHost) && (destinationPath.startsWith("/webhp") || destinationPath.startsWith("/search"))) {
      return true;
    }
  }

  if (isGoogleNewsHost(parentHost)) {
    if (isGoogleNewsHost(destinationHost)) {
      return !isGoogleNewsArticlePath(destinationPath);
    }
    if (isGoogleUtilitySurface(destinationHost, destinationPath)) {
      return true;
    }
  }

  if (isReutersHost(parentHost)) {
    if (isReutersHost(destinationHost)) {
      return !isReutersArticlePath(destinationPath);
    }
    if (isReutersUtilitySurface(destinationHost, destinationPath)) {
      return true;
    }
  }

  if (isBingSearchHost(parentHost)) {
    if (destinationHost === "www.bing.com" && (destinationPath.startsWith("/news/search") || destinationPath.startsWith("/images/search") || destinationPath.startsWith("/videos/search") || destinationPath.startsWith("/maps"))) {
      return true;
    }
  }

  if (isYahooSearchHost(parentHost)) {
    if (destinationHost === "www.yahoo.com" || destinationHost === "yahoo.com") {
      return destinationPath === "/" || /\/(?:search|news|privacy|terms|help|support|account|settings)(?:\/|$)/.test(destinationPath);
    }
    if (destinationHost === "yahoo.uservoice.com" || destinationHost.endsWith(".yahoo.uservoice.com")) {
      return true;
    }
    if (/\.yahoo\.com$/.test(destinationHost) && /help|support|feedback|uservoice|account|login|privacy|terms/.test(haystack)) {
      return true;
    }
    if (
      (destinationHost === "news.search.yahoo.com" && destinationPath.startsWith("/search")) ||
      (destinationHost === "images.search.yahoo.com" && destinationPath.startsWith("/search/images")) ||
      (destinationHost === "video.search.yahoo.com" && destinationPath.startsWith("/search/video")) ||
      (destinationHost === "search.yahoo.com" && destinationPath.startsWith("/search"))
    ) {
      return true;
    }
  }

  if (isYahooJapanSearchHost(parentHost)) {
    if (
      (destinationHost === "search.yahoo.co.jp" && (destinationPath.startsWith("/search") || destinationPath.startsWith("/image/search") || destinationPath.startsWith("/video/search"))) ||
      (destinationHost === "news.yahoo.co.jp" && destinationPath.startsWith("/search")) ||
      (destinationHost === "map.yahoo.co.jp" && destinationPath.startsWith("/search")) ||
      (destinationHost === "shopping.yahoo.co.jp" && destinationPath.startsWith("/search")) ||
      (destinationHost === "chiebukuro.yahoo.co.jp" && destinationPath.startsWith("/search"))
    ) {
      return true;
    }
  }

  return false;
}

function sameDocumentAnchorSurface(parent: URL, destination: URL): boolean {
  if (destination.hash.length === 0) {
    return false;
  }
  const parentWithoutHash = new URL(parent.href);
  const destinationWithoutHash = new URL(destination.href);
  parentWithoutHash.hash = "";
  destinationWithoutHash.hash = "";
  return parentWithoutHash.href === destinationWithoutHash.href;
}

function isNaverMapShellAnchor(host: string, path: string, hash: string): boolean {
  if (!isNaverMapHost(host) || hash.length === 0) {
    return false;
  }
  if (!["/p", "/p/", "/", ""].includes(path)) {
    return false;
  }
  return /^#(header|section_content|content|container|root|app|nav|skip)$/i.test(hash);
}

function isKakaoMapHost(host: string): boolean {
  return host === "map.kakao.com" || host === "place.map.kakao.com" || host.endsWith(".map.kakao.com");
}

function isNaverMapHost(host: string): boolean {
  return host === "map.naver.com" || host === "place.naver.com" || host === "pcmap.place.naver.com" || host.endsWith(".map.naver.com");
}

function isGoogleMapHost(host: string, path: string): boolean {
  return host === "maps.google.com" || ((host === "www.google.com" || host.endsWith(".google.com")) && path.includes("/maps"));
}

function isGoogleSearchHost(host: string, path: string): boolean {
  return isGoogleHost(host) && (path.startsWith("/search") || path.startsWith("/webhp"));
}

function isGoogleHost(host: string): boolean {
  return host === "google.com" || host === "www.google.com" || /^www\.google\.[a-z.]+$/.test(host) || host.endsWith(".google.com");
}

function isGoogleNewsHost(host: string): boolean {
  return host === "news.google.com" || host.endsWith(".news.google.com");
}

function isGoogleNewsArticlePath(path: string): boolean {
  return path.startsWith("/read/") || path.startsWith("/articles/");
}

function isGoogleUtilitySurface(host: string, path: string): boolean {
  if (
    host === "about.google" ||
    host === "play.google.com" ||
    host === "itunes.apple.com" ||
    host === "fonts.googleapis.com" ||
    host === "www.google-analytics.com" ||
    host.endsWith(".gstatic.com") ||
    host.endsWith(".googleusercontent.com") ||
    host === "accounts.google.com" ||
    host.endsWith(".accounts.google.com") ||
    host === "support.google.com" ||
    host.endsWith(".support.google.com") ||
    host === "policies.google.com" ||
    host.endsWith(".policies.google.com") ||
    host === "myaccount.google.com" ||
    host.endsWith(".myaccount.google.com")
  ) {
    return true;
  }
  if (/^www\.google\.[a-z.]+$/.test(host) || host === "www.google.com" || host === "google.com") {
    return /\/intl|\/preferences|\/setprefs|\/history|\/advanced_search|\/safesearch|\/services/.test(path);
  }
  return false;
}

function isReutersHost(host: string): boolean {
  return host === "reuters.com" || host.endsWith(".reuters.com");
}

function isReutersArticlePath(path: string): boolean {
  const normalized = path.toLowerCase().replace(/\/+$/, "");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return false;
  }
  if (["site-search", "world", "business", "markets", "technology", "legal", "breakingviews", "lifestyle", "sports", "latest", "pictures", "video", "fact-check", "about", "contact-us", "journalists", "careers", "newsletters", "podcasts", "sitemap"].includes(normalized.slice(1))) {
    return false;
  }
  if (/-\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return true;
  }
  if (/^\/(?:graphics|investigates)\//.test(normalized) && segments.length >= 2) {
    return true;
  }
  return false;
}

function isReutersUtilitySurface(host: string, path: string): boolean {
  if (host === "thomsonreuters.com" || host.endsWith(".thomsonreuters.com")) {
    return true;
  }
  if (host === "refinitiv.com" || host.endsWith(".refinitiv.com")) {
    return true;
  }
  return /\/(?:privacy|terms|cookies|advertising|contact|about|careers|support)(?:\/|$)/.test(path);
}

function isBingSearchHost(host: string): boolean {
  return host === "bing.com" || host.endsWith(".bing.com");
}

function isYahooSearchHost(host: string): boolean {
  return host === "search.yahoo.com" || host.endsWith(".search.yahoo.com");
}

function isYahooJapanSearchHost(host: string): boolean {
  return host === "search.yahoo.co.jp" || host === "news.yahoo.co.jp" || host === "map.yahoo.co.jp" || host === "shopping.yahoo.co.jp" || host === "chiebukuro.yahoo.co.jp";
}

function loginOrAccountSurface(value: string): boolean {
  return /(^|[^a-z0-9])(login|log-in|signin|sign-in|signup|sign-up|account|accounts|auth|oauth|private)(?=$|[^a-z0-9])/i.test(value);
}

function destinationDeepeningSignals(input: { childUrl: string; url: string; domain: string; candidateKind: DestinationCandidateKind; linkText: string; query?: string | undefined }): string[] {
  const signals: string[] = [input.candidateKind, "depth_2_proposal"];
  const childHost = safeUrl(input.childUrl)?.hostname.toLowerCase();
  if (childHost !== undefined && childHost !== input.domain) {
    signals.push("external_destination");
  } else if (childHost !== undefined && childHost === input.domain) {
    signals.push("same_domain_as_child");
  }
  if (input.query !== undefined && tokenOverlap(input.query, `${input.linkText} ${input.url}`) > 0) {
    signals.push("query_overlap");
  }
  if (/source|original|official|primary|document|pdf|report|data/i.test(`${input.linkText} ${input.url}`)) {
    signals.push("source_document_hint");
  }
  return [...new Set(signals)];
}

function destinationDeepeningWarnings(input: { childUrl: string; url: string; linkText: string }): string[] {
  const warnings: string[] = ["proposal_only_not_executed"];
  const childHost = safeUrl(input.childUrl)?.hostname.toLowerCase();
  const targetHost = safeUrl(input.url)?.hostname.toLowerCase();
  if (childHost !== undefined && targetHost !== undefined && childHost !== targetHost) {
    warnings.push("external_depth_2_destination");
  }
  if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx)(\?|#|$)/i.test(input.url)) {
    warnings.push("document_file_candidate");
  }
  if (input.linkText.trim().length === 0) {
    warnings.push("empty_visible_link_text");
  }
  return warnings;
}

function destinationDeepeningReason(candidates: DestinationDeepeningCandidate[]): DestinationDeepeningReason {
  if (candidates.some((candidate) => candidate.signals.includes("source_document_hint"))) {
    return "child_page_has_source_document";
  }
  if (candidates.some((candidate) => candidate.candidateKind === "official")) {
    return "child_page_has_relevant_official_link";
  }
  if (candidates.some((candidate) => candidate.candidateKind === "review" || candidate.candidateKind === "map_place")) {
    return "child_page_has_related_review_or_map_link";
  }
  if (candidates.some((candidate) => candidate.candidateKind === "media")) {
    return "child_page_has_primary_media_link";
  }
  return "manual_review_required";
}

function artifactStatusForDestinationTriage(summary: DestinationTriageSummary): ArtifactStatus {
  return summary.status === "selected" ? "ok" : "partial";
}
