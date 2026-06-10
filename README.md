# Agent Hub

A multi-tenant SaaS platform that gives every customer an AI workforce:
13 specialist agents behind a retro pixel-art interface, with real
lead-generation tooling, a built-in lead pipeline (CRM), subscription plans,
usage metering, and a public API.

## The agents

| Agent | Specialty | Plan | Tools |
|---|---|---|---|
| NEXUS | Central coordinator & orchestrator | Free | |
| ORACLE | Research & knowledge | Free | |
| SCROLL | Writing & content | Free | |
| FORGE | Code & engineering | Starter | |
| LENS | Data & analytics | Starter | |
| HERALD | Planning & strategy | Starter | |
| PULSE | Marketing & growth | Starter | |
| HAVEN | Customer support & success | Starter | |
| **VANTAGE** | **Sales & lead generation** | Pro | company search, people search, enrichment, lead pipeline |
| SHIELD | Security & compliance | Pro | |
| LEDGER | Finance & business operations | Pro | |
| TALENT | HR & recruiting | Pro | |
| COUNSEL | Legal & contracts | Pro | |

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

SQLite keeps deployment trivial; the schema is plain SQL and ports to
Postgres when a single customer outgrows it.
