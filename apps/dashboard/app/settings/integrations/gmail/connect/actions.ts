"use server";

import nodemailer from "nodemailer";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveGmailSmtp(formData: FormData): Promise<ActionResult> {
  const tenantId = String(formData.get("tenantId"));
  const from = String(formData.get("from") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim().replace(/\s+/g, "");

  if (!tenantId) return { ok: false, error: "Missing tenantId." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
    return { ok: false, error: "Ogiltig avsändaradress." };
  }
  if (password.length < 12 || password.length > 32) {
    return {
      ok: false,
      error: "App Password verkar ogiltigt (förväntas ~16 tecken utan mellanslag). Generera ett nytt på myaccount.google.com/apppasswords.",
    };
  }

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return { ok: false, error: "Du är inte inloggad." };

  const { data: membership } = await supa
    .from("users_tenants")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (!membership) return { ok: false, error: "Du är inte medlem i denna tenant." };
  if (membership.role !== "owner" && membership.role !== "admin") {
    return { ok: false, error: "Bara owner eller admin kan koppla integrations." };
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
    return { ok: false, error: `SMTP-verifiering misslyckades: ${raw}.${hint}` };
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
      { onConflict: "tenant_id,kind,label" },
    );

  if (upsertErr) {
    return { ok: false, error: `Kunde inte spara integration: ${upsertErr.message}` };
  }

  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor: `user:${auth.user.id}`,
    action: "integration.connected",
    subject_type: "integrations",
    subject_id: null,
    metadata: { kind: "gmail", transport: "smtp", from },
  });

  return { ok: true };
}
