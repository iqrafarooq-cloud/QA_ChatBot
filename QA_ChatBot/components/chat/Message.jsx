"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, FileText, Paperclip, Printer, RefreshCw, ThumbsDown, ThumbsUp, ChevronDown } from "lucide-react";
import BrandMark from "./BrandMark";
import Markdown from "./Markdown";
import ReportCard from "./ReportCard";
import { api } from "@/lib/client/api";
import { printHtml } from "@/lib/client/export";

export default function Message({ message, isLast, onRegenerate, busy }) {
  if (message.role === "user") return <UserMessage message={message} />;
  return <AssistantMessage message={message} isLast={isLast} onRegenerate={onRegenerate} busy={busy} />;
}

function UserMessage({ message }) {
  return (
    <div className="flex flex-col items-end gap-2 animate-fade">
      {message.attachments?.length > 0 && (
        <div className="flex max-w-[85%] flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((a) => (
              <span key={a.id} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">
                <Paperclip size={12} />
                {a.fileName}
              </span>
            ))}
          </div>
          {message.attachments.filter((a) => a.meta).map((a) => (
            <ReportCard key={a.id} meta={a.meta} fileName={a.fileName} />
          ))}
        </div>
      )}
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-violet-500 to-fuchsia-500 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap text-white shadow-sm" data-testid="user-message">
        {message.content}
      </div>
    </div>
  );
}

function AssistantMessage({ message, isLast, onRegenerate, busy }) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState(message.feedback ?? null);
  const [openSource, setOpenSource] = useState(null);
  const bodyRef = useRef(null);
  const cited = message.sources || [];

  const onCite = useCallback((id) => {
    setOpenSource(id);
    requestAnimationFrame(() => document.getElementById(`src-${message.id}-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [message.id]);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const vote = async (v) => {
    const next = feedback === v ? null : v;
    setFeedback(next);
    try {
      await api.feedback(message.id, next);
    } catch {
      setFeedback(feedback);
    }
  };
  const print = () => {
    const clone = bodyRef.current.cloneNode(true);
    clone.querySelectorAll("textarea").forEach((t, i) => {
      const div = document.createElement("div");
      div.style.whiteSpace = "pre-wrap";
      div.textContent = bodyRef.current.querySelectorAll("textarea")[i].value;
      t.replaceWith(div);
    });
    clone.querySelectorAll("select").forEach((s, i) => s.replaceWith(document.createTextNode(bodyRef.current.querySelectorAll("select")[i].value)));
    printHtml("QA ChatBot export", clone.innerHTML);
  };

  const waiting = message.streaming && !message.content;

  return (
    <div className="flex gap-3 animate-fade" data-testid="assistant-message">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm ring-1 ring-white/15">
        <BrandMark size={19} />
      </div>
      <div className="min-w-0 flex-1">
        {waiting ? (
          <div className="flex h-7 items-center gap-1" aria-label="QA ChatBot is thinking">
            <span className="typing-dot size-1.5 rounded-full bg-slate-400" />
            <span className="typing-dot size-1.5 rounded-full bg-slate-400" />
            <span className="typing-dot size-1.5 rounded-full bg-slate-400" />
          </div>
        ) : (
          <div ref={bodyRef}>
            <Markdown content={message.content} sources={message.liveSources || cited} messageId={message.id} artifacts={message.artifacts} streaming={message.streaming} onCite={onCite} />
          </div>
        )}

        {message.error && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300" role="alert">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{message.error}</span>
          </div>
        )}

        {cited.length > 0 && !message.streaming && (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03]" data-testid="sources">
            <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Sources from your documents</div>
            <ul className="divide-y divide-white/10">
              {cited.map((s) => (
                <li key={s.id} id={`src-${message.id}-${s.id}`}>
                  <button
                    type="button"
                    onClick={() => setOpenSource(openSource === s.id ? null : s.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-white/10 ${openSource === s.id ? "bg-white/5" : ""}`}
                    aria-expanded={openSource === s.id}
                  >
                    <span className="rounded bg-violet-500/20 px-1.5 font-mono text-[10.5px] font-semibold text-violet-300">{s.id}</span>
                    <FileText size={13} className="shrink-0 text-slate-500" />
                    <span className="truncate font-medium text-slate-200">{s.fileName}</span>
                    <span className="truncate text-slate-400">{s.location}</span>
                    <ChevronDown size={13} className={`ml-auto shrink-0 text-slate-500 transition ${openSource === s.id ? "rotate-180" : ""}`} />
                  </button>
                  {openSource === s.id && (
                    <pre className="mx-3 mb-2 max-h-40 overflow-auto rounded-lg border border-white/10 bg-white/5 p-2 font-mono text-[11.5px] whitespace-pre-wrap text-slate-300">{s.snippet}…</pre>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!message.streaming && message.content && (
          <div className="mt-1.5 flex items-center gap-0.5 text-slate-500">
            <IconButton onClick={copy} label={copied ? "Copied" : "Copy response"}>{copied ? <Check size={14} /> : <Copy size={14} />}</IconButton>
            {isLast && onRegenerate && (
              <IconButton onClick={onRegenerate} label="Regenerate response" disabled={busy}>
                <RefreshCw size={14} />
              </IconButton>
            )}
            <IconButton onClick={print} label="Print or save as PDF"><Printer size={14} /></IconButton>
            {message.id && !String(message.id).startsWith("tmp") && (
              <>
                <IconButton onClick={() => vote(1)} label="Helpful" active={feedback === 1}><ThumbsUp size={14} /></IconButton>
                <IconButton onClick={() => vote(-1)} label="Not helpful" active={feedback === -1}><ThumbsDown size={14} /></IconButton>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({ onClick, label, children, active, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`rounded-md p-1.5 transition hover:bg-white/10 hover:text-white disabled:opacity-40 ${active ? "text-violet-300" : ""}`}
    >
      {children}
    </button>
  );
}
