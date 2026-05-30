import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FarmError } from "../src/farm-error.js";
import { FarmService } from "../src/farm-service.js";
import { LeaseManager, leaseManagerOptionsFromEnv, redactLease, redactProxy } from "../src/lease-manager.js";
import { acquireProfileLock, profileLockPath, releaseProfileLock } from "../src/profile-lock.js";

const here = dirname(fileURLToPath(import.meta.url));

// Parallel-execution + cross-process safety conformance (master-plan P7): the invariants
// that keep two farm processes (e.g. Codex + Claude) from clobbering one host — a global
// context cap with backpressure, capacity recovery via release/expiry + the reaper,
// cross-process profile mutual-exclusion, secret redaction, and same-port refusal.

describe("conformance: global context cap + backpressure", () => {
  it("rejects acquisition past the cap with a typed capacity_exhausted error", () => {
    const manager = new LeaseManager({ maxContexts: 2 });
    manager.acquire({ agentId: "a", runId: "r", artifactRunDir: "/tmp/run" });
    manager.acquire({ agentId: "b", runId: "r", artifactRunDir: "/tmp/run" });
    expect(manager.activeContextCount()).toBe(2);

    let thrown: unknown;
    try {
      manager.acquire({ agentId: "c", runId: "r", artifactRunDir: "/tmp/run" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FarmError);
    expect((thrown as FarmError).code).toBe("capacity_exhausted");
  });

  it("recovers capacity when a lease is released (backpressure clears)", () => {
    const manager = new LeaseManager({ maxContexts: 1 });
    const first = manager.acquire({ agentId: "a", runId: "r", artifactRunDir: "/tmp/run" });
    expect(() => manager.acquire({ agentId: "b", runId: "r", artifactRunDir: "/tmp/run" })).toThrow(/capacity exhausted/i);

    manager.release(first.contextToken, "a");
    expect(manager.activeContextCount()).toBe(0);
    expect(() => manager.acquire({ agentId: "b", runId: "r", artifactRunDir: "/tmp/run" })).not.toThrow();
  });

  it("frees capacity when a lease expires and the reaper marks it (crash recovery)", () => {
    let clock = 0;
    const manager = new LeaseManager({ maxContexts: 1, defaultTtlMs: 1000, now: () => new Date(clock) });
    manager.acquire({ agentId: "a", runId: "r", artifactRunDir: "/tmp/run" });
    expect(() => manager.acquire({ agentId: "b", runId: "r", artifactRunDir: "/tmp/run" })).toThrow(/capacity exhausted/i);

    clock = 5000; // advance past the TTL — the abandoned (crashed) lease no longer holds capacity
    expect(manager.activeContextCount()).toBe(0);
    const reaped = manager.reapExpired();
    expect(reaped).toHaveLength(1);
    expect(reaped[0]?.status).toBe("expired");
    expect(() => manager.acquire({ agentId: "b", runId: "r", artifactRunDir: "/tmp/run" })).not.toThrow();
  });
});

describe("conformance: FARM_MAX_CONTEXTS env backpressure", () => {
  it("parses a positive integer cap and ignores unset/invalid values", () => {
    expect(leaseManagerOptionsFromEnv({ FARM_MAX_CONTEXTS: "3" })).toEqual({ maxContexts: 3 });
    expect(leaseManagerOptionsFromEnv({})).toEqual({});
    expect(leaseManagerOptionsFromEnv({ FARM_MAX_CONTEXTS: "" })).toEqual({});
    expect(leaseManagerOptionsFromEnv({ FARM_MAX_CONTEXTS: "0" })).toEqual({});
    expect(leaseManagerOptionsFromEnv({ FARM_MAX_CONTEXTS: "abc" })).toEqual({});
  });

  it("a FarmService built under FARM_MAX_CONTEXTS=1 refuses a second context", () => {
    const previous = process.env.FARM_MAX_CONTEXTS;
    process.env.FARM_MAX_CONTEXTS = "1";
    try {
      const service = new FarmService();
      service.acquireContext({ agentId: "a", runId: "r", artifactRunDir: "/tmp/run" });
      expect(() => service.acquireContext({ agentId: "b", runId: "r", artifactRunDir: "/tmp/run" })).toThrow(/capacity exhausted/i);
    } finally {
      if (previous === undefined) {
        delete process.env.FARM_MAX_CONTEXTS;
      } else {
        process.env.FARM_MAX_CONTEXTS = previous;
      }
    }
  });
});

describe("conformance: secret redaction never leaks into results", () => {
  it("masks proxy credentials and absolute profile paths", () => {
    const manager = new LeaseManager();
    const lease = manager.acquire({
      agentId: "a",
      runId: "r",
      artifactRunDir: "/tmp/run",
      storagePolicy: "persistent-profile",
      userDataDir: "/home/secretuser/profile/user-data",
      proxy: { server: "http://puser:ppass@proxy.example:8080", username: "puser", password: "ppass" }
    });
    const redacted = redactLease(lease);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("ppass");
    expect(serialized).not.toContain("secretuser");
    expect(redacted.proxy?.password).toBe("***");
    expect(redacted.userDataDir).toBe("[redacted path]");
  });

  it("redactProxy masks server credentials in the URL", () => {
    const redacted = redactProxy({ server: "http://u:topsecret@proxy.example:1", username: "u", password: "topsecret" });
    expect(JSON.stringify(redacted)).not.toContain("topsecret");
  });
});

describe("conformance: same-port refusal (backs the CLI's EADDRINUSE handling)", () => {
  let servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise<void>((res) => s.close(() => res()))));
    servers = [];
  });

  it("a second listener on the same port is refused with EADDRINUSE", async () => {
    const first = createServer();
    servers.push(first);
    await new Promise<void>((res) => first.listen(0, "127.0.0.1", res));
    const address = first.address();
    if (address === null || typeof address === "string") {
      throw new Error("no port");
    }
    const port = address.port;

    const code = await new Promise<string>((res) => {
      const second = createServer();
      servers.push(second);
      second.once("error", (error: NodeJS.ErrnoException) => res(error.code ?? "unknown"));
      second.listen(port, "127.0.0.1", () => res("listened"));
    });
    expect(code).toBe("EADDRINUSE");
  });
});

describe("conformance: cross-process profile mutual exclusion", () => {
  let heldKey: string | undefined;
  afterEach(() => {
    if (heldKey !== undefined) {
      try {
        unlinkSync(profileLockPath(heldKey));
      } catch {
        // already released
      }
      heldKey = undefined;
    }
  });

  it("refuses a same-process second acquisition while the profile is held", () => {
    const key = `conformance-${process.pid}-${process.hrtime.bigint()}`;
    heldKey = key;
    const handle = acquireProfileLock(key, "owner-a");
    try {
      expect(() => acquireProfileLock(key, "owner-b")).toThrow(/already leased/i);
    } finally {
      releaseProfileLock(handle);
    }
    // After release the same key can be re-acquired.
    const reacquired = acquireProfileLock(key, "owner-c");
    releaseProfileLock(reacquired);
  });

  it("refuses acquisition while a separate OS process holds the same lock (real two-process)", async () => {
    const worker = resolve(here, "fixtures", "profile-lock-holder.mjs");
    const distLock = resolve(here, "..", "dist", "profile-lock.js");
    if (!existsSync(distLock)) {
      console.warn("Skipping two-process profile-lock test: dist/profile-lock.js not built.");
      return;
    }
    const key = `conformance-xproc-${process.pid}-${process.hrtime.bigint()}`;
    heldKey = key;

    const child = spawn(process.execPath, [worker, key], { stdio: ["pipe", "pipe", "inherit"] });
    try {
      const held = await new Promise<boolean>((res) => {
        let buffer = "";
        const timer = setTimeout(() => res(false), 8000);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          buffer += chunk;
          if (buffer.includes("HELD")) {
            clearTimeout(timer);
            res(true);
          }
        });
      });
      expect(held).toBe(true);

      // The other process owns the on-disk lock; this process must be refused.
      expect(() => acquireProfileLock(key, "owner-here")).toThrow(/already leased/i);
    } finally {
      child.stdin.write("release\n");
      await new Promise<void>((res) => child.once("exit", () => res()));
    }

    // Once the other process releases, this process can acquire it.
    const handle = acquireProfileLock(key, "owner-here");
    releaseProfileLock(handle);
  });
});
