// Multi-vantage capture orchestrator (capture-binding Tier 2, opt-in FARM_ENABLE_MULTI_VANTAGE=1). Fans
// the SAME url across N independent egress points (proxied leases), feeds the per-vantage captures to the
// pure agreement core (multi-vantage-agreement.ts), and writes a hash-registered `multi_vantage_agreement`
// artifact so a reader can see whether the page served everyone the same bytes — or cloaked/geo-fenced/
// price-discriminated one vantage. The actual proxied page render is an INJECTED seam (VantageCaptureFn):
// it drives a real proxied Playwright context where the browser already lives, so this orchestrator stays
// a testable leaf (no browser-pool import) and the byte-affecting work is supplied by the integration
// layer. Production wiring: pass a capture fn that opens a page on the proxied `lease`, captures visible
// text, and returns { text } (or { error } on a block/timeout). The fn MUST NOT echo proxy credentials.
//
// SECRET SAFETY (load-bearing): each vantage lease carries the REAL proxy (username/password) so the
// upstream proxy authenticates — but that lease is never persisted. ONLY redactProxy(spec.proxy) reaches
// the artifact, so no credential is ever written to disk. CACHE SAFETY: a proxied lease is not a bare
// ephemeral lease, so the C4 capture-cache (gated on isBareEphemeralLease at the call site) never replays
// one vantage's bytes for another — every vantage is a fresh, real egress.

import { ArtifactWriter, type ArtifactRecord } from "./artifact-writer.js";
import { LeaseManager, redactProxy, type Lease, type ProxyConfig } from "./lease-manager.js";
import { compareVantages, type CompareVantagesOptions, type MultiVantageAgreement, type VantageCapture } from "./multi-vantage-agreement.js";

export function multiVantageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FARM_ENABLE_MULTI_VANTAGE === "1";
}

/** One egress point: a label plus the proxy that routes its traffic. Creds are redacted before persisting. */
export interface VantageSpec {
  vantageId: string;
  proxy: ProxyConfig;
}

/** What a single proxied capture yields (text on success, error on a block/timeout). */
export interface VantageCaptureOutput {
  text?: string;
  status?: number;
  error?: string;
}

/**
 * Injected per-vantage capture. Production drives a proxied Playwright context on `lease`; tests inject a
 * fake. It MUST route through the supplied (proxied) lease and MUST NOT leak proxy credentials anywhere.
 */
export type VantageCaptureFn = (input: { url: string; lease: Lease; vantageId: string }) => Promise<VantageCaptureOutput>;

export interface MultiVantageCaptureInput {
  runDir: string;
  url: string;
  vantages: VantageSpec[];
  capture: VantageCaptureFn;
  writer?: ArtifactWriter;
  leaseManager?: LeaseManager;
  agentId?: string;
  runId?: string;
  allowedDomains?: string[];
  ttlMs?: number;
  compareOptions?: CompareVantagesOptions;
  env?: NodeJS.ProcessEnv;
}

export interface MultiVantageCaptureResult {
  ok: boolean;
  agreement?: MultiVantageAgreement;
  records: ArtifactRecord[];
  reason?: string;
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Fan a url across N proxied vantages and decide agreement. Fail-closed: disabled unless the opt-in flag
 * is set, and a vantage that throws (acquire failure or capture error) becomes a failed VantageCapture
 * (excluded from the quorum, surfaced in the artifact) rather than aborting the run.
 */
export async function captureMultiVantage(input: MultiVantageCaptureInput): Promise<MultiVantageCaptureResult> {
  if (!multiVantageEnabled(input.env ?? process.env)) {
    return { ok: false, records: [], reason: "multi-vantage capture is disabled (set FARM_ENABLE_MULTI_VANTAGE=1)" };
  }
  if (input.vantages.length < 2) {
    return { ok: false, records: [], reason: "multi-vantage capture requires at least 2 vantages" };
  }
  const seenIds = new Set<string>();
  for (const spec of input.vantages) {
    if (seenIds.has(spec.vantageId)) {
      return { ok: false, records: [], reason: `duplicate vantageId "${spec.vantageId}" (each vantage must be uniquely labelled)` };
    }
    seenIds.add(spec.vantageId);
  }

  const leaseManager = input.leaseManager ?? new LeaseManager();
  const writer = input.writer ?? new ArtifactWriter();
  const agentId = input.agentId ?? "multi-vantage";
  const runId = input.runId ?? "multi-vantage";
  const host = hostnameOf(input.url);
  const allowedDomains = input.allowedDomains ?? (host === undefined ? [] : [host]);

  const captures: VantageCapture[] = [];
  const redactedVantages: Array<{ vantageId: string; proxy: ProxyConfig }> = [];

  for (const spec of input.vantages) {
    // Redacted record FIRST, so a credential can never reach the artifact even if capture throws below.
    redactedVantages.push({ vantageId: spec.vantageId, proxy: redactProxy(spec.proxy) });
    let lease: Lease | undefined;
    try {
      lease = leaseManager.acquire({ agentId, runId, artifactRunDir: input.runDir, allowedDomains, capability: "read-only", storagePolicy: "ephemeral", proxy: spec.proxy, ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs }) });
      const output = await input.capture({ url: input.url, lease, vantageId: spec.vantageId });
      captures.push({ vantageId: spec.vantageId, ...(output.text === undefined ? {} : { text: output.text }), ...(output.status === undefined ? {} : { status: output.status }), ...(output.error === undefined ? {} : { error: output.error }) });
    } catch (error) {
      captures.push({ vantageId: spec.vantageId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (lease !== undefined) {
        try {
          leaseManager.release(lease.contextToken, agentId);
        } catch {
          // best-effort: a failed release must never mask the capture result
        }
      }
    }
  }

  const agreement = compareVantages(captures, input.compareOptions ?? {});

  const records = await writer.writeCaptureBundle({
    runDir: input.runDir,
    sourceUrl: input.url,
    contextToken: "multi-vantage",
    pageId: "multi-vantage",
    captureId: "multi-vantage-agreement",
    text: JSON.stringify({ url: input.url, agreement, vantages: redactedVantages }, null, 2),
    evidenceKind: "multi_vantage_agreement",
    captureMethod: "multi-vantage",
    metadata: { verdict: agreement.verdict, successfulVantages: agreement.successfulVantages, divergentVantageIds: agreement.divergentVantageIds, failedVantageIds: agreement.failedVantageIds }
  });

  return { ok: true, agreement, records };
}
