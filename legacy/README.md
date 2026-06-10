# Agent Hub

Multi-tenant AI agent platform. Seven agents that automate finance, sales, delivery, and marketing for a services business — built to run internally at We Know IT and to be productized as a plug-and-play SaaS for customers.

## What's in the box

Seven agents, all running on the same runtime, all tenant-isolated:

| Agent | Trigger | Output |
|---|---|---|
| Invoice | daily 09:00 | Drafted reminders → approval queue |
| Finance Report | Fridays 07:00 | Weekly P&L + utilization narrative |
| Sales | business days 08:00 | Personalized outreach drafts → approval queue |
| Client Status | Mondays 09:00 | Per-client health snapshot |
| Dev Support | Trello label `blocker` | Diagnosis + suggestions posted to card |
| Project | every 4h | Variance / staleness alerts to PM |
| Marketing | monthly | LinkedIn post drafts → approval queue |

## Architecture

```
apps/dashboard            Next.js 14 UI (approvals, agents, leads, runs, settings)
packages/core             Runtime: Claude tool-use loop, TenantScopedDb, approvals
packages/connectors       Visma, Fortnox, Clockify, Trello, Gmail, LinkedIn, GitHub, Slack
packages/agents           The 7 agents — system prompts + tool definitions
packages/scheduler        Long-running worker (Railway) with cron-per-tenant-agent
supabase/migrations       Full schema + RLS policies (tenant_id everywhere)
```

**Multi-tenancy is baked in at every layer.** Every domain table has a `tenant_id` column and an RLS policy that filters by `users_tenants` membership. The service-role runtime uses `TenantScopedDb`, a wrapper that prepends `.eq('tenant_id', ...)` to every query. Integrations (credentials + config) are per-tenant rows, so spinning up a new customer is a tenant insert + a few OAuth flows — not a code change.

## Local setup

Requirements: Node 20+, pnpm 9, Docker (for local Supabase), an Anthropic API key.

```bash
pnpm install

# Start local Supabase and apply migrations
npx supabase start
npx supabase db push

# Copy env
cp .env.example .env.local
# Fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY

# Build core packages (required once, then pnpm dev for watch)
pnpm --filter @agent-hub/core build
pnpm --filter @agent-hub/connectors build
pnpm --filter @agent-hub/agents build

# Start dashboard
pnpm --filter @agent-hub/dashboard dev
# Open http://localhost:3000 and sign in with magic link
```

After signing up, promote yourself to `owner` on the We Know IT tenant:

```sql
insert into users_tenants (user_id, tenant_id, role)
select auth.uid(), (select id from tenants where slug = 'we-know-it'), 'owner'
from auth.users where email = 'markus@weknowit.se';
```

Then open `/settings` to connect integrations, and `/agents` to enable the agents.

## Running the scheduler

```bash
pnpm --filter @agent-hub/scheduler dev
```

The scheduler polls `agents` where `status='enabled' and cron is not null`, and schedules a Cron job per tenant/agent.

Webhooks (e.g. Visma invoice.created) post to `/api/agents/<kind>/run` with `x-tenant-slug` and `x-webhook-secret` headers — these bypass cron and trigger an immediate run.

## Deploying to Railway

Two services, same repo:

1. **dashboard** — builds `@agent-hub/dashboard`, runs `next start`
2. **scheduler** — builds `@agent-hub/scheduler`, runs `node dist/index.js`

See `railway.toml` for build/start commands. Point both at Supabase in production, set `ANTHROPIC_API_KEY`, and the scheduler starts firing.

## Adding a new tenant (customer)

```sql
insert into tenants (slug, name, plan) values ('acme', 'ACME AB', 'pro');

-- Create default agent configs
with t as (select id from tenants where slug = 'acme')
insert into agents (tenant_id, kind, name, status, cron)
select t.id, k.kind::agent_kind, k.name, 'disabled', k.cron
from t, (values
  ('invoice', 'Invoice Agent', '0 9 * * *'),
  ('finance_report', 'Finance Report Agent', '0 7 * * 5'),
  -- ... etc
) as k(kind, name, cron);
```

Then invite the customer's admin to `users_tenants` with role `owner`, hand them the dashboard URL, and they self-serve integrations from `/settings`.

## Cost guardrails

Every `agent_runs` row records `tokens_input`, `tokens_output`, and computed `cost_usd`. The scheduler's iteration cap (`AGENT_MAX_ITERATIONS`, default 25) bounds worst-case cost per run. Dashboard shows per-month cost on the overview page.

## Security

- `SUPABASE_SERVICE_ROLE_KEY` lives on the scheduler + dashboard server only. Never in the browser.
- `TenantScopedDb` enforces `tenant_id` on every read/write inside tool executors.
- All mutating actions from the dashboard go through Server Actions that re-check tenant membership against RLS.
- Approval queue gates every externally-visible action (email, LinkedIn post, invoice reminder). Zero auto-send by default.
- Integration credentials stored as `jsonb` in `integrations.credentials`. In production, wrap sensitive fields with Supabase Vault.

## What's NOT built yet (by design — obvious cut lines)

- OAuth2 flows for Visma/Fortnox/Google/LinkedIn — scaffolded as `/settings/integrations/<kind>/connect` routes that you wire up per provider. See `apps/dashboard/app/settings/page.tsx`.
- A proper enrichment provider for Sales Agent — `research_company` is currently a stub. Wire up Apollo, Clay, or a custom scraper.
- Billing / plan enforcement — `tenants.plan` exists; add a Stripe subscription hook when the first paying customer shows up.
- Tests — the structure supports Vitest in each package. Add the first tests for the runtime loop and a couple of agent tools.

None of these block internal use. All of them are "when you need them" work, not "build the whole thing first."
