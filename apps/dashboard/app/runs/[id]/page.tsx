import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: { id: string } }) {
  const admin = createSupabaseAdminClient();

  const { data: run } = await admin
    .from("agent_runs")
    .select("*, agents(kind, name)")
    .eq("id", params.id)
    .single();

  if (!run) return <div className="p-8 text-ink-500">Run hittades inte.</div>;

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

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-3 mb-1">
          <Link href="/runs" className="text-sm text-ink-500 hover:text-ink-800">← Körningar</Link>
        </div>
        <h1 className="text-2xl font-semibold">{ag?.name ?? ag?.kind ?? "Run"}</h1>
        <div className="flex flex-wrap gap-2 mt-2 text-sm text-ink-500">
          <span className={`badge ${
            run.status === "succeeded" ? "badge-green" :
            run.status === "failed"    ? "badge-red"   :
            run.status === "running"   ? "badge-blue"  : "badge-gray"
          }`}>{run.status}</span>
          <span>Trigger: {run.trigger}</span>
          <span>Iterationer: {run.iterations ?? 0}</span>
          <span>Kostnad: ${Number(run.cost_usd ?? 0).toFixed(4)}</span>
          {durationMs !== null && (
            <span>Tid: {durationMs >= 60000
              ? `${Math.round(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
              : `${Math.round(durationMs / 1000)}s`}
            </span>
          )}
          {run.started_at && (
            <span>{formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}</span>
          )}
        </div>
      </header>

      {run.error && (
        <div className="card p-4 bg-red-50 border border-red-200">
          <div className="text-sm font-semibold text-red-700 mb-1">Fel</div>
          <pre className="text-xs text-red-600 whitespace-pre-wrap break-words">{run.error}</pre>
        </div>
      )}

      {run.output && (
        <div className="card p-4">
          <div className="text-sm font-semibold text-ink-700 mb-2">Output</div>
          <pre className="text-xs text-ink-600 whitespace-pre-wrap overflow-x-auto max-h-64">
            {JSON.stringify(run.output, null, 2)}
          </pre>
        </div>
      )}

      <div className="card">
        <div className="p-4 border-b border-ink-100">
          <h2 className="font-semibold">Steg ({steps?.length ?? 0})</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            {!steps?.length
              ? "Inga steg loggade — körningen avbröts troligtvis av Vercel innan while-loopen startade."
              : "Varje API-anrop och verktygsanrop loggas här."}
          </p>
        </div>
        <div className="divide-y divide-ink-100">
          {steps?.map((s) => {
            const p = s.payload as Record<string, unknown>;
            const isToolUse = s.kind === "tool_use";
            const isToolResult = s.kind === "tool_result";
            const isError = isToolResult && Boolean(p?.["error"] || p?.["ok"] === false);
            return (
              <details key={`${s.step_index}-${s.kind}`} className="group">
                <summary className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-ink-50/40 list-none ${isError ? "bg-red-50" : ""}`}>
                  <span className="text-xs text-ink-400 w-6 text-right">{s.step_index}</span>
                  <span className={`badge text-xs ${
                    isToolUse ? "badge-blue" :
                    isToolResult && !isError ? "badge-green" :
                    isError ? "badge-red" :
                    "badge-gray"
                  }`}>{s.kind}</span>
                  <span className="text-sm text-ink-700 truncate flex-1">
                    {isToolUse && `🔧 ${String(p?.["name"] ?? "")}`}
                    {isToolResult && `${isError ? "❌" : "✓"} ${String(p?.["name"] ?? "")} — ${
                      isError
                        ? String(p?.["error"] ?? "error")
                        : String(JSON.stringify(p?.["result"] ?? "")).slice(0, 80)
                    }`}
                    {s.kind === "message" && `🤖 stop=${String(p?.["stop_reason"] ?? "")}`}
                  </span>
                </summary>
                <div className="px-4 pb-3">
                  <pre className="text-xs bg-ink-50 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap max-h-96 text-ink-700">
                    {JSON.stringify(p, null, 2)}
                  </pre>
                </div>
              </details>
            );
          })}
          {!steps?.length && (
            <div className="p-8 text-center text-ink-400 text-sm">
              Inga steg — kör agenten igen och ladda om denna sida.
            </div>
          )}
        </div>
      </div>

      <div className="text-xs text-ink-400">Run ID: {params.id}</div>
    </div>
  );
}
