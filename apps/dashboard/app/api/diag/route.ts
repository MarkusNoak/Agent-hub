import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

/**
 * GET /api/diag
 * Diagnostic endpoint — tests every layer of the agent stack and returns
 * a plain-language report. Safe to call; read-only.
 */
export async function GET() {
  const results: Record<string, unknown> = {};

  // ── 1. Environment variables ────────────────────────────────────────────────
  results["env"] = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
      ? `set (${process.env.ANTHROPIC_API_KEY.length} chars, starts with ${process.env.ANTHROPIC_API_KEY.slice(0, 7)}…)`
      : "MISSING ❌",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `set (${process.env.NEXT_PUBLIC_SUPABASE_URL})`
      : "MISSING ❌",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? `set (${process.env.SUPABASE_SERVICE_ROLE_KEY.length} chars)`
      : "MISSING ❌",
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "not set (will use claude-haiku-4-5-20251001)",
    AGENT_MAX_ITERATIONS: process.env.AGENT_MAX_ITERATIONS ?? "not set (will use 25)",
  };

  // ── 2. Supabase admin connection ────────────────────────────────────────────
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("agent_runs")
      .select("id, status, error, iterations, started_at")
      .order("started_at", { ascending: false })
      .limit(5);
    if (error) throw error;
    results["supabase"] = {
      ok: true,
      recent_runs: (data ?? []).map((r) => ({
        id: (r.id as string).slice(0, 8) + "…",
        status: r.status,
        iterations: r.iterations,
        error: r.error ?? null,
        started_at: r.started_at,
      })),
    };
  } catch (e) {
    results["supabase"] = { ok: false, error: (e as Error).message };
  }

  // ── 3. Anthropic API ping ───────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    results["anthropic"] = { ok: false, error: "ANTHROPIC_API_KEY not set" };
  } else {
    try {
      const client = new Anthropic({ apiKey });
      const start = Date.now();
      const resp = await Promise.race([
        client.messages.create({
          model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply with just: ok" }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out after 30s")), 30_000),
        ),
      ]);
      results["anthropic"] = {
        ok: true,
        latency_ms: Date.now() - start,
        model: resp.model,
        response: resp.content[0]?.type === "text" ? resp.content[0].text : "(non-text)",
        tokens_used: resp.usage.input_tokens + resp.usage.output_tokens,
      };
    } catch (e) {
      results["anthropic"] = { ok: false, error: (e as Error).message };
    }
  }

  // ── 4. Agent + tenant rows ──────────────────────────────────────────────────
  try {
    const admin = createSupabaseAdminClient();
    const { data: agents } = await admin
      .from("agents")
      .select("id, kind, status, tenant_id")
      .eq("kind", "sales");
    const { data: tenants } = await admin
      .from("tenants")
      .select("id, slug, name, settings")
      .limit(3);
    results["db_rows"] = {
      sales_agents: agents ?? [],
      tenants: (tenants ?? []).map((t) => ({
        id: (t.id as string).slice(0, 8) + "…",
        slug: t.slug,
        name: t.name,
        settings_keys: Object.keys((t.settings as Record<string, unknown>) ?? {}),
        has_google_api_key: !!(t.settings as Record<string, unknown>)?.["google_api_key"],
        has_google_cse_id: !!(t.settings as Record<string, unknown>)?.["google_cse_id"],
        has_anthropic_key: !!(t.settings as Record<string, unknown>)?.["anthropic_api_key"],
      })),
    };
  } catch (e) {
    results["db_rows"] = { ok: false, error: (e as Error).message };
  }

  // ── 5. agent_run_steps for the most recent run ──────────────────────────────
  try {
    const admin = createSupabaseAdminClient();
    const { data: latestRun } = await admin
      .from("agent_runs")
      .select("id, status, error, iterations")
      .order("started_at", { ascending: false })
      .limit(1)
      .single();
    if (latestRun) {
      const { data: steps } = await admin
        .from("agent_run_steps")
        .select("step_index, kind, payload")
        .eq("run_id", latestRun.id)
        .order("step_index", { ascending: true });
      results["latest_run_steps"] = {
        run_id: (latestRun.id as string).slice(0, 8) + "…",
        status: latestRun.status,
        error: latestRun.error,
        iterations: latestRun.iterations,
        step_count: steps?.length ?? 0,
        steps: (steps ?? []).slice(0, 10).map((s) => ({
          step: s.step_index,
          kind: s.kind,
          summary:
            s.kind === "tool_use"
              ? `tool: ${(s.payload as Record<string, unknown>)?.name}`
              : s.kind === "tool_result"
              ? `result ok=${!(s.payload as Record<string, unknown>)?.error}: ${JSON.stringify(s.payload).slice(0, 120)}`
              : JSON.stringify(s.payload).slice(0, 120),
        })),
      };
    }
  } catch (e) {
    results["latest_run_steps"] = { ok: false, error: (e as Error).message };
  }

  const allOk =
    (results["supabase"] as { ok: boolean }).ok &&
    (results["anthropic"] as { ok: boolean }).ok;

  return NextResponse.json({ status: allOk ? "all_good" : "issues_found", ...results }, { status: 200 });
}
