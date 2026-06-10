# Agent Hub

A multi-tenant SaaS platform that gives every customer an AI workforce:
15 specialist agents behind a retro pixel-art interface, with real
lead-generation tooling, a built-in lead pipeline (CRM), subscription plans,
usage metering, and a public API.

## The growth engine (signal → meeting, automated)

Five layers turn the platform from a chat tool into a systematic
customer-acquisition machine (built Sweden-first):

1. **Signal-first prospecting** — weekly scheduled runs harvest companies
   with *proven* buying signals into the pipeline: companies actively hiring
   developers (Arbetsförmedlingen JobTech, with org numbers), newly
   registered companies, and funding-round news. ICP profiles (GROWTH view)
   define roles/regions; runs are deterministic (zero LLM cost), deduped,
   quota-aware, and end with a Swedish digest: top 3 to contact and why.
2. **Digital maturity scoring** — every website analysis grades the
   prospect's web presence 0–100 with concrete issues (no HTTPS, not
   mobile-adapted, no analytics, unmaintained, slow). For an IT-services
   seller the issues ARE the pitch.
3. **Outreach sequences** — VANTAGE writes 1–3 personalized emails per lead;
   the engine sends, follows up, stops on reply, classifies the reply
   (meeting/interested/not-now/negative/opt-out) and moves the pipeline
   automatically. GDPR by construction: documented legitimate interest,
   automatic unsubscribe links, permanent suppression list, daily send
   limits. Dry-run by default until `EMAIL_ENABLED=true`.
   **Human-in-the-loop by default:** every drafted email is held in the
   APPROVALS view until a team member approves it (editable before send)
   or rejects it with a reason; orgs can opt out via the
   `require_approval` setting.
4. **Learning loop** — win rates by signal source, industry, and score band;
   score calibration against actual outcomes; reply-rate tracking; concrete
   recommendations on the dashboard. Every closed deal sharpens next month's
   prospecting.
   Cost accounting: every agent interaction records estimated API cost
   (`usage_events.cost_usd`, per-model pricing) — shown on the dashboard
   total and per agent.
   Upsell pipeline: delivered projects (`completed_projects`, importable
   from Visma/Fortnox or added by agents) surface as warm leads 14–60 days
   post-delivery via `list_upsell_candidates` — pitched once, then marked
   contacted.
5. **Public procurement (B2G)** — active Swedish IT tenders from TED (EU's
   official database) via `find_public_tenders`: published need, published
   budget, zero cold outreach.

## The agents

All agents are consultancy-aware (Sweden-first), share a per-org
**knowledge base** (reference cases, tech standards, offerings, processes —
managed in SETTINGS or by the agents themselves), and answer in the user's
language.

| Agent | Specialty | Plan | Tools |
|---|---|---|---|
| NEXUS | Central coordinator & orchestrator | Free | pipeline read, win/loss analytics, knowledge |
| ORACLE | Research & market intelligence | Free | news, funding scan, registries, website audit |
| SCROLL | Writing, proposals & case studies | Free | knowledge search/save |
| FORGE | Dev support & delivery acceleration | Starter | website tech-audit, pipeline read, knowledge |
| LENS | Data, analytics & pipeline insight | Starter | win/loss analytics, pipeline read |
| HERALD | Planning, priorities & project ops | Starter | pipeline read, knowledge |
| PULSE | Marketing, brand & employer branding | Starter | knowledge, news, funding scan |
| HAVEN | Client success & repeat business | Starter | pipeline read/update, knowledge |
| MENTOR | Onboarding & consultant training | Starter | knowledge search/save |
| **VANTAGE** | **Sales & lead generation** | Pro | 21 tools: signal harvesting, enrichment, pipeline, sequences |
| **BEACON** | **Public tenders & bid writing (B2G)** | Pro | TED tenders, knowledge, pipeline |
| SHIELD | Security & GDPR in deliveries | Pro | website audit, SPF/DMARC, MX checks |
| LEDGER | Consultancy finance & pricing | Pro | win/loss analytics, knowledge |
| TALENT | Recruiting & people ops | Pro | knowledge search/save, job-market scan |
| COUNSEL | Contracts & legal for consulting | Pro | knowledge |

### VANTAGE — actionable lead generation

VANTAGE is not a chat-only advisor. It has live tools:

- `search_companies` / `search_people` / `enrich_company` — prospect data via
  **Apollo.io** when `APOLLO_API_KEY` is set; otherwise clearly-marked demo
  data so the product can be demonstrated without credentials.
- `save_lead` — stores qualified leads (0–100 score with rationale, notes,
  and a personalized outreach email draft) in the organization's pipeline.
- `list_leads` / `update_lead` — pipeline review and stage management
  (new → qualified → contacted → meeting → won/lost).

**Free public enrichment** (no credentials, `backend/enrichment/`):

| Tool | Source | Gives you |
|---|---|---|
| `lookup_company_registry` | **SE: allabolag.se + EU VIES**, Brønnøysundregistrene (NO), CVR/cvrapi.dk (DK), PRH/YTJ (FI), Companies House (GB, free key) | Authoritative legal name, org number, active/dissolved/bankrupt status, legal form, official industry code, address, registration date |
| `analyze_website` | The company's own site | Tech stack (Shopify, HubSpot, WordPress, …), social profiles, public contact emails, positioning, language |
| `find_company_news` | Google News RSS (en/sv/no/da/fi) | Timing signals: funding, expansion, hires, launches |
| `find_job_postings` | Arbetsförmedlingen JobTech API (SE) | Active hiring = growth + budget; reveals scaling departments and tech |
| `check_email_domain` | DNS-over-HTTPS (MX records) | Whether a domain accepts email + provider (Google Workspace / Microsoft 365 / …) |

Swedish coverage (Bolagsverket has no free API): name searches scrape
allabolag.se's public pages — politely (rate-limited, identified
User-Agent, parsed from embedded JSON with an HTML fallback) — and
org-number lookups are verified against the official EU VIES VAT API.

VANTAGE layers these in its workflow: verify the company in a registry,
mine the website for fit and contacts, scan local-language news and
Swedish job ads for an outreach hook, and validate the email domain before
a lead is saved — each signal cited in the lead's score rationale.

### Cost controls

- **Server-side caching** (`enrichment_cache`, shared across tenants):
  registries ~30 days, websites ~7 days, news/jobs 24 h, MX 30 days, and —
  most importantly — paid provider searches 7–14 days. The same company
  researched twice costs one API call; cache hits are marked
  `"_cache": "hit"` in tool results. Errors are never cached.
- **Duplicate disqualification**: `save_lead` (and `POST /api/leads`)
  reject leads matching an existing one by org number, domain, contact
  email, or company name — normalized, so `5561112222`, `556111-2222`,
  and `www.` variants all match. The agent is instructed to treat a
  duplicate rejection as final and to check the pipeline *before*
  spending enrichment calls.
- **Prompt-level budget rules**: disqualify cheaply first (registry
  status, MX) before paid provider calls; never repeat identical calls;
  enrich only the shortlist; never re-prospect leads marked `lost`.

Leads land in the **LEADS** view: sortable pipeline, status changes,
outreach-draft copy button, CSV export. New data sources can be added by
implementing `LeadProvider` in `backend/leadgen/providers.py`.

## SaaS framework

- **Multi-tenancy** — organizations with role-based members
  (owner / admin / member); every record is tenant-scoped.
- **Auth** — email + password (PBKDF2), HS256 JWT sessions; zero native
  crypto dependencies.
- **Plans & quotas** — Free / Starter / Pro / Enterprise, defined in
  `backend/plans.py`: message quotas, lead quotas, seat limits, and per-agent
  tier gating, enforced server-side on every message.
- **Usage metering** — per-org, per-agent message and token accounting,
  surfaced in the DASHBOARD view.
- **API keys** — organizations can mint `ahub_…` keys (hash-stored,
  shown once) for the public API.
- **Billing integration point** — `POST /api/billing/plan` switches plans
  self-serve today; wire a payment provider (e.g. Stripe Checkout + webhook)
  in `backend/routers/account_routes.py` before charging customers.

## Public API

```
POST /api/v1/chat
Authorization: Bearer ahub_...
{"agent_id": "vantage", "message": "Find 5 SaaS companies in Stockholm", "session_id": "optional"}
```

Returns the agent's full response, tool calls made, and token usage.
`GET /api/v1/agents` lists agents with plan availability. Interactive docs
at `/docs`.

## Run it

```bash
cp .env.example .env       # set ANTHROPIC_API_KEY, JWT_SECRET (+ APOLLO_API_KEY for live leads)
pip install -r requirements.txt
cd backend && uvicorn main:app --reload
```

Open http://localhost:8000, create an account (you become org owner), pick an
agent. Switch plans in SETTINGS to unlock more agents.

### Docker

```bash
docker build -t agent-hub .
docker run -p 8000:8000 --env-file .env agent-hub
```

## Architecture

```
backend/
  main.py               FastAPI app + authenticated WebSocket chat
  auth.py               JWT, password hashing, API keys (stdlib crypto)
  plans.py              plan & quota definitions
  database.py           tenant-scoped SQLite persistence (Postgres-portable SQL)
  agent_tools.py        tool framework + VANTAGE lead tools
  leadgen/providers.py  Apollo.io provider + demo provider (LeadProvider ABC)
  enrichment/           free public sources: registries, website, news, DNS
  agents/               13 agents; base_agent.py runs the tool-use loop
  routers/              auth, account/billing, leads CRM, public API v1
frontend/               vanilla JS SPA: auth, chat, leads, dashboard, settings
```

## Database

Local development runs on SQLite (zero setup). Production runs on
**Supabase Postgres**: set `DATABASE_URL` and the app uses the `v2` schema
(created automatically on startup; legacy V1 tables in `public` are left
untouched). `scripts/migrate_v1_leads.sql` imports V1 leads + history into
v2 after you register your organization.

## Deploying

The backend needs long-lived processes (WebSocket chat, weekly prospecting
scheduler, sequence engine) — deploy it on Railway, Render, or Fly.io, NOT
on serverless platforms like Vercel. The FastAPI app serves the frontend
itself, so one service is enough:

1. Create the service from this repo (Dockerfile included)
2. Copy your environment variables (e.g. from Vercel project settings)
   and set DATABASE_URL to your Supabase connection string
3. Point your domain at the new service
