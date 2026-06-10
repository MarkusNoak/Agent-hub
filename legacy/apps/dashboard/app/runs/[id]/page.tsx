import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { formatDistanceToNow, format } from "date-fns";
import { sv } from "date-fns/locale";
import Link from "next/link";
import { AlertCircle, Cpu, Search } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  succeeded: "Lyckades",
  failed: "Misslyckades",
  running: "Kör…",
};

const STATUS_BADGE: Record<string, string> = {
  succeeded: "badge-green",
  failed: "badge-red",
  running: "badge-blue",
};

export default async function RunDetailPage({ params }: { params: { id: string } }) {
  const admin = createSupabaseAdminClient();

  const { data: run } = await admin
    .from("agent_runs")
    .select("*, agents(kind, name)")
    .eq("id", params.id)
    .single();

  if (!run) {
    return (
      <div className="space-y-6">
        <Link href="/runs" className="text-sm text-ink-400 hover:text-ink-700 transition-colors">← Körningar</Link>
        <div className="card p-16 text-center">
          <div className="w-12 h-12 rounded-full bg-ink-100 flex items-center justify-center mx-auto mb-3">
              <Search size={22} strokeWidth={1.5} className="text-ink-400" />
            </div>
          <div className="text-ink-700 font-semibold">Körning hittades inte</div>
          <div className="text-ink-400 text-sm mt-1">Kontrollera att ID:t är korrekt.</div>
        </div>
      </div>
    );
  }

  const { data: steps } = await admin
    .from("agent_run_steps")
    .select("step_index, kind, payload, created_at")
    .eq("run_id", params.id)
    .order("step_index", { ascending: true });

  const ag = run.agents as unknown as { kind: string; name: string } | null;
  const durationMs =
    run.started_at && run.finished_at
      ? new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
      : run.started_at
      ? Date.now() - new Date(run.started_at).getTime()
      : null;

  const duration = durationMs !== null
    ? durationMs >= 60000
      ? `${Math.round(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
      : `${Math.round(durationMs / 1000)}s`
    : null;

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div>
        <Link
          href="/runs"
          className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700 transition-colors mb-4"
        >
          ← Alla körningar
        </Link>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink-900 leading-tight">
          {ag?.name ?? ag?.kind ?? "Körning"}
        </h1>
        <p className="text-ink-400 text-sm mt-1 font-medium font-mono">{params.id}</p>
      </div>

      {/* Meta cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="section-label mb-2">Status</div>
          <span className={`badge ${STATUS_BADGE[run.status as string] ?? "badge-gray"}`}>
            {STATUS_LABEL[run.status as string] ?? run.status}
          </span>
        </div>
        <div className="card p-4">
          <div className="section-label mb-2">Kostnad</div>
          <div className="stat-sm">
            <span className="text-sm font-bold text-ink-400 mr-0.5">$</span>{Number(run.cost_usd ?? 0).toFixed(4)}
          </div>
        </div>
        <div className="card p-4">
          <div className="section-label mb-2">Iterationer</div>
          <div className="stat-sm">
            {run.iterations ?? 0}
          </div>
        </div>
        <div className="card p-4">
          <div className="section-label mb-2">Tid</div>
          <div className="stat-sm">
            {duration ?? "—"}
          </div>
          {run.started_at && (
            <div className="text-xs text-ink-400 font-medium mt-1">
              {formatDistanceToNow(new Date(run.started_at), { addSuffix: true, locale: sv })}
            </div>
          )}
        </div>
      </div>

      {/* Trigger + timestamps */}
      <div className="card p-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="section-label mb-1">Trigger</div>
            <span className="font-medium text-ink-700">{run.trigger ?? "—"}</span>
          </div>
          <div>
            <div className="section-label mb-1">Startade</div>
            <span className="font-medium text-ink-700">
              {run.started_at ? format(new Date(run.started_at), "d MMM HH:mm:ss", { locale: sv }) : "—"}
            </span>
          </div>
          <div>
            <div className="section-label mb-1">Avslutade</div>
            <span className="font-medium text-ink-700">
              {run.finished_at ? format(new Date(run.finished_at), "d MMM HH:mm:ss", { locale: sv }) : run.status === "running" ? "Pågår…" : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Error */}
      {run.error && (
        <div className="card p-5 border border-red-100 bg-red-50/60">
          <div className="section-label text-red-600 mb-2">Fel</div>
          <pre className="text-sm text-red-700 whitespace-pre-wrap break-words leading-relaxed">{run.error}</pre>
        </div>
      )}

      {/* Output */}
      {run.output && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-ink-100">
            <div className="section-label">Output</div>
          </div>
          <div className="p-5">
            <pre className="text-xs text-ink-600 whitespace-pre-wrap overflow-x-auto max-h-64 leading-relaxed bg-ink-50/60 rounded-xl p-4">
              {JSON.stringify(run.output, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Steps */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100">
          <div className="section-label">Steg ({steps?.length ?? 0})</div>
          <p className="text-xs text-ink-400 mt-0.5">
            {!steps?.length
              ? "Inga steg loggade — körningen avbröts troligtvis av Vercel innan loopen startade."
              : "Varje API-anrop och verktygsanrop loggas här."}
          </p>
        </div>
        <div className="divide-y divide-ink-50">
          {steps?.map((s) => {
            const p = s.payload as Record<string, unknown>;
            const isToolUse = s.kind === "tool_use";
            const isToolResult = s.kind === "tool_result";
            const isError = isToolResult && Boolean(p?.["error"] || p?.["ok"] === false);
            return (
              <details key={`${s.step_index}-${s.kind}`} className="group">
                <summary className={`flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-brand-muted/40 transition-colors list-none ${isError ? "bg-red-50/80" : ""}`}>
                  <span className="text-xs text-ink-300 w-5 text-right font-mono tabular-nums shrink-0">{s.step_index}</span>
                  <span className={`badge text-xs shrink-0 ${
                    isToolUse ? "badge-blue" :
                    isToolResult && !isError ? "badge-green" :
                    isError ? "badge-red" :
                    "badge-gray"
                  }`}>{s.kind}</span>
                  <span className="text-sm text-ink-700 truncate flex-1 font-medium">
                    {isToolUse && `🔧 ${String(p?.["name"] ?? "")}`}
                    {isToolResult && `${isError ? "✕" : "✓"} ${String(p?.["name"] ?? "")} — ${
                      isError
                        ? String(p?.["error"] ?? "error")
                        : String(JSON.stringify(p?.["result"] ?? "")).slice(0, 80)
                    }`}
                    {s.kind === "message" && `stop_reason: ${String(p?.["stop_reason"] ?? "")}`}
                  </span>
                  <span className="text-xs text-ink-300 shrink-0 group-open:rotate-90 transition-transform">›</span>
                </summary>
                <div className="px-5 pb-4">
                  <pre className="text-xs bg-[#111009] text-[#d4c89a] rounded-xl p-4 overflow-x-auto whitespace-pre-wrap max-h-80 leading-relaxed">
                    {JSON.stringify(p, null, 2)}
                  </pre>
                </div>
              </details>
            );
          })}
          {!steps?.length && (
            <div className="py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-ink-100 flex items-center justify-center mx-auto mb-3">
                <Cpu size={20} strokeWidth={1.5} className="text-ink-400" />
              </div>
              <div className="text-ink-500 text-sm font-medium">Inga steg loggade</div>
              <div className="text-ink-300 text-xs mt-1">Kör agenten igen och ladda om sidan.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
