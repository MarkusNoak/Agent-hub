import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { BillingCharts } from "./BillingCharts";
import { PageHeader } from "@/app/components/PageHeader";

export const dynamic = "force-dynamic";

const AGENT_ICONS: Record<string, string> = {
  sales: "🎯",
  invoice: "🧾",
  finance_report: "📊",
  client_status: "📬",
  dev_support: "🛠",
  project: "📋",
  marketing: "📣",
};

export default async function BillingPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const { data: runs } = await supa
    .from("agent_runs")
    .select(
      "agent_id, status, cost_usd, tokens_input, tokens_output, iterations, started_at, finished_at, agents(kind, name)",
    )
    .eq("tenant_id", tenant.id)
    .order("started_at", { ascending: false })
    .limit(2000);

  const allRuns = runs ?? [];
  const runsThisMonth = allRuns.filter(
    (r) => r.started_at && new Date(r.started_at) >= monthStart,
  );
  const runsLastMonth = allRuns.filter(
    (r) =>
      r.started_at &&
      new Date(r.started_at) >= lastMonthStart &&
      new Date(r.started_at) < monthStart,
  );

  const totalCostThisMonth = runsThisMonth.reduce(
    (s, r) => s + Number(r.cost_usd ?? 0),
    0,
  );
  const totalCostLastMonth = runsLastMonth.reduce(
    (s, r) => s + Number(r.cost_usd ?? 0),
    0,
  );
  const totalTokensIn = runsThisMonth.reduce(
    (s, r) => s + (r.tokens_input ?? 0),
    0,
  );
  const totalTokensOut = runsThisMonth.reduce(
    (s, r) => s + (r.tokens_output ?? 0),
    0,
  );
  const avgCostPerRun =
    runsThisMonth.length > 0 ? totalCostThisMonth / runsThisMonth.length : 0;

  // Per-agent breakdown
  type AgentStats = {
    kind: string;
    name: string;
    runs: number;
    succeeded: number;
    failed: number;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
  };
  const agentMap = new Map<string, AgentStats>();
  for (const r of runsThisMonth) {
    const agRaw = r.agents as unknown;
    const ag = (Array.isArray(agRaw) ? agRaw[0] : agRaw) as {
      kind: string;
      name: string;
    } | null;
    if (!ag) continue;
    if (!agentMap.has(ag.kind)) {
      agentMap.set(ag.kind, {
        kind: ag.kind,
        name: ag.name,
        runs: 0,
        succeeded: 0,
        failed: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
      });
    }
    const entry = agentMap.get(ag.kind)!;
    entry.runs += 1;
    if (r.status === "succeeded") entry.succeeded += 1;
    if (r.status === "failed") entry.failed += 1;
    entry.costUsd += Number(r.cost_usd ?? 0);
    entry.tokensIn += r.tokens_input ?? 0;
    entry.tokensOut += r.tokens_output ?? 0;
  }
  const agentStats = [...agentMap.values()].sort((a, b) => b.costUsd - a.costUsd);

  // Daily cost (14 days)
  const dailyBuckets: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dailyBuckets[d.toISOString().slice(5, 10)] = 0;
  }
  for (const r of allRuns) {
    if (!r.finished_at) continue;
    const key = new Date(r.finished_at).toISOString().slice(5, 10);
    if (key in dailyBuckets) {
      dailyBuckets[key] = (dailyBuckets[key] ?? 0) + Number(r.cost_usd ?? 0);
    }
  }
  const dailyData = Object.entries(dailyBuckets).map(([date, cost]) => ({
    date,
    cost: Number(cost.toFixed(5)),
  }));

  const costDelta =
    totalCostLastMonth > 0
      ? ((totalCostThisMonth - totalCostLastMonth) / totalCostLastMonth) * 100
      : null;

  // Projected monthly cost
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedCost =
    dayOfMonth > 0 ? (totalCostThisMonth / dayOfMonth) * daysInMonth : 0;

  const monthLabel = now.toLocaleString("sv-SE", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fakturering"
        subtitle={`Claude API-användning och kostnader för ${monthLabel}.`}
      />

      {/* KPI cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-5">
          <div className="section-label mb-4">Kostnad denna månad</div>
          <div className="text-[36px] font-extrabold tracking-[-0.03em] leading-none text-ink-900 tabular-nums">
            <span className="text-xl font-bold mr-0.5 text-ink-400">$</span>{totalCostThisMonth.toFixed(3)}
          </div>
          {costDelta !== null && (
            <div className={`mt-3 text-xs font-medium ${costDelta > 0 ? "text-red-600" : "text-emerald-600"}`}>
              {costDelta > 0 ? "+" : ""}{costDelta.toFixed(0)}% vs förra månaden
            </div>
          )}
        </div>
        <div className="card p-5">
          <div className="section-label mb-4 text-amber-600">Prognos helmånad</div>
          <div className="text-[36px] font-extrabold tracking-[-0.03em] leading-none text-ink-900 tabular-nums">
            <span className="text-xl font-bold mr-0.5 text-ink-400">$</span>{projectedCost.toFixed(3)}
          </div>
          <div className="mt-3 text-xs text-ink-400 font-medium">baserat på {dayOfMonth} dagar</div>
        </div>
        <div className="card p-5">
          <div className="section-label mb-4 text-blue-600">Snitt / körning</div>
          <div className="text-[36px] font-extrabold tracking-[-0.03em] leading-none text-ink-900 tabular-nums">
            <span className="text-xl font-bold mr-0.5 text-ink-400">$</span>{avgCostPerRun.toFixed(4)}
          </div>
          <div className="mt-3 text-xs text-ink-400 font-medium">{runsThisMonth.length} körningar totalt</div>
        </div>
        <div className="card p-5">
          <div className="section-label mb-4">Tokens denna månad</div>
          <div className="text-[36px] font-extrabold tracking-[-0.03em] leading-none text-ink-900 tabular-nums">
            {((totalTokensIn + totalTokensOut) / 1000).toFixed(1)}<span className="text-xl font-bold ml-0.5 text-ink-400">k</span>
          </div>
          <div className="mt-3 text-xs text-ink-400 font-medium">
            {(totalTokensIn / 1000).toFixed(1)}k in · {(totalTokensOut / 1000).toFixed(1)}k ut
          </div>
        </div>
      </section>

      {/* Chart */}
      <BillingCharts dailyData={dailyData} agentStats={agentStats} />

      {/* Per-agent breakdown */}
      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100">
          <div className="section-label">Per agent — denna månad</div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-premium">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="text-right">Körningar</th>
                <th className="text-right">Lyckade</th>
                <th className="text-right">Misslyckade</th>
                <th className="text-right">Tokens in</th>
                <th className="text-right">Tokens ut</th>
                <th className="text-right">Kostnad</th>
                <th className="text-right">Snitt/körn.</th>
              </tr>
            </thead>
            <tbody>
              {agentStats.map((a) => {
                const successRate =
                  a.runs > 0 ? Math.round((a.succeeded / a.runs) * 100) : 0;
                return (
                  <tr key={a.kind}>
                    <td>
                      <span className="mr-2 text-base">{AGENT_ICONS[a.kind] ?? "🤖"}</span>
                      <span className="font-semibold text-ink-900">{a.name}</span>
                      <code className="text-xs text-ink-300 ml-2 font-mono">{a.kind}</code>
                    </td>
                    <td className="text-right tabular-nums text-ink-700 font-medium">{a.runs}</td>
                    <td className="text-right tabular-nums">
                      <span className={`font-semibold ${successRate >= 80 ? "text-emerald-600" : successRate >= 50 ? "text-amber-600" : "text-red-600"}`}>
                        {a.succeeded}
                      </span>
                      <span className="text-ink-300 text-xs ml-1">({successRate}%)</span>
                    </td>
                    <td className="text-right tabular-nums text-red-500 font-medium">{a.failed}</td>
                    <td className="text-right tabular-nums text-ink-500">{(a.tokensIn / 1000).toFixed(1)}k</td>
                    <td className="text-right tabular-nums text-ink-500">{(a.tokensOut / 1000).toFixed(1)}k</td>
                    <td className="text-right tabular-nums font-semibold text-ink-900">${a.costUsd.toFixed(4)}</td>
                    <td className="text-right tabular-nums text-ink-400 text-xs">${(a.runs > 0 ? a.costUsd / a.runs : 0).toFixed(5)}</td>
                  </tr>
                );
              })}
              {agentStats.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="text-ink-400 text-sm font-medium">Inga körningar denna månad</div>
                  </td>
                </tr>
              )}
              {agentStats.length > 0 && (
                <tr className="bg-ink-50/60 font-semibold border-t-2 border-ink-100">
                  <td className="text-ink-700">Totalt</td>
                  <td className="text-right tabular-nums">{runsThisMonth.length}</td>
                  <td className="text-right tabular-nums text-emerald-600">
                    {runsThisMonth.filter((r) => r.status === "succeeded").length}
                  </td>
                  <td className="text-right tabular-nums text-red-500">
                    {runsThisMonth.filter((r) => r.status === "failed").length}
                  </td>
                  <td className="text-right tabular-nums">{(totalTokensIn / 1000).toFixed(1)}k</td>
                  <td className="text-right tabular-nums">{(totalTokensOut / 1000).toFixed(1)}k</td>
                  <td className="text-right tabular-nums">${totalCostThisMonth.toFixed(4)}</td>
                  <td className="text-right tabular-nums text-xs">${avgCostPerRun.toFixed(5)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Historical months */}
      <section className="card p-5">
        <div className="section-label mb-3">Förra månaden</div>
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] font-extrabold tracking-[-0.02em] text-ink-900 tabular-nums">
            <span className="text-base font-bold text-ink-400 mr-0.5">$</span>{totalCostLastMonth.toFixed(4)}
          </span>
          <span className="text-sm text-ink-400 font-medium">· {runsLastMonth.length} körningar</span>
        </div>
      </section>
    </div>
  );
}
