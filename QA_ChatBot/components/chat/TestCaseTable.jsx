"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardCopy, FileSpreadsheet, FileText, Loader2, Plus, RefreshCw, Trash2, Check } from "lucide-react";
import { TC_FIELDS } from "@/lib/testcases";
import { api } from "@/lib/client/api";
import { exportTestCasesCsv, exportTestCasesXlsx, testCasesToTsv } from "@/lib/client/export";

const PRIORITY_STYLE = {
  High: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
  Medium: "bg-amber-500/10 text-amber-200 ring-amber-500/30",
  Low: "bg-white/10 text-slate-300 ring-white/10",
};

const nextId = (rows) => {
  const nums = rows.map((r) => Number(String(r.id).match(/(\d+)$/)?.[1] || 0));
  return `TC-${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;
};

export default function TestCaseTable({ initialRows, messageId, blockIndex }) {
  const [rows, setRows] = useState(initialRows);
  const [busyRow, setBusyRow] = useState(null);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef(null);
  const dirty = useRef(false);

  // Persist edits (debounced) so they survive reloads and appear in exports.
  useEffect(() => {
    if (!dirty.current || !messageId) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.saveArtifact(messageId, blockIndex, rows).catch((e) => setNotice(`Could not save edits: ${e.message}`));
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [rows, messageId, blockIndex]);

  const update = (i, key, value) => {
    dirty.current = true;
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  };
  const addRow = () => {
    dirty.current = true;
    setRows((rs) => [...rs, { ...Object.fromEntries(TC_FIELDS.map((f) => [f.key, ""])), id: nextId(rs), priority: "Medium", type: "Positive" }]);
  };
  const removeRow = (i) => {
    dirty.current = true;
    setRows((rs) => rs.filter((_, j) => j !== i));
  };
  const regenerate = async (i) => {
    setBusyRow(i);
    setNotice("");
    try {
      const tc = await api.regenerateCase(rows[i]);
      dirty.current = true;
      setRows((rs) => rs.map((r, j) => (j === i ? tc : r)));
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusyRow(null);
    }
  };
  const copyAll = async () => {
    await navigator.clipboard.writeText(testCasesToTsv(rows));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const counts = rows.reduce((a, r) => ((a[r.type || "Other"] = (a[r.type || "Other"] || 0) + 1), a), {});

  return (
    <div className="not-prose overflow-hidden rounded-xl border border-white/10 bg-white/5 shadow-sm" data-testid="testcase-table">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
          <span className="text-sm font-semibold text-slate-100">{rows.length} test cases</span>
          {Object.entries(counts).map(([k, v]) => (
            <span key={k}>
              {k} <span className="font-medium text-slate-200">{v}</span>
            </span>
          ))}
        </div>
        <div className="no-print flex flex-wrap items-center gap-1.5">
          <ToolbarButton onClick={addRow} icon={Plus} label="Add row" />
          <ToolbarButton onClick={copyAll} icon={copied ? Check : ClipboardCopy} label={copied ? "Copied" : "Copy"} />
          <ToolbarButton onClick={() => exportTestCasesCsv(rows)} icon={FileText} label="CSV" />
          <ToolbarButton onClick={() => exportTestCasesXlsx(rows)} icon={FileSpreadsheet} label="Excel" primary />
        </div>
      </div>
      {notice && <div className="border-b border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">{notice}</div>}
      <div className="qa-scroll max-h-[460px] overflow-auto">
        <table className="w-max min-w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-white/5 shadow-[0_1px_0_#e2e8f0]">
            <tr>
              {TC_FIELDS.map((f) => (
                <th key={f.key} style={{ minWidth: f.width }} className="px-2.5 py-2 text-left font-semibold whitespace-nowrap text-slate-300">
                  {f.label}
                </th>
              ))}
              <th className="no-print w-16 px-2 py-2" aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="group border-b border-white/5 align-top last:border-0 hover:bg-violet-500/5">
                {TC_FIELDS.map((f) => (
                  <td key={f.key} style={{ minWidth: f.width, maxWidth: f.width + 120 }} className="px-1.5 py-1">
                    {f.key === "priority" ? (
                      <select
                        value={r.priority}
                        onChange={(e) => update(i, "priority", e.target.value)}
                        className={`rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ${PRIORITY_STYLE[r.priority] || PRIORITY_STYLE.Low}`}
                        aria-label={`Priority for ${r.id}`}
                      >
                        {["High", "Medium", "Low"].map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                        {!["High", "Medium", "Low"].includes(r.priority) && <option>{r.priority}</option>}
                      </select>
                    ) : (
                      <textarea
                        value={r[f.key]}
                        onChange={(e) => update(i, f.key, e.target.value)}
                        rows={1}
                        aria-label={`${f.label} for ${r.id}`}
                        className={`block w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-1 leading-snug text-slate-200 [field-sizing:content] hover:border-white/20 focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-500/30 focus:outline-none ${f.key === "id" ? "font-mono text-[11.5px] font-medium text-white" : ""}`}
                      />
                    )}
                  </td>
                ))}
                <td className="no-print px-1 py-1">
                  <div className="flex gap-0.5 opacity-60 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => regenerate(i)}
                      disabled={busyRow !== null}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-violet-200 disabled:opacity-40"
                      title="Regenerate this test case"
                      aria-label={`Regenerate ${r.id}`}
                    >
                      {busyRow === i ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    </button>
                    <button type="button" onClick={() => removeRow(i)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-200" title="Delete row" aria-label={`Delete ${r.id}`}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ToolbarButton({ onClick, icon: Icon, label, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
        primary ? "bg-violet-600 text-white hover:bg-violet-700" : "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/5"
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
