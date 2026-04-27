import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { AGENT_REGISTRY } from "@agent-hub/agents";
import { loadTenantConnectors } from "@agent-hub/connectors";
import { executeAgent, loadTenant } from "@agent-hub/core";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  // Auth check
  const supa = createSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const tenant = await getActiveTenant();
  if (!tenant) return NextResponse.json({ error: "no tenant" }, { status: 403 });

  const body = (await req.json()) as { message?: string };
  const question = body.message?.trim();
  if (!question) return NextResponse.json({ error: "message required" }, { status: 400 });

  const agentDef = AGENT_REGISTRY["dev_support"];
  if (!agentDef) return NextResponse.json({ error: "agent not found" }, { status: 500 });

  const admin = createSupabaseAdminClient();

  try {
    const tenantCtx = await loadTenant(admin as never, tenant.slug);
    const connectors = await loadTenantConnectors(admin as never, tenantCtx);

    const result = await executeAgent({
      tenant: tenantCtx,
      agent: agentDef,
      input: { question },
      trigger: "manual",
      connectors,
      supabase: admin as never,
    });

    if (result.status !== "succeeded" || !result.output) {
      return NextResponse.json({
        answer: "Agenten kunde inte besvara din fråga just nu.",
        fixes: [],
        error: result.error,
      });
    }

    const out = result.output as {
      diagnosis: string;
      suggested_fixes: Array<{ summary: string; detail: string; references: string[] }>;
      next_action: string;
    };

    return NextResponse.json({
      answer: out.diagnosis,
      fixes: out.suggested_fixes ?? [],
      next_action: out.next_action ?? null,
      cost_usd: result.costUsd,
    });
  } catch (e) {
    console.error("chat error", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
