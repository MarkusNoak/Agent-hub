"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { AGENT_REGISTRY } from "@agent-hub/agents";
import { loadTenantConnectors } from "@agent-hub/connectors";
import { executeAgent, loadTenant, type AgentKind } from "@agent-hub/core";

export async function toggleAgent(formData: FormData) {
  const id = String(formData.get("id"));
  const tenantId = String(formData.get("tenantId"));
  const newStatus = String(formData.get("newStatus"));

  const supa = createSupabaseServerClient();
  await supa
    .from("agents")
    .update({ status: newStatus })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  revalidatePath("/agents");
}

export async function triggerAgentManual(formData: FormData) {
  const id = String(formData.get("id"));
  const tenantId = String(formData.get("tenantId"));

  const supa = createSupabaseServerClient();
  const { data: agentRow, error } = await supa
    .from("agents")
    .select("kind, tenants(slug)")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !agentRow) throw new Error("Agent not found.");

  const admin = createSupabaseAdminClient();
  const tenantsRef = agentRow.tenants as unknown as { slug: string } | { slug: string }[];
  const tenantSlug = Array.isArray(tenantsRef) ? tenantsRef[0]?.slug : tenantsRef?.slug;
  if (!tenantSlug) throw new Error("Tenant slug not found.");
  const tenant = await loadTenant(admin as never, tenantSlug);
  const connectors = await loadTenantConnectors(admin as never, tenant);
  const def = AGENT_REGISTRY[agentRow.kind as AgentKind];
  if (!def) throw new Error(`Unknown agent kind ${agentRow.kind}`);

  try {
    await executeAgent({
      tenant,
      agent: def,
      input: {},
      trigger: "manual",
      connectors,
      supabase: admin as never,
    });
  } catch (e) {
    console.error("manual run failed", e);
  }

  revalidatePath("/agents");
  revalidatePath("/runs");
}

export async function saveAgentConfig(formData: FormData) {
  const agentId = String(formData.get("agentId"));
  const tenantId = String(formData.get("tenantId"));
  const cron = String(formData.get("cron")).trim() || null;
  const systemPrompt = String(formData.get("systemPrompt")).trim() || null;

  const supa = createSupabaseServerClient();
  const { error } = await supa
    .from("agents")
    .update({ cron, system_prompt: systemPrompt })
    .eq("id", agentId)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message);
  revalidatePath("/agents");
}
