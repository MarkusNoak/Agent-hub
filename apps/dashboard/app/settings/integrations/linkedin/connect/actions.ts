"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { upsertIntegration } from "@/lib/upsert-integration";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveLinkedIn(formData: FormData): Promise<ActionResult> {
  const tenantId = String(formData.get("tenantId"));
  const access_token = String(formData.get("access_token") ?? "").trim();
  const author_urn = String(formData.get("author_urn") ?? "").trim();
  let label = String(formData.get("label") ?? "").trim();

  if (!tenantId) return { ok: false, error: "Missing tenantId." };
  if (!access_token) return { ok: false, error: "Access token krävs." };
  if (!author_urn.startsWith("urn:li:")) {
    return { ok: false, error: "Author URN måste börja med urn:li:" };
  }

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

  const meRes = await fetch("https://api.linkedin.com/v2/me", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (meRes.status === 401) {
    return { ok: false, error: "Ogiltig access token — den har troligtvis löpt ut (60 dagar). Generera en ny." };
  }
  if (!meRes.ok) {
    return { ok: false, error: `LinkedIn API-fel (HTTP ${meRes.status}). Kontrollera token.` };
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

  const { error } = await upsertIntegration({
    tenant_id: tenantId,
    kind: "linkedin",
    label,
    status: "active",
    credentials: { access_token, author_urn },
    config: {},
    last_synced_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: `Kunde inte spara integration: ${error.message}` };

  return { ok: true };
}
