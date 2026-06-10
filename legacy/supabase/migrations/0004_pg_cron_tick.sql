-- ============================================================
-- Serverless scheduler — pg_cron triggers the Vercel endpoint.
-- Replaces the long-running scheduler worker.
--
-- After running this migration, you MUST manually configure the
-- Vercel URL and CRON_SECRET via the helper function below:
--
--   select agent_hub_configure_cron(
--     'https://agent-hub.vercel.app/api/cron/tick',
--     'your-long-random-cron-secret'
--   );
--
-- ============================================================

-- 1. Enable required extensions (Supabase has both preinstalled).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Track the next run time per agent (so /api/cron/tick only
--    dispatches "due" agents without recomputing every minute).
alter table public.agents
  add column if not exists next_run_at timestamptz;

-- 3. Helper: (re)configure the cron tick.
create or replace function public.agent_hub_configure_cron(
  tick_url text,
  cron_secret text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Drop any existing job with the same name.
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'agent-hub-tick';

  -- Schedule a fresh one, every minute, that POSTs to the Vercel endpoint.
  perform cron.schedule(
    'agent-hub-tick',
    '* * * * *',
    format(
      $job$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || %L
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 5000
      );
      $job$,
      tick_url,
      cron_secret
    )
  );
end;
$$;

comment on function public.agent_hub_configure_cron is
  'Configures (or reconfigures) the pg_cron job that ticks /api/cron/tick every minute. Call after deploy and whenever Vercel URL or CRON_SECRET changes.';

-- 4. Convenience view for debugging.
create or replace view public.agent_hub_cron_status as
select
  j.jobname,
  j.schedule,
  j.active,
  r.start_time as last_run_at,
  r.status as last_status,
  r.return_message as last_message
from cron.job j
left join lateral (
  select *
  from cron.job_run_details
  where jobid = j.jobid
  order by start_time desc
  limit 1
) r on true
where j.jobname = 'agent-hub-tick';

comment on view public.agent_hub_cron_status is
  'Quick diagnostic — is the agent-hub pg_cron job alive and firing successfully?';
