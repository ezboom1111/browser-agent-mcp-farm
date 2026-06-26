import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listProfiles, profilePaths, profileRoot, removeProfile } from "../src/profile-store.js";

const createdProfiles: string[] = [];

afterEach(async () => {
  await Promise.all(createdProfiles.map((name) => rm(profilePaths(name).root, { recursive: true, force: true })));
  createdProfiles.length = 0;
});

function trackProfile(name: string): ReturnType<typeof profilePaths> {
  createdProfiles.push(name);
  return profilePaths(name);
}

describe("profile-store", () => {
  it("builds profile paths under the hardened profile root", () => {
    const paths = profilePaths("profile with / unsafe : chars");

    expect(paths.root.startsWith(profileRoot())).toBe(true);
    expect(paths.storageStatePath).toBe(join(paths.root, "storage-state.json"));
    expect(paths.userDataDir).toBe(join(paths.root, "user-data"));
    expect(basename(paths.root)).not.toContain("/");
    expect(basename(paths.root)).not.toContain(": chars");
  });

  it("lists only profile directories and reports storage/user-data presence", async () => {
    const alpha = trackProfile(`zz-test-profile-alpha-${process.pid}`);
    const beta = trackProfile(`zz-test-profile-beta-${process.pid}`);
    const empty = trackProfile(`zz-test-profile-empty-${process.pid}`);
    const ignoredFile = trackProfile(`zz-test-profile-file-${process.pid}`);
    await mkdir(alpha.root, { recursive: true });
    await writeFile(alpha.storageStatePath, "{}", "utf8");
    await mkdir(beta.userDataDir, { recursive: true });
    await mkdir(empty.root, { recursive: true });
    await mkdir(profileRoot(), { recursive: true });
    await writeFile(ignoredFile.root, "not a directory", "utf8");

    const listed = (await listProfiles()).filter((profile) => profile.name.startsWith("zz-test-profile-"));

    expect(listed.map((profile) => profile.name)).toEqual([`zz-test-profile-alpha-${process.pid}`, `zz-test-profile-beta-${process.pid}`, `zz-test-profile-empty-${process.pid}`]);
    expect(listed.find((profile) => profile.name.includes("alpha"))?.exists).toBe(true);
    expect(listed.find((profile) => profile.name.includes("beta"))?.exists).toBe(true);
    expect(listed.find((profile) => profile.name.includes("empty"))?.exists).toBe(false);
  });

  it("removes a named profile directory idempotently", async () => {
    const name = `zz-test-profile-remove-${process.pid}`;
    const paths = trackProfile(name);
    await mkdir(paths.userDataDir, { recursive: true });

    const result = await removeProfile(name);

    expect(result).toEqual({ ok: true, profileName: name, root: paths.root });
    expect(existsSync(paths.root)).toBe(false);
    await expect(removeProfile(name)).resolves.toMatchObject({ ok: true, profileName: name });
  });
});
