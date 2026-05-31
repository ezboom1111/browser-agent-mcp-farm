import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeaseManager, externalBridgeEnabled } from "../src/lease-manager.js";
import { FarmService } from "../src/farm-service.js";

// B3 (v0.5.0): the external-bridge "caged" tier. OFF by default; when enabled it is forced read-only,
// requires a non-empty domain allow-list, and rejects every credential/identity field. The
// deterministic gate remains the trust boundary — this only fences where a caged capturer may go.

const ENV_KEY = "FARM_ENABLE_EXTERNAL_BRIDGE";
let saved: string | undefined;
beforeEach(() => {
  saved = process.env[ENV_KEY];
});
afterEach(() => {
  if (saved === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = saved;
  }
});

function base(extra: Record<string, unknown> = {}) {
  return { agentId: "a", runId: "r", artifactRunDir: "/tmp/run", storagePolicy: "external-bridge" as const, allowedDomains: ["example.com"], ...extra };
}

describe("external-bridge tier (B3)", () => {
  it("is off by default: acquire rejects unless FARM_ENABLE_EXTERNAL_BRIDGE === '1'", () => {
    delete process.env[ENV_KEY];
    expect(externalBridgeEnabled()).toBe(false);
    expect(() => new LeaseManager().acquire(base())).toThrow(/disabled|FARM_ENABLE_EXTERNAL_BRIDGE/i);

    for (const bad of ["0", "true", "yes", " 1", ""]) {
      process.env[ENV_KEY] = bad;
      expect(externalBridgeEnabled()).toBe(false);
      expect(() => new LeaseManager().acquire(base())).toThrow(/disabled/i);
    }
  });

  describe("when enabled", () => {
    beforeEach(() => {
      process.env[ENV_KEY] = "1";
    });

    it("forces read-only and clamps the ttl to <= 5 minutes", () => {
      const lease = new LeaseManager().acquire(base({ capability: "read-write", ttlMs: 30 * 60_000 }));
      expect(lease.capability).toBe("read-only");
      expect(lease.ttlMs).toBeLessThanOrEqual(300_000);
      expect(lease.storagePolicy).toBe("external-bridge");
    });

    it("requires a non-empty domain allow-list", () => {
      expect(() => new LeaseManager().acquire(base({ allowedDomains: [] }))).toThrow(/requires.*allowedDomains|allow-list/i);
    });

    it("rejects every credential / identity field", () => {
      const mgr = new LeaseManager();
      const rejected = /zero credentials\/identity/i;
      expect(() => mgr.acquire(base({ proxy: { server: "http://p:1" } }))).toThrow(rejected);
      expect(() => mgr.acquire(base({ profileName: "p" }))).toThrow(rejected);
      expect(() => mgr.acquire(base({ storageStatePath: "/x" }))).toThrow(rejected);
      expect(() => mgr.acquire(base({ userDataDir: "/x" }))).toThrow(rejected);
      expect(() => mgr.acquire(base({ fingerprint: { userAgent: "UA" } }))).toThrow(rejected);
    });

    it("takes no profile lock (disposable) and navigates only within its fence", () => {
      const mgr = new LeaseManager();
      const lease = mgr.acquire(base());
      expect(() => mgr.assertCanOpen(lease.contextToken, "a", "https://example.com/x")).not.toThrow();
      expect(() => mgr.assertCanOpen(lease.contextToken, "a", "https://evil.test/x")).toThrow(/not allowed/i);
    });
  });

  it("capabilities() reports externalBridgeEnabled reflecting the env", () => {
    delete process.env[ENV_KEY];
    expect(new FarmService().capabilities().externalBridgeEnabled).toBe(false);
    process.env[ENV_KEY] = "1";
    expect(new FarmService().capabilities().externalBridgeEnabled).toBe(true);
  });
});
