-- ============================================================
-- Prospect DB — Apollo light V1
--
-- Two new tables for pre-indexing prospected companies and their
-- enriched contacts between agent runs. No existing tables modified.
--
-- prospect_companies  — one row per discovered company (from any signal source)
-- prospect_contacts   — verified/scraped contacts per company
--
-- Tenant-isolated (tenant_id on every row, RLS enforced).
-- Service role writes; authed dashboard users read only.
-- ============================================================

-- ------------------------------------------------------------
-- 1. prospect_companies
-- ------------------------------------------------------------
create table public.prospect_companies (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          uuid        not null references public.tenants(id) on delete cascade,
  name               text        not null,
  domain             text,                         -- nullable: no-website leads may have none
  industry           text,
  city               text,
  employees          int,
  source             text        not null,          -- 'jobtech'|'apollo'|'rss'|'allabolag'|'overpass'|'google_cse'
  suggested_offer    text,                          -- 'webb_design'|'app_development'|'agent_platform'
  signals            jsonb       not null default '[]'::jsonb,   -- string[]
  raw_extra          jsonb       not null default '{}'::jsonb,
  enrichment_status  text        not null default 'pending'
                       check (enrichment_status in ('pending','enriched','failed')),
  enriched_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One row per domain per tenant (nulls allowed to repeat — no-website leads).
create unique index prospect_companies_tenant_domain_idx
  on public.prospect_companies(tenant_id, domain)
  where domain is not null;

create index prospect_companies_tenant_status_idx
  on public.prospect_companies(tenant_id, enrichment_status, created_at desc);

create index prospect_companies_tenant_offer_idx
  on public.prospect_companies(tenant_id, suggested_offer, enrichment_status);

-- ------------------------------------------------------------
-- 2. prospect_contacts
-- ------------------------------------------------------------
create table public.prospect_contacts (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  company_id     uuid        not null references public.prospect_companies(id) on delete cascade,
  name           text,
  title          text,
  email          text        not null,
  email_verified boolean     not null default false,
  source         text        not null default 'website_scrape',  -- 'website_scrape'|'proff'|'apollo'|'generated'
  created_at     timestamptz not null default now()
);

-- One email per tenant (case-insensitive dedup).
create unique index prospect_contacts_tenant_email_idx
  on public.prospect_contacts(tenant_id, lower(email));

create index prospect_contacts_company_idx
  on public.prospect_contacts(company_id);

-- ------------------------------------------------------------
-- 3. updated_at trigger for prospect_companies
-- ------------------------------------------------------------
create trigger prospect_companies_updated
  before update on public.prospect_companies
  for each row execute function public.tg_set_updated_at();

-- ------------------------------------------------------------
-- 4. Row Level Security
-- ------------------------------------------------------------
alter table public.prospect_companies enable row level security;
alter table public.prospect_contacts  enable row level security;

-- Members can read; service role (agent) writes via RLS bypass.
create policy "prospect_companies_select_members" on public.prospect_companies
  for select using (tenant_id in (select public.current_user_tenants()));

create policy "prospect_contacts_select_members" on public.prospect_contacts
  for select using (tenant_id in (select public.current_user_tenants()));
