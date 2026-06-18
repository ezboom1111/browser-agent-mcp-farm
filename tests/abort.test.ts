import { describe, expect, it } from "vitest";
import { EvidenceRunAbortError, isAbortError, throwIfAborted, withAbort } from "../src/abort.js";

describe("EvidenceRunAbortError", () => {
  it("uses the default message and AbortError name", () => {
    const err = new EvidenceRunAbortError();
    expect(err.message).toBe("evidence run canceled");
    expect(err.name).toBe("AbortError");
    expect(err).toBeInstanceOf(Error);
  });
  it("accepts a custom message", () => {
    expect(new EvidenceRunAbortError("nope").message).toBe("nope");
  });
});

describe("throwIfAborted", () => {
  it("does nothing for undefined or non-aborted signals", () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
  });
  it("throws an EvidenceRunAbortError for an aborted signal", () => {
    const c = new AbortController();
    c.abort("stop now");
    expect(() => throwIfAborted(c.signal)).toThrow(EvidenceRunAbortError);
    expect(() => throwIfAborted(c.signal)).toThrow("stop now");
  });
});

describe("withAbort", () => {
  it("returns the work result when no signal is given", async () => {
    await expect(withAbort(Promise.resolve(42), undefined)).resolves.toBe(42);
  });
  it("returns the work result for a non-aborted signal", async () => {
    await expect(withAbort(Promise.resolve("ok"), new AbortController().signal)).resolves.toBe("ok");
  });
  it("rejects immediately for an already-aborted signal", async () => {
    const c = new AbortController();
    c.abort();
    await expect(withAbort(Promise.resolve("x"), c.signal)).rejects.toBeInstanceOf(EvidenceRunAbortError);
  });
  it("rejects when aborted mid-flight, carrying a string reason", async () => {
    const c = new AbortController();
    const pending = new Promise<string>(() => {}); // never settles
    const raced = withAbort(pending, c.signal);
    c.abort("user stopped");
    await expect(raced).rejects.toThrow("user stopped");
  });
  it("carries an Error reason's message", async () => {
    const c = new AbortController();
    const raced = withAbort(new Promise<string>(() => {}), c.signal);
    c.abort(new Error("boom"));
    await expect(raced).rejects.toThrow("boom");
  });
});

describe("isAbortError", () => {
  it("recognises abort-shaped errors", () => {
    expect(isAbortError(new EvidenceRunAbortError())).toBe(true);
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });
  it("rejects non-abort values", () => {
    expect(isAbortError(new Error("other"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError({ name: "TypeError" })).toBe(false);
  });
});
