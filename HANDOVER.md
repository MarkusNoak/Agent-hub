# Handover — convergence of Agent Hub v2 and wkit-agent-hub

**For the next Claude Code session.** Read this first, then execute the plan
below. The owner (Markus) wants minimal manual involvement — drive it.

## Current state (2026-06-10)

- **This repo** is Agent Hub v2: multi-tenant SaaS growth platform
  (FastAPI + 15 tool-using agents + signal-first prospecting + GDPR outreach
  + learning loop). All merged to the default branch via PR #1 and #2.
  README.md documents everything.
- **Database**: dual driver (`backend/dbdriver.py`). `DATABASE_URL` set →
  Supabase Postgres, schema `v2` — ALREADY APPLIED to the production
  project `agent-hub-prod` (id `mhpmdlcdjvwglivzcgio`). Unset → local
  SQLite for dev.
- **Legacy production system**: `MarkusNoak/wkit-agent-hub` (likely
  Next.js), deployed on Vercel, runs against the SAME Supabase project but
  in schema `public` (tables: tenants, agents, agent_runs, approval_queue,
  leads (59 rows), lead_memory, integrations gmail/github,
  visma_completed_projects). It has been idle since 2026-05-19 with 55
  pending approvals — find out why during the audit.
- `scripts/migrate_v1_leads.sql` is ready: imports V1 leads + lead_memory
  into v2 after an organization is registered (replace YOUR_ORG_ID).

## The plan (owner has approved direction: one repo, one system, V2 is the base)

1. ✅ DONE **Subtree-merge** — wkit-agent-hub lives under `legacy/` with
   full history (`git log --follow legacy/...` works).
2. ✅ DONE **Audit** `legacy/`. Key findings:
   - V1 is a Next.js 14 pnpm monorepo (dashboard on Vercel, pg_cron in
     Supabase POSTs to `/api/cron/tick` every minute).
   - **Why it stalled 2026-05-19:** OAuth token refresh was never
     implemented (`legacy/packages/connectors/src/invoicing.ts:67` —
     "Token refresh omitted here"). Visma/Fortnox tokens expire after
     ~1h; all API calls then 401, the approval queue stopped filling,
     and errors only went to stdout — no retry, no alert. The 55 pending
     approvals predate the stall.
   - Worth keeping (now ported): approval queue, cost tracking, Visma
     upsell window. Lower priority, NOT ported: audit_log, per-step run
     logging, Slack approval notifications.
3. ✅ DONE **Port the keepers into V2**:
   - **Approval queue**: sequences now default to status
     `awaiting_approval`; nothing sends until approved. New APPROVALS
     view in the UI (edit subject/body, approve/reject with reason),
     endpoints under `/api/outreach/approvals`, org setting
     `require_approval` (default on) to opt out.
   - **Cost tracking**: `usage_events.model` + `cost_usd` with per-model
     pricing (`database.MODEL_PRICING`); dashboard shows monthly AI cost
     total and per-agent cost.
   - **Upsell pipeline**: `completed_projects` table + agent tools
     `list_upsell_candidates` (14–60 days post-delivery, not yet
     contacted), `add_completed_project`, `mark_upsell_contacted`.
   - Supabase prod (`mhpmdlcdjvwglivzcgio`): migration
     `v2_approvals_cost_upsell` APPLIED (new table + columns in schema
     v2). `scripts/migrate_v1_leads.sql` now also imports
     `visma_completed_projects`.
4. **Deploy V2**: Railway/Render/Fly (NOT Vercel — websockets/schedulers),
   env keys copied from the Vercel project settings, DATABASE_URL from
   Supabase. Register org, run migrate_v1_leads.sql, verify LEADS view.
5. **Decommission V1**: point the domain at the new service, pause the
   Vercel project. Do not delete anything until the owner confirms the
   migration is verified.

## Remaining known gaps (after the above)

- Stripe billing (plan switching is free self-serve today; integration
  point documented in backend/routers/account_routes.py)
- Live verification of external APIs (JobTech/TED/allabolag/VIES were
  mock-validated — the dev sandbox blocked outbound network; supervise the
  first production prospecting run)
- SMTP/IMAP not yet live-tested; outreach defaults to dry-run until
  EMAIL_ENABLED=true

## Owner context

We Know IT — Swedish development consultancy. Sweden-first growth focus.
The platform is also meant to be sold to their customers (multi-tenant,
per-org business profiles adapt the agents to any business).
