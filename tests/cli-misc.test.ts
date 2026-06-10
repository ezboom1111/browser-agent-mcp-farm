import { afterEach, describe, expect, it } from "vitest";

import { makeRun, runCli, trackTempDirs } from "./helpers/cli-harness.js";

const { dirs, cleanup } = trackTempDirs();

afterEach(cleanup);

describe("cli destination-recovery-plan command", () => {
  it("on a run dir with no triage artifacts prints an empty recovery plan", async () => {
    const run = await makeRun(dirs);
    const { out, exitCode } = await runCli(["destination-recovery-plan", "--run-dir", run]);
    expect(out).toContain('"recoveryPlan":');
    expect(out).toContain('"executionPolicy": "destination_blocked_child_recovery_plan_only"');
    expect(out).toContain('"itemCount": 0');
    expect(out).toContain("No blocked child recovery advice was found under");
    expect(exitCode).toBeFalsy();
  });

  it("--format markdown renders the empty markdown report", async () => {
    const run = await makeRun(dirs);
    const { out, exitCode } = await runCli(["destination-recovery-plan", "--run-dir", run, "--format", "markdown"]);
    expect(out).toContain("# Destination Blocked Child Recovery Plan");
    expect(out).toContain("Items: 0");
    expect(out).toContain("No blocked child recovery advice was found.");
    expect(exitCode).toBeFalsy();
  });

  it("--format commands exercises the command-format renderer branch", async () => {
    const run = await makeRun(dirs);
    const { out, exitCode } = await runCli(["destination-recovery-plan", "--run-dir", run, "--format", "commands"]);
    // Empty plan -> empty command body; the isDestinationRecoveryPlanCommandFormat branch still runs.
    expect(typeof out).toBe("string");
    expect(exitCode).toBeFalsy();
  });

  it("rejects an unknown --format with exit 1", async () => {
    const run = await makeRun(dirs);
    const { out, exitCode } = await runCli(["destination-recovery-plan", "--run-dir", run, "--format", "bogus"]);
    expect(out).toContain("--format must be json, check, markdown, commands, setup-commands, or retry-commands for destination-recovery-plan");
    expect(exitCode).toBe(1);
  });

  it("requires --run-dir (arg-validation throw, exit 1)", async () => {
    const { out, exitCode } = await runCli(["destination-recovery-plan"]);
    expect(out).toContain("destination-recovery-plan requires --run-dir <evidence-run-dir>");
    expect(exitCode).toBe(1);
  });

  it("--fail-empty exits 1 on an empty plan", async () => {
    const run = await makeRun(dirs);
    const { exitCode } = await runCli(["destination-recovery-plan", "--run-dir", run, "--fail-empty"]);
    expect(exitCode).toBe(1);
  });
});
