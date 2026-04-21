"use server";

import { redirect } from "next/navigation";
import nodemailer from "nodemailer";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

/**
 * Validate the pasted Gmail SMTP credentials and persist them into the
 * integrations table as kind='gmail', status='active'. Uses the admin
 * client for the write so RLS on integrations doesn't block first-time
 * setup when no integration row exists yet.
 */
export async function saveGmailSmtp(formData: FormData) {
  const tenantId = String(formData.get("tenantId"));
  const from = String(formData.get("from") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim().replace(/\s+/g, "");

  if (!tenantId) throw new Error("Missing tenantId.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
    throw new Error("Ogiltig avsändaradress.");
  }
  if (password.length < 12 || password.length > 32) {
    throw new Error(
      "App Password verkar ogiltigt (förväntas ~16 tecken). Generera ett nytt på myaccount.google.com/apppasswords.",
    );
  }

  // Authenticate the caller and verify they're an admin/owner of the tenant.
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
    throw new Error("Bara owner eller admin kan koppla integrations.");
  }

  // Verify the SMTP credentials actually work before saving them.
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: from, pass: password },
  });
  try {
    await transporter.verify();
  } catch (e) {
    const msg = (e as Error).message || "Okänt SMTP-fel";
    throw new Error(
      `SMTP-verifiering misslyckades: ${msg}. Kontrollera att 2FA är på och att App Password är korrekt.`,
    );
  }

  // Upsert into integrations. Use admin client to bypass any RLS quirks on
  // first-time integration setup.
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

  redirect("/settings?gmail=connected");
}
