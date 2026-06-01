import { describe, expect, it } from "vitest";
import { chromiumInstalled, ensureChromiumInstalled } from "../src/browser-install.js";

// E3 (v0.5.x): first-run Chromium provisioning. Deterministic because the dev/CI environment installs
// Playwright Chromium before the test run (the verify gate's browser smokes require it). These tests
// exercise the present + skipped branches; the actual install branch is never triggered here.

describe("Chromium first-run provisioning (E3)", () => {
  it("reports Chromium present in the test environment", () => {
    expect(chromiumInstalled()).toBe(true);
  });

  it("returns 'present' without installing or logging when Chromium already exists", async () => {
    const lines: string[] = [];
    const sink = {
      write: (chunk: string) => {
        lines.push(chunk);
        return true;
      }
    } as unknown as NodeJS.WritableStream;
    const result = await ensureChromiumInstalled(sink);
    expect(result).toEqual({ installed: true, action: "present" });
    expect(lines).toEqual([]); // no install chatter when already present
  });

  it("honours FARM_SKIP_BROWSER_AUTOINSTALL=1 (never attempts an install)", async () => {
    const prev = process.env.FARM_SKIP_BROWSER_AUTOINSTALL;
    process.env.FARM_SKIP_BROWSER_AUTOINSTALL = "1";
    try {
      const result = await ensureChromiumInstalled();
      expect(result.action).toBe("skipped");
    } finally {
      if (prev === undefined) {
        delete process.env.FARM_SKIP_BROWSER_AUTOINSTALL;
      } else {
        process.env.FARM_SKIP_BROWSER_AUTOINSTALL = prev;
      }
    }
  });
});
