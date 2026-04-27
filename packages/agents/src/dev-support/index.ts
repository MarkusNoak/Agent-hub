import { z } from "zod";
import type { AgentDefinition } from "@agent-hub/core";
import type { TrelloConnector, GithubConnector, SlackConnector } from "@agent-hub/connectors";

const InputSchema = z.object({
  // Chat mode — question from the dashboard chat UI
  question: z.string().optional(),
  // Trello blocker mode
  card_id: z.string().optional(),
  // PR review mode
  pr_repo: z.string().optional(),
  pr_number: z.number().optional(),
  // Shared
  issue_description: z.string().optional(),
  repo: z.string().optional(),
  developer_name: z.string().optional(),
});

const OutputSchema = z.object({
  mode: z.enum(["chat", "trello", "pr_review"]),
  diagnosis: z.string(),
  suggested_fixes: z.array(
    z.object({
      summary: z.string(),
      detail: z.string(),
      references: z.array(z.string()).default([]),
    }),
  ),
  next_action: z.string(),
  posted: z.boolean().default(false),
});

export const devSupportAgent: AgentDefinition<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> = {
  kind: "dev_support",
  displayName: "Dev Support Agent",
  description:
    "Three modes: (1) Chat — answers developer questions from the dashboard; (2) Trello — responds to blocker cards; (3) PR Review — auto-reviews GitHub pull requests and posts comments.",
  requiresApproval: false,

  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  systemPrompt: (tenant) => `You are the **Dev Support Agent** for ${tenant.tenantName}.

You operate in three modes — detect which from the input:

## CHAT mode (input.question is set)
The developer asked a question in the dashboard chat. Answer directly and concisely.
- Search GitHub issues first if the question sounds like a bug or known problem
- Give concrete answers: code snippets, commands, links
- If you don't know, say so — don't guess
- Output mode="chat", fill diagnosis with your answer, suggested_fixes with any actionable steps

## TRELLO mode (input.card_id is set)
A developer flagged a blocker on a Trello card.
1. Call "get_card_context" to read the full card
2. Search past GitHub issues for similar problems
3. Post 1–3 concrete suggestions as a Trello comment via "post_card_comment"
4. Optionally ping the developer on Slack via "notify_on_slack"
- Output mode="trello", posted=true

## PR REVIEW mode (input.pr_repo + input.pr_number are set)
Review a GitHub pull request.
1. Call "get_pr_details" to read the PR title, description, and diff
2. Analyse for: bugs, security issues, missing error handling, test coverage gaps, style problems
3. Write a concise, constructive review — highlight what's good, flag what needs attention
4. Post review via "post_pr_review" with event="COMMENT" (never REQUEST_CHANGES unless clearly broken)
- Output mode="pr_review", posted=true

## Universal rules
- Be specific — no vague advice
- Include code snippets or exact commands when relevant
- If you can't confidently diagnose, say so and suggest who to escalate to`,

  tools: [
    // ── Chat / shared tools ──────────────────────────────────────
    {
      name: "search_issues",
      description: "Search GitHub issues for similar problems.",
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
        return { results: results.slice(0, 8) };
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

    // ── Trello mode tools ────────────────────────────────────────
    {
      name: "get_card_context",
      description: "Fetch a Trello card's full context (name, desc, comments, labels).",
      input_schema: {
        type: "object",
        properties: { card_id: { type: "string" } },
        required: ["card_id"],
      },
      execute: async (args, ctx) => {
        const trello = ctx.connectors.trello as TrelloConnector | undefined;
        if (!trello) throw new Error("Trello not configured");
        return await trello.getCard(String(args["card_id"]));
      },
    },
    {
      name: "post_card_comment",
      description: "Post a formatted markdown comment on a Trello card.",
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
      description: "Ping the developer on Slack that a comment was posted.",
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

    // ── PR review tools ──────────────────────────────────────────
    {
      name: "get_pr_details",
      description: "Fetch a GitHub pull request's details and changed files with diffs.",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          pr_number: { type: "number" },
        },
        required: ["repo", "pr_number"],
      },
      execute: async (args, ctx) => {
        const gh = ctx.connectors.github as GithubConnector | undefined;
        if (!gh) throw new Error("GitHub not configured");
        const [pr, files] = await Promise.all([
          gh.getPR(String(args["repo"]), Number(args["pr_number"])),
          gh.getPRFiles(String(args["repo"]), Number(args["pr_number"])),
        ]);
        return { pr, files: files.slice(0, 20) };
      },
    },
    {
      name: "post_pr_review",
      description: "Post a review comment on a GitHub pull request.",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string" },
          pr_number: { type: "number" },
          body: { type: "string" },
          event: { type: "string", enum: ["COMMENT", "APPROVE", "REQUEST_CHANGES"] },
        },
        required: ["repo", "pr_number", "body"],
      },
      execute: async (args, ctx) => {
        const gh = ctx.connectors.github as GithubConnector | undefined;
        if (!gh) throw new Error("GitHub not configured");
        await gh.createPRReview(
          String(args["repo"]),
          Number(args["pr_number"]),
          String(args["body"]),
          (args["event"] as "COMMENT" | "APPROVE" | "REQUEST_CHANGES") ?? "COMMENT",
        );
        return { posted: true };
      },
    },
  ],
};
