import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { updateLeadStage } from "./actions";
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
          <h1 className="text-3xl font-semibold tracking-tight">Leads</h1>
          <p className="text-ink-500 mt-1">
            Pipeline från Sales Agent. Uppdatera stage manuellt när prospekt svarar.
          </p>
        </div>
        <Link
          href="/api/leads/export"
          className="btn btn-outline gap-1.5 shrink-0"
        >
          <Download size={14} />
          Exportera CSV
        </Link>
      </header>

      {/* Pipeline summary */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-xs text-ink-500 mb-1">I pipeline</div>
          <div className="text-2xl font-semibold">{pipelineValue}</div>
          <div className="text-xs text-ink-400 mt-0.5">aktiva leads</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-500 mb-1">Vunna</div>
          <div className="text-2xl font-semibold text-green-700">{wonCount}</div>
          <div className="text-xs text-ink-400 mt-0.5">avslutade affärer</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-500 mb-1">Konverteringsgrad</div>
          <div className="text-2xl font-semibold">{conversionRate}%</div>
          <div className="text-xs text-ink-400 mt-0.5">kvalificerade av aktiva</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-500 mb-1">Totalt</div>
          <div className="text-2xl font-semibold">{allLeads?.length ?? 0}</div>
          <div className="text-xs text-ink-400 mt-0.5">leads alla tider</div>
        </div>
      </section>

      {/* Stage funnel */}
      <section className="card p-4">
        <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-3">
          Stage-fördelning
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {STAGE_ORDER.map((s) => (
            <div key={s} className="text-center">
              <div className="text-lg font-semibold">{byStage[s] ?? 0}</div>
              <div className="text-xs text-ink-500 mt-0.5 leading-tight">
                {s.replace(/_/g, " ")}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Filter bar */}
      <LeadsFilter total={leads.length} />

      {/* Table */}
      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-500 border-b border-ink-100">
            <tr>
              <th className="p-3">Bolag</th>
              <th className="p-3">Kontaktperson</th>
              <th className="p-3">Signal</th>
              <th className="p-3">Erbjudande</th>
              <th className="p-3">Score</th>
              <th className="p-3">Stage</th>
              <th className="p-3">Kontaktad</th>
              <th className="p-3">Tillagd</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <LeadRow
                key={l.id}
                lead={l as Parameters<typeof LeadRow>[0]["lead"]}
                tenantId={tenant.id}
                updateStageAction={updateLeadStage}
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
