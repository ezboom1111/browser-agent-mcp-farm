import { spawnSync } from "node:child_process";
import { copyFile, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCodexGuidanceBlock } from "./agent-guidance.js";
import { farmVersion } from "./version.js";

const SERVER_NAME = "browser-agent-mcp-farm";
const SKILL_VERSION_MARKER = ".farm-skill-version";

/** How the MCP server is launched in the host config. */
export interface RegisterOptions {
  /**
   * Register an `npx`-resolved invocation (`npx -y <packageSpec> serve`) instead of an absolute path to
   * this local build. Use this when the farm is distributed as a published npm package: the config no
   * longer hard-codes a build directory, so upgrades flow through the package manager and the install
   * is portable across machines. Default false (absolute local path — correct for a git-clone dev install).
   */
  npx?: boolean;
  /** Package spec for npx mode (e.g. `browser-agent-mcp-farm@latest`, a pinned version, or a private scope). */
  packageSpec?: string;
}

export const DEFAULT_PACKAGE_SPEC = `${SERVER_NAME}@latest`;
const CODEX_BEGIN = "# BEGIN browser-agent-mcp-farm";
const CODEX_END = "# END browser-agent-mcp-farm";
const CODEX_GUIDANCE_BEGIN = "<!-- BEGIN browser-agent-mcp-farm guidance -->";
const CODEX_GUIDANCE_END = "<!-- END browser-agent-mcp-farm guidance -->";

export interface RegistrationResult {
  ok: boolean;
  target: "codex" | "claude";
  configPath?: string;
  backupPath?: string;
  message: string;
  stdout?: string;
  stderr?: string;
}

function renderCodexBlock(command: string, args: string[]): string {
  return [CODEX_BEGIN, `[mcp_servers.${SERVER_NAME}]`, `command = ${JSON.stringify(command)}`, `args = ${JSON.stringify(args)}`, `startup_timeout_sec = 20.0`, CODEX_END, ""].join("\n");
}

export function codexServerBlock(cliPath: string, platform: NodeJS.Platform = process.platform): string {
  // On Windows the MCP launcher resolves `node` more reliably through cmd; on
  // POSIX `cmd` does not exist, so invoke node directly. Using cmd on macOS or
  // Linux would make the registered Codex server fail to start.
  const onWindows = platform === "win32";
  const command = onWindows ? "cmd" : "node";
  const args = onWindows ? ["/c", "node", cliPath, "serve"] : [cliPath, "serve"];
  return renderCodexBlock(command, args);
}

// The npx-resolved Codex block: `npx -y <spec> serve`, with the same Windows `cmd /c` wrapper so the
// launcher resolves the `npx.cmd` shim. The config carries no build path, so an upgrade is just a new
// package version — no re-register of a path.
export function codexNpxServerBlock(packageSpec: string, platform: NodeJS.Platform = process.platform): string {
  const onWindows = platform === "win32";
  const command = onWindows ? "cmd" : "npx";
  const args = onWindows ? ["/c", "npx", "-y", packageSpec, "serve"] : ["-y", packageSpec, "serve"];
  return renderCodexBlock(command, args);
}

// The argv passed to `claude mcp add ... --` for either mode. npx uses a Windows `cmd /c` wrapper for
// the same shim-resolution reason; the local form stays exactly as before (node resolves directly).
export function claudeServerArgv(options: RegisterOptions, platform: NodeJS.Platform = process.platform): string[] {
  if (options.npx === true) {
    const spec = options.packageSpec ?? DEFAULT_PACKAGE_SPEC;
    return platform === "win32" ? ["cmd", "/c", "npx", "-y", spec, "serve"] : ["npx", "-y", spec, "serve"];
  }
  return ["node", distCliPath(), "serve"];
}

export async function registerCodex(configPath = join(homedir(), ".codex", "config.toml"), options: RegisterOptions = {}): Promise<RegistrationResult> {
  await mkdir(dirname(configPath), { recursive: true });
  const block = options.npx === true ? codexNpxServerBlock(options.packageSpec ?? DEFAULT_PACKAGE_SPEC) : codexServerBlock(distCliPath());

  const existing = existsSync(configPath) ? await readFile(configPath, "utf8") : "";
  const backupPath = existsSync(configPath) ? await backupFile(configPath) : undefined;
  const pattern = new RegExp(`\\n?${escapeRegex(CODEX_BEGIN)}[\\s\\S]*?${escapeRegex(CODEX_END)}\\n?`, "m");
  const next = pattern.test(existing) ? existing.replace(pattern, `\n${block}`) : `${existing.trimEnd()}\n\n${block}`;
  await writeFile(configPath, next, "utf8");

  const registration: RegistrationResult = {
    ok: true,
    target: "codex",
    configPath,
    message: `Registered ${SERVER_NAME} in Codex config.`
  };
  if (backupPath !== undefined) {
    registration.backupPath = backupPath;
  }
  return registration;
}

export async function registerClaude(options: RegisterOptions = {}): Promise<RegistrationResult> {
  const claudeConfig = join(homedir(), ".claude.json");
  const backupPath = existsSync(claudeConfig) ? await backupFile(claudeConfig) : undefined;
  const command = claudeExecutable();
  spawnSync(command, ["mcp", "remove", "--scope", "user", SERVER_NAME], {
    encoding: "utf8",
    stdio: "pipe"
  });
  const result = spawnSync(command, ["mcp", "add", "--scope", "user", SERVER_NAME, "--", ...claudeServerArgv(options)], {
    encoding: "utf8",
    stdio: "pipe"
  });

  const registration: RegistrationResult = {
    ok: result.status === 0,
    target: "claude",
    configPath: claudeConfig,
    message: result.status === 0 ? `Registered ${SERVER_NAME} in Claude user MCP config.` : `Claude MCP registration failed with status ${result.status}: ${result.error instanceof Error ? result.error.message : "unknown error"}.`,
    stdout: result.stdout,
    stderr: result.stderr
  };
  if (backupPath !== undefined) {
    registration.backupPath = backupPath;
  }
  return registration;
}

export async function registerAll(options: RegisterOptions = {}): Promise<RegistrationResult[]> {
  return [await registerCodex(join(homedir(), ".codex", "config.toml"), options), await registerClaude(options), ...(await registerClaudeSkills()), ...(await registerCodexSkills()), await registerCodexSkill()];
}

// Install the Codex-facing usage guidance (when-to-use / fast path / authoring /
// non-goals) into ~/.codex/AGENTS.md as a managed block, so Codex reaches PARITY
// with Claude's SKILL.md instead of getting the tools with no guidance.
export async function registerCodexSkill(agentsPath = join(homedir(), ".codex", "AGENTS.md")): Promise<RegistrationResult> {
  await mkdir(dirname(agentsPath), { recursive: true });
  const block = `${CODEX_GUIDANCE_BEGIN}\n${renderCodexGuidanceBlock()}${CODEX_GUIDANCE_END}\n`;
  const existing = existsSync(agentsPath) ? await readFile(agentsPath, "utf8") : "";
  const backupPath = existsSync(agentsPath) ? await backupFile(agentsPath) : undefined;
  const pattern = new RegExp(`\\n?${escapeRegex(CODEX_GUIDANCE_BEGIN)}[\\s\\S]*?${escapeRegex(CODEX_GUIDANCE_END)}\\n?`, "m");
  const next = pattern.test(existing) ? existing.replace(pattern, `\n${block}`) : `${existing.trimEnd()}\n\n${block}`;
  await writeFile(agentsPath, next, "utf8");

  const registration: RegistrationResult = {
    ok: true,
    target: "codex",
    configPath: agentsPath,
    message: `Installed ${SERVER_NAME} guidance into ${agentsPath}.`
  };
  if (backupPath !== undefined) {
    registration.backupPath = backupPath;
  }
  return registration;
}

// Install the in-repo Claude skill (skills/browser-agent-mcp-farm/SKILL.md) so a
// Claude agent auto-discovers and routes to the farm, not just the raw MCP tools.
export async function registerClaudeSkill(skillsRoot = join(homedir(), ".claude", "skills")): Promise<RegistrationResult> {
  return registerMainSkillSnapshot("claude", skillsRoot);
}

async function registerMainSkillSnapshot(target: "codex" | "claude", skillsRoot: string): Promise<RegistrationResult> {
  const source = skillSourcePath();
  if (!existsSync(source)) {
    return { ok: false, target, message: `Skill source not found at ${source}.` };
  }
  return installSkillSnapshot(target, skillsRoot, SERVER_NAME, dirname(source));
}

async function installSkillSnapshot(target: "codex" | "claude", skillsRoot: string, skillName: string, sourceDir: string): Promise<RegistrationResult> {
  const destDir = join(skillsRoot, skillName);
  const dest = join(destDir, "SKILL.md");
  const backupPath = existsSync(dest) ? await backupFile(dest) : undefined;
  await mkdir(destDir, { recursive: true });
  await cp(sourceDir, destDir, { recursive: true, force: true });
  // Stamp the copied snapshot with this package version so `serve` can self-heal a stale copy
  // after an upgrade (the skill is a COPY, not a path reference, so it would otherwise drift).
  await writeFile(join(destDir, SKILL_VERSION_MARKER), `${farmVersion()}\n`, "utf8").catch(() => undefined);

  const result: RegistrationResult = {
    ok: true,
    target,
    configPath: dest,
    message: `Installed ${skillName} skill into ${dest}.`
  };
  if (backupPath !== undefined) {
    result.backupPath = backupPath;
  }
  return result;
}

// Self-heal a stale Claude skill snapshot on `serve` startup (best-effort). Because the skill is a
// COPY (not a path reference), an upgraded server would otherwise keep routing on the OLD skill text
// until the user re-ran register-all. Here, IF a snapshot already exists (we never create one the user
// did not ask for) and its version marker != this running package version, we re-copy and re-stamp.
// Never throws and never blocks serve. Returns whether a refresh happened (for tests/diagnostics).
export async function refreshStaleSkillSnapshot(skillsRoot = join(homedir(), ".claude", "skills")): Promise<{ refreshed: boolean; reason: string }> {
  const destDir = join(skillsRoot, SERVER_NAME);
  const dest = join(destDir, "SKILL.md");
  if (!existsSync(dest)) {
    return { refreshed: false, reason: "no installed skill snapshot (skill was never registered)" };
  }
  const markerPath = join(destDir, SKILL_VERSION_MARKER);
  const current = farmVersion();
  let installed = "";
  try {
    installed = existsSync(markerPath) ? (await readFile(markerPath, "utf8")).trim() : "";
  } catch {
    installed = "";
  }
  if (installed === current) {
    return { refreshed: false, reason: "skill snapshot is up to date" };
  }
  const source = skillSourcePath();
  if (!existsSync(source)) {
    return { refreshed: false, reason: "skill source not found in package" };
  }
  try {
    await cp(dirname(source), destDir, { recursive: true, force: true });
    await writeFile(markerPath, `${current}\n`, "utf8");
    return { refreshed: true, reason: `refreshed skill snapshot ${installed || "(unstamped)"} -> ${current}` };
  } catch {
    return { refreshed: false, reason: "refresh failed (best-effort)" };
  }
}

// Install EVERY in-repo skill (the main browser-agent-mcp-farm skill plus youtube-research;
// the market-scan / product-planning wrappers were absorbed into the farm SKILL.md "Lens claim
// types" section) into a host skills root, each version-stamped for serve self-heal. Falls back
// to the single main skill if the skills directory cannot be scanned.
export async function registerClaudeSkills(skillsRoot = join(homedir(), ".claude", "skills")): Promise<RegistrationResult[]> {
  return registerHostSkills("claude", skillsRoot);
}

export async function registerCodexSkills(skillsRoot = join(homedir(), ".codex", "skills")): Promise<RegistrationResult[]> {
  return registerHostSkills("codex", skillsRoot);
}

async function registerHostSkills(target: "codex" | "claude", skillsRoot: string): Promise<RegistrationResult[]> {
  const sourceDir = skillsSourceDir();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch {
    return [await registerMainSkillSnapshot(target, skillsRoot)];
  }
  const results: RegistrationResult[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourceSkillDir = join(sourceDir, entry.name);
    const sourceSkillFile = join(sourceSkillDir, "SKILL.md");
    if (!existsSync(sourceSkillFile)) {
      continue;
    }
    results.push(await installSkillSnapshot(target, skillsRoot, entry.name, sourceSkillDir));
  }
  return results.length > 0 ? results : [await registerMainSkillSnapshot(target, skillsRoot)];
}

export function distCliPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "cli.js");
}

export function skillSourcePath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills", SERVER_NAME, "SKILL.md");
}

function skillsSourceDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills");
}

async function backupFile(path: string): Promise<string> {
  const backupPath = `${path}.bak-browser-agent-mcp-farm-${timestamp()}`;
  await copyFile(path, backupPath);
  return backupPath;
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function claudeExecutable(): string {
  return process.platform === "win32" ? "claude.exe" : "claude";
}
