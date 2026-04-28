"use server";

import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveTrello(formData: FormData): Promise<ActionResult> {
  const tenantId = String(formData.get("tenantId"));
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();

  if (!tenantId) return { ok: false, error: "Missing tenantId." };
  if (!apiKey) return { ok: false, error: "API Key krävs." };
  if (!token) return { ok: false, error: "Token krävs." };

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

  const testRes = await fetch(
    `https://api.trello.com/1/members/me?key=${apiKey}&token=${token}&fields=fullName`,
  );
  if (!testRes.ok) {
    return { ok: false, error: `Trello-verifiering misslyckades (HTTP ${testRes.status}). Kontrollera API Key och Token.` };
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
  if (error) return { ok: false, error: `Kunde inte spara: ${error.message}` };

  return { ok: true };
}
