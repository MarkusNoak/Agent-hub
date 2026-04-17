/**
 * seed-demo.ts — Fill a Supabase project with realistic-looking data
 * for an external demo. Populates:
 *   - 14 days of agent_runs across all 7 agents (succeeded / failed / running)
 *   - 24 leads across all 4 offer_types with varied stages
 *   - 8 pending approvals (invoice reminders + outreach + LinkedIn)
 *   - a few sample events + audit_log rows
 *
 * Requires a tenant to exist (e.g. we-know-it from 0002).
 *
 * Usage:
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  TENANT_SLUG=we-know-it \
 *     tsx scripts/seed-demo.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env["SUPABASE_URL"];
const SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const TENANT_SLUG = process.env["TENANT_SLUG"] ?? "we-know-it";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function choice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

async function main() {
  // 1. Resolve tenant
  const { data: tenant } = await supa
    .from("tenants")
    .select("id, name")
    .eq("slug", TENANT_SLUG)
    .single();
  if (!tenant) throw new Error(`tenant ${TENANT_SLUG} not found`);
  console.log(`Seeding demo data for tenant: ${tenant.name} (${tenant.id})`);

  // 2. Resolve agent ids
  const { data: agents } = await supa
    .from("agents")
    .select("id, kind, name")
    .eq("tenant_id", tenant.id);
  if (!agents?.length) throw new Error("no agents seeded for tenant");
  const byKind = Object.fromEntries(agents.map((a) => [a.kind, a]));

  // 3. Seed leads across all 4 offer_types
  const companies = [
    ["Nordic Retail AB", "nordicretail.se", "webb_design", "researched"],
    ["Stockholm Fintech", "sthlm-fintech.io", "app_development", "outreach_sent"],
    ["Göteborg Industri", "gbg-industri.se", "ai_automation", "replied"],
    ["Bravura Consulting", "bravura.se", "agent_platform", "outreach_drafted"],
    ["Norrland Energi", "norrland-energi.se", "ai_automation", "outreach_sent"],
    ["Agency North", "agency-north.se", "agent_platform", "outreach_sent"],
    ["Skåne Logistik", "skanelog.com", "webb_design", "outreach_sent"],
    ["Devshift AB", "devshift.io", "app_development", "qualified"],
    ["Konsulthuset KB", "konsulthuset.se", "agent_platform", "replied"],
    ["Bolagsplatsen SaaS", "bolagsplatsen.io", "agent_platform", "outreach_drafted"],
    ["Growth Studio", "growth-studio.se", "agent_platform", "won"],
    ["Mäklargruppen", "maklargruppen.se", "webb_design", "outreach_drafted"],
    ["TechNord AB", "technord.se", "app_development", "researched"],
    ["Helsingborg Data", "hbg-data.se", "ai_automation", "outreach_drafted"],
    ["PR Byrån North", "prbyran-north.se", "agent_platform", "researched"],
    ["Lovable Agency", "lovable-agency.se", "agent_platform", "outreach_sent"],
    ["Retail Insights", "retail-insights.io", "ai_automation", "replied"],
    ["Uppsala Code", "uppsalacode.se", "app_development", "outreach_drafted"],
    ["E-handel Direkt", "ehandel-direkt.se", "webb_design", "outreach_sent"],
    ["Nordic Legal", "nordic-legal.se", "ai_automation", "researched"],
    ["Scale-Up SE", "scaleup.se", "agent_platform", "qualified"],
    ["Malmö Studios", "malmostudios.se", "webb_design", "replied"],
    ["Venture Collective", "venturecollective.se", "agent_platform", "outreach_sent"],
    ["Byggstart AB", "byggstart.se", "webb_design", "lost"],
  ] as const;

  await supa.from("leads").delete().eq("tenant_id", tenant.id);
  await supa.from("leads").insert(
    companies.map(([name, domain, offer_type, stage]) => ({
      tenant_id: tenant.id,
      company_name: name,
      company_domain: domain,
      offer_type,
      stage,
      signal_type: choice(["funding", "hiring", "growth", "manual"]),
      signal_summary: choice([
        "Recently raised Series A — scaling eng team",
        "Hiring 5+ developers per LinkedIn",
        "Announced new product line last week",
        "Manual invoice chasing visible in job ad",
        "CEO mentioned repetitive ops in podcast",
      ]),
      score: Math.floor(rand(55, 95)),
      metadata: {
        detected_pains: choice([
          ["outdated website", "slow load"],
          ["manual invoicing", "spreadsheet hell"],
          ["founder-led outreach", "no CRM"],
          ["PM chasing timesheets", "variance invisible"],
        ]),
      },
    })),
  );
  console.log(`  ✓ ${companies.length} leads`);

  // 4. Seed 14 days of agent_runs
  const now = new Date();
  const runs: Record<string, unknown>[] = [];
  for (let day = 13; day >= 0; day--) {
    const d = new Date(now);
    d.setDate(d.getDate() - day);

    // Every agent runs 1-3 times per day (with some skipped)
    for (const a of agents) {
      const runsToday = Math.random() < 0.8 ? Math.floor(rand(1, 4)) : 0;
      for (let i = 0; i < runsToday; i++) {
        const started = new Date(d);
        started.setHours(Math.floor(rand(7, 20)), Math.floor(rand(0, 59)));
        const duration = rand(4, 45);
        const finished = new Date(started.getTime() + duration * 1000);
        const failed = Math.random() < 0.05;
        const iterations = Math.floor(rand(3, 18));
        const tokensIn = Math.floor(rand(1500, 9000));
        const tokensOut = Math.floor(rand(400, 2500));
        // Sonnet pricing: $3/M in, $15/M out
        const cost = (tokensIn * 3) / 1_000_000 + (tokensOut * 15) / 1_000_000;

        runs.push({
          tenant_id: tenant.id,
          agent_id: a.id,
          status: failed ? "failed" : "succeeded",
          trigger: choice(["cron", "manual", "webhook"]),
          iterations,
          tokens_input: tokensIn,
          tokens_output: tokensOut,
          cost_usd: Number(cost.toFixed(4)),
          started_at: started.toISOString(),
          finished_at: finished.toISOString(),
          error: failed ? "Tool timeout after 30s" : null,
          output: failed
            ? null
            : demoOutputFor(a.kind as string),
        });
      }
    }
  }
  // One currently running
  runs.push({
    tenant_id: tenant.id,
    agent_id: byKind["sales"]!.id,
    status: "running",
    trigger: "cron",
    iterations: 4,
    tokens_input: 3200,
    tokens_output: 0,
    cost_usd: 0.01,
    started_at: new Date(Date.now() - 12_000).toISOString(),
    finished_at: null,
    output: null,
  });

  await supa
    .from("agent_runs")
    .delete()
    .eq("tenant_id", tenant.id);
  // Supabase insert limit → chunk
  for (let i = 0; i < runs.length; i += 500) {
    await supa.from("agent_runs").insert(runs.slice(i, i + 500));
  }
  console.log(`  ✓ ${runs.length} agent_runs`);

  // 5. Pending approvals
  await supa
    .from("approval_queue")
    .delete()
    .eq("tenant_id", tenant.id);
  const approvals = [
    {
      agent_kind: "invoice",
      action: "send_invoice_reminder",
      title: "Reminder → Nordic Retail AB (faktura #2847, 12 dagar sen)",
      summary: "Vänlig påminnelse, ton: friendly",
      payload: { invoice_id: "2847", level: "friendly" },
    },
    {
      agent_kind: "invoice",
      action: "send_invoice_reminder",
      title: "Reminder → Skåne Logistik (faktura #2812, 21 dagar sen)",
      summary: "Bestämd påminnelse, ton: firm",
      payload: { invoice_id: "2812", level: "firm" },
    },
    {
      agent_kind: "sales",
      action: "send_email",
      title: "Outreach [agent_platform] → ceo@bravura.se",
      summary: "Meta-pitch outreach — agent_platform",
      payload: {
        to_email: "ceo@bravura.se",
        subject: "Ett AI-team för din byrå — 3 månaders ROI",
        body: "Hej Jonas,\n\nSåg att ni växt från 12 till 28 konsulter på 18 månader...\n\nPS — detta mejl skrevs av vår Sales Agent på Agent Hub. Jag godkände det innan det gick ut. Det är produkten jag vill visa dig på 20 min.\n\n// Markus",
        offer_type: "agent_platform",
        meta_pitch: true,
      },
    },
    {
      agent_kind: "sales",
      action: "send_email",
      title: "Outreach [ai_automation] → cto@nordic-legal.se",
      summary: "AI-audit pitch, ton: crisp",
      payload: {
        to_email: "cto@nordic-legal.se",
        subject: "30-min AI audit av er dokumenthantering",
        offer_type: "ai_automation",
      },
    },
    {
      agent_kind: "marketing",
      action: "post_linkedin",
      title: "LinkedIn-inlägg: \"Hur vi byggde en AI-agent som säljer sig själv\"",
      summary: "Månadens thought leadership-post",
      payload: {
        platform: "linkedin",
        body: "Vi lät vår AI skriva ett kallt mejl. Den la in en PS-rad: 'förresten, detta mejl skrevs av mig, en AI-agent'. Svarsfrekvensen gick från 4% till 19%...",
      },
    },
    {
      agent_kind: "client_status",
      action: "notify_slack",
      title: "Client risk: Stockholm Fintech (ingen kontakt 12 dagar)",
      summary: "Föreslagen åtgärd: proaktiv check-in från PM",
      payload: { client: "Stockholm Fintech", risk_level: "yellow" },
    },
    {
      agent_kind: "sales",
      action: "send_email",
      title: "Outreach [agent_platform] → founder@agency-north.se",
      summary: "Meta-pitch outreach — agent_platform",
      payload: {
        to_email: "founder@agency-north.se",
        offer_type: "agent_platform",
        meta_pitch: true,
      },
    },
    {
      agent_kind: "sales",
      action: "send_email",
      title: "Outreach [webb_design] → marketing@maklargruppen.se",
      summary: "UX-audit pitch",
      payload: {
        to_email: "marketing@maklargruppen.se",
        offer_type: "webb_design",
      },
    },
  ];

  await supa.from("approval_queue").insert(
    approvals.map((a) => ({
      tenant_id: tenant.id,
      agent_id: byKind[a.agent_kind]?.id,
      run_id: runs.find((r) => r["agent_id"] === byKind[a.agent_kind]?.id)?.[
        "id"
      ] as string | undefined,
      action: a.action,
      status: "pending",
      title: a.title,
      summary: a.summary,
      payload: a.payload,
      expires_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    })),
  );
  console.log(`  ✓ ${approvals.length} pending approvals`);

  console.log("\nDone. Open /approvals and / to see the demo.");
}

function demoOutputFor(kind: string) {
  switch (kind) {
    case "invoice":
      return {
        summary: `Drafted ${Math.floor(rand(2, 6))} invoice reminders`,
        reminders: Array.from({ length: Math.floor(rand(2, 6)) }, () => ({})),
      };
    case "sales":
      return {
        summary: `Processed ${Math.floor(rand(3, 8))} signals, queued ${Math.floor(rand(2, 5))} drafts`,
        drafts_queued: Array.from({ length: Math.floor(rand(2, 5)) }, () => ({})),
      };
    case "client_status":
      return { summary: "Reviewed 12 clients, flagged 2 as yellow risk" };
    case "finance_report":
      return { summary: "Weekly P&L generated, MRR trending +4.2%" };
    case "project":
      return { summary: "Scanned 8 projects, flagged 1 variance alert" };
    case "dev_support":
      return { summary: "Diagnosed 1 Trello blocker with fix suggestion" };
    case "marketing":
      return { summary: "Drafted 1 LinkedIn post, queued for approval" };
    default:
      return { summary: "Completed" };
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
