import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHtmlPreview } from "../src/html-preview.js";

async function runDirWith(lines: object[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "html-preview-"));
  await writeFile(join(dir, "artifacts.jsonl"), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");
  return dir;
}

describe("buildHtmlPreview", () => {
  it("renders screenshots, image media and a table, escaping source values", async () => {
    const dir = await runDirWith([
      { kind: "screenshot", path: "shots/a.png", source_url: "https://x/<b>&t" },
      { kind: "media", path: "m/b.jpg", mime: "image/jpeg" },
      { kind: "page_text", path: "t.txt", sha256: "0123456789abcdef0000", bytes: 12, status: "ok" }
    ]);
    const r = await buildHtmlPreview(dir);
    expect(r.ok).toBe(true);
    expect(r.artifacts).toBe(3);
    const html = await readFile(r.path, "utf8");
    expect(html).toContain("Farm Evidence Preview");
    expect(html).toContain("shots/a.png");
    expect(html).toContain("&lt;b&gt;&amp;t"); // source_url html-escaped
    expect(html).toContain("0123456789abcdef"); // sha truncated to 16
  });

  it("shows empty-state copy and 0 artifacts when artifacts.jsonl is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "html-preview-empty-"));
    const r = await buildHtmlPreview(dir);
    expect(r.artifacts).toBe(0);
    const html = await readFile(r.path, "utf8");
    expect(html).toContain("No screenshots registered.");
    expect(html).toContain("No image media registered.");
  });
});
