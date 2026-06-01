import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

// First-run Chromium provisioning (E3). The npm package does NOT bundle the Playwright Chromium binary
// (it is downloaded by `playwright install`), so a freshly-installed teammate would otherwise hit a
// "browser not found" error on the first capture. On `serve` startup we detect a missing Chromium and
// install it once, logging only to STDERR (safe for the MCP stdio protocol on STDOUT). Best-effort and
// opt-out-able via FARM_SKIP_BROWSER_AUTOINSTALL=1 (for offline / self-managed Playwright installs).

export type EnsureChromiumAction = "present" | "installed" | "skipped" | "failed";

/** True when Playwright's bundled Chromium executable exists on disk. */
export function chromiumInstalled(): boolean {
  try {
    const path = chromium.executablePath();
    return typeof path === "string" && path.length > 0 && existsSync(path);
  } catch {
    return false;
  }
}

export async function ensureChromiumInstalled(stderr: NodeJS.WritableStream = process.stderr): Promise<{ installed: boolean; action: EnsureChromiumAction }> {
  if (process.env.FARM_SKIP_BROWSER_AUTOINSTALL === "1") {
    return { installed: chromiumInstalled(), action: "skipped" };
  }
  if (chromiumInstalled()) {
    return { installed: true, action: "present" };
  }
  stderr.write("[browser-agent-mcp-farm] Chromium not found; installing once via 'playwright install chromium' (~150MB one-time)…\n");
  const ran = await runPlaywrightInstall();
  if (ran && chromiumInstalled()) {
    stderr.write("[browser-agent-mcp-farm] Chromium install complete.\n");
    return { installed: true, action: "installed" };
  }
  stderr.write("[browser-agent-mcp-farm] Chromium install failed; run 'npx playwright install chromium' manually.\n");
  return { installed: false, action: "failed" };
}

function runPlaywrightInstall(): Promise<boolean> {
  return new Promise((resolveResult) => {
    try {
      const onWindows = process.platform === "win32";
      // stdout is IGNORED (never reaches the MCP stdout); stderr is inherited so install errors are
      // visible. On Windows route through cmd so the `npx.cmd` shim resolves.
      const child = onWindows ? spawn("cmd", ["/c", "npx", "playwright", "install", "chromium"], { stdio: ["ignore", "ignore", "inherit"], windowsHide: true }) : spawn("npx", ["playwright", "install", "chromium"], { stdio: ["ignore", "ignore", "inherit"] });
      child.on("error", () => resolveResult(false));
      child.on("close", (code) => resolveResult(code === 0));
    } catch {
      resolveResult(false);
    }
  });
}
