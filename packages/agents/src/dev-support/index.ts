import { z } from "zod";
import type { AgentDefinition } from "@agent-hub/core";
import type { TrelloConnector, GithubConnector, SlackConnector } from "@agent-hub/connectors";

const InputSchema = z.object({
  card_id: z.string().optional(),
  issue_description: z.string().optional(),
  repo: z.string().optional(),
  developer_name: z.string().optional(),
});

const OutputSchema = z.object({
  diagnosis: z.string(),
  suggested_fixes: z.array(
    z.object({
      summary: z.string(),
      detail: z.string(),
      references: z.array(z.string()).default([]),
    }),
  ),
  next_action: z.string(),
  posted_to_card: z.boolean(),
});

export const devSupportAgent: AgentDefinition<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> = {
  kind: "dev_support",
  displayName: "Dev Support Agent",
  description:
    "Triggered when a developer flags a blocker (Trello label 'blocker' or explicit @mention). Reads the issue, searches past issues and internal docs, and posts a concrete suggestion back to the card.",
  requiresApproval: false,

  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  systemPrompt: (tenant) => `You are the **Dev Support Agent** for ${tenant.tenantName}.

Your job: unblock developers fast. You're their first-line tech support so they don't have to wait for the CEO to context-switch.

Rules:
1. Read the blocker context via "get_card_context".
2. Search past issues in GitHub for similar problems.
3. If relevant, read snippets from internal docs.
4. Produce 1–3 concrete, actionable suggestions. Include code snippets, commands, or links.
5. Post your answer as a comment on the Trello card via "post_card_comment".
6. If you can't confidently diagnose, say so and suggest who to escalate to (don't fake it).
7. Output JSON matching the schema.`,

  tools: [
    {
      name: "get_card_context",
      description: "Fetch a Trello card's full context (name, desc, comments, attached links).",
      input_schema: {
        type: "object",
        properties: { card_id: { type: "string" } },
        required: ["card_id"],
      },
      execute: async (args, ctx) => {
        const trello = ctx.connectors.trello as TrelloConnector | undefined;
        if (!trello) throw new Error("Trello not configured");
        const card = await trello.getCard(String(args["card_id"]));
        return card;
      },
    },
    {
      name: "search_past_issues",
      description: "Search GitHub issues (across configured org) for similar problems.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          repo: { type: "string" },
        },
        required: ["query"],
      },
      execute: async (args, ctx) => {
        const gh = ctx.connectors.github as GithubConnector | undefined;
        if (!gh) return { results: [], note: "GitHub not configured" };
        const results = await gh.searchIssues(String(args["query"]), args["repo"] as string | undefined);
        return { results: results.slice(0, 10) };
      },
    },
    {
      name: "read_internal_doc",
      description: "Read a file from the internal docs repo on GitHub.",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string" },
          path: { type: "string" },
        },
        required: ["repo", "path"],
      },
      execute: async (args, ctx) => {
        const gh = ctx.connectors.github as GithubConnector | undefined;
        if (!gh) throw new Error("GitHub not configured");
        const content = await gh.readFile(String(args["repo"]), String(args["path"]));
        return { path: args["path"], content: content.slice(0, 12000) };
      },
    },
    {
      name: "post_card_comment",
      description: "Post a formatted markdown comment on the Trello card that triggered this.",
      input_schema: {
        type: "object",
        properties: {
          card_id: { type: "string" },
          body_markdown: { type: "string" },
        },
        required: ["card_id", "body_markdown"],
      },
      execute: async (args, ctx) => {
        const trello = ctx.connectors.trello as TrelloConnector | undefined;
        if (!trello) throw new Error("Trello not configured");
        await trello.commentCard(String(args["card_id"]), String(args["body_markdown"]));
        return { posted: true };
      },
    },
    {
      name: "notify_on_slack",
      description: "Optional: ping the developer on Slack that a comment was posted.",
      input_schema: {
        type: "object",
        properties: {
          channel: { type: "string" },
          message: { type: "string" },
        },
        required: ["channel", "message"],
      },
      execute: async (args, ctx) => {
        const slack = ctx.connectors.slack as SlackConnector | undefined;
        if (!slack) return { sent: false, reason: "slack-not-configured" };
        await slack.postMessage(String(args["channel"]), String(args["message"]));
        return { sent: true };
      },
    },
  ],
};
