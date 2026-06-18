import { describe, expect, it } from "vitest";
import { farmVersion } from "../src/version.js";

describe("farmVersion", () => {
  it("returns a semver-shaped version from package.json", () => {
    expect(farmVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
  it("is cached and stable across calls", () => {
    expect(farmVersion()).toBe(farmVersion());
  });
});
