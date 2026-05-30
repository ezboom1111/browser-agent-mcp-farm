import { describe, expect, it } from "vitest";
import { LeaseManager } from "../src/lease-manager.js";

describe("LeaseManager", () => {
  it("acquires, heartbeats, and releases a lease", () => {
    let now = new Date("2026-05-25T00:00:00.000Z");
    const manager = new LeaseManager({ now: () => now });
    const lease = manager.acquire({
      agentId: "agent-a",
      runId: "run-1",
      artifactRunDir: "run-dir",
      ttlMs: 1_000,
      maxPages: 1,
      allowedDomains: ["example.com"]
    });

    expect(lease.status).toBe("active");
    now = new Date("2026-05-25T00:00:00.500Z");
    const heartbeat = manager.heartbeat(lease.contextToken, "agent-a");
    expect(Date.parse(heartbeat.expiresAt)).toBe(Date.parse("2026-05-25T00:00:01.500Z"));

    const released = manager.release(lease.contextToken, "agent-a");
    expect(released.status).toBe("released");
  });

  it("rejects agent ownership mismatch", () => {
    const manager = new LeaseManager();
    const lease = manager.acquire({
      agentId: "agent-a",
      runId: "run-1",
      artifactRunDir: "run-dir"
    });

    expect(() => manager.heartbeat(lease.contextToken, "agent-b")).toThrow(/not owned/);
  });

  it("expires and reaps stale leases", () => {
    let now = new Date("2026-05-25T00:00:00.000Z");
    const manager = new LeaseManager({ now: () => now });
    const lease = manager.acquire({
      agentId: "agent-a",
      runId: "run-1",
      artifactRunDir: "run-dir",
      ttlMs: 1
    });

    now = new Date("2026-05-25T00:00:00.002Z");
    const expired = manager.reapExpired();
    expect(expired.map((item) => item.contextToken)).toContain(lease.contextToken);
    expect(manager.list().find((item) => item.contextToken === lease.contextToken)?.status).toBe("expired");
  });

  it("enforces domain allowlist and max pages", () => {
    const manager = new LeaseManager();
    const lease = manager.acquire({
      agentId: "agent-a",
      runId: "run-1",
      artifactRunDir: "run-dir",
      allowedDomains: ["example.com"],
      maxPages: 1
    });

    expect(() => manager.assertCanOpen(lease.contextToken, "agent-a", "https://evil.test/")).toThrow(/not allowed/);
    manager.registerPage(lease.contextToken, "agent-a", "page-1", "https://example.com/");
    expect(() => manager.assertCanOpen(lease.contextToken, "agent-a", "https://example.com/next")).toThrow(/page limit/);
  });
});
