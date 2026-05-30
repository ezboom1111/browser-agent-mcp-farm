#!/usr/bin/env node
// Proves the PUBLISHED artifact is correct and runnable: queries the exact npm-pack file
// manifest and asserts it ships the bin + license + skill + readme, then runs the bin
// (dist/cli.js — packed verbatim) end-to-end with the real runtime deps.
//
// Uses `npm pack --dry-run` so NO .tgz is written: actually creating then immediately
// deleting the tarball trips a native libuv/AV fault (0xC0000409) on this Windows box,
// and the dry-run JSON already carries the full `files`/`filename` manifest we assert on.
// Run after `npm run build` (verify does, so dist/cli.js is fresh).
import { execSync, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");

function fail(message) {
  console.error(`tarball test FAILED: ${message}`);
  process.exit(1);
}

// 1) Dry-run pack -> the published file manifest, without writing/removing a tarball.
const packJson = execSync("npm pack --json --ignore-scripts --dry-run", {
  cwd: repoRoot,
  encoding: "utf8"
});
const meta = JSON.parse(packJson)[0];
const shipped = new Set((meta.files ?? []).map((f) => f.path.replace(/\\/g, "/")));

// 2) The published artifact MUST carry the bin, license, readme and at least one skill.
const required = ["package.json", "dist/cli.js", "LICENSE", "README.md"];
const missing = required.filter((p) => !shipped.has(p));
if (missing.length > 0) {
  fail(`tarball is missing required files: ${missing.join(", ")}`);
}
if (![...shipped].some((p) => p.startsWith("skills/") && p.endsWith("SKILL.md"))) {
  fail("tarball does not ship a skills/**/SKILL.md");
}

// 3) Run the exact bin bytes npm ships (dist/cli.js is packed verbatim) with real deps.
const helpOut = execFileSync(process.execPath, [resolve(repoRoot, "dist", "cli.js"), "help"], {
  cwd: repoRoot,
  encoding: "utf8"
});
if (!helpOut.includes("browser-agent-mcp-farm") || !helpOut.includes("claim-gate")) {
  fail("packed CLI `help` did not print the expected usage banner");
}

console.log(`tarball test OK: ${meta.filename} would ship the bin + LICENSE + skill (${shipped.size} files) and the bin runs end-to-end.`);
