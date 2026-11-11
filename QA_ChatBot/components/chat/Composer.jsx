"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, ArrowUp, CheckCircle2, FileText, Image as ImageIcon, Loader2, Paperclip, Square, X } from "lucide-react";

export const ACCEPT =
  ".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,.json,.js,.mjs,.cjs,.jsx,.ts,.tsx,.feature,.java,.py,.cs,.rb,.go,.kt,.sql,.yaml,.yml,.xml,.html,.htm,.log,.zip,.png,.jpg,.jpeg,.webp,.gif,.properties,.gradle,.sh";

export default function Composer({ value, onChange, onSend, onStop, onFiles, attachments, onRemoveAttachment, streaming, disabled, placeholder, autoFocusKey }) {
  const ta = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => {
    ta.current?.focus();
  }, [autoFocusKey]);

  // Grow with content up to a limit.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    // An empty textarea's scrollHeight includes a wrapped placeholder; keep it one line tall.
    if (value) el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const uploading = attachments.some((a) => a.status === "uploading");
  const canSend = !streaming && !uploading && !disabled && (value.trim() || attachments.some((a) => a.status === "ready"));

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      onFiles(files);
    }
  };

  return (
    <div className="rounded-2xl border border-violet-500/50 bg-white/[0.04] shadow-[0_0_24px_-6px_rgba(168,85,247,0.55)] transition focus-within:border-violet-400 focus-within:shadow-[0_0_28px_-4px_rgba(168,85,247,0.7)]">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-white/5 px-3 pt-3 pb-2" data-testid="attachments">
          {attachments.map((a) => (
            <div
              key={a.key}
              title={a.error || a.name}
              className={`relative flex max-w-60 items-center gap-2 overflow-hidden rounded-lg border px-2 py-1.5 text-xs ${
                a.status === "failed" ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-white/10 bg-white/[0.03] text-slate-200"
              }`}
            >
              {a.status === "uploading" ? (
                <Loader2 size={13} className="shrink-0 animate-spin text-violet-500" />
              ) : a.status === "failed" ? (
                <AlertCircle size={13} className="shrink-0" />
              ) : /\.(png|jpe?g|webp|gif)$/i.test(a.name) ? (
                <ImageIcon size={13} className="shrink-0 text-slate-400" />
              ) : (
                <FileText size={13} className="shrink-0 text-slate-400" />
              )}
              <span className="truncate">{a.name}</span>
              {a.status === "ready" && <CheckCircle2 size={13} className="shrink-0 text-emerald-500" aria-label="Indexed" />}
              {a.status === "uploading" && <span className="shrink-0 text-slate-500 tabular-nums">{a.progress}%</span>}
              <button type="button" onClick={() => onRemoveAttachment(a.key)} className="shrink-0 rounded p-0.5 hover:bg-white/10" aria-label={`Remove ${a.name}`}>
                <X size={12} />
              </button>
              {a.status === "uploading" && <div className="absolute bottom-0 left-0 h-0.5 bg-violet-500 transition-all" style={{ width: `${a.progress}%` }} />}
            </div>
          ))}
          {attachments.some((a) => a.status === "failed") && (
            <p className="w-full text-xs text-rose-400">{attachments.find((a) => a.status === "failed").error}</p>
          )}
        </div>
      )}
      <div className="flex items-end gap-1.5 p-1.5 sm:gap-2 sm:p-2">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-full p-2.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
          aria-label="Attach files"
          title="Attach requirements, code, reports or screenshots"
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          data-testid="file-input"
          onChange={(e) => {
            onFiles([...e.target.files]);
            e.target.value = "";
          }}
        />
        <textarea
          ref={ta}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          aria-label="Message QA ChatBot"
          className="max-h-[220px] min-h-[42px] flex-1 resize-none bg-transparent px-1 py-2.5 text-[14.5px] leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        {streaming ? (
          <button type="button" onClick={onStop} className="rounded-full bg-white/10 p-2.5 text-white transition hover:bg-white/20" aria-label="Stop generating">
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="rounded-full bg-gradient-to-br from-violet-500 to-pink-500 p-2.5 text-white shadow-md shadow-violet-500/40 transition hover:brightness-110 disabled:bg-none disabled:bg-violet-500/25 disabled:text-white/60 disabled:shadow-none"
            aria-label="Send message"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
