"use server";

import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export async function saveTrello(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId"));
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();

  if (!tenantId) throw new Error("Missing tenantId.");
  if (!apiKey) throw new Error("API Key krävs.");
  if (!token) throw new Error("Token krävs.");

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

  const testRes = await fetch(
    `https://api.trello.com/1/members/me?key=${apiKey}&token=${token}&fields=fullName`,
  );
  if (!testRes.ok) {
    throw new Error(`Trello-verifiering misslyckades (HTTP ${testRes.status}). Kontrollera API Key och Token.`);
  }
  const me = await testRes.json() as { fullName?: string };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("integrations").upsert(
    {
      tenant_id: tenantId,
      kind: "trello",
      label: `Trello (${me.fullName ?? "connected"})`,
      status: "active",
      credentials: { api_key: apiKey, token },
      config: {},
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,kind,label" },
  );
  if (error) throw new Error(`Kunde inte spara: ${error.message}`);
}
