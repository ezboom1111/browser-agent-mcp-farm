import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeServerArgv, codexNpxServerBlock, codexServerBlock, refreshStaleSkillSnapshot, registerClaudeSkill, registerClaudeSkills, registerCodex, registerCodexSkill } from "../src/registration.js";
import { renderCodexGuidanceBlock } from "../src/agent-guidance.js";
import { farmVersion } from "../src/version.js";

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

describe("npx registration (portable, package-manager-upgradable)", () => {
  it("codexNpxServerBlock invokes npx directly on POSIX and via cmd on win32, carrying the spec not a build path", () => {
    const posix = codexNpxServerBlock("browser-agent-mcp-farm@latest", "linux");
    expect(posix).toContain('command = "npx"');
    expect(posix).toContain('args = ["-y","browser-agent-mcp-farm@latest","serve"]');
    expect(posix).not.toContain("dist/cli.js");
    expect(posix).not.toContain("cmd");

    const win = codexNpxServerBlock("@acme/farm@1.2.3", "win32");
    expect(win).toContain('command = "cmd"');
    expect(win).toContain('"/c"');
    expect(win).toContain('"npx"');
    expect(win).toContain('"@acme/farm@1.2.3"');
  });

  it("claudeServerArgv switches between node-path (local) and npx, with the win32 cmd wrapper", () => {
    expect(claudeServerArgv({ npx: true, packageSpec: "browser-agent-mcp-farm@latest" }, "linux")).toEqual(["npx", "-y", "browser-agent-mcp-farm@latest", "serve"]);
    expect(claudeServerArgv({ npx: true, packageSpec: "browser-agent-mcp-farm@latest" }, "win32")).toEqual(["cmd", "/c", "npx", "-y", "browser-agent-mcp-farm@latest", "serve"]);
    // Local mode (default) still launches node directly (unchanged behaviour).
    expect(claudeServerArgv({}, "linux").slice(0, 1)).toEqual(["node"]);
  });

  it("registerCodex --npx writes an npx block (no absolute build path)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-reg-npx-"));
    dirs.push(dir);
    const configPath = join(dir, "config.toml");
    const result = await registerCodex(configPath, { npx: true });
    expect(result.ok).toBe(true);
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("npx");
    expect(content).toContain("browser-agent-mcp-farm@latest");
    expect(content).not.toContain("dist");
  });
});

describe("refreshStaleSkillSnapshot (serve self-heal)", () => {
  it("is a no-op when no snapshot exists (never creates one)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-heal-none-"));
    dirs.push(dir);
    const result = await refreshStaleSkillSnapshot(dir);
    expect(result.refreshed).toBe(false);
    expect(existsSync(join(dir, "browser-agent-mcp-farm", "SKILL.md"))).toBe(false);
  });

  it("refreshes a stale snapshot and re-stamps the version, then is idempotent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-heal-stale-"));
    dirs.push(dir);
    await registerClaudeSkill(dir); // installs SKILL.md + a marker stamped with the current version
    const markerPath = join(dir, "browser-agent-mcp-farm", ".farm-skill-version");

    // Up to date right after install -> no refresh.
    expect((await refreshStaleSkillSnapshot(dir)).refreshed).toBe(false);

    // Simulate an upgrade: the on-disk snapshot marker is now an older version.
    await writeFile(markerPath, "0.0.1\n", "utf8");
    const healed = await refreshStaleSkillSnapshot(dir);
    expect(healed.refreshed).toBe(true);
    expect((await readFile(markerPath, "utf8")).trim()).toBe(farmVersion());

    // Idempotent now that it matches.
    expect((await refreshStaleSkillSnapshot(dir)).refreshed).toBe(false);
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

describe("registerClaudeSkills (installs every in-repo skill)", () => {
  it("installs the main farm skill plus the lens skills, each version-stamped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-skills-"));
    dirs.push(dir);

    const results = await registerClaudeSkills(dir);
    expect(results.length).toBeGreaterThanOrEqual(3); // browser-agent-mcp-farm + market-scan + product-planning
    expect(results.every((result) => result.ok)).toBe(true);

    for (const skill of ["browser-agent-mcp-farm", "market-scan", "product-planning"]) {
      expect(existsSync(join(dir, skill, "SKILL.md"))).toBe(true);
      expect(existsSync(join(dir, skill, ".farm-skill-version"))).toBe(true);
    }
    const marketScan = await readFile(join(dir, "market-scan", "SKILL.md"), "utf8");
    expect(marketScan).toContain("name: market-scan");
  });
});

describe("registerCodexSkill (Codex parity)", () => {
  it("renders Codex guidance with the key invariants", () => {
    const block = renderCodexGuidanceBlock();
    expect(block).toContain("farm_evidence_run");
    expect(block).toContain("farm_add_claim");
    expect(block).toContain("Prefer this over generic browse");
    expect(block).toContain("no payments");
  });

  it("installs and updates the Codex guidance block idempotently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "farm-codex-guide-"));
    dirs.push(dir);
    const agentsPath = join(dir, "AGENTS.md");
    await writeFile(agentsPath, "# my codex notes\n", "utf8");

    const first = await registerCodexSkill(agentsPath);
    expect(first.ok).toBe(true);
    expect(first.backupPath).toBeDefined();

    await registerCodexSkill(agentsPath);
    const content = await readFile(agentsPath, "utf8");
    const occurrences = content.split("BEGIN browser-agent-mcp-farm guidance").length - 1;
    expect(occurrences).toBe(1);
    expect(content).toContain("# my codex notes");
    expect(content).toContain("farm_evidence_run");
  });
});
