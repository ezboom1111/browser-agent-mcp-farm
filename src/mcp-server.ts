import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { z } from "zod";
import { toToolError } from "./farm-error.js";
import { FarmService } from "./farm-service.js";
import { SERVER_NAME } from "./agent-guidance.js";
import { farmVersion } from "./version.js";
import {
  AcquireContextInputSchema,
  CaptureAfterIdleInputSchema,
  CaptureInputSchema,
  ClickInputSchema,
  ClosePageInputSchema,
  FillInputSchema,
  EvidenceRunInputSchema,
  HeartbeatInputSchema,
  ListLeasesInputSchema,
  OpenPageInputSchema,
  PressInputSchema,
  ReapExpiredInputSchema,
  ReleaseContextInputSchema,
  SampleFramesInputSchema,
  ScrollInputSchema,
  SelectOptionInputSchema,
  WaitForSelectorInputSchema,
  WaitInputSchema,
  ReadReportInputSchema,
  ListArtifactsInputSchema,
  RunClaimGateInputSchema,
  ReadArtifactInputSchema,
  RegisterEvidenceInputSchema,
  RegisterTranscriptInputSchema,
  AddClaimInputSchema,
  JudgeClaimInputSchema,
  CapabilitiesInputSchema,
  LensInputSchema,
  ListRunsInputSchema,
  ExtractStructuredInputSchema,
  ExportBundleInputSchema,
  VerifyBundleInputSchema
} from "./schemas.js";

const TOOL_DESCRIPTIONS: Record<string, string> = {
  farm_acquire_context: "Acquire an isolated browser lease (BrowserContext) with capability, allowed-domain, and page-limit guards. Call FIRST before opening pages. Use read-only (default) for capture; read-write only to click/fill/press.",
  farm_heartbeat: "Extend a lease's TTL so it is not reaped during long multi-step work. Call periodically.",
  farm_open_page: "Open a URL in a leased context and return a pageId. Requires an active lease from farm_acquire_context.",
  farm_capture: "Capture browser-visible evidence (screenshot, text, HTML, metadata, visible links, media index) of the current page into the run's artifact ledger. Read-only.",
  farm_wait: "Wait a fixed number of milliseconds on a page to let content settle. Prefer farm_wait_for_selector when you know the target element.",
  farm_wait_for_selector: "Wait until a CSS selector is present/visible (bounded by timeout). Use before capturing or acting on dynamic content.",
  farm_scroll: "Scroll a page down/up/top/bottom to reveal lazy-loaded content before capture.",
  farm_capture_after_idle: "Wait for network/DOM idle (bounded), then capture. Use for SPA/dynamic pages where content arrives after load.",
  farm_sample_frames: "Sample timestamped frame screenshots from visible media (required to support visual claims). Supports dense sampling around transcript/OCR/scene-change hits.",
  farm_evidence_run:
    "Flagship one-shot research workflow: given a URL (and optional bounded source-navigation recipe) it captures the page, derives evidence (frames/OCR/transcript/official-API/obstructions), runs source strategy + bounded destination triage, and produces a final claim-gated report. Prefer this for end-to-end research; it manages its own lease. Returns runDir + reportPath; the result is isError when the final claim gate fails.",
  farm_read_report: "Read back the Markdown report a prior farm_evidence_run produced, given its reportPath. Read-only; no browser.",
  farm_list_artifacts: "List the artifact ledger (artifacts.jsonl) for a prior run's runDir, optionally filtered by evidence kind. Read-only; no browser.",
  farm_run_claim_gate: "Re-run the claim gate over an existing run's runDir to validate that claims cite registered, hash-verified artifacts. Read-only; the result is isError when the gate fails.",
  farm_read_artifact: "Read one registered artifact's bytes (text or base64) by artifactId or path, RE-HASHING on read to detect tampering (recordedSha256 vs recomputed). Lets a parallel agent SEE another run's evidence and verify it. Read-only; isError if not found or tampered.",
  farm_register_evidence: "Register a piece of evidence (the exact bytes/text you saw) as a hash-verified artifact you can then cite, returning its artifactId. The first half of authoring a cite-or-fail claim.",
  farm_register_transcript:
    "Register a video's transcript (its caption/spoken track) from any LAWFUL source — a served WebVTT track captured on the wire, a transcript tool, or a human paste — as a transcript_cue artifact you can cite. Supply WebVTT (parsed into timed cues) or plain text. The farm performs NO speech-to-text; the transcript is the platform's own caption, recorded with bring-your-own-capture provenance. The second half of a cite-or-fail spoken-content claim.",
  farm_add_claim:
    "Author a substantive claim that cites a registered artifact, with an optional anchor (where in the artifact it is grounded). The gate runs immediately: a claim whose anchor text is NOT in the cited bytes makes the result isError. This is how an agent's OWN answer becomes cite-or-fail, not just runner boilerplate.",
  farm_judge_claim:
    "Submit a SEMANTIC verdict (supported | refuted | insufficient) over a claim, citing the SUPPORTING and/or REFUTING spans you rely on. The gate verifies every cited span literally appears in its source's bytes and enforces a quorum: a 'supported' verdict needs >= minIndependentSources verified supporting spans from distinct registrable domains and no verified refuting span. Your verdict is untrusted, but it cannot stand on a fabricated/recombined span. Use for cross-source synthesis where token-presence grounding is too weak. isError if a span does not verify or the verdict is structurally inconsistent.",
  farm_close_page: "Close a page in a leased context when finished with it.",
  farm_click: "Guarded click on a selector. Requires a read-write lease; payment/booking/account-changing controls are refused.",
  farm_fill: "Guarded fill of a form field. Requires a read-write lease.",
  farm_press: "Guarded key press on a page (e.g. Enter to submit a search). Requires a read-write lease.",
  farm_select_option: "Guarded <select> option choice. Requires a read-write lease.",
  farm_release_context: "Release a lease and close its browser context. Call when finished to free the profile lock and resources.",
  farm_list_leases: "List active leases (agent, capability, domains, page count, TTL). Read-only diagnostics.",
  farm_reap_expired: "Reap expired leases and close their contexts. Maintenance/cleanup.",
  farm_capabilities: "Identify THIS server (name, version, evidence kinds, non-goals, optional deps, lenses). Call to confirm you reached browser-agent-mcp-farm and not a similarly-named browse skill.",
  farm_lens:
    "List the declarative research lenses, or describe one (lensId: research | market_scan | product_planning) with its claim templates, report sections, and prioritized source-registry entries. A lens is a domain config (e.g. marketing, product planning) over the same capture + cite-or-fail engine. Read-only, no browser.",
  farm_list_runs: "List prior evidence-run directories under a root (default: the temp dir) with artifact/claim counts, so you can find a runDir to read or verify. Read-only.",
  farm_extract_structured: "Deterministically parse captured HTML for structured data (JSON-LD, Open Graph, Twitter cards, canonical, title). Byte-reproducible, no network. Publisher markup is a SITE CLAIM, not ground truth — cross-check against DOM/OCR. Pair with farm_read_artifact on a page_html artifact.",
  farm_export_bundle: "Export a verifiable bundle manifest for a run: a Merkle root over its artifact SHA-256 hashes, plus an optional Ed25519 signature (privateKeyEnv). A second agent can re-verify it with farm_verify_bundle without trusting you.",
  farm_verify_bundle: "Re-verify a bundle manifest against a run's artifacts IN PLACE: re-hashes each file (detects tampered bytes), recomputes the Merkle root (detects a tampered manifest), and optionally checks the signature. No network. isError if anything fails."
};

// Names of the tools the server registers, captured during the last createMcpServer() build.
// Exported via registeredToolNames() so a test can assert the negative surface: NO tool that
// attaches to / drives a real browser (cdp / auth-login / attach) is ever exposed over MCP.
const registeredToolNameList: string[] = [];

export function createMcpServer(service = new FarmService()): McpServer {
  registeredToolNameList.length = 0;
  const server = new McpServer({
    name: SERVER_NAME,
    version: farmVersion()
  });

  registerJsonTool(server, "farm_acquire_context", AcquireContextInputSchema, (input) => service.acquireContext(input));
  registerJsonTool(server, "farm_heartbeat", HeartbeatInputSchema, (input) => service.heartbeat(input));
  registerJsonTool(server, "farm_open_page", OpenPageInputSchema, (input) => service.openPage(input));
  registerJsonTool(server, "farm_capture", CaptureInputSchema, (input) => service.capture(input));
  registerJsonTool(server, "farm_wait", WaitInputSchema, (input) => service.wait(input));
  registerJsonTool(server, "farm_wait_for_selector", WaitForSelectorInputSchema, (input) => service.waitForSelector(input));
  registerJsonTool(server, "farm_scroll", ScrollInputSchema, (input) => service.scroll(input));
  registerJsonTool(server, "farm_capture_after_idle", CaptureAfterIdleInputSchema, (input) => service.captureAfterIdle(input));
  registerJsonTool(server, "farm_sample_frames", SampleFramesInputSchema, (input) => service.sampleFrames(input));
  registerJsonTool(
    server,
    "farm_evidence_run",
    EvidenceRunInputSchema,
    (input) => service.evidenceRun(input),
    (result) => resultHasFailedClaimGate(result)
  );
  registerJsonTool(server, "farm_read_report", ReadReportInputSchema, (input) => service.readReport(input));
  registerJsonTool(server, "farm_list_artifacts", ListArtifactsInputSchema, (input) => service.listArtifacts(input));
  registerJsonTool(
    server,
    "farm_run_claim_gate",
    RunClaimGateInputSchema,
    (input) => service.runClaimGate(input),
    (result) => resultHasFailedClaimGate(result)
  );
  registerJsonTool(
    server,
    "farm_read_artifact",
    ReadArtifactInputSchema,
    (input) => service.readArtifact(input),
    (result) => resultHasFailedClaimGate(result)
  );
  registerJsonTool(server, "farm_register_evidence", RegisterEvidenceInputSchema, (input) => service.registerEvidence(input));
  registerJsonTool(server, "farm_register_transcript", RegisterTranscriptInputSchema, (input) => service.registerTranscript(input), resultHasFailedClaimGate);
  registerJsonTool(
    server,
    "farm_add_claim",
    AddClaimInputSchema,
    (input) => service.addClaim(input),
    (result) => resultHasFailedClaimGate(result)
  );
  registerJsonTool(
    server,
    "farm_judge_claim",
    JudgeClaimInputSchema,
    (input) => service.judgeClaim(input),
    (result) => resultHasFailedClaimGate(result)
  );
  registerJsonTool(server, "farm_close_page", ClosePageInputSchema, (input) => service.closePage(input));
  registerJsonTool(server, "farm_click", ClickInputSchema, (input) => service.click(input));
  registerJsonTool(server, "farm_fill", FillInputSchema, (input) => service.fill(input));
  registerJsonTool(server, "farm_press", PressInputSchema, (input) => service.press(input));
  registerJsonTool(server, "farm_select_option", SelectOptionInputSchema, (input) => service.selectOption(input));
  registerJsonTool(server, "farm_release_context", ReleaseContextInputSchema, (input) => service.releaseContext(input));
  registerJsonTool(server, "farm_list_leases", ListLeasesInputSchema, () => service.listLeases());
  registerJsonTool(server, "farm_reap_expired", ReapExpiredInputSchema, () => service.reapExpired());
  registerJsonTool(server, "farm_capabilities", CapabilitiesInputSchema, () => service.capabilities());
  registerJsonTool(server, "farm_lens", LensInputSchema, (input) => service.lens(input));
  registerJsonTool(server, "farm_list_runs", ListRunsInputSchema, (input) => service.listRuns(input));
  registerJsonTool(server, "farm_extract_structured", ExtractStructuredInputSchema, (input) => service.extractStructured(input));
  registerJsonTool(
    server,
    "farm_export_bundle",
    ExportBundleInputSchema,
    (input) => service.exportBundle(input),
    // Export auto-verifies the bundle it built; a tampered-at-export run is an error result.
    (result) => resultHasFailedClaimGate(result)
  );
  registerJsonTool(
    server,
    "farm_verify_bundle",
    VerifyBundleInputSchema,
    (input) => service.verifyBundle(input),
    (result) => resultHasFailedClaimGate(result)
  );

  return server;
}

export async function runStdioServer(service = new FarmService()): Promise<void> {
  const server = createMcpServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** The tool names the MCP server registers. Use to assert the negative surface (no cdp/auth/attach
 * tool is exposed). Rebuilds a throwaway server to capture the current registration. */
export function registeredToolNames(service: FarmService = new FarmService()): string[] {
  createMcpServer(service);
  return [...registeredToolNameList];
}

function registerJsonTool<T extends z.ZodRawShape>(server: McpServer, name: string, schema: z.ZodObject<T>, handler: (input: z.infer<z.ZodObject<T>>) => unknown | Promise<unknown>, isErrorResult?: (result: unknown) => boolean): void {
  registeredToolNameList.push(name);
  server.registerTool(
    name,
    {
      title: name,
      description: TOOL_DESCRIPTIONS[name] ?? `${name} for the Browser-Agent MCP Farm`,
      inputSchema: schema.shape
    } as never,
    async (input: unknown) => {
      try {
        const result = await handler(schema.parse(input));
        return {
          ...(isErrorResult?.(result) ? { isError: true as const } : {}),
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(toToolError(error), null, 2) }]
        };
      }
    }
  );
}

function resultHasFailedClaimGate(result: unknown): boolean {
  return typeof result === "object" && result !== null && "ok" in result && (result as { ok?: unknown }).ok === false;
}
