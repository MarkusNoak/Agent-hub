"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export async function saveAgentSettings(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const googleApiKey = String(formData.get("googleApiKey") ?? "").trim();
  const googleCseId = String(formData.get("googleCseId") ?? "").trim();

  if (!tenantId) throw new Error("Missing tenantId.");

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) throw new Error("Unauthenticated.");

  const { data: membership } = await supa
    .from("users_tenants")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (!membership) throw new Error("Du är inte medlem i denna tenant.");
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new Error("Bara owner eller admin kan ändra agent-inställningar.");
  }

  const { data: tenant, error: fetchErr } = await supa
    .from("tenants")
    .select("settings")
    .eq("id", tenantId)
    .single();
  if (fetchErr || !tenant) throw new Error("Tenant not found.");

  const existing = (tenant.settings ?? {}) as Record<string, unknown>;
  const updated: Record<string, unknown> = { ...existing };

  if (googleApiKey) updated["google_api_key"] = googleApiKey;
  else delete updated["google_api_key"];

  if (googleCseId) updated["google_cse_id"] = googleCseId;
  else delete updated["google_cse_id"];

  const admin = createSupabaseAdminClient();
  const { error: updateErr } = await admin
    .from("tenants")
    .update({ settings: updated, updated_at: new Date().toISOString() })
    .eq("id", tenantId);

  if (updateErr) throw new Error(`Kunde inte spara: ${updateErr.message}`);

  revalidatePath("/settings");
}
