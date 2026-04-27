"use server";

import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export async function saveGithub(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId"));
  const token = String(formData.get("token") ?? "").trim();
  const org = String(formData.get("org") ?? "").trim();

  if (!tenantId) throw new Error("Missing tenantId.");
  if (!token) throw new Error("Personal Access Token krävs.");

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

  const testRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!testRes.ok) {
    throw new Error(`GitHub-verifiering misslyckades (HTTP ${testRes.status}). Kontrollera token och behörigheter.`);
  }
  const user = await testRes.json() as { login?: string };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("integrations").upsert(
    {
      tenant_id: tenantId,
      kind: "github",
      label: `GitHub (${user.login ?? "connected"})`,
      status: "active",
      credentials: { token, ...(org ? { org } : {}) },
      config: { org: org || null },
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,kind" },
  );
  if (error) throw new Error(`Kunde inte spara: ${error.message}`);
}
