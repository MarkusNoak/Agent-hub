import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const INTEGRATION_LABELS: Record<string, string> = {
  visma_spiris: "Visma Spiris",
  fortnox: "Fortnox",
  clockify: "Clockify",
  trello: "Trello",
  linkedin: "LinkedIn",
  gmail: "Gmail",
  slack: "Slack",
  github: "GitHub",
};

export default async function SettingsPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const { data: integrations } = await supa
    .from("integrations")
    .select("kind, label, status, last_synced_at")
    .eq("tenant_id", tenant.id);

  const configured = new Set((integrations ?? []).map((i) => i.kind));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="text-ink-500">Tenant: {tenant.name}</p>
      </header>

      <section className="card p-6">
        <h2 className="font-semibold mb-4">Integrations</h2>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(INTEGRATION_LABELS).map(([kind, label]) => (
            <div key={kind} className="flex items-center justify-between p-3 border border-ink-100 rounded-lg">
              <div>
                <div className="font-medium">{label}</div>
                <div className="text-xs text-ink-500">{kind}</div>
              </div>
              {configured.has(kind) ? (
                <span className="badge badge-green">connected</span>
              ) : (
                <a href={`/settings/integrations/${kind}/connect`} className="btn btn-secondary">
                  Connect
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold mb-4">Members</h2>
        <p className="text-ink-500 text-sm">Invite management UI — TODO.</p>
      </section>
    </div>
  );
}
