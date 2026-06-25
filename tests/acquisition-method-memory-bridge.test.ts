import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildAcquisitionMethodMemoryBridge, writeAcquisitionMethodMemoryBridge } from "../src/acquisition-method-memory-bridge.js";
import { planAcquisitionMethods } from "../src/acquisition-method-planner.js";

describe("acquisition method memory bridge", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  async function fixture(): Promise<{ root: string; runDir: string; vaultRoot: string }> {
    const root = await mkdtemp(join(tmpdir(), "farm-kb-bridge-"));
    roots.push(root);
    const runDir = join(root, "run");
    const vaultRoot = join(root, "vault");
    await mkdir(join(runDir, "raw"), { recursive: true });
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(join(vaultRoot, "SYSTEM_DNA.md"), `# SYSTEM_DNA v2\n\n## 3. 내부 합성 라벨\n\n| 내부명 | 상태 | 정확한 의미 |\n|---|---|---|\n| Existing | local_synthesis | already here |\n\n## 4. 시스템 장기 구조\n`, "utf8");
    await writeFile(join(vaultRoot, "LOG.md"), "# LOG - operation ledger\n", "utf8");

    const plan = planAcquisitionMethods({
      url: "https://www.youtube.com/watch?v=vjSZIyYd0NI",
      observedFailure: "browser_blocked",
      allowExternalBridge: true
    });
    await writeFile(join(runDir, "raw", "plan.txt"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    await writeFile(
      join(runDir, "raw", "obstruction.txt"),
      `${JSON.stringify(
        {
          status: "detected",
          detections: [{ kind: "bot_block", confidence: "high", evidence: ["verify you are human"] }]
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      join(runDir, "artifacts.jsonl"),
      `${[
        JSON.stringify({
          artifact_id: "plan-artifact",
          path: "raw/plan.txt",
          kind: "text",
          evidence_kind: "source_strategy",
          tool_name: "acquisition_method_plan",
          source_url: plan.inputUrl,
          sha256: "0".repeat(64),
          capture_method: "browser-agent-mcp-farm acquisition-method-plan"
        }),
        JSON.stringify({
          artifact_id: "obstruction-artifact",
          path: "raw/obstruction.txt",
          kind: "text",
          evidence_kind: "browser_obstruction",
          tool_name: "evidence_run_obstruction_classifier",
          source_url: plan.inputUrl,
          sha256: "1".repeat(64),
          capture_method: "browser-agent-mcp-farm browser-obstruction-classifier"
        })
      ].join("\n")}\n`,
      "utf8"
    );
    return { root, runDir, vaultRoot };
  }

  it("builds vault note writes without mutating the vault in dry-run mode", async () => {
    const { runDir, vaultRoot } = await fixture();

    const result = await buildAcquisitionMethodMemoryBridge({
      runDir,
      vaultRoot,
      merkleRoot: "a".repeat(64),
      now: "2026-06-25T00:00:00.000Z"
    });

    expect(result.ok).toBe(true);
    expect(result.notes.map((note) => note.kind)).toEqual(["system_dna", "method_recipe", "frontier_ledger", "bridge_note", "operation_log"]);
    expect(result.notes.find((note) => note.kind === "method_recipe")?.content).toContain("farm-insane-search-method-selection-ladder");
    expect(result.notes.find((note) => note.kind === "frontier_ledger")?.content).toContain("browser_blocked");
    expect(result.notes.find((note) => note.kind === "bridge_note")?.content).toContain("merkleRoot");
    expect(await readFile(join(vaultRoot, "SYSTEM_DNA.md"), "utf8")).not.toContain("Insane-search method-selection ladder");
  });

  it("writes idempotent SYSTEM_DNA, recipe, frontier, bridge, and log files when applied", async () => {
    const { runDir, vaultRoot } = await fixture();

    const first = await writeAcquisitionMethodMemoryBridge({
      runDir,
      vaultRoot,
      merkleRoot: "b".repeat(64),
      now: "2026-06-25T00:00:00.000Z",
      apply: true
    });
    const second = await writeAcquisitionMethodMemoryBridge({
      runDir,
      vaultRoot,
      merkleRoot: "b".repeat(64),
      now: "2026-06-25T00:00:00.000Z",
      apply: true
    });

    expect(first.written).toBe(5);
    expect(second.written).toBe(1);
    const systemDna = await readFile(join(vaultRoot, "SYSTEM_DNA.md"), "utf8");
    expect(systemDna.match(/Insane-search method-selection ladder/g)?.length).toBe(1);
    expect(await readFile(join(vaultRoot, "vault", "methods", "acquisition", "farm-insane-search-method-selection-ladder.md"), "utf8")).toContain("## Fallback Chain");
    expect(await readFile(join(vaultRoot, "vault", "sessions", "2026-06-25-browser-agent-mcp-farm-acquisition-frontier.md"), "utf8")).toContain("## Blocker Checks");
    expect(await readFile(join(vaultRoot, "vault", "sessions", "2026-06-25-browser-agent-mcp-farm-kb-bridge.md"), "utf8")).toContain("plan-artifact");
  });
});
