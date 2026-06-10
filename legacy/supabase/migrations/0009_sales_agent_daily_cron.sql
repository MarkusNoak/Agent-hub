-- Update Sales Agent to run every day instead of weekdays only
update public.agents
set cron = '0 8 * * *'
where kind = 'sales'
  and (cron = '0 8 * * 1-5' or cron is null);
