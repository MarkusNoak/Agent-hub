-- Fix integrations unique constraint.
--
-- The original constraint (tenant_id, kind, label) allowed multiple rows of
-- the same kind per tenant (differentiated by label). But loadTenantConnectors
-- returns Record<IntegrationKind, Connector> — one connector per kind — so the
-- multi-row design is not used. The Supabase upsert in saveGmailSmtp already
-- targets onConflict:"tenant_id,kind", which requires this simpler constraint.

alter table public.integrations
  drop constraint if exists integrations_tenant_id_kind_label_key;

alter table public.integrations
  add constraint integrations_tenant_id_kind_key unique (tenant_id, kind);
