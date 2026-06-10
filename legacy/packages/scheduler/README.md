# @agent-hub/scheduler — LEGACY

> **Detta paket används inte längre i produktion.**
>
> Agent Hub kör nu en serverless schemaläggare via:
>
> - `supabase/migrations/0004_pg_cron_tick.sql` — pg_cron tickar varje minut
> - `apps/dashboard/app/api/cron/tick/route.ts` — Vercel-endpoint som exekverar due agents
>
> Fördelen: ingen alltid-igång worker behövs. Hobby-tier på Vercel + Free-tier på Supabase räcker.

## När du fortfarande kan vilja köra detta

- Lokal utveckling om du vill testa cron-triggern på din egen maskin istället för att öppna en Vercel-URL för pg_cron.
- Air-gapped/on-prem deploys där pg_cron + pg_net inte är tillgängligt.

I alla andra fall: ignorera detta paket. Det byggs fortfarande så tsconfig-references inte bryts, men det körs inte någonstans.
