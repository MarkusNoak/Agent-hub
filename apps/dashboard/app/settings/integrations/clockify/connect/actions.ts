"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { upsertIntegration } from "@/lib/upsert-integration";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveClockify(formData: FormData): Promise<ActionResult> {
  const tenantId = String(formData.get("tenantId"));
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const workspaceId = String(formData.get("workspace_id") ?? "").trim();

  if (!tenantId) return { ok: false, error: "Missing tenantId." };
  if (!apiKey) return { ok: false, error: "API-nyckel krävs." };
  if (!workspaceId) return { ok: false, error: "Workspace ID krävs." };

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return { ok: false, error: "Inte inloggad." };

  const { data: membership } = await supa
    .from("users_tenants")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role as string)) {
    return { ok: false, error: "Bara owner eller admin kan koppla integrationer." };
  }

  const testRes = await fetch(`https://api.clockify.me/api/v1/workspaces/${workspaceId}`, {
    headers: { "X-Api-Key": apiKey },
  });
  if (!testRes.ok) {
    const msg =
      testRes.status === 401
        ? "Ogiltig API-nyckel."
        : testRes.status === 403
        ? "Åtkomst nekad — kontrollera workspace ID."
        : `HTTP ${testRes.status}`;
    return { ok: false, error: `Clockify-verifiering misslyckades: ${msg}` };
  }
  const workspace = await testRes.json() as { name?: string };

  const { error } = await upsertIntegration({
    tenant_id: tenantId,
    kind: "clockify",
    label: `Clockify (${workspace.name ?? workspaceId})`,
    status: "active",
    credentials: { api_key: apiKey, workspace_id: workspaceId },
    config: { workspace_id: workspaceId },
    last_synced_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: `Kunde inte spara: ${error.message}` };

  return { ok: true };
}
