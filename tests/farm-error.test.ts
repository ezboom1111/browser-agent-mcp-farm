import { describe, expect, it } from "vitest";
import { FarmError, toToolError } from "../src/farm-error.js";

describe("FarmError", () => {
  it("carries a code and message and is an Error", () => {
    const err = new FarmError("lease_expired", "the lease expired");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("FarmError");
    expect(err.code).toBe("lease_expired");
    expect(err.message).toBe("the lease expired");
  });
});

describe("toToolError", () => {
  it("preserves the code of a FarmError", () => {
    expect(toToolError(new FarmError("bad_input", "nope"))).toEqual({
      ok: false,
      code: "bad_input",
      message: "nope"
    });
  });
  it("maps a generic Error to internal_error keeping its message", () => {
    expect(toToolError(new Error("kaboom"))).toEqual({
      ok: false,
      code: "internal_error",
      message: "kaboom"
    });
  });
  it("stringifies non-Error throwables", () => {
    expect(toToolError("string failure")).toEqual({
      ok: false,
      code: "internal_error",
      message: "string failure"
    });
    expect(toToolError(42)).toEqual({ ok: false, code: "internal_error", message: "42" });
    expect(toToolError(null)).toEqual({ ok: false, code: "internal_error", message: "null" });
  });
});
