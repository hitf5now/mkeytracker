"use client";

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
import type { TimelineBossMarker } from "./damage-timeline-chart";

interface Props {
  bucketSizeMs: number;
  runDurationSec: number;
  tankShortName: string;
  tankColorHex: string;
  /** Damage directed per bucket (post-armor, pre-shield/block/resist). */
  damageIncomingBuckets: number[];
  /** Damage actually received per bucket. */
  damageTakenBuckets: number[];
  /** Self-heals per bucket. */
  selfHealingBuckets: number[];
  bosses: TimelineBossMarker[];
}

const INCOMING_COLOR = "#f97316"; // orange — raw-ish damage pressure
const TAKEN_COLOR = "#ef4444"; // red — what actually hit
const SELF_HEAL_COLOR = "#22c55e"; // green — the mitigator itself

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

export function TankingTimelineChart({
  bucketSizeMs,
  runDurationSec,
  tankShortName,
  tankColorHex: _tankColorHex,
  damageIncomingBuckets,
  damageTakenBuckets,
  selfHealingBuckets,
  bosses,
}: Props) {
  const bucketSec = bucketSizeMs / 1000;
  const numBuckets = Math.max(
    damageIncomingBuckets.length,
    damageTakenBuckets.length,
    selfHealingBuckets.length,
    1,
  );

  // Three lines, all rates (per-second) for comparability.
  const data = Array.from({ length: numBuckets }, (_, i) => ({
    timeSec: i * bucketSec,
    incoming: Math.round((damageIncomingBuckets[i] ?? 0) / bucketSec),
    taken: Math.round((damageTakenBuckets[i] ?? 0) / bucketSec),
    selfHealing: Math.round((selfHealingBuckets[i] ?? 0) / bucketSec),
  }));

  return (
    <div className="h-96 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 36, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#2a2d34" strokeDasharray="3 3" />
          <XAxis
            dataKey="timeSec"
            type="number"
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
            label={{
              value: "per sec",
              angle: -90,
              position: "insideLeft",
              fill: "#888",
              fontSize: 11,
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1a1d23",
              border: "1px solid #333",
              borderRadius: "6px",
              color: "#e5e5e5",
              fontSize: 12,
            }}
            labelFormatter={(v) => `${tankShortName} — ${formatMmSs(Number(v))}`}
            formatter={(value, name) => [
              `${formatShortNumber(Number(value))} / s`,
              String(name),
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={(value) => (
              <span style={{ color: "#e5e5e5" }}>{String(value)}</span>
            )}
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
          <Line
            type="monotone"
            dataKey="incoming"
            name="Damage Incoming"
            stroke={INCOMING_COLOR}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="taken"
            name="Damage Taken"
            stroke={TAKEN_COLOR}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="selfHealing"
            name="Self-Healing"
            stroke={SELF_HEAL_COLOR}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
