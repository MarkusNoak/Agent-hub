import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { ApprovalCard } from "./ApprovalCard";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const [{ data: approvals }, { data: gmailAccounts }] = await Promise.all([
    supa
      .from("approval_queue")
      .select("id, agent_kind, title, summary, payload, action, created_at, status")
      .eq("tenant_id", tenant.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supa
      .from("integrations")
      .select("id, label, credentials")
      .eq("tenant_id", tenant.id)
      .eq("kind", "gmail")
      .eq("status", "active"),
  ]);

  const count = approvals?.length ?? 0;

  const gmailOptions = (gmailAccounts ?? []).map((g) => ({
    id: g.id as string,
    label: g.label as string ?? "",
    from: (g.credentials as Record<string, string>)["from"] ?? "",
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink-900 leading-tight">
          Godkännanden
        </h1>
        <p className="text-ink-400 text-sm mt-1 font-medium">
          {count > 0
            ? `${count} väntande — granska, redigera och skicka`
            : "Ingen kö — allt klart"}
        </p>
      </header>

      {count === 0 && (
        <div className="card p-16 text-center">
          <div className="text-4xl mb-3">✓</div>
          <div className="text-ink-700 font-semibold">Kön är tom</div>
          <div className="text-ink-400 text-sm mt-1">
            Inga väntande godkännanden just nu.
          </div>
        </div>
      )}

      <div className="space-y-4">
        {approvals?.map((a) => (
          <ApprovalCard
            key={a.id}
            approval={a as Parameters<typeof ApprovalCard>[0]["approval"]}
            tenantId={tenant.id}
            gmailAccounts={gmailOptions}
          />
        ))}
      </div>
    </div>
  );
}
