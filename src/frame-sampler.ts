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

export interface DenseTimestampPlanInput {
  baseTimestampsSec: number[];
  hitTimestampsSec: number[];
  durationSec?: number | undefined;
  windowSec?: number | undefined;
  stepSec?: number | undefined;
  maxDenseFrames?: number | undefined;
}

export interface DenseTimestampPlan {
  timestampsSec: number[];
  denseTimestampsSec: number[];
  omittedCount: number;
  capped: boolean;
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

export interface FrameVisualFingerprint {
  status: "ok" | "unavailable";
  sampleSize: number;
  hash?: string;
  averageLuma?: number;
  reason?: string;
}

export interface FrameSample {
  ordinal: number;
  timestampSec: number;
  captureId: string;
  status: "ok" | "partial";
  seek: SeekResult;
  activeCues: SerializedCue[];
  visualFingerprint: FrameVisualFingerprint;
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
  denseSamplingEvents?: DenseSamplingEvent[];
  sceneChangeDiagnostics?: SceneChangeDetectionDiagnostics[];
}

export interface SceneChangeHit {
  fromTimestampSec: number;
  toTimestampSec: number;
  midpointSec: number;
  distance: number;
}

export interface SceneChangePairDistance {
  fromTimestampSec: number;
  toTimestampSec: number;
  midpointSec: number;
  distance: number;
}

export type SceneChangeThresholdRecommendation =
  | "insufficient_data"
  | "keep_threshold"
  | "lower_threshold"
  | "raise_threshold"
  | "review_near_miss";

export type SceneChangeSamplingDensityStatus =
  | "insufficient_data"
  | "ok"
  | "sparse_pairs"
  | "sparse_selected_hits";

export interface SceneChangeDetectionDiagnostics {
  threshold: number;
  maxHits: number;
  comparableFrameCount: number;
  ignoredFrameCount: number;
  uniqueFingerprintCount: number;
  comparablePairCount: number;
  zeroDistancePairCount: number;
  candidateCount: number;
  selectedHitCount: number;
  omittedHitCount: number;
  nearThresholdBand: number;
  nearThresholdBelowCount: number;
  nearThresholdAboveCount: number;
  minObservedDistance?: number;
  maxObservedDistance?: number;
  averageObservedDistance?: number;
  pairGapMinSec?: number;
  pairGapMaxSec?: number;
  pairGapAverageSec?: number;
  distanceP50?: number;
  distanceP90?: number;
  distanceP95?: number;
  selectedDistanceMin?: number;
  selectedDistanceMax?: number;
  selectedHitSpacingMinSec?: number;
  selectedHitSpacingMaxSec?: number;
  nearestBelowThreshold?: SceneChangePairDistance;
  recommendedThreshold?: number;
  thresholdRecommendation: SceneChangeThresholdRecommendation;
  thresholdRecommendationReason: string;
  samplingDensityStatus: SceneChangeSamplingDensityStatus;
  samplingDensityReason: string;
  recommendedMaxPairGapSec?: number;
}

export interface SceneChangeDetectionResult {
  hits: SceneChangeHit[];
  diagnostics: SceneChangeDetectionDiagnostics;
}

export type DenseSamplingSource = "transcript_cue" | "scene_change" | "ocr_text";

export interface DenseSamplingEvent {
  source: DenseSamplingSource;
  hitTimestampsSec: number[];
  plannedTimestampsSec: number[];
  capturedTimestampsSec: number[];
  capped: boolean;
  omittedCount: number;
  sceneChangeHits?: SceneChangeHit[];
  sceneChangeDiagnostics?: SceneChangeDetectionDiagnostics;
}

export interface SceneChangeDetectionInput {
  frames: FrameSample[];
  minDistance?: number | undefined;
  maxHits?: number | undefined;
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

export function buildDenseTimestampPlan(input: DenseTimestampPlanInput): DenseTimestampPlan {
  const windowSec = input.windowSec ?? 5;
  const stepSec = input.stepSec ?? 1;
  const maxDenseFrames = input.maxDenseFrames ?? 40;
  const dense = new Set<number>();

  for (const hit of input.hitTimestampsSec) {
    if (!Number.isFinite(hit) || hit < 0) {
      continue;
    }
    for (let timestamp = hit - windowSec; timestamp <= hit + windowSec + 1e-9; timestamp += stepSec) {
      const rounded = Math.round(Math.max(0, timestamp) * 1000) / 1000;
      if (input.durationSec === undefined || rounded <= input.durationSec) {
        dense.add(rounded);
      }
    }
  }

  const normalizedDense = [...dense].sort((left, right) => left - right);
  const denseTimestampsSec = normalizedDense.slice(0, maxDenseFrames);
  const timestampsSec = normalizeTimestamps([...input.baseTimestampsSec, ...denseTimestampsSec], input.durationSec);
  return {
    timestampsSec,
    denseTimestampsSec,
    capped: normalizedDense.length > denseTimestampsSec.length,
    omittedCount: Math.max(0, normalizedDense.length - denseTimestampsSec.length)
  };
}

export function detectSceneChangeHits(input: SceneChangeDetectionInput): SceneChangeHit[] {
  return analyzeSceneChanges(input).hits;
}

export function analyzeSceneChanges(input: SceneChangeDetectionInput): SceneChangeDetectionResult {
  const minDistance = input.minDistance ?? 16;
  const maxHits = input.maxHits ?? 20;
  const comparableFrames = [...input.frames]
    .filter((frame) => frame.status === "ok" && frame.visualFingerprint.status === "ok" && frame.visualFingerprint.hash !== undefined)
    .sort((left, right) => left.timestampSec - right.timestampSec);
  const distances: SceneChangePairDistance[] = [];

  for (let index = 1; index < comparableFrames.length; index += 1) {
    const previous = comparableFrames[index - 1];
    const current = comparableFrames[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const previousHash = previous.visualFingerprint.hash;
    const currentHash = current.visualFingerprint.hash;
    if (previousHash === undefined || currentHash === undefined || previousHash.length !== currentHash.length) {
      continue;
    }
    const distance = hammingDistance(previousHash, currentHash);
    distances.push({
      fromTimestampSec: previous.timestampSec,
      toTimestampSec: current.timestampSec,
      midpointSec: Math.round(((previous.timestampSec + current.timestampSec) / 2) * 1000) / 1000,
      distance
    });
  }

  const candidates = distances.filter((pair) => pair.distance >= minDistance);
  const hits = candidates
    .sort((left, right) => right.distance - left.distance || left.midpointSec - right.midpointSec)
    .slice(0, maxHits)
    .sort((left, right) => left.midpointSec - right.midpointSec);
  return {
    hits,
    diagnostics: buildSceneChangeDiagnostics({
      input,
      minDistance,
      maxHits,
      comparableFrames,
      distances,
      candidates,
      hits
    })
  };
}

export function frameCaptureId(baseCaptureId: string, ordinal: number, timestampSec: number): string {
  return `${baseCaptureId}-frame-${String(ordinal).padStart(3, "0")}-${formatTimestampForFile(timestampSec)}`;
}

function hammingDistance(left: string, right: string): number {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      distance += 1;
    }
  }
  return distance;
}

function buildSceneChangeDiagnostics(input: {
  input: SceneChangeDetectionInput;
  minDistance: number;
  maxHits: number;
  comparableFrames: FrameSample[];
  distances: SceneChangePairDistance[];
  candidates: SceneChangePairDistance[];
  hits: SceneChangeHit[];
}): SceneChangeDetectionDiagnostics {
  const distances = input.distances.map((pair) => pair.distance);
  const diagnostics: SceneChangeDetectionDiagnostics = {
    threshold: input.minDistance,
    maxHits: input.maxHits,
    comparableFrameCount: input.comparableFrames.length,
    ignoredFrameCount: Math.max(0, input.input.frames.length - input.comparableFrames.length),
    uniqueFingerprintCount: countUniqueFingerprints(input.comparableFrames),
    comparablePairCount: input.distances.length,
    zeroDistancePairCount: input.distances.filter((pair) => pair.distance === 0).length,
    candidateCount: input.candidates.length,
    selectedHitCount: input.hits.length,
    omittedHitCount: Math.max(0, input.candidates.length - input.hits.length),
    nearThresholdBand: nearThresholdBand(input.minDistance),
    nearThresholdBelowCount: 0,
    nearThresholdAboveCount: 0,
    thresholdRecommendation: "insufficient_data",
    thresholdRecommendationReason: "Recommendation has not been computed yet.",
    samplingDensityStatus: "insufficient_data",
    samplingDensityReason: "Sampling density has not been computed yet."
  };
  if (distances.length > 0) {
    diagnostics.minObservedDistance = Math.min(...distances);
    diagnostics.maxObservedDistance = Math.max(...distances);
    diagnostics.averageObservedDistance = Math.round((distances.reduce((sum, distance) => sum + distance, 0) / distances.length) * 1000) / 1000;
    diagnostics.distanceP50 = percentileDistance(distances, 50);
    diagnostics.distanceP90 = percentileDistance(distances, 90);
    diagnostics.distanceP95 = percentileDistance(distances, 95);
    const pairGaps = input.distances.map((pair) => Math.max(0, pair.toTimestampSec - pair.fromTimestampSec));
    diagnostics.pairGapMinSec = Math.min(...pairGaps);
    diagnostics.pairGapMaxSec = Math.max(...pairGaps);
    diagnostics.pairGapAverageSec = roundMillis(pairGaps.reduce((sum, gap) => sum + gap, 0) / pairGaps.length);
    diagnostics.nearThresholdBelowCount = input.distances.filter((pair) => pair.distance < input.minDistance && input.minDistance - pair.distance <= diagnostics.nearThresholdBand).length;
    diagnostics.nearThresholdAboveCount = input.distances.filter((pair) => pair.distance >= input.minDistance && pair.distance - input.minDistance <= diagnostics.nearThresholdBand).length;
  }
  const hitDistances = input.hits.map((hit) => hit.distance);
  if (hitDistances.length > 0) {
    diagnostics.selectedDistanceMin = Math.min(...hitDistances);
    diagnostics.selectedDistanceMax = Math.max(...hitDistances);
  }
  const selectedHitSpacings = timestampSpacings(input.hits.map((hit) => hit.midpointSec));
  if (selectedHitSpacings.length > 0) {
    diagnostics.selectedHitSpacingMinSec = Math.min(...selectedHitSpacings);
    diagnostics.selectedHitSpacingMaxSec = Math.max(...selectedHitSpacings);
  }
  const nearestBelowThreshold = input.distances
    .filter((pair) => pair.distance < input.minDistance)
    .sort((left, right) => right.distance - left.distance || left.midpointSec - right.midpointSec)[0];
  if (nearestBelowThreshold !== undefined) {
    diagnostics.nearestBelowThreshold = nearestBelowThreshold;
  }
  const recommendation = recommendSceneChangeThreshold({
    threshold: input.minDistance,
    maxHits: input.maxHits,
    distances: input.distances,
    candidates: input.candidates,
    hits: input.hits,
    nearestBelowThreshold
  });
  diagnostics.thresholdRecommendation = recommendation.recommendation;
  diagnostics.thresholdRecommendationReason = recommendation.reason;
  if (recommendation.recommendedThreshold !== undefined) {
    diagnostics.recommendedThreshold = recommendation.recommendedThreshold;
  }
  const samplingDensity = sceneChangeSamplingDensityDiagnostics(diagnostics);
  diagnostics.samplingDensityStatus = samplingDensity.status;
  diagnostics.samplingDensityReason = samplingDensity.reason;
  if (samplingDensity.recommendedMaxPairGapSec !== undefined) {
    diagnostics.recommendedMaxPairGapSec = samplingDensity.recommendedMaxPairGapSec;
  }
  return diagnostics;
}

function countUniqueFingerprints(frames: FrameSample[]): number {
  return new Set(frames.map((frame) => frame.visualFingerprint.hash).filter((hash): hash is string => hash !== undefined)).size;
}

function percentileDistance(distances: number[], percentile: number): number {
  if (distances.length === 0) {
    return 0;
  }
  const sorted = [...distances].sort((left, right) => left - right);
  const rank = Math.ceil((Math.max(0, Math.min(100, percentile)) / 100) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))] ?? 0;
}

function nearThresholdBand(threshold: number): number {
  return Math.max(2, Math.min(4, Math.ceil(threshold * 0.125)));
}

function timestampSpacings(timestampsSec: number[]): number[] {
  const sorted = [...timestampsSec].sort((left, right) => left - right);
  const spacings: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous !== undefined && current !== undefined) {
      spacings.push(roundMillis(Math.max(0, current - previous)));
    }
  }
  return spacings;
}

function roundMillis(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function recommendSceneChangeThreshold(input: {
  threshold: number;
  maxHits: number;
  distances: SceneChangePairDistance[];
  candidates: SceneChangePairDistance[];
  hits: SceneChangeHit[];
  nearestBelowThreshold?: SceneChangePairDistance | undefined;
}): {
  recommendation: SceneChangeThresholdRecommendation;
  reason: string;
  recommendedThreshold?: number | undefined;
} {
  if (input.distances.length === 0) {
    return {
      recommendation: "insufficient_data",
      reason: "No comparable adjacent frame fingerprints were available."
    };
  }

  const maxObservedDistance = Math.max(...input.distances.map((pair) => pair.distance));
  if (input.hits.length === 0) {
    if (maxObservedDistance <= 0) {
      return {
        recommendation: "insufficient_data",
        reason: "Comparable frame fingerprints did not show any visual distance."
      };
    }
    return {
      recommendation: "lower_threshold",
      recommendedThreshold: clampSceneChangeThreshold(maxObservedDistance),
      reason: "No adjacent frame pair met the current threshold; lower to the strongest observed distance to review the likely transition."
    };
  }

  if (input.candidates.length > input.hits.length) {
    const omitted = [...input.candidates]
      .sort((left, right) => right.distance - left.distance || left.midpointSec - right.midpointSec)
      .slice(input.maxHits);
    const firstOmitted = omitted[0];
    const selectedDistanceMin = Math.min(...input.hits.map((hit) => hit.distance));
    if (firstOmitted !== undefined && firstOmitted.distance < 64) {
      if (firstOmitted.distance >= selectedDistanceMin) {
        return {
          recommendation: "keep_threshold",
          recommendedThreshold: clampSceneChangeThreshold(input.threshold),
          reason: "More candidates were found than maxHits allows, but omitted candidates are tied with selected distances and cannot be separated by threshold alone."
        };
      }
      return {
        recommendation: "raise_threshold",
        recommendedThreshold: clampSceneChangeThreshold(firstOmitted.distance + 1),
        reason: "More scene-change candidates were found than maxHits allows; raise the threshold to reduce likely false positives."
      };
    }
  }

  if (input.nearestBelowThreshold !== undefined && input.threshold - input.nearestBelowThreshold.distance <= 2) {
    return {
      recommendation: "review_near_miss",
      recommendedThreshold: clampSceneChangeThreshold(input.nearestBelowThreshold.distance),
      reason: "A frame pair is just below the current threshold; review whether this near miss should trigger dense sampling."
    };
  }

  return {
    recommendation: "keep_threshold",
    recommendedThreshold: clampSceneChangeThreshold(input.threshold),
    reason: "Current threshold selected scene changes without omitted candidates or close near misses."
  };
}

function sceneChangeSamplingDensityDiagnostics(diagnostics: SceneChangeDetectionDiagnostics): {
  status: SceneChangeSamplingDensityStatus;
  reason: string;
  recommendedMaxPairGapSec?: number | undefined;
} {
  const recommendedMaxPairGapSec = 30;
  if (diagnostics.comparablePairCount < 2 || diagnostics.pairGapMaxSec === undefined) {
    return {
      status: "insufficient_data",
      reason: "Fewer than two comparable frame pairs are available; sampling density cannot be assessed."
    };
  }
  if (diagnostics.pairGapMaxSec > recommendedMaxPairGapSec) {
    return {
      status: "sparse_pairs",
      recommendedMaxPairGapSec,
      reason: `Largest adjacent frame gap is ${diagnostics.pairGapMaxSec}s; sample at or below ${recommendedMaxPairGapSec}s gaps before relying on threshold tuning.`
    };
  }
  if (diagnostics.selectedHitSpacingMaxSec !== undefined && diagnostics.selectedHitSpacingMaxSec > recommendedMaxPairGapSec) {
    return {
      status: "sparse_selected_hits",
      recommendedMaxPairGapSec,
      reason: `Selected scene-change hits are spaced up to ${diagnostics.selectedHitSpacingMaxSec}s apart; review whether denser base sampling is needed around long gaps.`
    };
  }
  return {
    status: "ok",
    recommendedMaxPairGapSec,
    reason: "Adjacent comparable frame gaps are within the default scene-change tuning review band."
  };
}

function clampSceneChangeThreshold(value: number): number {
  return Math.max(1, Math.min(64, Math.round(value)));
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
