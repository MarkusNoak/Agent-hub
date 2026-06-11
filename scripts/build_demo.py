"""Build a self-contained, clickable demo of the Agent Hub UI.

Bundles the real frontend (HTML/CSS/JS) with canned demo data and shims for
fetch/WebSocket, so the product can be demonstrated from a single HTML file
with no backend. Run from backend/:  python3 ../scripts/build_demo.py OUT
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
os.chdir(os.path.join(os.path.dirname(__file__), "..", "backend"))

from agents import AGENTS
from plans import PLANS

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/agent-hub-demo.html"

agents = [{**a.to_dict(), "available": True} for a in AGENTS.values()]
plans = [{"id": p.id, "name": p.name, "price_monthly_eur": p.price_monthly_eur,
          "messages_per_month": p.messages_per_month,
          "leads_per_month": p.leads_per_month, "seats": p.seats,
          "features": p.features} for p in PLANS.values()]

css = open("../frontend/style.css").read()
appjs = open("../frontend/app.js").read()
html = open("../frontend/index.html").read()
html = html.replace('<link rel="stylesheet" href="/static/style.css" />', "")
html = html.replace('<script src="/static/app.js"></script>', "")
body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
head = re.search(r"<head>(.*)</head>", html, re.S).group(1)

LEADS = [
  {"id":"L1","company_name":"Visby Health Systems AB","domain":"visbyhealth-demo.se","org_number":"556601-1111",
   "industry":"healthcare technology","company_size":"60","location":"Göteborg",
   "contact_name":"Sara Lindqvist","contact_title":"CEO","contact_email":"sara.lindqvist@visbyhealth-demo.se",
   "contact_linkedin":None,"source":"signal:hiring","score":95,
   "score_reason":"Signalscore: rekryterar aktivt (4 annonser, +20); söker exakt de roller vi levererar (+10); annonserna nämner vår tech (React, AWS, +8); anlitar redan konsulter enligt annonstext (+7); långvarigt behov (38 dagars annonsspann, +5); verifierat orgnr (+5); i vår målregion (+10)",
   "status":"meeting","notes":"Aktiva annonser: Frontendutvecklare React; Fullstackutvecklare | Tech i annonserna: React, TypeScript, AWS",
   "outreach_draft":"Hej Sara,\n\nsåg att ni söker er fjärde utvecklare på fyra månader — att skala teamet i den takten är tufft.\n\nVi är We Know IT och hjälper bolag som ert att leverera medan ni rekryterar: senior React/AWS-kapacitet från dag ett.\n\nHar du 20 minuter nästa vecka? Boka direkt: {{booking_url}}\n\nVänliga hälsningar","created_at":"2026-06-09 08:30","updated_at":"2026-06-10"},
  {"id":"L2","company_name":"Fjord Analytics AS","domain":"fjordanalytics-demo.no","org_number":None,
   "industry":"software","company_size":"45","location":"Oslo, Norway",
   "contact_name":"Henrik Dahl","contact_title":"CTO","contact_email":"henrik.dahl@fjordanalytics-demo.no",
   "contact_linkedin":None,"source":"apollo","score":78,
   "score_reason":"ICP-fit 32/40 (software, rätt storlek); beslutsfattare CTO 28/30; verifierad e-postdomän 12/15; nyhet om expansion 6/15",
   "status":"contacted","notes":"Svarade 'intressant, återkom i juli' — uppföljning schemalagd",
   "outreach_draft":"Hej Henrik, ...","created_at":"2026-06-08 14:12","updated_at":"2026-06-10"},
  {"id":"L3","company_name":"Køge Logistik ApS","domain":"koegelogistik-demo.dk","org_number":"22756214",
   "industry":"logistics","company_size":"85","location":"Copenhagen",
   "contact_name":"Mads Eriksen","contact_title":"Managing Director","contact_email":"mads.eriksen@koegelogistik-demo.dk",
   "contact_linkedin":None,"source":"signal:hiring","score":71,
   "score_reason":"Signalscore: rekryterar aktivt (2 annonser, +10); verifierat orgnr (+5); sajt utan mobilanpassning — mognadsscore 35/100 (+pitch)",
   "status":"qualified","notes":"Digital mognadsgrad 35/100: ingen mobilanpassning, copyright 2021, ingen analytics — stark renoveringspitch",
   "outreach_draft":None,"created_at":"2026-06-10 06:02","updated_at":"2026-06-10"},
  {"id":"L4","company_name":"Nordkraft Energi AB","domain":"nordkraftenergi-demo.se","org_number":"556789-0123",
   "industry":"renewable energy","company_size":"120","location":"Stockholm",
   "contact_name":"Elin Bergström","contact_title":"VP of Operations","contact_email":"elin.bergstrom@nordkraftenergi-demo.se",
   "contact_linkedin":None,"source":"signal:newco","score":88,
   "score_reason":"DUBBEL SIGNAL: rekryterar OCH nyligen omstrukturerat bolag (+15); tar in 40 MSEK enligt DI (timing +15)",
   "status":"won","notes":"Projektstart 1 juli — webbplattform fas 1","outreach_draft":None,
   "created_at":"2026-05-28 09:00","updated_at":"2026-06-09"},
  {"id":"L5","company_name":"Baltik Components Oy","domain":"baltikcomponents-demo.fi","org_number":"0112038-9",
   "industry":"manufacturing","company_size":"310","location":"Tampere",
   "contact_name":"Aino Korhonen","contact_title":"Head of Procurement","contact_email":None,
   "contact_linkedin":None,"source":"apollo","score":44,
   "score_reason":"ICP-fit ok men ingen verifierad kontaktväg (0/15 reachability)","status":"lost",
   "notes":"Valde intern rekrytering","outreach_draft":None,"created_at":"2026-05-20 11:00","updated_at":"2026-06-02"},
]

LEAD_DETAIL = {**LEADS[0],
  "activities":[
    {"kind":"created","content":"Skördad från rekryteringssignal (scheduled körning)","created_at":"2026-06-09 08:30"},
    {"kind":"sequence_started","content":"2 steg schemalagda till sara.lindqvist@visbyhealth-demo.se. Relevansgrund (GDPR): VD på bolag som aktivt rekryterar React-utvecklare — direkt relevant för våra utvecklingstjänster.","created_at":"2026-06-09 08:45"},
    {"kind":"email_simulated","content":"Steg 1: \"Er rekrytering av React-utvecklare\"","created_at":"2026-06-09 08:50"},
    {"kind":"reply_received","content":"Svar klassat som 'meeting'. 1 kvarvarande steg stoppade.","created_at":"2026-06-10 07:15"}],
  "sequence":[
    {"step":1,"subject":"Er rekrytering av React-utvecklare","send_at":"2026-06-09T06:30","status":"simulated","sent_at":"2026-06-09T06:35"},
    {"step":2,"subject":"Konkret förslag: så avlastar vi ert team","send_at":"2026-06-12T06:30","status":"cancelled","sent_at":None}]}

RUNS = [
  {"id":"R1","trigger":"scheduled","signals_found":25,"leads_created":6,"duplicates_skipped":11,
   "created_at":"2026-06-09 06:00",
   "digest":"PROSPEKTERINGSKÖRNING — 2026-06-09 06:00 UTC\nICP: Webb & app Sverige\n\nSignaler funna: 25  |  Nya leads: 6  |  Dubbletter skippade: 11\n\nKONTAKTA FÖRST:\n1. Visby Health Systems AB (score 95) — 4 aktiva annonser i Göteborg\n2. Nordkraft Energi AB (score 88) — DUBBEL SIGNAL: rekryterar + finansiering\n3. Køge Logistik ApS (score 71) — 2 aktiva annonser, svag digital närvaro\n\nOBS: Lärd tröskel aktiv: skördar inte under score 45 (förlorade affärer snittar 44).\n\nNästa steg: be VANTAGE djup-enricha topp 3 och ta fram outreach."},
  {"id":"R2","trigger":"manual","signals_found":18,"leads_created":4,"duplicates_skipped":3,
   "created_at":"2026-06-02 09:14",
   "digest":"PROSPEKTERINGSKÖRNING — 2026-06-02 09:14 UTC\nICP: Webb & app Sverige\n\nSignaler funna: 18  |  Nya leads: 4  |  Dubbletter skippade: 3"}]

INSIGHTS = {
  "total_leads":17,"funnel":{"new":4,"qualified":3,"contacted":4,"meeting":2,"won":2,"lost":2},
  "meetings_booked":4,
  "by_source":[{"segment":"signal:hiring","won":2,"lost":0,"open":6,"win_rate":1.0,"sample":2},
               {"segment":"apollo","won":0,"lost":2,"open":4,"win_rate":0.0,"sample":2},
               {"segment":"signal:newco","won":0,"lost":0,"open":3,"win_rate":None,"sample":0}],
  "by_industry":[],"by_score_band":[],
  "score_calibration":{"avg_score_won":91.5,"avg_score_lost":44.0,"outcomes":4},
  "outreach":{"emails_sent":14,"replies":3,"reply_rate":0.21,"unsubscribes":0,
              "by_hook":[{"hook":"hiring","sequences":8,"replied":3,"reply_rate":0.38},
                         {"hook":"maturity","sequences":4,"replied":0,"reply_rate":0.0}]},
  "recommendations":[
    "Bästa leadkälla: 'signal:hiring' med 100% win-rate (2 utfall) — prioritera den signalen.",
    "Scoringen fungerar: vunna affärer snittar 92 poäng mot 44 för förlorade. Lita på prioriteringsordningen.",
    "Bästa öppningsvinkel: 'hiring' med 38% svarsfrekvens (8 sekvenser) — använd den vinkeln som standard.",
    "Svarsfrekvens 21% på 14 mejl — över B2B-snittet. Skala upp volymen inom dagsgränsen."]}

ORG = {"id":"demo","name":"We Know IT (DEMO)","plan":{"id":"pro","name":"Pro","price_monthly_eur":199,
       "messages_per_month":10000,"leads_per_month":1000,"seats":25,
       "features":plans[2]["features"]},
       "usage":{"month":"2026-06","messages":142,"input_tokens":480211,"output_tokens":96400,"leads":17,
                "by_agent":[{"agent_id":"vantage","messages":61},{"agent_id":"forge","messages":34},
                            {"agent_id":"nexus","messages":21},{"agent_id":"scroll","messages":14}]},
       "members":[{"id":"u1","email":"markus@weknowit.se","name":"Markus","role":"owner","created_at":"2026-06-01"},
                  {"id":"u2","email":"konsult@weknowit.se","name":"Konsult Ett","role":"member","created_at":"2026-06-03"}]}

USAGE = {**ORG["usage"], "limits":{"messages":10000,"leads":1000}}

ICPS = [{"id":"I1","org_id":"demo","name":"Webb & app Sverige","what_we_sell":"webbutveckling och apputveckling i React och Node",
         "target_roles":["frontendutvecklare","systemutvecklare","apputvecklare"],"regions":["Stockholm","Göteborg"],
         "include_new_companies":True,"include_funding":True,"include_tenders":True,"include_expansion":True,"include_leadership":True,"auto_run":True,"min_score":0,"created_at":"2026-06-01"}]

KNOWLEDGE = {"kinds":["case","standard","offering","process","other"],
  "entries":[{"id":"K1","kind":"case","title":"E-handel för Acme AB","content":"Next.js + Stripe, +40% konvertering på 3 månader.","created_at":"2026-06-05"},
             {"id":"K2","kind":"standard","title":"Husstack webb","content":"Next.js + TypeScript + Postgres.","created_at":"2026-06-05"}]}

KEYS = [{"id":"key1","name":"produktion","prefix":"ahub_x7Kp9q","created_at":"2026-06-04","last_used_at":"2026-06-10"}]

SETTINGS = {"booking_url":"https://calendly.com/weknowit/intro","daily_send_limit":20,"require_approval":True,
            "business_profile":"We Know IT är ett utvecklingskonsultbolag som bygger webbplatser, webbappar och mobilappar för SMB i Sverige."}

INTEGRATIONS = {"connectors":[
  {"id":"anthropic","name":"Claude (Anthropic)","category":"Core","connected":True,"available":True,
   "detail":"Powers every agent."},
  {"id":"smtp","name":"Email sending (SMTP)","category":"Outreach","connected":False,"available":True,
   "detail":"Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM. Until then all sends are simulated (dry-run)."},
  {"id":"imap","name":"Reply inbox (IMAP)","category":"Outreach","connected":False,"available":True,
   "detail":"Set IMAP_HOST, IMAP_USER, IMAP_PASS to auto-classify replies and stop sequences on answer."},
  {"id":"apollo","name":"Apollo.io","category":"Data","connected":False,"available":True,
   "detail":"Set APOLLO_API_KEY for live decision-maker contacts. Without it, contact search returns demo data."},
  {"id":"jobtech","name":"Platsbanken (JobTech)","category":"Data","connected":True,"available":True,
   "detail":"Swedish job ads — hiring signal. Free public API, no key needed."},
  {"id":"registry","name":"Company registries (SE/NO/DK/FI + VIES)","category":"Data","connected":True,"available":True,
   "detail":"Official company data, newco signal. Free public sources, no key needed."},
  {"id":"ted","name":"TED public tenders","category":"Data","connected":True,"available":True,
   "detail":"EU procurement — tender signal. Works without a key; TED_API_KEY optional."},
  {"id":"companies_house","name":"Companies House (UK)","category":"Data","connected":False,"available":True,
   "detail":"Set COMPANIES_HOUSE_API_KEY (free) for UK company lookups."},
  {"id":"fortnox","name":"Fortnox","category":"Finance","connected":False,"available":False,"detail":"Coming soon."},
  {"id":"visma","name":"Visma eEkonomi","category":"Finance","connected":False,"available":False,"detail":"Coming soon."},
  {"id":"slack","name":"Slack","category":"Notifications","connected":False,"available":False,"detail":"Coming soon."},
  {"id":"trello","name":"Trello","category":"Project","connected":False,"available":False,"detail":"Coming soon."},
  {"id":"linkedin","name":"LinkedIn","category":"Outreach","connected":False,"available":False,"detail":"Coming soon."},
]}

CONVERSATIONS = [
  {"session_id":"demo-s1","snippet":"Hitta 10 bolag i Stockholm som rekryterar utvecklare","last_at":"2026-06-09 14:22","messages":6},
  {"session_id":"demo-s2","snippet":"Skriv outreach till Visby Health","last_at":"2026-06-08 09:10","messages":4},
]

APPROVALS = {"count":2,"items":[
  {"id":1,"lead_id":"L1","step":1,"subject":"Er rekrytering av React-utvecklare",
   "body":"Hej Sara,\n\nsåg att ni söker er fjärde utvecklare på fyra månader — att skala teamet i den takten är tufft.\n\nVi är We Know IT och hjälper bolag som ert att leverera medan ni rekryterar: senior React/AWS-kapacitet från dag ett.\n\nHar du 20 minuter nästa vecka?",
   "send_at":"2026-06-11T06:30","hook_type":"hiring","company_name":"Visby Health Systems AB",
   "contact_name":"Sara Lindqvist","contact_email":"sara.lindqvist@visbyhealth-demo.se","score":95},
  {"id":2,"lead_id":"L3","step":1,"subject":"Er webbplats tappar kunder på mobilen",
   "body":"Hej Mads,\n\nvi gjorde en snabb teknisk genomgång av er sajt: den saknar mobilanpassning och analytics — i logistikbranschen sker över hälften av bokningarna mobilt.\n\nVi bygger om sajter som er på 4–6 veckor. Intresserad av en kort genomgång av vad vi hittade?",
   "send_at":"2026-06-11T06:30","hook_type":"maturity","company_name":"Køge Logistik ApS",
   "contact_name":"Mads Eriksen","contact_email":"mads.eriksen@koegelogistik-demo.dk","score":71},
]}

CHAT_TEXT = """Jag körde en snabb signal-skörd mot er ICP. Här är läget:

## Nya prospekt (signal: rekrytering)

| Bolag | Score | Signal |
|---|---|---|
| **Visby Health Systems AB** | 95 | 4 annonser, React/AWS i texten, anlitar redan konsulter |
| **Nordkraft Energi AB** | 88 | DUBBEL SIGNAL: rekryterar + ny finansiering |
| **Køge Logistik ApS** | 71 | 2 annonser, digital mognadsgrad 35/100 → renoveringspitch |

Alla tre är sparade i pipelinen med outreach-utkast. **Visby Health** är hetast — VD:n Sara Lindqvist är rätt mottagare och deras annonsspann på 38 dagar tyder på att rekryteringen misslyckas.

**Nästa steg:** Ska jag starta en mejlsekvens mot Sara med hiring-vinkeln? (Den har 38% svarsfrekvens hos er.)"""

shim = """
<div id="demo-loader" style="position:fixed;inset:0;z-index:99998;background:#0a0a0f;color:#d0d0e0;font-family:monospace;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;line-height:2">
  <div>LOADING DEMO...<br><br>
  <span style="color:#44445a;font-size:12px">Om denna text inte försvinner kör din visare inte JavaScript.<br>
  Ladda ner filen och öppna den i Chrome, Edge eller Safari.</span></div>
</div>
<script>
// ════ DEMO SHIM — canned data, no backend ════
window.onerror = function(msg, src, line){
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#330011;color:#ff3366;font:12px monospace;padding:8px;';
  el.textContent = 'DEMO ERROR: ' + msg + ' (line ' + line + ')';
  document.body.appendChild(el);
};
try { localStorage.setItem('ahub_token', 'demo-token'); } catch(e) {}
document.getElementById('demo-loader').remove();
const DEMO = {
  me: {user:{id:'u1',email:'markus@weknowit.se',name:'Markus',role:'owner'},
       organization:{id:'demo',name:'We Know IT (DEMO)',plan:'pro'}},
  agents: %AGENTS%,
  leads: %LEADS%,
  leadDetail: %LEAD_DETAIL%,
  runs: %RUNS%,
  insights: %INSIGHTS%,
  org: %ORG%,
  usage: %USAGE%,
  icps: %ICPS%,
  knowledge: %KNOWLEDGE%,
  keys: %KEYS%,
  settings: %SETTINGS%,
  plans: %PLANS%,
  approvals: %APPROVALS%,
  conversations: %CONVERSATIONS%,
  integrations: %INTEGRATIONS%,
};
const json = d => new Response(JSON.stringify(d), {status:200, headers:{'Content-Type':'application/json'}});
window.fetch = async (url, opts={}) => {
  const u = String(url);
  if (u.includes('/api/auth/me')) return json(DEMO.me);
  if (u.includes('/api/v1/agents')) return json(DEMO.agents);
  if (u.includes('/api/leads/export')) return new Response('company_name,score\\nVisby Health Systems AB,95', {status:200});
  if (u.match(/\\/api\\/leads\\/L\\d/) && (!opts.method || opts.method==='GET')) return json(DEMO.leadDetail);
  if (u.includes('/api/leads')) {
    if (opts.method && opts.method!=='GET') return json({ok:true});
    return json({leads: DEMO.leads, statuses:['new','qualified','contacted','meeting','won','lost']});
  }
  if (u.includes('/api/growth/icps') && opts.method==='POST') return json(DEMO.icps[0]);
  if (u.includes('/run')) return json({run_id:'RX',leads_created:3,duplicates_skipped:5,signals_found:14,digest:DEMO.runs[0].digest});
  if (u.includes('/api/growth/icps')) return json(DEMO.icps);
  if (u.includes('/api/growth/runs')) return json(DEMO.runs);
  if (u.includes('/api/growth/insights')) return json(DEMO.insights);
  if (u.includes('/api/integrations')) return json(DEMO.integrations);
  if (u.includes('/api/org/settings')) return json(DEMO.settings);
  if (u.includes('/api/org')) return json(DEMO.org);
  if (u.includes('/api/usage')) return json(DEMO.usage);
  if (u.includes('/api/billing/plans')) return json(DEMO.plans);
  if (u.includes('/api/billing/plan')) return json({ok:true});
  if (u.includes('/api/knowledge')) {
    if (opts.method && opts.method!=='GET') return json({ok:true});
    return json(DEMO.knowledge);
  }
  if (u.match(/\/api\/conversations\/[^/]+\/[^/]+$/)) return json({session_id:'x', messages:[{role:'user',content:'Hitta leads i Stockholm'},{role:'assistant',content:'Här är 5 bolag som rekryterar utvecklare just nu...'}]});
  if (u.includes('/api/conversations/')) return json(DEMO.conversations);
  if (u.includes('/find-contact')) return json({found:true, source:'demo', contact:{contact_name:'Sara Lindqvist'}, note:'DEMO DATA'});
  if (u.includes('/api/approvals')) {
    if (opts.method === 'POST') { DEMO.approvals = {count: Math.max(0, DEMO.approvals.count - 1), items: DEMO.approvals.items.slice(1)}; return json({ok:true, remaining: DEMO.approvals.count}); }
    return json(DEMO.approvals);
  }
  if (u.includes('/api/keys')) return json(DEMO.keys);
  return json({ok:true});
};
const CHAT_TEXT = %CHAT_TEXT%;
class FakeWS {
  static OPEN = 1;
  constructor(url){ this.readyState = 1;
    setTimeout(()=>{ this.onopen && this.onopen();
      this._emit({type:'session', session_id:'demo', agent:{name:'DEMO'}}); }, 80); }
  _emit(d){ this.onmessage && this.onmessage({data: JSON.stringify(d)}); }
  send(raw){
    const msg = JSON.parse(raw);
    if (msg.type === 'clear'){ this._emit({type:'cleared'}); return; }
    let t = 150;
    const step = (d, dt) => { setTimeout(()=>this._emit(d), t); t += dt; };
    step({type:'start'}, 400);
    step({type:'tool_start', name:'find_hiring_companies', input:{}}, 1300);
    step({type:'tool_end', name:'find_hiring_companies', ok:true}, 350);
    step({type:'tool_start', name:'lookup_company_registry', input:{}}, 1100);
    step({type:'tool_end', name:'lookup_company_registry', ok:true}, 350);
    step({type:'tool_start', name:'save_lead', input:{}}, 900);
    step({type:'tool_end', name:'save_lead', ok:true}, 400);
    const words = CHAT_TEXT.split(/(?<= )/);
    for (const w of words) step({type:'chunk', content:w}, 18);
    step({type:'end'}, 10);
  }
  close(){}
}
window.WebSocket = FakeWS;
</script>
<div style="position:fixed;bottom:8px;right:10px;z-index:9999;font-family:monospace;font-size:10px;color:#e8d44f;background:#111118;border:2px solid #e8d44f;padding:6px 10px;">STATIC DEMO — INGEN BACKEND, INBYGGD DEMODATA</div>
"""
for key, data in [("AGENTS",agents),("LEADS",LEADS),("LEAD_DETAIL",LEAD_DETAIL),("RUNS",RUNS),
                  ("INSIGHTS",INSIGHTS),("ORG",ORG),("USAGE",USAGE),("ICPS",ICPS),
                  ("KNOWLEDGE",KNOWLEDGE),("KEYS",KEYS),("SETTINGS",SETTINGS),("PLANS",plans),
                  ("APPROVALS",APPROVALS),("CONVERSATIONS",CONVERSATIONS),
                  ("INTEGRATIONS",INTEGRATIONS),
                  ("CHAT_TEXT",CHAT_TEXT)]:
    shim = shim.replace("%"+key+"%", json.dumps(data, ensure_ascii=False))

# CDN fallbacks must run synchronously BEFORE app.js top-level code
fallbacks = """<script>
if (!window.marked) window.marked = {setOptions(){}, parse: function(t){
  return '<p>' + String(t)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>')
    .replace(/^## (.*)$/gm,'<h3>$1</h3>')
    .replace(/\\n/g,'<br>') + '</p>'; }};
if (!window.DOMPurify) window.DOMPurify = {sanitize: function(t){ return t; }};
if (!window.hljs) window.hljs = {highlightElement: function(){}};
</script>"""

demo = f"""<!DOCTYPE html>
<html lang="sv">
<head>{head}
<style>{css}</style>
</head>
<body>
{shim}
{body}
{fallbacks}
<script>{appjs}</script>
</body>
</html>"""
open(OUT, "w").write(demo)
print("demo built:", OUT, len(demo)//1024, "KB")
