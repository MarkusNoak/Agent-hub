-- Migrate V1 leads (public.leads) into Agent Hub v2 (v2.leads).
--
-- Run AFTER you have registered your organization in the v2 app:
--   1. Register at the deployed v2 app (you become org owner)
--   2. Find your org id:  SELECT id, name FROM v2.organizations;
--   3. Replace YOUR_ORG_ID below and run this in the Supabase SQL editor.
--
-- V1 tables in public are left untouched. Stage mapping:
--   researched -> new | outreach_drafted -> qualified | lost/skipped -> lost

INSERT INTO v2.leads (
    id, org_id, month, company_name, domain, contact_name, contact_email,
    contact_linkedin, source, score, score_reason, status, notes, created_at
)
SELECT
    'v1_' || l.id::text,
    'YOUR_ORG_ID',
    to_char(l.created_at, 'YYYY-MM'),
    l.company_name,
    l.company_domain,
    l.contact_name,
    l.contact_email,
    l.contact_linkedin,
    'v1:' || COALESCE(l.signal_type, 'unknown'),
    l.score::integer,
    NULLIF(l.signal_summary, ''),
    CASE l.stage
        WHEN 'researched' THEN 'new'
        WHEN 'outreach_drafted' THEN 'qualified'
        ELSE 'lost'
    END,
    NULLIF(concat_ws(' | ',
        NULLIF('Erbjudande: ' || COALESCE(l.offer_type, ''), 'Erbjudande: '),
        NULLIF('V1-metadata: ' || COALESCE(l.metadata::text, ''), 'V1-metadata: ')
    ), ''),
    l.created_at
FROM public.leads l
ON CONFLICT (id) DO NOTHING;

-- Preserve V1 lead history as activities
INSERT INTO v2.lead_activities (org_id, lead_id, kind, content, created_at)
SELECT
    'YOUR_ORG_ID',
    'v1_' || m.lead_id::text,
    'v1_' || m.event_type,
    left(m.content::text, 2000),
    m.created_at
FROM public.lead_memory m
WHERE EXISTS (SELECT 1 FROM v2.leads WHERE id = 'v1_' || m.lead_id::text);

-- Import V1 delivered projects so the upsell pipeline (14-60 days
-- post-delivery) keeps working in v2
INSERT INTO v2.completed_projects (
    id, org_id, source, external_id, project_name, company_name,
    contact_name, contact_email, completed_at, value_sek, project_type,
    upsell_contacted_at, created_at
)
SELECT
    'v1_' || p.id::text,
    'YOUR_ORG_ID',
    p.source,
    p.external_id,
    p.project_name,
    p.company_name,
    p.contact_name,
    p.contact_email,
    p.completed_at::text,
    p.value_sek,
    p.project_type,
    p.upsell_contacted_at,
    p.created_at
FROM public.visma_completed_projects p
ON CONFLICT (id) DO NOTHING;

SELECT count(*) AS migrated_leads FROM v2.leads WHERE id LIKE 'v1_%';
SELECT count(*) AS migrated_projects FROM v2.completed_projects
WHERE id LIKE 'v1_%';
