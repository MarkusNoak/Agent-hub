"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { AGENT_REGISTRY } from "@agent-hub/agents";
import { loadTenantConnectors } from "@agent-hub/connectors";
import { executeAgent, loadTenant, type AgentKind } from "@agent-hub/core";

// Keep the Vercel lambda alive for up to 300 s while the agent runs in background.
// This applies to all server actions exported from this file.
export const maxDuration = 300;

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

/**
 * Kick off a one-off run from the UI.
 *
 * Pattern: resolve the action immediately so the browser gets its response,
 * then let executeAgent run in the background. The `maxDuration = 300` export
 * above keeps the Vercel lambda alive for up to 5 minutes after the response
 * is sent, long enough for the 120 s Anthropic timeout + DB update to complete.
 */
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

  // Fire-and-forget: the promise keeps running after this action returns.
  // Vercel honours pending async work up to maxDuration before killing the lambda.
  void executeAgent({
    tenant,
    agent: def,
    input: {},
    trigger: "manual",
    connectors,
    supabase: admin as never,
  }).catch((e) => console.error("[triggerAgentManual] run failed:", e));

  // Return to browser immediately — /runs auto-refreshes every 5 s.
  revalidatePath("/agents");
  revalidatePath("/runs");
}
