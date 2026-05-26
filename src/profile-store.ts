import { readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
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

export async function removeProfile(profileName: string): Promise<{ ok: true; profileName: string; root: string }> {
  const paths = profilePaths(profileName);
  await rm(paths.root, { recursive: true, force: true });
  return { ok: true, profileName, root: paths.root };
}

