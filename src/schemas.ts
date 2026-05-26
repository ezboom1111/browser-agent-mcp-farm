import { z } from "zod";

export const CapabilitySchema = z.enum(["read-only", "read-write"]);
export const StoragePolicySchema = z.enum(["ephemeral", "storage-state", "persistent-profile"]);

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
