import { spawn } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

// At-rest encryption for the ONE credential file the farm writes itself: storage-state.json (B1b
// follow-up). The persistent-profile user-data dir is Chromium's own store (already DPAPI-encrypted by
// Chromium on Windows) and is left to Chromium; here we close the remaining gap — the farm's own
// plaintext storage-state — using Windows DPAPI (CurrentUser scope).
//
// SECURITY POSTURE (deliberate, audited):
//  - The secret is fed to PowerShell on STDIN, never on argv: it does not appear in the process
//    command line, the Windows 4688 audit log, or PSReadline history. The script string on argv is a
//    constant with no interpolation of secret/user data, so there is no command injection surface.
//  - Every pipe carries BASE64 only (ASCII), so the bridge is encoding-safe for non-ASCII cookie data.
//  - DPAPI CurrentUser is same-user-decryptable by design: this protects an at-rest/offline copy of the
//    file (backup, disk theft, another standard user — already blocked by the 0700/ACL dir too), NOT
//    against a process running AS the logged-in user. That is the documented limit (see THREAT_MODEL).
//  - Best-effort everywhere: a non-Windows host, a missing PowerShell, or any failure leaves the
//    storage state as plaintext (encrypt) or simply unusable-from-cache (decrypt) — never a thrown run.
//  - Encryption is OPT-IN (FARM_ENCRYPT_STORAGE_STATE=1) so it never silently changes a user's
//    credential-file format; DECRYPTION is always attempted, so an encrypted state stays usable even
//    after the env var is unset.

const DPAPI_WRAPPER_MARKER = "__farm_dpapi__";

export interface SecretCodec {
  /** plaintext -> base64 ciphertext (undefined on unsupported host / failure). */
  protect(plaintext: string): Promise<string | undefined>;
  /** base64 ciphertext -> plaintext (undefined on unsupported host / failure). */
  unprotect(ciphertextB64: string): Promise<string | undefined>;
}

export function dpapiAvailable(): boolean {
  return process.platform === "win32";
}

export function storageStateEncryptionEnabled(): boolean {
  return process.env.FARM_ENCRYPT_STORAGE_STATE === "1";
}

const PROTECT_SCRIPT = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$in=[Console]::In.ReadToEnd();$pt=[Convert]::FromBase64String($in);$c=[Security.Cryptography.ProtectedData]::Protect($pt,$null,'CurrentUser');[Console]::Out.Write([Convert]::ToBase64String($c))";
const UNPROTECT_SCRIPT = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$in=[Console]::In.ReadToEnd();$c=[Convert]::FromBase64String($in);$p=[Security.Cryptography.ProtectedData]::Unprotect($c,$null,'CurrentUser');[Console]::Out.Write([Convert]::ToBase64String($p))";

// Run one DPAPI op via PowerShell. The op is a CLOSED enum (never a caller-supplied string), so the
// `-Command` script is always one of the two module constants — no interpolation, no injection surface.
// The secret crosses ONLY stdin/stdout (base64). undefined on any failure.
function runDpapi(op: "protect" | "unprotect", stdinB64: string): Promise<string | undefined> {
  if (!dpapiAvailable()) {
    return Promise.resolve(undefined);
  }
  const script = op === "protect" ? PROTECT_SCRIPT : UNPROTECT_SCRIPT;
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value: string | undefined): void => {
      if (!settled) {
        settled = true;
        resolveResult(value);
      }
    };
    try {
      const child = spawn("powershell.exe", ["-NonInteractive", "-NoProfile", "-Command", script], { windowsHide: true });
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", () => finish(undefined));
      child.on("close", (code) => {
        const ok = code === 0 && stderr.length === 0;
        if (!ok) {
          // Surface the FACT of a DPAPI failure (never its content) so it is not silently invisible.
          // stderr goes to the process's stderr stream, safe for the MCP stdio protocol.
          console.warn(`[secret-store] DPAPI ${op} failed (code=${code ?? "null"}, stderrBytes=${stderr.length})`);
        }
        finish(ok ? stdout.trim() : undefined);
      });
      child.stdin.on("error", () => finish(undefined));
      child.stdin.end(stdinB64, "utf8");
    } catch {
      finish(undefined);
    }
  });
}

export async function dpapiProtect(plaintext: string): Promise<string | undefined> {
  return runDpapi("protect", Buffer.from(plaintext, "utf8").toString("base64"));
}

export async function dpapiUnprotect(ciphertextB64: string): Promise<string | undefined> {
  const out = await runDpapi("unprotect", ciphertextB64);
  if (out === undefined) {
    return undefined;
  }
  try {
    return Buffer.from(out, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

const dpapiCodec: SecretCodec = { protect: dpapiProtect, unprotect: dpapiUnprotect };

export function isDpapiWrapper(parsed: unknown): boolean {
  return typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>)[DPAPI_WRAPPER_MARKER] === 1;
}

/**
 * Encrypt a storage-state file in place (best-effort). No-op (returns false) when the host is
 * unsupported, the file is missing/not JSON, encryption fails, or it is already a wrapper. The codec is
 * injectable for tests; the default is the real DPAPI bridge.
 */
export async function encryptStorageStateFileInPlace(path: string, codec: SecretCodec = dpapiCodec): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return false; // missing / unreadable -> nothing to do
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false; // only encrypt a well-formed storage-state JSON
  }
  if (isDpapiWrapper(parsed)) {
    return true; // already encrypted
  }
  const ciphertext = await codec.protect(raw);
  if (ciphertext === undefined) {
    return false; // unsupported host / failure -> leave plaintext (the 0700/ACL dir still applies)
  }
  // Atomic replace: write the wrapper to a sibling temp, then rename over the target. If the write
  // is interrupted the ORIGINAL plaintext is untouched (never a truncated/partial credential file);
  // a leftover temp holds only ciphertext (benign) and is cleaned on failure.
  const tmp = `${path}.dpapi-tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify({ [DPAPI_WRAPPER_MARKER]: 1, ciphertext })}\n`, "utf8");
    await rename(tmp, path);
    return true;
  } catch {
    await rm(tmp, { force: true }).catch(() => undefined);
    return false;
  }
}

/**
 * Resolve a storage-state file for Playwright WITHOUT ever writing a plaintext temp to disk:
 *  - missing file -> undefined
 *  - plaintext storage-state -> the path string (unchanged behaviour; Playwright reads it)
 *  - DPAPI wrapper, decryptable -> the parsed state OBJECT (in memory only)
 *  - DPAPI wrapper, NOT decryptable -> undefined (do not use a credential state we cannot read)
 */
export async function loadStorageStateForContext(path: string, codec: SecretCodec = dpapiCodec): Promise<string | Record<string, unknown> | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined; // missing / unreadable
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined; // corrupt / non-JSON -> fail closed, never hand Playwright a garbled credential file
  }
  if (!isDpapiWrapper(parsed)) {
    return path; // plaintext storage-state: unchanged behaviour
  }
  const ciphertext = (parsed as { ciphertext?: unknown }).ciphertext;
  if (typeof ciphertext !== "string") {
    return undefined;
  }
  const plaintext = await codec.unprotect(ciphertext);
  if (plaintext === undefined) {
    return undefined; // cannot decrypt (different user/host) -> fail safe, do not use
  }
  try {
    return JSON.parse(plaintext) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
