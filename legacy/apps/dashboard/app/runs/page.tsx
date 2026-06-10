import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import Link from "next/link";
import { RunsRefresher } from "./RunsRefresher";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  succeeded: "badge-green",
  failed:    "badge-red",
  running:   "badge-blue",
};

const STATUS_LABEL: Record<string, string> = {
  succeeded: "Lyckades",
  failed:    "Misslyckades",
  running:   "Kör…",
};

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
  const totalCost = runs?.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <RunsRefresher hasRunning={hasRunning} />

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink-900 leading-tight">
            Körningar
          </h1>
          <p className="text-ink-400 text-sm mt-1 font-medium">
            {runs?.length ?? 0} senaste · ${totalCost.toFixed(3)} totalt
            {hasRunning && (
              <span className="ml-3 inline-flex items-center gap-1.5 text-blue-600">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
                </span>
                Uppdateras live
              </span>
            )}
          </p>
        </div>
      </header>

      <div className="card overflow-hidden">
        <table className="table-premium">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Trigger</th>
              <th>Status</th>
              <th className="text-right">Iter</th>
              <th className="text-right">Kostnad</th>
              <th className="text-right">Tid</th>
              <th className="text-right">När</th>
            </tr>
          </thead>
          <tbody>
            {runs?.map((r) => {
              const ag = r.agents as unknown as { kind: string; name: string } | null;
              const durationMs =
                r.started_at && r.finished_at
                  ? new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()
                  : r.started_at && r.status === "running"
                  ? Date.now() - new Date(r.started_at).getTime()
                  : null;
              const duration = durationMs !== null
                ? durationMs >= 60000
                  ? `${Math.round(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
                  : `${Math.round(durationMs / 1000)}s`
                : "—";

              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/runs/${r.id}`} className="font-semibold text-ink-900 hover:text-brand transition-colors">
                      {ag?.name ?? ag?.kind ?? "—"}
                    </Link>
                    <div className="text-xs text-ink-400 mt-0.5 font-mono">{ag?.kind}</div>
                  </td>
                  <td>
                    <span className="text-xs text-ink-500 font-medium">{r.trigger}</span>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[r.status as string] ?? "badge-gray"}`}>
                      {STATUS_LABEL[r.status as string] ?? r.status}
                    </span>
                    {r.error && (
                      <p className="text-xs text-red-500 mt-1 max-w-xs break-words leading-snug">
                        {r.error.slice(0, 100)}
                      </p>
                    )}
                  </td>
                  <td className="text-right tabular-nums text-ink-700 font-medium">
                    {r.iterations ?? "—"}
                  </td>
                  <td className="text-right tabular-nums text-ink-700 font-medium">
                    ${Number(r.cost_usd ?? 0).toFixed(4)}
                  </td>
                  <td className="text-right tabular-nums text-ink-500">
                    {duration}
                  </td>
                  <td className="text-right text-ink-400 text-xs whitespace-nowrap">
                    {r.started_at
                      ? formatDistanceToNow(new Date(r.started_at), { addSuffix: true, locale: sv })
                      : "—"}
                  </td>
                </tr>
              );
            })}
            {!runs?.length && (
              <tr>
                <td colSpan={7} className="py-20 text-center">
                  <div className="text-ink-400 text-sm font-medium">Inga körningar ännu</div>
                  <div className="text-ink-300 text-xs mt-1">Gå till Agenter och klicka Kör nu</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
