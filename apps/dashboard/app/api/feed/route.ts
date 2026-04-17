import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Live feed endpoint — polled every 3s by the overview page.
 * Returns the 20 most recent runs for the active tenant with a
 * per-run summary (tool used or drafts queued) so the demo reads
 * like a stream of actions rather than a table of rows.
 */
export async function GET() {
  const tenant = await getActiveTenant();
  if (!tenant) return NextResponse.json({ items: [] });

  const supa = createSupabaseServerClient();

  const { data: runs } = await supa
    .from("agent_runs")
    .select(
      "id, status, cost_usd, iterations, started_at, finished_at, output, agents(kind, name)",
    )
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const items = (runs ?? []).map((r) => {
    const ag = r.agents as { kind: string; name: string } | null;
    const out = r.output as Record<string, unknown> | null;
    let summary: string | null = null;
    if (out) {
      if (typeof out["summary"] === "string") summary = out["summary"] as string;
      else if (Array.isArray(out["drafts_queued"])) {
        summary = `${(out["drafts_queued"] as unknown[]).length} drafts queued for approval`;
      } else if (Array.isArray(out["reminders"])) {
        summary = `${(out["reminders"] as unknown[]).length} invoice reminders drafted`;
      }
    }
    return {
      id: r.id,
      kind: ag?.kind ?? "agent",
      name: ag?.name ?? "Agent",
      status: r.status,
      cost_usd: r.cost_usd,
      iterations: r.iterations,
      started_at: r.started_at,
      finished_at: r.finished_at,
      summary,
    };
  });

  return NextResponse.json({ items });
}
