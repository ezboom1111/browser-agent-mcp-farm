import { z } from "zod";

export const CapabilitySchema = z.enum(["read-only", "read-write"]);
export const StoragePolicySchema = z.enum(["ephemeral", "storage-state", "persistent-profile"]);
export const ClaimTypeSchema = z.enum(["visual", "text", "metadata", "audio", "inference"]);
export const EvidenceKindSchema = z.enum([
  "page_text",
  "page_html",
  "page_screenshot",
  "frame_screenshot",
  "metadata",
  "media",
  "media_index",
  "transcript_cue",
  "ocr_text",
  "structured_data",
  "official_api_metadata",
  "api_cache",
  "source_strategy",
  "source_registry",
  "source_navigation_plan",
  "source_navigation_execution_plan",
  "source_navigation_recipe_plan",
  "source_navigation_calibration",
  "source_navigation_action",
  "source_navigation_followup",
  "destination_candidate",
  "destination_triage",
  "destination_deepening_proposal",
  "destination_deepening_run",
  "browser_obstruction",
  "browser_overlay_dismissal",
  "audio_transcription",
  "failure"
]);
export const VerificationLevelSchema = z.enum([
  "verified",
  "grounded",
  "browser_visible",
  "official_api",
  "transcript_cue",
  "ocr_extracted",
  "unverified",
  "inferred"
]);

export const OcrStatusSchema = z.enum(["ok", "unavailable", "no_frames", "empty_text", "low_confidence", "engine_error", "timeout"]);
export const OcrBoundingBoxSchema = z.object({
  x0: z.number().nonnegative(),
  y0: z.number().nonnegative(),
  x1: z.number().nonnegative(),
  y1: z.number().nonnegative()
});
export const OcrWordSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(100).optional(),
  bbox: OcrBoundingBoxSchema.optional()
});
export const OcrTextScriptSchema = z.enum(["latin", "hangul", "hiragana", "katakana", "cjk", "digit", "currency"]);
export const OcrTextProfileSchema = z.object({
  lineCount: z.number().int().nonnegative(),
  nonWhitespaceCharCount: z.number().int().nonnegative(),
  scripts: z.array(OcrTextScriptSchema),
  hasDigits: z.boolean(),
  hasCurrency: z.boolean(),
  hasPriceLikeText: z.boolean(),
  priceLikeTokenCount: z.number().int().nonnegative(),
  hasPercentLikeText: z.boolean(),
  hasMapLikeText: z.boolean(),
  hasTravelOrCommerceLikeText: z.boolean(),
  hasRatingLikeText: z.boolean(),
  hasDistanceLikeText: z.boolean(),
  hasBusinessHoursLikeText: z.boolean(),
  hasContactLikeText: z.boolean(),
  hasReservationLikeText: z.boolean(),
  hasMenuLikeText: z.boolean(),
  hasCommercePolicyLikeText: z.boolean()
});
export const OcrEvidenceMetadataSchema = z.object({
  status: OcrStatusSchema,
  language: z.string().min(1),
  minConfidence: z.number().min(0).max(100),
  requestedFrames: z.number().int().nonnegative().optional(),
  reason: z.string().optional(),
  sourceArtifactId: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  timestampSec: z.number().nonnegative().max(86_400).optional(),
  cacheHit: z.boolean().optional(),
  textLength: z.number().int().nonnegative().optional(),
  confidence: z.number().min(0).max(100).optional(),
  confidenceMet: z.boolean().optional(),
  wordCount: z.number().int().nonnegative().optional(),
  wordsReturned: z.number().int().nonnegative().optional(),
  wordsCapped: z.boolean().optional(),
  textProfile: OcrTextProfileSchema.optional(),
  words: z.array(OcrWordSchema).optional()
});

export const ProxyConfigSchema = z.object({
  server: z.string().min(1),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional()
});

export const FingerprintSchema = z.object({
  userAgent: z.string().min(1).optional(),
  locale: z.string().min(1).optional(),
  timezoneId: z.string().min(1).optional(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive()
  }).optional(),
  colorScheme: z.enum(["light", "dark", "no-preference"]).optional()
});

// Claim grounding (master-plan flagship, slice 1). A claim's anchor says WHERE in
// the cited artifact it is grounded; the claim gate verifies it against the
// artifact bytes in grounding mode. The taxonomy lets paraphrase/aggregation
// claims be graded by supporting tokens rather than naive whole-sentence match.
export const ClaimTaxonomySchema = z.enum(["quote", "derived", "aggregated"]);

export const ClaimAnchorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text_span"),
    quote: z.string().min(1).describe("Exact text the claim is grounded on; must appear in the cited text/HTML/OCR artifact."),
    normalizedTokens: z.array(z.string().min(1)).max(200).optional().describe("Optional normalized supporting tokens for derived/aggregated claims.")
  }),
  z.object({
    type: z.literal("ocr_bbox"),
    wordIndexes: z.array(z.number().int().nonnegative()).max(500).optional(),
    bbox: OcrBoundingBoxSchema.optional()
  }),
  z.object({
    type: z.literal("transcript_cue"),
    cueIndex: z.number().int().nonnegative().optional(),
    timeRangeSec: z.object({
      start: z.number().nonnegative().max(86_400),
      end: z.number().nonnegative().max(86_400)
    }).optional()
  }),
  z.object({
    type: z.literal("frame"),
    timestampSec: z.number().nonnegative().max(86_400)
  })
]);

export const AcquireContextInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; recorded as the lease owner and required by every later tool call."),
  runId: z.string().min(1).describe("Caller-chosen run identifier used to group artifacts for one research run."),
  artifactRunDir: z.string().min(1).describe("Absolute directory where this run's artifacts (screenshots, text, ledgers) are written."),
  ttlMs: z.number().int().positive().max(3_600_000).optional().describe("Lease time-to-live in ms (max 1h). Extend with farm_heartbeat during long work."),
  allowedDomains: z.array(z.string().min(1)).optional().describe("Allowlist of hostnames this lease may open; requests to other domains are refused."),
  maxPages: z.number().int().positive().max(20).optional().describe("Maximum concurrent open pages for this lease (max 20)."),
  capability: CapabilitySchema.default("read-only").describe("'read-only' for capture (default); 'read-write' only when you must click/fill/press. Payment/booking actions are always refused."),
  storagePolicy: StoragePolicySchema.default("ephemeral").describe("'ephemeral' (fresh context, default); 'storage-state' (reuse a saved cookie jar); 'persistent-profile' (a real on-disk browser profile)."),
  profileName: z.string().min(1).optional().describe("Named saved profile to reuse (with storage-state/persistent-profile). One active lease per profile, enforced across processes."),
  storageStatePath: z.string().min(1).optional().describe("Explicit path to a Playwright storageState JSON (alternative to profileName)."),
  userDataDir: z.string().min(1).optional().describe("Explicit persistent user-data directory (used with persistent-profile)."),
  proxy: ProxyConfigSchema.optional().describe("Optional upstream proxy for this context."),
  fingerprint: FingerprintSchema.optional().describe("Optional user-agent/locale/timezone/viewport overrides.")
});

export const HeartbeatInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context.")
});

export const OpenPageInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  url: z.url().describe("URL to open in the leased context.")
});

export const CaptureInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  pageId: z.string().min(1).describe("Page ID returned by farm_open_page."),
  captureId: z.string().min(1).optional()
});

export const WaitInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  pageId: z.string().min(1).describe("Page ID returned by farm_open_page."),
  waitMs: z.number().int().positive().max(120_000)
});

export const WaitForSelectorInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  pageId: z.string().min(1).describe("Page ID returned by farm_open_page."),
  selector: z.string().min(1).describe("CSS selector to wait for."),
  timeoutMs: z.number().int().positive().max(120_000).default(10_000)
});

export const ScrollInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  pageId: z.string().min(1).describe("Page ID returned by farm_open_page."),
  direction: z.enum(["down", "up", "bottom", "top"]).default("down"),
  pixels: z.number().int().positive().max(50_000).default(800)
});

export const CaptureAfterIdleInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  pageId: z.string().min(1).describe("Page ID returned by farm_open_page."),
  captureId: z.string().min(1).optional(),
  waitMs: z.number().int().nonnegative().max(120_000).default(0),
  idleMs: z.number().int().nonnegative().max(30_000).default(500),
  timeoutMs: z.number().int().positive().max(120_000).default(10_000)
});

export const SampleFramesInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  pageId: z.string().min(1).describe("Page ID returned by farm_open_page."),
  selector: z.string().min(1).default("video"),
  captureId: z.string().min(1).optional(),
  timestampsSec: z.array(z.number().nonnegative().max(86_400)).max(120).optional(),
  durationSec: z.number().nonnegative().max(86_400).optional(),
  strideSec: z.number().positive().max(3_600).default(60),
  maxFrames: z.number().int().positive().max(120).default(120),
  seekTimeoutMs: z.number().int().positive().max(30_000).default(5_000),
  settleMs: z.number().int().nonnegative().max(10_000).default(250)
});

export const ClosePageInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  pageId: z.string().min(1).describe("Page ID returned by farm_open_page.")
});

export const ReleaseContextInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context.")
});

export const ClickInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  pageId: z.string().min(1).describe("Page ID returned by farm_open_page."),
  selector: z.string().min(1).describe("CSS selector for the target element.")
});

export const FillInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  pageId: z.string().min(1).describe("Page ID returned by farm_open_page."),
  selector: z.string().min(1).describe("CSS selector for the target element."),
  value: z.string().describe("Text to fill into the field.")
});

export const PressInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  pageId: z.string().min(1).describe("Page ID returned by farm_open_page."),
  key: z.string().min(1).describe("Key to press (e.g. 'Enter', 'Tab', 'ArrowDown').")
});

export const SelectOptionInputSchema = z.object({
  agentId: z.string().min(1).describe("ID of the calling agent; must own the lease."),
  contextToken: z.string().min(1).describe("Lease/context token returned by farm_acquire_context."),
  pageId: z.string().min(1).describe("Page ID returned by farm_open_page."),
  selector: z.string().min(1).describe("CSS selector for the <select> element."),
  value: z.string().min(1).describe("Option value to select.")
});

export const ReapExpiredInputSchema = z.object({});
export const ListLeasesInputSchema = z.object({});

export const OfficialApiCredentialsSchema = z.object({
  youtubeApiKeyEnv: z.string().min(1).optional(),
  youtubeOAuthTokenEnv: z.string().min(1).optional(),
  instagramAccessTokenEnv: z.string().min(1).optional(),
  tiktokAccessTokenEnv: z.string().min(1).optional(),
  tiktokResearchTokenEnv: z.string().min(1).optional()
});

const SourceNavigationExecutableActionBaseSchema = z.object({
  actionKey: z.string().min(1),
  note: z.string().min(1).optional(),
  expectedStates: z.array(z.object({
    selector: z.string().min(1).optional(),
    textIncludes: z.string().min(1).optional(),
    caseSensitive: z.boolean().optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional()
  }).refine((value) => value.selector !== undefined || value.textIncludes !== undefined, {
    message: "expected state must include selector or textIncludes"
  })).max(20).optional(),
  captureScopes: z.array(z.object({
    key: z.string().min(1),
    selector: z.string().min(1),
    phase: z.enum(["before", "after"]).optional(),
    note: z.string().min(1).optional()
  })).max(20).optional()
});

export const SourceNavigationExecutableActionSchema = z.discriminatedUnion("operation", [
  SourceNavigationExecutableActionBaseSchema.extend({
    operation: z.literal("click"),
    selector: z.string().min(1)
  }),
  SourceNavigationExecutableActionBaseSchema.extend({
    operation: z.literal("fill"),
    selector: z.string().min(1),
    value: z.string()
  }),
  SourceNavigationExecutableActionBaseSchema.extend({
    operation: z.literal("select"),
    selector: z.string().min(1),
    value: z.string().min(1)
  }),
  SourceNavigationExecutableActionBaseSchema.extend({
    operation: z.literal("press"),
    key: z.string().min(1)
  }),
  SourceNavigationExecutableActionBaseSchema.extend({
    operation: z.literal("scroll"),
    direction: z.enum(["down", "up", "bottom", "top"]).optional(),
    pixels: z.number().int().positive().max(100_000).optional()
  }),
  SourceNavigationExecutableActionBaseSchema.extend({
    operation: z.literal("wait_for_selector"),
    selector: z.string().min(1)
  }),
  SourceNavigationExecutableActionBaseSchema.extend({
    operation: z.literal("capture")
  }),
  SourceNavigationExecutableActionBaseSchema.extend({
    operation: z.literal("follow_up"),
    selector: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    captureId: z.string().min(1).optional()
  }),
  SourceNavigationExecutableActionBaseSchema.extend({
    operation: z.literal("extract_destinations"),
    selector: z.string().min(1),
    maxLinks: z.number().int().positive().max(50).optional(),
    captureId: z.string().min(1).optional()
  }),
  SourceNavigationExecutableActionBaseSchema.extend({
    operation: z.literal("extract_client_state_destinations"),
    selector: z.string().min(1).optional(),
    stateKey: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,120}$/).optional(),
    extractor: z.literal("naver_place_apollo").optional(),
    destinationPath: z.enum(["restaurant", "hospital", "place", "accommodation"]).optional(),
    maxLinks: z.number().int().positive().max(50).optional(),
    captureId: z.string().min(1).optional()
  })
]).superRefine((value, ctx) => {
  if (value.operation === "follow_up" && value.selector === undefined && value.url === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "follow_up action must include selector or url"
    });
  }
});

export const SourceNavigationRecipeInputSchema = z.object({
  enabled: z.boolean().default(false),
  calibrate: z.boolean().default(false),
  calibrationSelectorTimeoutMs: z.number().int().positive().max(10_000).optional(),
  actions: z.array(SourceNavigationExecutableActionSchema).max(50).default([]),
  maxActions: z.number().int().positive().max(50).optional(),
  perActionTimeoutMs: z.number().int().positive().max(120_000).optional(),
  captureBeforeAfter: z.boolean().optional(),
  stopOnUnsupported: z.boolean().optional(),
  maxFollowUps: z.number().int().nonnegative().max(5).optional(),
  maxFollowUpsPerDomain: z.number().int().nonnegative().max(5).optional(),
  followUpConcurrency: z.number().int().positive().max(5).optional(),
  fallbackFollowUps: z.boolean().optional(),
  maxFallbackFollowUps: z.number().int().nonnegative().max(5).optional(),
  maxDepth: z.number().int().positive().max(2).optional(),
  maxDeepeningRuns: z.number().int().nonnegative().max(5).optional(),
  maxDeepeningRunsPerDomain: z.number().int().nonnegative().max(5).optional(),
  deepeningConcurrency: z.number().int().positive().max(5).optional(),
  deepeningTimeoutMs: z.number().int().positive().max(120_000).optional(),
  maxDeepeningArtifacts: z.number().int().positive().max(1_000).optional()
}).default({ enabled: false, calibrate: false, actions: [] });

export const EvidenceRunInputSchema = z.object({
  url: z.url().describe("The page to research. The farm captures the rendered page, derives evidence (frames/OCR/transcript/official-API/obstructions), runs source strategy + bounded destination triage, and produces a claim-gated report."),
  runDir: z.string().min(1).optional().describe("Directory for this run's artifacts. Defaults to a temp directory; the chosen path is returned as `runDir`."),
  captureId: z.string().min(1).optional(),
  frameSelector: z.string().min(1).optional(),
  timestampsSec: z.array(z.number().nonnegative().max(86_400)).max(120).optional(),
  maxFrames: z.number().int().positive().max(120).optional(),
  waitMs: z.number().int().nonnegative().max(120_000).optional(),
  navigationTimeoutMs: z.number().int().positive().max(120_000).optional(),
  seekTimeoutMs: z.number().int().positive().max(30_000).optional(),
  settleMs: z.number().int().nonnegative().max(10_000).optional(),
  sampleFrames: z.boolean().default(true).describe("Sample timestamped frames from visible media (required to support visual claims). Default true."),
  finalClaimGate: z.boolean().default(true).describe("Run the final claim gate; the report (and the MCP result) fails if any claim is uncited or there are zero claims. Default true."),
  profileName: z.string().min(1).optional().describe("Named saved profile to drive this run (for authenticated or anti-bot-sensitive pages)."),
  storagePolicy: StoragePolicySchema.optional(),
  headed: z.boolean().default(false).describe("Run with a visible browser window. NOT supported over MCP (use the CLI); MCP evidence-run is headless."),
  browserChannel: z.string().min(1).optional(),
  overlayDismissal: z.object({
    enabled: z.boolean().default(true),
    maxActions: z.number().int().nonnegative().max(10).default(3)
  }).default({ enabled: true, maxActions: 3 }),
  ocr: z.object({
    enabled: z.boolean().default(false),
    maxFrames: z.number().int().positive().max(120).default(20),
    timeoutMs: z.number().int().positive().max(60_000).default(10_000),
    language: z.string().min(1).max(32).default("eng"),
    minConfidence: z.number().min(0).max(100).default(0)
  }).default({ enabled: false, maxFrames: 20, timeoutMs: 10_000, language: "eng", minConfidence: 0 }),
  denseSampling: z.object({
    enabled: z.boolean().default(false),
    windowSec: z.number().positive().max(600).default(5),
    stepSec: z.number().positive().max(60).default(1),
    maxDenseFrames: z.number().int().positive().max(240).default(40),
    sceneChange: z.boolean().default(true),
    sceneChangeThreshold: z.number().int().positive().max(64).default(16),
    sceneChangeMaxHits: z.number().int().positive().max(120).optional(),
    query: z.string().min(1).optional()
  }).default({ enabled: false, windowSec: 5, stepSec: 1, maxDenseFrames: 40, sceneChange: true, sceneChangeThreshold: 16 }),
  officialApi: z.object({
    enabled: z.boolean().default(false),
    credentials: OfficialApiCredentialsSchema.default({})
  }).default({ enabled: false, credentials: {} }),
  sourceNavigation: SourceNavigationRecipeInputSchema.describe("Optional explicit, bounded portal-navigation recipe (actions, follow-ups, destination extraction). Disabled by default; only supplied action-key recipes run, and only read-only/non-mutating operations are allowed.")
});

export const ReadReportInputSchema = z.object({
  reportPath: z.string().min(1).describe("Path to a final report file, exactly as returned by farm_evidence_run's `reportPath`.")
});

export const ListArtifactsInputSchema = z.object({
  runDir: z.string().min(1).describe("Run directory (the `runDir` returned by farm_evidence_run) whose artifacts.jsonl ledger to list."),
  evidenceKind: EvidenceKindSchema.optional().describe("Optional filter: only return artifacts of this evidence kind (e.g. frame_screenshot, destination_triage)."),
  limit: z.number().int().positive().max(1000).default(200).describe("Maximum number of artifact rows to return.")
});

export const RunClaimGateInputSchema = z.object({
  runDir: z.string().min(1).describe("Run directory (the `runDir` returned by farm_evidence_run) to validate."),
  mode: z.enum(["smoke", "final"]).default("final").describe("'final' enforces typed claims, citation provenance, and at least one cited claim; 'smoke' is lenient."),
  minClaims: z.number().int().nonnegative().max(1000).optional().describe("Minimum number of claims required (defaults to 1 in final mode, 0 in smoke mode).")
});

export const ReadArtifactInputSchema = z.object({
  runDir: z.string().min(1).describe("Run directory (the `runDir` from farm_evidence_run) containing the artifact ledger."),
  artifactId: z.string().min(1).optional().describe("artifact_id to read (from farm_list_artifacts). Provide this OR `path`."),
  path: z.string().min(1).optional().describe("The artifact's ledger `path` relative to runDir. Provide this OR `artifactId`."),
  maxBytes: z.number().int().positive().max(5_000_000).default(1_000_000).describe("Maximum bytes to return; content is truncated past this."),
  asText: z.boolean().optional().describe("Force text (utf8) vs binary (base64). Default: text for text-like evidence kinds, base64 for screenshots/media.")
}).refine((value) => value.artifactId !== undefined || value.path !== undefined, {
  message: "provide artifactId or path"
});

// Agent claim-authoring (master-plan flagship slice 2). Lets ANY agent register
// the bytes it saw and author its OWN substantive, cite-or-fail grounded claim,
// so the gate covers the agent's answer — not just runner boilerplate.
export const RegisterEvidenceInputSchema = z.object({
  runDir: z.string().min(1).describe("Run directory to register the artifact into (a fresh dir for a new bundle, or an existing runDir)."),
  text: z.string().min(1).describe("The evidence content to register (e.g. the exact text you will cite)."),
  evidenceKind: EvidenceKindSchema.default("page_text").describe("Typed kind of this evidence (default page_text)."),
  sourceUrl: z.url().describe("The source the evidence came from (recorded as provenance)."),
  captureId: z.string().min(1).optional().describe("Optional id for the artifact filename.")
});

export const AddClaimInputSchema = z.object({
  runDir: z.string().min(1).describe("Run directory containing the cited artifact's ledger."),
  claim: z.string().min(1).describe("The substantive claim text you are asserting."),
  claimType: ClaimTypeSchema.describe("visual | text | metadata | audio | inference."),
  artifactId: z.string().min(1).describe("artifact_id of the registered evidence this claim cites (from farm_register_evidence / farm_list_artifacts)."),
  evidenceKind: EvidenceKindSchema.describe("The cited artifact's evidence kind."),
  anchor: ClaimAnchorSchema.optional().describe("WHERE in the cited artifact the claim is grounded; verified against the bytes."),
  claimTaxonomy: ClaimTaxonomySchema.optional().describe("quote (default) | derived | aggregated."),
  verificationLevel: VerificationLevelSchema.default("grounded").describe("Verification level recorded on the claim."),
  timestampSec: z.number().nonnegative().max(86_400).optional().describe("Required for visual claims citing a frame screenshot.")
});

export const CapabilitiesInputSchema = z.object({});

export const ListRunsInputSchema = z.object({
  runRoot: z.string().min(1).optional().describe("Directory to scan for run folders. Defaults to the system temp dir, where evidence-run writes."),
  limit: z.number().int().positive().max(500).default(50).describe("Maximum number of runs to return.")
});

export const ExtractStructuredInputSchema = z.object({
  html: z.string().min(1).optional().describe("Captured HTML to parse. Provide this, OR runDir + artifactId/path to load a page_html artifact."),
  runDir: z.string().min(1).optional().describe("Run directory holding the HTML artifact (alternative to passing html)."),
  artifactId: z.string().min(1).optional().describe("artifact_id of a page_html artifact in runDir to parse."),
  path: z.string().min(1).optional().describe("Ledger path of the HTML artifact (alternative to artifactId).")
}).refine((value) => value.html !== undefined || (value.runDir !== undefined && (value.artifactId !== undefined || value.path !== undefined)), {
  message: "provide html, or runDir + artifactId/path"
});

export const ExportBundleInputSchema = z.object({
  runDir: z.string().min(1).describe("Run directory to export a verifiable bundle manifest for."),
  privateKeyEnv: z.string().min(1).optional().describe("Name of an env var holding an Ed25519 private key (PEM) to sign the Merkle root. Omit to skip signing.")
});

export const BundleManifestSchema = z.object({
  version: z.literal(1),
  artifactCount: z.number().int().nonnegative(),
  artifacts: z.array(z.object({
    artifact_id: z.string().min(1),
    path: z.string().min(1).optional(),
    sha256: z.string().min(1)
  })),
  merkleRoot: z.string().min(1),
  claimCount: z.number().int().nonnegative(),
  citationCount: z.number().int().nonnegative(),
  signature: z.string().min(1).optional()
});

export const VerifyBundleInputSchema = z.object({
  runDir: z.string().min(1).describe("Run directory whose artifacts the manifest is checked against (re-hashed in place)."),
  manifest: BundleManifestSchema.describe("The bundle manifest from farm_export_bundle."),
  publicKeyEnv: z.string().min(1).optional().describe("Name of an env var holding the Ed25519 public key (PEM) to verify the signature. Omit to skip signature verification.")
});

export type AcquireContextInput = z.input<typeof AcquireContextInputSchema>;
export type HeartbeatInput = z.input<typeof HeartbeatInputSchema>;
export type OpenPageInput = z.input<typeof OpenPageInputSchema>;
export type CaptureInput = z.input<typeof CaptureInputSchema>;
export type WaitInput = z.input<typeof WaitInputSchema>;
export type WaitForSelectorInput = z.input<typeof WaitForSelectorInputSchema>;
export type ScrollInput = z.input<typeof ScrollInputSchema>;
export type CaptureAfterIdleInput = z.input<typeof CaptureAfterIdleInputSchema>;
export type SampleFramesInput = z.input<typeof SampleFramesInputSchema>;
export type ClosePageInput = z.input<typeof ClosePageInputSchema>;
export type ReleaseContextInput = z.input<typeof ReleaseContextInputSchema>;
export type ClickInput = z.input<typeof ClickInputSchema>;
export type FillInput = z.input<typeof FillInputSchema>;
export type PressInput = z.input<typeof PressInputSchema>;
export type SelectOptionInput = z.input<typeof SelectOptionInputSchema>;
export type ClaimType = z.infer<typeof ClaimTypeSchema>;
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export type VerificationLevel = z.infer<typeof VerificationLevelSchema>;
export type OcrEvidenceMetadata = z.infer<typeof OcrEvidenceMetadataSchema>;
export type OcrWord = z.infer<typeof OcrWordSchema>;
export type OcrTextScript = z.infer<typeof OcrTextScriptSchema>;
export type OcrTextProfile = z.infer<typeof OcrTextProfileSchema>;
export type SourceNavigationExecutableActionInput = z.infer<typeof SourceNavigationExecutableActionSchema>;
export type SourceNavigationRecipeInput = z.infer<typeof SourceNavigationRecipeInputSchema>;
export type EvidenceRunInput = z.input<typeof EvidenceRunInputSchema>;
export type NormalizedEvidenceRunInput = z.output<typeof EvidenceRunInputSchema>;
export type ReadReportInput = z.input<typeof ReadReportInputSchema>;
export type ListArtifactsInput = z.input<typeof ListArtifactsInputSchema>;
export type RunClaimGateInput = z.input<typeof RunClaimGateInputSchema>;
export type ReadArtifactInput = z.input<typeof ReadArtifactInputSchema>;
export type RegisterEvidenceInput = z.input<typeof RegisterEvidenceInputSchema>;
export type AddClaimInput = z.input<typeof AddClaimInputSchema>;
export type ListRunsInput = z.input<typeof ListRunsInputSchema>;
export type ExtractStructuredInput = z.input<typeof ExtractStructuredInputSchema>;
export type ExportBundleInput = z.input<typeof ExportBundleInputSchema>;
export type VerifyBundleInput = z.input<typeof VerifyBundleInputSchema>;
export type ClaimAnchor = z.infer<typeof ClaimAnchorSchema>;
export type ClaimTaxonomy = z.infer<typeof ClaimTaxonomySchema>;
