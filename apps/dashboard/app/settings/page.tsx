import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { InviteUserForm } from "./InviteUserForm";
import { AgentSettingsForm } from "./AgentSettingsForm";

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

const ROLE_BADGE: Record<string, string> = {
  owner: "badge-blue",
  admin: "badge-blue",
  approver: "badge-yellow",
  viewer: "badge-gray",
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

  const tenantSettings = (tenant.settings ?? {}) as Record<string, unknown>;

  const { data: members } = await supa
    .from("users_tenants")
    .select("user_id, role, created_at")
    .eq("tenant_id", tenant.id);

  // Emails live in auth.users and are not exposed via PostgREST by default.
  // We show role + user id; email for current user from session.
  const memberRows = (members ?? []).map((m) => ({
    user_id: m.user_id as string,
    role: m.role as string,
    created_at: m.created_at as string,
    is_you: m.user_id === tenant.user.id,
  }));

  const canInvite = tenant.role === "owner" || tenant.role === "admin";

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

      <section className="card p-6 space-y-5">
        <div>
          <h2 className="font-semibold">Members</h2>
          <p className="text-ink-500 text-sm">
            {memberRows.length} member{memberRows.length === 1 ? "" : "s"} on this tenant.
          </p>
        </div>

        <div className="divide-y divide-ink-100 border border-ink-100 rounded-lg">
          {memberRows.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center justify-between p-3 text-sm"
            >
              <div className="font-mono text-xs text-ink-700">
                {m.user_id}
                {m.is_you && (
                  <span className="ml-2 text-ink-500">(you)</span>
                )}
              </div>
              <span className={`badge ${ROLE_BADGE[m.role] ?? "badge-gray"}`}>
                {m.role}
              </span>
            </div>
          ))}
        </div>

        {canInvite ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Invite new member</h3>
            <InviteUserForm tenantSlug={tenant.slug} callerRole={tenant.role} />
          </div>
        ) : (
          <p className="text-xs text-ink-500">
            Only owners and admins can invite new members.
          </p>
        )}
      </section>

      <section className="card p-6">
        <h2 className="font-semibold mb-4">Agent-inställningar</h2>
        <AgentSettingsForm
          tenantId={tenant.id}
          currentSettings={{
            googleApiKey: tenantSettings["google_api_key"] as string | undefined,
            googleCseId: tenantSettings["google_cse_id"] as string | undefined,
          }}
        />
      </section>
    </div>
  );
}
