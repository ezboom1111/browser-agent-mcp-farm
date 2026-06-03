import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Coverage thresholds live in coverage-thresholds.json so scripts/ratchet-coverage.mjs
// can raise them (never lower) on every green run, making coverage monotonic-upward
// toward the 80% target as untested surfaces (cli.ts, http-server, scheduler) gain tests.
const thresholds = JSON.parse(
  readFileSync(new URL("./coverage-thresholds.json", import.meta.url), "utf8")
) as { lines: number; statements: number; functions: number; branches: number };

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
      thresholds
    }
  }
});

