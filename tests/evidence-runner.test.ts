import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { runEvidenceWorkflow } from "../src/evidence-runner.js";

let runDirs: string[] = [];

describe("runEvidenceWorkflow", () => {
  afterEach(async () => {
    await Promise.all(runDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    runDirs = [];
  });

  it("creates page, frame, claim, citation, report, and final gate artifacts", async () => {
    const executableAvailable = await chromium.launch({ headless: true }).then(async (browser) => {
      await browser.close();
      return true;
    }).catch(() => false);

    if (!executableAvailable) {
      console.warn("Skipping evidence workflow test because Playwright Chromium is not installed.");
      return;
    }

    const fixture = await startFixtureServer();
    const runDir = await mkdtemp(join(tmpdir(), "farm-evidence-run-"));
    runDirs.push(runDir);

    try {
      const result = await runEvidenceWorkflow({
        url: `${fixture.baseUrl}/video`,
        runDir,
        captureId: "fixture-evidence",
        timestampsSec: [0, 10],
        maxFrames: 2,
        waitMs: 0,
        seekTimeoutMs: 1_000,
        settleMs: 10
      });

      expect(result.ok).toBe(true);
      expect(result.claimGate?.ok).toBe(true);
      expect(result.claims).toHaveLength(4);
      expect(result.assessment.frameSampling.status).toBe("ok");
      expect(result.frameRecords.some((record) => record.kind === "screenshot")).toBe(true);

      const report = await readFile(result.reportPath, "utf8");
      expect(report).toContain("Transcript verified in this run: false");
      expect(report).toContain("Audio verified: false");

      const ledger = await readFile(join(runDir, "artifacts.jsonl"), "utf8");
      expect(ledger).toContain("\"tool_name\":\"platform_capabilities\"");
      expect(ledger).toContain("\"tool_name\":\"farm_sample_frames\"");
      expect(ledger).toContain("\"tool_name\":\"evidence_run\"");

      const claims = await readFile(join(runDir, "claims.jsonl"), "utf8");
      const citations = await readFile(join(runDir, "citations.jsonl"), "utf8");
      expect(claims.split(/\r?\n/).filter(Boolean)).toHaveLength(4);
      expect(citations.split(/\r?\n/).filter(Boolean)).toHaveLength(4);
    } finally {
      await fixture.close();
    }
  });
});

async function startFixtureServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const captions = Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:12.000\nfixture caption\n", "utf8");
  const server = createServer((request, response) => {
    const path = request.url?.split("?", 1)[0] ?? "/";
    if (path === "/captions.vtt") {
      response.writeHead(200, { "content-type": "text/vtt", "content-length": String(captions.byteLength) });
      response.end(captions);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>evidence fixture</title></head><body>
      <main>
        <h1>evidence fixture</h1>
        <video id="clip" preload="metadata" style="display:block;width:320px;height:180px;background:#111827">
          <track kind="captions" src="/captions.vtt" srclang="en" label="English" default>
        </video>
      </main>
      <script>
        const video = document.querySelector('#clip');
        let current = 0;
        Object.defineProperty(video, 'duration', { get: () => 20 });
        Object.defineProperty(video, 'currentTime', {
          get: () => current,
          set: (value) => {
            current = Number(value);
            video.dataset.currentTime = current.toFixed(3);
            setTimeout(() => video.dispatchEvent(new Event('seeked')), 5);
          }
        });
        video.pause = () => {};
      </script>
    </body></html>`);
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server)
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    });
  });
}
