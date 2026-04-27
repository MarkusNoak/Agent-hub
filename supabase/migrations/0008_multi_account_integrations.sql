-- Drop the single-account constraint added in 0006
ALTER TABLE public.integrations DROP CONSTRAINT IF EXISTS integrations_tenant_id_kind_key;

-- The original UNIQUE (tenant_id, kind, label) from 0001 already supports multi-account.
-- Ensure it exists (it should already):
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integrations_tenant_id_kind_label_key'
      AND conrelid = 'public.integrations'::regclass
  ) THEN
    ALTER TABLE public.integrations
      ADD CONSTRAINT integrations_tenant_id_kind_label_key UNIQUE (tenant_id, kind, label);
  END IF;
END $$;
