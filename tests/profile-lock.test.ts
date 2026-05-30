import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireProfileLock,
  profileLockPath,
  releaseProfileLock,
  PROFILE_LOCK_TTL_MS,
  type ProfileLockHandle
} from "../src/profile-lock.js";
import { FarmError } from "../src/farm-error.js";

// File-based O_EXCL is the cross-process mechanism: a second acquire of the same
// key hits the same lockfile a second process would, so testing it in-process
// exercises the exact code path. Keys are namespaced by pid to avoid collisions.
const keys = new Set<string>();
function lockKey(name: string): string {
  const key = `test:profile-lock:${process.pid}:${name}`;
  keys.add(key);
  return key;
}

describe("profile-lock", () => {
  afterEach(async () => {
    for (const key of keys) {
      await rm(profileLockPath(key), { force: true });
    }
    keys.clear();
  });

  it("blocks a second acquire of the same profile, then frees it on release", () => {
    const key = lockKey("basic");
    const first = acquireProfileLock(key, "lease-a");
    expect(existsSync(first.lockPath)).toBe(true);

    let thrown: unknown;
    try {
      acquireProfileLock(key, "lease-b");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FarmError);
    expect((thrown as FarmError).code).toBe("profile_in_use");

    releaseProfileLock(first);
    expect(existsSync(first.lockPath)).toBe(false);

    const second = acquireProfileLock(key, "lease-b");
    expect(second.owner).toBe("lease-b");
    releaseProfileLock(second);
  });

  it("allows different profiles to be held concurrently", () => {
    const a = acquireProfileLock(lockKey("concurrent-a"), "lease-a");
    const b = acquireProfileLock(lockKey("concurrent-b"), "lease-b");
    expect(a.lockPath).not.toBe(b.lockPath);
    releaseProfileLock(a);
    releaseProfileLock(b);
  });

  it("reaps a stale lock left by a dead process", async () => {
    const key = lockKey("dead-pid");
    const lockPath = profileLockPath(key);
    await mkdir(dirname(lockPath), { recursive: true });
    // 2**30 is a pid that is effectively never live.
    await writeFile(lockPath, JSON.stringify({ pid: 2 ** 30, owner: "ghost", lockKey: key, acquiredAt: Date.now() }));

    const acquired = acquireProfileLock(key, "lease-a");
    expect(acquired.owner).toBe("lease-a");
    releaseProfileLock(acquired);
  });

  it("reaps a lock older than the TTL even if the owner pid looks alive", async () => {
    const key = lockKey("ttl");
    const lockPath = profileLockPath(key);
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, owner: "old", lockKey: key, acquiredAt: Date.now() - PROFILE_LOCK_TTL_MS - 1000 })
    );

    const acquired = acquireProfileLock(key, "lease-a");
    expect(acquired.owner).toBe("lease-a");
    releaseProfileLock(acquired);
  });

  it("does not delete a lock owned by a different owner", () => {
    const key = lockKey("foreign");
    const real = acquireProfileLock(key, "lease-a");
    const foreign: ProfileLockHandle = { lockPath: real.lockPath, lockKey: key, owner: "someone-else" };
    releaseProfileLock(foreign);
    expect(existsSync(real.lockPath)).toBe(true); // still held by lease-a
    releaseProfileLock(real);
    expect(existsSync(real.lockPath)).toBe(false);
  });
});
