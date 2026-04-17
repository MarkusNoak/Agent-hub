-- ============================================================
-- Bootstrap seed — create We Know IT tenant + default agents
-- Run AFTER first user has signed up.
-- ============================================================

-- This migration is idempotent and safe to re-run.

-- 1. Create default tenant (We Know IT)
insert into public.tenants (slug, name, plan, settings)
values (
  'we-know-it',
  'We Know IT AB',
  'internal',
  jsonb_build_object(
    'company_url', 'https://weknowit.se',
    'icp', jsonb_build_object(
      'industries', array['saas','fintech','e-commerce','industrial'],
      'company_size', '20-500',
      'geography', array['SE','NO','DK','FI']
    ),
    'offer_types', array['webb_design','app_development','ai_automation']
  )
)
on conflict (slug) do nothing;

-- 2. Create default agent configs for the WKI tenant.
with wki as (select id from public.tenants where slug = 'we-know-it')
insert into public.agents (tenant_id, kind, name, status, cron, config)
select
  wki.id,
  k.kind::public.agent_kind,
  k.name,
  'disabled',     -- enable explicitly from dashboard
  k.cron,
  k.config::jsonb
from wki, (values
  ('invoice',        'Invoice Agent',        null,          '{"reminder_days":[3,7,14],"escalate_days":30}'),
  ('finance_report', 'Finance Report Agent', '0 7 * * 5',   '{"period":"weekly","recipients":["markus@weknowit.se"]}'),
  ('sales',          'Sales Agent',          '0 8 * * 1-5', '{"max_outreach_per_day":15,"require_approval":true}'),
  ('client_status',  'Client Status Agent',  '0 9 * * 1',   '{"risk_threshold_hours":8}'),
  ('dev_support',    'Dev Support Agent',    null,          '{"trigger":"trello_label:blocker"}'),
  ('project',        'Project Agent',        '0 */4 * * *', '{"alert_variance_pct":15}'),
  ('marketing',      'Marketing Agent',      '0 10 1 * *',  '{"channels":["linkedin"],"tone":"sharp-executive"}')
) as k(kind, name, cron, config)
on conflict (tenant_id, kind) do nothing;
