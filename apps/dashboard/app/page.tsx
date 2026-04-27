import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { LiveActivityFeed } from "./components/LiveActivityFeed";
import {
  DailyRunVolumeChart,
  OfferMixChart,
  AgentActivityPie,
} from "./components/ImpactCharts";
import { TrendingUp, Zap, Clock, CheckCircle } from "lucide-react";

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
      return s + (TIME_SAVED_PER_RUN[ag?.kind ?? ""] ?? 0.3);
    }, 0);
  const sekSaved = hoursSaved * HOURLY_COST_SEK;

  const succeededThisMonth = runsThisMonth.filter((r) => r.status === "succeeded").length;
  const successRate = runsThisMonth.length > 0
    ? Math.round((succeededThisMonth / runsThisMonth.length) * 100)
    : null;

  // Daily buckets (14 days)
  const dailyBuckets: Record<string, { runs: number; cost: number }> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dailyBuckets[d.toISOString().slice(5, 10)] = { runs: 0, cost: 0 };
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
    webb_design:     { drafted: 0, sent: 0, replied: 0 },
    app_development: { drafted: 0, sent: 0, replied: 0 },
    ai_automation:   { drafted: 0, sent: 0, replied: 0 },
    agent_platform:  { drafted: 0, sent: 0, replied: 0 },
  };
  leads.forEach((l) => {
    const ot = (l.offer_type as string) ?? null;
    if (!ot || !offerBuckets[ot]) return;
    if (l.stage === "outreach_drafted") offerBuckets[ot].drafted += 1;
    if (l.stage === "outreach_sent")    offerBuckets[ot].sent    += 1;
    if (["replied","qualified","won"].includes(l.stage as string)) offerBuckets[ot].replied += 1;
  });
  const offerData = Object.entries(offerBuckets).map(([offer_type, v]) => ({ offer_type, ...v }));

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
        summary = `${(out["drafts_queued"] as unknown[]).length} utkast i kön`;
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

  const wonLeads = leads.filter((l) => l.stage === "won").length;
  const activeLeads = leads.filter(
    (l) => !["new", "lost"].includes(l.stage as string),
  ).length;

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            God dag, {tenant.name} 👋
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Här är vad dina agenter gjort den senaste månaden.
          </p>
        </div>
        {pendingApprovals > 0 && (
          <Link
            href="/approvals"
            className="btn btn-primary whitespace-nowrap"
          >
            <span className="inline-block w-2 h-2 rounded-full bg-white/60 animate-pulse" />
            {pendingApprovals} väntande godkännande{pendingApprovals === 1 ? "" : "n"}
          </Link>
        )}
      </header>

      {/* ── KPI cards ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Tid sparad */}
        <div className="card-green p-5 relative overflow-hidden">
          <div className="absolute top-3 right-3 opacity-15">
            <Clock size={40} />
          </div>
          <div className="section-label mb-3 text-emerald-600">Tid sparad</div>
          <div className="text-3xl font-bold tracking-tight text-emerald-900 tabular-nums">
            {Math.round(hoursSaved)}h
          </div>
          <div className="text-xs text-emerald-700 mt-1 font-medium">
            ≈ {Math.round(sekSaved).toLocaleString("sv-SE")} SEK
          </div>
          <div className="text-xs text-emerald-600/60 mt-0.5">
            à {HOURLY_COST_SEK} SEK/h · denna månad
          </div>
        </div>

        {/* Aktiva agenter */}
        <div className="card-blue p-5 relative overflow-hidden">
          <div className="absolute top-3 right-3 opacity-15">
            <Zap size={40} />
          </div>
          <div className="section-label mb-3 text-blue-600">Aktiva agenter</div>
          <div className="text-3xl font-bold tracking-tight text-blue-900 tabular-nums">
            {enabledAgents}
            <span className="text-lg font-normal text-blue-400">/{agents.length}</span>
          </div>
          {successRate !== null && (
            <div className="text-xs text-blue-700 mt-1 font-medium">
              {successRate}% körningar lyckades
            </div>
          )}
          <div className="text-xs text-blue-600/60 mt-0.5">
            {runsThisMonth.length} körningar denna månad
          </div>
        </div>

        {/* Pipeline */}
        <div className="card-amber p-5 relative overflow-hidden">
          <div className="absolute top-3 right-3 opacity-15">
            <TrendingUp size={40} />
          </div>
          <div className="section-label mb-3 text-amber-600">Sales pipeline</div>
          <div className="text-3xl font-bold tracking-tight text-amber-900 tabular-nums">
            {activeLeads}
          </div>
          <div className="text-xs text-amber-700 mt-1 font-medium">
            {wonLeads} vunna affärer
          </div>
          <div className="text-xs text-amber-600/60 mt-0.5">
            {leads.length} leads totalt
          </div>
        </div>

        {/* Godkännanden / AI-kostnad */}
        {pendingApprovals > 0 ? (
          <Link href="/approvals" className="card-purple p-5 relative overflow-hidden block group">
            <div className="absolute top-3 right-3 opacity-15 group-hover:opacity-25 transition-opacity">
              <CheckCircle size={40} />
            </div>
            <div className="section-label mb-3 text-purple-600">Godkännanden</div>
            <div className="text-3xl font-bold tracking-tight text-purple-900 tabular-nums">
              {pendingApprovals}
            </div>
            <div className="text-xs text-purple-700 mt-1 font-medium">
              väntande på dig
            </div>
            <div className="text-xs text-purple-600/60 mt-0.5">
              Klicka för att granska →
            </div>
          </Link>
        ) : (
          <div className="card p-5 relative overflow-hidden">
            <div className="absolute top-3 right-3 opacity-8">
              <CheckCircle size={40} className="text-ink-400" />
            </div>
            <div className="section-label mb-3">AI-kostnad</div>
            <div className="text-3xl font-bold tracking-tight tabular-nums">
              ${monthCostUsd.toFixed(2)}
            </div>
            <div className="text-xs text-ink-500 mt-1 font-medium">denna månad</div>
            <div className="text-xs text-ink-400 mt-0.5">
              inga väntande godkännanden ✓
            </div>
          </div>
        )}
      </section>

      {/* ── Charts row 1 ── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <DailyRunVolumeChart data={dailyData} />
        </div>
        <AgentActivityPie data={activityData} />
      </section>

      {/* ── Charts row 2 ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LiveActivityFeed initial={feedInitial} />
        <OfferMixChart data={offerData} />
      </section>
    </div>
  );
}
