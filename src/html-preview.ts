import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

interface ArtifactRow {
  artifact_id?: string;
  path?: string;
  kind?: string;
  format?: string;
  mime?: string;
  source_url?: string;
  sha256?: string;
  status?: string;
  bytes?: number;
}

export interface HtmlPreviewResult {
  ok: true;
  path: string;
  artifacts: number;
}

export async function buildHtmlPreview(runDir: string): Promise<HtmlPreviewResult> {
  const artifacts = await readJsonl<ArtifactRow>(join(runDir, "artifacts.jsonl"));
  const outputPath = join(runDir, "html", "farm-evidence-preview.html");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderHtml(runDir, outputPath, artifacts), "utf8");
  return { ok: true, path: outputPath, artifacts: artifacts.length };
}

function renderHtml(runDir: string, outputPath: string, artifacts: ArtifactRow[]): string {
  const screenshotRows = artifacts.filter((artifact) => artifact.kind === "screenshot" && artifact.path);
  const imageMediaRows = artifacts.filter((artifact) => artifact.kind === "media" && artifact.path && artifact.mime?.startsWith("image/"));
  const allRows = artifacts.filter((artifact) => artifact.path);
  const visualCard = (artifact: ArtifactRow) => {
    const href = relLink(outputPath, runDir, artifact.path!);
    return `<figure><a href="${href}"><img src="${href}" alt="${escapeHtml(artifact.source_url ?? artifact.path ?? "screenshot")}"></a><figcaption>${escapeHtml(artifact.source_url ?? artifact.path ?? "")}</figcaption></figure>`;
  };
  const screenshotCards = screenshotRows.map(visualCard).join("\n");
  const mediaCards = imageMediaRows.map(visualCard).join("\n");

  const tableRows = allRows
    .map((artifact) => {
      const href = relLink(outputPath, runDir, artifact.path!);
      return `<tr>
      <td>${escapeHtml(artifact.kind ?? "")}</td>
      <td><a href="${href}">${escapeHtml(artifact.path ?? "")}</a></td>
      <td>${escapeHtml(artifact.source_url ?? "")}</td>
      <td>${escapeHtml(artifact.status ?? "")}</td>
      <td>${artifact.bytes ?? ""}</td>
      <td><code>${escapeHtml((artifact.sha256 ?? "").slice(0, 16))}</code></td>
    </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Farm Evidence Preview</title>
  <style>
    body { font-family: Arial, "Malgun Gothic", sans-serif; margin: 0; color: #17202a; background: #fff; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 18px 48px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 28px 0 10px; border-bottom: 1px solid #d8dee6; padding-bottom: 6px; }
    .muted { color: #5f6b7a; }
    .shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
    figure { margin: 0; border: 1px solid #d8dee6; border-radius: 8px; overflow: hidden; background: #f8fafc; }
    img { display: block; width: 100%; height: 180px; object-fit: cover; border-bottom: 1px solid #d8dee6; }
    figcaption { font-size: 13px; padding: 8px; color: #5f6b7a; word-break: break-word; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid #d8dee6; padding: 7px; text-align: left; vertical-align: top; }
    th { background: #f6f8fa; }
    a { color: #0f766e; }
  </style>
</head>
<body>
  <main>
    <h1>Farm Evidence Preview</h1>
    <p class="muted">${artifacts.length} registered artifacts · generated ${new Date().toISOString()}</p>
    <h2>Screenshots</h2>
    <section class="shots">${screenshotCards || "<p>No screenshots registered.</p>"}</section>
    <h2>Image Media</h2>
    <section class="shots">${mediaCards || "<p>No image media registered.</p>"}</section>
    <h2>All Artifacts</h2>
    <table>
      <thead><tr><th>Kind</th><th>Path</th><th>Source</th><th>Status</th><th>Bytes</th><th>SHA-256</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </main>
</body>
</html>`;
}

async function readJsonl<T>(path: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function relLink(outputPath: string, runDir: string, artifactPath: string): string {
  const target = join(runDir, artifactPath);
  return relative(dirname(outputPath), target).replaceAll("\\", "/");
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
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}
