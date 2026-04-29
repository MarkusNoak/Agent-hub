import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { AGENT_REGISTRY } from "@agent-hub/agents";
import { loadTenantConnectors } from "@agent-hub/connectors";
import { executeAgent, loadTenant, type AgentKind } from "@agent-hub/core";

// Minimal cron matcher. Supports the 5-field format:
// minute hour day-of-month month day-of-week.
// Handles *, N, N-M, and comma lists.
function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];
  for (let i = 0; i < 5; i++) {
    if (!matchField(parts[i] as string, values[i] as number)) return false;
  }
  return true;
}

function matchField(field: string, value: number): boolean {
  const pieces = field.split(",");
  for (const piece of pieces) {
    if (piece === "*") return true;
    if (piece.includes("-")) {
      const bits = piece.split("-");
      const from = parseInt(bits[0] as string, 10);
      const to = parseInt(bits[1] as string, 10);
      if (value >= from && value <= to) return true;
    } else {
      if (parseInt(piece, 10) === value) return true;
    }
  }
  return false;
}

async function dispatchAgent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  row: { id: string; kind: AgentKind; tenantSlug: string }
): Promise<void> {
  try {
    const tenant = await loadTenant(admin as never, row.tenantSlug);
    const connectors = await loadTenantConnectors(admin as never, tenant);
    const agentDef = AGENT_REGISTRY[row.kind];
    if (!agentDef) return;
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
      .eq("id", row.id);
  } catch (e) {
    console.error("tick dispatch failed", row.tenantSlug, row.kind, e);
  }
}

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();

  // Clean up stuck runs: any run still "running" after 12 minutes is orphaned
  // (lambda was killed, server crashed, etc.). Mark them failed so the UI clears.
  const stuckCutoff = new Date(now.getTime() - 12 * 60 * 1000).toISOString();
  await admin
    .from("agent_runs")
    .update({
      status: "failed",
      error: "Run timed out — process was killed before completion. Try running the agent again.",
      finished_at: now.toISOString(),
    })
    .eq("status", "running")
    .lt("started_at", stuckCutoff);

  const { data: rows, error } = await admin
    .from("agents")
    .select(
      "id, tenant_id, kind, name, cron, last_run_at, next_run_at, tenants!inner(slug, name, settings, plan)"
    )
    .eq("status", "enabled")
    .not("cron", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const dispatched: Array<{ tenant: string; kind: string }> = [];
  const skipped: Array<{ tenant: string; kind: string; reason: string }> = [];

  for (const row of rows ?? []) {
    const tenantRel = row.tenants as unknown as {
      slug: string;
      name: string;
      settings: Record<string, unknown>;
      plan: string;
    };
    const kind = row.kind as AgentKind;
    const cronExpr = row.cron as string;
    const matches = cronMatches(cronExpr, now);
    const last = row.last_run_at ? new Date(row.last_run_at) : null;
    const alreadyRan =
      last !== null && now.getTime() - last.getTime() < 55000;
    const due = matches && !alreadyRan;

    if (!due) {
      skipped.push({
        tenant: tenantRel.slug,
        kind,
        reason: matches ? "already ran this minute" : "not due",
      });
      continue;
    }

    if (!AGENT_REGISTRY[kind]) {
      skipped.push({ tenant: tenantRel.slug, kind, reason: "unknown kind" });
      continue;
    }

    void dispatchAgent(admin, {
      id: row.id as string,
      kind,
      tenantSlug: tenantRel.slug,
    });
    dispatched.push({ tenant: tenantRel.slug, kind });
  }

  return NextResponse.json({
    ok: true,
    ticked_at: now.toISOString(),
    dispatched,
    skipped,
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "agent-hub-tick" });
}
