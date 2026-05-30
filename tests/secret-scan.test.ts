import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scanText, scanRunArtifacts } from "../src/secret-scan.js";

let runDirs: string[] = [];

afterEach(async () => {
  await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  runDirs = [];
});

describe("scanText", () => {
  it("flags a Google API key, redacting the value", () => {
    const findings = scanText("config: AIzaSyA1234567890abcdefghijklmnopqrstuvw");
    expect(findings.map((finding) => finding.pattern)).toContain("google_api_key");
    expect(findings[0]?.redacted).toMatch(/^AIza\*+$/);
    // the raw secret must never appear in the finding
    expect(JSON.stringify(findings)).not.toContain("567890abcdefghij");
  });

  it("flags credentials embedded in a URL", () => {
    const findings = scanText("proxy = http://user:s3cr3tpass@proxy.example.com:8080");
    expect(findings.some((finding) => finding.pattern === "url_credentials")).toBe(true);
  });

  it("flags a private key block", () => {
    const findings = scanText("-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----");
    expect(findings.some((finding) => finding.pattern === "private_key_block")).toBe(true);
  });

  it("flags a raw token assignment", () => {
    const findings = scanText('{"api_key":"a1b2c3d4e5f6g7h8i9j0"}');
    expect(findings.some((finding) => finding.pattern === "credential_assignment")).toBe(true);
  });

  it("does NOT flag env-var references or placeholders", () => {
    expect(scanText('apiKey: "${GOOGLE_API_KEY}"')).toEqual([]);
    expect(scanText('api_key = "env:OFFICIAL_API_TOKEN"')).toEqual([]);
    expect(scanText('"api_key": "GOOGLE_PLACES_API_KEY"')).toEqual([]);
    expect(scanText("just some prose mentioning a password field")).toEqual([]);
  });

  it("returns nothing for clean text", () => {
    expect(scanText("The price was 4500 KRW and the rating 4.6 of 5.")).toEqual([]);
  });
});

describe("scanRunArtifacts", () => {
  it("finds a planted secret in a run's report and skips binary media", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-secret-scan-"));
    runDirs.push(runDir);
    await mkdir(join(runDir, "raw"), { recursive: true });
    await writeFile(join(runDir, "report.md"), "Summary\nleaked: AIzaSyA1234567890abcdefghijklmnopqrstuvw\n", "utf8");
    await writeFile(join(runDir, "raw", "page.png"), Buffer.from("AIzaSyA1234567890abcdefghijklmnopqrstuvw"));

    const findings = await scanRunArtifacts(runDir);
    expect(findings.length).toBe(1);
    expect(findings[0]?.pattern).toBe("google_api_key");
    expect(findings[0]?.file).toContain("report.md");
  });

  it("returns no findings for a clean run", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-secret-clean-"));
    runDirs.push(runDir);
    await writeFile(join(runDir, "artifacts.jsonl"), '{"path":"raw/x.html","evidence_kind":"page_html"}\n', "utf8");
    await writeFile(join(runDir, "report.md"), "Price 4500 KRW. Token bucket refilled.", "utf8");

    expect(await scanRunArtifacts(runDir)).toEqual([]);
  });
});
