import { defineConfig } from "vitest/config";

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
      // Ratcheting baseline (Phase 1b). Measured on the committed baseline:
      // lines 72.7 / statements 72.9 / functions 82.4 / branches 67.6.
      // Floors are set ~1pt under measured to avoid run-to-run flakiness, and
      // should be ratcheted UP toward the 80% target as untested surfaces
      // (cli.ts, http-server, scheduler, registration) gain coverage.
      thresholds: {
        lines: 72,
        statements: 72,
        functions: 81,
        branches: 66
      }
    }
  }
});

