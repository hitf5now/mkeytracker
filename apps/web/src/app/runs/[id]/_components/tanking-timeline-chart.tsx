"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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

const TAKEN_COLOR = "#ef4444"; // red — what actually hit
const MITIGATED_COLOR = "#64748b"; // slate — what was absorbed/blocked/resisted
const SELF_HEAL_COLOR = "#22c55e"; // green — mitigator response

/** Aggregation window in multiples of the stored 5s bucket. 6 × 5s = 30s. */
const AGG_FACTOR = 6;

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

/**
 * Roll N consecutive raw buckets into one aggregated bucket by summing. The
 * result is shorter but represents the SAME total amount — per-second rates
 * stay numerically identical once divided by (factor × bucketSizeSec).
 */
function aggregate(buckets: number[], factor: number): number[] {
  if (factor <= 1) return buckets;
  const out: number[] = [];
  for (let i = 0; i < buckets.length; i += factor) {
    let sum = 0;
    for (let j = 0; j < factor && i + j < buckets.length; j++) {
      sum += buckets[i + j] ?? 0;
    }
    out.push(sum);
  }
  return out;
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
  const windowSec = bucketSec * AGG_FACTOR;

  const incoming = aggregate(damageIncomingBuckets, AGG_FACTOR);
  const taken = aggregate(damageTakenBuckets, AGG_FACTOR);
  const selfHeal = aggregate(selfHealingBuckets, AGG_FACTOR);
  const numBuckets = Math.max(incoming.length, taken.length, selfHeal.length, 1);

  const data = Array.from({ length: numBuckets }, (_, i) => {
    const incRaw = incoming[i] ?? 0;
    const takRaw = taken[i] ?? 0;
    const takenRate = Math.round(takRaw / windowSec);
    // Mitigation is the portion of incoming that did NOT hit HP.
    const mitigatedRaw = Math.max(0, incRaw - takRaw);
    const mitigatedRate = Math.round(mitigatedRaw / windowSec);
    const selfHealRate = Math.round((selfHeal[i] ?? 0) / windowSec);
    return {
      timeSec: i * windowSec,
      taken: takenRate,
      mitigated: mitigatedRate,
      selfHealing: selfHealRate,
    };
  });

  return (
    <div>
      <div className="h-96 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 36, right: 16, bottom: 8, left: 0 }}>
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

            {/* Stacked damage story: taken on bottom, mitigated stacked on top.
                Total height = incoming damage pressure at that moment. */}
            <Area
              type="monotone"
              dataKey="taken"
              name="Damage Taken"
              stackId="damage"
              stroke={TAKEN_COLOR}
              fill={TAKEN_COLOR}
              fillOpacity={0.55}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="mitigated"
              name="Mitigated"
              stackId="damage"
              stroke={MITIGATED_COLOR}
              fill={MITIGATED_COLOR}
              fillOpacity={0.35}
              isAnimationActive={false}
            />

            {/* Self-healing sits on top as a distinct line — it's the tank's
                response to the damage pressure below, not part of the damage. */}
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
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
