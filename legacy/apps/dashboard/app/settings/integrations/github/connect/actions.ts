"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { upsertIntegration } from "@/lib/upsert-integration";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveGithub(formData: FormData): Promise<ActionResult> {
  const tenantId = String(formData.get("tenantId"));
  const token = String(formData.get("token") ?? "").trim();
  const org = String(formData.get("org") ?? "").trim();

  if (!tenantId) return { ok: false, error: "Missing tenantId." };
  if (!token) return { ok: false, error: "Personal Access Token krävs." };

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

  const testRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!testRes.ok) {
    return { ok: false, error: `GitHub-verifiering misslyckades (HTTP ${testRes.status}). Kontrollera token och behörigheter.` };
  }
  const user = await testRes.json() as { login?: string };

  const { error } = await upsertIntegration({
    tenant_id: tenantId,
    kind: "github",
    label: `GitHub (${user.login ?? "connected"})`,
    status: "active",
    credentials: { token, ...(org ? { org } : {}) },
    config: { org: org || null },
    last_synced_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: `Kunde inte spara: ${error.message}` };

  return { ok: true };
}
