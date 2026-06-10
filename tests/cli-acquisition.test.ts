import { describe, expect, it } from "vitest";

import { runCli } from "./helpers/cli-harness.js";

describe("cli upgrade", () => {
  it("upgrade prints the installed version and re-register guidance", async () => {
    const { out, exitCode } = await runCli(["upgrade"]);
    expect(out).toContain('"name": "browser-agent-mcp-farm"');
    expect(out).toContain('"version"');
    expect(out).toContain("register-all");
    expect(exitCode).toBeFalsy();
  });
});
