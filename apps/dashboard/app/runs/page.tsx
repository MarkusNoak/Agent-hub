import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { formatDistanceToNow } from "date-fns";
import { RunsRefresher } from "./RunsRefresher";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const { data: runs } = await supa
    .from("agent_runs")
    .select("id, status, trigger, cost_usd, iterations, started_at, finished_at, error, agents(kind, name)")
    .eq("tenant_id", tenant.id)
    .order("started_at", { ascending: false })
    .limit(50);

  const hasRunning = runs?.some((r) => r.status === "running") ?? false;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Runs</h1>
          <p className="text-ink-500">
            Every agent invocation — cron, webhook, or manual.
            {hasRunning && (
              <span className="ml-2 text-blue-600 text-sm animate-pulse">● Uppdateras var 5:e sekund</span>
            )}
          </p>
        </div>
      </header>

      {/* Silently refreshes the page while a run is active */}
      <RunsRefresher hasRunning={hasRunning} />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-500 border-b border-ink-100">
            <tr>
              <th className="p-3">Agent</th>
              <th className="p-3">Trigger</th>
              <th className="p-3">Status</th>
              <th className="p-3">Iter</th>
              <th className="p-3">Kostnad</th>
              <th className="p-3">Tid</th>
              <th className="p-3">När</th>
            </tr>
          </thead>
          <tbody>
            {runs?.map((r) => {
              const ag = r.agents as unknown as { kind: string; name: string } | null;
              const durationMs =
                r.started_at && r.finished_at
                  ? new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()
                  : r.started_at
                  ? Date.now() - new Date(r.started_at).getTime()
                  : null;
              const duration = durationMs !== null
                ? durationMs >= 60000
                  ? `${Math.round(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
                  : `${Math.round(durationMs / 1000)}s`
                : "—";
              return (
                <tr key={r.id} className="border-t border-ink-100 hover:bg-ink-50/40">
                  <td className="p-3">
                    <div className="font-medium">{ag?.name ?? ag?.kind ?? "—"}</div>
                    <code className="text-xs text-ink-500">{ag?.kind}</code>
                  </td>
                  <td className="p-3 text-ink-500">{r.trigger}</td>
                  <td className="p-3">
                    <span className={`badge ${
                      r.status === "succeeded" ? "badge-green" :
                      r.status === "failed"    ? "badge-red"   :
                      r.status === "running"   ? "badge-blue"  : "badge-gray"
                    }`}>
                      {r.status === "running" ? "⟳ running" : r.status}
                    </span>
                    {r.error && (
                      <p className="text-xs text-red-600 mt-1 max-w-xs truncate" title={r.error}>
                        {r.error}
                      </p>
                    )}
                  </td>
                  <td className="p-3">{r.iterations ?? "—"}</td>
                  <td className="p-3">${Number(r.cost_usd ?? 0).toFixed(4)}</td>
                  <td className="p-3 text-ink-500">{duration}</td>
                  <td className="p-3 text-ink-500 whitespace-nowrap">
                    {r.started_at
                      ? formatDistanceToNow(new Date(r.started_at), { addSuffix: true })
                      : "—"}
                  </td>
                </tr>
              );
            })}
            {!runs?.length && (
              <tr>
                <td colSpan={7} className="p-12 text-center text-ink-500">
                  Inga körningar ännu. Gå till /agents och klicka Run now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
