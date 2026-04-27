import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { AGENT_REGISTRY } from "@agent-hub/agents";
import { loadTenantConnectors } from "@agent-hub/connectors";
import { executeAgent, loadTenant, type AgentKind } from "@agent-hub/core";

// Allow up to 5 minutes — Sales agent can take a while.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[kind]/trigger
 * Session-authenticated manual trigger. The browser keeps the connection open
 * until the run completes (up to maxDuration). Use this from the Agents UI
 * instead of a Server Action so the 60-second Server Action limit doesn't apply.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { kind: string } },
) {
  // Validate session
  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  // Resolve tenant for this user
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

  try {
    const result = await executeAgent({
      tenant,
      agent: agentDef,
      input: {},
      trigger: "manual",
      connectors,
      supabase: admin as never,
    });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      status: result.status,
      iterations: result.iterations,
      costUsd: result.costUsd,
      error: result.error ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
