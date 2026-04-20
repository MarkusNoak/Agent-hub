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

/** Kick off a one-off run from the UI. Uses the admin client to bypass RLS for the write. */
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

  // On Vercel serverless, fire-and-forget promises are killed the moment the
  // HTTP response is sent. Await the run so it actually completes. The UI
  // waits up to `maxDuration` (set on app/agents/page.tsx); for runs that
  // need longer, use the pg_cron scheduler instead.
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
    // Run row is already marked failed inside executeAgent's error handler,
    // so we just swallow here to let the UI revalidate and show the failure.
  }

  revalidatePath("/agents");
  revalidatePath("/runs");
}
