-- ============================================================
-- Slack notification on new approval_queue entries.
-- Fires a webhook to the tenant's configured Slack
-- incoming webhook URL whenever an approval is enqueued.
-- Requires pg_net (preinstalled on Supabase).
-- ============================================================

create extension if not exists pg_net;

create or replace function public.notify_slack_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  webhook_url  text;
  payload      jsonb;
  approval_url text;
begin
  -- Look up Slack webhook for this tenant
  select credentials->>'notification_webhook'
  into   webhook_url
  from   integrations
  where  tenant_id = NEW.tenant_id
    and  kind      = 'slack'
    and  status    = 'active'
  limit 1;

  if webhook_url is null then
    return NEW;
  end if;

  -- Build the Slack message
  payload := jsonb_build_object(
    'text', format('🔔 Ny approval väntar: %s', NEW.title),
    'blocks', jsonb_build_array(
      jsonb_build_object(
        'type', 'section',
        'text', jsonb_build_object(
          'type', 'mrkdwn',
          'text', format(
            '*🔔 Ny approval väntar*%n*%s*%n%s%nAgent: `%s` | Action: `%s`',
            NEW.title,
            coalesce(NEW.summary, ''),
            NEW.agent_kind,
            NEW.action
          )
        )
      ),
      jsonb_build_object(
        'type', 'actions',
        'elements', jsonb_build_array(
          jsonb_build_object(
            'type', 'button',
            'text', jsonb_build_object('type', 'plain_text', 'text', '👀 Granska i Agent Hub'),
            'url', 'https://agent-hub.vercel.app/approvals',
            'style', 'primary'
          )
        )
      )
    )
  );

  perform net.http_post(
    url     := webhook_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := payload
  );

  return NEW;
end;
$$;

drop trigger if exists approval_slack_notify on public.approval_queue;

create trigger approval_slack_notify
  after insert on public.approval_queue
  for each row
  execute function public.notify_slack_on_approval();

comment on function public.notify_slack_on_approval is
  'Sends a Slack webhook notification when a new approval is enqueued.';
