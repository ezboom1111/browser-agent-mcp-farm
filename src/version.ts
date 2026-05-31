import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Single source of truth for the running package version, read from package.json (next to dist/).
// Replaces hardcoded version strings that drifted from package.json (e.g. capabilities/guidance).
let cached: string | undefined;

export function farmVersion(): string {
  if (cached !== undefined) {
    return cached;
  }
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
    cached = typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}
