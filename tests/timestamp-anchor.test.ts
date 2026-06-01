import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendAnchor, describeAnchor, timeProofKind, verifyTimestampLog, type AnchorEntry, type TsaClient } from "../src/timestamp-anchor.js";

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function freshLog(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "farm-anchor-log-"));
  dirs.push(dir);
  return join(dir, "transparency-log.ndjson");
}

async function readLines(logPath: string): Promise<string[]> {
  return (await readFile(logPath, "utf8")).split("\n").filter((line) => line.trim().length > 0);
}

describe("timestamp transparency log (D2)", () => {
  it("chains anchored Merkle roots and verifies the whole chain (ordering-only by default)", async () => {
    const logPath = await freshLog();
    const first = await appendAnchor(logPath, { merkleRoot: "root-a", runDir: "/run/a", at: "2026-06-02T00:00:00.000Z", label: "bundle a" });
    const second = await appendAnchor(logPath, { merkleRoot: "root-b", runDir: "/run/b", at: "2026-06-02T00:01:00.000Z" });

    expect(first.seq).toBe(1);
    expect(first.prevHash).toBe("0".repeat(64));
    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(first.entryHash); // chained — proves order
    expect(timeProofKind(first)).toBe("ordering");

    const verdict = await verifyTimestampLog(logPath);
    expect(verdict.ok).toBe(true);
    expect(verdict.entryCount).toBe(2);
    expect(verdict.orderingOnlyCount).toBe(2);
    expect(verdict.tsaAnchoredCount).toBe(0);
    expect(verdict.note).toMatch(/ordering/i);
  });

  it("records a TSA token (when a client is injected) OUTSIDE the chain hash, labeled time-anchored", async () => {
    const logPath = await freshLog();
    const tsaClient: TsaClient = async (entryHash) => ({ token: `TOKEN(${entryHash.slice(0, 8)})`, tsaUrl: "https://tsa.example/tsr", genTime: "2026-06-02T00:00:01.000Z" });
    const entry = await appendAnchor(logPath, { merkleRoot: "root-tsa", at: "2026-06-02T00:00:00.000Z" }, tsaClient);

    expect(entry.tsa?.token).toBe(`TOKEN(${entry.entryHash.slice(0, 8)})`); // token is over the entry hash
    expect(timeProofKind(entry)).toBe("tsa");
    expect(describeAnchor(entry)).toMatch(/openssl ts -verify/);

    const verdict = await verifyTimestampLog(logPath);
    expect(verdict.ok).toBe(true); // chain still verifies — tsa lives outside the hash
    expect(verdict.tsaAnchoredCount).toBe(1);
    expect(verdict.note).toMatch(/NOT cryptographically verified here/);
  });

  it("treats a stripped TSA token as a graceful downgrade (chain stays valid, label falls back to ordering)", async () => {
    const logPath = await freshLog();
    const tsaClient: TsaClient = async () => ({ token: "TOKEN", tsaUrl: "https://tsa.example/tsr" });
    await appendAnchor(logPath, { merkleRoot: "root-x", at: "2026-06-02T00:00:00.000Z" }, tsaClient);

    // Strip the tsa field (a tamperer can only WEAKEN the time claim, never forge one).
    const lines = await readLines(logPath);
    const entry = JSON.parse(lines[0] as string) as AnchorEntry;
    delete entry.tsa;
    await writeFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");

    const verdict = await verifyTimestampLog(logPath);
    expect(verdict.ok).toBe(true); // chain integrity intact
    expect(verdict.tsaAnchoredCount).toBe(0); // downgraded to ordering
    expect(timeProofKind(entry)).toBe("ordering");
  });

  it("detects a tampered Merkle root", async () => {
    const logPath = await freshLog();
    await appendAnchor(logPath, { merkleRoot: "root-a", at: "2026-06-02T00:00:00.000Z" });
    await appendAnchor(logPath, { merkleRoot: "root-b", at: "2026-06-02T00:01:00.000Z" });

    const lines = await readLines(logPath);
    const tampered = JSON.parse(lines[0] as string) as AnchorEntry;
    tampered.merkleRoot = "root-FORGED";
    lines[0] = JSON.stringify(tampered);
    await writeFile(logPath, `${lines.join("\n")}\n`, "utf8");

    const verdict = await verifyTimestampLog(logPath);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAt).toBe(1);
    expect(verdict.reason).toMatch(/tampered/);
  });

  it("detects a removed (reordered) anchor", async () => {
    const logPath = await freshLog();
    await appendAnchor(logPath, { merkleRoot: "root-a", at: "2026-06-02T00:00:00.000Z" });
    await appendAnchor(logPath, { merkleRoot: "root-b", at: "2026-06-02T00:01:00.000Z" });

    const lines = await readLines(logPath);
    await writeFile(logPath, `${lines[1]}\n`, "utf8"); // drop the first; second now points at a missing prevHash

    const verdict = await verifyTimestampLog(logPath);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/sequence|prevHash/);
  });

  it("verifies an empty / missing log as ok with zero entries", async () => {
    const logPath = await freshLog();
    const verdict = await verifyTimestampLog(logPath);
    expect(verdict.ok).toBe(true);
    expect(verdict.entryCount).toBe(0);
  });
});
