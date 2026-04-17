"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
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
  invoice: FileText,
  finance_report: FileText,
  sales: Mail,
  client_status: Users,
  dev_support: Wrench,
  project: Kanban,
  marketing: Megaphone,
};

const KIND_COLOR: Record<string, string> = {
  invoice: "bg-blue-50 text-blue-700",
  finance_report: "bg-indigo-50 text-indigo-700",
  sales: "bg-green-50 text-green-700",
  client_status: "bg-purple-50 text-purple-700",
  dev_support: "bg-orange-50 text-orange-700",
  project: "bg-pink-50 text-pink-700",
  marketing: "bg-yellow-50 text-yellow-700",
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
          setTimeout(() => setPulse(false), 1200);
        }
      } catch {
        /* ignore */
      }
    }, pollInterval);
    return () => clearInterval(t);
  }, [items, pollInterval]);

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div
              className={`h-2 w-2 rounded-full bg-green-500 ${
                pulse ? "animate-ping absolute" : ""
              }`}
            />
            <div className="h-2 w-2 rounded-full bg-green-500" />
          </div>
          <h2 className="font-semibold">Live activity</h2>
        </div>
        <span className="text-xs text-ink-500">Auto-refreshing every 3s</span>
      </div>

      <div className="space-y-2 max-h-[520px] overflow-y-auto">
        {items.length === 0 && (
          <div className="py-12 text-center text-ink-500 text-sm">
            Waiting for first agent run…
          </div>
        )}
        {items.map((i) => {
          const Icon = KIND_ICON[i.kind] ?? Activity;
          const color = KIND_COLOR[i.kind] ?? "bg-ink-100 text-ink-700";
          const when = i.finished_at ?? i.started_at;
          return (
            <div
              key={i.id}
              className="flex items-start gap-3 p-3 rounded-lg hover:bg-ink-50 transition-colors"
            >
              <div className={`p-2 rounded-lg ${color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{i.name}</span>
                  <StatusBadge status={i.status} />
                </div>
                <div className="text-xs text-ink-500 mt-0.5 truncate">
                  {i.summary ?? `${i.iterations ?? 0} iterations · $${Number(i.cost_usd ?? 0).toFixed(4)}`}
                </div>
              </div>
              <div className="text-xs text-ink-500 whitespace-nowrap">
                {when ? formatDistanceToNow(new Date(when), { addSuffix: true }) : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: FeedItem["status"] }) {
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-blue-700">
        <Loader2 className="h-3 w-3 animate-spin" /> running
      </span>
    );
  if (status === "succeeded")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <CheckCircle2 className="h-3 w-3" /> done
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-700">
      <XCircle className="h-3 w-3" /> failed
    </span>
  );
}
