import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { FarmError } from "./farm-error.js";
import { profileRoot } from "./profile-store.js";

// A lock older than this is presumed abandoned (e.g. the owning process crashed
// without releasing it). Long enough to outlast a slow evidence run.
export const PROFILE_LOCK_TTL_MS = 60 * 60 * 1000;

export interface ProfileLockHandle {
  lockPath: string;
  lockKey: string;
  owner: string;
}

interface LockRecord {
  pid: number;
  owner: string;
  lockKey: string;
  acquiredAt: number;
}

/** Deterministic on-disk lock path for a given profile lock key. */
export function profileLockPath(lockKey: string): string {
  const hash = createHash("sha256").update(lockKey).digest("hex").slice(0, 40);
  return resolve(profileRoot(), ".locks", `${hash}.lock`);
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    // Signal 0 does not kill; it only checks for the process's existence.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLockRecord(lockPath: string): LockRecord | undefined {
  try {
    return JSON.parse(readFileSync(lockPath, "utf8")) as LockRecord;
  } catch {
    return undefined;
  }
}

function isStale(record: LockRecord | undefined, now: number): boolean {
  if (record === undefined) {
    return true; // unreadable / garbage lock file
  }
  if (!processAlive(record.pid)) {
    return true;
  }
  if (typeof record.acquiredAt !== "number" || now - record.acquiredAt > PROFILE_LOCK_TTL_MS) {
    return true;
  }
  return false;
}

function inUseError(lockKey: string, existing: LockRecord | undefined): FarmError {
  const owner = existing?.owner ?? "another process";
  const pid = existing?.pid ?? "?";
  return new FarmError("profile_in_use", `Profile is already leased by ${owner} (pid ${pid}): ${lockKey}`);
}

/**
 * Acquire a cross-process advisory lock for a browser profile / storage state.
 *
 * The lock is an atomic O_EXCL lockfile keyed by `lockKey` (the same key the
 * in-process lease map uses), so two SEPARATE farm processes — e.g. Codex and
 * Claude each running their own `serve` — cannot drive the same profile at once
 * and clobber its shared cookie / storage-state file. Stale locks (dead owner
 * or older than the TTL) are reaped automatically.
 *
 * Throws `FarmError("profile_in_use")` when the profile is actively held by
 * another live process.
 */
export function acquireProfileLock(lockKey: string, owner: string, now: number = Date.now()): ProfileLockHandle {
  const lockPath = profileLockPath(lockKey);
  mkdirSync(dirname(lockPath), { recursive: true });
  const record: LockRecord = { pid: process.pid, owner, lockKey, acquiredAt: now };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, "wx"); // atomic create-or-fail (O_EXCL | O_CREAT)
      try {
        writeFileSync(fd, JSON.stringify(record));
      } finally {
        closeSync(fd);
      }
      return { lockPath, lockKey, owner };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const existing = readLockRecord(lockPath);
      if (isStale(existing, now)) {
        try {
          unlinkSync(lockPath); // reap the stale lock and retry once
        } catch {
          // raced with another reaper; the retry (or a clean failure) handles it
        }
        continue;
      }
      throw inUseError(lockKey, existing);
    }
  }

  // A second EEXIST after reaping means a concurrent process won the race.
  throw inUseError(lockKey, readLockRecord(lockPath));
}

/** Release a previously-acquired lock, but only if this process still owns it. */
export function releaseProfileLock(handle: ProfileLockHandle | undefined): void {
  if (handle === undefined) {
    return;
  }
  const existing = readLockRecord(handle.lockPath);
  if (existing !== undefined && existing.pid === process.pid && existing.owner === handle.owner) {
    try {
      unlinkSync(handle.lockPath);
    } catch {
      // already gone
    }
  }
}

/**
 * Re-stamp a held lock's acquiredAt so an actively-used (heartbeated) lease is
 * never reaped as stale by the TTL. Only refreshes a lock this process owns.
 * Returns true if the lock was refreshed.
 */
export function refreshProfileLock(handle: ProfileLockHandle | undefined, now: number = Date.now()): boolean {
  if (handle === undefined) {
    return false;
  }
  const existing = readLockRecord(handle.lockPath);
  if (existing === undefined || existing.pid !== process.pid || existing.owner !== handle.owner) {
    return false;
  }
  try {
    writeFileSync(handle.lockPath, JSON.stringify({ ...existing, acquiredAt: now }));
    return true;
  } catch {
    return false;
  }
}
