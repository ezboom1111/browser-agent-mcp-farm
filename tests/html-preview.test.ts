import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactWriter } from "../src/artifact-writer.js";
import { buildHtmlPreview } from "../src/html-preview.js";

let runDirs: string[] = [];

describe("buildHtmlPreview", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("renders screenshot thumbnails and artifact links", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "farm-html-"));
    runDirs.push(runDir);
    const writer = new ArtifactWriter();
    await writer.writeCaptureBundle({
      runDir,
      sourceUrl: "https://example.com/",
      contextToken: "ctx_test",
      pageId: "page_test",
      captureId: "preview",
      html: "<html><body>Preview</body></html>",
      text: "Preview",
      screenshot: Buffer.from("fake-png")
    });

    const result = await buildHtmlPreview(runDir);
    expect(result.artifacts).toBeGreaterThanOrEqual(4);
    const html = await readFile(result.path, "utf8");
    expect(html).toContain("screenshots/preview.png");
    expect(html).toContain("raw/preview.html");
  });
});
