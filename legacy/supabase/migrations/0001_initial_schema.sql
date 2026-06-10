-- ============================================================
-- Agent Hub — Initial schema (multi-tenant, RLS-enforced)
-- ============================================================
-- Every domain table carries tenant_id and is protected by RLS.
-- Service-role key bypasses RLS and is used by the agent runtime.
-- Anon/authed users (dashboard) see only rows in their tenants.
-- ============================================================

-- Extensions
create extension if not exists "pgcrypto";
create extension if not exists "pg_cron" with schema extensions;

-- ------------------------------------------------------------
-- 1. Tenants & membership
-- ------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  plan text not null default 'internal' check (plan in ('internal','starter','pro','enterprise')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tenants is 'One row per customer (or per internal org). Root of isolation.';

create type public.tenant_role as enum ('owner','admin','approver','viewer');

create table public.users_tenants (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role public.tenant_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index users_tenants_tenant_idx on public.users_tenants(tenant_id);

-- Helper: current user's tenants (used in RLS policies)
create or replace function public.current_user_tenants()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from public.users_tenants where user_id = auth.uid()
$$;

create or replace function public.has_tenant_role(p_tenant_id uuid, p_roles public.tenant_role[])
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users_tenants
    where user_id = auth.uid()
      and tenant_id = p_tenant_id
      and role = any(p_roles)
  )
$$;

-- ------------------------------------------------------------
-- 2. Agents & runs
-- ------------------------------------------------------------
create type public.agent_kind as enum (
  'invoice','finance_report','sales','client_status',
  'dev_support','project','marketing'
);

create type public.agent_status as enum ('disabled','enabled','paused');

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind public.agent_kind not null,
  name text not null,
  status public.agent_status not null default 'disabled',
  cron text,                            -- e.g. '0 7 * * 5' for Fridays 07:00
  config jsonb not null default '{}'::jsonb,   -- per-tenant prompt overrides, thresholds
  system_prompt text,                   -- override default system prompt (nullable)
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind)
);

create index agents_tenant_idx on public.agents(tenant_id);

create type public.run_status as enum ('queued','running','succeeded','failed','cancelled');

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  status public.run_status not null default 'queued',
  trigger text not null,                -- 'cron', 'webhook', 'manual', 'webhook:<name>'
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  iterations int not null default 0,
  tokens_input int not null default 0,
  tokens_output int not null default 0,
  cost_usd numeric(10,4) not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index agent_runs_tenant_idx on public.agent_runs(tenant_id, created_at desc);
create index agent_runs_agent_idx on public.agent_runs(agent_id, created_at desc);

-- Per-run step log (tool calls, model messages) for observability
create table public.agent_run_steps (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  step_index int not null,
  kind text not null,                   -- 'message' | 'tool_use' | 'tool_result'
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index agent_run_steps_run_idx on public.agent_run_steps(run_id, step_index);
create index agent_run_steps_tenant_idx on public.agent_run_steps(tenant_id);

-- ------------------------------------------------------------
-- 3. Approval queue
-- ------------------------------------------------------------
create type public.approval_status as enum ('pending','approved','rejected','expired');

create table public.approval_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  agent_kind public.agent_kind not null,
  title text not null,
  summary text,
  payload jsonb not null,               -- the action to execute on approve (e.g. email draft)
  action text not null,                 -- 'send_email' | 'post_linkedin' | 'send_invoice_reminder' ...
  status public.approval_status not null default 'pending',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejection_reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index approval_queue_tenant_status_idx on public.approval_queue(tenant_id, status, created_at desc);

-- ------------------------------------------------------------
-- 4. Leads (Sales Agent)
-- ------------------------------------------------------------
create type public.lead_stage as enum (
  'new','researched','outreach_drafted','outreach_sent','replied','qualified','won','lost'
);

create type public.offer_type as enum ('webb_design','app_development','ai_automation');

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_name text not null,
  company_domain text,
  contact_name text,
  contact_email text,
  contact_linkedin text,
  signal_type text,                     -- 'funding' | 'hiring' | 'growth' | 'manual'
  signal_summary text,
  offer_type public.offer_type,
  stage public.lead_stage not null default 'new',
  score int,                            -- 0-100 ICP fit
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_tenant_stage_idx on public.leads(tenant_id, stage);
create unique index leads_tenant_domain_idx on public.leads(tenant_id, company_domain)
  where company_domain is not null;

-- ------------------------------------------------------------
-- 5. Integrations (per-tenant credentials, encrypted at rest by Supabase Vault)
-- ------------------------------------------------------------
create type public.integration_kind as enum (
  'visma_spiris','fortnox','clockify','trello','linkedin','gmail','slack','github'
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind public.integration_kind not null,
  label text,                           -- optional friendly name
  -- credentials stored as jsonb; sensitive fields should be wrapped by Supabase Vault.
  credentials jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','error','revoked')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind, label)
);

create index integrations_tenant_idx on public.integrations(tenant_id);

-- ------------------------------------------------------------
-- 6. Events (inbound webhook / signal ingestion)
-- ------------------------------------------------------------
create table public.events (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,                 -- 'visma.invoice.created' | 'trello.card.moved' | ...
  agent_kind public.agent_kind,         -- target agent if any
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index events_tenant_unprocessed_idx on public.events(tenant_id, processed_at)
  where processed_at is null;

-- ------------------------------------------------------------
-- 7. Audit log (every write the agents do)
-- ------------------------------------------------------------
create table public.audit_log (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor text not null,                  -- 'agent:<kind>' | 'user:<uuid>'
  action text not null,                 -- 'lead.created' | 'approval.approved' | ...
  subject_type text,
  subject_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_tenant_idx on public.audit_log(tenant_id, created_at desc);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.tenants enable row level security;
alter table public.users_tenants enable row level security;
alter table public.agents enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_run_steps enable row level security;
alter table public.approval_queue enable row level security;
alter table public.leads enable row level security;
alter table public.integrations enable row level security;
alter table public.events enable row level security;
alter table public.audit_log enable row level security;

-- Tenants: users see tenants they belong to
create policy "tenants_select_members" on public.tenants
  for select using (id in (select public.current_user_tenants()));

create policy "tenants_update_owner" on public.tenants
  for update using (public.has_tenant_role(id, array['owner']::public.tenant_role[]));

-- users_tenants: user sees own memberships; owners see all memberships of their tenants
create policy "ut_select_self_or_owner" on public.users_tenants
  for select using (
    user_id = auth.uid()
    or public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[])
  );

create policy "ut_manage_owner" on public.users_tenants
  for all using (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]));

-- Generic "member can read, admin+ can write" policy macro applied per table:
-- agents
create policy "agents_select_members" on public.agents
  for select using (tenant_id in (select public.current_user_tenants()));
create policy "agents_write_admin" on public.agents
  for all using (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]));

-- agent_runs (read-only for members; writes go through service role)
create policy "runs_select_members" on public.agent_runs
  for select using (tenant_id in (select public.current_user_tenants()));

create policy "run_steps_select_members" on public.agent_run_steps
  for select using (tenant_id in (select public.current_user_tenants()));

-- approval_queue: read for members, approve/reject for approver+
create policy "approvals_select_members" on public.approval_queue
  for select using (tenant_id in (select public.current_user_tenants()));

create policy "approvals_update_approver" on public.approval_queue
  for update using (public.has_tenant_role(tenant_id, array['owner','admin','approver']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin','approver']::public.tenant_role[]));

-- leads: read for members, write for admin+
create policy "leads_select_members" on public.leads
  for select using (tenant_id in (select public.current_user_tenants()));
create policy "leads_write_admin" on public.leads
  for all using (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]));

-- integrations: admin+ only (secrets!)
create policy "integrations_admin" on public.integrations
  for all using (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]));

-- events: members read
create policy "events_select_members" on public.events
  for select using (tenant_id in (select public.current_user_tenants()));

-- audit_log: members read
create policy "audit_select_members" on public.audit_log
  for select using (tenant_id in (select public.current_user_tenants()));

-- ============================================================
-- Triggers: updated_at auto-maintenance
-- ============================================================
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

create trigger tenants_updated before update on public.tenants
  for each row execute function public.tg_set_updated_at();
create trigger agents_updated before update on public.agents
  for each row execute function public.tg_set_updated_at();
create trigger leads_updated before update on public.leads
  for each row execute function public.tg_set_updated_at();
create trigger integrations_updated before update on public.integrations
  for each row execute function public.tg_set_updated_at();
