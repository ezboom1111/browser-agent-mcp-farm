import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendDecision, verifyDecisionLog, type DecisionEntry } from "../src/decision-log.js";

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function freshLog(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "farm-decision-log-"));
  dirs.push(dir);
  return join(dir, "decisions.jsonl");
}

describe("decision log", () => {
  it("chains appended verdicts and verifies the whole chain", async () => {
    const logPath = await freshLog();
    const first = await appendDecision(logPath, { runDir: "/run/a", ok: true, claimCount: 3, errorCount: 0, at: "2026-05-30T00:00:00.000Z", mode: "final" });
    const second = await appendDecision(logPath, { runDir: "/run/b", ok: false, claimCount: 1, errorCount: 2, at: "2026-05-30T00:01:00.000Z", mode: "final" });

    expect(first.seq).toBe(1);
    expect(first.prevHash).toBe("0".repeat(64));
    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(first.entryHash); // chained

    const verdict = await verifyDecisionLog(logPath);
    expect(verdict).toEqual({ ok: true, entryCount: 2 });
  });

  it("detects a tampered historical verdict", async () => {
    const logPath = await freshLog();
    await appendDecision(logPath, { runDir: "/run/a", ok: false, claimCount: 0, errorCount: 5, at: "2026-05-30T00:00:00.000Z" });
    await appendDecision(logPath, { runDir: "/run/b", ok: true, claimCount: 4, errorCount: 0, at: "2026-05-30T00:01:00.000Z" });

    // Flip the first verdict ok=false -> ok=true without recomputing its hash.
    const lines = (await readFile(logPath, "utf8")).split("\n").filter((line) => line.trim().length > 0);
    const tampered = JSON.parse(lines[0] as string) as DecisionEntry;
    tampered.ok = true;
    lines[0] = JSON.stringify(tampered);
    await writeFile(logPath, `${lines.join("\n")}\n`, "utf8");

    const verdict = await verifyDecisionLog(logPath);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAt).toBe(1);
    expect(verdict.reason).toMatch(/tampered/);
  });

  it("detects a broken chain link", async () => {
    const logPath = await freshLog();
    await appendDecision(logPath, { runDir: "/run/a", ok: true, claimCount: 1, errorCount: 0, at: "2026-05-30T00:00:00.000Z" });
    await appendDecision(logPath, { runDir: "/run/b", ok: true, claimCount: 1, errorCount: 0, at: "2026-05-30T00:01:00.000Z" });

    // Remove the first entry, leaving the second pointing at a now-missing prevHash.
    const lines = (await readFile(logPath, "utf8")).split("\n").filter((line) => line.trim().length > 0);
    await writeFile(logPath, `${lines[1]}\n`, "utf8");

    const verdict = await verifyDecisionLog(logPath);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/sequence|prevHash/);
  });

  it("verifies an empty / missing log as ok with zero entries", async () => {
    const logPath = await freshLog();
    expect(await verifyDecisionLog(logPath)).toEqual({ ok: true, entryCount: 0 });
  });
});
