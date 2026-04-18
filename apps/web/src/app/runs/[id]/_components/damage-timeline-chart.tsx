"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TimelinePlayer {
  shortName: string;
  colorHex: string;
  buckets: number[];
}

export interface TimelineBossMarker {
  name: string;
  offsetSec: number;
  success: boolean;
}

interface Props {
  bucketSizeMs: number;
  runDurationSec: number;
  players: TimelinePlayer[];
  bosses: TimelineBossMarker[];
}


function formatMmSs(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatShortNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toString();
}

export function DamageTimelineChart({
  bucketSizeMs,
  runDurationSec,
  players,
  bosses,
}: Props) {
  const bucketSec = bucketSizeMs / 1000;
  const numBuckets = Math.max(...players.map((p) => p.buckets.length), 1);

  // Hidden lines are suppressed via `hide` on the <Line>. Click a legend
  // entry to toggle visibility — users can isolate their own line quickly.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggle = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // Pivot into recharts row format: one row per bucket, keyed by player name.
  const data = Array.from({ length: numBuckets }, (_, i) => {
    const row: Record<string, number> = { timeSec: i * bucketSec };
    for (const p of players) {
      // DPS = damage in bucket / bucket width in seconds.
      const dmg = p.buckets[i] ?? 0;
      row[p.shortName] = Math.round(dmg / bucketSec);
    }
    return row;
  });

  return (
    <div className="h-96 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {/* Top margin leaves room for boss-name labels above the plot area */}
        <LineChart data={data} margin={{ top: 36, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#2a2d34" strokeDasharray="3 3" />
          <XAxis
            dataKey="timeSec"
            type="number"
            // Pad a few seconds past run end so the final boss kill
            // marker and last bucket aren't clipped at the right edge.
            domain={[0, runDurationSec + 10]}
            tick={{ fill: "#888", fontSize: 11 }}
            axisLine={{ stroke: "#333" }}
            tickLine={false}
            tickFormatter={formatMmSs}
            label={{ value: "Time", position: "insideBottom", offset: -4, fill: "#888", fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: "#888", fontSize: 11 }}
            axisLine={{ stroke: "#333" }}
            tickLine={false}
            tickFormatter={formatShortNumber}
            label={{ value: "DPS", angle: -90, position: "insideLeft", fill: "#888", fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1a1d23",
              border: "1px solid #333",
              borderRadius: "6px",
              color: "#e5e5e5",
              fontSize: 12,
            }}
            labelFormatter={(v) => `Time ${formatMmSs(Number(v))}`}
            formatter={(value, name) => [
              `${formatShortNumber(Number(value))} DPS`,
              String(name),
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8, cursor: "pointer" }}
            onClick={(entry) => {
              const raw =
                typeof entry.dataKey === "string"
                  ? entry.dataKey
                  : typeof entry.dataKey === "number"
                    ? String(entry.dataKey)
                    : typeof entry.value === "string"
                      ? entry.value
                      : undefined;
              if (raw) toggle(raw);
            }}
            formatter={(value) => {
              const name = String(value);
              return (
                <span
                  style={{
                    color: hidden.has(name) ? "#555" : "#e5e5e5",
                    textDecoration: hidden.has(name) ? "line-through" : "none",
                  }}
                >
                  {name}
                </span>
              );
            }}
          />
          {bosses.map((b) => (
            <ReferenceLine
              key={`${b.name}-${b.offsetSec}`}
              x={b.offsetSec}
              stroke={b.success ? "#FFD100" : "#ef4444"}
              strokeDasharray="4 2"
              label={{
                value: b.name,
                position: "top",
                fill: b.success ? "#FFD100" : "#ef4444",
                fontSize: 10,
              }}
            />
          ))}
          {players.map((p) => (
            <Line
              key={p.shortName}
              type="monotone"
              dataKey={p.shortName}
              stroke={p.colorHex}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              hide={hidden.has(p.shortName)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
