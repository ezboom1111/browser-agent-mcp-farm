import { describe, expect, it } from "vitest";

import { unique, uniqueSorted, uniqueNonEmpty } from "../src/util/collections.js";
import { safeUrl } from "../src/util/url.js";
import { stripBom } from "../src/util/text.js";

describe("util/collections", () => {
  it("unique dedupes preserving first-seen order", () => {
    expect(unique(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });

  it("uniqueSorted dedupes then sorts ascending", () => {
    expect(uniqueSorted(["b", "a", "b", "c", "a"])).toEqual(["a", "b", "c"]);
  });

  it("uniqueNonEmpty drops blank entries before deduping, preserving order", () => {
    expect(uniqueNonEmpty(["b", "", "  ", "a", "b"])).toEqual(["b", "a"]);
  });
});

describe("util/url", () => {
  it("parses a valid URL", () => {
    expect(safeUrl("https://example.com/x")?.hostname).toBe("example.com");
  });

  it("returns undefined for malformed input", () => {
    expect(safeUrl("not a url")).toBeUndefined();
  });
});

describe("util/text", () => {
  it("strips a leading BOM", () => {
    expect(stripBom("﻿hello")).toBe("hello");
  });

  it("leaves BOM-less text unchanged", () => {
    expect(stripBom("hello")).toBe("hello");
  });
});
