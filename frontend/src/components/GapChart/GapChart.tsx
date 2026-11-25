import { memo, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import type { TimingEntry } from "../../types";

interface LapSnapshot {
  lap: number;
  gaps: Record<number, number>; // driver_number -> gap in seconds
}

interface Props {
  timing: TimingEntry[];
  history: LapSnapshot[]; // built up over time
}

const COLORS = ["#e10600", "#00d2ff", "#ffd700", "#39b54a", "#c084fc", "#ff8c00", "#00ffcc", "#ff69b4", "#87ceeb", "#dda0dd"];

function parseGap(gap: unknown): number | null {
  if (gap == null) return null;
  if (typeof gap === "number") return gap;
  const s = String(gap);
  if (!s || s === "LAP" || s.startsWith("+L")) return null;
  const n = parseFloat(s.replace("+", "").replace("s", ""));
  return isNaN(n) ? null : n;
}

function GapChart({ timing, history }: Props) {
  const top10 = useMemo(() => timing.slice(0, 10), [timing]);

  const chartData = useMemo(() => {
    if (!history.length) {
      if (!timing.length) return [];
      const row: Record<string, number | string> = { lap: timing[0]?.lap_number ?? 0 };
      timing.forEach((t) => {
        const g = parseGap(t.gap_to_leader);
        if (g !== null) row[t.abbreviation] = g;
      });
      return [row];
    }
    return history.map((snap) => {
      const row: Record<string, number | string> = { lap: snap.lap };
      timing.forEach((t) => {
        const g = snap.gaps[t.driver_number];
        if (g !== undefined) row[t.abbreviation] = g;
      });
      return row;
    });
  }, [history, timing]);

  return (
    <div className="panel" style={{ height: "100%" }}>
      <div className="panel-header">
        <span className="panel-title">Gap al Leader</span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>Top 10</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: "8px 0" }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ left: -10, right: 16, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
            <XAxis dataKey="lap" tick={{ fontSize: 10, fill: "#555" }} label={{ value: "Giro", position: "insideBottomRight", offset: -4, fontSize: 10, fill: "#555" }} />
            <YAxis
              tick={{ fontSize: 10, fill: "#555" }}
              tickFormatter={(v) => `+${v}s`}
              width={42}
              reversed
            />
            <ReferenceLine y={0} stroke="#444" strokeDasharray="4 4" />
            <Tooltip
              contentStyle={{ background: "#1e1e1e", border: "1px solid #2a2a2a", borderRadius: 6, fontSize: 11 }}
              formatter={(v: number) => [`+${v.toFixed(3)}s`]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {top10.map((t, i) => (
              <Line
                key={t.driver_number}
                type="monotone"
                dataKey={t.abbreviation}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// memo: only re-renders when timing or history change
export default memo(GapChart);
