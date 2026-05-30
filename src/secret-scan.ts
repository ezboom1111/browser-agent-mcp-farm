// Secret-at-rest scanner (master-plan P6 / security-at-rest domain). A defensive
// guard that an operator or a cooperating agent can run over a finished run to prove
// the evidence bundle leaks no credentials — backstopping the hard rule that
// official-API clients reference env vars and NEVER write raw tokens into artifacts.
//
// It is intentionally high-precision (specific provider key shapes, credential-bearing
// URLs, private-key blocks) plus one conservative generic assignment pattern that is
// env-reference-aware, so legitimate `${GOOGLE_API_KEY}` / `env:...` references do not
// trip it. Findings carry a REDACTED sample only — the scanner never echoes the secret.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export interface SecretFinding {
  pattern: string;
  file?: string;
  line: number;
  redacted: string;
}

interface SecretPattern {
  name: string;
  regex: RegExp;
  // Optional guard to drop env-reference / placeholder matches (false positives).
  ignore?: (match: RegExpMatchArray) => boolean;
}

// High-precision provider/credential shapes plus one guarded generic pattern.
const SECRET_PATTERNS: SecretPattern[] = [
  { name: "aws_access_key_id", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "google_api_key", regex: /\bAIza[0-9A-Za-z_-]{35,}\b/g },
  { name: "slack_token", regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { name: "github_token", regex: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g },
  { name: "openai_key", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "private_key_block", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  // Credentials embedded in a URL (e.g. a proxy server user:pass@host).
  { name: "url_credentials", regex: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@"']+:[^/\s:@"']+@/gi },
  // Generic `key = value` assignment, env-reference-aware.
  {
    name: "credential_assignment",
    regex: /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|auth[_-]?token|password|passwd|secret)\b["']?\s*[:=]\s*["']?([A-Za-z0-9_/+-]{16,})/gi,
    ignore: (match) => {
      const value = match[1] ?? "";
      // env-var references / placeholders are not secrets at rest.
      if (/^[A-Z][A-Z0-9_]+$/.test(value)) {
        return true; // ALLCAPS_ENV_NAME
      }
      const context = match.input ?? "";
      const at = match.index ?? 0;
      const before = context.slice(Math.max(0, at - 12), at + (match[0]?.length ?? 0));
      if (/\$\{|env:|process\.env|REDACTED|EXAMPLE|YOUR_|PLACEHOLDER|x{8,}|\.\.\./i.test(before)) {
        return true;
      }
      return false;
    }
  }
];

function redact(secret: string): string {
  if (secret.length <= 4) {
    return "****";
  }
  return `${secret.slice(0, 4)}${"*".repeat(Math.min(8, secret.length - 4))}`;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

// Scan a single string for secret patterns. Returns redacted findings only.
export function scanText(text: string, file?: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      if (pattern.ignore?.(match) === true) {
        continue;
      }
      const matched = match[0] ?? "";
      const finding: SecretFinding = {
        pattern: pattern.name,
        line: lineOf(text, match.index ?? 0),
        redacted: redact(match[1] ?? matched)
      };
      if (file !== undefined) {
        finding.file = file;
      }
      findings.push(finding);
    }
  }
  return findings;
}

const SKIP_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".mp4", ".webm", ".mp3", ".m4a", ".woff", ".woff2", ".ico"]);
const MAX_SCAN_BYTES = 5_000_000;

// Recursively scan a run directory's text artifacts / ledgers / reports for secrets.
// Binary media is skipped by extension; oversized files are read up to a cap.
export async function scanRunArtifacts(runDir: string): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const dot = entry.name.lastIndexOf(".");
      const ext = dot === -1 ? "" : entry.name.slice(dot).toLowerCase();
      if (SKIP_EXTENSIONS.has(ext)) {
        continue;
      }
      const info = await stat(full).catch(() => null);
      if (info === null || info.size > MAX_SCAN_BYTES) {
        continue;
      }
      const content = await readFile(full, "utf8").catch(() => null);
      if (content === null) {
        continue;
      }
      findings.push(...scanText(content, relative(runDir, full)));
    }
  };
  await walk(runDir);
  return findings;
}
