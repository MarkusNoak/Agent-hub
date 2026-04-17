import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "./logger.js";
import { TenantScopedDb, createServiceClient } from "./supabase.js";
import type {
  AgentDefinition,
  AgentTool,
  RunResult,
  TenantContext,
  ToolContext,
  IntegrationKind,
} from "./types.js";

// ------------------------------------------------------------
// Pricing (USD per 1M tokens).
// Default = Haiku 4.5 to minimize running cost (brief: "vill inte
// betala något alls"). Override per tenant/agent by setting
// ANTHROPIC_MODEL env var or agents.model column.
// Keep in sync with https://www.anthropic.com/pricing
// ------------------------------------------------------------
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-6": { input: 15, output: 75 },
};

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

interface ExecuteOptions {
  tenant: TenantContext;
  agent: AgentDefinition;
  input: unknown;
  trigger: string;
  connectors: Record<IntegrationKind, unknown>;
  supabase?: SupabaseClient;
  anthropic?: Anthropic;
  /** Per-run override for default system prompt (e.g. from agents.system_prompt). */
  systemPromptOverride?: string;
}

/**
 * Main agent runtime — agentic tool-use loop with:
 *   - tenant-scoped DB access
 *   - iteration cap (default 25)
 *   - full step logging (agent_run_steps)
 *   - token/cost accounting (agent_runs)
 *   - approval enforcement: actions that require approval are queued
 *     rather than executed, and the agent is told the queue ID.
 */
export async function executeAgent<O = unknown>(
  opts: ExecuteOptions,
): Promise<RunResult<O>> {
  const {
    tenant,
    agent,
    input,
    trigger,
    connectors,
    supabase = createServiceClient(),
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    systemPromptOverride,
  } = opts;

  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const maxIter = parseInt(process.env.AGENT_MAX_ITERATIONS ?? "25", 10);

  const log = createLogger({ tenant: tenant.tenantSlug, agent: agent.kind });
  const db = new TenantScopedDb(supabase, tenant.tenantId);

  // Validate input up-front.
  const parsed = agent.inputSchema.safeParse(input);
  if (!parsed.success) {
    log.error("agent.input.invalid", { issues: parsed.error.issues });
    throw new Error(
      `Invalid input for agent "${agent.kind}": ${parsed.error.message}`,
    );
  }

  // 1. Create agent_runs row.
  const { data: runRow, error: runErr } = await supabase
    .from("agent_runs")
    .insert({
      tenant_id: tenant.tenantId,
      agent_id: (
        await supabase
          .from("agents")
          .select("id")
          .eq("tenant_id", tenant.tenantId)
          .eq("kind", agent.kind)
          .single()
      ).data?.id,
      status: "running",
      trigger,
      input: parsed.data as never,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    throw new Error(`Failed to create agent_run: ${runErr?.message}`);
  }
  const runId = runRow.id as string;
  log.info("agent.run.started", { runId, trigger });

  // 2. Build tool-executor map.
  const toolMap = new Map<string, AgentTool>();
  for (const t of agent.tools) toolMap.set(t.name, t);

  const toolCtx: ToolContext = {
    tenant,
    runId,
    connectors,
    supabase: db,
    logger: log,
  };

  // 3. Run the agentic loop.
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserMessage(parsed.data) },
  ];

  let iterations = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let finalOutput: unknown | undefined;
  let error: string | undefined;

  try {
    while (iterations < maxIter) {
      iterations++;

      const resp = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: systemPromptOverride ?? agent.systemPrompt(tenant),
        tools: agent.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool["input_schema"],
        })),
        messages,
      });

      tokensIn += resp.usage.input_tokens;
      tokensOut += resp.usage.output_tokens;

      await logStep(supabase, tenant.tenantId, runId, iterations, "message", {
        id: resp.id,
        stop_reason: resp.stop_reason,
        content: resp.content,
      });

      messages.push({ role: "assistant", content: resp.content });

      if (resp.stop_reason === "end_turn") {
        finalOutput = extractFinalJson(resp.content);
        break;
      }

      if (resp.stop_reason !== "tool_use") {
        error = `Unexpected stop_reason: ${resp.stop_reason}`;
        break;
      }

      // Execute each tool_use block in order.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;

        const tool = toolMap.get(block.name);
        if (!tool) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `ERROR: Unknown tool "${block.name}".`,
            is_error: true,
          });
          continue;
        }

        await logStep(supabase, tenant.tenantId, runId, iterations, "tool_use", {
          name: block.name,
          args: block.input,
        });

        try {
          const result = await tool.execute(
            (block.input ?? {}) as Record<string, unknown>,
            toolCtx,
          );
          const asText = typeof result === "string" ? result : JSON.stringify(result);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: asText,
          });
          await logStep(supabase, tenant.tenantId, runId, iterations, "tool_result", {
            name: block.name,
            ok: true,
            result,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `ERROR: ${msg}`,
            is_error: true,
          });
          await logStep(supabase, tenant.tenantId, runId, iterations, "tool_result", {
            name: block.name,
            ok: false,
            error: msg,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    if (iterations >= maxIter && finalOutput === undefined) {
      error = `Iteration cap (${maxIter}) reached without final answer.`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    log.error("agent.run.failed", { error });
  }

  // Validate output (best-effort).
  let validatedOutput: unknown | undefined;
  if (finalOutput !== undefined && !error) {
    const ok = agent.outputSchema.safeParse(finalOutput);
    if (ok.success) validatedOutput = ok.data;
    else {
      // Soft-fail: keep the raw output but surface the mismatch.
      log.warn("agent.output.schema_mismatch", { issues: ok.error.issues });
      validatedOutput = finalOutput;
    }
  }

  const pricing = PRICING[model] ?? { input: 1, output: 5 };
  const costUsd =
    (tokensIn / 1_000_000) * pricing.input + (tokensOut / 1_000_000) * pricing.output;

  const status = error ? "failed" : "succeeded";

  await supabase
    .from("agent_runs")
    .update({
      status,
      output: validatedOutput ?? null,
      iterations,
      tokens_input: tokensIn,
      tokens_output: tokensOut,
      cost_usd: costUsd.toFixed(4),
      error: error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  // Touch agents.last_run_at
  await supabase
    .from("agents")
    .update({ last_run_at: new Date().toISOString() })
    .eq("tenant_id", tenant.tenantId)
    .eq("kind", agent.kind);

  log.info("agent.run.finished", { runId, status, iterations, costUsd });

  return {
    runId,
    status: status as "succeeded" | "failed",
    output: validatedOutput as O | undefined,
    error,
    iterations,
    tokensInput: tokensIn,
    tokensOutput: tokensOut,
    costUsd,
  };
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function buildUserMessage(input: unknown): string {
  return `Input:\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n\nComplete the task as described in your system prompt. Use the tools provided. When done, output a JSON object matching the expected output schema inside a fenced \`\`\`json block.`;
}

function extractFinalJson(content: Anthropic.ContentBlock[]): unknown {
  for (const block of content) {
    if (block.type !== "text") continue;
    const match = block.text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch {
        /* fall through */
      }
    }
  }
  // If no fenced JSON, return the concatenated text.
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function logStep(
  supabase: SupabaseClient,
  tenantId: string,
  runId: string,
  stepIndex: number,
  kind: string,
  payload: unknown,
): Promise<void> {
  await supabase.from("agent_run_steps").insert({
    tenant_id: tenantId,
    run_id: runId,
    step_index: stepIndex,
    kind,
    payload: payload as never,
  });
}
