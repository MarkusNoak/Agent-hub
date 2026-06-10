-- ============================================================
-- Expand sales offers: add `agent_platform` as a sellable offer.
-- Sales Agent now sells both WKI core services (webb/app/ai-auto)
-- and Agent Hub itself (agent_platform).
-- ============================================================

-- 1. Extend offer_type enum.
alter type public.offer_type add value if not exists 'agent_platform';

-- 2. Extend tenant settings so the Sales Agent knows which product
--    lines this tenant is allowed to sell + the secondary ICP used
--    when pitching the agent platform (different buyer, different pain).
update public.tenants
set settings = settings
  || jsonb_build_object(
    'offer_types', array['webb_design','app_development','ai_automation','agent_platform'],
    'agent_platform_icp', jsonb_build_object(
      'industries', array['professional_services','agencies','consulting','saas','industrial'],
      'company_size', '10-200',
      'geography', array['SE','NO','DK','FI'],
      'pains', array[
        'manual invoice chasing',
        'weekly status reports by hand',
        'cold outreach bottlenecked on founder time',
        'PM chasing timesheets / variance manually',
        'LinkedIn content ad-hoc'
      ]
    ),
    'meta_pitch_enabled', true
  )
where slug = 'we-know-it';

-- 3. Bump Sales Agent default config so it splits daily drafts between
--    core services and agent_platform (70/30) — tenable in dashboard.
update public.agents
set config = config
  || jsonb_build_object(
    'offer_mix', jsonb_build_object(
      'webb_design', 0.25,
      'app_development', 0.25,
      'ai_automation', 0.20,
      'agent_platform', 0.30
    ),
    'meta_pitch_enabled', true
  )
where kind = 'sales'
  and tenant_id = (select id from public.tenants where slug = 'we-know-it');
