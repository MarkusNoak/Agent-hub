import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { formatDistanceToNow } from "date-fns";
import { updateLeadStage } from "./actions";

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

const STAGE_COLOR: Record<string, string> = {
  new: "badge-gray",
  researched: "badge-gray",
  outreach_drafted: "badge-blue",
  outreach_sent: "badge-blue",
  replied: "badge-yellow",
  qualified: "badge-yellow",
  won: "badge-green",
  lost: "badge-red",
};

// Stages a human can manually advance to (agent-controlled stages are excluded)
const MANUAL_STAGES = ["replied", "qualified", "won", "lost"] as const;

export default async function LeadsPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const { data: leads } = await supa
    .from("leads")
    .select(
      "id, company_name, company_domain, contact_email, signal_type, offer_type, stage, score, created_at, updated_at",
    )
    .eq("tenant_id", tenant.id)
    .order("updated_at", { ascending: false })
    .limit(200);

  const byStage: Record<string, number> = {};
  for (const stage of STAGE_ORDER) byStage[stage] = 0;
  for (const l of leads ?? []) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Leads</h1>
        <p className="text-ink-500">Pipeline fed by Sales Agent. Uppdatera stage manuellt när prospekt svarar.</p>
      </header>

      {/* Pipeline counts */}
      <section className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {STAGE_ORDER.map((s) => (
          <div key={s} className="card p-3">
            <div className="text-xs text-ink-500 truncate">{s.replace(/_/g, " ")}</div>
            <div className="text-2xl font-semibold">{byStage[s] ?? 0}</div>
          </div>
        ))}
      </section>

      {/* Lead table */}
      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-500 border-b border-ink-100">
            <tr>
              <th className="p-3">Bolag</th>
              <th className="p-3">Kontakt</th>
              <th className="p-3">Signal</th>
              <th className="p-3">Erbjudande</th>
              <th className="p-3">Score</th>
              <th className="p-3">Stage</th>
              <th className="p-3">Senast</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {leads?.map((l) => (
              <tr key={l.id} className="border-t border-ink-100 hover:bg-ink-50/40">
                <td className="p-3">
                  <div className="font-medium">{l.company_name}</div>
                  {l.company_domain && (
                    <div className="text-xs text-ink-500">{l.company_domain}</div>
                  )}
                </td>
                <td className="p-3 text-xs text-ink-600">
                  {l.contact_email ? (
                    <a href={`mailto:${l.contact_email}`} className="text-brand underline">
                      {l.contact_email}
                    </a>
                  ) : (
                    <span className="text-ink-400">—</span>
                  )}
                </td>
                <td className="p-3 text-ink-500 text-xs">{l.signal_type ?? "—"}</td>
                <td className="p-3">
                  <span className="badge badge-blue">{l.offer_type}</span>
                </td>
                <td className="p-3">{l.score ?? "—"}</td>
                <td className="p-3">
                  <span className={`badge ${STAGE_COLOR[l.stage] ?? "badge-gray"}`}>
                    {l.stage.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="p-3 text-xs text-ink-500">
                  {formatDistanceToNow(new Date(l.updated_at ?? l.created_at), {
                    addSuffix: true,
                  })}
                </td>
                <td className="p-3">
                  {/* Only show stage picker for leads that can be manually advanced */}
                  {(["outreach_sent", "replied", "qualified"] as string[]).includes(l.stage) && (
                    <form>
                      <input type="hidden" name="leadId" value={l.id} />
                      <input type="hidden" name="tenantId" value={tenant.id} />
                      <select
                        name="stage"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) {
                            e.target.form?.requestSubmit();
                          }
                        }}
                        className="text-xs border border-ink-200 rounded-lg px-2 py-1 bg-white cursor-pointer"
                      >
                        <option value="" disabled>
                          Flytta till…
                        </option>
                        {MANUAL_STAGES.filter((s) => s !== l.stage).map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                      <button
                        formAction={updateLeadStage}
                        type="submit"
                        className="sr-only"
                        aria-label="Spara stage"
                      />
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {!leads?.length && (
              <tr>
                <td colSpan={8} className="p-12 text-center text-ink-500">
                  Inga leads ännu. Kör Sales Agent för att börja.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
