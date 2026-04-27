"use server";

import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export async function saveClockify(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId"));
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const workspaceId = String(formData.get("workspace_id") ?? "").trim();

  if (!tenantId) throw new Error("Missing tenantId.");
  if (!apiKey) throw new Error("API-nyckel krävs.");
  if (!workspaceId) throw new Error("Workspace ID krävs.");

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) throw new Error("Inte inloggad.");

  const { data: membership } = await supa
    .from("users_tenants")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role as string)) {
    throw new Error("Bara owner eller admin kan koppla integrationer.");
  }

  // Verify API key
  const testRes = await fetch(`https://api.clockify.me/api/v1/workspaces/${workspaceId}`, {
    headers: { "X-Api-Key": apiKey },
  });
  if (!testRes.ok) {
    const msg = testRes.status === 401 ? "Ogiltig API-nyckel." : testRes.status === 403 ? "Åtkomst nekad — kontrollera workspace ID." : `HTTP ${testRes.status}`;
    throw new Error(`Clockify-verifiering misslyckades: ${msg}`);
  }
  const workspace = await testRes.json() as { name?: string };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("integrations").upsert(
    {
      tenant_id: tenantId,
      kind: "clockify",
      label: `Clockify (${workspace.name ?? workspaceId})`,
      status: "active",
      credentials: { api_key: apiKey, workspace_id: workspaceId },
      config: { workspace_id: workspaceId },
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,kind" },
  );
  if (error) throw new Error(`Kunde inte spara: ${error.message}`);
}
