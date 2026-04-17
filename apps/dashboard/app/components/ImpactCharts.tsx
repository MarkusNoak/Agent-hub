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

// ------------------------------------------------------------
// Daily run volume — area chart
// ------------------------------------------------------------
export function DailyRunVolumeChart({
  data,
}: {
  data: Array<{ date: string; runs: number; cost: number }>;
}) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold">Runs & cost — last 14 days</h2>
          <p className="text-xs text-ink-500">Agent throughput and spend trending</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="runsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="runs"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#runsGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------
// Sales pipeline by offer_type — bar chart
// ------------------------------------------------------------
export function OfferMixChart({
  data,
}: {
  data: Array<{ offer_type: string; drafted: number; sent: number; replied: number }>;
}) {
  return (
    <div className="card p-6">
      <div className="mb-4">
        <h2 className="font-semibold">Sales pipeline by offer</h2>
        <p className="text-xs text-ink-500">
          Core services (webb / app / ai) vs. platform (agent_platform)
        </p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="offer_type" tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="drafted" stackId="a" fill="#cbd5e1" name="Drafted" />
          <Bar dataKey="sent" stackId="a" fill="#6366f1" name="Sent" />
          <Bar dataKey="replied" stackId="a" fill="#10b981" name="Replied" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------
// Agent activity share — pie chart
// ------------------------------------------------------------
const AGENT_COLORS: Record<string, string> = {
  invoice: "#3b82f6",
  finance_report: "#6366f1",
  sales: "#10b981",
  client_status: "#a855f7",
  dev_support: "#f97316",
  project: "#ec4899",
  marketing: "#eab308",
};

export function AgentActivityPie({
  data,
}: {
  data: Array<{ kind: string; runs: number }>;
}) {
  return (
    <div className="card p-6">
      <div className="mb-4">
        <h2 className="font-semibold">Who's working hardest?</h2>
        <p className="text-xs text-ink-500">Share of all runs last 30 days</p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="runs"
            nameKey="kind"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
          >
            {data.map((d) => (
              <Cell
                key={d.kind}
                fill={AGENT_COLORS[d.kind] ?? "#94a3b8"}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------
// Impact KPIs — big numbers with trend
// ------------------------------------------------------------
export function ImpactKpi({
  label,
  value,
  subtitle,
  trend,
  tone = "default",
}: {
  label: string;
  value: string;
  subtitle?: string;
  trend?: { value: string; positive: boolean };
  tone?: "default" | "green" | "indigo" | "amber";
}) {
  const toneBg =
    tone === "green" ? "bg-gradient-to-br from-green-50 to-emerald-50 border-green-100"
    : tone === "indigo" ? "bg-gradient-to-br from-indigo-50 to-blue-50 border-indigo-100"
    : tone === "amber" ? "bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-100"
    : "bg-white border-ink-100";

  return (
    <div className={`rounded-xl border p-5 ${toneBg}`}>
      <div className="text-xs font-medium text-ink-500 uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        {trend && (
          <div
            className={`text-xs font-medium ${
              trend.positive ? "text-green-700" : "text-red-700"
            }`}
          >
            {trend.positive ? "↑" : "↓"} {trend.value}
          </div>
        )}
      </div>
      {subtitle && (
        <div className="mt-1 text-xs text-ink-500">{subtitle}</div>
      )}
    </div>
  );
}
