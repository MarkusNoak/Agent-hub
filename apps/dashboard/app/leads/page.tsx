import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { LeadsFilter } from "./LeadsFilter";
import { LeadRow } from "./LeadRow";
import Link from "next/link";
import { Download } from "lucide-react";

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

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const q = searchParams["q"] ?? "";
  const stageFilter = searchParams["stage"] ?? "";
  const offerFilter = searchParams["offer"] ?? "";
  const sortParam = searchParams["sort"] ?? "updated";

  let query = supa
    .from("leads")
    .select(
      "id, company_name, company_domain, contact_name, contact_email, contact_linkedin, signal_type, signal_summary, offer_type, stage, score, created_at, updated_at",
    )
    .eq("tenant_id", tenant.id);

  if (stageFilter) query = query.eq("stage", stageFilter);
  if (offerFilter) query = query.eq("offer_type", offerFilter);

  if (sortParam === "score_desc") query = query.order("score", { ascending: false });
  else if (sortParam === "score_asc") query = query.order("score", { ascending: true });
  else if (sortParam === "created") query = query.order("created_at", { ascending: false });
  else query = query.order("updated_at", { ascending: false });

  query = query.limit(500);

  const { data: allLeads } = await query;

  const leads = q
    ? (allLeads ?? []).filter(
        (l) =>
          l.company_name?.toLowerCase().includes(q.toLowerCase()) ||
          (l.company_domain as string | null)?.toLowerCase().includes(q.toLowerCase()),
      )
    : (allLeads ?? []);

  const byStage: Record<string, number> = {};
  for (const stage of STAGE_ORDER) byStage[stage] = 0;
  for (const l of allLeads ?? []) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;

  const pipelineValue = (allLeads ?? []).filter((l) =>
    ["outreach_drafted", "outreach_sent", "replied", "qualified"].includes(l.stage),
  ).length;

  const wonCount = byStage["won"] ?? 0;
  const qualifiedPlusWon = (byStage["qualified"] ?? 0) + wonCount;
  const totalActive = (allLeads ?? []).filter(
    (l) => !["new", "lost"].includes(l.stage),
  ).length;
  const conversionRate =
    totalActive > 0 ? Math.round((qualifiedPlusWon / totalActive) * 100) : 0;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Pipeline från Sales Agent. Uppdatera stage manuellt när prospekt svarar.
          </p>
        </div>
        <Link href="/api/leads/export" className="btn btn-outline gap-1.5 shrink-0">
          <Download size={14} />
          Exportera CSV
        </Link>
      </header>

      {/* Pipeline summary */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="section-label mb-1">I pipeline</div>
          <div className="stat-value">{pipelineValue}</div>
          <div className="stat-sub">aktiva leads</div>
        </div>
        <div className="card-green p-4">
          <div className="section-label mb-1 text-emerald-600">Vunna</div>
          <div className="text-2xl font-bold text-emerald-900 tabular-nums">{wonCount}</div>
          <div className="text-xs text-emerald-700 mt-0.5">avslutade affärer</div>
        </div>
        <div className="card-blue p-4">
          <div className="section-label mb-1 text-blue-600">Konvertering</div>
          <div className="text-2xl font-bold text-blue-900 tabular-nums">{conversionRate}%</div>
          <div className="text-xs text-blue-700 mt-0.5">kvalificerade av aktiva</div>
        </div>
        <div className="card p-4">
          <div className="section-label mb-1">Totalt</div>
          <div className="stat-value">{allLeads?.length ?? 0}</div>
          <div className="stat-sub">leads alla tider</div>
        </div>
      </section>

      {/* Stage funnel */}
      <section className="card p-4">
        <div className="section-label mb-3">Stage-fördelning</div>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {STAGE_ORDER.map((s) => (
            <div key={s} className="text-center">
              <div className="text-xl font-bold tabular-nums">{byStage[s] ?? 0}</div>
              <div className="text-xs text-ink-400 mt-0.5 leading-tight">
                {s.replace(/_/g, " ")}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Filter bar — wrapped in Suspense because LeadsFilter uses useSearchParams */}
      <Suspense fallback={
        <div className="h-10 bg-ink-100 rounded-xl animate-pulse" />
      }>
        <LeadsFilter total={leads.length} />
      </Suspense>

      {/* Table */}
      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left border-b border-ink-100">
            <tr>
              <th className="p-3 section-label">Bolag</th>
              <th className="p-3 section-label">Kontakt</th>
              <th className="p-3 section-label">Signal</th>
              <th className="p-3 section-label">Erbjudande</th>
              <th className="p-3 section-label">Score</th>
              <th className="p-3 section-label">Stage</th>
              <th className="p-3 section-label">Kontaktad</th>
              <th className="p-3 section-label">Tillagd</th>
              <th className="p-3"></th>
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
                <td colSpan={9} className="p-12 text-center text-ink-500">
                  {(q || stageFilter || offerFilter)
                    ? "Inga leads matchar filtret."
                    : "Inga leads ännu. Kör Sales Agent för att börja."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
