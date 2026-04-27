import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { AnalyticsCharts } from "./AnalyticsCharts";
import { PageHeader } from "@/app/components/PageHeader";

export const dynamic = "force-dynamic";

const STAGE_ORDER = [
  "new",
  "researched",
  "outreach_drafted",
  "outreach_sent",
  "replied",
  "qualified",
  "won",
  "lost",
] as const;

const OFFER_LABELS: Record<string, string> = {
  webb_design: "Webbdesign",
  app_development: "Apputveckling",
  ai_automation: "AI-automation",
  agent_platform: "Agent Platform",
};

export default async function AnalyticsPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const [{ data: leads }, { data: runs }, { data: approvals }] =
    await Promise.all([
      supa
        .from("leads")
        .select(
          "stage, offer_type, score, signal_type, created_at, updated_at",
        )
        .eq("tenant_id", tenant.id),
      supa
        .from("agent_runs")
        .select("status, cost_usd, iterations, started_at, agents(kind)")
        .eq("tenant_id", tenant.id)
        .order("started_at", { ascending: false })
        .limit(1000),
      supa
        .from("approval_queue")
        .select("status, action, created_at")
        .eq("tenant_id", tenant.id),
    ]);

  // Funnel data
  const stageCounts: Record<string, number> = {};
  for (const s of STAGE_ORDER) stageCounts[s] = 0;
  for (const l of leads ?? []) {
    stageCounts[l.stage] = (stageCounts[l.stage] ?? 0) + 1;
  }
  const funnelData = STAGE_ORDER.map((s) => ({
    stage: s.replace(/_/g, " "),
    count: stageCounts[s] ?? 0,
  }));

  // Offer breakdown
  const offerCounts: Record<string, number> = {};
  for (const l of leads ?? []) {
    const o = (l.offer_type as string) ?? "other";
    offerCounts[o] = (offerCounts[o] ?? 0) + 1;
  }
  const offerData = Object.entries(offerCounts)
    .map(([offer, count]) => ({
      offer: OFFER_LABELS[offer] ?? offer.replace(/_/g, " "),
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // Signal type breakdown
  const signalCounts: Record<string, number> = {};
  for (const l of leads ?? []) {
    const s = (l.signal_type as string) ?? "unknown";
    signalCounts[s] = (signalCounts[s] ?? 0) + 1;
  }
  const signalData = Object.entries(signalCounts)
    .map(([signal, count]) => ({ signal, count }))
    .sort((a, b) => b.count - a.count);

  // Score distribution (buckets 1-10)
  const scoreBuckets: number[] = Array(10).fill(0) as number[];
  for (const l of leads ?? []) {
    const s = l.score as number | null;
    if (s !== null && s >= 1 && s <= 10) {
      const idx = Math.floor(s) - 1;
      scoreBuckets[idx] = (scoreBuckets[idx] ?? 0) + 1;
    }
  }
  const scoreData = scoreBuckets.map((count, i) => ({
    score: String(i + 1),
    count,
  }));

  // Approval stats
  const approvalStats = {
    total: approvals?.length ?? 0,
    approved: approvals?.filter((a) => a.status === "approved").length ?? 0,
    rejected: approvals?.filter((a) => a.status === "rejected").length ?? 0,
    pending: approvals?.filter((a) => a.status === "pending").length ?? 0,
  };
  const approvalRate =
    approvalStats.total > 0
      ? Math.round(
          (approvalStats.approved /
            (approvalStats.approved + approvalStats.rejected)) *
            100,
        )
      : null;

  // Run success rate
  const completedRuns = (runs ?? []).filter((r) =>
    ["succeeded", "failed"].includes(r.status as string),
  );
  const successRate =
    completedRuns.length > 0
      ? Math.round(
          (completedRuns.filter((r) => r.status === "succeeded").length /
            completedRuns.length) *
            100,
        )
      : null;

  // Top scoring leads
  const topLeads = [...(leads ?? [])]
    .filter((l) => l.score !== null)
    .sort((a, b) => (b.score as number) - (a.score as number))
    .slice(0, 5);

  // Avg score per offer
  const scoreByOffer: Record<string, number[]> = {};
  for (const l of leads ?? []) {
    const o = (l.offer_type as string) ?? "other";
    if (l.score !== null) {
      if (!scoreByOffer[o]) scoreByOffer[o] = [];
      scoreByOffer[o].push(l.score as number);
    }
  }
  const avgScoreData = Object.entries(scoreByOffer).map(([offer, scores]) => ({
    offer: OFFER_LABELS[offer] ?? offer.replace(/_/g, " "),
    avg: Number((scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(1)),
  }));

  const totalLeads = leads?.length ?? 0;
  const activeLeads = (leads ?? []).filter(
    (l) => !["new", "lost"].includes(l.stage as string),
  ).length;
  const wonLeads = stageCounts["won"] ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analys"
        subtitle="Pipeline-konvertering, leadsignaler och agentprestanda."
      />

      {/* KPI summary */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-5">
          <div className="section-label mb-4">Totalt leads</div>
          <div className="text-[36px] font-extrabold tracking-[-0.03em] leading-none text-ink-900 tabular-nums">{totalLeads}</div>
          <div className="mt-3 text-xs text-ink-400 font-medium">{activeLeads} aktiva i pipeline</div>
        </div>
        <div className="card p-5">
          <div className="section-label mb-4 text-emerald-600">Konverteringsgrad</div>
          <div className="text-[36px] font-extrabold tracking-[-0.03em] leading-none text-emerald-700 tabular-nums">
            {totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0}<span className="text-xl font-bold ml-0.5">%</span>
          </div>
          <div className="mt-3 text-xs text-ink-400 font-medium">{wonLeads} vunna av {totalLeads}</div>
        </div>
        <div className="card p-5">
          <div className="section-label mb-4 text-blue-600">Godkännandegrad</div>
          <div className="text-[36px] font-extrabold tracking-[-0.03em] leading-none text-ink-900 tabular-nums">
            {approvalRate !== null ? <>{approvalRate}<span className="text-xl font-bold ml-0.5">%</span></> : "—"}
          </div>
          <div className="mt-3 text-xs text-ink-400 font-medium">
            {approvalStats.approved} godkända · {approvalStats.rejected} avvisade
          </div>
        </div>
        <div className="card p-5">
          <div className="section-label mb-4 text-amber-600">Agent-framgång</div>
          <div className="text-[36px] font-extrabold tracking-[-0.03em] leading-none text-ink-900 tabular-nums">
            {successRate !== null ? <>{successRate}<span className="text-xl font-bold ml-0.5">%</span></> : "—"}
          </div>
          <div className="mt-3 text-xs text-ink-400 font-medium">
            {completedRuns.length} avslutade körningar
          </div>
        </div>
      </section>

      {/* Charts */}
      <AnalyticsCharts
        funnelData={funnelData}
        offerData={offerData}
        signalData={signalData}
        scoreData={scoreData}
        avgScoreData={avgScoreData}
      />

      {/* Top leads by score */}
      {topLeads.length > 0 && (
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-ink-100">
            <div className="section-label">Topp-leads per score</div>
          </div>
          <div className="divide-y divide-ink-50">
            {topLeads.map((l, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-5 py-3 hover:bg-brand-muted/40 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <span className="text-ink-300 font-mono text-xs w-4 tabular-nums">{i + 1}</span>
                  <div>
                    <span className="text-sm font-semibold text-ink-900">
                      {OFFER_LABELS[String(l.offer_type)] ?? String(l.offer_type).replace(/_/g, " ")}
                    </span>
                    <span className="ml-2 text-xs text-ink-400">
                      {String(l.signal_type ?? "—")}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-20 h-1.5 bg-ink-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand rounded-full"
                      style={{ width: `${((l.score as number) / 10) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-brand tabular-nums w-4 text-right">
                    {l.score}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
