import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "./helpers/cli-harness.js";

describe("cli serve-http auth guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to bind a non-loopback host without a token (no --token, no FARM_HTTP_TOKEN)", async () => {
    vi.stubEnv("FARM_HTTP_TOKEN", "");
    const { out, exitCode } = await runCli(["serve-http", "--host", "0.0.0.0", "--port", "0"]);
    expect(out).toContain("Refusing to start serve-http on non-loopback host '0.0.0.0' without an auth token");
    expect(exitCode).toBe(1);
  });

  it("still refuses a non-loopback host when FARM_HTTP_TOKEN is set to an empty/whitespace value", async () => {
    vi.stubEnv("FARM_HTTP_TOKEN", "   ");
    const { out, exitCode } = await runCli(["serve-http", "--host", "203.0.113.5", "--port", "0"]);
    expect(out).toContain("Refusing to start serve-http on non-loopback host '203.0.113.5' without an auth token");
    expect(exitCode).toBe(1);
  });
});
