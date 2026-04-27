import { z } from "zod";

// ------------------------------------------------------------
// Canonical identifiers
// ------------------------------------------------------------

export const AGENT_KINDS = [
  "invoice",
  "finance_report",
  "sales",
  "client_status",
  "dev_support",
  "project",
  "marketing",
] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export const INTEGRATION_KINDS = [
  "visma_spiris",
  "fortnox",
  "clockify",
  "trello",
  "linkedin",
  "gmail",
  "slack",
  "github",
] as const;

export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

// ------------------------------------------------------------
// Tenant context — threaded through every agent invocation
// ------------------------------------------------------------

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  settings: Record<string, unknown>;
}

// ------------------------------------------------------------
// Agent contract
// ------------------------------------------------------------

export interface AgentDefinition<Input = any, Output = any> {
  kind: AgentKind;
  /** Human-readable name shown in dashboard. */
  displayName: string;
  /** One-paragraph description for UI. */
  description: string;
  /** System prompt — may be overridden per-tenant via agents.system_prompt. */
  systemPrompt: (ctx: TenantContext) => string;
  /** Tool definitions this agent has access to (JSON schema). */
  tools: AgentTool[];
  /** Zod schema for validated input. */
  inputSchema: z.ZodTypeAny;
  /** Zod schema for validated output. */
  outputSchema: z.ZodTypeAny;
  /** Optional default cron expression. */
  defaultCron?: string;
  /** Whether actions taken by this agent require human approval before execution. */
  requiresApproval: boolean;
  /** Optional model override. Falls back to ANTHROPIC_MODEL env var then claude-haiku-4-5-20251001. */
  model?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Tool executor — receives tenant context automatically. */
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  tenant: TenantContext;
  runId: string;
  connectors: Record<IntegrationKind, unknown>;   // typed by consumer
  supabase: unknown;                              // SupabaseClient
  logger: Logger;
}

export interface Logger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

// ------------------------------------------------------------
// Run result
// ------------------------------------------------------------

export interface RunResult<O = unknown> {
  runId: string;
  status: "succeeded" | "failed" | "cancelled";
  output?: O;
  error?: string;
  iterations: number;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
}

// ------------------------------------------------------------
// Zod schemas for common shapes
// ------------------------------------------------------------

export const ApprovalActionSchema = z.enum([
  "send_email",
  "send_invoice_reminder",
  "post_linkedin",
  "create_trello_card",
  "update_lead_stage",
  "notify_slack",
]);

export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;

export const LeadSignalSchema = z.object({
  type: z.enum(["funding", "hiring", "growth", "manual"]),
  summary: z.string(),
  source_url: z.string().url().optional(),
  detected_at: z.string().datetime(),
});

export type LeadSignal = z.infer<typeof LeadSignalSchema>;
