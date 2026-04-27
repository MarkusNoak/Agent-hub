"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #ede7dc",
  fontSize: 12,
  boxShadow: "0 4px 16px -4px rgb(0 0 0 / 0.1)",
};

// ── Daily run volume — area chart ──────────────────────────────
export function DailyRunVolumeChart({
  data,
}: {
  data: Array<{ date: string; runs: number; cost: number }>;
}) {
  return (
    <div className="card p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="font-semibold text-ink-900">Körningar · 14 dagar</h2>
          <p className="text-xs text-ink-400 mt-0.5">Agentaktivitet och kostnadsutfall</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-ink-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-brand" />
            Körningar
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="runsGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#e8a020" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#e8a020" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe3" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#a09080" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#a09080" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: number) => [v, "Körningar"]}
          />
          <Area
            type="monotone"
            dataKey="runs"
            stroke="#e8a020"
            strokeWidth={2.5}
            fill="url(#runsGrad)"
            dot={false}
            activeDot={{ r: 4, fill: "#e8a020", strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Sales pipeline by offer — stacked bar ──────────────────────
const OFFER_LABELS: Record<string, string> = {
  webb_design:     "Webb",
  app_development: "App",
  ai_automation:   "AI",
  agent_platform:  "Platform",
};

export function OfferMixChart({
  data,
}: {
  data: Array<{ offer_type: string; drafted: number; sent: number; replied: number }>;
}) {
  const mapped = data.map((d) => ({
    ...d,
    offer_type: OFFER_LABELS[d.offer_type] ?? d.offer_type,
  }));

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="font-semibold text-ink-900">Pipeline per erbjudande</h2>
        <p className="text-xs text-ink-400 mt-0.5">Webb · App · AI · Platform</p>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={mapped} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe3" vertical={false} />
          <XAxis
            dataKey="offer_type"
            tick={{ fontSize: 11, fill: "#a09080" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#a09080" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
          />
          <Legend
            iconSize={8}
            iconType="circle"
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          />
          <Bar dataKey="drafted" stackId="a" fill="#d9cfc2" name="Utkast" radius={[0,0,0,0]} />
          <Bar dataKey="sent"    stackId="a" fill="#e8a020" name="Skickad" radius={[0,0,0,0]} />
          <Bar dataKey="replied" stackId="a" fill="#10b981" name="Svarade" radius={[3,3,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Agent activity share — donut chart ─────────────────────────
const AGENT_COLORS: Record<string, string> = {
  sales:          "#e8a020",
  invoice:        "#3b82f6",
  finance_report: "#8b5cf6",
  client_status:  "#10b981",
  dev_support:    "#f97316",
  project:        "#ec4899",
  marketing:      "#06b6d4",
};

const AGENT_LABELS: Record<string, string> = {
  sales: "Sälj",
  invoice: "Faktura",
  finance_report: "Finans",
  client_status: "Status",
  dev_support: "Dev",
  project: "Projekt",
  marketing: "Marknad",
};

export function AgentActivityPie({
  data,
}: {
  data: Array<{ kind: string; runs: number }>;
}) {
  const mapped = data.map((d) => ({ ...d, label: AGENT_LABELS[d.kind] ?? d.kind }));

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="font-semibold text-ink-900">Agentaktivitet</h2>
        <p className="text-xs text-ink-400 mt-0.5">Körningsandel · 30 dagar</p>
      </div>
      {data.length === 0 ? (
        <div className="h-[240px] flex items-center justify-center text-ink-400 text-sm">
          Inga körningar ännu
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={mapped}
              dataKey="runs"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={95}
              paddingAngle={3}
              strokeWidth={0}
            >
              {mapped.map((d) => (
                <Cell key={d.kind} fill={AGENT_COLORS[d.kind] ?? "#a09080"} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [v, name]} />
            <Legend
              iconSize={8}
              iconType="circle"
              wrapperStyle={{ fontSize: 11 }}
              formatter={(v: string) => <span style={{ color: "#7a6f62" }}>{v}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Legacy ImpactKpi (kept for backwards compat) ───────────────
export function ImpactKpi({
  label, value, subtitle, tone = "default",
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: "default" | "green" | "indigo" | "amber";
}) {
  return (
    <div className="card p-5">
      <div className="section-label mb-2">{label}</div>
      <div className="stat-value">{value}</div>
      {subtitle && <div className="stat-sub">{subtitle}</div>}
    </div>
  );
}
