import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexServerBlock, registerClaudeSkill, registerCodex } from "../src/registration.js";

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe("codexServerBlock", () => {
  it("invokes node directly on POSIX", () => {
    const block = codexServerBlock("/opt/farm/dist/cli.js", "linux");
    expect(block).toContain('command = "node"');
    expect(block).toContain('args = ["/opt/farm/dist/cli.js","serve"]');
    expect(block).not.toContain("cmd");
  });

  it("wraps node in cmd on win32", () => {
    const block = codexServerBlock("C:\\farm\\dist\\cli.js", "win32");
    expect(block).toContain('command = "cmd"');
    expect(block).toContain('"/c"');
    expect(block).toContain('"node"');
    expect(block).toContain('"serve"');
  });
});

describe("registerCodex", () => {
  it("writes a managed server block into a fresh config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-reg-"));
    dirs.push(dir);
    const configPath = join(dir, "config.toml");

    const result = await registerCodex(configPath);
    expect(result.ok).toBe(true);
    expect(result.target).toBe("codex");

    const content = await readFile(configPath, "utf8");
    expect(content).toContain("[mcp_servers.browser-agent-mcp-farm]");
    expect(content).toContain("# BEGIN browser-agent-mcp-farm");
    expect(content).toContain("# END browser-agent-mcp-farm");
  });

  it("is idempotent and backs up an existing config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-reg-idem-"));
    dirs.push(dir);
    const configPath = join(dir, "config.toml");
    await writeFile(configPath, "[existing]\nkey = 1\n", "utf8");

    const first = await registerCodex(configPath);
    expect(first.backupPath).toBeDefined();
    expect(existsSync(first.backupPath as string)).toBe(true);

    await registerCodex(configPath);
    const content = await readFile(configPath, "utf8");
    // Registering twice must not duplicate the managed block.
    const occurrences = content.split("[mcp_servers.browser-agent-mcp-farm]").length - 1;
    expect(occurrences).toBe(1);
    // The pre-existing config must be preserved.
    expect(content).toContain("[existing]");
  });
});

describe("registerClaudeSkill", () => {
  it("installs the in-repo skill into a skills root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-skill-"));
    dirs.push(dir);

    const result = await registerClaudeSkill(dir);
    expect(result.ok).toBe(true);

    const installed = join(dir, "browser-agent-mcp-farm", "SKILL.md");
    expect(existsSync(installed)).toBe(true);
    const content = await readFile(installed, "utf8");
    expect(content).toContain("name: browser-agent-mcp-farm");
  });
});
