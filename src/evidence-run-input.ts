import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceRunInputSchema, type EvidenceRunInput, type NormalizedEvidenceRunInput } from "./schemas.js";
import type { EvidenceWorkflowOptions } from "./evidence-runner.js";

export async function normalizeEvidenceRunInput(input: EvidenceRunInput): Promise<EvidenceWorkflowOptions> {
  const parsed = EvidenceRunInputSchema.parse(input);
  const runDir = parsed.runDir ?? (await mkdtemp(join(tmpdir(), "browser-agent-mcp-farm-evidence-")));
  return normalizedInputToWorkflowOptions(parsed, runDir);
}

function normalizedInputToWorkflowOptions(input: NormalizedEvidenceRunInput, runDir: string): EvidenceWorkflowOptions {
  const storagePolicy = input.storagePolicy ?? (input.profileName === undefined ? "ephemeral" : "storage-state");
  return {
    url: input.url,
    runDir,
    captureId: input.captureId,
    frameSelector: input.frameSelector,
    timestampsSec: input.timestampsSec,
    maxFrames: input.maxFrames,
    waitMs: input.waitMs,
    navigationTimeoutMs: input.navigationTimeoutMs,
    seekTimeoutMs: input.seekTimeoutMs,
    settleMs: input.settleMs,
    sampleFrames: input.sampleFrames,
    finalClaimGate: input.finalClaimGate,
    profileName: input.profileName,
    storagePolicy,
    headed: input.headed,
    browserChannel: input.browserChannel,
    // Forward the capture-routing controls so MCP/HTTP callers (not just the CLI) can use tier-0
    // browserless capture (A1), the text capture profile (A3), and auto routing (D2). All default to
    // the browser/full path, so an MCP caller that sets none keeps the prior behaviour exactly.
    httpFetch: input.httpFetch,
    captureProfile: input.captureProfile,
    captureRouting: input.captureRouting,
    captureCache: input.captureCache,
    overlayDismissal: input.overlayDismissal,
    ocr: input.ocr,
    denseSampling: input.denseSampling,
    officialApi: input.officialApi
  };
}
