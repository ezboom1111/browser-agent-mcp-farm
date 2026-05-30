#!/usr/bin/env node
// Dependency-direction guard.
//
// The generic browser PRIMITIVE layer (BrowserPool, LeaseManager) must never
// import the platform / intelligence / orchestration layer. This keeps the
// project's most important architectural invariant — "no platform logic in
// BrowserPool" — build-enforced rather than dependent on author discipline,
// which matters when two agents (Codex + Claude) co-edit in parallel.
//
// Usage:
//   node scripts/check-boundaries.mjs            # checks the core files
//   node scripts/check-boundaries.mjs <file...>  # also checks extra files (for self-test)

import { readFileSync } from 'node:fs';

const root = process.cwd();

// Core primitive modules that must stay platform-agnostic.
const CORE_FILES = ['src/browser-pool.ts', 'src/lease-manager.ts'];

// Local import targets the core layer must never depend on. Matched (by prefix)
// against the module name in `from "./<target>.js"`.
const FORBIDDEN = [
  'evidence-runner',
  'farm-service',
  'source-',
  'destination',
  'platform-adapters',
  'official-api',
  'ocr',
  'scheduler',
  'http-server',
  'mcp-server',
  'cli',
  'registration',
  'critique-runner',
  'client-state-destinations',
  'browser-obstructions',
  'evidence-run-input',
  'html-preview',
];

const IMPORT_RE = /\bfrom\s+["']\.{1,2}\/([\w./-]+?)(?:\.js)?["']/g;

const extraFiles = process.argv.slice(2);
const files = [...CORE_FILES, ...extraFiles];

const violations = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file.includes(':') || file.startsWith('/') ? file : `${root}/${file}`, 'utf8');
  } catch {
    violations.push(`${file}: cannot read (expected core file missing?)`);
    continue;
  }
  for (const match of text.matchAll(IMPORT_RE)) {
    const target = match[1];
    if (FORBIDDEN.some((forbidden) => target.startsWith(forbidden))) {
      violations.push(`${file} imports forbidden module "./${target}"`);
    }
  }
}

if (violations.length > 0) {
  console.error('Dependency-direction guard FAILED:');
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error(
    '\nThe browser primitive layer (browser-pool, lease-manager) must not import the\n' +
      'platform / intelligence / orchestration layer. Move platform-specific logic up\n' +
      'the stack (source-*, destination-*, platform-adapters, evidence-runner).',
  );
  process.exit(1);
}

console.log(`Dependency-direction guard OK: ${CORE_FILES.length} core files platform-agnostic.`);
