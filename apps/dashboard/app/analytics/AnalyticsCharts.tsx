"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const COLORS = [
  "#e8a020",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#84cc16",
];

export function AnalyticsCharts({
  funnelData,
  offerData,
  signalData,
  scoreData,
  avgScoreData,
}: {
  funnelData: { stage: string; count: number }[];
  offerData: { offer: string; count: number }[];
  signalData: { signal: string; count: number }[];
  scoreData: { score: string; count: number }[];
  avgScoreData: { offer: string; avg: number }[];
}) {
  return (
    <div className="space-y-4">
      {/* Funnel */}
      <div className="card p-5">
        <h2 className="font-semibold mb-4">Lead-pipeline funnel</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={funnelData}
            margin={{ top: 4, right: 8, left: 0, bottom: 40 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#ede7dc" />
            <XAxis
              dataKey="stage"
              tick={{ fontSize: 10 }}
              angle={-35}
              textAnchor="end"
            />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: "1px solid #ede7dc" }}
            />
            <Bar dataKey="count" name="Leads" radius={[4, 4, 0, 0]}>
              {funnelData.map((_, i) => (
                <Cell
                  key={i}
                  fill={
                    _.stage === "won"
                      ? "#10b981"
                      : _.stage === "lost"
                      ? "#ef4444"
                      : COLORS[i % (COLORS.length - 2)]
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Offer mix pie */}
        <div className="card p-5">
          <h2 className="font-semibold mb-4">Erbjudandefördelning</h2>
          {offerData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-ink-400 text-sm">
              Inga data ännu
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={offerData}
                  dataKey="count"
                  nameKey="offer"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ offer, percent }: { offer: string; percent: number }) =>
                    `${offer} ${(percent * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {offerData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #ede7dc",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Signal types pie */}
        <div className="card p-5">
          <h2 className="font-semibold mb-4">Signaltyper</h2>
          {signalData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-ink-400 text-sm">
              Inga data ännu
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={signalData}
                  dataKey="count"
                  nameKey="signal"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                >
                  {signalData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #ede7dc",
                  }}
                  formatter={(v: number, name: string) => [v, name]}
                />
                <Legend
                  iconSize={10}
                  formatter={(value: string) => (
                    <span style={{ fontSize: 11 }}>{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Score distribution */}
        <div className="card p-5">
          <h2 className="font-semibold mb-4">Score-fördelning</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={scoreData}
              margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#ede7dc" />
              <XAxis dataKey="score" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #ede7dc",
                }}
                formatter={(v: number) => [v, "Leads"]}
              />
              <Bar dataKey="count" name="Leads" fill="#e8a020" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Avg score per offer */}
        <div className="card p-5">
          <h2 className="font-semibold mb-4">Snittbetyg per erbjudande</h2>
          {avgScoreData.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-ink-400 text-sm">
              Inga scorade leads ännu
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={avgScoreData}
                margin={{ top: 4, right: 8, left: 0, bottom: 24 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#ede7dc" />
                <XAxis
                  dataKey="offer"
                  tick={{ fontSize: 10 }}
                  angle={-20}
                  textAnchor="end"
                />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 10]} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #ede7dc",
                  }}
                  formatter={(v: number) => [v.toFixed(1), "Snittbetyg"]}
                />
                <Bar
                  dataKey="avg"
                  name="Snittbetyg"
                  radius={[4, 4, 0, 0]}
                >
                  {avgScoreData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
