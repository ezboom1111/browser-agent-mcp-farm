import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureHardenedDir } from "../src/profile-store.js";

// B1b (v0.5.0): the profile/credential directory (holding the persistent-profile userDataDir AND
// storage-state.json) is created owner-only. POSIX: mode 0700. Windows: relies on the inherited
// %USERPROFILE% owner ACL + a best-effort icacls grant. Hardening is best-effort and never throws.

let roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
  roots = [];
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "farm-harden-"));
  roots.push(dir);
  return dir;
}

describe("ensureHardenedDir (B1b)", () => {
  it("creates the directory (idempotently) without throwing", async () => {
    const base = await tmp();
    const target = join(base, "profile", "nested");
    await expect(ensureHardenedDir(target)).resolves.toBeUndefined();
    await expect(ensureHardenedDir(target)).resolves.toBeUndefined(); // idempotent
    const s = await stat(target);
    expect(s.isDirectory()).toBe(true);
  });

  it.runIf(process.platform !== "win32")("sets owner-only 0700 perms on POSIX", async () => {
    const base = await tmp();
    const target = join(base, "creds");
    await ensureHardenedDir(target);
    const mode = (await stat(target)).mode & 0o777;
    expect(mode).toBe(0o700); // no group/other access
  });

  it("a credential file written into a hardened dir is reachable by the owner", async () => {
    const base = await tmp();
    const target = join(base, "profile");
    await ensureHardenedDir(target);
    const file = join(target, "storage-state.json");
    await writeFile(file, JSON.stringify({ cookies: [] }), "utf8");
    expect((await stat(file)).isFile()).toBe(true);
  });
});
