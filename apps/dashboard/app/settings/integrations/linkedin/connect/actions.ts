"use server";

import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export async function saveLinkedIn(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId"));
  const access_token = String(formData.get("access_token") ?? "").trim();
  const author_urn = String(formData.get("author_urn") ?? "").trim();
  let label = String(formData.get("label") ?? "").trim();

  if (!tenantId) throw new Error("Missing tenantId.");
  if (!access_token) throw new Error("Access token krävs.");
  if (!author_urn.startsWith("urn:li:")) {
    throw new Error("Author URN måste börja med urn:li:");
  }

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

  // Test access token against LinkedIn API
  const meRes = await fetch("https://api.linkedin.com/v2/me", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (meRes.status === 401) {
    throw new Error(
      "Ogiltig access token — den har troligtvis löpt ut (60 dagar). Generera en ny.",
    );
  }
  if (!meRes.ok) {
    throw new Error(`LinkedIn API-fel (HTTP ${meRes.status}). Kontrollera token.`);
  }

  const me = (await meRes.json()) as {
    localizedFirstName?: string;
    localizedLastName?: string;
  };

  if (!label) {
    const firstName = me.localizedFirstName ?? "";
    const lastName = me.localizedLastName ?? "";
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    label = fullName ? `LinkedIn (${fullName})` : "LinkedIn";
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("integrations").upsert(
    {
      tenant_id: tenantId,
      kind: "linkedin",
      label,
      status: "active",
      credentials: { access_token, author_urn },
      config: {},
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,kind,label" },
  );
  if (error) throw new Error(`Kunde inte spara integration: ${error.message}`);
}
