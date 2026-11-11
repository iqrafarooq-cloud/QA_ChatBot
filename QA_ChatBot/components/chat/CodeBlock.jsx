"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { downloadBlob, extForLang } from "@/lib/client/export";

export default function CodeBlock({ lang, raw, children }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const ext = extForLang(lang);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-xs text-slate-400">
        <span className="font-mono">{lang || "text"}</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={copy} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10 hover:text-slate-100" aria-label="Copy code">
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => downloadBlob(raw, `qa-brain-snippet.${ext}`)}
            className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10 hover:text-slate-100"
            aria-label={`Download as .${ext}`}
          >
            <Download size={13} />.{ext}
          </button>
        </div>
      </div>
      <pre className="qa-scroll-dark overflow-x-auto p-3.5 text-[12.5px] leading-relaxed text-slate-100">
        <code className={`hljs font-mono ${lang ? `language-${lang}` : ""}`}>{children}</code>
      </pre>
    </div>
  );
}
