import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { ApprovalCard } from "./ApprovalCard";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/app/components/PageHeader";

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
      <PageHeader
        title="Godkännanden"
        subtitle={count > 0 ? `${count} väntande — granska, redigera och skicka` : "Ingen kö — allt klart"}
      />

      {count === 0 && (
        <div className="card p-16 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={28} strokeWidth={1.5} className="text-emerald-500" />
          </div>
          <div className="text-ink-800 font-semibold text-[15px]">Kön är tom</div>
          <div className="text-ink-400 text-sm mt-1">Inga väntande godkännanden just nu.</div>
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
