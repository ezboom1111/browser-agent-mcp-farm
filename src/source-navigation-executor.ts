import { createHash } from "node:crypto";
import { throwIfAborted } from "./abort.js";
import { ArtifactWriter, SANITIZED_FILE_BASE_MAX_LENGTH, sanitizeFileBase, type ArtifactRecord, type ArtifactStatus } from "./artifact-writer.js";
import type { BrowserClientStateResult, BrowserPool } from "./browser-pool.js";
import { extractClientStateDestinationCandidates } from "./client-state-destinations.js";
import {
  buildSourceNavigationExecutionPlan,
  type SourceNavigationExecutionLimits,
  type SourceNavigationExecutionPlan,
  type SourceNavigationExecutionStep
} from "./source-navigation-execution.js";
import type { SourceNavigationAction, SourceNavigationActionKind, SourceNavigationPlan } from "./source-navigation.js";
import type { DestinationUrlResolutionMethod } from "./destination-url.js";

export type SourceNavigationExecutableOperation =
  | "click"
  | "fill"
  | "select"
  | "press"
  | "scroll"
  | "wait_for_selector"
  | "capture"
  | "follow_up"
  | "extract_destinations"
  | "extract_client_state_destinations";

interface ExecutableActionBase {
  actionKey: string;
  note?: string | undefined;
  expectedStates?: SourceNavigationExpectedState[] | undefined;
  captureScopes?: SourceNavigationCaptureScope[] | undefined;
}

export interface SourceNavigationExpectedState {
  selector?: string | undefined;
  textIncludes?: string | undefined;
  caseSensitive?: boolean | undefined;
  timeoutMs?: number | undefined;
}

export interface SourceNavigationExpectedStateResult extends SourceNavigationExpectedState {
  status: "ok" | "error";
  observedTextSnippet?: string;
  error?: string;
}

export interface SourceNavigationCaptureScope {
  key: string;
  selector: string;
  phase?: "before" | "after" | undefined;
  note?: string | undefined;
}

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

export type SourceNavigationExecutableAction =
  | (ExecutableActionBase & { operation: "click"; selector: string })
  | (ExecutableActionBase & { operation: "fill"; selector: string; value: string })
  | (ExecutableActionBase & { operation: "select"; selector: string; value: string })
  | (ExecutableActionBase & { operation: "press"; key: string })
  | (ExecutableActionBase & { operation: "scroll"; direction?: "down" | "up" | "bottom" | "top" | undefined; pixels?: number | undefined })
  | (ExecutableActionBase & { operation: "wait_for_selector"; selector: string })
  | (ExecutableActionBase & { operation: "capture" })
  | (ExecutableActionBase & { operation: "follow_up"; selector?: string | undefined; url?: string | undefined; captureId?: string | undefined })
  | (ExecutableActionBase & { operation: "extract_destinations"; selector: string; maxLinks?: number | undefined; captureId?: string | undefined })
  | (ExecutableActionBase & {
    operation: "extract_client_state_destinations";
    selector?: string | undefined;
    stateKey?: string | undefined;
    extractor?: "naver_place_apollo" | undefined;
    destinationPath?: string | undefined;
    maxLinks?: number | undefined;
    captureId?: string | undefined;
  });

export type SourceNavigationActionExecutionStatus =
  | "ok"
  | "skipped"
  | "unsupported"
  | "error";

export interface SourceNavigationActionExecutionResult {
  actionKey: string;
  actionKind?: SourceNavigationActionKind;
  operation?: SourceNavigationExecutableOperation;
  status: SourceNavigationActionExecutionStatus;
  reason: string;
  durationMs: number;
  finalUrl?: string;
  operationDetails?: Record<string, unknown>;
  followUp?: SourceNavigationFollowUpRequest;
  followUps?: SourceNavigationFollowUpRequest[];
  assertionResults?: SourceNavigationExpectedStateResult[];
  scopedCaptureArtifactIds?: string[];
  captureArtifactIds: string[];
  actionArtifactIds: string[];
  error?: string;
}

export interface ExecuteSourceNavigationActionsInput {
  plan: SourceNavigationPlan;
  executableActions?: SourceNavigationExecutableAction[];
  browserPool: BrowserPool;
  artifactWriter: ArtifactWriter;
  agentId: string;
  contextToken: string;
  pageId: string;
  runDir: string;
  sourceUrl?: string;
  captureIdBase?: string;
  limits?: Partial<SourceNavigationExecutionLimits>;
  signal?: AbortSignal;
}

export interface SourceNavigationExecutionRunResult {
  schemaVersion: "1.0";
  status: "ok" | "partial" | "error";
  executionPlan: SourceNavigationExecutionPlan;
  actionResults: SourceNavigationActionExecutionResult[];
  followUps: SourceNavigationFollowUpRequest[];
  records: ArtifactRecord[];
  executedActionCount: number;
  skippedActionCount: number;
  unsupportedActionCount: number;
  failedActionCount: number;
}

export async function executeSourceNavigationActions(
  input: ExecuteSourceNavigationActionsInput
): Promise<SourceNavigationExecutionRunResult> {
  throwIfAborted(input.signal);
  const executionPlan = buildSourceNavigationExecutionPlan(input.plan, input.limits);
  const executableActions = normalizeExecutableActions(input.executableActions ?? []);
  const actionByKey = new Map(input.plan.plannedActions.map((action) => [action.key, action]));
  const records: ArtifactRecord[] = [];
  const actionResults: SourceNavigationActionExecutionResult[] = [];

  for (const step of executionPlan.steps) {
    throwIfAborted(input.signal);
    const action = step.actionKey === undefined ? undefined : actionByKey.get(step.actionKey);
    const instruction = step.actionKey === undefined ? undefined : executableActions.get(step.actionKey);
    const result = instruction === undefined
      ? await recordSkippedAction(input, step, action, records)
      : await executeConfiguredAction(input, step, action, instruction, records);
    actionResults.push(result);
  }

  for (const step of executionPlan.unsupportedSteps) {
    throwIfAborted(input.signal);
    actionResults.push(await recordUnsupportedAction(input, step, records));
  }

  const failedActionCount = actionResults.filter((result) => result.status === "error").length;
  const skippedActionCount = actionResults.filter((result) => result.status === "skipped").length;
  const unsupportedActionCount = actionResults.filter((result) => result.status === "unsupported").length;
  const executedActionCount = actionResults.filter((result) => result.status === "ok").length;
  const followUps = actionResults.flatMap((result) => result.followUps ?? (result.followUp === undefined ? [] : [result.followUp]));

  return {
    schemaVersion: "1.0",
    status: failedActionCount > 0 ? "error" : skippedActionCount > 0 || unsupportedActionCount > 0 ? "partial" : "ok",
    executionPlan,
    actionResults,
    followUps,
    records,
    executedActionCount,
    skippedActionCount,
    unsupportedActionCount,
    failedActionCount
  };
}

async function executeConfiguredAction(
  input: ExecuteSourceNavigationActionsInput,
  step: SourceNavigationExecutionStep,
  action: SourceNavigationAction | undefined,
  instruction: SourceNavigationExecutableAction,
  records: ArtifactRecord[]
): Promise<SourceNavigationActionExecutionResult> {
  const startedAt = Date.now();
  const captureRecords: ArtifactRecord[] = [];
  let finalUrl: string | undefined;
  let operationDetails: Record<string, unknown> | undefined;
  let followUp: SourceNavigationFollowUpRequest | undefined;
  let followUps: SourceNavigationFollowUpRequest[] | undefined;
  let assertionResults: SourceNavigationExpectedStateResult[] = [];
  let error: string | undefined;
  let status: SourceNavigationActionExecutionStatus = "ok";

  try {
    if (instruction.operation === "capture") {
      captureRecords.push(...await captureNavigationState(input, step, "capture"));
      captureRecords.push(...await captureInstructionScopes(input, step, instruction, "after"));
      finalUrl = captureRecords.at(0)?.source_url;
      operationDetails = { capturedArtifactCount: captureRecords.length };
      assertionResults = await runExpectedStates(input, instruction, step.timeoutMs);
      const assertionError = firstAssertionError(assertionResults);
      if (assertionError !== undefined) {
        status = "error";
        error = assertionError;
      }
    } else {
      if (step.captureBefore) {
        captureRecords.push(...await captureNavigationState(input, step, "before"));
      }
      captureRecords.push(...await captureInstructionScopes(input, step, instruction, "before"));
      const operationResult = await runExecutableOperation(input, instruction, step.timeoutMs);
      finalUrl = operationResult.finalUrl;
      operationDetails = operationResult.details;
      followUp = operationResult.followUp;
      followUps = operationResult.followUps;
      captureRecords.push(...await captureInstructionScopes(input, step, instruction, "after"));
      assertionResults = await runExpectedStates(input, instruction, step.timeoutMs);
      const assertionError = firstAssertionError(assertionResults);
      if (assertionError !== undefined) {
        status = "error";
        error = assertionError;
      }
      if (step.captureAfter) {
        captureRecords.push(...await captureNavigationState(input, step, "after"));
      }
    }
  } catch (caught) {
    status = "error";
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const durationMs = Date.now() - startedAt;
  const metadataInput: RecordActionMetadataInput = {
    step,
    instruction,
    status,
    durationMs,
    captureArtifactIds: captureRecords.map((record) => record.artifact_id),
    reason: status === "error" ? "Configured source navigation action failed." : "Configured source navigation action executed."
  };
  if (action !== undefined) {
    metadataInput.action = action;
  }
  if (finalUrl !== undefined) {
    metadataInput.finalUrl = finalUrl;
  }
  if (operationDetails !== undefined) {
    metadataInput.operationDetails = operationDetails;
  }
  if (followUp !== undefined) {
    metadataInput.followUp = followUp;
  }
  if (followUps !== undefined) {
    metadataInput.followUps = followUps;
  }
  if (assertionResults.length > 0) {
    metadataInput.assertionResults = assertionResults;
  }
  if (error !== undefined) {
    metadataInput.error = error;
  }
  const actionRecords = await recordActionMetadata(input, metadataInput);
  records.push(...captureRecords, ...actionRecords);

  const result: SourceNavigationActionExecutionResult = {
    actionKey: step.actionKey ?? step.key,
    status,
    reason: status === "error" ? "Configured source navigation action failed." : "Configured source navigation action executed.",
    durationMs,
    captureArtifactIds: captureRecords.map((record) => record.artifact_id),
    actionArtifactIds: actionRecords.map((record) => record.artifact_id)
  };
  if (step.kind !== undefined) {
    result.actionKind = step.kind;
  }
  result.operation = instruction.operation;
  if (finalUrl !== undefined) {
    result.finalUrl = finalUrl;
  }
  if (operationDetails !== undefined) {
    result.operationDetails = operationDetails;
  }
  if (followUp !== undefined) {
    result.followUp = followUp;
  }
  if (followUps !== undefined) {
    result.followUps = followUps;
  }
  const scopedCaptureArtifactIds = captureRecords
    .filter((record) => record.tool_name === "farm_capture_scope")
    .map((record) => record.artifact_id);
  if (assertionResults.length > 0) {
    result.assertionResults = assertionResults;
  }
  if (scopedCaptureArtifactIds.length > 0) {
    result.scopedCaptureArtifactIds = scopedCaptureArtifactIds;
  }
  if (error !== undefined) {
    result.error = error;
  }
  return result;
}

async function recordSkippedAction(
  input: ExecuteSourceNavigationActionsInput,
  step: SourceNavigationExecutionStep,
  action: SourceNavigationAction | undefined,
  records: ArtifactRecord[]
): Promise<SourceNavigationActionExecutionResult> {
  const metadataInput: RecordActionMetadataInput = {
    step,
    status: "skipped",
    durationMs: 0,
    captureArtifactIds: [],
    reason: "No explicit executable recipe was supplied for this planned action."
  };
  if (action !== undefined) {
    metadataInput.action = action;
  }
  const actionRecords = await recordActionMetadata(input, metadataInput);
  records.push(...actionRecords);
  const result: SourceNavigationActionExecutionResult = {
    actionKey: step.actionKey ?? step.key,
    status: "skipped",
    reason: "No explicit executable recipe was supplied for this planned action.",
    durationMs: 0,
    captureArtifactIds: [],
    actionArtifactIds: actionRecords.map((record) => record.artifact_id)
  };
  if (step.kind !== undefined) {
    result.actionKind = step.kind;
  }
  return result;
}

async function recordUnsupportedAction(
  input: ExecuteSourceNavigationActionsInput,
  step: SourceNavigationExecutionStep,
  records: ArtifactRecord[]
): Promise<SourceNavigationActionExecutionResult> {
  const actionRecords = await recordActionMetadata(input, {
    step,
    status: "unsupported",
    durationMs: 0,
    captureArtifactIds: [],
    reason: step.reason
  });
  records.push(...actionRecords);
  return {
    actionKey: step.key,
    status: "unsupported",
    reason: step.reason,
    durationMs: 0,
    captureArtifactIds: [],
    actionArtifactIds: actionRecords.map((record) => record.artifact_id)
  };
}

async function runExecutableOperation(
  input: ExecuteSourceNavigationActionsInput,
  instruction: Exclude<SourceNavigationExecutableAction, { operation: "capture" }>,
  timeoutMs: number
): Promise<{ finalUrl?: string; details?: Record<string, unknown>; followUp?: SourceNavigationFollowUpRequest; followUps?: SourceNavigationFollowUpRequest[] }> {
  switch (instruction.operation) {
    case "click": {
      const result = await input.browserPool.click(input.agentId, input.contextToken, input.pageId, instruction.selector, browserActionOptions(timeoutMs, input.signal));
      return { finalUrl: result.url };
    }
    case "fill": {
      const result = await input.browserPool.fill(input.agentId, input.contextToken, input.pageId, instruction.selector, instruction.value, browserActionOptions(timeoutMs, input.signal));
      return { finalUrl: result.url };
    }
    case "select": {
      const result = await input.browserPool.selectOption(input.agentId, input.contextToken, input.pageId, instruction.selector, instruction.value, browserActionOptions(timeoutMs, input.signal));
      return { finalUrl: result.url };
    }
    case "press": {
      const result = await input.browserPool.press(input.agentId, input.contextToken, input.pageId, instruction.key, browserActionOptions(timeoutMs, input.signal));
      return { finalUrl: result.url };
    }
    case "scroll": {
      const result = await input.browserPool.scroll(
        input.agentId,
        input.contextToken,
        input.pageId,
        instruction.direction ?? "down",
        instruction.pixels ?? 800,
        input.signal
      );
      return { finalUrl: result.url, details: { scrollY: result.scrollY } };
    }
    case "wait_for_selector": {
      const result = await input.browserPool.waitForSelector(input.agentId, input.contextToken, input.pageId, instruction.selector, timeoutMs, input.signal);
      return { finalUrl: result.url };
    }
    case "follow_up": {
      const request = await buildFollowUpRequest(input, instruction, timeoutMs);
      return {
        finalUrl: input.sourceUrl ?? input.plan.inputUrl,
        followUp: request,
        followUps: [request],
        details: {
          followUpUrl: request.url,
          ...(request.selector === undefined ? {} : { selector: request.selector }),
          ...(request.linkText === undefined ? {} : { linkText: request.linkText }),
          ...(request.captureId === undefined ? {} : { captureId: request.captureId })
        }
      };
    }
    case "extract_destinations": {
      const extraction = await buildDestinationExtractionRequests(input, instruction, timeoutMs);
      const requests = extraction.requests;
      if (requests.length === 0) {
        throw new RangeError(`extract_destinations found no usable HTTP(S) destination links for ${instruction.actionKey}`);
      }
      return {
        finalUrl: input.sourceUrl ?? input.plan.inputUrl,
        followUps: requests,
        details: {
          selector: instruction.selector,
          requestedMaxLinks: instruction.maxLinks ?? 10,
          extractedDestinationCount: requests.length,
          extractedDestinationUrls: requests.map((request) => request.url),
          rawDestinationCandidateCount: extraction.rawCandidateCount,
          usableDestinationCandidateCount: extraction.usableCandidateCount,
          uniqueDestinationCandidateCount: extraction.uniqueCandidateCount,
          duplicateDestinationCandidateCount: extraction.duplicateCandidateCount,
          omittedDuplicateDestinationCount: extraction.omittedDuplicateCount,
          anchorDestinationCandidateCount: extraction.anchorCandidateCount,
          attributeDestinationCandidateCount: extraction.attributeCandidateCount
        }
      };
    }
    case "extract_client_state_destinations": {
      const extraction = await buildClientStateDestinationRequests(input, instruction);
      const requests = extraction.requests;
      if (requests.length === 0) {
        throw new RangeError(`extract_client_state_destinations found no usable destination entries for ${instruction.actionKey}`);
      }
      return {
        finalUrl: input.sourceUrl ?? input.plan.inputUrl,
        followUps: requests,
        details: {
          ...(instruction.selector === undefined ? {} : { selector: instruction.selector }),
          stateKey: extraction.stateKey,
          extractor: extraction.extractor,
          requestedMaxLinks: instruction.maxLinks ?? 10,
          extractedDestinationCount: requests.length,
          extractedDestinationUrls: requests.map((request) => request.url),
          extractedOriginalDestinationUrls: requests
            .map((request) => request.originalUrl)
            .filter((url): url is string => url !== undefined),
          clientStateFrameCount: extraction.state.frameCount,
          clientStateMatchedFrameCount: extraction.state.matchedFrameCount,
          clientStateParsedFrameCount: extraction.parsedFrameCount,
          clientStateTruncatedFrameCount: extraction.truncatedFrameCount,
          rawClientStateCandidateCount: extraction.rawCandidateCount,
          uniqueClientStateCandidateCount: extraction.uniqueCandidateCount
        }
      };
    }
  }
}

async function buildFollowUpRequest(
  input: ExecuteSourceNavigationActionsInput,
  instruction: Extract<SourceNavigationExecutableAction, { operation: "follow_up" }>,
  timeoutMs: number
): Promise<SourceNavigationFollowUpRequest> {
  const request: SourceNavigationFollowUpRequest = {
    actionKey: instruction.actionKey,
    url: "",
    ...(instruction.selector === undefined ? {} : { selector: instruction.selector }),
    ...(instruction.captureId === undefined ? {} : { captureId: instruction.captureId }),
    ...(instruction.note === undefined ? {} : { note: instruction.note })
  };

  if (instruction.url !== undefined) {
    request.url = new URL(instruction.url, input.sourceUrl ?? input.plan.inputUrl).href;
    return request;
  }

  if (instruction.selector === undefined) {
    throw new RangeError(`follow_up requires selector or url for ${instruction.actionKey}`);
  }

  const target = await input.browserPool.readLinkTarget(input.agentId, input.contextToken, input.pageId, instruction.selector, timeoutMs, input.signal);
  request.url = target.url;
  if (target.text.length > 0) {
    request.linkText = target.text;
  }
  return request;
}

async function buildDestinationExtractionRequests(
  input: ExecuteSourceNavigationActionsInput,
  instruction: Extract<SourceNavigationExecutableAction, { operation: "extract_destinations" }>,
  timeoutMs: number
): Promise<{
  requests: SourceNavigationFollowUpRequest[];
  rawCandidateCount: number;
  usableCandidateCount: number;
  uniqueCandidateCount: number;
  duplicateCandidateCount: number;
  omittedDuplicateCount: number;
  anchorCandidateCount: number;
  attributeCandidateCount: number;
}> {
  const maxLinks = normalizeMaxLinks(instruction.maxLinks);
  const targets = await input.browserPool.readLinkTargets(input.agentId, input.contextToken, input.pageId, instruction.selector, maxLinks, timeoutMs, input.signal);
  const requests = targets.links.map((target, index) => {
    const request: SourceNavigationFollowUpRequest = {
      actionKey: instruction.actionKey,
      url: target.url,
      selector: instruction.selector,
      ...(target.text.length === 0 ? {} : { linkText: target.text }),
      ...(instruction.captureId === undefined ? {} : { captureId: `${instruction.captureId}-${index + 1}` }),
      ...(instruction.note === undefined ? {} : { note: instruction.note })
    };
    return request;
  });
  return {
    requests,
    rawCandidateCount: targets.rawCandidateCount,
    usableCandidateCount: targets.usableCandidateCount,
    uniqueCandidateCount: targets.uniqueCandidateCount,
    duplicateCandidateCount: targets.duplicateCandidateCount,
    omittedDuplicateCount: targets.omittedDuplicateCount,
    anchorCandidateCount: targets.anchorCandidateCount,
    attributeCandidateCount: targets.attributeCandidateCount
  };
}

async function buildClientStateDestinationRequests(
  input: ExecuteSourceNavigationActionsInput,
  instruction: Extract<SourceNavigationExecutableAction, { operation: "extract_client_state_destinations" }>
): Promise<{
  requests: SourceNavigationFollowUpRequest[];
  state: BrowserClientStateResult;
  stateKey: string;
  extractor: "naver_place_apollo";
  parsedFrameCount: number;
  truncatedFrameCount: number;
  rawCandidateCount: number;
  uniqueCandidateCount: number;
}> {
  if (instruction.selector !== undefined) {
    const selectorInspectionOptions: { maxMatches: number; signal?: AbortSignal } = { maxMatches: 1 };
    if (input.signal !== undefined) {
      selectorInspectionOptions.signal = input.signal;
    }
    const inspection = await input.browserPool.inspectSelector(input.agentId, input.contextToken, input.pageId, instruction.selector, selectorInspectionOptions);
    if (inspection.visibleCount <= 0) {
      throw new RangeError(`No visible selector found for client state destination extraction: ${instruction.selector} (matched frames: ${inspection.matchedFrameCount}/${inspection.frameCount})`);
    }
  }
  const maxLinks = normalizeMaxLinks(instruction.maxLinks);
  const stateKey = instruction.stateKey ?? "__APOLLO_STATE__";
  const extractor = instruction.extractor ?? "naver_place_apollo";
  const state = await input.browserPool.readClientState(input.agentId, input.contextToken, input.pageId, stateKey, 2_000_000, input.signal);
  const extracted = extractClientStateDestinationCandidates(state, {
    extractor,
    maxLinks,
    destinationPath: instruction.destinationPath
  });
  const requests = extracted.candidates.map((target, index) => {
    const request: SourceNavigationFollowUpRequest = {
      actionKey: instruction.actionKey,
      url: target.url,
      ...(target.originalUrl === undefined ? {} : { originalUrl: target.originalUrl }),
      ...(target.urlResolutionMethod === undefined ? {} : { urlResolutionMethod: target.urlResolutionMethod }),
      ...(instruction.selector === undefined ? {} : { selector: instruction.selector }),
      linkText: target.text,
      ...(instruction.captureId === undefined ? {} : { captureId: `${instruction.captureId}-${index + 1}` }),
      note: instruction.note ?? `Destination derived from ${stateKey} client state.`
    };
    return request;
  });
  return {
    requests,
    state,
    stateKey,
    extractor,
    parsedFrameCount: extracted.parsedFrameCount,
    truncatedFrameCount: extracted.truncatedFrameCount,
    rawCandidateCount: extracted.rawCandidateCount,
    uniqueCandidateCount: extracted.uniqueCandidateCount
  };
}

async function captureNavigationState(
  input: ExecuteSourceNavigationActionsInput,
  step: SourceNavigationExecutionStep,
  phase: "before" | "after" | "capture"
): Promise<ArtifactRecord[]> {
  const key = actionCaptureKey(input, step, phase);
  const capture = await input.browserPool.capturePage(input.agentId, input.contextToken, input.pageId, key, input.signal);
  return capture.records;
}

async function captureInstructionScopes(
  input: ExecuteSourceNavigationActionsInput,
  step: SourceNavigationExecutionStep,
  instruction: SourceNavigationExecutableAction,
  phase: "before" | "after"
): Promise<ArtifactRecord[]> {
  const records: ArtifactRecord[] = [];
  for (const [scopeIndex, scope] of (instruction.captureScopes ?? []).entries()) {
    if ((scope.phase ?? "after") !== phase) {
      continue;
    }
    const key = scopedCaptureKey(input, step, scope, phase, scopeIndex);
    const capture = await input.browserPool.captureLocator(input.agentId, input.contextToken, input.pageId, scope.selector, key, input.signal);
    records.push(...capture.records);
  }
  return records;
}

async function runExpectedStates(
  input: ExecuteSourceNavigationActionsInput,
  instruction: SourceNavigationExecutableAction,
  stepTimeoutMs: number
): Promise<SourceNavigationExpectedStateResult[]> {
  const results: SourceNavigationExpectedStateResult[] = [];
  for (const expectation of instruction.expectedStates ?? []) {
    try {
      const selector = expectation.selector ?? "body";
      const timeoutMs = expectation.timeoutMs ?? stepTimeoutMs;
      const read = await input.browserPool.readVisibleText(input.agentId, input.contextToken, input.pageId, selector, timeoutMs, input.signal);
      const observedTextSnippet = read.text.slice(0, 500);
      if (expectation.textIncludes !== undefined && !includesText(read.text, expectation.textIncludes, expectation.caseSensitive ?? false)) {
        results.push(withExpectationOptionals({
          ...expectation,
          status: "error",
          observedTextSnippet,
          error: `Expected visible text to include ${JSON.stringify(expectation.textIncludes)}`
        }));
        continue;
      }
      results.push(withExpectationOptionals({
        ...expectation,
        status: "ok",
        observedTextSnippet
      }));
    } catch (caught) {
      results.push(withExpectationOptionals({
        ...expectation,
        status: "error",
        error: caught instanceof Error ? caught.message : String(caught)
      }));
    }
  }
  return results;
}

function firstAssertionError(results: SourceNavigationExpectedStateResult[]): string | undefined {
  const failed = results.find((result) => result.status === "error");
  if (failed === undefined) {
    return undefined;
  }
  const target = failed.selector ?? "body";
  return `Expected source navigation state failed for ${target}: ${failed.error ?? "unknown assertion error"}`;
}

interface RecordActionMetadataInput {
  step: SourceNavigationExecutionStep;
  action?: SourceNavigationAction;
  instruction?: SourceNavigationExecutableAction;
  status: SourceNavigationActionExecutionStatus;
  durationMs: number;
  captureArtifactIds: string[];
  reason: string;
  finalUrl?: string;
  operationDetails?: Record<string, unknown>;
  followUp?: SourceNavigationFollowUpRequest;
  followUps?: SourceNavigationFollowUpRequest[];
  assertionResults?: SourceNavigationExpectedStateResult[];
  error?: string;
}

async function recordActionMetadata(
  input: ExecuteSourceNavigationActionsInput,
  metadataInput: RecordActionMetadataInput
): Promise<ArtifactRecord[]> {
  const captureId = actionCaptureKey(input, metadataInput.step, "action");
  const status = artifactStatusFor(metadataInput.status);
  const metadata: Record<string, unknown> = {
    schemaVersion: "1.0",
    platform: input.plan.platform,
    sourceFamily: input.plan.sourceFamily,
    actionKey: metadataInput.step.actionKey ?? metadataInput.step.key,
    executionStatus: metadataInput.status,
    reason: metadataInput.reason,
    durationMs: metadataInput.durationMs,
    timeoutMs: metadataInput.step.timeoutMs,
    captureBefore: metadataInput.step.captureBefore,
    captureAfter: metadataInput.step.captureAfter,
    captureArtifactIds: metadataInput.captureArtifactIds
  };
  if (metadataInput.step.kind !== undefined) {
    metadata.actionKind = metadataInput.step.kind;
  }
  if (metadataInput.action !== undefined) {
    metadata.label = metadataInput.action.label;
    metadata.requiresCapture = metadataInput.action.requiresCapture;
  }
  if (metadataInput.instruction !== undefined) {
    metadata.operation = metadataInput.instruction.operation;
    if (metadataInput.instruction.note !== undefined) {
      metadata.note = metadataInput.instruction.note;
    }
    if (metadataInput.instruction.expectedStates !== undefined) {
      metadata.expectedStates = metadataInput.instruction.expectedStates;
    }
    if (metadataInput.instruction.captureScopes !== undefined) {
      metadata.captureScopes = metadataInput.instruction.captureScopes;
    }
  }
  if (metadataInput.finalUrl !== undefined) {
    metadata.finalUrl = metadataInput.finalUrl;
  }
  if (metadataInput.operationDetails !== undefined) {
    metadata.operationDetails = metadataInput.operationDetails;
  }
  if (metadataInput.followUp !== undefined) {
    metadata.followUp = metadataInput.followUp;
  }
  if (metadataInput.followUps !== undefined) {
    metadata.followUps = metadataInput.followUps;
  }
  if (metadataInput.assertionResults !== undefined) {
    metadata.assertionResults = metadataInput.assertionResults;
  }
  if (metadataInput.error !== undefined) {
    metadata.error = metadataInput.error;
  }

  return input.artifactWriter.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: metadataInput.finalUrl ?? input.sourceUrl ?? input.plan.inputUrl,
    contextToken: input.contextToken,
    pageId: input.pageId,
    captureId,
    status,
    metadata,
    captureMethod: "browser-agent-mcp-farm source-navigation-action",
    toolName: "farm_source_navigation_execute",
    evidenceKind: "source_navigation_action",
    note: metadataInput.reason
  });
}

function normalizeExecutableActions(actions: SourceNavigationExecutableAction[]): Map<string, SourceNavigationExecutableAction> {
  const normalized = new Map<string, SourceNavigationExecutableAction>();
  for (const action of actions) {
    if (action.actionKey.trim().length === 0) {
      throw new RangeError("actionKey must be non-empty");
    }
    if (normalized.has(action.actionKey)) {
      throw new RangeError(`Duplicate executable action recipe for ${action.actionKey}`);
    }
    validateExecutableAction(action);
    normalized.set(action.actionKey, action);
  }
  return normalized;
}

function validateExecutableAction(action: SourceNavigationExecutableAction): void {
  if ("selector" in action && typeof action.selector === "string" && action.selector.trim().length === 0) {
    throw new RangeError(`selector must be non-empty for ${action.actionKey}`);
  }
  if (action.operation === "follow_up") {
    if (action.selector === undefined && action.url === undefined) {
      throw new RangeError(`follow_up requires selector or url for ${action.actionKey}`);
    }
    if (action.url !== undefined && action.url.trim().length === 0) {
      throw new RangeError(`url must be non-empty for ${action.actionKey}`);
    }
    if (action.captureId !== undefined && action.captureId.trim().length === 0) {
      throw new RangeError(`captureId must be non-empty for ${action.actionKey}`);
    }
  }
  if (action.operation === "extract_destinations") {
    if (action.maxLinks !== undefined && (!Number.isInteger(action.maxLinks) || action.maxLinks <= 0 || action.maxLinks > 50)) {
      throw new RangeError(`maxLinks must be an integer between 1 and 50 for ${action.actionKey}`);
    }
    if (action.captureId !== undefined && action.captureId.trim().length === 0) {
      throw new RangeError(`captureId must be non-empty for ${action.actionKey}`);
    }
  }
  if (action.operation === "extract_client_state_destinations") {
    if (action.maxLinks !== undefined && (!Number.isInteger(action.maxLinks) || action.maxLinks <= 0 || action.maxLinks > 50)) {
      throw new RangeError(`maxLinks must be an integer between 1 and 50 for ${action.actionKey}`);
    }
    if (action.captureId !== undefined && action.captureId.trim().length === 0) {
      throw new RangeError(`captureId must be non-empty for ${action.actionKey}`);
    }
    if (action.stateKey !== undefined && !/^[A-Za-z_$][A-Za-z0-9_$]{0,120}$/.test(action.stateKey)) {
      throw new RangeError(`stateKey must be a plain window property name for ${action.actionKey}`);
    }
    if (action.destinationPath !== undefined && action.destinationPath.trim().length === 0) {
      throw new RangeError(`destinationPath must be non-empty for ${action.actionKey}`);
    }
  }
  if (action.operation === "press" && action.key.trim().length === 0) {
    throw new RangeError(`key must be non-empty for ${action.actionKey}`);
  }
  if (action.operation === "scroll" && action.pixels !== undefined && (!Number.isInteger(action.pixels) || action.pixels <= 0 || action.pixels > 100_000)) {
    throw new RangeError(`pixels must be an integer between 1 and 100000 for ${action.actionKey}`);
  }
  for (const expectation of action.expectedStates ?? []) {
    if (expectation.selector !== undefined && expectation.selector.trim().length === 0) {
      throw new RangeError(`expectedStates selector must be non-empty for ${action.actionKey}`);
    }
    if (expectation.textIncludes !== undefined && expectation.textIncludes.length === 0) {
      throw new RangeError(`expectedStates textIncludes must be non-empty for ${action.actionKey}`);
    }
    if (expectation.selector === undefined && expectation.textIncludes === undefined) {
      throw new RangeError(`expectedStates must include selector or textIncludes for ${action.actionKey}`);
    }
    if (expectation.timeoutMs !== undefined && (!Number.isInteger(expectation.timeoutMs) || expectation.timeoutMs <= 0 || expectation.timeoutMs > 120_000)) {
      throw new RangeError(`expectedStates timeoutMs must be an integer between 1 and 120000 for ${action.actionKey}`);
    }
  }
  for (const scope of action.captureScopes ?? []) {
    if (scope.key.trim().length === 0) {
      throw new RangeError(`captureScopes key must be non-empty for ${action.actionKey}`);
    }
    if (scope.selector.trim().length === 0) {
      throw new RangeError(`captureScopes selector must be non-empty for ${action.actionKey}`);
    }
  }
}

function actionCaptureKey(
  input: ExecuteSourceNavigationActionsInput,
  step: SourceNavigationExecutionStep,
  suffix: string
): string {
  const base = input.captureIdBase ?? "source-navigation";
  const actionKey = step.actionKey ?? step.key;
  const raw = `${base}-${actionKey}-${suffix}`;
  return sanitizeWithHashFallback(raw, [
    { value: base, maxLength: 40 },
    { value: actionKey, maxLength: 28 },
    { value: suffix, maxLength: 10 }
  ]);
}

function scopedCaptureKey(
  input: ExecuteSourceNavigationActionsInput,
  step: SourceNavigationExecutionStep,
  scope: SourceNavigationCaptureScope,
  phase: "before" | "after",
  scopeIndex: number
): string {
  const base = input.captureIdBase ?? "source-navigation";
  const actionKey = step.actionKey ?? step.key;
  const raw = `${base}-${actionKey}-scope-${scope.key}-${phase}`;
  return sanitizeWithHashFallback(raw, [
    { value: base, maxLength: 28 },
    { value: actionKey, maxLength: 20 },
    { value: `scope-${scopeIndex + 1}`, maxLength: 8 },
    { value: scope.key, maxLength: 16 },
    { value: phase, maxLength: 6 }
  ]);
}

function sanitizeWithHashFallback(raw: string, compactSegments: Array<{ value: string; maxLength: number }>): string {
  if (normalizedFileBase(raw).length <= SANITIZED_FILE_BASE_MAX_LENGTH) {
    return sanitizeFileBase(raw);
  }

  const compact = compactSegments
    .map((segment) => sanitizeFileBase(segment.value).slice(0, segment.maxLength).replace(/^-+|-+$/g, ""))
    .filter((segment) => segment.length > 0)
    .join("-");
  return sanitizeFileBase(`${compact}-${shortHash(raw)}`);
}

function normalizedFileBase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function artifactStatusFor(status: SourceNavigationActionExecutionStatus): ArtifactStatus {
  if (status === "ok") {
    return "ok";
  }
  if (status === "error") {
    return "error";
  }
  return "partial";
}

function browserActionOptions(timeoutMs: number, signal: AbortSignal | undefined): { timeoutMs: number; signal?: AbortSignal } {
  const options: { timeoutMs: number; signal?: AbortSignal } = { timeoutMs };
  if (signal !== undefined) {
    options.signal = signal;
  }
  return options;
}

function normalizeMaxLinks(value: number | undefined): number {
  const candidate = value ?? 10;
  if (!Number.isInteger(candidate) || candidate <= 0 || candidate > 50) {
    throw new RangeError("maxLinks must be an integer between 1 and 50");
  }
  return candidate;
}

function includesText(value: string, expected: string, caseSensitive: boolean): boolean {
  if (caseSensitive) {
    return value.includes(expected);
  }
  return value.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
}

function withExpectationOptionals(value: SourceNavigationExpectedStateResult): SourceNavigationExpectedStateResult {
  if (value.selector === undefined) {
    delete value.selector;
  }
  if (value.textIncludes === undefined) {
    delete value.textIncludes;
  }
  if (value.caseSensitive === undefined) {
    delete value.caseSensitive;
  }
  if (value.timeoutMs === undefined) {
    delete value.timeoutMs;
  }
  if (value.observedTextSnippet === undefined) {
    delete value.observedTextSnippet;
  }
  if (value.error === undefined) {
    delete value.error;
  }
  return value;
}
