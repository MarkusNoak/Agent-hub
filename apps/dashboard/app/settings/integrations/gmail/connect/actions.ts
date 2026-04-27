"use server";

import nodemailer from "nodemailer";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export async function saveGmailSmtp(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenantId"));
  const from = String(formData.get("from") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim().replace(/\s+/g, "");

  if (!tenantId) throw new Error("Missing tenantId.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
    throw new Error("Ogiltig avsändaradress.");
  }
  if (password.length < 12 || password.length > 32) {
    throw new Error(
      "App Password verkar ogiltigt (förväntas ~16 tecken utan mellanslag). Generera ett nytt på myaccount.google.com/apppasswords.",
    );
  }

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) throw new Error("Du är inte inloggad.");

  const { data: membership } = await supa
    .from("users_tenants")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (!membership) throw new Error("Du är inte medlem i denna tenant.");
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new Error("Bara owner eller admin kan koppla integrations.");
  }

  // Verify SMTP credentials before saving.
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: from, pass: password },
  });
  try {
    await transporter.verify();
  } catch (e) {
    const raw = (e as Error).message ?? "Okänt SMTP-fel";
    const hint =
      raw.includes("535") || raw.includes("Username and Password not accepted")
        ? " Trolig orsak: fel App Password, eller App Passwords är inte aktiverade för ditt konto (Google Workspace-admin kan ha blockerat det)."
        : raw.includes("534")
        ? " Aktivera 2FA och skapa ett App Password på myaccount.google.com/apppasswords."
        : "";
    throw new Error(`SMTP-verifiering misslyckades: ${raw}.${hint}`);
  }

  const admin = createSupabaseAdminClient();
  const { error: upsertErr } = await admin
    .from("integrations")
    .upsert(
      {
        tenant_id: tenantId,
        kind: "gmail",
        label: `Gmail (${from})`,
        status: "active",
        credentials: { from, password },
        config: { transport: "smtp", host: "smtp.gmail.com", port: 587 },
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,kind" },
    );

  if (upsertErr) {
    throw new Error(`Kunde inte spara integration: ${upsertErr.message}`);
  }

  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor: `user:${auth.user.id}`,
    action: "integration.connected",
    subject_type: "integrations",
    subject_id: null,
    metadata: { kind: "gmail", transport: "smtp", from },
  });
}
