import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { makeRun, runCli, trackTempDirs } from "./helpers/cli-harness.js";

const { dirs, cleanup, makeTempDir } = trackTempDirs();

afterEach(cleanup);

// A minimal profile/headed retry plan that passes parseSourceCoverageReadinessRetryPlan:
// schemaVersion "1.0", executionPolicy "profile_headed_retry_plan_only", itemCount matching
// the (empty) items array, plus query/warnings. Written under os.tmpdir() and tracked for cleanup.
async function writeRetryPlanFixture(query = "hello"): Promise<string> {
  const dir = await makeTempDir("farm-cli-retryplan-");
  const file = join(dir, "rp.json");
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: "1.0",
      executionPolicy: "profile_headed_retry_plan_only",
      query,
      itemCount: 0,
      items: [],
      warnings: []
    }),
    "utf8"
  );
  return file;
}

describe("cli source-coverage-readiness format branches", () => {
  it("--format targets prints registry calibration target lines", async () => {
    const { out, exitCode } = await runCli(["source-coverage-readiness", "--format", "targets"]);
    // formatSourceCoverageReadinessTargetsAsLines -> `${target.id} ${target.url}` per line.
    expect(out).toContain("youtube https://www.youtube.com/results?search_query=tokyo+hotel");
    expect(out).toContain("google_maps https://www.google.com/maps/search/tokyo%20hotel");
    expect(exitCode).toBeFalsy();
  });

  it("--format lines aliases targets (same first calibration line)", async () => {
    const targets = await runCli(["source-coverage-readiness", "--format", "targets"]);
    const lines = await runCli(["source-coverage-readiness", "--format", "lines"]);
    expect(lines.out).toContain("youtube https://www.youtube.com/results?search_query=tokyo+hotel");
    expect(lines.out).toBe(targets.out);
    expect(lines.exitCode).toBeFalsy();
  });

  it("--format retry-plan prints the markdown retry plan header", async () => {
    const { out, exitCode } = await runCli(["source-coverage-readiness", "--format", "retry-plan"]);
    expect(out).toContain("# Source Coverage Profile/Headed Retry Plan");
    expect(out).toContain("- Query: tokyo hotel");
    expect(out).toContain("- Retry item count: 0");
    expect(exitCode).toBeFalsy();
  });

  it("--format retry-commands runs the retry-commands branch without throwing", async () => {
    const { out, exitCode } = await runCli(["source-coverage-readiness", "--format", "retry-commands"]);
    // Default registry state produces no profile/headed retry commands; out may be empty.
    expect(typeof out).toBe("string");
    expect(exitCode).toBeFalsy();
  });

  it("rejects an unknown --format with exit 1", async () => {
    const { out, exitCode } = await runCli(["source-coverage-readiness", "--format", "bogus"]);
    expect(out).toContain(
      "--format must be json, lines, targets, retry-commands, or retry-plan for source-coverage-readiness"
    );
    expect(exitCode).toBe(1);
  });
});

describe("cli source-coverage-retry-plan command", () => {
  it("reads a minimal plan file and prints default json with retryPlan key", async () => {
    const rp = await writeRetryPlanFixture("hello");
    const { out, exitCode } = await runCli(["source-coverage-retry-plan", "--retry-plan", rp]);
    expect(out).toContain('"retryPlan":');
    expect(out).toContain('"query": "hello"');
    expect(out).toContain('"executionPolicy": "profile_headed_retry_plan_only"');
    expect(exitCode).toBeFalsy();
  });

  it("--format markdown renders the empty-plan markdown report", async () => {
    const rp = await writeRetryPlanFixture("hello");
    const { out, exitCode } = await runCli(["source-coverage-retry-plan", "--retry-plan", rp, "--format", "markdown"]);
    expect(out).toContain("# Source Coverage Profile/Headed Retry Plan");
    expect(out).toContain("No blocked source slots have profile/headed retry commands.");
    expect(exitCode).toBeFalsy();
  });

  it("--format check renders the check JSON with the check execution policy", async () => {
    const rp = await writeRetryPlanFixture("hello");
    const { out, exitCode } = await runCli(["source-coverage-retry-plan", "--retry-plan", rp, "--format", "check"]);
    expect(out).toContain('"executionPolicy": "profile_headed_retry_plan_check"');
    expect(out).toContain('"ok": true');
    expect(exitCode).toBeFalsy();
  });

  it("--format commands exercises the command-format renderer branch", async () => {
    const rp = await writeRetryPlanFixture("hello");
    const { out, exitCode } = await runCli(["source-coverage-retry-plan", "--retry-plan", rp, "--format", "commands"]);
    // Empty items -> empty command body; the branch (isRetryPlanCommandFormat) still runs.
    expect(typeof out).toBe("string");
    expect(exitCode).toBeFalsy();
  });

  it("rejects an unknown --format with the retry-plan error message", async () => {
    const rp = await writeRetryPlanFixture("hello");
    const { out, exitCode } = await runCli(["source-coverage-retry-plan", "--retry-plan", rp, "--format", "bogus"]);
    expect(out).toContain(
      "--format must be json, check, markdown, commands, setup-commands, or retry-commands for source-coverage-retry-plan"
    );
    expect(exitCode).toBe(1);
  });

  it("--fail-empty exits 1 when the plan has zero items", async () => {
    const rp = await writeRetryPlanFixture("hello");
    const { exitCode } = await runCli(["source-coverage-retry-plan", "--retry-plan", rp, "--fail-empty"]);
    expect(exitCode).toBe(1);
  });

  it("rejects an out-of-range --limit via parseBoundedIntegerArg", async () => {
    const rp = await writeRetryPlanFixture("hello");
    const { out, exitCode } = await runCli(["source-coverage-retry-plan", "--retry-plan", rp, "--limit", "0"]);
    expect(out).toContain("--limit must be an integer between 1 and 1000");
    expect(exitCode).toBe(1);
  });

  it("without --retry-plan throws the required-arg error", async () => {
    const { out, exitCode } = await runCli(["source-coverage-retry-plan"]);
    expect(out).toContain(
      "source-coverage-retry-plan requires --retry-plan <profile-headed-retry-plan.json>"
    );
    expect(exitCode).toBe(1);
  });
});

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
    expect(out).toContain(
      "--format must be json, check, markdown, commands, setup-commands, or retry-commands for destination-recovery-plan"
    );
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
