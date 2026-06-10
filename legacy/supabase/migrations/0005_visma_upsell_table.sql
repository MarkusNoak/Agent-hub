-- ============================================================
-- 0005_visma_upsell_table.sql
--
-- Visma upsell source for Sales Agent — stores completed projects
-- (from Visma, Fortnox or any PM system) so the Sales Agent can
-- surface warm upsell candidates 14-60 days after project end.
--
-- Replaces the anon-based version from the standalone
-- wkit-sales-agent. Every row is scoped by tenant_id and
-- protected by RLS using has_tenant_role().
-- ============================================================

create table if not exists public.visma_completed_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- External identifiers (source-of-truth ID in PM system)
  external_id text,                           -- Visma project ID, Fortnox id, etc.
  source text not null default 'visma',       -- 'visma' | 'fortnox' | 'manual' | 'trello'

  -- Project facts
  project_name text not null,
  company_name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,

  completed_at date not null,
  value_sek numeric(12, 2),                   -- project value (optional)
  project_type text,                          -- 'webb' | 'app' | 'ai_automation' | 'other'
  tags text[] not null default array[]::text[],
  notes text,

  -- Upsell workflow state
  upsell_contacted boolean not null default false,
  upsell_contacted_at timestamptz,
  upsell_approval_id uuid references public.approval_queue(id) on delete set null,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, source, external_id)
);

create index if not exists visma_completed_tenant_idx
  on public.visma_completed_projects(tenant_id, completed_at desc);

create index if not exists visma_completed_upsell_idx
  on public.visma_completed_projects(tenant_id, upsell_contacted, completed_at desc);

-- ------------------------------------------------------------
-- Row-level security (tenant-scoped, owner/admin only)
-- ------------------------------------------------------------
alter table public.visma_completed_projects enable row level security;

create policy visma_completed_read
  on public.visma_completed_projects
  for select using (
    tenant_id in (select public.current_user_tenants())
  );

create policy visma_completed_write
  on public.visma_completed_projects
  for all using (
    public.has_tenant_role(
      tenant_id,
      array['owner','admin']::public.tenant_role[]
    )
  )
  with check (
    public.has_tenant_role(
      tenant_id,
      array['owner','admin']::public.tenant_role[]
    )
  );

-- Keep updated_at current.
create or replace function public.touch_visma_completed_projects()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_visma_completed on public.visma_completed_projects;
create trigger trg_touch_visma_completed
  before update on public.visma_completed_projects
  for each row execute function public.touch_visma_completed_projects();

comment on table public.visma_completed_projects is
  'Completed-project feed used by the Sales Agent to surface warm upsell candidates (14-60 days after project end). Populated from Visma/Fortnox/Trello or manual import.';
