"use client";

import { TC_FIELDS } from "../testcases";

export function downloadBlob(content, fileName, type = "text/plain;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function exportTestCasesXlsx(rows, name = "test-cases") {
  const XLSX = await import("xlsx");
  const data = rows.map((r) => Object.fromEntries(TC_FIELDS.map((f) => [f.label, r[f.key] ?? ""])));
  const ws = XLSX.utils.json_to_sheet(data, { header: TC_FIELDS.map((f) => f.label) });
  ws["!cols"] = TC_FIELDS.map((f) => ({ wch: Math.round(f.width / 6) }));
  ws["!autofilter"] = { ref: ws["!ref"] };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Test Cases");
  XLSX.writeFile(wb, `${name}-${stamp()}.xlsx`);
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function testCasesToCsv(rows) {
  return [TC_FIELDS.map((f) => csvCell(f.label)).join(","), ...rows.map((r) => TC_FIELDS.map((f) => csvCell(r[f.key])).join(","))].join("\r\n");
}

export function exportTestCasesCsv(rows, name = "test-cases") {
  // BOM so Excel opens UTF-8 correctly.
  downloadBlob("﻿" + testCasesToCsv(rows), `${name}-${stamp()}.csv`, "text/csv;charset=utf-8");
}

// Tab-separated text pastes cleanly into Excel / Google Sheets / Jira tables.
export function testCasesToTsv(rows) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [TC_FIELDS.map((f) => f.label).join("\t"), ...rows.map((r) => TC_FIELDS.map((f) => cell(r[f.key])).join("\t"))].join("\n");
}

const EXT = { javascript: "js", js: "js", typescript: "ts", ts: "ts", python: "py", py: "py", java: "java", gherkin: "feature", feature: "feature", cucumber: "feature", json: "json", sql: "sql", yaml: "yml", yml: "yml", bash: "sh", sh: "sh", shell: "sh", xml: "xml", html: "html", csharp: "cs", cs: "cs", markdown: "md", md: "md", csv: "csv" };
export const extForLang = (lang) => EXT[(lang || "").toLowerCase()] || "txt";

// Opens a clean, printable view of an answer so it can be saved as PDF.
export function printHtml(title, innerHtml) {
  const w = window.open("", "_blank", "noopener=no,width=900,height=1000");
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")}</title>
<style>
body{font:14px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;max-width:820px;margin:32px auto;padding:0 24px}
h1,h2,h3{line-height:1.25;margin:1.2em 0 .5em}h1{font-size:22px}h2{font-size:18px}h3{font-size:16px}
pre{background:#f1f5f9;padding:12px;border-radius:8px;white-space:pre-wrap;font-size:12px}
code{font-family:ui-monospace,Consolas,monospace}
table{border-collapse:collapse;width:100%;font-size:12px;margin:12px 0}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f1f5f9}
button,.no-print{display:none!important}textarea{border:0;resize:none;font:inherit;width:100%}
header{border-bottom:2px solid #4f46e5;padding-bottom:8px;margin-bottom:16px;color:#4f46e5;font-weight:600}
</style></head><body><header>QA ChatBot</header>${innerHtml}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return true;
}
