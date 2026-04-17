import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { approveAction, rejectAction } from "./actions";
import { formatDistanceToNow } from "date-fns";

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
          {approvals?.length ?? 0} pending — actions queued by agents, waiting on you.
        </p>
      </header>

      <div className="space-y-3">
        {approvals?.map((a) => (
          <ApprovalCard key={a.id} approval={a} tenantId={tenant.id} />
        ))}
        {!approvals?.length && (
          <div className="card p-12 text-center text-ink-500">
            Queue is empty. Nothing to approve right now.
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalCard({ approval, tenantId }: { approval: any; tenantId: string }) {
  const body =
    (approval.payload?.body_html as string | undefined) ??
    (approval.payload?.body as string | undefined) ??
    JSON.stringify(approval.payload, null, 2);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="badge badge-blue">{approval.agent_kind}</span>
          <span className="badge badge-gray">{approval.action}</span>
        </div>
        <div className="text-xs text-ink-500">
          {formatDistanceToNow(new Date(approval.created_at), { addSuffix: true })}
        </div>
      </div>
      <h3 className="font-semibold mb-1">{approval.title}</h3>
      {approval.summary && <p className="text-sm text-ink-500 mb-3">{approval.summary}</p>}
      <details className="mb-4">
        <summary className="cursor-pointer text-sm text-brand">Preview</summary>
        <pre className="mt-2 p-3 bg-ink-50 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
          {body}
        </pre>
      </details>
      <form className="flex gap-2 items-center">
        <input type="hidden" name="id" value={approval.id} />
        <input type="hidden" name="tenantId" value={tenantId} />
        <button formAction={approveAction} className="btn btn-primary">Approve & execute</button>
        <button formAction={rejectAction} className="btn btn-secondary">Reject</button>
        <input name="reason" placeholder="Reason (if rejecting)" className="flex-1 px-3 py-1.5 border border-ink-200 rounded-lg text-sm" />
      </form>
    </div>
  );
}
