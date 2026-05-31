import { describe, expect, it } from "vitest";
import { BrowserChannelSchema, EvidenceRunInputSchema } from "../src/schemas.js";

// C2a (v0.5.0): browserChannel is a closed 5-value enum, not a free string. This is the
// load-bearing breaking change — unsupported engines are rejected at the input boundary.

describe("BrowserChannelSchema (C2)", () => {
  it("accepts the five supported channels", () => {
    for (const channel of ["chromium", "chrome", "msedge", "msedge-beta", "msedge-dev"]) {
      expect(BrowserChannelSchema.safeParse(channel).success).toBe(true);
    }
  });

  it("rejects unsupported engines and channels", () => {
    for (const bad of ["firefox", "webkit", "msedge-canary", "chrome-beta", "", "Chromium", "edge"]) {
      expect(BrowserChannelSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("exposes its options for fail-fast CLI validation messages", () => {
    expect([...BrowserChannelSchema.options]).toEqual(["chromium", "chrome", "msedge", "msedge-beta", "msedge-dev"]);
  });
});

describe("EvidenceRunInputSchema.browserChannel boundary (C2)", () => {
  const base = { runId: "r", url: "https://example.com" };

  it("accepts an in-enum channel", () => {
    const parsed = EvidenceRunInputSchema.safeParse({ ...base, browserChannel: "msedge" });
    expect(parsed.success).toBe(true);
  });

  it("accepts omitting the channel (bundled default)", () => {
    const parsed = EvidenceRunInputSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("rejects an out-of-enum channel at the input boundary", () => {
    const parsed = EvidenceRunInputSchema.safeParse({ ...base, browserChannel: "firefox" });
    expect(parsed.success).toBe(false);
  });
});
