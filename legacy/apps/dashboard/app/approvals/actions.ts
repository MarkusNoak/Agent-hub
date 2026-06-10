"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { loadTenantConnectors, gmailFactory } from "@agent-hub/connectors";
import type { ApprovalAction, TenantContext } from "@agent-hub/core";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function approveAction(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id"));
  const tenantId = String(formData.get("tenantId"));
  const fromIntegrationId = formData.get("from_integration_id")?.toString().trim() || null;

  const editedTo = formData.get("edit_to_email")?.toString().trim();
  const editedSubject = formData.get("edit_subject")?.toString().trim();
  const editedBody = formData.get("edit_body")?.toString().trim();

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return { ok: false, error: "Unauthenticated." };

  const { data: approval, error } = await supa
    .from("approval_queue")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !approval) return { ok: false, error: "Approval not found or access denied." };
  if (approval.status !== "pending") return { ok: false, error: "Approval is not pending." };

  const admin = createSupabaseAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, slug, name, settings")
    .eq("id", tenantId)
    .single();
  if (!tenant) return { ok: false, error: "Tenant not found." };

  const ctx: TenantContext = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    settings: tenant.settings ?? {},
  };

  let connectors = await loadTenantConnectors(admin as never, ctx);
  if (fromIntegrationId) {
    const { data: integration } = await admin
      .from("integrations")
      .select("credentials, config")
      .eq("id", fromIntegrationId)
      .eq("tenant_id", tenantId)
      .eq("kind", "gmail")
      .single();
    if (integration) {
      const specificGmail = await gmailFactory.create({
        tenant: ctx,
        credentials: integration.credentials as Record<string, string>,
        config: (integration.config ?? {}) as Record<string, string>,
      });
      connectors = { ...connectors, gmail: specificGmail };
    }
  }

  const payload = { ...(approval.payload as Record<string, unknown>) };
  if (editedTo) payload["to_email"] = editedTo;
  if (editedSubject) payload["subject"] = editedSubject;
  if (editedBody) {
    payload["body"] = editedBody;
    payload["body_html"] = editedBody;
  }

  try {
    await executeApprovedAction(approval.action as ApprovalAction, payload, connectors);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  await admin
    .from("approval_queue")
    .update({
      status: "approved",
      approved_by: auth.user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);

  const leadId = (approval.payload as Record<string, unknown>)?.["lead_id"] as string | undefined;
  if (approval.action === "send_email" && leadId) {
    await admin
      .from("leads")
      .update({ stage: "outreach_sent", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", leadId);
  }

  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor: `user:${auth.user.id}`,
    action: "approval.approved",
    subject_type: "approval_queue",
    subject_id: id,
    metadata: { approval_action: approval.action },
  });

  revalidatePath("/approvals");
  return { ok: true };
}

export async function saveDraftEdits(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id"));
  const tenantId = String(formData.get("tenantId"));
  const editedTo = formData.get("edit_to_email")?.toString().trim();
  const editedSubject = formData.get("edit_subject")?.toString().trim();
  const editedBody = formData.get("edit_body")?.toString().trim();

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return { ok: false, error: "Unauthenticated." };

  const { data: approval, error } = await supa
    .from("approval_queue")
    .select("payload, status")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !approval) return { ok: false, error: "Approval not found." };
  if (approval.status !== "pending") return { ok: false, error: "Already processed." };

  const payload = { ...(approval.payload as Record<string, unknown>) };
  if (editedTo) payload["to_email"] = editedTo;
  if (editedSubject) payload["subject"] = editedSubject;
  if (editedBody) {
    payload["body"] = editedBody;
    payload["body_html"] = editedBody;
  }

  const { error: updateError } = await supa
    .from("approval_queue")
    .update({ payload })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/approvals");
  return { ok: true };
}

export async function rejectAction(formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id"));
  const tenantId = String(formData.get("tenantId"));
  const reason = String(formData.get("reason") ?? "");

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return { ok: false, error: "Unauthenticated." };

  const { error } = await supa
    .from("approval_queue")
    .update({
      status: "rejected",
      rejection_reason: reason || null,
      approved_by: auth.user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return { ok: false, error: error.message };

  const admin = createSupabaseAdminClient();
  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor: `user:${auth.user.id}`,
    action: "approval.rejected",
    subject_type: "approval_queue",
    subject_id: id,
    metadata: { reason },
  });

  revalidatePath("/approvals");
  return { ok: true };
}

async function executeApprovedAction(
  action: ApprovalAction,
  payload: Record<string, unknown>,
  connectors: Record<string, unknown>,
): Promise<void> {
  switch (action) {
    case "send_email":
    case "send_invoice_reminder": {
      const gmail = connectors["gmail"] as {
        sendEmail: (m: unknown) => Promise<{ message_id: string }>;
      } | undefined;
      if (!gmail?.sendEmail) throw new Error("Gmail-kopplingen är inte konfigurerad. Gå till Inställningar → Gmail.");
      await gmail.sendEmail({
        to: payload["to_email"] ?? payload["customer_email"],
        subject: payload["subject"],
        body_html: payload["body_html"] ?? payload["body"],
      });
      return;
    }
    case "post_linkedin": {
      const li = connectors["linkedin"] as {
        publishPost: (o: { body: string }) => Promise<{ post_id: string }>;
      } | undefined;
      if (!li?.publishPost) throw new Error("LinkedIn-kopplingen är inte konfigurerad.");
      await li.publishPost({ body: String(payload["body"]) });
      return;
    }
    case "create_trello_card":
    case "update_lead_stage":
    case "notify_slack":
      throw new Error(`Åtgärden "${action}" är inte implementerad än.`);
    default: {
      const never: never = action;
      throw new Error(`Okänd åtgärd: ${never as string}`);
    }
  }
}
