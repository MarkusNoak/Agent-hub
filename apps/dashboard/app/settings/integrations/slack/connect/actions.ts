"use server";

import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveSlack(formData: FormData): Promise<ActionResult> {
  const tenantId = String(formData.get("tenantId"));
  const webhookUrl = String(formData.get("webhook_url") ?? "").trim();
  const botToken = String(formData.get("bot_token") ?? "").trim();

  if (!tenantId) return { ok: false, error: "Missing tenantId." };
  if (!webhookUrl) return { ok: false, error: "Webhook URL krävs." };
  if (!webhookUrl.startsWith("https://hooks.slack.com/")) {
    return { ok: false, error: "Ogiltig webhook URL — ska börja med https://hooks.slack.com/" };
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

  const testRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "✅ Agent Hub Slack-koppling verifierad!" }),
  });
  if (!testRes.ok) {
    return { ok: false, error: `Webhook-test misslyckades (HTTP ${testRes.status}). Kontrollera URL:en.` };
  }

  const admin = createSupabaseAdminClient();
  const credentials: Record<string, string> = { notification_webhook: webhookUrl };
  if (botToken) credentials.bot_token = botToken;

  const { error } = await admin.from("integrations").upsert(
    {
      tenant_id: tenantId,
      kind: "slack",
      label: "Slack",
      status: "active",
      credentials,
      config: {},
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,kind,label" },
  );
  if (error) return { ok: false, error: `Kunde inte spara: ${error.message}` };

  return { ok: true };
}
