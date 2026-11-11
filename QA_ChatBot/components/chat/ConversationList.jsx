"use client";

import { useState } from "react";
import { Check, MessageSquare, Pencil, Plus, Search, Trash2, X } from "lucide-react";

export default function ConversationList({ conversations, activeId, onSelect, onNew, onRename, onDelete, query, onQuery }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(null);

  const groups = groupByDate(conversations);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-pink-500 px-3 py-2 text-sm font-medium text-white shadow-md shadow-pink-500/20 transition hover:brightness-105"
        >
          <Plus size={16} /> New chat
        </button>
        <label className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-slate-500 ring-1 ring-white/10 focus-within:ring-violet-300">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
          />
        </label>
      </div>
      <nav className="qa-scroll flex-1 overflow-y-auto px-2 pb-3" aria-label="Conversations">
        {!conversations.length && <p className="px-2 py-6 text-center text-xs text-slate-400">{query ? "No matching chats" : "Your chats will appear here"}</p>}
        {groups.map(([label, items]) => (
          <div key={label} className="mb-2">
            <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wider text-violet-400 uppercase">{label}</div>
            {items.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-lg pr-1 transition ${c.id === activeId ? "bg-white/5 text-violet-300 shadow-sm ring-1 ring-white/10" : "text-slate-300 hover:bg-white/5"}`}
              >
                {editing === c.id ? (
                  <form
                    className="flex flex-1 items-center gap-1 py-1 pl-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (draft.trim()) onRename(c.id, draft.trim());
                      setEditing(null);
                    }}
                  >
                    <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setEditing(null))} className="w-full rounded bg-white/5 px-1.5 py-1 text-sm text-slate-100 ring-1 ring-violet-300 focus:outline-none" aria-label="Conversation title" />
                    <button type="submit" className="rounded p-1 hover:bg-white/10" aria-label="Save title"><Check size={14} /></button>
                  </form>
                ) : confirming === c.id ? (
                  <div className="flex flex-1 items-center justify-between gap-1 py-1.5 pl-2 text-xs">
                    <span className="text-rose-400">Delete chat?</span>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => onDelete(c.id)} className="rounded bg-rose-500/90 px-2 py-0.5 text-white hover:bg-rose-500">Delete</button>
                      <button type="button" onClick={() => setConfirming(null)} className="rounded p-0.5 hover:bg-white/10" aria-label="Cancel"><X size={14} /></button>
                    </span>
                  </div>
                ) : (
                  <>
                    <button type="button" onClick={() => onSelect(c.id)} className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 text-left text-[13px]">
                      <MessageSquare size={14} className="shrink-0 opacity-60" />
                      <span className="truncate">{c.title}</span>
                    </button>
                    <span className="flex shrink-0 gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                      <button type="button" onClick={() => (setEditing(c.id), setDraft(c.title))} className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-violet-200" aria-label={`Rename ${c.title}`}><Pencil size={13} /></button>
                      <button type="button" onClick={() => setConfirming(c.id)} className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-rose-300" aria-label={`Delete ${c.title}`}><Trash2 size={13} /></button>
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

function groupByDate(items) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const buckets = { Today: [], Yesterday: [], "Previous 7 days": [], Older: [] };
  for (const c of items) {
    const t = new Date(c.updated_at).getTime();
    if (t >= startOfDay.getTime()) buckets.Today.push(c);
    else if (t >= startOfDay.getTime() - day) buckets.Yesterday.push(c);
    else if (t >= startOfDay.getTime() - 7 * day) buckets["Previous 7 days"].push(c);
    else buckets.Older.push(c);
  }
  return Object.entries(buckets).filter(([, v]) => v.length);
}
