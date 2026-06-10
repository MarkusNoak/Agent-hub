# Go-live guide — Agent Hub (Vercel + Supabase, noll fast kostnad)

**Total tid: ~20 minuter.** Gör stegen i ordning.

---

## Kostnadsöversikt — läs detta först

Du sa "Jag vill inte betala något alls". Här är vad som faktiskt kostar vad:

| Komponent                     | Kostnad                   | Not                                                    |
| ----------------------------- | ------------------------- | ------------------------------------------------------ |
| GitHub (private repo)         | 0 kr                      | Obegränsade privata repos ingår.                       |
| Vercel Hobby (hosting)        | 0 kr                      | Räcker för dashboard + cron-endpoint. 100 GB bandwidth.|
| Supabase Free (db + auth)     | 0 kr                      | 500 MB db, 2 projekt, pg_cron ingår.                   |
| pg_cron (schemaläggaren)      | 0 kr                      | Körs inne i Supabase — ingen separat worker behövs.    |
| **Anthropic API (Claude)**    | **Per token, default Haiku 4.5** | Enda riktiga kostnaden. Se tabell nedan.         |
| Domän (valfritt)              | ~80 kr/år                 | Valfritt. `*.vercel.app` räcker för demo.              |

**Vad Claude-anropen faktiskt kostar per månad** (Haiku 4.5 = $1 input / $5 output per 1M tokens):

| Användningsprofil                                       | Tokens/mån (ung.) | USD/mån  | SEK/mån  |
| ------------------------------------------------------- | ----------------- | -------- | -------- |
| Bara Invoice Agent, 4 körningar/mån, 1 tenant (WKI)     | ~0,3M in / 0,05M ut | $0,55  | ~6 kr    |
| + Sales Agent dagligen, 5 free-source tools              | ~3M in / 0,4M ut  | $5,00    | ~55 kr   |
| Alla 7 agenter igång, WKI internt (worst case)           | ~8M in / 1M ut    | $13,00   | ~140 kr  |
| 5 betalande tenants utöver WKI                           | 5× ovan           | $65,00   | ~700 kr  |

**Så ja — Anthropic API går inte att få gratis.** Men:

1. Med Haiku 4.5 som default (redan konfigurerat i `runtime.ts`) landar du på 6-140 kr/mån beroende på hur många agenter du enablar.
2. Du får 5 USD i startkredit från Anthropic när du skapar kontot → **första ~3 månaderna är 0 kr.**
3. När du säljer platformen vidare: sätt pris så att API-kostnaden ligger inom marginal. Förslag: 1 995 kr/mån per tenant → ~90 % bruttomarginal.
4. Behöver du absolut noll kostnad: skippa `ANTHROPIC_API_KEY` tills du ska dema — då kör dashboarden på seed-data utan att anropa Claude.

---

## Vad du behöver

- [GitHub](https://github.com) — för att pusha koden (gratis)
- [Supabase](https://supabase.com) — databas + auth + pg_cron (gratis)
- [Vercel](https://vercel.com) — hosting av dashboard + cron-endpoint (gratis)
- [Anthropic console](https://console.anthropic.com) — API-nyckel (5 USD gratis startkredit)

---

## Steg 1 — Pusha koden till GitHub (3 min)

```bash
cd agent-hub
git init
git add .
git commit -m "Initial commit — Agent Hub"

# Gå till github.com → New repository → 'agent-hub' → Private → Create
# Kopiera URL:en:

git remote add origin https://github.com/DITT-USERNAME/agent-hub.git
git branch -M main
git push -u origin main
```

---

## Steg 2 — Skapa Supabase-projekt + migrations (5 min)

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Namn: `agent-hub-prod`. Region: **Stockholm (eu-north-1)**. Spara db-lösenordet.
3. Vänta ~2 min på provisioning.
4. **Project Settings → API** → kopiera: `Project URL`, `anon public`, `service_role`.

Kör migrations lokalt:

```bash
# Installera Supabase CLI
brew install supabase/tap/supabase

supabase login
supabase link --project-ref DITT-PROJECT-REF

# Kör alla 5 migrations (0001-0005)
supabase db push
```

Kör demo-seeden (REKOMMENDERAT inför första externa demon):

```bash
pnpm install

SUPABASE_URL="https://....supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
TENANT_SLUG=we-know-it \
pnpm seed:demo
```

Nu har du 14 dagar av realistiska agent-runs, 24 leads och 8 pending approvals. Dashboarden visar grafer direkt utan att du behövt koppla någon connector.

---

## Steg 3 — Deploy till Vercel (5 min)

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → välj `agent-hub`.
2. Vercel läser `vercel.json` automatiskt. Framework: Next.js. Root: `apps/dashboard`. Region: `arn1` (Stockholm).
3. **Environment Variables** — lägg till:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://....supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-haiku-4-5-20251001
   AGENT_MAX_ITERATIONS=15
   WEBHOOK_SECRET=generera-en-lång-slumpmässig-sträng
   CRON_SECRET=generera-en-annan-lång-slumpmässig-sträng
   ```

4. Klicka **Deploy**. Vänta ~3 min. Du får en URL: `https://agent-hub-xxx.vercel.app`.
5. I Supabase → **Authentication → URL Configuration** → lägg till `https://agent-hub-xxx.vercel.app/auth/callback` som Redirect URL.

---

## Steg 4 — Aktivera pg_cron (2 min)

pg_cron tickar `/api/cron/tick` varje minut. Den hittar due agents och kör dem via Vercel (max 300s per körning). Ingen scheduler-worker. Allt gratis.

Öppna Supabase → **SQL Editor** → kör:

```sql
select agent_hub_configure_cron(
  'https://agent-hub-xxx.vercel.app/api/cron/tick',   -- byt till din riktiga URL
  'samma-cron-secret-som-du-satte-i-vercel'
);
```

Verifiera att det funkar:

```sql
select * from agent_hub_cron_status;
-- Du ska se: jobname=agent-hub-tick, active=true, last_status='succeeded'
```

Vänta 1-2 min och kör igen. Fältet `last_run_at` ska ha uppdaterats. Då vet du att Supabase → Vercel-flödet funkar.

---

## Steg 5 — Första login + owner-roll (2 min)

1. Öppna Vercel-URL:en i inkognitoflik.
2. Ange `markus@weknowit.se` → magic link mejlas.
3. Klicka på magic link → du landar på `/`.
4. Du är inte owner på tenanten än. Supabase → **SQL Editor**:

   ```sql
   insert into users_tenants (user_id, tenant_id, role)
   select auth.users.id,
          (select id from tenants where slug = 'we-know-it'),
          'owner'
   from auth.users
   where email = 'markus@weknowit.se';
   ```

5. Refresha dashboarden. Du ser overview med demo-data (om du körde seed-scriptet).

---

## Steg 6 — Demo-förberedelse (1 min)

Innan externa demos:
- Kör `pnpm seed:demo` igen för att "reset:a" tiderna så allt ser färskt ut.
- Gå till `/approvals` — där ligger meta-pitch-mejlen redo att visas.
- Impact-KPIn visar 28h sparade + 26 600 SEK återvunnen tid.

**Demo-scenario som säljer sig självt:**

1. Öppna `/` → peka på impact-KPIn
2. Peka på live-activity feeden (pulsar var 3:e sekund)
3. Klicka `/approvals` → visa meta-pitch-mejlet: "detta mejl skrevs av agenten — det kan vara ditt bolags mejl nästa vecka"
4. Öppna `/leads` → offer-mix-grafen: "agenten säljer våra tjänster OCH säljer sig själv"
5. Öppna `/agents` → "dom 7 agenterna. Du väljer vilka som körs hos er"

**Stäng så här:** *"Det du ser är vårt eget interna system. Vill du ha samma dag 1? Vi aktiverar en tenant för ditt bolag på 30 minuter."*

---

## Riktig drift — vad som behövs sedan

När du är klar med demon och ska köra på riktigt internt på WKIT:

1. **Rensa demo-datat:**
   ```sql
   delete from leads where tenant_id = (select id from tenants where slug = 'we-know-it');
   delete from agent_runs where tenant_id = (select id from tenants where slug = 'we-know-it');
   delete from approval_queue where tenant_id = (select id from tenants where slug = 'we-know-it');
   ```

2. **Koppla Fortnox + Gmail** i `/integrations`, enable Invoice Agent.
3. **Första veckan:** godkänn manuellt varje utkast i `/approvals` tills du litar på agenten.
4. **Vecka 2-4:** enable Sales Agent (5 free-source tools körs automatiskt — RSS, Allabolag-scrape, Arbetsförmedlingen Jobs, Google CSE, Visma upsell).

---

## Troubleshooting

**"relation users_tenants does not exist"** → du körde inte migrations. Gå tillbaka till steg 2.

**Magic link kommer inte fram** → Supabase Free tier har rate-limit 4/h. Vänta eller uppgradera.

**`agent_hub_cron_status` visar `last_status='failed'`** → CRON_SECRET matchar inte mellan Vercel och `agent_hub_configure_cron()`. Kör funktionen igen med rätt secret.

**Vercel build kraschar på "Cannot find module '@agent-hub/core'"** → `vercel.json` ska bygga packages i rätt ordning. Verifiera att `buildCommand` är intakt.

**Kostnader skenar** → sätt `AGENT_MAX_ITERATIONS=10` (default 15). Dubbel-checka att `ANTHROPIC_MODEL` är `claude-haiku-4-5-20251001`, inte Sonnet eller Opus.

**`/api/cron/tick` returnerar 401** → CRON_SECRET saknas eller är fel i Authorization-headern. Kolla att pg_cron-jobben skickar `Bearer <secret>`.
