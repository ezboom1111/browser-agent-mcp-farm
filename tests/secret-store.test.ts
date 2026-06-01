import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dpapiProtect, dpapiUnprotect, encryptStorageStateFileInPlace, isDpapiWrapper, loadStorageStateForContext, type SecretCodec } from "../src/secret-store.js";

// D3 (v0.5.0): at-rest DPAPI encryption of storage-state.json. The wrapper read/write logic is tested
// cross-platform with an INJECTED reversible codec; the real Windows DPAPI bridge is exercised by a
// win32-guarded round-trip (the secret only ever crosses stdin/stdout as base64).

const STATE = JSON.stringify({ cookies: [{ name: "sid", value: "secretcookievalue", domain: "example.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] });

// A reversible stand-in for DPAPI so the format/flow is deterministic on any OS.
const fakeCodec: SecretCodec = {
  protect: async (plaintext) => Buffer.from(plaintext, "utf8").toString("base64"),
  unprotect: async (ciphertextB64) => Buffer.from(ciphertextB64, "base64").toString("utf8")
};
const failingCodec: SecretCodec = { protect: async () => undefined, unprotect: async () => undefined };

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function newDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "farm-secret-"));
  dirs.push(dir);
  return dir;
}

describe("storage-state at-rest wrapper (D3)", () => {
  it("encrypts in place, hides the plaintext, and decrypts back to an in-memory object", async () => {
    const path = join(await newDir(), "storage-state.json");
    await writeFile(path, STATE, "utf8");

    // Plaintext file -> load returns the PATH (unchanged behaviour; Playwright reads it).
    expect(await loadStorageStateForContext(path, fakeCodec)).toBe(path);

    expect(await encryptStorageStateFileInPlace(path, fakeCodec)).toBe(true);
    const wrapped = await readFile(path, "utf8");
    expect(isDpapiWrapper(JSON.parse(wrapped))).toBe(true);
    expect(wrapped).not.toContain("secretcookievalue"); // the raw cookie value is no longer in the clear

    // Re-encrypting an already-wrapped file is a no-op.
    expect(await encryptStorageStateFileInPlace(path, fakeCodec)).toBe(true);

    // Wrapper -> load returns the DECRYPTED OBJECT (never a plaintext temp on disk, never the path).
    const loaded = await loadStorageStateForContext(path, fakeCodec);
    expect(typeof loaded).toBe("object");
    expect((loaded as { cookies: { value: string }[] }).cookies[0]?.value).toBe("secretcookievalue");
  });

  it("fails safe: an undecryptable wrapper or missing file yields undefined (do not use)", async () => {
    const dir = await newDir();
    const path = join(dir, "storage-state.json");
    await writeFile(path, STATE, "utf8");
    await encryptStorageStateFileInPlace(path, fakeCodec);

    expect(await loadStorageStateForContext(path, failingCodec)).toBeUndefined();
    expect(await loadStorageStateForContext(join(dir, "absent.json"), fakeCodec)).toBeUndefined();
  });

  it("leaves plaintext untouched when encryption is unavailable (best-effort)", async () => {
    const path = join(await newDir(), "storage-state.json");
    await writeFile(path, STATE, "utf8");
    expect(await encryptStorageStateFileInPlace(path, failingCodec)).toBe(false);
    expect(await readFile(path, "utf8")).toBe(STATE); // unchanged plaintext, still usable
  });
});

describe("real DPAPI bridge (win32 only)", () => {
  it("round-trips a non-ASCII secret through the PowerShell/stdin bridge", async () => {
    if (process.platform !== "win32") {
      return; // DPAPI is Windows-only; the wrapper logic above covers the rest
    }
    const secret = 'session={"id":42,"name":"안녕 🌐"}';
    const ciphertext = await dpapiProtect(secret);
    if (ciphertext === undefined) {
      return; // PowerShell/DPAPI not reachable in this environment -> skip the live assertion
    }
    expect(ciphertext).not.toContain("안녕");
    const recovered = await dpapiUnprotect(ciphertext);
    expect(recovered).toBe(secret);
  });
});
