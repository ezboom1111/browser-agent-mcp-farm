import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FarmService } from "../src/farm-service.js";
import { registeredToolNames } from "../src/mcp-server.js";
import { AGENT_GUIDANCE, REFUSAL_RATIONALE } from "../src/agent-guidance.js";
import { farmVersion } from "../src/version.js";

// B2 (v0.5.0): codify the live-extension / attach-and-drive refusal, DRY the nonGoals, and fix the
// version drift. The MCP negative surface (no cdp/auth/attach tool) is asserted, not just documented.

const PKG_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

describe("refusal codification (B2)", () => {
  it("nonGoals refuses live-extension / attach-and-drive of the real browser", () => {
    const text = AGENT_GUIDANCE.nonGoals.join(" ").toLowerCase();
    expect(text).toMatch(/attach-and-drive|live browser-extension|real logged-in browser/);
    expect(REFUSAL_RATIONALE.noLiveExtensionAttach).toMatch(/prompt injection|cookie jar|non-reproducible/i);
    expect(REFUSAL_RATIONALE.cdpImportIsExportOnly).toMatch(/export-only|never exposed over mcp/i);
  });

  it("capabilities() reports the real package version (no 0.3.0 drift) and shares nonGoals", () => {
    const caps = new FarmService().capabilities();
    expect(caps.version).toBe(PKG_VERSION);
    expect(caps.version).not.toBe("0.3.0");
    expect(farmVersion()).toBe(PKG_VERSION);
    // DRY: capabilities nonGoals is the single AGENT_GUIDANCE source, incl. the live-attach refusal.
    expect(caps.nonGoals).toEqual([...AGENT_GUIDANCE.nonGoals]);
    expect(caps.nonGoals.join(" ")).toMatch(/attach-and-drive/);
  });

  it("registers NO cdp / auth-login / attach tool over MCP (negative surface)", () => {
    const names = registeredToolNames();
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      expect(name).not.toMatch(/cdp|auth-?login|attach|drive|connect-?over/i);
    }
    // every registered tool is a farm_* tool
    expect(names.every((n) => n.startsWith("farm_"))).toBe(true);
    expect(names).toContain("farm_capabilities");
    expect(names).toContain("farm_lens");
  });
});
