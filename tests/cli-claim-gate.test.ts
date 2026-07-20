import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FarmService } from "../src/farm-service.js";
import { makeRun, runCli, trackTempDirs } from "./helpers/cli-harness.js";

const { dirs, cleanup } = trackTempDirs();

afterEach(cleanup);

// Reads the registered text artifact's id from a run dir's artifacts.jsonl so a claim
// can cite a genuinely registered, hash-verified artifact (cite-or-fail happy path).
async function textArtifactId(runDir: string): Promise<string> {
  const raw = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
  const records = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const textRecord = records.find((r) => r.kind === "text");
  if (textRecord === undefined) {
    throw new Error("no text artifact found in run");
  }
  return String(textRecord.artifact_id);
}

describe("cli claim-gate command", () => {
  it("requires --run-dir (arg-validation throw, exit 1)", async () => {
    const { out, exitCode } = await runCli(["claim-gate"]);
    expect(out).toContain("claim-gate requires --run-dir <path>");
    expect(exitCode).toBe(1);
  });

  it("rejects a negative --min-claims", async () => {
    const runDir = await makeRun(dirs);
    const { out, exitCode } = await runCli(["claim-gate", "--run-dir", runDir, "--min-claims", "-1"]);
    expect(out).toContain("claim-gate --min-claims must be a non-negative integer");
    expect(exitCode).toBe(1);
  });

  it("rejects a non-integer --min-claims", async () => {
    const runDir = await makeRun(dirs);
    const { out, exitCode } = await runCli(["claim-gate", "--run-dir", runDir, "--min-claims", "abc"]);
    expect(out).toContain("claim-gate --min-claims must be a non-negative integer");
    expect(exitCode).toBe(1);
  });

  it("passes (smoke default) with zero claims and prints the result JSON", async () => {
    const runDir = await makeRun(dirs);
    const { out, exitCode } = await runCli(["claim-gate", "--run-dir", runDir]);
    expect(out).toContain('"ok": true');
    expect(out).toContain('"artifacts": 2');
    expect(out).toContain('"claims": 0');
    expect(out).toContain('"citations": 0');
    expect(out).toContain("no claims were present for claim-gate validation");
    expect(exitCode).toBeFalsy();
  });

  it("passes with a claim that cites a registered, hash-verified artifact", async () => {
    const runDir = await makeRun(dirs);
    const evidence = await textArtifactId(runDir);
    await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify({ claim_id: "claim-1", claim: "Supported", evidence })}\n`, "utf8");
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: "claim-1", evidence })}\n`, "utf8");
    const { out, exitCode } = await runCli(["claim-gate", "--run-dir", runDir]);
    expect(out).toContain('"ok": true');
    expect(out).toContain('"claims": 1');
    expect(out).toContain('"citations": 1');
    expect(out).not.toContain("not registered");
    expect(exitCode).toBeFalsy();
  });

  it("fails on an unregistered citation and exits 1", async () => {
    const runDir = await makeRun(dirs);
    await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify({ claim_id: "claim-1", claim: "Unsupported", evidence: "raw/missing.html" })}\n`, "utf8");
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: "claim-1", evidence: "raw/missing.html" })}\n`, "utf8");
    const { out, exitCode } = await runCli(["claim-gate", "--run-dir", runDir]);
    expect(out).toContain('"ok": false');
    expect(out).toContain("not registered");
    expect(exitCode).toBe(1);
  });

  it("--mode final with zero claims fails (min-claims default 1) and exits 1", async () => {
    const runDir = await makeRun(dirs);
    const { out, exitCode } = await runCli(["claim-gate", "--run-dir", runDir, "--mode", "final"]);
    expect(out).toContain('"ok": false');
    expect(out).toContain("claim count below required minimum for final mode: 0 < 1");
    expect(exitCode).toBe(1);
  });

  it("--min-claims 0 overrides the final-mode floor and passes a zero-claim final run", async () => {
    const runDir = await makeRun(dirs);
    const { out, exitCode } = await runCli(["claim-gate", "--run-dir", runDir, "--mode", "final", "--min-claims", "0"]);
    expect(out).toContain('"ok": true');
    expect(out).toContain("no claims were present for claim-gate validation");
    expect(exitCode).toBeFalsy();
  });

  it("--strict-provenance turns an agent-authored structured_data citation from a warning into a hard error", async () => {
    const runDir = await makeRun(dirs);
    const service = new FarmService();
    const reg = await service.registerEvidence({
      runDir,
      sourceUrl: "https://api.example.org/v1/stats",
      text: '{"viewCount": "658078"}',
      evidenceKind: "structured_data"
    });
    const artifactId = reg.artifactId as string;
    await appendFile(
      join(runDir, "claims.jsonl"),
      `${JSON.stringify({
        schema_version: "1.0",
        claim_id: "structured-1",
        claim_type: "metadata",
        claim: "A typed figure read from structured data.",
        artifact_id: artifactId,
        evidence: artifactId,
        evidence_kind: "structured_data",
        verification_level: "structured",
        anchor: { type: "text_span", quote: '"viewCount": "658078"' }
      })}\n`
    );
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: "structured-1", evidence: artifactId, artifact_id: artifactId, evidence_kind: "structured_data" })}\n`);

    const warnOnly = await runCli(["claim-gate", "--run-dir", runDir, "--mode", "final"]);
    expect(warnOnly.out).toContain('"ok": true');
    expect(warnOnly.out).toContain("agent-authored");
    expect(warnOnly.exitCode).toBeFalsy();

    const strict = await runCli(["claim-gate", "--run-dir", runDir, "--mode", "final", "--strict-provenance"]);
    expect(strict.out).toContain('"ok": false');
    expect(strict.out).toContain("agent-authored");
    expect(strict.exitCode).toBe(1);
  });

  it("--decision-log appends a hash-chained verdict that verify-decision-log accepts", async () => {
    const runDir = await makeRun(dirs);
    const logFile = join(runDir, "decisions.jsonl");
    const gate = await runCli(["claim-gate", "--run-dir", runDir, "--decision-log", logFile]);
    expect(gate.out).toContain('"ok": true');

    const logRaw = await readFile(logFile, "utf8");
    const entries = logRaw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.seq).toBe(1);
    expect(entries[0]!.prevHash).toBe("0".repeat(64));
    expect(entries[0]!.mode).toBe("smoke");
    expect(entries[0]!.ok).toBe(true);
    expect(entries[0]!.claimCount).toBe(0);
    expect(String(entries[0]!.entryHash)).toMatch(/^[0-9a-f]{64}$/);

    const verified = await runCli(["verify-decision-log", "--log-file", logFile]);
    expect(verified.out).toContain('"ok": true');
    expect(verified.out).toContain('"entryCount": 1');
    expect(verified.exitCode).toBeFalsy();
  });

  it("--decision-log records a failing verdict and chains a second entry", async () => {
    const runDir = await makeRun(dirs);
    await appendFile(join(runDir, "claims.jsonl"), `${JSON.stringify({ claim_id: "claim-1", claim: "Unsupported", evidence: "raw/missing.html" })}\n`, "utf8");
    await appendFile(join(runDir, "citations.jsonl"), `${JSON.stringify({ claim_id: "claim-1", evidence: "raw/missing.html" })}\n`, "utf8");
    const logFile = join(runDir, "decisions.jsonl");

    const first = await runCli(["claim-gate", "--run-dir", runDir, "--decision-log", logFile]);
    expect(first.out).toContain('"ok": false');
    expect(first.exitCode).toBe(1);

    const second = await runCli(["claim-gate", "--run-dir", runDir, "--decision-log", logFile]);
    expect(second.exitCode).toBe(1);

    const logRaw = await readFile(logFile, "utf8");
    const entries = logRaw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.ok).toBe(false);
    expect(Number(entries[0]!.errorCount)).toBeGreaterThanOrEqual(1);
    expect(entries[1]!.prevHash).toBe(entries[0]!.entryHash);

    const verified = await runCli(["verify-decision-log", "--log-file", logFile]);
    expect(verified.out).toContain('"ok": true');
  });
});
