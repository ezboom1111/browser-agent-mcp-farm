import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanRunArtifacts, scanText, type SecretFinding } from "../src/secret-scan.js";

const AWS = "AKIAIOSFODNN7EXAMPLE";
const GOOGLE = "AIzaSyD1234567890abcdefghijklmnopqrstuvwxyzAB";

describe("scanText (additional coverage)", () => {
  it("flags provider key shapes and url credentials, redacting the secret", () => {
    const aws = scanText(`token=${AWS}`).find((f) => f.pattern === "aws_access_key_id") as SecretFinding;
    expect(aws.redacted).toBe("AKIA********");
    expect(scanText(`k ${GOOGLE}`).some((f) => f.pattern === "google_api_key")).toBe(true);
    expect(scanText("proxy http://user:p4ssw0rd@host.example/").some((f) => f.pattern === "url_credentials")).toBe(true);
    expect(JSON.stringify(scanText(`token=${AWS}`))).not.toContain(AWS);
  });
  it("flags a real credential assignment", () => {
    const real = scanText("api_key = aB3xY9zP1qR7mN2k");
    expect(real.find((f) => f.pattern === "credential_assignment")?.redacted).toBe("aB3x********");
  });
  it("ignores ALLCAPS env names and env-reference contexts", () => {
    // ALLCAPS env-var name (line: /^[A-Z][A-Z0-9_]+$/)
    expect(scanText("api_key = ABCDEFGHIJ1234567").some((f) => f.pattern === "credential_assignment")).toBe(false);
    // process.env.* reference in the surrounding context
    expect(scanText("process.env.api_key = realLookingVal1234").some((f) => f.pattern === "credential_assignment")).toBe(false);
  });
  it("reports the 1-based line and clean text yields nothing", () => {
    const findings = scanText(`one\ntwo ${AWS}`, "f.txt");
    expect(findings[0]).toMatchObject({ line: 2, file: "f.txt" });
    expect(scanText("plain words and the number 2024")).toEqual([]);
  });
});

describe("scanRunArtifacts (additional coverage)", () => {
  it("walks recursively, skips binary by extension, tags relative paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "secret-scan-more-"));
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "sub", "report.md"), `leak ${AWS}\n`, "utf8");
    await writeFile(join(dir, "shot.png"), AWS, "utf8"); // binary ext -> skipped
    await writeFile(join(dir, "clean.txt"), "no secrets", "utf8");
    const findings = await scanRunArtifacts(dir);
    expect(findings.some((f) => f.file === join("sub", "report.md"))).toBe(true);
    expect(findings.some((f) => f.file?.includes("shot.png"))).toBe(false);
    expect(findings.every((f) => !JSON.stringify(f).includes(AWS))).toBe(true);
  });
  it("returns [] for a missing directory", async () => {
    expect(await scanRunArtifacts(join(tmpdir(), "definitely-missing-dir-xyz-123"))).toEqual([]);
  });
});
