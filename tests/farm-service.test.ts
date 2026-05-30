import { describe, expect, it } from "vitest";
import { FarmService } from "../src/farm-service.js";

describe("FarmService secret redaction", () => {
  it("redacts proxy credentials and absolute profile paths from acquireContext", () => {
    const service = new FarmService();
    const { lease } = service.acquireContext({
      agentId: "a",
      runId: "r",
      artifactRunDir: "/tmp/run",
      storagePolicy: "persistent-profile",
      userDataDir: "/home/secretuser/profile/user-data",
      proxy: { server: "http://puser:ppass@proxy.example:8080", username: "puser", password: "ppass" }
    });

    expect(lease.proxy?.password).toBe("***");
    expect(lease.proxy?.username).toBe("***");
    expect(lease.proxy?.server).not.toContain("ppass");
    expect(lease.userDataDir).toBe("[redacted path]");
    // No secret value or absolute profile path bytes survive into the tool result.
    const serialized = JSON.stringify(lease);
    expect(serialized).not.toContain("ppass");
    expect(serialized).not.toContain("secretuser");
  });

  it("redacts secrets from listLeases output", () => {
    const service = new FarmService();
    service.acquireContext({
      agentId: "a",
      runId: "r",
      artifactRunDir: "/tmp/run",
      proxy: { server: "http://proxy.example:1", password: "topsecret" }
    });

    const { leases } = service.listLeases();
    expect(JSON.stringify(leases)).not.toContain("topsecret");
  });
});
