import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { AGENT_REGISTRY } from "@agent-hub/agents";
import { loadTenantConnectors } from "@agent-hub/connectors";
import { executeAgent, loadTenant, type AgentKind } from "@agent-hub/core";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Webhook endpoint — external triggers (Visma, Trello, Stripe, etc.)
 * POST /api/agents/<kind>/run
 * Headers: x-tenant-slug, x-webhook-secret
 * Body: agent input
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { kind: string } },
) {
  const tenantSlug = req.headers.get("x-tenant-slug");
  const secret = req.headers.get("x-webhook-secret");
  if (!tenantSlug) return NextResponse.json({ error: "Missing x-tenant-slug" }, { status: 400 });
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const kind = params.kind as AgentKind;
  const agent = AGENT_REGISTRY[kind];
  if (!agent) return NextResponse.json({ error: `Unknown agent ${kind}` }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const admin = createSupabaseAdminClient();
  const tenant = await loadTenant(admin as never, tenantSlug);
  const connectors = await loadTenantConnectors(admin as never, tenant);

  // Fire off async; return runId immediately.
  const runPromise = executeAgent({
    tenant,
    agent,
    input: body,
    trigger: `webhook:${kind}`,
    connectors,
    supabase: admin as never,
  });

  // Don't block response; caller can poll /api/runs/:id if needed.
  runPromise.catch((e) => console.error("webhook run failed", e));

  return NextResponse.json({ accepted: true, tenant: tenantSlug, agent: kind });
}
