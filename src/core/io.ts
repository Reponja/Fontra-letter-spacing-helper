import type { FontProject, QAIssue } from "./types";
import { normalizeProject } from "./project";
import { exportFontraZip } from "./import/fontra";
import { exportUfoZip } from "./import/ufo";
import { exportDesignspaceZip } from "./import/designspace";
import { exportOpentypeBuffer } from "./export/opentype";
import { generateTrackingFeatures, trackingCss, trackingJson, trackingCsv } from "./tracking";

export function serializeProject(project: FontProject): string {
  return JSON.stringify(project, null, 2);
}

export function parseProjectJson(text: string): FontProject {
  const parsed = JSON.parse(text) as FontProject;
  if (!parsed || parsed.format !== "fit-font") {
    throw new Error("Not a Fit project file (expected format: fit-font).");
  }
  return normalizeProject(parsed);
}

export function downloadBlob(data: BlobPart, filename: string, type = "application/octet-stream"): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, type = "text/plain"): void {
  downloadBlob(text, filename, type);
}

export function downloadBinary(data: Uint8Array, filename: string, type = "application/octet-stream"): void {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  downloadBlob(copy.buffer, filename, type);
}

export function exportProjectJson(project: FontProject): void {
  downloadText(serializeProject(project), `${safeName(project.name)}.fit.json`, "application/json");
}

export function exportFontra(project: FontProject): void {
  downloadBinary(exportFontraZip(project), `${safeName(project.name)}.fontra.zip`, "application/zip");
}

export function exportUfo(project: FontProject): void {
  downloadBinary(exportUfoZip(project), `${safeName(project.name)}.ufo.zip`, "application/zip");
}

export function exportDesignspace(project: FontProject): void {
  downloadBinary(
    exportDesignspaceZip(project),
    `${safeName(project.name)}.designspace.zip`,
    "application/zip"
  );
}

export function exportOtfont(project: FontProject): void {
  const buffer = exportOpentypeBuffer(project);
  downloadBinary(new Uint8Array(buffer), `${safeName(project.name)}.otf`, "font/otf");
}

export function exportFeatures(project: FontProject): void {
  downloadText(generateTrackingFeatures(project), `${safeName(project.name)}-tracking.fea`, "text/plain");
}

export function exportTrackingCss(project: FontProject): void {
  downloadText(trackingCss(project), `${safeName(project.name)}-tracking.css`, "text/css");
}

export function exportTrackingJson(project: FontProject): void {
  downloadText(trackingJson(project), `${safeName(project.name)}-tracking.json`, "application/json");
}

export function exportTrackingCsv(project: FontProject): void {
  downloadText(trackingCsv(project), `${safeName(project.name)}-tracking.csv`, "text/csv");
}

export function exportQACsv(issues: QAIssue[]): void {
  const rows = ["severity,category,title,detail,glyph,pair,value"];
  for (const issue of issues) {
    rows.push(
      [
        issue.severity,
        issue.category,
        issue.title,
        issue.detail,
        issue.glyphName ?? "",
        issue.pair ? `${issue.pair[0]}/${issue.pair[1]}` : "",
        issue.value ?? "",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  downloadText(rows.join("\n"), "fit-qa-report.csv", "text/csv");
}

export function exportQAHtml(project: FontProject, issues: QAIssue[]): void {
  const rows = issues
    .map(
      (issue) => `<tr class="${issue.severity}">
        <td>${escapeHtml(issue.severity)}</td>
        <td>${escapeHtml(issue.category)}</td>
        <td><strong>${escapeHtml(issue.title)}</strong><div>${escapeHtml(issue.detail)}</div></td>
        <td>${escapeHtml(issue.glyphName ?? "")}</td>
        <td>${issue.pair ? escapeHtml(issue.pair.join(" / ")) : ""}</td>
      </tr>`
    )
    .join("\n");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fit QA — ${escapeHtml(project.name)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;color:#171717}
h1{font-size:1.4rem}table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid #ddd;vertical-align:top}
tr.error td:first-child{color:#b00020;font-weight:700}
tr.warning td:first-child{color:#a15c00;font-weight:700}
tr.info td:first-child{color:#2563eb}
</style></head><body>
<h1>Fit QA report — ${escapeHtml(project.name)}</h1>
<p>${issues.length} issues</p>
<table><thead><tr><th>Severity</th><th>Category</th><th>Issue</th><th>Glyph</th><th>Pair</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
  downloadText(html, `${safeName(project.name)}-qa-report.html`, "text/html");
}

function csvCell(value: unknown): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function safeName(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "font";
}
