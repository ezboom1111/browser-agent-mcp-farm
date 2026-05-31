import { chmod, mkdir, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { sanitizeFileBase } from "./artifact-writer.js";

export interface ProfilePaths {
  root: string;
  storageStatePath: string;
  userDataDir: string;
}

export interface ProfileInfo extends ProfilePaths {
  name: string;
  exists: boolean;
}

export function profileRoot(): string {
  return resolve(homedir(), ".gstack", "browser-profiles");
}

export function profilePaths(profileName: string): ProfilePaths {
  const root = join(profileRoot(), sanitizeFileBase(profileName));
  return {
    root,
    storageStatePath: join(root, "storage-state.json"),
    userDataDir: join(root, "user-data")
  };
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  const root = profileRoot();
  if (!existsSync(root)) {
    return [];
  }
  const names = await readdir(root);
  const profiles: ProfileInfo[] = [];
  for (const name of names) {
    const paths = profilePaths(name);
    const profileStat = await stat(paths.root).catch(() => undefined);
    if (profileStat?.isDirectory()) {
      profiles.push({
        name,
        exists: existsSync(paths.storageStatePath) || existsSync(paths.userDataDir),
        ...paths
      });
    }
  }
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

// Create a profile/credential directory with owner-only access (B1b). This protects the at-rest
// credential stores it contains — the persistent-profile userDataDir (Chromium's cookie/login DBs)
// AND storage-state.json — at the directory level. POSIX: chmod 0700. Windows: the profile root
// lives under %USERPROFILE%\.gstack (already owner-only by the inherited home ACL); we additionally,
// best-effort, grant the current user explicit control and THEN remove inheritance — grant-first so
// a failure can never lock out the directory. Fully best-effort: a perms failure never breaks a run.
//
// NOTE (scoping): this is directory-level owner-only protection, sufficient for a single-user
// machine. It does NOT defend against a local administrator / SYSTEM reading the bytes — that would
// require per-file encryption (e.g. Windows DPAPI). DPAPI was deliberately not added here: the
// PowerShell bridge would carry a plaintext key in transit (process-listing / 4688 / transcription
// leak risk) and DPAPI CurrentUser is itself same-user-decryptable, so the marginal benefit over an
// owner-only directory did not justify shipping that secret-handling path. Tracked as a follow-up.
export async function ensureHardenedDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  try {
    if (process.platform === "win32") {
      await hardenWindowsDir(dir);
    } else {
      await chmod(dir, 0o700);
    }
  } catch {
    // best-effort: never let a permissions step break login/capture
  }
}

async function hardenWindowsDir(dir: string): Promise<void> {
  let user = "";
  try {
    user = userInfo().username;
  } catch {
    return;
  }
  if (user.length === 0) {
    return;
  }
  // Grant the current user explicit full control first (additive, cannot lock out)...
  const granted = await runIcacls([dir, "/grant:r", `${user}:(OI)(CI)F`]);
  if (!granted) {
    return; // grant failed -> do NOT remove inheritance (avoid any lock-out)
  }
  // ...then remove inherited ACEs so other standard users lose access.
  await runIcacls([dir, "/inheritance:r"]);
}

function runIcacls(args: string[]): Promise<boolean> {
  return new Promise((resolveResult) => {
    try {
      const child = spawn("icacls", args, { stdio: "ignore", windowsHide: true });
      child.on("error", () => resolveResult(false));
      child.on("close", (code) => resolveResult(code === 0));
    } catch {
      resolveResult(false);
    }
  });
}

export async function removeProfile(profileName: string): Promise<{ ok: true; profileName: string; root: string }> {
  const paths = profilePaths(profileName);
  await rm(paths.root, { recursive: true, force: true });
  return { ok: true, profileName, root: paths.root };
}
