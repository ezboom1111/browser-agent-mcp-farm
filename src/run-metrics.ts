// Per-run observability metrics (master-plan P6, observability/SLO domain). Reduces a
// run's per-stage timings into a small, deterministic summary (counts, total, p50/p95
// stage latency, slowest stage) that an operator or an SLO/auto-demotion check can read
// from the run's metrics.json sidecar. Pure; the structural input type avoids an import
// cycle with the evidence runner that produces the timings.

export interface StageTimingLike {
  stage: string;
  durationMs: number;
  status: string;
}

export interface RunMetrics {
  stageCount: number;
  okCount: number;
  failedCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  slowestStage: { stage: string; durationMs: number } | null;
  // Cost dimensions (C3). Present when the run produced them; the browser-launch cost is a stage
  // timing ("browser_prewarm"), so warm-vs-cold and the resource-block win are measurable per run.
  blockedResourceCount?: number;
}

export interface RunMetricsExtras {
  blockedResourceCount?: number;
}

// Nearest-rank percentile over an ascending-sorted array.
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const index = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[index] ?? 0;
}

export function summarizeStageTimings(timings: readonly StageTimingLike[], extras: RunMetricsExtras = {}): RunMetrics {
  const sorted = timings.map((timing) => Math.max(0, timing.durationMs)).sort((a, b) => a - b);
  let okCount = 0;
  let totalDurationMs = 0;
  let slowestStage: { stage: string; durationMs: number } | null = null;

  for (const timing of timings) {
    const durationMs = Math.max(0, timing.durationMs);
    if (timing.status === "ok") {
      okCount += 1;
    }
    totalDurationMs += durationMs;
    if (slowestStage === null || durationMs > slowestStage.durationMs) {
      slowestStage = { stage: timing.stage, durationMs };
    }
  }

  return {
    stageCount: timings.length,
    okCount,
    failedCount: timings.length - okCount,
    totalDurationMs,
    maxDurationMs: sorted.at(-1) ?? 0,
    p50DurationMs: percentile(sorted, 50),
    p95DurationMs: percentile(sorted, 95),
    slowestStage,
    ...(extras.blockedResourceCount === undefined ? {} : { blockedResourceCount: extras.blockedResourceCount })
  };
}
