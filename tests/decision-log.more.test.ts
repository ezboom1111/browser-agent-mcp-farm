import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendDecision, verifyDecisionLog } from "../src/decision-log.js";

const GENESIS = "0".repeat(64);

async function freshLog(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "decision-log-"));
  return join(dir, "decisions.ndjson");
}

describe("appendDecision / verifyDecisionLog", () => {
  it("chains entries: genesis prevHash, incrementing seq, linked hashes", async () => {
    const log = await freshLog();
    const e1 = await appendDecision(log, { runDir: "/r", ok: true, claimCount: 3, errorCount: 0, at: "2026-01-01T00:00:00Z" });
    expect(e1.seq).toBe(1);
    expect(e1.prevHash).toBe(GENESIS);
    expect(e1.entryHash).toMatch(/^[0-9a-f]{64}$/);

    const e2 = await appendDecision(log, { runDir: "/r", ok: false, claimCount: 2, errorCount: 1, at: "2026-01-01T00:01:00Z", mode: "strict" });
    expect(e2.seq).toBe(2);
    expect(e2.prevHash).toBe(e1.entryHash);

    expect(await verifyDecisionLog(log)).toEqual({ ok: true, entryCount: 2 });
  });

  it("verifies an empty / missing log as ok with zero entries", async () => {
    expect(await verifyDecisionLog(await freshLog())).toEqual({ ok: true, entryCount: 0 });
  });

  it("detects a tampered entry (entryHash no longer matches the fields)", async () => {
    const log = await freshLog();
    await appendDecision(log, { runDir: "/r", ok: true, claimCount: 1, errorCount: 0, at: "2026-01-01T00:00:00Z" });
    const tampered = JSON.parse(await readFile(log, "utf8"));
    tampered.claimCount = 999; // change a hashed field, keep the old entryHash
    await writeFile(log, `${JSON.stringify(tampered)}\n`, "utf8");

    const v = await verifyDecisionLog(log);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
    expect(v.reason).toContain("tampered");
  });

  it("detects a broken prevHash chain when an entry is removed", async () => {
    const log = await freshLog();
    await appendDecision(log, { runDir: "/r", ok: true, claimCount: 1, errorCount: 0, at: "t1" });
    const e2 = await appendDecision(log, { runDir: "/r", ok: true, claimCount: 1, errorCount: 0, at: "t2" });
    // drop entry 1, keep only entry 2 -> its seq (2) is out of order at the head
    await writeFile(log, `${JSON.stringify(e2)}\n`, "utf8");
    const v = await verifyDecisionLog(log);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("sequence");
  });
});
