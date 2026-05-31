import { describe, expect, it } from "vitest";
import { LeaseManager, assertDomainAllowed, isCredentialedStoragePolicy } from "../src/lease-manager.js";

// B1a (v0.5.0): a credentialed lease (storage-state / persistent-profile) carries a real cookie jar,
// so an EMPTY allowedDomains allow-list fails closed at navigation time — an empty allow-list on a
// credentialed session is the exfil path. An ephemeral lease keeps allow-all on empty.

describe("isCredentialedStoragePolicy (B1a)", () => {
  it("classifies storage-state and persistent-profile as credentialed; ephemeral is not", () => {
    expect(isCredentialedStoragePolicy("storage-state")).toBe(true);
    expect(isCredentialedStoragePolicy("persistent-profile")).toBe(true);
    expect(isCredentialedStoragePolicy("ephemeral")).toBe(false);
  });
});

describe("assertDomainAllowed fail-closed for credentialed leases (B1a)", () => {
  it("allows any origin for an ephemeral lease with an empty allow-list (unchanged)", () => {
    expect(() => assertDomainAllowed([], "https://anything.example/x", "ephemeral")).not.toThrow();
    expect(() => assertDomainAllowed([], "https://anything.example/x")).not.toThrow(); // default ephemeral
  });

  it("THROWS for a credentialed lease with an empty allow-list", () => {
    expect(() => assertDomainAllowed([], "https://anything.example/x", "storage-state")).toThrow(/non-empty allowedDomains/i);
    expect(() => assertDomainAllowed([], "https://anything.example/x", "persistent-profile")).toThrow(/non-empty allowedDomains/i);
  });

  it("allows an in-allow-list origin and rejects an out-of-list origin for a credentialed lease", () => {
    expect(() => assertDomainAllowed(["example.com"], "https://www.example.com/x", "storage-state")).not.toThrow();
    expect(() => assertDomainAllowed(["example.com"], "https://evil.test/x", "storage-state")).toThrow(/not allowed/i);
  });
});

describe("LeaseManager.assertCanOpen enforces the fence at navigation (B1a)", () => {
  function lease(storagePolicy: "ephemeral" | "storage-state" | "persistent-profile", allowedDomains: string[]) {
    const manager = new LeaseManager();
    const l = manager.acquire({ agentId: "a", runId: "r", artifactRunDir: "/tmp/run", storagePolicy, allowedDomains });
    return { manager, token: l.contextToken };
  }

  it("lets an acquire-only credentialed lease exist, but blocks navigating it unfenced", () => {
    const { manager, token } = lease("storage-state", []); // acquire succeeds (no navigation yet)
    expect(() => manager.assertCanOpen(token, "a", "https://anywhere.example/x")).toThrow(/non-empty allowedDomains/i);
  });

  it("permits a fenced credentialed lease to open an in-list origin", () => {
    const { manager, token } = lease("storage-state", ["example.com"]);
    expect(() => manager.assertCanOpen(token, "a", "https://example.com/x")).not.toThrow();
    expect(() => manager.assertCanOpen(token, "a", "https://other.example/x")).toThrow(/not allowed/i);
  });
});
