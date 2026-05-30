import { describe, expect, it } from "vitest";

import { runCli } from "./helpers/cli-harness.js";

describe("cli upgrade + coverage-report routes", () => {
  it("upgrade prints the installed version and re-register guidance", async () => {
    const { out, exitCode } = await runCli(["upgrade"]);
    expect(out).toContain('"name": "browser-agent-mcp-farm"');
    expect(out).toContain('"version"');
    expect(out).toContain("register-all");
    expect(exitCode).toBeFalsy();
  });

  it("coverage-report --format routes prints the acquisition tier per source", async () => {
    const { out } = await runCli(["coverage-report", "--platform", "google_search", "--format", "routes"]);
    expect(out).toContain("acquisition routes");
    expect(out).toContain("byo_capture");
  });

  it("coverage-report rejects an unknown --format", async () => {
    const { exitCode } = await runCli(["coverage-report", "--platform", "google_search", "--format", "bogus"]);
    expect(exitCode).toBe(1);
  });
});
