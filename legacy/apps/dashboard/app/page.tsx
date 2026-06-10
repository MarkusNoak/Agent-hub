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

export const dynamic = "force-dynamic";

const TIME_SAVED_PER_RUN: Record<string, number> = {
  invoice: 0.5, finance_report: 1.5, sales: 0.75,
  client_status: 0.5, dev_support: 0.4, project: 0.25, marketing: 1.0,
};
const HOURLY_COST_SEK = 950;

export default async function Overview() {
  const supa = createSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login");

  const tenant = await getActiveTenant();
  if (!tenant) redirect("/no-access");

  const [agentsRes, approvalsRes, runsRes, leadsRes] = await Promise.all([
    supa.from("agents").select("kind, name, status, last_run_at").eq("tenant_id", tenant.id),
    supa.from("approval_queue").select("id").eq("tenant_id", tenant.id).eq("status", "pending"),
    supa.from("agent_runs")
      .select("id, status, cost_usd, iterations, started_at, finished_at, output, agents(kind, name)")
      .eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(500),
    supa.from("leads").select("offer_type, stage").eq("tenant_id", tenant.id),
  ]);

  const agents = agentsRes.data ?? [];
  const pendingApprovals = approvalsRes.data?.length ?? 0;
  const runs = runsRes.data ?? [];
  const leads = leadsRes.data ?? [];

  const enabledAgents = agents.filter((a) => a.status === "enabled").length;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const runsThisMonth = runs.filter((r) => r.finished_at && new Date(r.finished_at) >= monthStart);
  const monthCostUsd = runsThisMonth.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

  const hoursSaved = runsThisMonth
    .filter((r) => r.status === "succeeded")
    .reduce((s, r) => {
      const agRaw = r.agents as unknown;
      const ag = (Array.isArray(agRaw) ? agRaw[0] : agRaw) as { kind: string } | null;
      return s + (TIME_SAVED_PER_RUN[ag?.kind ?? ""] ?? 0.3);
    }, 0);
  const sekSaved = hoursSaved * HOURLY_COST_SEK;

  const succeeded = runsThisMonth.filter((r) => r.status === "succeeded").length;
  const successRate = runsThisMonth.length > 0 ? Math.round((succeeded / runsThisMonth.length) * 100) : null;

  const wonLeads = leads.filter((l) => l.stage === "won").length;
  const activeLeads = leads.filter((l) => !["new", "lost"].includes(l.stage as string)).length;

  // Daily data
  const dailyBuckets: Record<string, { runs: number; cost: number }> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    dailyBuckets[d.toISOString().slice(5, 10)] = { runs: 0, cost: 0 };
  }
  runs.forEach((r) => {
    if (!r.finished_at) return;
    const key = new Date(r.finished_at).toISOString().slice(5, 10);
    if (dailyBuckets[key]) { dailyBuckets[key].runs += 1; dailyBuckets[key].cost += Number(r.cost_usd ?? 0); }
  });
  const dailyData = Object.entries(dailyBuckets).map(([date, v]) => ({ date, runs: v.runs, cost: Number(v.cost.toFixed(4)) }));

  const offerBuckets: Record<string, { drafted: number; sent: number; replied: number }> = {
    webb_design: { drafted: 0, sent: 0, replied: 0 }, app_development: { drafted: 0, sent: 0, replied: 0 },
    ai_automation: { drafted: 0, sent: 0, replied: 0 }, agent_platform: { drafted: 0, sent: 0, replied: 0 },
  };
  leads.forEach((l) => {
    const ot = l.offer_type as string;
    if (!ot || !offerBuckets[ot]) return;
    if (l.stage === "outreach_drafted") offerBuckets[ot].drafted++;
    if (l.stage === "outreach_sent") offerBuckets[ot].sent++;
    if (["replied","qualified","won"].includes(l.stage as string)) offerBuckets[ot].replied++;
  });
  const offerData = Object.entries(offerBuckets).map(([offer_type, v]) => ({ offer_type, ...v }));

  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const activityBuckets: Record<string, number> = {};
  runs.filter((r) => r.finished_at && new Date(r.finished_at) >= thirtyAgo).forEach((r) => {
    const agRaw = r.agents as unknown;
    const ag = (Array.isArray(agRaw) ? agRaw[0] : agRaw) as { kind: string } | null;
    const kind = ag?.kind ?? "other";
    activityBuckets[kind] = (activityBuckets[kind] ?? 0) + 1;
  });
  const activityData = Object.entries(activityBuckets).map(([kind, runs]) => ({ kind, runs })).filter((d) => d.runs > 0);

  const feedInitial = runs.slice(0, 20).map((r) => {
    const agRaw = r.agents as unknown;
    const ag = (Array.isArray(agRaw) ? agRaw[0] : agRaw) as { kind: string; name: string } | null;
    const out = r.output as Record<string, unknown> | null;
    let summary: string | null = null;
    if (out) {
      if (typeof out["summary"] === "string") summary = out["summary"] as string;
      else if (Array.isArray(out["drafts_queued"])) summary = `${(out["drafts_queued"] as unknown[]).length} utkast i kön`;
    }
    return { id: r.id, kind: ag?.kind ?? "agent", name: ag?.name ?? "Agent", status: r.status as "running" | "succeeded" | "failed", cost_usd: r.cost_usd, iterations: r.iterations, started_at: r.started_at, finished_at: r.finished_at, summary };
  });

  const monthName = now.toLocaleString("sv-SE", { month: "long" });

  return (
    <div className="space-y-8">

      {/* ── Brand banner ── */}
      <div
        className="rounded-2xl px-6 py-5 flex items-center gap-4"
        style={{
          background: "linear-gradient(135deg, #151210 0%, #1e1810 100%)",
          border: "1px solid rgb(255 255 255 / 0.07)",
        }}
      >
        <svg width="38" height="38" viewBox="0 0 36 36" fill="none" aria-hidden="true" className="shrink-0">
          <path d="M20 6L9 18L20 30" stroke="#f0b030" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M29 6L18 18L29 30" stroke="#f0b030" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.45"/>
        </svg>
        <div>
          <div className="text-white font-bold text-[20px] tracking-[-0.03em] leading-none">weknowit</div>
          <div className="text-[12px] font-medium mt-[5px]" style={{ color: "rgb(255 255 255 / 0.35)" }}>
            Din digitala partner för framtidens lösningar.
          </div>
        </div>
      </div>

      {/* ── Header ── */}
      <header className="flex items-start justify-between gap-6 pb-2">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink-900 leading-tight">
            God dag, {(() => {
              const meta = tenant.user.user_metadata;
              const fromMeta = meta?.full_name?.split(" ")[0] ?? meta?.name?.split(" ")[0];
              if (fromMeta) return fromMeta;
              const emailPrefix = tenant.user.email?.split("@")[0] ?? "";
              const firstName = emailPrefix.split(/[._]/)[0] ?? emailPrefix;
              return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
            })()}
          </h1>
          <p className="text-ink-400 text-sm mt-1 font-medium">
            {monthName.charAt(0).toUpperCase() + monthName.slice(1)} · {now.getFullYear()}
          </p>
        </div>
        {pendingApprovals > 0 && (
          <Link href="/approvals" className="btn btn-primary shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            {pendingApprovals} att godkänna
          </Link>
        )}
      </header>

      {/* ── KPI row ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">

        {/* Tid sparad */}
        <div className="card p-5">
          <div className="section-label mb-4 text-emerald-600">Tid sparad</div>
          <div className="text-[36px] font-extrabold tracking-[-0.04em] leading-none text-emerald-700 tabular-nums">
            {Math.round(hoursSaved)}<span className="text-xl font-bold ml-0.5">h</span>
          </div>
          <div className="mt-3 text-xs text-ink-400 font-medium">
            ≈ {Math.round(sekSaved).toLocaleString("sv-SE")} <span className="text-ink-300">SEK / {monthName}</span>
          </div>
        </div>

        {/* Agenter */}
        <div className="card p-5">
          <div className="section-label mb-4 text-blue-600">Agenter</div>
          <div className="stat-value">
            {enabledAgents}<span className="text-xl font-semibold text-ink-300 ml-1">/ {agents.length}</span>
          </div>
          <div className="mt-3 text-xs text-ink-400 font-medium">
            {successRate !== null ? (
              <><span className={successRate >= 80 ? "text-emerald-600" : "text-amber-600"}>{successRate}%</span> lyckade körningar</>
            ) : "Inga körningar ännu"}
          </div>
        </div>

        {/* Pipeline */}
        <div className="card p-5">
          <div className="section-label mb-4 text-amber-600">Sales pipeline</div>
          <div className="stat-value">
            {activeLeads}
          </div>
          <div className="mt-3 text-xs text-ink-400 font-medium">
            <span className="text-emerald-600 font-semibold">{wonLeads}</span> vunna · {leads.length} totalt
          </div>
        </div>

        {/* Godkännanden / Kostnad */}
        {pendingApprovals > 0 ? (
          <Link href="/approvals" className="card p-5 block group relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-brand/5 to-brand/10 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />
            <div className="section-label mb-4 text-brand relative">Godkännanden</div>
            <div className="text-[36px] font-extrabold tracking-[-0.04em] leading-none text-brand tabular-nums relative">
              {pendingApprovals}
            </div>
            <div className="mt-3 text-xs text-ink-400 font-medium relative">
              Klicka för att granska →
            </div>
          </Link>
        ) : (
          <div className="card p-5">
            <div className="section-label mb-4">AI-kostnad</div>
            <div className="stat-value">
              ${monthCostUsd.toFixed(2)}
            </div>
            <div className="mt-3 text-xs text-ink-400 font-medium">
              {runsThisMonth.length} körningar · kön tom
            </div>
          </div>
        )}
      </section>

      {/* ── Charts ── */}
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
