"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, ChevronDown, Loader2, Code2, Trash2 } from "lucide-react";

interface Fix {
  summary: string;
  detail: string;
  references: string[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  fixes?: Fix[];
  next_action?: string;
  cost_usd?: number;
  error?: boolean;
  loading?: boolean;
}

const SUGGESTED = [
  "Hur sätter jag upp en ny Next.js-route med Supabase auth?",
  "Varför misslyckas min Vercel-deploy med edge runtime error?",
  "Hur fungerar vår agent-loop och hur loggar jag steg?",
  "Bästa praxis för TypeScript strict mode i monorepo?",
];

const MAX_MESSAGES = 120;

function storageKey(userId: string, tenantId: string) {
  return `chat_${userId}_${tenantId}`;
}

function loadHistory(userId: string, tenantId: string): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(userId, tenantId));
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(userId: string, tenantId: string, messages: Message[]) {
  try {
    const toSave = messages
      .filter((m) => !m.loading)
      .slice(-MAX_MESSAGES);
    localStorage.setItem(storageKey(userId, tenantId), JSON.stringify(toSave));
  } catch {
    // quota exceeded — ignore
  }
}

export default function ChatUI({ userId, tenantId }: { userId: string; tenantId: string }) {
  const [messages, setMessages] = useState<Message[]>(() => loadHistory(userId, tenantId));
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    saveHistory(userId, tenantId, messages);
  }, [messages, userId, tenantId]);

  function clearHistory() {
    setMessages([]);
    try { localStorage.removeItem(storageKey(userId, tenantId)); } catch { /* ignore */ }
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: question };
    const loadingMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: "", loading: true };

    setMessages((m) => [...m, userMsg, loadingMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });

      const data = (await res.json()) as {
        answer?: string;
        fixes?: Fix[];
        next_action?: string;
        cost_usd?: number;
        error?: string;
      };

      const assistantMsg: Message = {
        id: loadingMsg.id,
        role: "assistant",
        content: data.answer ?? data.error ?? "Inget svar.",
        fixes: data.fixes,
        next_action: data.next_action ?? undefined,
        cost_usd: data.cost_usd,
        error: Boolean(data.error),
      };

      setMessages((m) => m.map((msg) => (msg.id === loadingMsg.id ? assistantMsg : msg)));
    } catch (e) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === loadingMsg.id
            ? { ...msg, loading: false, content: `Fel: ${(e as Error).message}`, error: true }
            : msg,
        ),
      );
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-h-[900px]">

      {/* Header */}
      <div className="shrink-0 mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(145deg, #1e3a5f, #1a3050)",
              boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.1), 0 2px 8px rgb(30 58 95 / 0.3)",
            }}
          >
            <Code2 size={18} strokeWidth={1.75} style={{ color: "rgb(147 197 253)" }} />
          </div>
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink-900 leading-tight">Dev Support</h1>
            <p className="text-xs text-ink-400 font-medium mt-0.5">Ställ frågor om kod, arkitektur eller blockers</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearHistory}
            className="btn btn-ghost text-xs gap-1.5 text-ink-400 hover:text-red-500 transition-colors mt-1"
            title="Rensa historik"
          >
            <Trash2 size={13} />
            <span className="hidden sm:inline">Rensa</span>
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 no-scrollbar">
        {messages.length === 0 && (
          <div className="pt-8">
            <p className="text-sm text-ink-400 font-medium mb-4 text-center">Förslag:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="card p-3.5 text-left text-sm text-ink-600 hover:text-ink-900 transition-colors cursor-pointer group"
                >
                  <span className="text-brand mr-1.5 text-xs font-bold group-hover:opacity-100 opacity-60 transition-opacity">›</span>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
              style={
                msg.role === "assistant"
                  ? { background: "linear-gradient(145deg, #1e3a5f, #1a3050)", boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.1)" }
                  : { background: "linear-gradient(145deg, #f0b030, #e8960c)", boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.25)" }
              }
            >
              {msg.role === "assistant"
                ? <Bot size={13} style={{ color: "rgb(147 197 253)" }} strokeWidth={1.75} />
                : <User size={13} style={{ color: "#111009" }} strokeWidth={2} />}
            </div>

            <div className={`flex-1 max-w-[85%] ${msg.role === "user" ? "items-end flex flex-col" : ""}`}>
              {msg.loading ? (
                <div className="card p-4 inline-flex items-center gap-2 text-sm text-ink-400">
                  <Loader2 size={14} className="animate-spin" />
                  Tänker…
                </div>
              ) : (
                <>
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "text-[#111009] font-medium"
                        : msg.error
                        ? "bg-red-50 text-red-700 border border-red-100"
                        : "card text-ink-700"
                    }`}
                    style={
                      msg.role === "user"
                        ? {
                            background: "linear-gradient(145deg, #f0b030, #e8960c)",
                            boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.25), 0 1px 3px rgb(232 160 32 / 0.3)",
                          }
                        : undefined
                    }
                  >
                    {msg.content}
                  </div>

                  {msg.fixes && msg.fixes.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {msg.fixes.map((fix, i) => (
                        <FixCard key={i} fix={fix} index={i} />
                      ))}
                    </div>
                  )}

                  {(msg.next_action || msg.cost_usd !== undefined) && (
                    <div className="mt-2 flex items-center gap-3 text-xs text-ink-300">
                      {msg.next_action && <span>{msg.next_action}</span>}
                      {msg.cost_usd !== undefined && (
                        <span className="font-mono">${msg.cost_usd.toFixed(4)}</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 pt-3 border-t border-ink-100">
        <div className="card p-1 flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Skriv din fråga… (⌘↵ skickar)"
            rows={1}
            disabled={loading}
            className="flex-1 resize-none bg-transparent border-none outline-none text-sm text-ink-800 placeholder:text-ink-300 py-2.5 px-3 leading-relaxed disabled:opacity-50"
            style={{ maxHeight: 120, minHeight: 40 }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 120) + "px";
            }}
          />
          <button
            type="button"
            disabled={!input.trim() || loading}
            onClick={() => void send(input)}
            className="btn btn-primary shrink-0 mb-1 mr-1 px-3 py-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
        <p className="text-[10px] text-ink-300 text-center mt-2 font-medium">
          Agenten kan söka i era GitHub-issues och läsa intern dokumentation
        </p>
      </div>
    </div>
  );
}

function FixCard({ fix, index }: { fix: Fix; index: number }) {
  const [open, setOpen] = useState(index === 0);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-brand-muted/30 transition-colors"
      >
        <span
          className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{ background: "rgb(232 160 32 / 0.12)", color: "#e8a020" }}
        >
          {index + 1}
        </span>
        <span className="text-sm font-semibold text-ink-800 flex-1 text-left">{fix.summary}</span>
        <ChevronDown
          size={13}
          className="text-ink-300 shrink-0 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-ink-50">
          <p className="text-sm text-ink-600 leading-relaxed mt-3 whitespace-pre-wrap">{fix.detail}</p>
          {fix.references.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {fix.references.map((ref) => (
                <a
                  key={ref}
                  href={ref.startsWith("http") ? ref : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="badge badge-blue text-[10px] hover:opacity-80 transition-opacity"
                >
                  {ref.replace(/^https?:\/\//, "").slice(0, 50)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
