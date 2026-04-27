import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { AGENT_REGISTRY } from "@agent-hub/agents";
import { loadTenantConnectors } from "@agent-hub/connectors";
import { executeAgent, loadTenant, type AgentKind } from "@agent-hub/core";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[kind]/trigger
 * Session-authenticated manual trigger. Returns immediately with { started: true }
 * while the agent runs in the background. The caller should navigate to /runs
 * to watch live status — do NOT await this endpoint in the UI.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { kind: string } },
) {
  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { data: memberships } = await supa
    .from("users_tenants")
    .select("tenant_id, role, tenants(slug)")
    .eq("user_id", auth.user.id)
    .in("role", ["owner", "admin"]);

  const first = memberships?.[0];
  if (!first) {
    return NextResponse.json({ error: "No admin tenant found" }, { status: 403 });
  }

  const tenantRel = first.tenants as unknown as { slug: string } | { slug: string }[];
  const tenantSlug = Array.isArray(tenantRel) ? tenantRel[0]?.slug : tenantRel?.slug;
  if (!tenantSlug) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const kind = params.kind as AgentKind;
  const agentDef = AGENT_REGISTRY[kind];
  if (!agentDef) {
    return NextResponse.json({ error: `Unknown agent: ${kind}` }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const tenant = await loadTenant(admin as never, tenantSlug);
  const connectors = await loadTenantConnectors(admin as never, tenant);

  // Fire and forget — the run continues after this response is sent.
  // On Railway/Node.js this runs to completion; on Vercel it lives up to maxDuration.
  void executeAgent({
    tenant,
    agent: agentDef,
    input: {},
    trigger: "manual",
    connectors,
    supabase: admin as never,
  }).catch((e: unknown) => {
    console.error(`[trigger] ${kind} run failed:`, (e as Error).message);
  });

  return NextResponse.json({ started: true, agent: kind, tenant: tenantSlug });
}
