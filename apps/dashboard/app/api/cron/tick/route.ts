import { NextRequest, NextResponse } from "next/server";
import { Cron } from "croner";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { AGENT_REGISTRY } from "@agent-hub/agents";
import { loadTenantConnectors } from "@agent-hub/connectors";
import { executeAgent, loadTenant, type AgentKind } from "@agent-hub/core";

// Vercel serverless timeout. Pro tier gives us 300s per invocation,
// enough for typical agent runs (4-45s). Long-running agents are
// fire-and-forget via the background execution pattern below.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * pg_cron tick endpoint.
 *
 * Called every minute by the Supabase pg_cron job configured in
 * supabase/migrations/0004_pg_cron_tick.sql. Loops enabled agents,
 * finds the ones whose schedule says "run now", and kicks off their
 * executions asynchronously. Replaces the long-running scheduler
 * worker — Vercel serverless does the job.
 *
 * Authed with CRON_SECRET so random internet requests can't trigger
 * paid Claude API calls on your behalf.
 */
export async function POST(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();

  // Pull every enabled agent with a cron expression, across tenants.
  const { data: rows, error } = await admin
    .from("agents")
    .select(
      "id, tenant_id, kind, name, cron, last_run_at, next_run_at, tenants!inner(slug, name, settings, plan)",
    )
    .eq("status", "enabled")
    .not("cron", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const dispatched: Array<{ tenant: string; kind: string; runId?: string }> = [];
  const skipped: Array<{ tenant: string; kind: string; reason: string }> = [];

  for (const row of rows ?? []) {
    const tenantRel = row.tenants as unknown as {
      slug: string;
      name: string;
      settings: Record<string, unknown>;
      plan: string;
    };
    const kind = row.kind as AgentKind;

    // Is this agent due?
    const cron = new Cron(row.cron as string, { maxRuns: 1 });
    const last = row.last_run_at ? new Date(row.last_run_at) : null;
    const nextFromLast = last ? cron.nextRun(last) : cron.nextRun();
    const due = nextFromLast && nextFromLast <= now;

    if (!due) {
      skipped.push({
        tenant: tenantRel.slug,
        kind,
        reason: `next at ${nextFromLast?.toISOString() ?? "unknown"}`,
      });
      continue;
    }

    const agentDef = AGENT_REGISTRY[kind];
    if (!agentDef) {
      skipped.push({ tenant: tenantRel.slug, kind, reason: "unknown kind" });
      continue;
    }

    // Load connectors + dispatch async. We don't await — serverless
    // lets each agent execution run up to maxDuration on its own.
    (async () => {
      try {
        const tenant = await loadTenant(admin as never, tenantRel.slug);
        const connectors = await loadTenantConnectors(admin as never, tenant);
        await executeAgent({
          tenant,
          agent: agentDef,
          input: {},
          trigger: "cron",
          connectors,
          supabase: admin as never,
        });
        await admin
          .from("agents")
          .update({ last_run_at: new Date().toISOString() })
          .eq("id", row.id as string);
      } catch (e) {
        console.error(`tick: ${tenantRel.slug}/${kind} failed`, e);
      }
    })();

    dispatched.push({ tenant: tenantRel.slug, kind });
  }

  return NextResponse.json({
    ok: true,
    ticked_at: now.toISOString(),
    dispatched,
    skipped,
  });
}

// Healthcheck — pg_cron can hit this too to verify the endpoint lives.
export async function GET() {
  return NextResponse.json({ ok: true, service: "agent-hub-tick" });
}
