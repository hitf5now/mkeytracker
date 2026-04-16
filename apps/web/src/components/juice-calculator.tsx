"use client";

import { useState } from "react";

interface Props {
  eventType: string;
}

function calcBase(level: number, timed: boolean): number {
  return timed ? level * 100 : 0;
}

export function JuiceCalculator({ eventType }: Props) {
  const [level, setLevel] = useState(15);
  const [timed, setTimed] = useState(true);
  const [deaths, setDeaths] = useState(0);
  const [minLevel, setMinLevel] = useState(10);

  const base = calcBase(level, timed);
  const deathBonus = deaths === 0 ? 150 : 0;
  const participation = 100;

  const results: { label: string; value: number }[] = [];

  if (eventType === "key_climbing") {
    const progression = timed ? (level - minLevel) * 50 : 0;
    results.push(
      { label: "Formula A (Peak Only)", value: base + progression + deathBonus + participation },
      { label: "Formula B (+ Climb Path)", value: base + progression + deathBonus + participation + 3 * 25 },
      { label: "Formula C (Weighted Top 3)", value: Math.round(base * 0.6 + (base > 100 ? (base - 100) * 0.3 : 0) + (base > 200 ? (base - 200) * 0.1 : 0)) + deathBonus + participation },
    );
  } else if (eventType === "marathon") {
    const streak2 = 200;
    const variety = 200;
    results.push(
      { label: "Formula A (Sum + Streak)", value: base + streak2 + variety + deathBonus + participation },
      { label: "Formula B (Diminishing)", value: Math.round((base + streak2 + variety + deathBonus) * 0.95) + participation },
      { label: "Formula C (Best 10 + Streak)", value: base + deathBonus + participation },
    );
  } else if (eventType === "best_average") {
    const consistency = timed ? 300 : 0;
    results.push(
      { label: "Formula A (Straight Avg)", value: base + consistency + participation },
      { label: "Formula B (Trimmed Mean)", value: Math.round(base * 0.95) + participation },
      { label: "Formula C (Weighted)", value: Math.round(base * 0.5 + base * 0.3 + base * 0.2) + consistency + participation },
    );
  } else if (eventType === "bracket_tournament") {
    const winBonus = 500;
    const margin = 100;
    results.push(
      { label: "Formula A (Win: Per-Match)", value: base + winBonus + margin + deathBonus },
      { label: "Formula A (Loss)", value: base + deathBonus },
      { label: "Formula B (Win: Best-of-3)", value: base * 3 + 250 * 2 + winBonus },
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground">Key Level</label>
          <input
            type="range"
            min={2}
            max={30}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            className="mt-1 w-full"
          />
          <p className="text-center text-sm font-bold text-foreground">+{level}</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground">Result</label>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => setTimed(true)}
              className={`flex-1 rounded px-2 py-1 text-xs font-medium ${timed ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"}`}
            >
              Timed
            </button>
            <button
              type="button"
              onClick={() => setTimed(false)}
              className={`flex-1 rounded px-2 py-1 text-xs font-medium ${!timed ? "bg-red-500/20 text-red-400" : "bg-muted text-muted-foreground"}`}
            >
              Depleted
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground">Deaths</label>
          <input
            type="number"
            min={0}
            max={50}
            value={deaths}
            onChange={(e) => setDeaths(Number(e.target.value))}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>

        {eventType === "key_climbing" && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground">Event Min Level</label>
            <input
              type="number"
              min={2}
              max={25}
              value={minLevel}
              onChange={(e) => setMinLevel(Number(e.target.value))}
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
        )}
      </div>

      <div className="mt-6 space-y-2">
        {results.map((r) => (
          <div key={r.label} className="flex items-center justify-between rounded bg-muted/30 px-3 py-2">
            <span className="text-sm text-muted-foreground">{r.label}</span>
            <span className="font-mono text-sm font-bold text-foreground">
              {r.value.toLocaleString()} Juice
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
