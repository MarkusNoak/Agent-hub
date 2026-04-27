"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { loadTenantConnectors, gmailFactory } from "@agent-hub/connectors";
import type { ApprovalAction, TenantContext } from "@agent-hub/core";

/**
 * Approve an approval-queue item and execute its action.
 * Each action maps to a connector call (email, LinkedIn, invoice reminder, etc.).
 */
export async function approveAction(formData: FormData) {
  const id = String(formData.get("id"));
  const tenantId = String(formData.get("tenantId"));
  const fromIntegrationId = formData.get("from_integration_id")?.toString().trim() || null;

  // Collect any user edits from the approval form
  const editedTo = formData.get("edit_to_email")?.toString().trim();
  const editedSubject = formData.get("edit_subject")?.toString().trim();
  const editedBody = formData.get("edit_body")?.toString().trim();

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) throw new Error("Unauthenticated");

  // Load the approval row via user-client (RLS enforces membership).
  const { data: approval, error } = await supa
    .from("approval_queue")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !approval) throw new Error("Approval not found or access denied.");
  if (approval.status !== "pending") throw new Error("Approval is not pending.");

  // Execute the action using admin client + tenant connectors.
  const admin = createSupabaseAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, slug, name, settings")
    .eq("id", tenantId)
    .single();
  if (!tenant) throw new Error("Tenant not found.");

  const ctx: TenantContext = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    settings: tenant.settings ?? {},
  };

  // If user picked a specific Gmail account, load that connector directly.
  // Otherwise fall back to the first active Gmail via loadTenantConnectors.
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

  // Merge user edits into the payload before execution
  const payload = { ...(approval.payload as Record<string, unknown>) };
  if (editedTo) payload["to_email"] = editedTo;
  if (editedSubject) payload["subject"] = editedSubject;
  if (editedBody) {
    payload["body"] = editedBody;
    payload["body_html"] = editedBody;
  }

  await executeApprovedAction(approval.action as ApprovalAction, payload, connectors);

  // Mark as approved
  await admin
    .from("approval_queue")
    .update({
      status: "approved",
      approved_by: auth.user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id);

  // Advance lead stage to outreach_sent when a sales email is executed
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
}

/** Save edited email fields back to approval_queue.payload without approving. */
export async function saveDraftEdits(formData: FormData) {
  const id = String(formData.get("id"));
  const tenantId = String(formData.get("tenantId"));
  const editedTo = formData.get("edit_to_email")?.toString().trim();
  const editedSubject = formData.get("edit_subject")?.toString().trim();
  const editedBody = formData.get("edit_body")?.toString().trim();

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) throw new Error("Unauthenticated");

  const { data: approval, error } = await supa
    .from("approval_queue")
    .select("payload, status")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !approval) throw new Error("Approval not found.");
  if (approval.status !== "pending") throw new Error("Already processed.");

  const payload = { ...(approval.payload as Record<string, unknown>) };
  if (editedTo) payload["to_email"] = editedTo;
  if (editedSubject) payload["subject"] = editedSubject;
  if (editedBody) {
    payload["body"] = editedBody;
    payload["body_html"] = editedBody;
  }

  await supa
    .from("approval_queue")
    .update({ payload })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  revalidatePath("/approvals");
}

export async function rejectAction(formData: FormData) {
  const id = String(formData.get("id"));
  const tenantId = String(formData.get("tenantId"));
  const reason = String(formData.get("reason") ?? "");

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) throw new Error("Unauthenticated");

  await supa
    .from("approval_queue")
    .update({
      status: "rejected",
      rejection_reason: reason || null,
      approved_by: auth.user.id,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenantId);

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
      if (!gmail?.sendEmail) throw new Error("Gmail connector not configured.");
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
      if (!li?.publishPost) throw new Error("LinkedIn connector not configured.");
      await li.publishPost({ body: String(payload["body"]) });
      return;
    }
    case "create_trello_card":
    case "update_lead_stage":
    case "notify_slack":
      // Implement as needed.
      throw new Error(`Action "${action}" not yet implemented.`);
    default: {
      const never: never = action;
      throw new Error(`Unknown action: ${never as string}`);
    }
  }
}
