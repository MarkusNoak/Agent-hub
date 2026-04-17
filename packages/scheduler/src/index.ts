import { Cron } from "croner";
import { createServiceClient, executeAgent, loadTenant, createLogger, type AgentKind } from "@agent-hub/core";
import { AGENT_REGISTRY } from "@agent-hub/agents";
import { loadTenantConnectors } from "@agent-hub/connectors";

/**
 * Scheduler — long-running process (Railway.app worker) that:
 * 1. Queries `agents` rows where status='enabled' and cron is not null.
 * 2. Schedules a Cron job per (tenant_id, agent_kind).
 * 3. Executes the agent on schedule, using tenant-scoped connectors.
 *
 * Webhooks (Visma invoice.created, Trello card.moved, etc.) bypass this
 * and trigger runs directly via the Next.js API routes.
 */

const log = createLogger({ svc: "scheduler" });

async function main() {
  const supabase = createServiceClient();

  log.info("scheduler.starting");

  // Load active agents
  const { data: agents, error } = await supabase
    .from("agents")
    .select("id, tenant_id, kind, cron, tenants(slug, name, settings)")
    .eq("status", "enabled")
    .not("cron", "is", null);

  if (error) {
    log.error("scheduler.load_agents_failed", { error: error.message });
    process.exit(1);
  }

  log.info("scheduler.agents_loaded", { count: agents?.length ?? 0 });

  const jobs: Cron[] = [];

  for (const row of agents ?? []) {
    const agentDef = AGENT_REGISTRY[row.kind as AgentKind];
    if (!agentDef) {
      log.warn("scheduler.unknown_agent_kind", { kind: row.kind });
      continue;
    }

    const tenantRow = row.tenants as {
      slug: string;
      name: string;
      settings: Record<string, unknown>;
    } | null;

    if (!tenantRow) continue;

    const tenantSlug = tenantRow.slug;

    const job = new Cron(row.cron as string, { name: `${tenantSlug}:${row.kind}` }, async () => {
      try {
        const tenant = await loadTenant(supabase, tenantSlug);
        const connectors = await loadTenantConnectors(supabase, tenant);
        const result = await executeAgent({
          tenant,
          agent: agentDef,
          input: {},
          trigger: "cron",
          connectors,
          supabase,
        });
        log.info("scheduler.run_finished", {
          tenant: tenantSlug,
          agent: row.kind,
          runId: result.runId,
          status: result.status,
          costUsd: result.costUsd,
        });
      } catch (e) {
        log.error("scheduler.run_failed", {
          tenant: tenantSlug,
          agent: row.kind,
          error: (e as Error).message,
        });
      }
    });

    log.info("scheduler.job_scheduled", {
      tenant: tenantSlug,
      agent: row.kind,
      cron: row.cron,
      next_run: job.nextRun()?.toISOString(),
    });
    jobs.push(job);
  }

  // Graceful shutdown
  const shutdown = () => {
    log.info("scheduler.shutting_down");
    jobs.forEach((j) => j.stop());
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  log.info("scheduler.ready", { job_count: jobs.length });

  // Keep process alive
  setInterval(() => {
    log.debug("scheduler.heartbeat", { active_jobs: jobs.filter((j) => !j.isStopped()).length });
  }, 60_000);
}

main().catch((e) => {
  log.error("scheduler.fatal", { error: (e as Error).message });
  process.exit(1);
});
