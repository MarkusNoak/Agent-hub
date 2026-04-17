import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentKind, ApprovalAction, TenantContext } from "./types.js";

export interface CreateApprovalInput {
  tenant: TenantContext;
  agentKind: AgentKind;
  runId: string;
  title: string;
  summary?: string;
  action: ApprovalAction;
  payload: Record<string, unknown>;
  expiresInHours?: number;
}

/** Enqueue a human-approval decision. Called from agent tools. */
export async function enqueueApproval(
  supabase: SupabaseClient,
  input: CreateApprovalInput,
): Promise<{ approvalId: string }> {
  const expires_at = input.expiresInHours
    ? new Date(Date.now() + input.expiresInHours * 3600_000).toISOString()
    : null;

  const { data, error } = await supabase
    .from("approval_queue")
    .insert({
      tenant_id: input.tenant.tenantId,
      run_id: input.runId,
      agent_kind: input.agentKind,
      title: input.title,
      summary: input.summary ?? null,
      action: input.action,
      payload: input.payload,
      expires_at,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to enqueue approval: ${error?.message}`);
  }
  return { approvalId: data.id as string };
}
