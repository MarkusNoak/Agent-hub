"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";

const COLORS = [
  "#e8a020",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
];

export function BillingCharts({
  dailyData,
  agentStats,
}: {
  dailyData: { date: string; cost: number }[];
  agentStats: { kind: string; name: string; costUsd: number }[];
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card p-5">
        <h2 className="font-semibold mb-4">Daglig kostnad (14 dagar)</h2>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={dailyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#e8a020" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#e8a020" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ede7dc" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => `$${v.toFixed(3)}`}
            />
            <Tooltip
              formatter={(v: number) => [`$${v.toFixed(4)}`, "Kostnad"]}
              contentStyle={{ borderRadius: 12, border: "1px solid #ede7dc" }}
            />
            <Area
              type="monotone"
              dataKey="cost"
              stroke="#e8a020"
              strokeWidth={2}
              fill="url(#costGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold mb-4">Kostnad per agent (denna månad)</h2>
        {agentStats.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-ink-400 text-sm">
            Inga data ännu
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={agentStats}
              margin={{ top: 4, right: 8, left: 0, bottom: 24 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#ede7dc" />
              <XAxis
                dataKey="kind"
                tick={{ fontSize: 10 }}
                angle={-30}
                textAnchor="end"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => `$${v.toFixed(3)}`}
              />
              <Tooltip
                formatter={(v: number) => [`$${v.toFixed(4)}`, "Kostnad"]}
                contentStyle={{ borderRadius: 12, border: "1px solid #ede7dc" }}
              />
              <Bar dataKey="costUsd" radius={[4, 4, 0, 0]}>
                {agentStats.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
