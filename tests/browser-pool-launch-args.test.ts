import { describe, expect, it } from "vitest";
import { BrowserPool, CURATED_LAUNCH_ARGS, MINIMAL_LAUNCH_ARGS, FORBIDDEN_LAUNCH_ARG_PREFIXES } from "../src/browser-pool.js";
import { LeaseManager } from "../src/lease-manager.js";

// C1 (v0.4.1): curated, reproducibility-focused launch args applied ONLY to the default bundled
// Chromium engine (never to a named channel), with no stealth/security-downgrading flags. These
// assert launchOptions() shape WITHOUT launching a browser (private method via cast) so they are
// fast + deterministic; real launches are exercised by the existing real-Chromium suite + verify.

type LaunchOptions = { headless: boolean; channel?: string; args?: string[] };

function launchOptionsOf(pool: BrowserPool): LaunchOptions {
  return (pool as unknown as { launchOptions(): LaunchOptions }).launchOptions();
}

describe("BrowserPool launch args (C1)", () => {
  const manager = new LeaseManager();

  it("applies curated args + headless to the default Chromium engine", () => {
    const opts = launchOptionsOf(new BrowserPool(manager));
    expect(opts.headless).toBe(true);
    expect(opts.channel).toBeUndefined();
    expect(opts.args).toEqual([...CURATED_LAUNCH_ARGS]);
  });

  it("omits args entirely for a named channel (the branded build is the reproducibility signal)", () => {
    const opts = launchOptionsOf(new BrowserPool(manager, { browserChannel: "msedge" }));
    expect(opts.channel).toBe("msedge");
    expect("args" in opts).toBe(false);
  });

  it("treats the 'chromium' channel as the default engine and still applies args", () => {
    const opts = launchOptionsOf(new BrowserPool(manager, { browserChannel: "chromium" }));
    expect(opts.channel).toBeUndefined();
    expect(opts.args).toEqual([...CURATED_LAUNCH_ARGS]);
  });

  it("uses a strict, non-empty subset of curated args under the minimal profile", () => {
    const opts = launchOptionsOf(new BrowserPool(manager, { launchArgsProfile: "minimal" }));
    expect(opts.args).toEqual([...MINIMAL_LAUNCH_ARGS]);
    expect(opts.args?.length).toBeGreaterThan(0);
    for (const arg of MINIMAL_LAUNCH_ARGS) {
      expect(CURATED_LAUNCH_ARGS).toContain(arg);
    }
  });

  it("contains no stealth / security-downgrading flag in any launch profile", () => {
    for (const arg of [...CURATED_LAUNCH_ARGS, ...MINIMAL_LAUNCH_ARGS]) {
      for (const forbidden of FORBIDDEN_LAUNCH_ARG_PREFIXES) {
        expect(arg.startsWith(forbidden)).toBe(false);
      }
    }
  });

  it("rejects the canonical evasion flags via the forbidden-prefix list", () => {
    // Guards the boundary against a future arg addition: each of these stealth flags must be
    // caught by some forbidden prefix (so the no-evasion test above would fail if one were added).
    const caughtBy = (candidate: string): boolean => FORBIDDEN_LAUNCH_ARG_PREFIXES.some((p) => candidate.startsWith(p));
    expect(caughtBy("--disable-features=AutomationControlled")).toBe(true);
    expect(caughtBy("--disable-blink-features=AutomationControlled")).toBe(true);
    expect(caughtBy("--no-sandbox")).toBe(true);
    expect(caughtBy("--user-agent=Mozilla/5.0 spoofed")).toBe(true);
    expect(caughtBy("--disable-web-security")).toBe(true);
    // a legitimate curated flag must NOT be falsely rejected
    expect(caughtBy("--disable-dev-shm-usage")).toBe(false);
  });

  it("freezes the curated arrays and hands out a fresh mutable copy per launch", () => {
    expect(Object.isFrozen(CURATED_LAUNCH_ARGS)).toBe(true);
    expect(Object.isFrozen(MINIMAL_LAUNCH_ARGS)).toBe(true);
    const pool = new BrowserPool(manager);
    const a = launchOptionsOf(pool).args;
    const b = launchOptionsOf(pool).args;
    expect(a).not.toBe(CURATED_LAUNCH_ARGS as unknown as string[]);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
