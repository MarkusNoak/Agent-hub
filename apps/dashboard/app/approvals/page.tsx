import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { ApprovalCard } from "./ApprovalCard";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const { data: approvals } = await supa
    .from("approval_queue")
    .select("id, agent_kind, title, summary, payload, action, created_at, status")
    .eq("tenant_id", tenant.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Approvals</h1>
        <p className="text-ink-500">
          {approvals?.length ?? 0} pending — granska, redigera och skicka.
        </p>
      </header>

      <div className="space-y-4">
        {approvals?.map((a) => (
          <ApprovalCard
            key={a.id}
            approval={a as Parameters<typeof ApprovalCard>[0]["approval"]}
            tenantId={tenant.id}
          />
        ))}
        {!approvals?.length && (
          <div className="card p-12 text-center text-ink-500">
            Kön är tom — inga väntande godkännanden just nu.
          </div>
        )}
      </div>
    </div>
  );
}
