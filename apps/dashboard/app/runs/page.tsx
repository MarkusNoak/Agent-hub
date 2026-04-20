import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const { data: runs } = await supa
    .from("agent_runs")
    .select("id, status, trigger, cost_usd, iterations, started_at, finished_at, error, agents(kind, name)")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Runs</h1>
        <p className="text-ink-500">Every agent invocation — cron, webhook, or manual.</p>
      </header>

      <div className="card">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-500 border-b border-ink-100">
            <tr>
              <th className="p-3">Agent</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Iter</th>
              <th>Cost</th>
              <th>Duration</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {runs?.map((r) => {
              const ag = r.agents as unknown as { kind: string; name: string } | null;
              const duration = r.started_at && r.finished_at
                ? `${Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000)}s`
                : "—";
              return (
                <tr key={r.id} className="border-t border-ink-100">
                  <td className="p-3">
                    <div className="font-medium">{ag?.name ?? ag?.kind}</div>
                    <code className="text-xs text-ink-500">{ag?.kind}</code>
                  </td>
                  <td className="text-ink-500">{r.trigger}</td>
                  <td>
                    <span className={`badge ${
                      r.status === "succeeded" ? "badge-green" :
                      r.status === "failed" ? "badge-red" :
                      r.status === "running" ? "badge-blue" : "badge-gray"
                    }`}>{r.status}</span>
                  </td>
                  <td>{r.iterations}</td>
                  <td>${Number(r.cost_usd ?? 0).toFixed(4)}</td>
                  <td className="text-ink-500">{duration}</td>
                  <td className="text-ink-500">
                    {r.finished_at
                      ? formatDistanceToNow(new Date(r.finished_at), { addSuffix: true })
                      : "running..."}
                  </td>
                </tr>
              );
            })}
            {!runs?.length && (
              <tr><td colSpan={7} className="p-12 text-center text-ink-500">No runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
