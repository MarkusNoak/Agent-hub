import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { formatDistanceToNow } from "date-fns";

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

export default async function LeadsPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const { data: leads } = await supa
    .from("leads")
    .select("id, company_name, company_domain, signal_type, offer_type, stage, score, created_at")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const byStage: Record<string, number> = {};
  for (const stage of STAGE_ORDER) byStage[stage] = 0;
  for (const l of leads ?? []) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Leads</h1>
        <p className="text-ink-500">Pipeline fed by Sales Agent signals.</p>
      </header>

      <section className="grid grid-cols-8 gap-2">
        {STAGE_ORDER.map((s) => (
          <div key={s} className="card p-3">
            <div className="text-xs text-ink-500">{s.replace(/_/g, " ")}</div>
            <div className="text-2xl font-semibold">{byStage[s] ?? 0}</div>
          </div>
        ))}
      </section>

      <section className="card">
        <table className="w-full text-sm">
          <thead className="text-left text-ink-500 border-b border-ink-100">
            <tr>
              <th className="p-3">Company</th>
              <th>Signal</th>
              <th>Offer</th>
              <th>Score</th>
              <th>Stage</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {leads?.map((l) => (
              <tr key={l.id} className="border-t border-ink-100">
                <td className="p-3">
                  <div className="font-medium">{l.company_name}</div>
                  {l.company_domain && <div className="text-xs text-ink-500">{l.company_domain}</div>}
                </td>
                <td className="text-ink-500">{l.signal_type}</td>
                <td><span className="badge badge-blue">{l.offer_type}</span></td>
                <td>{l.score ?? "—"}</td>
                <td><span className="badge badge-gray">{l.stage}</span></td>
                <td className="text-ink-500">
                  {formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}
                </td>
              </tr>
            ))}
            {!leads?.length && (
              <tr><td colSpan={6} className="p-12 text-center text-ink-500">No leads yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
