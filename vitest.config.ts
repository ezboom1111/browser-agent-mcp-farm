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
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "**/*.d.ts"],
      thresholds
    }
  }
});

