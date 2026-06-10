"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Mail,
  FileText,
  Users,
  Brain,
  Wrench,
  Kanban,
  Megaphone,
} from "lucide-react";

type FeedItem = {
  id: string;
  kind: string;
  name: string;
  status: "running" | "succeeded" | "failed";
  cost_usd: number | null;
  iterations: number | null;
  started_at: string | null;
  finished_at: string | null;
  summary?: string | null;
};

const KIND_ICON: Record<string, typeof Activity> = {
  invoice:        FileText,
  finance_report: Brain,
  sales:          Mail,
  client_status:  Users,
  dev_support:    Wrench,
  project:        Kanban,
  marketing:      Megaphone,
};

const KIND_BG: Record<string, string> = {
  invoice:        "bg-blue-100 text-blue-700",
  finance_report: "bg-violet-100 text-violet-700",
  sales:          "bg-emerald-100 text-emerald-700",
  client_status:  "bg-purple-100 text-purple-700",
  dev_support:    "bg-orange-100 text-orange-700",
  project:        "bg-pink-100 text-pink-700",
  marketing:      "bg-amber-100 text-amber-700",
};

export function LiveActivityFeed({
  initial,
  pollInterval = 3000,
}: {
  initial: FeedItem[];
  pollInterval?: number;
}) {
  const [items, setItems] = useState<FeedItem[]>(initial);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/feed", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as { items: FeedItem[] };
        const prevIds = new Set(items.map((i) => i.id));
        const hasNew = next.items.some((i) => !prevIds.has(i.id));
        setItems(next.items);
        if (hasNew) {
          setPulse(true);
          setTimeout(() => setPulse(false), 1500);
        }
      } catch {/* ignore */}
    }, pollInterval);
    return () => clearInterval(t);
  }, [items, pollInterval]);

  const hasRunning = items.some((i) => i.status === "running");

  return (
    <div className="card p-6 flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="relative flex items-center justify-center w-5 h-5">
            {hasRunning && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50 animate-ping" />
            )}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${hasRunning ? "bg-emerald-500" : pulse ? "bg-brand" : "bg-ink-300"}`} />
          </div>
          <h2 className="font-semibold text-ink-900">Live-aktivitet</h2>
        </div>
        <span className="text-xs text-ink-400">Uppdateras var 3:e sek</span>
      </div>

      <div className="space-y-1 max-h-[480px] overflow-y-auto -mx-2">
        {items.length === 0 && (
          <div className="py-12 text-center text-ink-400 text-sm">
            Väntar på första körningen…
          </div>
        )}
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind] ?? Activity;
          const iconBg = KIND_BG[item.kind] ?? "bg-ink-100 text-ink-600";
          const when = item.finished_at ?? item.started_at;
          return (
            <div
              key={item.id}
              className="flex items-start gap-3 px-2 py-2.5 rounded-xl hover:bg-ink-50 transition-colors"
            >
              <div className={`p-1.5 rounded-lg shrink-0 ${iconBg}`}>
                <Icon size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-ink-900">{item.name}</span>
                  <StatusPill status={item.status} />
                </div>
                <div className="text-xs text-ink-400 mt-0.5 truncate">
                  {item.summary ??
                    `${item.iterations ?? 0} iter · $${Number(item.cost_usd ?? 0).toFixed(4)}`}
                </div>
              </div>
              <div className="text-xs text-ink-400 whitespace-nowrap shrink-0">
                {when
                  ? formatDistanceToNow(new Date(when), { addSuffix: true, locale: sv })
                  : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: FeedItem["status"] }) {
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full ring-1 ring-blue-200">
        <Loader2 size={10} className="animate-spin" />
        Kör
      </span>
    );
  if (status === "succeeded")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full ring-1 ring-emerald-200">
        <CheckCircle2 size={10} />
        Klar
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full ring-1 ring-red-200">
      <XCircle size={10} />
      Fel
    </span>
  );
}
