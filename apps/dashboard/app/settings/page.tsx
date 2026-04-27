import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { InviteUserForm } from "./InviteUserForm";
import { AgentSettingsForm } from "./AgentSettingsForm";
import DisconnectButton from "./integrations/DisconnectButton";
import { PageHeader } from "@/app/components/PageHeader";

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

const INTEGRATION_ICONS: Record<string, string> = {
  visma_spiris: "🏦",
  fortnox: "📒",
  clockify: "⏱",
  trello: "📋",
  linkedin: "💼",
  gmail: "✉️",
  slack: "💬",
  github: "🐙",
};

const ROLE_BADGE: Record<string, string> = {
  owner: "badge-blue",
  admin: "badge-blue",
  approver: "badge-yellow",
  viewer: "badge-gray",
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Ägare",
  admin: "Admin",
  approver: "Godkännare",
  viewer: "Läsare",
};

export default async function SettingsPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const { data: integrations } = await supa
    .from("integrations")
    .select("id, kind, label, status, last_synced_at")
    .eq("tenant_id", tenant.id);

  const configuredByKind = new Map<string, Array<{ id: string; label: string; status: string }>>();
  for (const row of integrations ?? []) {
    const kind = row.kind as string;
    if (!configuredByKind.has(kind)) configuredByKind.set(kind, []);
    configuredByKind.get(kind)!.push({
      id: row.id as string,
      label: (row.label ?? kind) as string,
      status: (row.status ?? "active") as string,
    });
  }

  const tenantSettings = (tenant.settings ?? {}) as Record<string, unknown>;

  const { data: members } = await supa
    .from("users_tenants")
    .select("user_id, role, created_at")
    .eq("tenant_id", tenant.id);

  const memberRows = (members ?? []).map((m) => ({
    user_id: m.user_id as string,
    role: m.role as string,
    created_at: m.created_at as string,
    is_you: m.user_id === tenant.user.id,
  }));

  const canInvite = tenant.role === "owner" || tenant.role === "admin";
  const connectedCount = [...configuredByKind.values()].reduce((s, v) => s + v.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inställningar"
        subtitle={`${tenant.name} · ${connectedCount} integrationer anslutna`}
      />

      {/* Integrations */}
      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100">
          <div className="section-label">Integrationer</div>
          <p className="text-xs text-ink-400 mt-0.5">Anslut externa tjänster för att låsa upp agentfunktioner.</p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(INTEGRATION_LABELS).map(([kind, label]) => {
            const accounts = configuredByKind.get(kind) ?? [];
            const isConnected = accounts.length > 0;
            return (
              <div
                key={kind}
                className={`flex items-start gap-3 p-4 rounded-2xl border transition-colors ${
                  isConnected
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-ink-100 bg-white"
                }`}
              >
                <div className="text-xl shrink-0 mt-0.5">{INTEGRATION_ICONS[kind] ?? "🔌"}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-ink-900">{label}</span>
                    {isConnected ? (
                      <a
                        href={`/settings/integrations/${kind}/connect`}
                        className="text-xs text-brand hover:underline whitespace-nowrap"
                      >
                        ＋ Lägg till
                      </a>
                    ) : (
                      <a href={`/settings/integrations/${kind}/connect`} className="btn btn-secondary text-xs py-1 px-3">
                        Anslut
                      </a>
                    )}
                  </div>
                  {accounts.length > 0 ? (
                    <div className="mt-2 space-y-1.5">
                      {accounts.map((acc) => (
                        <div key={acc.id} className="flex items-center gap-2">
                          <span className="badge badge-green text-xs">{acc.label}</span>
                          <DisconnectButton id={acc.id} tenantId={tenant.id} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-ink-400 mt-1">Inte ansluten</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Members */}
      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100">
          <div className="section-label">Teammedlemmar</div>
          <p className="text-xs text-ink-400 mt-0.5">
            {memberRows.length} {memberRows.length === 1 ? "person" : "personer"} i detta workspace.
          </p>
        </div>

        <div className="divide-y divide-ink-50">
          {memberRows.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-ink-900 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {m.user_id.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="font-mono text-xs text-ink-700 leading-tight">{m.user_id}</div>
                  {m.is_you && <div className="text-[10px] text-ink-400 mt-0.5">Du</div>}
                </div>
              </div>
              <span className={`badge ${ROLE_BADGE[m.role] ?? "badge-gray"}`}>
                {ROLE_LABEL[m.role] ?? m.role}
              </span>
            </div>
          ))}
        </div>

        {canInvite && (
          <div className="px-5 py-4 border-t border-ink-100 bg-ink-50/40">
            <div className="section-label mb-3">Bjud in ny teammedlem</div>
            <InviteUserForm tenantSlug={tenant.slug} callerRole={tenant.role} />
          </div>
        )}
        {!canInvite && (
          <div className="px-5 py-3 border-t border-ink-100">
            <p className="text-xs text-ink-400">Endast ägare och admins kan bjuda in nya medlemmar.</p>
          </div>
        )}
      </section>

      {/* Agent settings */}
      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-ink-100">
          <div className="section-label">Agent-inställningar</div>
          <p className="text-xs text-ink-400 mt-0.5">API-nycklar och sökparametrar för agent-körningar.</p>
        </div>
        <div className="p-5">
          <AgentSettingsForm
            tenantId={tenant.id}
            currentSettings={{
              googleApiKey: tenantSettings["google_api_key"] as string | undefined,
              googleCseId: tenantSettings["google_cse_id"] as string | undefined,
            }}
          />
        </div>
      </section>
    </div>
  );
}
