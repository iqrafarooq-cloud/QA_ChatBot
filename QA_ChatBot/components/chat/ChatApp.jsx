"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BookOpen, Bug, Code2, Gauge, Globe, Menu, ShieldCheck, Smartphone, Upload, X } from "lucide-react";
import BrandMark from "./BrandMark";
import ConversationList from "./ConversationList";
import Composer, { ACCEPT } from "./Composer";
import Message from "./Message";
import { api, streamChat, uploadFile } from "@/lib/client/api";

// label is what the card shows; prompt is what gets sent.
const SUGGESTIONS = [
  { icon: BookOpen, label: "Explain Boundary Value Analysis", prompt: "Explain Boundary Value Analysis with a practical example" },
  { icon: Code2, label: "Write a Playwright + Cucumber test", prompt: "Write a Playwright + Cucumber login test using Page Object Model" },
  { icon: Globe, label: "What negative test cases should I run for a REST API?", prompt: "What negative test cases should I run for a REST login API?" },
  { icon: Bug, label: "Severity vs priority - explain with examples", prompt: "Severity vs priority - explain with real bug examples" },
  { icon: Smartphone, label: "Create a mobile test checklist for app upgrades", prompt: "Create a mobile test checklist for app upgrades and interruptions" },
  { icon: Gauge, label: "How do I read p90 and p95 in a JMeter report?", prompt: "How do I read p90 and p95 in a JMeter report?" },
];

const ACCEPTED = new Set(ACCEPT.split(",").map((e) => e.slice(1)));
let keySeq = 0;

// The whole app: a full-page QA chatbot. Files attached in a chat stay available to that chat's follow-ups.
export default function ChatApp() {
  const [conversations, setConversations] = useState([]);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [title, setTitle] = useState("New chat");
  const [messages, setMessages] = useState([]);
  const [workspaceId, setWorkspaceId] = useState("");
  // Resolves with the workspace id, so files attached before it loads still upload to the right place.
  const workspaceReady = useRef(null);
  const [ai, setAi] = useState(null);
  const [maxUploadMb, setMaxUploadMb] = useState(20);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [focusKey, setFocusKey] = useState(0);
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const stickToBottom = useRef(true);
  const rootRef = useRef(null);

  const refreshConversations = useCallback(async (q = query) => {
    try {
      setConversations(await api.conversations(q));
    } catch (e) {
      setLoadError(e.message);
    }
  }, [query]);

  // Looks up the built-in workspace once. Also called by uploads, which can happen before effects run.
  const ensureWorkspace = () =>
    (workspaceReady.current ||= api.projects().then((ps) => {
      const id = (ps.find((p) => p.is_default) || ps[0])?.id;
      if (!id) throw new Error("Could not load the workspace. Reload the page and try again.");
      setWorkspaceId(id);
      return id;
    }));

  // Uploads go to the built-in workspace; the AI status decides whether to show the setup banner.
  useEffect(() => {
    ensureWorkspace().catch((e) => setLoadError(e.message));
    api
      .stats()
      .then((s) => {
        setAi(s.ai);
        setMaxUploadMb(s.maxUploadMb);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => refreshConversations(query), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, refreshConversations]);

  // Keep the newest message in view while streaming unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // The welcome screen starts at the top; conversations follow the newest message.
    if (!messages.length) el.scrollTop = 0;
    else if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    setTitle("New chat");
    setMessages([]);
    setAttachments([]);
    setSidebarOpen(false);
    setFocusKey((k) => k + 1);
  }, []);

  const selectConversation = useCallback(async (id) => {
    abortRef.current?.abort();
    setSidebarOpen(false);
    try {
      const { conversation, messages: msgs } = await api.conversation(id);
      setActiveId(id);
      setTitle(conversation.title);
      setMessages(msgs);
      setAttachments([]);
      stickToBottom.current = true;
      setFocusKey((k) => k + 1);
    } catch (e) {
      setLoadError(e.message);
    }
  }, []);

  const patchLastAssistant = (fn) =>
    setMessages((ms) => {
      const i = ms.findLastIndex((m) => m.role === "assistant");
      if (i < 0) return ms;
      const copy = ms.slice();
      copy[i] = fn(copy[i]);
      return copy;
    });

  const run = async (payload) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    stickToBottom.current = true;
    try {
      await streamChat(
        payload,
        (ev) => {
          if (ev.type === "meta") {
            setActiveId(ev.conversationId);
            setTitle(ev.title);
            patchLastAssistant((m) => ({ ...m, liveSources: ev.sources }));
          } else if (ev.type === "delta") patchLastAssistant((m) => ({ ...m, content: m.content + ev.text }));
          else if (ev.type === "done") patchLastAssistant((m) => ({ ...m, id: ev.messageId, sources: ev.sources, liveSources: undefined, streaming: false }));
          else if (ev.type === "error") patchLastAssistant((m) => ({ ...m, id: ev.messageId || m.id, error: ev.message, streaming: false }));
        },
        controller.signal
      );
    } catch (e) {
      if (e.name === "AbortError") patchLastAssistant((m) => ({ ...m, streaming: false, error: m.content ? undefined : "Stopped." }));
      else patchLastAssistant((m) => ({ ...m, streaming: false, error: e.message }));
    } finally {
      patchLastAssistant((m) => (m.streaming ? { ...m, streaming: false } : m));
      setStreaming(false);
      abortRef.current = null;
      refreshConversations();
    }
  };

  const send = (text = input) => {
    const ready = attachments.filter((a) => a.status === "ready");
    const content = text.trim();
    if ((!content && !ready.length) || streaming) return;
    const userMsg = {
      id: `tmp-u-${Date.now()}`,
      role: "user",
      content: content || "Please analyze the attached file(s).",
      attachments: ready.map((a) => ({ id: a.doc.id, fileName: a.name, kind: a.doc.kind, meta: a.doc.meta?.stats || a.doc.meta?.overall ? a.doc.meta : undefined })),
    };
    setMessages((ms) => [...ms, userMsg, { id: `tmp-a-${Date.now()}`, role: "assistant", content: "", streaming: true }]);
    setInput("");
    setAttachments([]);
    run({ message: content, attachmentIds: ready.map((a) => a.doc.id), conversationId: activeId });
  };

  const regenerate = () => {
    if (streaming || !activeId) return;
    setMessages((ms) => {
      const copy = ms[ms.length - 1]?.role === "assistant" ? ms.slice(0, -1) : ms.slice();
      return [...copy, { id: `tmp-a-${Date.now()}`, role: "assistant", content: "", streaming: true }];
    });
    run({ conversationId: activeId, regenerate: true });
  };

  const addFiles = (files) => {
    for (const file of files.slice(0, 10)) {
      const key = ++keySeq;
      const ext = file.name.split(".").pop().toLowerCase();
      const base = { key, name: file.name, progress: 0 };
      if (!ACCEPTED.has(ext)) {
        setAttachments((as) => [...as, { ...base, status: "failed", error: `"${file.name}": .${ext} files are not supported.` }]);
        continue;
      }
      if (file.size > maxUploadMb * 1048576) {
        setAttachments((as) => [...as, { ...base, status: "failed", error: `"${file.name}" is larger than the ${maxUploadMb} MB limit.` }]);
        continue;
      }
      setAttachments((as) => [...as, { ...base, status: "uploading" }]);
      const set = (patch) => setAttachments((as) => as.map((a) => (a.key === key ? { ...a, ...patch } : a)));
      Promise.resolve(workspaceId || ensureWorkspace())
        .then((id) => uploadFile(id, file, (p) => set({ progress: p })))
        .then((doc) => (doc.status === "ready" ? set({ status: "ready", doc, progress: 100 }) : set({ status: "failed", error: `"${file.name}": ${doc.error}` })))
        .catch((e) => set({ status: "failed", error: `"${file.name}": ${e.message}` }));
    }
  };

  const removeAttachment = (key) => {
    const a = attachments.find((x) => x.key === key);
    // Unsent attachments are deleted so they don't linger on the server.
    if (a?.status === "ready") api.deleteDocument(a.doc.id).catch(() => {});
    setAttachments((as) => as.filter((x) => x.key !== key));
  };

  return (
    <div className="qa-backdrop flex min-h-dvh items-center justify-center">
    <main
      ref={rootRef}
      aria-label="QA ChatBot"
      className="qa-panel relative flex overflow-hidden bg-[#120d24]/90 shadow-[0_30px_100px_-20px_rgba(147,51,234,0.5)] ring-1 ring-white/10 backdrop-blur-xl animate-pop"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => !rootRef.current.contains(e.relatedTarget) && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles([...e.dataTransfer.files]);
      }}
    >
      {/* Conversations sidebar */}
      <aside
        className={`absolute inset-y-0 left-0 z-20 w-72 border-r border-white/10 bg-gradient-to-b from-[#1d1638] via-[#1a1530] to-[#121a33] transition-transform ${sidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm ring-1 ring-white/15">
            <BrandMark size={20} />
          </div>
          <span className="font-semibold tracking-tight text-slate-100">QA ChatBot</span>
          <button type="button" className="ml-auto rounded p-1 text-slate-500 hover:bg-white/10" onClick={() => setSidebarOpen(false)} aria-label="Close chat list">
            <X size={16} />
          </button>
        </div>
        <div className="h-[calc(100%-57px)]">
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            query={query}
            onQuery={setQuery}
            onSelect={selectConversation}
            onNew={newChat}
            onRename={async (id, t) => {
              await api.renameConversation(id, t).catch((e) => setLoadError(e.message));
              if (id === activeId) setTitle(t);
              refreshConversations();
            }}
            onDelete={async (id) => {
              await api.deleteConversation(id).catch((e) => setLoadError(e.message));
              if (id === activeId) newChat();
              refreshConversations();
            }}
          />
        </div>
      </aside>
      {sidebarOpen && <div className="absolute inset-0 z-10 bg-black/40" onClick={() => setSidebarOpen(false)} />}

      {/* Main chat column */}
      <section className="flex min-w-0 flex-1 flex-col bg-transparent">
        <header className="flex items-center gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5 sm:py-3.5">
          <button type="button" className="-ml-1 rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => setSidebarOpen(true)} aria-label="Open chat list">
            <Menu size={20} />
          </button>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-900/40 ring-1 ring-white/15">
            <BrandMark size={27} />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="text-[15px] font-semibold text-white sm:text-base">QA ChatBot</h1>
            <p className="truncate text-xs text-slate-400 sm:text-[13px]" data-testid="chat-title">
              {title}
            </p>
          </div>
          {ai && (
            <span
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${ai.configured ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/25" : "bg-amber-500/10 text-amber-200 ring-amber-400/25"}`}
              data-testid="ai-status"
            >
              <span className={`size-2 rounded-full ${ai.configured ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" : "bg-amber-400"}`} />
              {ai.configured ? "Online" : "Setup needed"}
            </span>
          )}
        </header>

        {ai && !ai.configured && (
          <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200" role="status">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            <span>
              AI provider not configured. Add <code className="rounded bg-amber-500/20 px-1">{ai.keyName}</code> to <code className="rounded bg-amber-500/20 px-1">.env.local</code> and restart.
            </span>
          </div>
        )}
        {loadError && (
          <div className="flex items-center gap-2 border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-300" role="alert">
            <AlertTriangle size={14} /> {loadError}
            <button type="button" onClick={() => setLoadError("")} className="ml-auto" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="qa-scroll flex-1 overflow-y-auto"
        >
          {messages.length === 0 ? (
            <Welcome onPick={(t) => send(t)} disabled={streaming} />
          ) : (
            <div className="space-y-6 px-4 py-5 sm:px-6">
              {messages.map((m, i) => (
                <Message key={m.id} message={m} isLast={i === messages.length - 1} onRegenerate={regenerate} busy={streaming} />
              ))}
            </div>
          )}
        </div>

        <div className="w-full px-3 pt-2 pb-3 sm:px-6 sm:pb-4">
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => send()}
            onStop={() => abortRef.current?.abort()}
            onFiles={addFiles}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
            streaming={streaming}
            autoFocusKey={focusKey}
            placeholder="Ask a QA or testing question…"
          />
          <p className="mt-2.5 flex items-center justify-center gap-1.5 text-xs text-slate-400" title="QA ChatBot answers software testing and QA questions only">
            <ShieldCheck size={14} className="shrink-0 text-emerald-400" />
            QA ChatBot · Your QA Learning Partner
          </p>
        </div>
      </section>

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-violet-400 bg-violet-950/90 text-violet-300">
          <Upload size={28} />
          <p className="text-sm font-medium">Drop files to attach them to this chat</p>
        </div>
      )}
    </main>
    </div>
  );
}

function Welcome({ onPick, disabled }) {
  return (
    <div className="qa-welcome flex min-h-full flex-col justify-center px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-col items-center text-center">
        <div className="qa-welcome-icon rounded-full bg-violet-500/10 p-2.5 ring-1 ring-violet-400/15 sm:p-3">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-xl shadow-violet-950/50 ring-1 ring-white/15 sm:size-[72px] sm:rounded-3xl">
            <BrandMark className="size-10 sm:size-[52px]" strokeWidth={1.8} />
          </div>
        </div>
        <h2 className="mt-4 text-lg leading-snug font-bold tracking-tight text-white sm:text-2xl">
          Hi, I&apos;m QA ChatBot.
          <br />
          How can I help with your testing?
        </h2>
        <p className="mt-2 max-w-md text-[13px] text-slate-400 sm:text-[15px]">Your Software QA assistant. Ask in English or Roman Urdu.</p>
      </div>
      <div className="qa-welcome-cards mt-5 border-t border-white/10 pt-5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => onPick(prompt)}
              title={prompt}
              className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-left text-[13px] leading-snug text-slate-100 transition hover:border-violet-400/50 hover:bg-violet-500/10 sm:px-4 sm:py-3.5 sm:text-sm"
            >
              <Icon className="size-5 shrink-0 text-violet-400 transition group-hover:text-fuchsia-400 sm:size-6" strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
