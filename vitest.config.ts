import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Coverage thresholds live in coverage-thresholds.json so scripts/ratchet-coverage.mjs
// can raise them (never lower) on every green run, making coverage monotonic-upward
// toward the 80% target as untested surfaces (cli.ts, http-server, scheduler) gain tests.
const thresholds = JSON.parse(
  readFileSync(new URL("./coverage-thresholds.json", import.meta.url), "utf8")
) as { lines: number; statements: number; functions: number; branches: number };

// The ratchet raises these from local (Windows) runs, but win32-only paths
// (DPAPI storage-state and friends) never execute on the Linux CI runner, which
// measures ~0.5pp lower on the exact same commit (e.g. lines 78.44% local vs
// 77.93% CI). Give non-win32 runs 1pp of slack so the CI gate fails on real
// regressions, not on the platform gap.
const platformSlack = process.platform === "win32" ? 0 : 1;
const effectiveThresholds = Object.fromEntries(
  Object.entries(thresholds).map(([key, value]) => [key, Math.max(0, value - platformSlack)])
) as typeof thresholds;

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    // Several test files launch real Chromium. With unbounded file parallelism
    // (workers = CPU cores) many browsers spawn at once and contend, so heavy
    // navigation tests time out under load — a flaky failure that vanishes in
    // isolation. Cap worker concurrency so fewer browsers run simultaneously, and
    // give browser-backed tests enough headroom to finish when the box is busy.
    maxWorkers: "50%",
    minWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
      // Coverage is intentionally scoped to src/ only. The youtube-research velocity helper
      // (skills/**/*.mjs) is a consumer-side tool outside the farm's coverage contract, so its
      // in-gate test runs without ever moving the ratchet. Do NOT widen this to include skills/.
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "**/*.d.ts"],
      thresholds: effectiveThresholds
    }
  }
});

