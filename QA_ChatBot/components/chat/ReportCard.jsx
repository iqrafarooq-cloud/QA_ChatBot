"use client";

// Compact visual of the numbers QA Brain's parser measured from an attached report.
// Only renders fields that exist in the file; nothing is estimated.

const fmtMs = (ms) => (ms == null ? null : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);

export default function ReportCard({ meta, fileName }) {
  if (meta?.stats) return <TestRun meta={meta} fileName={fileName} />;
  if (meta?.overall) return <Perf meta={meta} fileName={fileName} />;
  return null;
}

function TestRun({ meta, fileName }) {
  const s = meta.stats;
  const segs = [
    { key: "passed", label: "Passed", n: s.passed, cls: "bg-emerald-500", dot: "bg-emerald-500" },
    { key: "failed", label: "Failed", n: s.failed, cls: "bg-rose-500", dot: "bg-rose-500" },
    { key: "flaky", label: "Flaky", n: s.flaky, cls: "bg-amber-400", dot: "bg-amber-400" },
    { key: "skipped", label: "Skipped", n: s.skipped, cls: "bg-slate-300", dot: "bg-slate-300" },
  ];
  return (
    <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/5 p-3 text-xs shadow-sm" data-testid="report-card">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="truncate font-medium text-slate-100">{fileName}</span>
        <span className="shrink-0 text-slate-400">
          {meta.format} · {fmtMs(s.durationMs)}
        </span>
      </div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/10" role="img" aria-label={segs.map((x) => `${x.label} ${x.n}`).join(", ")}>
        {segs.filter((x) => x.n > 0).map((x) => (
          <div key={x.key} className={x.cls} style={{ width: `${(x.n / s.total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-slate-300">
        <span>
          Total <b className="text-white">{s.total}</b>
        </span>
        {segs.map((x) => (
          <span key={x.key} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${x.dot}`} />
            {x.label} <b className="text-white">{x.n}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Perf({ meta, fileName }) {
  const o = meta.overall;
  const tiles = [
    ["Avg", fmtMs(o.avg)],
    ["Median", fmtMs(o.median)],
    ["p90", fmtMs(o.p90)],
    ["p95", fmtMs(o.p95)],
    ["p99", fmtMs(o.p99)],
    ["Errors", o.errorPct != null ? `${(+o.errorPct).toFixed(2)}%` : null],
    ["Throughput", o.throughput != null ? `${(+o.throughput).toFixed(2)}/s` : null],
    ["Samples", o.samples != null ? String(o.samples) : null],
  ].filter(([, v]) => v);
  const labels = (meta.perLabel || []).slice(0, 6);
  const maxP95 = Math.max(1, ...labels.map((l) => l.p95));
  return (
    <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/5 p-3 text-xs shadow-sm" data-testid="report-card">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="truncate font-medium text-slate-100">{fileName}</span>
        <span className="shrink-0 text-slate-400">{meta.format}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white/[0.03] px-2 py-1.5">
            <div className="text-[10.5px] text-slate-400">{k}</div>
            <div className="font-semibold text-white tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      {labels.length > 1 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[10.5px] font-medium tracking-wide text-slate-400 uppercase">p95 by request</div>
          {labels.map((l) => (
            <div key={l.label} className="flex items-center gap-2">
              <span className="w-32 shrink-0 truncate text-slate-300" title={l.label}>
                {l.label}
              </span>
              <div className="h-1.5 flex-1 rounded-full bg-white/10">
                <div className={`h-full rounded-full ${l.errorPct > 0 ? "bg-rose-400" : "bg-violet-500"}`} style={{ width: `${(l.p95 / maxP95) * 100}%` }} />
              </div>
              <span className="w-14 shrink-0 text-right text-slate-200 tabular-nums">{fmtMs(l.p95)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
