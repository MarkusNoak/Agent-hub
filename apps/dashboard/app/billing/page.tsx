import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { BillingCharts } from "./BillingCharts";

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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Fakturering</h1>
        <p className="text-ink-500 mt-1">
          Claude API-användning och kostnader för{" "}
          {now.toLocaleString("sv-SE", { month: "long", year: "numeric" })}.
        </p>
      </header>

      {/* KPI cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <div className="text-xs text-ink-500 mb-1">Kostnad denna månad</div>
          <div className="text-2xl font-semibold">
            ${totalCostThisMonth.toFixed(3)}
          </div>
          {costDelta !== null && (
            <div
              className={`text-xs mt-1 ${costDelta > 0 ? "text-red-600" : "text-green-600"}`}
            >
              {costDelta > 0 ? "+" : ""}
              {costDelta.toFixed(0)}% vs förra månaden
            </div>
          )}
        </div>
        <div className="card p-5">
          <div className="text-xs text-ink-500 mb-1">Prognos helmånad</div>
          <div className="text-2xl font-semibold">${projectedCost.toFixed(3)}</div>
          <div className="text-xs text-ink-400 mt-1">
            baserat på {dayOfMonth} dagar
          </div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-ink-500 mb-1">Snitkostnad / körning</div>
          <div className="text-2xl font-semibold">${avgCostPerRun.toFixed(4)}</div>
          <div className="text-xs text-ink-400 mt-1">
            {runsThisMonth.length} körningar totalt
          </div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-ink-500 mb-1">Tokens denna månad</div>
          <div className="text-2xl font-semibold">
            {((totalTokensIn + totalTokensOut) / 1000).toFixed(1)}k
          </div>
          <div className="text-xs text-ink-400 mt-1">
            {(totalTokensIn / 1000).toFixed(1)}k in · {(totalTokensOut / 1000).toFixed(1)}k ut
          </div>
        </div>
      </section>

      {/* Chart */}
      <BillingCharts dailyData={dailyData} agentStats={agentStats} />

      {/* Per-agent breakdown */}
      <section className="card overflow-x-auto">
        <div className="p-4 border-b border-ink-100">
          <h2 className="font-semibold">Per agent — denna månad</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-ink-500 border-b border-ink-100">
            <tr>
              <th className="p-3">Agent</th>
              <th className="p-3 text-right">Körningar</th>
              <th className="p-3 text-right">Lyckade</th>
              <th className="p-3 text-right">Misslyckade</th>
              <th className="p-3 text-right">Tokens in</th>
              <th className="p-3 text-right">Tokens ut</th>
              <th className="p-3 text-right">Kostnad</th>
              <th className="p-3 text-right">Snitt/körning</th>
            </tr>
          </thead>
          <tbody>
            {agentStats.map((a) => {
              const successRate =
                a.runs > 0 ? Math.round((a.succeeded / a.runs) * 100) : 0;
              return (
                <tr
                  key={a.kind}
                  className="border-t border-ink-100 hover:bg-ink-50/40"
                >
                  <td className="p-3">
                    <span className="mr-2">{AGENT_ICONS[a.kind] ?? "🤖"}</span>
                    <span className="font-medium">{a.name}</span>
                    <code className="text-xs text-ink-400 ml-2">{a.kind}</code>
                  </td>
                  <td className="p-3 text-right">{a.runs}</td>
                  <td className="p-3 text-right">
                    <span
                      className={`font-medium ${successRate >= 80 ? "text-green-700" : successRate >= 50 ? "text-yellow-700" : "text-red-700"}`}
                    >
                      {a.succeeded}
                    </span>
                    <span className="text-ink-400 text-xs ml-1">
                      ({successRate}%)
                    </span>
                  </td>
                  <td className="p-3 text-right text-red-600">{a.failed}</td>
                  <td className="p-3 text-right text-ink-600">
                    {(a.tokensIn / 1000).toFixed(1)}k
                  </td>
                  <td className="p-3 text-right text-ink-600">
                    {(a.tokensOut / 1000).toFixed(1)}k
                  </td>
                  <td className="p-3 text-right font-medium">
                    ${a.costUsd.toFixed(4)}
                  </td>
                  <td className="p-3 text-right text-ink-500">
                    ${(a.runs > 0 ? a.costUsd / a.runs : 0).toFixed(5)}
                  </td>
                </tr>
              );
            })}
            {agentStats.length === 0 && (
              <tr>
                <td colSpan={8} className="p-10 text-center text-ink-500">
                  Inga körningar denna månad.
                </td>
              </tr>
            )}
            {agentStats.length > 0 && (
              <tr className="border-t-2 border-ink-200 font-semibold bg-ink-50/50">
                <td className="p-3">Totalt</td>
                <td className="p-3 text-right">{runsThisMonth.length}</td>
                <td className="p-3 text-right text-green-700">
                  {runsThisMonth.filter((r) => r.status === "succeeded").length}
                </td>
                <td className="p-3 text-right text-red-600">
                  {runsThisMonth.filter((r) => r.status === "failed").length}
                </td>
                <td className="p-3 text-right">
                  {(totalTokensIn / 1000).toFixed(1)}k
                </td>
                <td className="p-3 text-right">
                  {(totalTokensOut / 1000).toFixed(1)}k
                </td>
                <td className="p-3 text-right">${totalCostThisMonth.toFixed(4)}</td>
                <td className="p-3 text-right">${avgCostPerRun.toFixed(5)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Historical months */}
      <section className="card p-5">
        <h2 className="font-semibold mb-1">Förra månaden</h2>
        <p className="text-ink-500 text-sm">
          {runsLastMonth.length} körningar ·{" "}
          <span className="font-medium">${totalCostLastMonth.toFixed(4)}</span> totalt
        </p>
      </section>
    </div>
  );
}
