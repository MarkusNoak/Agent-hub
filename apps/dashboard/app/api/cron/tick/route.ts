import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { AGENT_REGISTRY } from "@agent-hub/agents";
import { loadTenantConnectors } from "@agent-hub/connectors";
import { executeAgent, loadTenant, type AgentKind } from "@agent-hub/core";

// ------------------------------------------------------------
// Minimal cron matcher — supports the 5-field format used in our
// agent schedules (minute hour day-of-month month day-of-week).
// Handles *, N, N-M, */N and comma lists.
// Returns true if `date` matches the expression.
// ------------------------------------------------------------
function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [mi, ho, dm, mo, dw] = parts;
  const values = [
    date.getMinutes(),        // 0-59
    date.getHours(),          // 0-23
    date.getDate(),           // 1-31
    date.getMonth() + 1,      // 1-12
    date.getDay(),            // 0-6 (0=Sun)
  ];
  const fields = [mi, ho, dm, mo, dw];
  const ranges: [number, number][] = [
    [0, 59], [0, 23], [1, 31], [1, 12], [0, 6],
  ];
  return fields.every((field, i) => matchField(field!, values[i]!, ranges[i]!));
}

function matchField(field: string, value: number, [lo, hi]: [number, number]): boolean {
  return field.split(",").some((piece) => {
    let step = 1;
    let range = piece;
    if (piece.includes("/")) {
      const [r, s] = piece.split("/");
      range = r!;
      step = parseInt(s!, 10) || 1;
    }
    let from = lo;
    let to = hi;
    if (range !== "*") {
      if (range.includes("-")) {
        const [a, b] = range.split("-");
        from = parseInt(a!, 10);
        to = parseInt(b!, 10);
      } else {
        from = to = parseInt(range, 10);
      }
    }
    if (value < from || value > to) return false;
    return (value - from) % step === 0;
  });
}

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

    // Is this agent due? Match the cron expression against the current
    // minute, and guard against double-firing within the same minute by
    // checking last_run_at.
    const cronExpr = row.cron as string;
    const matches = cronMatches(cronExpr, now);
    const last = row.last_run_at ? new Date(row.last_run_at) : null;
    const alreadyRan =
      last !== null && now.getTime() - last.getTime() < 55_000; // <55s = same minute
    const due = matches && !alreadyRan;

    if (!due) {
      skipped.push({
        tenant: tenantRel.slug,
        kind,
        reason: matches
          ? `already ran at ${last?.toISOString()}`
          : `cron ${cronExpr} doesn't match ${now.toISOString()}`,
      });
      continue;
    }

    const agentDef = AGENT_REGISTRY[kind];
    if (!agentDef) {
      skipped.push({ tenant: tenantRel.slug, kind, reason: "unknown kind" });
      continue;
    }

    // Load connectors + dispatch async. We don't await — serverless
    // lets each agent execution run up
