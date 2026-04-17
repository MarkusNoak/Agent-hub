import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { toggleAgent, triggerAgentManual } from "./actions";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;

  const supa = createSupabaseServerClient();
  const { data: agents } = await supa
    .from("agents")
    .select("id, kind, name, status, cron, last_run_at, config")
    .eq("tenant_id", tenant.id)
    .order("kind");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Agents</h1>
        <p className="text-ink-500">Seven agents. Toggle them on to start automating.</p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        {agents?.map((a) => (
          <div key={a.id} className="card p-5">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-semibold">{a.name}</h3>
                <code className="text-xs text-ink-500">{a.kind}</code>
              </div>
              <span
                className={`badge ${
                  a.status === "enabled" ? "badge-green" : a.status === "paused" ? "badge-yellow" : "badge-gray"
                }`}
              >
                {a.status}
              </span>
            </div>
            <div className="text-sm text-ink-500 space-y-1 mb-4">
              <div>Schedule: <code>{a.cron ?? "event-driven"}</code></div>
              <div>
                Last run:{" "}
                {a.last_run_at
                  ? formatDistanceToNow(new Date(a.last_run_at), { addSuffix: true })
                  : "never"}
              </div>
            </div>
            <form className="flex gap-2">
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="tenantId" value={tenant.id} />
              <input type="hidden" name="newStatus" value={a.status === "enabled" ? "disabled" : "enabled"} />
              <button formAction={toggleAgent} className="btn btn-secondary">
                {a.status === "enabled" ? "Disable" : "Enable"}
              </button>
              <button formAction={triggerAgentManual} className="btn btn-primary">
                Run now
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
