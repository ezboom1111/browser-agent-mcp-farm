import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_NAME = "browser-agent-mcp-farm";
const CODEX_BEGIN = "# BEGIN browser-agent-mcp-farm";
const CODEX_END = "# END browser-agent-mcp-farm";

export interface RegistrationResult {
  ok: boolean;
  target: "codex" | "claude";
  configPath?: string;
  backupPath?: string;
  message: string;
  stdout?: string;
  stderr?: string;
}

export async function registerCodex(configPath = join(homedir(), ".codex", "config.toml")): Promise<RegistrationResult> {
  await mkdir(dirname(configPath), { recursive: true });
  const cliPath = distCliPath();
  const block = [
    CODEX_BEGIN,
    `[mcp_servers.${SERVER_NAME}]`,
    `command = "cmd"`,
    `args = ["/c", "node", ${JSON.stringify(cliPath)}, "serve"]`,
    `startup_timeout_sec = 20.0`,
    CODEX_END,
    ""
  ].join("\n");

  const existing = existsSync(configPath) ? await readFile(configPath, "utf8") : "";
  const backupPath = existsSync(configPath) ? await backupFile(configPath) : undefined;
  const pattern = new RegExp(`\\n?${escapeRegex(CODEX_BEGIN)}[\\s\\S]*?${escapeRegex(CODEX_END)}\\n?`, "m");
  const next = pattern.test(existing)
    ? existing.replace(pattern, `\n${block}`)
    : `${existing.trimEnd()}\n\n${block}`;
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

export async function registerClaude(): Promise<RegistrationResult> {
  const claudeConfig = join(homedir(), ".claude.json");
  const backupPath = existsSync(claudeConfig) ? await backupFile(claudeConfig) : undefined;
  const cliPath = distCliPath();
  const command = claudeExecutable();
  spawnSync(command, ["mcp", "remove", "--scope", "user", SERVER_NAME], {
    encoding: "utf8",
    stdio: "pipe"
  });
  const result = spawnSync(command, ["mcp", "add", "--scope", "user", SERVER_NAME, "--", "node", cliPath, "serve"], {
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

export async function registerAll(): Promise<RegistrationResult[]> {
  return [await registerCodex(), await registerClaude()];
}

export function distCliPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "cli.js");
}

async function backupFile(path: string): Promise<string> {
  const backupPath = `${path}.bak-browser-agent-mcp-farm-${timestamp()}`;
  await copyFile(path, backupPath);
  return backupPath;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function claudeExecutable(): string {
  return process.platform === "win32" ? "claude.exe" : "claude";
}
