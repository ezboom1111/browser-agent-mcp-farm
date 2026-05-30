import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDestinationRecoveryPlanFromRunDir, checkDestinationRecoveryPlan, filterDestinationRecoveryPlanByCheck, formatDestinationRecoveryPlanCommandsAsLines, formatDestinationRecoveryPlanMarkdown } from "../src/destination-recovery-plan.js";
import type { DestinationBlockedChildRecoveryAdvice } from "../src/destination-triage.js";

describe("destination recovery plan", () => {
  it("extracts blocked-child recovery advice from destination triage artifacts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-destination-recovery-plan-"));
    await mkdir(join(runDir, "raw"), { recursive: true });
    const triagePath = join(runDir, "raw", "fixture-destination-triage.txt");
    const advice = recoveryAdvice();
    await writeFile(
      triagePath,
      `${JSON.stringify(
        {
          schemaVersion: "1.0",
          executionPolicy: "bounded_destination_triage",
          parentUrl: "https://map.example/search",
          summary: {
            blockedChildRecoveryAdvice: advice
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      join(runDir, "artifacts.jsonl"),
      `${JSON.stringify({
        artifact_id: "triage-text",
        path: "raw/fixture-destination-triage.txt",
        kind: "text",
        format: "txt",
        source_url: "https://map.example/search",
        tool_name: "destination_triage",
        evidence_kind: "destination_triage"
      })}\n`,
      "utf8"
    );

    const plan = await buildDestinationRecoveryPlanFromRunDir(runDir);
    const commands = formatDestinationRecoveryPlanCommandsAsLines(plan);
    const setupCommands = formatDestinationRecoveryPlanCommandsAsLines(plan, "setup-commands");
    const retryCommands = formatDestinationRecoveryPlanCommandsAsLines(plan, "retry-commands");
    const markdown = formatDestinationRecoveryPlanMarkdown(plan);

    expect(plan).toMatchObject({
      schemaVersion: "1.0",
      executionPolicy: "destination_blocked_child_recovery_plan_only",
      itemCount: 1,
      items: [
        {
          order: 1,
          artifactId: "triage-text",
          sourceUrl: "https://map.example/search",
          adviceSource: "artifact_advice",
          synthesized: false,
          profileName: "pcmap.place.naver.com-recovery-profile",
          profileSetupUrl: "https://map.naver.com/p/entry/place/1790076538",
          recoveryUrl: "https://pcmap.place.naver.com/restaurant/1790076538/home"
        }
      ]
    });
    expect(commands).toContain("'auth-login' '--profile' 'pcmap.place.naver.com-recovery-profile'");
    expect(commands).toContain("'evidence-run' '--url' 'https://pcmap.place.naver.com/restaurant/1790076538/home'");
    expect(setupCommands).toContain("'auth-login'");
    expect(setupCommands).not.toContain("'evidence-run'");
    expect(retryCommands).not.toContain("'auth-login'");
    expect(retryCommands).toContain("'evidence-run'");
    expect(markdown).toContain("# Destination Blocked Child Recovery Plan");
    expect(markdown).toContain("## 1. pcmap.place.naver.com-recovery-profile");
    expect(markdown).toContain("- Advice source: artifact_advice");
    expect(markdown).toContain("### profile_setup");
    expect(markdown).toContain("### recovery_evidence_run");
  });

  it("checks recovery command shape and optional profile readiness", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-destination-recovery-check-"));
    await mkdir(join(runDir, "raw"), { recursive: true });
    await writeFile(
      join(runDir, "raw", "fixture-destination-triage.txt"),
      `${JSON.stringify(
        {
          schemaVersion: "1.0",
          executionPolicy: "bounded_destination_triage",
          summary: {
            blockedChildRecoveryAdvice: recoveryAdvice()
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const plan = await buildDestinationRecoveryPlanFromRunDir(runDir);
    const okCheck = checkDestinationRecoveryPlan(plan, {
      profileExists: (profileName) => profileName === "pcmap.place.naver.com-recovery-profile"
    });
    const missingProfileCheck = checkDestinationRecoveryPlan(plan, {
      profileExists: () => false
    });
    const filtered = filterDestinationRecoveryPlanByCheck(plan, {
      profileExists: () => false
    });
    const okMarkdown = formatDestinationRecoveryPlanMarkdown(plan, okCheck);
    const missingProfileMarkdown = formatDestinationRecoveryPlanMarkdown(plan, missingProfileCheck);

    expect(okCheck).toMatchObject({
      ok: true,
      itemCount: 1,
      errorCount: 0,
      executionPolicy: "destination_blocked_child_recovery_plan_check"
    });
    expect(okCheck.warnings).toContain("Saved browser profile existence was checked for this run.");
    expect(missingProfileCheck).toMatchObject({
      ok: false,
      errorCount: 1,
      issues: [
        expect.objectContaining({
          severity: "error",
          code: "profile_missing",
          itemOrder: 1,
          profileName: "pcmap.place.naver.com-recovery-profile"
        })
      ]
    });
    expect(filtered).toMatchObject({
      itemCount: 0,
      warnings: expect.arrayContaining(["Recovery plan check filter removed 1 item(s) with preflight errors."])
    });
    expect(okMarkdown).toContain("## Preflight Check");
    expect(okMarkdown).toContain("- OK: yes");
    expect(okMarkdown).toContain("No preflight check issues were found.");
    expect(missingProfileMarkdown).toContain("- OK: no");
    expect(missingProfileMarkdown).toContain("`profile_missing` item 1 profile `pcmap.place.naver.com-recovery-profile`");
  });

  it("reports command shape errors", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-destination-recovery-broken-"));
    await mkdir(join(runDir, "raw"), { recursive: true });
    const advice = recoveryAdvice();
    advice.steps = advice.steps.map((step) => (step.step === "recovery_evidence_run" ? { ...step, powershellCommand: "'node' '.\\dist\\cli.js' 'evidence-run' '--url' 'https://pcmap.place.naver.com/restaurant/1790076538/home'" } : step));
    await writeFile(
      join(runDir, "raw", "fixture-destination-triage.txt"),
      `${JSON.stringify(
        {
          schemaVersion: "1.0",
          executionPolicy: "bounded_destination_triage",
          summary: {
            blockedChildRecoveryAdvice: advice
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const check = checkDestinationRecoveryPlan(await buildDestinationRecoveryPlanFromRunDir(runDir));

    expect(check.ok).toBe(false);
    expect(check.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["retry_command_missing_headed", "retry_command_missing_browser_channel_flag", "retry_command_missing_profile_flag", "retry_command_missing_persistent_profile"]));
  });

  it("falls back to raw artifact discovery when the ledger is missing", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-destination-recovery-fallback-"));
    await mkdir(join(runDir, "raw"), { recursive: true });
    await writeFile(
      join(runDir, "raw", "fixture-destination-triage.txt"),
      `${JSON.stringify(
        {
          schemaVersion: "1.0",
          executionPolicy: "bounded_destination_triage",
          summary: {
            blockedChildRecoveryAdvice: recoveryAdvice()
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const plan = await buildDestinationRecoveryPlanFromRunDir(runDir);

    expect(plan.itemCount).toBe(1);
    expect(plan.warnings).toEqual(expect.arrayContaining([expect.stringContaining("falling back to raw/structured artifact discovery")]));
  });

  it("synthesizes recovery advice from older triage artifacts with only recovery candidates", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-destination-recovery-synthesized-"));
    await mkdir(join(runDir, "raw"), { recursive: true });
    await writeFile(
      join(runDir, "raw", "fixture-destination-triage.txt"),
      `\uFEFF${JSON.stringify(
        {
          schemaVersion: "1.0",
          executionPolicy: "bounded_destination_triage",
          summary: {
            blockedChildRecoveryCandidateCount: 2,
            blockedChildRecoveryCandidates: [
              {
                sourceCandidateId: "destination-candidate-1",
                actionKey: "destination-followup",
                childUrl: "https://map.naver.com/p/entry/place/1790076538",
                childUsefulness: "blocked",
                url: "https://pcmap.place.naver.com/restaurant/1790076538/home?from=map",
                domain: "pcmap.place.naver.com",
                candidateKind: "map_place",
                visibleText: "Naver Place home",
                warnings: ["proposal_only_not_executed"]
              },
              {
                sourceCandidateId: "destination-candidate-1",
                actionKey: "destination-followup",
                childUrl: "https://map.naver.com/p/entry/place/1790076538",
                childUsefulness: "blocked",
                url: "https://pcmap.place.naver.com/restaurant/1790076538/review",
                domain: "pcmap.place.naver.com",
                candidateKind: "review",
                visibleText: "Naver Place reviews",
                warnings: ["proposal_only_not_executed"]
              }
            ]
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const plan = await buildDestinationRecoveryPlanFromRunDir(runDir);
    const check = checkDestinationRecoveryPlan(plan);
    const commands = formatDestinationRecoveryPlanCommandsAsLines(plan);

    expect(plan).toMatchObject({
      itemCount: 1,
      items: [
        {
          adviceSource: "recovery_candidates",
          synthesized: true,
          profileName: "pcmap.place.naver.com-recovery-profile",
          candidateCount: 2,
          profileSetupUrl: "https://map.naver.com/p/entry/place/1790076538",
          recoveryUrl: "https://pcmap.place.naver.com/restaurant/1790076538/home?from=map",
          advice: {
            recommendedAction: "profile_headed_retry",
            sampleUrls: ["https://pcmap.place.naver.com/restaurant/1790076538/home?from=map", "https://pcmap.place.naver.com/restaurant/1790076538/review"]
          }
        }
      ],
      warnings: expect.arrayContaining([expect.stringContaining("Synthesized blocked child recovery advice")])
    });
    expect(commands).toContain("'auth-login' '--profile' 'pcmap.place.naver.com-recovery-profile'");
    expect(commands).toContain("'evidence-run' '--url' 'https://pcmap.place.naver.com/restaurant/1790076538/home?from=map'");
    expect(formatDestinationRecoveryPlanMarkdown(plan)).toContain("- Advice source: recovery_candidates (synthesized)");
    expect(check.ok).toBe(true);
  });

  it("reports an empty recovery plan when no advice is present", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-destination-recovery-empty-"));
    await writeFile(join(runDir, "artifacts.jsonl"), "", "utf8");

    const plan = await buildDestinationRecoveryPlanFromRunDir(runDir);

    expect(plan.itemCount).toBe(0);
    expect(formatDestinationRecoveryPlanCommandsAsLines(plan)).toBe("");
    expect(formatDestinationRecoveryPlanMarkdown(plan)).toContain("No blocked child recovery advice was found.");
  });
});

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
