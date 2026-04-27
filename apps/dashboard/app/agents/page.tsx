import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { toggleAgent } from "./actions";
import { RunNowButton } from "./RunNowButton";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { AgentConfigPanel } from "./AgentConfigPanel";
import { PageHeader } from "@/app/components/PageHeader";
import {
  Target, FileText, TrendingUp, Bell, Code2, Layers, Megaphone, Bot,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type AgentMeta = {
  description: string;
  Icon: LucideIcon;
  gradient: string;
};

const AGENT_META: Record<string, AgentMeta> = {
  sales: {
    Icon: Target,
    gradient: "linear-gradient(145deg, #1a8a4a, #15703a)",
    description: "Hittar bolag med svag digital närvaro via Google CSE och skriver anpassade outreach-mejl för WKIT:s tjänster.",
  },
  invoice: {
    Icon: FileText,
    gradient: "linear-gradient(145deg, #e8960c, #c67808)",
    description: "Genererar och skickar fakturor automatiskt via Fortnox eller Visma Spiris.",
  },
  finance_report: {
    Icon: TrendingUp,
    gradient: "linear-gradient(145deg, #2563eb, #1d4ed8)",
    description: "Sammanställer månadsrapporter med intäkter, kostnader och kassaflöde.",
  },
  client_status: {
    Icon: Bell,
    gradient: "linear-gradient(145deg, #7c3aed, #6d28d9)",
    description: "Håller kunder uppdaterade om projektstatus via automatiserade mejl.",
  },
  dev_support: {
    Icon: Code2,
    gradient: "linear-gradient(145deg, #475569, #334155)",
    description: "Bevakar GitHub-issues, prioriterar buggar och skapar Trello-kort automatiskt.",
  },
  project: {
    Icon: Layers,
    gradient: "linear-gradient(145deg, #dc2626, #b91c1c)",
    description: "Följer upp projekttid i Clockify och varnar vid risk för överdrag.",
  },
  marketing: {
    Icon: Megaphone,
    gradient: "linear-gradient(145deg, #db2777, #be185d)",
    description: "Skapar LinkedIn-inlägg och marknadsmaterial baserat på projektresultat.",
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

  const runsByAgent = new Map<string, typeof runs>();
  for (const r of runs ?? []) {
    const key = r.agent_id as string;
    if (!runsByAgent.has(key)) runsByAgent.set(key, []);
    runsByAgent.get(key)!.push(r);
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const enabledCount = agents?.filter((a) => a.status === "enabled").length ?? 0;
  const totalCount = agents?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agenter"
        subtitle={`${enabledCount} av ${totalCount} agenter aktiva.`}
      />

      <div className="grid grid-cols-1 gap-4">
        {agents?.map((a) => {
          const meta = AGENT_META[a.kind] ?? {
            Icon: Bot,
            gradient: "linear-gradient(145deg, #374151, #1f2937)",
            description: "",
          };
          const { Icon, gradient, description } = meta;

          const agentRuns = runsByAgent.get(a.id) ?? [];
          const runsThisMonth = agentRuns.filter(
            (r) => r.started_at && new Date(r.started_at) >= monthStart,
          );
          const succeeded = agentRuns.filter((r) => r.status === "succeeded").length;
          const failed    = agentRuns.filter((r) => r.status === "failed").length;
          const total     = succeeded + failed;
          const successRate = total > 0 ? Math.round((succeeded / total) * 100) : null;
          const totalCostUsd = agentRuns.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
          const monthCost    = runsThisMonth.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

          return (
            <div key={a.id} className="card p-6">
              <div className="flex items-start gap-5">

                {/* Apple-style icon container */}
                <div
                  className="w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0"
                  style={{
                    background: gradient,
                    boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.2), 0 2px 10px rgb(0 0 0 / 0.18)",
                  }}
                >
                  <Icon size={20} strokeWidth={1.75} color="white" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-bold text-[16px] tracking-[-0.01em] text-ink-900">
                      {a.name}
                    </h3>
                    <span
                      className={`badge ${
                        a.status === "enabled" ? "badge-green"
                        : a.status === "paused"  ? "badge-yellow"
                        : "badge-gray"
                      }`}
                    >
                      {a.status === "enabled" ? "Aktiv" : a.status === "paused" ? "Pausad" : "Inaktiv"}
                    </span>
                  </div>
                  <p className="text-sm text-ink-400 mt-1 leading-relaxed max-w-xl">{description}</p>

                  {/* Stats row */}
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
                    {[
                      { label: "körn. / mån", value: runsThisMonth.length },
                      successRate !== null
                        ? { label: "lyckade", value: `${successRate}%`, colored: successRate >= 80 ? "text-emerald-600" : successRate >= 50 ? "text-amber-600" : "text-red-600" }
                        : null,
                      { label: "denna mån", value: `$${monthCost.toFixed(3)}` },
                      { label: "totalt", value: `$${totalCostUsd.toFixed(3)}` },
                      { label: "schema", value: humanCron(a.cron) },
                      {
                        label: "senast",
                        value: a.last_run_at
                          ? formatDistanceToNow(new Date(a.last_run_at), { addSuffix: true, locale: sv })
                          : "aldrig",
                      },
                    ]
                      .filter(Boolean)
                      .map((stat, i) => stat && (
                        <div key={i} className="text-xs text-ink-400">
                          <span className={`font-semibold tabular-nums ${stat.colored ?? "text-ink-700"}`}>
                            {stat.value}
                          </span>{" "}{stat.label}
                        </div>
                      ))}
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
                    <button formAction={toggleAgent} className="btn btn-secondary text-sm">
                      {a.status === "enabled" ? "Inaktivera" : "Aktivera"}
                    </button>
                  </form>
                  <RunNowButton agentKind={a.kind} />
                </div>
              </div>

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
