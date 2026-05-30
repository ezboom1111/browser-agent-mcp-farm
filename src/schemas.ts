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

export const AcquireContextInputSchema = z.object({
  agentId: z.string().min(1),
  runId: z.string().min(1),
  artifactRunDir: z.string().min(1),
  ttlMs: z.number().int().positive().max(3_600_000).optional(),
  allowedDomains: z.array(z.string().min(1)).optional(),
  maxPages: z.number().int().positive().max(20).optional(),
  capability: CapabilitySchema.default("read-only"),
  storagePolicy: StoragePolicySchema.default("ephemeral"),
  profileName: z.string().min(1).optional(),
  storageStatePath: z.string().min(1).optional(),
  userDataDir: z.string().min(1).optional(),
  proxy: ProxyConfigSchema.optional(),
  fingerprint: FingerprintSchema.optional()
});

export const HeartbeatInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1)
});

export const OpenPageInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  url: z.url()
});

export const CaptureInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  pageId: z.string().min(1),
  captureId: z.string().min(1).optional()
});

export const WaitInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  pageId: z.string().min(1),
  waitMs: z.number().int().positive().max(120_000)
});

export const WaitForSelectorInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  pageId: z.string().min(1),
  selector: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120_000).default(10_000)
});

export const ScrollInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  pageId: z.string().min(1),
  direction: z.enum(["down", "up", "bottom", "top"]).default("down"),
  pixels: z.number().int().positive().max(50_000).default(800)
});

export const CaptureAfterIdleInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  pageId: z.string().min(1),
  captureId: z.string().min(1).optional(),
  waitMs: z.number().int().nonnegative().max(120_000).default(0),
  idleMs: z.number().int().nonnegative().max(30_000).default(500),
  timeoutMs: z.number().int().positive().max(120_000).default(10_000)
});

export const SampleFramesInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  pageId: z.string().min(1),
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
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  pageId: z.string().min(1)
});

export const ReleaseContextInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1)
});

export const ClickInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  pageId: z.string().min(1),
  selector: z.string().min(1)
});

export const FillInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  pageId: z.string().min(1),
  selector: z.string().min(1),
  value: z.string()
});

export const PressInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  pageId: z.string().min(1),
  key: z.string().min(1)
});

export const SelectOptionInputSchema = z.object({
  agentId: z.string().min(1),
  contextToken: z.string().min(1),
  pageId: z.string().min(1),
  selector: z.string().min(1),
  value: z.string().min(1)
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
  url: z.url(),
  runDir: z.string().min(1).optional(),
  captureId: z.string().min(1).optional(),
  frameSelector: z.string().min(1).optional(),
  timestampsSec: z.array(z.number().nonnegative().max(86_400)).max(120).optional(),
  maxFrames: z.number().int().positive().max(120).optional(),
  waitMs: z.number().int().nonnegative().max(120_000).optional(),
  navigationTimeoutMs: z.number().int().positive().max(120_000).optional(),
  seekTimeoutMs: z.number().int().positive().max(30_000).optional(),
  settleMs: z.number().int().nonnegative().max(10_000).optional(),
  sampleFrames: z.boolean().default(true),
  finalClaimGate: z.boolean().default(true),
  profileName: z.string().min(1).optional(),
  storagePolicy: StoragePolicySchema.optional(),
  headed: z.boolean().default(false),
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
  sourceNavigation: SourceNavigationRecipeInputSchema
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
