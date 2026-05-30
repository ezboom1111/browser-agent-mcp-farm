import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import type { ArtifactRecord } from "../src/artifact-writer.js";
import { runOcrForFrameArtifacts } from "../src/ocr.js";

const integrationEnabled = process.env.FARM_OCR_INTEGRATION === "1";
const nonEnglishEnabled = process.env.FARM_OCR_NON_ENGLISH === "1";
let runDirs: string[] = [];

interface OcrIntegrationCase {
  name: string;
  text: string;
  language: string;
  expectedProfile: Record<string, unknown>;
  minimumPriceLikeTokenCount?: number;
}

describe.skipIf(!integrationEnabled)("OCR integration", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("extracts profile metadata from real OCR fixture screenshots through optional tesseract.js", async () => {
    await expectTesseractInstalled();
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping OCR integration test because Playwright Chromium is not installed.");
      return;
    }

    const runDir = await mkdtemp(join(tmpdir(), "farm-ocr-integration-"));
    runDirs.push(runDir);
    const cases: OcrIntegrationCase[] = [
      {
        name: "english",
        text: "OCR FIXTURE 123",
        language: "eng",
        expectedProfile: {
          hasDigits: true,
          hasCurrency: false,
          hasPriceLikeText: false
        }
      },
      {
        name: "map-labels",
        text: "Google Maps Station Route 2 450 meters",
        language: "eng",
        expectedProfile: {
          hasDigits: true,
          hasMapLikeText: true,
          hasDistanceLikeText: true,
          hasPriceLikeText: false
        }
      },
      {
        name: "travel-price",
        text: "Agoda USD 120,000 Trip.com JPY 12,300",
        language: "eng",
        expectedProfile: {
          hasCurrency: true,
          hasPriceLikeText: true,
          hasTravelOrCommerceLikeText: true
        },
        minimumPriceLikeTokenCount: 1
      },
      {
        name: "coupon-discount",
        text: "Coupon 15% OFF Free cancellation",
        language: "eng",
        expectedProfile: {
          hasDigits: true,
          hasCurrency: false,
          hasPriceLikeText: false,
          hasPercentLikeText: true,
          hasTravelOrCommerceLikeText: true
        }
      },
      ...(nonEnglishEnabled
        ? [
            {
              name: "korean-japanese-map",
              text: "Naver Map \ub124\uc774\ubc84 \uc9c0\ub3c4 \u6771\u4eac\u99c5",
              language: "eng+kor+jpn",
              expectedProfile: {
                hasMapLikeText: true,
                hasPriceLikeText: false
              }
            }
          ]
        : [])
    ];

    for (const [index, testCase] of cases.entries()) {
      const framePath = `screenshots/ocr-integration-${testCase.name}-frame-${String(index + 1).padStart(3, "0")}-000001s.png`;
      await writeTextScreenshot(runDir, framePath, testCase.text);

      const result = await runOcrForFrameArtifacts({
        runDir,
        sourceUrl: "https://example.com/ocr",
        contextToken: "ctx_ocr_integration",
        pageId: "ocr",
        baseCaptureId: `ocr-integration-${testCase.name}`,
        frameRecords: [frameRecord(`frame-ocr-integration-${testCase.name}`, framePath)],
        options: { enabled: true, maxFrames: 1, timeoutMs: 60_000, language: testCase.language, minConfidence: 40 }
      });

      const textRecords = result.records.filter((record) => record.kind === "text" && record.status === "ok");
      expect(textRecords.length, testCase.name).toBeGreaterThan(0);
      expect(result.records.some((record) => record.evidence_kind === "ocr_text"), testCase.name).toBe(true);
      const metadata = await readOcrMetadata(runDir, result.records);
      expect(metadata.ocr.textProfile, testCase.name).toMatchObject(testCase.expectedProfile);
      if (testCase.minimumPriceLikeTokenCount !== undefined) {
        expect(Number(metadata.ocr.textProfile?.priceLikeTokenCount ?? 0), testCase.name).toBeGreaterThanOrEqual(testCase.minimumPriceLikeTokenCount);
      }
    }
  });
});

async function expectTesseractInstalled(): Promise<void> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    await dynamicImport("tesseract.js");
  } catch {
    throw new Error("FARM_OCR_INTEGRATION=1 requires optional peer dependency tesseract.js to be installed.");
  }
}

async function writeTextScreenshot(runDir: string, relPath: string, text: string): Promise<void> {
  const path = join(runDir, relPath);
  await mkdir(dirname(path), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 240 } });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:white">
      <main style="font-family:Arial,sans-serif;font-size:48px;font-weight:700;color:black;padding:42px">${escapeHtml(text)}</main>
    </body></html>`);
    await page.screenshot({ path, fullPage: true });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function readOcrMetadata(runDir: string, records: ArtifactRecord[]): Promise<{ ocr: { textProfile?: Record<string, unknown> } }> {
  const metadataRecord = records.find((record) => record.kind === "structured" && record.evidence_kind === "ocr_text");
  if (metadataRecord === undefined) {
    throw new Error("OCR metadata record was not written.");
  }
  return JSON.parse(await readFile(join(runDir, metadataRecord.path), "utf8")) as { ocr: { textProfile?: Record<string, unknown> } };
}

function frameRecord(artifactId: string, relPath: string): ArtifactRecord {
  return {
    artifact_id: artifactId,
    path: relPath,
    bytes: 1024,
    sha256: artifactId,
    kind: "screenshot",
    format: "png",
    mime: "image/png",
    source_url: "https://example.com/ocr",
    capture_method: "browser-agent-mcp-farm frame-sample",
    role: "evidence",
    status: "ok",
    backend: "playwright-mcp",
    tool_name: "farm_sample_frames",
    evidence_kind: "frame_screenshot"
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}
