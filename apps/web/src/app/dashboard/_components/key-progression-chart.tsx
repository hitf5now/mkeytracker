"use client";

import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CLASSES } from "@mplus/wow-constants";

interface DataPoint {
  date: string;
  level: number;
  characterName: string;
  characterClass: string;
}

interface Props {
  data: DataPoint[];
}

function getColor(classSlug: string): string {
  const cls = CLASSES[classSlug];
  if (!cls) return "#FFFFFF";
  return `#${cls.color.toString(16).padStart(6, "0")}`;
}

export function KeyProgressionChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No run data for chart.</p>;
  }

  // Convert dates to numeric for scatter plot
  const chartData = data.map((d, i) => ({
    x: i,
    y: d.level,
    date: d.date,
    characterName: d.characterName,
    characterClass: d.characterClass,
  }));

  // Show ~8 tick labels evenly spaced
  const step = Math.max(1, Math.floor(chartData.length / 8));
  const ticks = chartData.filter((_, i) => i % step === 0).map((d) => d.x);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
          <XAxis
            dataKey="x"
            type="number"
            domain={["dataMin", "dataMax"]}
            ticks={ticks}
            tickFormatter={(idx: number) => {
              const point = chartData[idx];
              return point ? point.date.slice(5) : "";
            }}
            tick={{ fill: "#888", fontSize: 11 }}
            axisLine={{ stroke: "#333" }}
            tickLine={false}
          />
          <YAxis
            dataKey="y"
            type="number"
            tick={{ fill: "#888", fontSize: 11 }}
            axisLine={{ stroke: "#333" }}
            tickLine={false}
            label={{ value: "Key Level", angle: -90, position: "insideLeft", fill: "#888", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1a1d23",
              border: "1px solid #333",
              borderRadius: "6px",
              color: "#e5e5e5",
              fontSize: 12,
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(_value: unknown, _name: unknown, props: any) => {
              const p = props?.payload as { y: number; characterName: string; date: string } | undefined;
              if (!p) return [];
              return [`+${p.y} — ${p.characterName} (${p.date})`, "Key"];
            }}
          />
          <Scatter data={chartData} fill="#FFD100">
            {chartData.map((entry, i) => (
              <Cell key={i} fill={getColor(entry.characterClass)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
