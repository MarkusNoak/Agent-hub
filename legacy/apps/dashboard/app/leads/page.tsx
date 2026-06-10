import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { LeadsFilter } from "./LeadsFilter";
import { LeadRow } from "./LeadRow";
import Link from "next/link";
import { Download } from "lucide-react";
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

const STAGE_LABELS: Record<string, string> = {
  new:              "Ny",
  researched:       "Analyserad",
  outreach_drafted: "Utkast",
  outreach_sent:    "Skickad",
  replied:          "Svarade",
  qualified:        "Kvalificerad",
  won:              "Vunnen",
  lost:             "Förlorad",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const q           = searchParams["q"] ?? "";
  const stageFilter = searchParams["stage"] ?? "";
  const offerFilter = searchParams["offer"] ?? "";
  const sortParam   = searchParams["sort"] ?? "updated";

  let query = supa
    .from("leads")
    .select(
      "id, company_name, company_domain, contact_name, contact_email, contact_linkedin, signal_type, signal_summary, offer_type, stage, score, created_at, updated_at",
    )
    .eq("tenant_id", tenant.id);

  if (stageFilter) query = query.eq("stage", stageFilter);
  if (offerFilter) query = query.eq("offer_type", offerFilter);

  if (sortParam === "score_desc")     query = query.order("score",      { ascending: false });
  else if (sortParam === "score_asc") query = query.order("score",      { ascending: true });
  else if (sortParam === "created")   query = query.order("created_at", { ascending: false });
  else                                query = query.order("updated_at", { ascending: false });

  const { data: allLeads } = await query.limit(500);

  const leads = q
    ? (allLeads ?? []).filter(
        (l) =>
          l.company_name?.toLowerCase().includes(q.toLowerCase()) ||
          (l.company_domain as string | null)?.toLowerCase().includes(q.toLowerCase()),
      )
    : (allLeads ?? []);

  // Stage funnel counts
  const byStage: Record<string, number> = {};
  for (const s of STAGE_ORDER) byStage[s] = 0;
  for (const l of allLeads ?? []) {
    const s = l.stage as string | null;
    if (s) byStage[s] = (byStage[s] ?? 0) + 1;
  }

  const pipelineValue = (allLeads ?? []).filter((l) =>
    ["outreach_drafted", "outreach_sent", "replied", "qualified"].includes(l.stage as string ?? ""),
  ).length;
  const wonCount       = byStage["won"] ?? 0;
  const qualPlusWon    = (byStage["qualified"] ?? 0) + wonCount;
  const totalActive    = (allLeads ?? []).filter(
    (l) => !["new", "lost"].includes(l.stage as string ?? ""),
  ).length;
  const conversionRate = totalActive > 0 ? Math.round((qualPlusWon / totalActive) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        subtitle="Pipeline från Sales Agent. Uppdatera stage manuellt när prospekt svarar."
        action={
          <Link href="/api/leads/export" className="btn btn-outline gap-1.5">
            <Download size={14} />
            Exportera CSV
          </Link>
        }
      />

      {/* KPI row */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-5">
          <div className="section-label mb-4">I pipeline</div>
          <div className="stat-value">
            {pipelineValue}
          </div>
          <div className="mt-3 text-xs text-ink-400 font-medium">aktiva leads</div>
        </div>

        <div className="card-green p-5">
          <div className="section-label mb-4 text-emerald-600">Vunna</div>
          <div className="text-[36px] font-extrabold tracking-[-0.04em] leading-none text-emerald-700 tabular-nums">
            {wonCount}
          </div>
          <div className="mt-3 text-xs text-emerald-600 font-medium">avslutade affärer</div>
        </div>

        <div className="card-blue p-5">
          <div className="section-label mb-4 text-blue-600">Konvertering</div>
          <div className="text-[36px] font-extrabold tracking-[-0.04em] leading-none text-blue-700 tabular-nums">
            {conversionRate}<span className="text-xl font-bold ml-0.5">%</span>
          </div>
          <div className="mt-3 text-xs text-blue-600 font-medium">kvalificerade av aktiva</div>
        </div>

        <div className="card p-5">
          <div className="section-label mb-4">Totalt</div>
          <div className="stat-value">
            {allLeads?.length ?? 0}
          </div>
          <div className="mt-3 text-xs text-ink-400 font-medium">leads alla tider</div>
        </div>
      </section>

      {/* Stage funnel */}
      <section className="card p-5">
        <div className="section-label mb-4">Stage-fördelning</div>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
          {STAGE_ORDER.map((s) => {
            const count = byStage[s] ?? 0;
            const maxCount = Math.max(...Object.values(byStage), 1);
            return (
              <div key={s} className="text-center">
                <div className="stat-sm">
                  {count}
                </div>
                <div className="mt-1 h-1 bg-ink-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand rounded-full transition-all"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
                <div className="text-[10px] text-ink-400 mt-1 font-medium leading-tight">
                  {STAGE_LABELS[s]}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Filter bar */}
      <Suspense fallback={<div className="h-11 bg-ink-100 rounded-2xl animate-pulse" />}>
        <LeadsFilter total={leads.length} />
      </Suspense>

      {/* Table */}
      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink-50/70">
                <th className="py-3 px-4 text-left section-label border-b border-ink-100">Bolag</th>
                <th className="py-3 px-4 text-left section-label border-b border-ink-100">Kontakt</th>
                <th className="py-3 px-4 text-left section-label border-b border-ink-100">Signal</th>
                <th className="py-3 px-4 text-left section-label border-b border-ink-100">Erbjudande</th>
                <th className="py-3 px-4 text-center section-label border-b border-ink-100">Score</th>
                <th className="py-3 px-4 text-left section-label border-b border-ink-100">Stage</th>
                <th className="py-3 px-4 text-left section-label border-b border-ink-100 whitespace-nowrap">Kontaktad</th>
                <th className="py-3 px-4 text-left section-label border-b border-ink-100 whitespace-nowrap">Tillagd</th>
                <th className="py-3 px-4 border-b border-ink-100" />
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <LeadRow
                  key={l.id}
                  lead={l as Parameters<typeof LeadRow>[0]["lead"]}
                  tenantId={tenant.id}
                />
              ))}
              {!leads.length && (
                <tr>
                  <td colSpan={9} className="py-20 text-center">
                    <div className="w-12 h-12 rounded-full bg-ink-100 flex items-center justify-center mx-auto mb-3">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-400"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    </div>
                    <div className="text-ink-500 text-sm font-medium">
                      {q || stageFilter || offerFilter
                        ? "Inga leads matchar filtret."
                        : "Inga leads ännu."}
                    </div>
                    {!q && !stageFilter && !offerFilter && (
                      <div className="text-ink-300 text-xs mt-1">
                        Gå till Agenter och kör Sales Agent för att börja.
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
