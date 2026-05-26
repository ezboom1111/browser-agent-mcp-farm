import type { ArtifactRecord } from "./artifact-writer.js";

export const DEFAULT_FRAME_BASE_TIMESTAMPS_SEC = [0, 10, 30] as const;
export const DEFAULT_FRAME_STRIDE_SEC = 60;
export const DEFAULT_MAX_FRAME_SAMPLES = 120;

export interface TimestampPlanInput {
  timestampsSec?: number[] | undefined;
  durationSec?: number | undefined;
  strideSec?: number | undefined;
  maxFrames?: number | undefined;
}

export interface TimestampPlan {
  source: "explicit" | "default";
  timestampsSec: number[];
  durationSec?: number;
  strideSec: number;
  maxFrames: number;
  capped: boolean;
  omittedCount: number;
}

export interface SerializedTextTrack {
  kind: string;
  label: string;
  language: string;
  mode: string;
  cues: SerializedCue[];
  activeCues: SerializedCue[];
}

export interface SerializedTrackElement {
  kind: string;
  label: string;
  srclang: string;
  src: string;
  readyState: number;
  default: boolean;
}

export interface SerializedCue {
  startTime: number;
  endTime: number;
  text: string;
}

export interface MediaElementSnapshot {
  durationSec?: number;
  currentTimeSec?: number;
  readyState?: number;
  paused?: boolean;
  textTracks: SerializedTextTrack[];
  trackElements: SerializedTrackElement[];
}

export interface SeekResult {
  ok: boolean;
  requestedTimestampSec: number;
  currentTimeSec?: number;
  durationSec?: number;
  reason?: string;
}

export interface FrameSample {
  ordinal: number;
  timestampSec: number;
  captureId: string;
  status: "ok" | "partial";
  seek: SeekResult;
  activeCues: SerializedCue[];
  records: ArtifactRecord[];
  error?: string;
}

export interface FrameSampleRunResult {
  ok: boolean;
  status: "ok" | "partial";
  sourceUrl: string;
  selector: string;
  captureId: string;
  plan: TimestampPlan;
  media: MediaElementSnapshot;
  frames: FrameSample[];
  records: ArtifactRecord[];
  warnings: string[];
}

export function buildTimestampPlan(input: TimestampPlanInput = {}): TimestampPlan {
  const maxFrames = input.maxFrames ?? DEFAULT_MAX_FRAME_SAMPLES;
  const strideSec = input.strideSec ?? DEFAULT_FRAME_STRIDE_SEC;
  const durationSec = normalizeDuration(input.durationSec);
  const raw = input.timestampsSec === undefined
    ? defaultTimestamps(durationSec, strideSec)
    : input.timestampsSec;
  const bounded = normalizeTimestamps(raw, durationSec);
  const timestampsSec = bounded.slice(0, maxFrames);
  return {
    source: input.timestampsSec === undefined ? "default" : "explicit",
    timestampsSec,
    ...(durationSec === undefined ? {} : { durationSec }),
    strideSec,
    maxFrames,
    capped: bounded.length > timestampsSec.length,
    omittedCount: Math.max(0, bounded.length - timestampsSec.length)
  };
}

export function frameCaptureId(baseCaptureId: string, ordinal: number, timestampSec: number): string {
  return `${baseCaptureId}-frame-${String(ordinal).padStart(3, "0")}-${formatTimestampForFile(timestampSec)}`;
}

export function formatTimestampForFile(timestampSec: number): string {
  const safe = Math.max(0, timestampSec);
  const whole = Math.floor(safe);
  const millis = Math.round((safe - whole) * 1000);
  const secondsPart = String(whole).padStart(6, "0");
  return millis === 0 ? `${secondsPart}s` : `${secondsPart}s${String(millis).padStart(3, "0")}ms`;
}

function defaultTimestamps(durationSec: number | undefined, strideSec: number): number[] {
  if (durationSec === undefined) {
    return [...DEFAULT_FRAME_BASE_TIMESTAMPS_SEC];
  }

  const timestamps = new Set<number>();
  timestamps.add(0);
  for (const timestamp of DEFAULT_FRAME_BASE_TIMESTAMPS_SEC) {
    if (timestamp <= durationSec) {
      timestamps.add(timestamp);
    }
  }
  for (let timestamp = strideSec; timestamp < durationSec; timestamp += strideSec) {
    timestamps.add(timestamp);
  }
  if (durationSec > 0) {
    timestamps.add(durationSec);
  }
  return [...timestamps].sort((left, right) => left - right);
}

function normalizeTimestamps(timestamps: number[], durationSec: number | undefined): number[] {
  const filtered = timestamps
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= 0)
    .map((timestamp) => Math.round(timestamp * 1000) / 1000)
    .filter((timestamp) => durationSec === undefined || timestamp <= durationSec);
  return [...new Set(filtered)].sort((left, right) => left - right);
}

function normalizeDuration(durationSec: number | undefined): number | undefined {
  if (durationSec === undefined || !Number.isFinite(durationSec) || durationSec < 0) {
    return undefined;
  }
  return Math.round(durationSec * 1000) / 1000;
}
