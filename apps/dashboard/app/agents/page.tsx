import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { toggleAgent } from "./actions";
import { RunNowButton } from "./RunNowButton";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { AgentConfigPanel } from "./AgentConfigPanel";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AGENT_META: Record<string, { description: string; icon: string }> = {
  sales: {
    icon: "🎯",
    description:
      "Hittar bolag med svag digital närvaro via Google CSE och skriver anpassade outreach-mejl för WKIT:s tjänster.",
  },
  invoice: {
    icon: "🧾",
    description:
      "Genererar och skickar fakturor automatiskt via Fortnox eller Visma Spiris.",
  },
  finance_report: {
    icon: "📊",
    description:
      "Sammanställer månadsrapporter med intäkter, kostnader och kassaflöde.",
  },
  client_status: {
    icon: "📬",
    description:
      "Håller kunder uppdaterade om projektstatus via automatiserade mejl.",
  },
  dev_support: {
    icon: "🛠",
    description:
      "Bevakar GitHub-issues, prioriterar buggar och skapar Trello-kort automatiskt.",
  },
  project: {
    icon: "📋",
    description:
      "Följer upp projekttid i Clockify och varnar vid risk för överdrag.",
  },
  marketing: {
    icon: "📣",
    description:
      "Skapar LinkedIn-inlägg och marknadsmaterial baserat på projektresultat.",
  },
};

function humanCron(cron: string | null): string {
  if (!cron) return "Händelsestyrd";
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;
  const [min = "*", hour = "*", dom, , dow] = parts;
  if (dom === "*" && dow === "*") {
    if (hour === "*") return `Varje timme, minut ${min}`;
    return `Dagligen kl. ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  if (dom === "*" && dow !== undefined && dow !== "*") {
    const days = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];
    const dayName = days[parseInt(dow)] ?? dow;
    return `Varje ${dayName} kl. ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return cron;
}

export default async function AgentsPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;

  const supa = createSupabaseServerClient();
  const [{ data: agents }, { data: runs }] = await Promise.all([
    supa
      .from("agents")
      .select("id, kind, name, status, cron, last_run_at, config, system_prompt")
      .eq("tenant_id", tenant.id)
      .order("kind"),
    supa
      .from("agent_runs")
      .select("agent_id, status, cost_usd, iterations, started_at, finished_at")
      .eq("tenant_id", tenant.id)
      .order("started_at", { ascending: false })
      .limit(500),
  ]);

  // Build per-agent stats
  const runsByAgent = new Map<string, typeof runs>();
  for (const r of runs ?? []) {
    const key = r.agent_id as string;
    if (!runsByAgent.has(key)) runsByAgent.set(key, []);
    runsByAgent.get(key)!.push(r);
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Agenter</h1>
        <p className="text-ink-500 mt-1">
          {agents?.filter((a) => a.status === "enabled").length ?? 0} av{" "}
          {agents?.length ?? 0} agenter aktiva.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4">
        {agents?.map((a) => {
          const meta = AGENT_META[a.kind] ?? { icon: "🤖", description: "" };
          const agentRuns = runsByAgent.get(a.id) ?? [];
          const runsThisMonth = agentRuns.filter(
            (r) => r.started_at && new Date(r.started_at) >= monthStart,
          );
          const succeeded = agentRuns.filter((r) => r.status === "succeeded").length;
          const failed = agentRuns.filter((r) => r.status === "failed").length;
          const total = succeeded + failed;
          const successRate = total > 0 ? Math.round((succeeded / total) * 100) : null;
          const totalCostUsd = agentRuns.reduce(
            (s, r) => s + Number(r.cost_usd ?? 0),
            0,
          );
          const monthCost = runsThisMonth.reduce(
            (s, r) => s + Number(r.cost_usd ?? 0),
            0,
          );

          return (
            <div key={a.id} className="card p-6">
              <div className="flex items-start gap-4">
                {/* Icon + info */}
                <div className="text-3xl select-none">{meta.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-semibold text-lg">{a.name}</h3>
                    <span
                      className={`badge ${
                        a.status === "enabled"
                          ? "badge-green"
                          : a.status === "paused"
                          ? "badge-yellow"
                          : "badge-gray"
                      }`}
                    >
                      {a.status === "enabled" ? "Aktiv" : a.status === "paused" ? "Pausad" : "Inaktiv"}
                    </span>
                  </div>
                  <p className="text-sm text-ink-500 mt-1">{meta.description}</p>

                  {/* Stats row */}
                  <div className="flex flex-wrap gap-4 mt-3 text-xs text-ink-500">
                    <div>
                      <span className="font-medium text-ink-700">{runsThisMonth.length}</span> körningar i mån
                    </div>
                    {successRate !== null && (
                      <div>
                        <span
                          className={`font-medium ${successRate >= 80 ? "text-green-700" : successRate >= 50 ? "text-yellow-700" : "text-red-700"}`}
                        >
                          {successRate}%
                        </span>{" "}
                        lyckade
                      </div>
                    )}
                    <div>
                      <span className="font-medium text-ink-700">${monthCost.toFixed(3)}</span> denna mån
                    </div>
                    <div>
                      <span className="font-medium text-ink-700">${totalCostUsd.toFixed(3)}</span> totalt
                    </div>
                    <div>
                      Schema: <span className="font-medium text-ink-700">{humanCron(a.cron)}</span>
                    </div>
                    <div>
                      Senast:{" "}
                      <span className="font-medium text-ink-700">
                        {a.last_run_at
                          ? formatDistanceToNow(new Date(a.last_run_at), { addSuffix: true, locale: sv })
                          : "aldrig"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 items-end shrink-0">
                  <form>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <input
                      type="hidden"
                      name="newStatus"
                      value={a.status === "enabled" ? "disabled" : "enabled"}
                    />
                    <button formAction={toggleAgent} className="btn btn-secondary">
                      {a.status === "enabled" ? "Inaktivera" : "Aktivera"}
                    </button>
                  </form>
                  <RunNowButton agentKind={a.kind} />
                </div>
              </div>

              {/* Expandable config panel */}
              <AgentConfigPanel
                agentId={a.id}
                tenantId={tenant.id}
                agentKind={a.kind}
                currentCron={a.cron ?? ""}
                currentSystemPrompt={(a.system_prompt as string) ?? ""}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
