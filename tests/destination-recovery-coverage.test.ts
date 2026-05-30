import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildDestinationRecoveryPlanFromRunDir, checkDestinationRecoveryPlan, filterDestinationRecoveryPlanByCheck, formatDestinationRecoveryPlanCommandsAsLines, formatDestinationRecoveryPlanMarkdown } from "../src/destination-recovery-plan.js";
import type { DestinationRecoveryPlan, DestinationRecoveryPlanItem } from "../src/destination-recovery-plan.js";
import type { DestinationBlockedChildRecoveryAdvice } from "../src/destination-triage.js";
import { runCli, trackTempDirs } from "./helpers/cli-harness.js";

const { cleanup, makeTempDir } = trackTempDirs();
afterEach(cleanup);

// ---------------------------------------------------------------------------
// Local fixtures (self-contained: do NOT import from any *.test.ts file).
// ---------------------------------------------------------------------------

function recoveryAdvice(): DestinationBlockedChildRecoveryAdvice {
  const profileSetupPowerShellCommand = "'node' '.\\dist\\cli.js' 'auth-login' '--profile' 'pcmap.place.naver.com-recovery-profile' '--url' 'https://map.naver.com/p/entry/place/1790076538' '--wait-ms' '120000' '--browser-channel' 'chrome' '--persistent-profile'";
  const evidenceRunPowerShellCommand = "'node' '.\\dist\\cli.js' 'evidence-run' '--url' 'https://pcmap.place.naver.com/restaurant/1790076538/home' '--wait-ms' '3000' '--timeout-ms' '30000' '--headed' '--browser-channel' 'chrome' '--profile' 'pcmap.place.naver.com-recovery-profile' '--persistent-profile' '--no-frames'";
  return {
    recommendedAction: "profile_headed_retry",
    profileName: "pcmap.place.naver.com-recovery-profile",
    storagePolicy: "persistent-profile",
    browserChannel: "chrome",
    candidateCount: 1,
    sampleUrls: ["https://pcmap.place.naver.com/restaurant/1790076538/home"],
    profileSetupUrl: "https://map.naver.com/p/entry/place/1790076538",
    recoveryUrl: "https://pcmap.place.naver.com/restaurant/1790076538/home",
    steps: [
      {
        step: "profile_setup",
        purpose: "Prepare profile.",
        argv: ["node", ".\\dist\\cli.js", "auth-login", "--profile", "pcmap.place.naver.com-recovery-profile"],
        powershellCommand: profileSetupPowerShellCommand
      },
      {
        step: "recovery_evidence_run",
        purpose: "Run recovery evidence.",
        argv: ["node", ".\\dist\\cli.js", "evidence-run", "--url", "https://pcmap.place.naver.com/restaurant/1790076538/home"],
        powershellCommand: evidenceRunPowerShellCommand
      }
    ],
    profileSetupArgv: ["node", ".\\dist\\cli.js", "auth-login", "--profile", "pcmap.place.naver.com-recovery-profile"],
    profileSetupPowerShellCommand,
    evidenceRunArgv: ["node", ".\\dist\\cli.js", "evidence-run", "--url", "https://pcmap.place.naver.com/restaurant/1790076538/home"],
    evidenceRunPowerShellCommand,
    commandHints: [profileSetupPowerShellCommand, evidenceRunPowerShellCommand],
    reasons: ["blocked_child_exposes_deeper_candidates", "profile_headed_review_required", "default_depth_2_execution_disabled"]
  };
}

function triageDocument(advice: DestinationBlockedChildRecoveryAdvice): string {
  return `${JSON.stringify(
    {
      schemaVersion: "1.0",
      executionPolicy: "bounded_destination_triage",
      parentUrl: "https://map.example/search",
      summary: { blockedChildRecoveryAdvice: advice }
    },
    null,
    2
  )}\n`;
}

const TRIAGE_RECORD = {
  artifact_id: "triage-text",
  path: "raw/fixture-destination-triage.txt",
  kind: "text",
  format: "txt",
  source_url: "https://map.example/search",
  tool_name: "destination_triage",
  evidence_kind: "destination_triage"
};

// Build a run dir with one valid destination_triage artifact registered in
// artifacts.jsonl. Optionally mutate the advice before writing.
async function makeTriageRunDir(mutate?: (advice: DestinationBlockedChildRecoveryAdvice) => void): Promise<string> {
  const runDir = await makeTempDir("farm-destination-recovery-");
  await mkdir(join(runDir, "raw"), { recursive: true });
  const advice = recoveryAdvice();
  mutate?.(advice);
  await writeFile(join(runDir, "raw", "fixture-destination-triage.txt"), triageDocument(advice), "utf8");
  await writeFile(join(runDir, "artifacts.jsonl"), `${JSON.stringify(TRIAGE_RECORD)}\n`, "utf8");
  return runDir;
}

// Construct an in-memory DestinationRecoveryPlanItem from advice (bypasses build,
// so we can force bad order / whitespace profileName / missing steps).
function makeRecoveryItem(overrides: Partial<DestinationRecoveryPlanItem> = {}, advice: DestinationBlockedChildRecoveryAdvice = recoveryAdvice()): DestinationRecoveryPlanItem {
  return {
    order: 1,
    artifactId: "triage-text",
    artifactPath: "/tmp/x/raw/fixture-destination-triage.txt",
    sourceUrl: "https://map.example/search",
    adviceSource: "artifact_advice",
    synthesized: false,
    profileName: advice.profileName,
    browserChannel: advice.browserChannel,
    storagePolicy: advice.storagePolicy,
    candidateCount: advice.candidateCount,
    sampleUrls: advice.sampleUrls,
    profileSetupUrl: advice.profileSetupUrl,
    recoveryUrl: advice.recoveryUrl,
    advice,
    ...overrides
  };
}

function makePlan(items: DestinationRecoveryPlanItem[]): DestinationRecoveryPlan {
  return {
    schemaVersion: "1.0",
    executionPolicy: "destination_blocked_child_recovery_plan_only",
    runDir: "/tmp/x",
    itemCount: items.length,
    items,
    warnings: []
  };
}

// ===========================================================================
// (a) CLI command via runCli (rendered to --output-file, read back).
// ===========================================================================

describe("destination-recovery-plan CLI", () => {
  it("[SAFE] json format writes recovery plan to --output-file", async () => {
    const runDir = await makeTriageRunDir();
    const outFile = join(runDir, "plan.json");

    const { exitCode } = await runCli(["destination-recovery-plan", "--run-dir", runDir, "--output-file", outFile]);
    const text = await readFile(outFile, "utf8");

    expect(exitCode).toBeFalsy();
    expect(text).toContain('"ok": true');
    expect(text).toContain('"recoveryPlan":');
    expect(text).toContain('"executionPolicy": "destination_blocked_child_recovery_plan_only"');
    expect(text).toContain('"itemCount": 1');
    expect(text).toContain('"profileName": "pcmap.place.naver.com-recovery-profile"');
  });

  it("[SAFE] markdown format renders plan + preflight to --output-file", async () => {
    const runDir = await makeTriageRunDir();
    const outFile = join(runDir, "plan.md");

    const { exitCode } = await runCli(["destination-recovery-plan", "--run-dir", runDir, "--format", "markdown", "--output-file", outFile]);
    const md = await readFile(outFile, "utf8");

    expect(exitCode).toBeFalsy();
    expect(md).toContain("# Destination Blocked Child Recovery Plan");
    expect(md).toContain("## 1. pcmap.place.naver.com-recovery-profile");
    expect(md).toContain("### profile_setup");
    expect(md).toContain("### recovery_evidence_run");
    expect(md).toContain("## Preflight Check");
    expect(md).toContain("- OK: yes");
  });

  it("[SAFE] check format emits preflight check JSON to --output-file", async () => {
    const runDir = await makeTriageRunDir();
    const outFile = join(runDir, "check.json");

    const { exitCode } = await runCli(["destination-recovery-plan", "--run-dir", runDir, "--format", "check", "--output-file", outFile]);
    const text = await readFile(outFile, "utf8");

    expect(exitCode).toBeFalsy();
    expect(text).toContain('"ok": true');
    expect(text).toContain('"check":');
    expect(text).toContain('"executionPolicy": "destination_blocked_child_recovery_plan_check"');
    expect(text).toContain('"errorCount": 0');
  });

  it("[SAFE] commands/setup-commands/retry-commands formats emit powershell lines", async () => {
    const runDir = await makeTriageRunDir();
    const cmds = join(runDir, "cmds.txt");
    const setup = join(runDir, "setup.txt");
    const retry = join(runDir, "retry.txt");

    const r1 = await runCli(["destination-recovery-plan", "--run-dir", runDir, "--format", "commands", "--output-file", cmds]);
    const r2 = await runCli(["destination-recovery-plan", "--run-dir", runDir, "--format", "setup-commands", "--output-file", setup]);
    const r3 = await runCli(["destination-recovery-plan", "--run-dir", runDir, "--format", "retry-commands", "--output-file", retry]);

    expect(r1.exitCode).toBeFalsy();
    expect(r2.exitCode).toBeFalsy();
    expect(r3.exitCode).toBeFalsy();

    const cmdsText = await readFile(cmds, "utf8");
    const setupText = await readFile(setup, "utf8");
    const retryText = await readFile(retry, "utf8");

    expect(cmdsText).toContain("'auth-login' '--profile' 'pcmap.place.naver.com-recovery-profile'");
    expect(cmdsText).toContain("'evidence-run' '--url' 'https://pcmap.place.naver.com/restaurant/1790076538/home'");
    expect(setupText).toContain("'auth-login'");
    expect(setupText).not.toContain("'evidence-run'");
    expect(retryText).toContain("'evidence-run'");
    expect(retryText).not.toContain("'auth-login'");
  });

  it("[SAFE] invalid --format throws and exits 1", async () => {
    const runDir = await makeTriageRunDir();

    const { out, exitCode } = await runCli(["destination-recovery-plan", "--run-dir", runDir, "--format", "bogus"]);

    expect(exitCode).toBe(1);
    expect(out).toContain("--format must be json, check, markdown, commands, setup-commands, or retry-commands for destination-recovery-plan");
  });

  it("[SAFE] missing --run-dir throws required-arg error", async () => {
    const { out, exitCode } = await runCli(["destination-recovery-plan"]);

    expect(exitCode).toBe(1);
    expect(out).toContain("destination-recovery-plan requires --run-dir <evidence-run-dir>");
  });

  it("[SAFE] --fail-empty sets exit code 1 on an empty plan", async () => {
    const emptyRunDir = await makeTempDir("farm-destination-recovery-empty-");
    await writeFile(join(emptyRunDir, "artifacts.jsonl"), "", "utf8");
    const outFile = join(emptyRunDir, "empty.json");

    const { exitCode } = await runCli(["destination-recovery-plan", "--run-dir", emptyRunDir, "--output-file", outFile, "--fail-empty"]);
    const text = await readFile(outFile, "utf8");

    expect(exitCode).toBe(1);
    expect(text).toContain('"itemCount": 0');
    expect(text).toContain('"ok": true');
  });

  it("[SAFE] --fail-check sets exit 1 and --only-check-ok filters failing items", async () => {
    // Build a run dir whose advice is missing the recovery_evidence_run step so
    // the preflight check fails (retry_step_missing).
    const runDir = await makeTriageRunDir((advice) => {
      advice.steps = advice.steps.filter((step) => step.step !== "recovery_evidence_run");
    });

    const failCheckFile = join(runDir, "failcheck.json");
    const { exitCode: failExit } = await runCli(["destination-recovery-plan", "--run-dir", runDir, "--output-file", failCheckFile, "--fail-check"]);
    expect(failExit).toBe(1);

    const onlyOkFile = join(runDir, "onlyok.json");
    const { exitCode: onlyOkExit } = await runCli(["destination-recovery-plan", "--run-dir", runDir, "--output-file", onlyOkFile, "--only-check-ok"]);
    const onlyOkText = await readFile(onlyOkFile, "utf8");

    expect(onlyOkExit).toBeFalsy();
    expect(onlyOkText).toContain('"itemCount": 0');
    expect(onlyOkText).toContain("Recovery plan check filter removed 1 item(s) with preflight errors.");
  });
});

// ===========================================================================
// (b) Direct-API tests.
// ===========================================================================

describe("destination-recovery-plan API", () => {
  it("[SAFE] build skips invalid-JSON triage artifact and dedups identical commands", async () => {
    const runDir = await makeTempDir("farm-destination-recovery-api-dedupe-");
    await mkdir(join(runDir, "raw"), { recursive: true });
    await writeFile(join(runDir, "raw", "bad-destination-triage.txt"), "{ not valid json", "utf8");
    await writeFile(join(runDir, "raw", "good-destination-triage.txt"), triageDocument(recoveryAdvice()), "utf8");
    await writeFile(join(runDir, "raw", "dupe-destination-triage.txt"), triageDocument(recoveryAdvice()), "utf8");
    const lines = [
      { ...TRIAGE_RECORD, artifact_id: "bad", path: "raw/bad-destination-triage.txt" },
      { ...TRIAGE_RECORD, artifact_id: "good", path: "raw/good-destination-triage.txt" },
      { ...TRIAGE_RECORD, artifact_id: "dupe", path: "raw/dupe-destination-triage.txt" }
    ]
      .map((record) => JSON.stringify(record))
      .join("\n");
    await writeFile(join(runDir, "artifacts.jsonl"), `${lines}\n`, "utf8");

    const plan = await buildDestinationRecoveryPlanFromRunDir(runDir);

    expect(plan.itemCount).toBe(1);
    expect(plan.warnings.some((w) => /Skipped invalid destination triage artifact/.test(w))).toBe(true);
  });

  it("[SAFE] manifest skips invalid jsonl line, resolves structured records, and rejects outside-runDir paths", async () => {
    const runDir = await makeTempDir("farm-destination-recovery-api-manifest-");
    await mkdir(join(runDir, "structured"), { recursive: true });
    await writeFile(join(runDir, "structured", "fixture-destination-triage.json"), triageDocument(recoveryAdvice()), "utf8");
    const malformed = "not-json{";
    const escapeRecord = JSON.stringify({
      ...TRIAGE_RECORD,
      artifact_id: "escape",
      kind: "structured",
      format: "json",
      path: "../escape.json"
    });
    const structuredRecord = JSON.stringify({
      ...TRIAGE_RECORD,
      artifact_id: "structured",
      kind: "structured",
      format: "json",
      path: "structured/fixture-destination-triage.json"
    });
    await writeFile(join(runDir, "artifacts.jsonl"), `${malformed}\n${escapeRecord}\n${structuredRecord}\n`, "utf8");

    const plan = await buildDestinationRecoveryPlanFromRunDir(runDir);

    expect(plan.itemCount).toBe(1);
    expect(plan.warnings.some((w) => /Skipped invalid artifacts\.jsonl line/.test(w))).toBe(true);
    expect(plan.warnings.some((w) => /Skipped destination triage artifact outside run dir/.test(w))).toBe(true);
  });

  it("[SAFE] fallback recurses into nested raw subdirectories", async () => {
    const runDir = await makeTempDir("farm-destination-recovery-api-fallback-");
    await mkdir(join(runDir, "raw", "nested"), { recursive: true });
    await writeFile(join(runDir, "raw", "nested", "fixture-destination-triage.txt"), triageDocument(recoveryAdvice()), "utf8");
    await writeFile(join(runDir, "raw", "nested", "unrelated.log"), "noise", "utf8");
    // No artifacts.jsonl -> forces the fallback discovery path.

    const plan = await buildDestinationRecoveryPlanFromRunDir(runDir);

    expect(plan.itemCount).toBe(1);
    expect(plan.warnings.some((w) => /falling back to raw\/structured artifact discovery/.test(w))).toBe(true);
  });

  it("[SAFE] extract returns undefined for advice-less / non-array / partial-candidate summaries", async () => {
    // (1) summary present but no advice and no candidates -> extract returns undefined.
    const noAdviceDir = await makeTempDir("farm-destination-recovery-api-noadvice-");
    await mkdir(join(noAdviceDir, "raw"), { recursive: true });
    await writeFile(join(noAdviceDir, "raw", "fixture-destination-triage.txt"), `${JSON.stringify({ schemaVersion: "1.0", summary: { status: "selected" } }, null, 2)}\n`, "utf8");
    const noAdvicePlan = await buildDestinationRecoveryPlanFromRunDir(noAdviceDir);
    expect(noAdvicePlan.itemCount).toBe(0);
    expect(noAdvicePlan.warnings.some((w) => /No blocked child recovery advice was found under/.test(w))).toBe(true);

    // (2) candidates not an array -> synthesize returns undefined.
    const notArrayDir = await makeTempDir("farm-destination-recovery-api-notarray-");
    await mkdir(join(notArrayDir, "raw"), { recursive: true });
    await writeFile(join(notArrayDir, "raw", "fixture-destination-triage.txt"), `${JSON.stringify({ summary: { blockedChildRecoveryCandidates: "not-an-array" } }, null, 2)}\n`, "utf8");
    const notArrayPlan = await buildDestinationRecoveryPlanFromRunDir(notArrayDir);
    expect(notArrayPlan.itemCount).toBe(0);
    expect(notArrayPlan.warnings.some((w) => /No blocked child recovery advice was found under/.test(w))).toBe(true);

    // (3) candidate array entries fail the type guard (missing required string fields) ->
    // candidates filtered out, first === undefined. Includes a non-record primitive entry
    // to exercise isDestinationBlockedChildRecoveryCandidateSummary non-record branch.
    const partialDir = await makeTempDir("farm-destination-recovery-api-partial-");
    await mkdir(join(partialDir, "raw"), { recursive: true });
    await writeFile(join(partialDir, "raw", "fixture-destination-triage.txt"), `${JSON.stringify({ summary: { blockedChildRecoveryCandidates: [42, { partial: 1 }] } }, null, 2)}\n`, "utf8");
    const partialPlan = await buildDestinationRecoveryPlanFromRunDir(partialDir);
    expect(partialPlan.itemCount).toBe(0);
    expect(partialPlan.warnings.some((w) => /No blocked child recovery advice was found under/.test(w))).toBe(true);
  });

  it("[SAFE] check flags order_mismatch, empty profileName, and missing steps", async () => {
    const brokenAdvice = recoveryAdvice();
    brokenAdvice.steps = []; // no profile_setup, no recovery_evidence_run
    const itemA = makeRecoveryItem({ order: 99, profileName: "   " }, brokenAdvice);
    const plan = makePlan([itemA]);

    const check = checkDestinationRecoveryPlan(plan);
    const codes = check.issues.map((issue) => issue.code);

    expect(check.ok).toBe(false);
    expect(codes).toContain("order_mismatch");
    expect(codes).toContain("profile_name_missing");
    expect(codes).toContain("setup_step_missing");
    expect(codes).toContain("retry_step_missing");
    const orderIssue = check.issues.find((issue) => issue.code === "order_mismatch");
    expect(orderIssue?.message).toBe("Recovery item order 99 should be 1.");

    const emptyCheck = checkDestinationRecoveryPlan({ ...plan, items: [], itemCount: 0 });
    expect(emptyCheck.warningCount).toBe(1);
    expect(emptyCheck.issues).toContainEqual({
      severity: "warning",
      code: "empty_recovery_plan",
      message: "Recovery plan has no blocked-child recovery items."
    });
  });

  it("[SAFE] filter remaps surviving item order to index+1 when one of two items fails", async () => {
    const goodItem = makeRecoveryItem({ order: 1 });
    const brokenAdvice = recoveryAdvice();
    brokenAdvice.steps = []; // produces setup_step_missing / retry_step_missing with itemOrder=2
    const brokenItem = makeRecoveryItem({ order: 2 }, brokenAdvice);
    const plan = makePlan([goodItem, brokenItem]);

    const filtered = filterDestinationRecoveryPlanByCheck(plan);

    expect(filtered.itemCount).toBe(1);
    expect(filtered.items[0]?.order).toBe(1);
    expect(filtered.warnings).toContain("Recovery plan check filter removed 1 item(s) with preflight errors.");
  });

  it("[SAFE] uniquePathItems dedups duplicate manifest paths", async () => {
    const runDir = await makeTempDir("farm-destination-recovery-api-uniquepath-");
    await mkdir(join(runDir, "raw"), { recursive: true });
    await writeFile(join(runDir, "raw", "fixture-destination-triage.txt"), triageDocument(recoveryAdvice()), "utf8");
    const record = JSON.stringify(TRIAGE_RECORD);
    await writeFile(join(runDir, "artifacts.jsonl"), `${record}\n${record}\n`, "utf8");

    const plan = await buildDestinationRecoveryPlanFromRunDir(runDir);

    expect(plan.itemCount).toBe(1);
  });

  it("[SAFE] formatters emit stable output for a built plan", async () => {
    const runDir = await makeTriageRunDir();
    const plan = await buildDestinationRecoveryPlanFromRunDir(runDir);

    const commands = formatDestinationRecoveryPlanCommandsAsLines(plan);
    const markdown = formatDestinationRecoveryPlanMarkdown(plan, checkDestinationRecoveryPlan(plan));

    expect(commands).toContain("'auth-login' '--profile' 'pcmap.place.naver.com-recovery-profile'");
    expect(markdown).toContain("# Destination Blocked Child Recovery Plan");
    expect(markdown).toContain("- OK: yes");
  });
});
