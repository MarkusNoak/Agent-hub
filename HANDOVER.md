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

1. **Subtree-merge** wkit-agent-hub into this repo under `legacy/`
   (preserve history):
   `git subtree add --prefix=legacy <wkit-agent-hub-url> <default-branch>`
2. **Audit** `legacy/`: architecture, how agents/cron run on Vercel, why it
   stalled 2026-05-19 (check Vercel cron config, expired credentials,
   error handling), and anything valuable not yet in V2.
3. **Port the keepers into V2** (priority order):
   - Approval queue: human-in-the-loop before outreach sends (V2 sends
     after agent guardrails only; V1's pending-approval model is better
     for trust — add approval status to sequence_steps + UI + approve/
     reject endpoints)
   - Cost tracking per agent run (V1's agent_runs.cost_usd)
   - Any Visma/Fortnox upsell logic worth keeping
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
