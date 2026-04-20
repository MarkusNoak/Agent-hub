import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { LiveActivityFeed } from "./components/LiveActivityFeed";
import {
  DailyRunVolumeChart,
  OfferMixChart,
  AgentActivityPie,
  ImpactKpi,
} from "./components/ImpactCharts";

export const dynamic = "force-dynamic";

const TIME_SAVED_PER_RUN: Record<string, number> = {
  invoice: 0.5,
  finance_report: 1.5,
  sales: 0.75,
  client_status: 0.5,
  dev_support: 0.4,
  project: 0.25,
  marketing: 1.0,
};
const HOURLY_COST_SEK = 950;

export default async function Overview() {
  const tenant = await getActiveTenant();
  if (!tenant) redirect("/login");
  const supa = createSupabaseServerClient();

  const [agentsRes, approvalsRes, runsRes, leadsRes] = await Promise.all([
    supa.from("agents").select("kind, name, status, last_run_at").eq("tenant_id", tenant.id),
    supa.from("approval_queue").select("id").eq("tenant_id", tenant.id).eq("status", "pending"),
    supa
      .from("agent_runs")
      .select("id, status, cost_usd, iterations, started_at, finished_at, output, agents(kind, name)")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supa.from("leads").select("offer_type, stage").eq("tenant_id", tenant.id),
  ]);

  const agents = agentsRes.data ?? [];
  const pendingApprovals = approvalsRes.data?.length ?? 0;
  const runs = runsRes.data ?? [];
  const leads = leadsRes.data ?? [];

  const enabledAgents = agents.filter((a) => a.status === "enabled").length;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const runsThisMonth = runs.filter(
    (r) => r.finished_at && new Date(r.finished_at) >= monthStart,
  );
  const monthCostUsd = runsThisMonth.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

  const hoursSaved = runsThisMonth
    .filter((r) => r.status === "succeeded")
    .reduce((s, r) => {
      const agRaw = r.agents as unknown;
      const ag = (Array.isArray(agRaw) ? agRaw[0] : agRaw) as { kind: string } | null;
      const kind = ag?.kind ?? "";
      return s + (TIME_SAVED_PER_RUN[kind] ?? 0.3);
    }, 0);
  const sekSaved = hoursSaved * HOURLY_COST_SEK;

  const dailyBuckets: Record<string, { runs: number; cost: number }> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(5, 10);
    dailyBuckets[key] = { runs: 0, cost: 0 };
  }
  runs.forEach((r) => {
    if (!r.finished_at) return;
    const key = new Date(r.finished_at).toISOString().slice(5, 10);
    if (dailyBuckets[key]) {
      dailyBuckets[key].runs += 1;
      dailyBuckets[key].cost += Number(r.cost_usd ?? 0);
    }
  });
  const dailyData = Object.entries(dailyBuckets).map(([date, v]) => ({
    date,
    runs: v.runs,
    cost: Number(v.cost.toFixed(4)),
  }));

  const offerBuckets: Record<string, { drafted: number; sent: number; replied: number }> = {
    webb_design: { drafted: 0, sent: 0, replied: 0 },
    app_development: { drafted: 0, sent: 0, replied: 0 },
    ai_automation: { drafted: 0, sent: 0, replied: 0 },
    agent_platform: { drafted: 0, sent: 0, replied: 0 },
  };
  leads.forEach((l) => {
    const ot = (l.offer_type as string) ?? null;
    if (!ot || !offerBuckets[ot]) return;
    if (l.stage === "outreach_drafted") offerBuckets[ot].drafted += 1;
    if (l.stage === "outreach_sent") offerBuckets[ot].sent += 1;
    if (["replied", "qualified", "won"].includes(l.stage as string))
      offerBuckets[ot].replied += 1;
  });
  const offerData = Object.entries(offerBuckets).map(([offer_type, v]) => ({
    offer_type,
    ...v,
  }));

  const thirtyAgo = new Date();
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const activityBuckets: Record<string, number> = {};
  runs
    .filter((r) => r.finished_at && new Date(r.finished_at) >= thirtyAgo)
    .forEach((r) => {
      const agRaw = r.agents as unknown;
      const ag = (Array.isArray(agRaw) ? agRaw[0] : agRaw) as { kind: string } | null;
      const kind = ag?.kind ?? "other";
      activityBuckets[kind] = (activityBuckets[kind] ?? 0) + 1;
    });
  const activityData = Object.entries(activityBuckets)
    .map(([kind, runs]) => ({ kind, runs }))
    .filter((d) => d.runs > 0);

  const feedInitial = runs.slice(0, 20).map((r) => {
    const agRaw = r.agents as unknown;
    const ag = (Array.isArray(agRaw) ? agRaw[0] : agRaw) as { kind: string; name: string } | null;
    const out = r.output as Record<string, unknown> | null;
    let summary: string | null = null;
    if (out) {
      if (typeof out["summary"] === "string") summary = out["summary"] as string;
      else if (Array.isArray(out["drafts_queued"]))
        summary = `${(out["drafts_queued"] as unknown[]).length} drafts queued`;
    }
    return {
      id: r.id,
      kind: ag?.kind ?? "agent",
      name: ag?.name ?? "Agent",
      status: r.status as "running" | "succeeded" | "failed",
      cost_usd: r.cost_usd,
      iterations: r.iterations,
      started_at: r.started_at,
      finished_at: r.finished_at,
      summary,
    };
  });

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
          <p className="text-ink-500">
            Agent Hub for <span className="font-medium">{tenant.name}</span> - Plan:{" "}
            <span className="font-medium">{tenant.plan}</span>
          </p>
        </div>
        {pendingApprovals > 0 && (
          <Link href="/approvals" className="btn btn-primary whitespace-nowrap animate-pulse">
            {pendingApprovals} pending approval{pendingApprovals === 1 ? "" : "s"}
          </Link>
        )}
      </header>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ImpactKpi
          label="Hours saved this month"
          value={`${Math.round(hoursSaved)}h`}
          subtitle={`~${Math.round(sekSaved).toLocaleString("sv-SE")} SEK at ${HOURLY_COST_SEK}/h`}
          tone="green"
        />
        <ImpactKpi
          label="Agents enabled"
          value={`${enabledAgents}/${agents.length}`}
          subtitle="Turn more on in /agents"
          tone="indigo"
        />
        <ImpactKpi
          label="Runs this month"
          value={runsThisMonth.length.toString()}
          subtitle={`$${monthCostUsd.toFixed(2)} spent on Claude API`}
        />
        <ImpactKpi
          label="Pending approvals"
          value={pendingApprovals.toString()}
          subtitle="Human-in-the-loop gate"
          tone={pendingApprovals > 0 ? "amber" : "default"}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <DailyRunVolumeChart data={dailyData} />
        </div>
        <AgentActivityPie data={activityData} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LiveActivityFeed initial={feedInitial} />
        <OfferMixChart data={offerData} />
      </section>
    </div>
  );
}
