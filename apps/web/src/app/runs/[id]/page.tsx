import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchApi, ApiError } from "@/lib/api";
import type { RunDetail, RunDetailEnrichmentPlayer } from "@/types/api";
import { formatDuration, formatNumber, formatDateTime, formatUpgrades } from "@/lib/format";
import { getClassColor, getClassName } from "@/lib/class-colors";
import { getSpecById } from "@mplus/wow-constants";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const { run } = await fetchApi<{ run: RunDetail }>(`/api/v1/runs/${id}`);
    const dungeonName = run.dungeonName ?? run.dungeon.name;
    const result = run.onTime
      ? `Timed +${run.upgrades}`
      : "Depleted";
    return {
      title: `${dungeonName} +${run.keystoneLevel} (${result})`,
      description: `Mythic+ run detail: ${dungeonName} key level ${run.keystoneLevel}.`,
    };
  } catch {
    return { title: "Run detail" };
  }
}

export default async function RunDetailPage({ params }: Props) {
  const { id } = await params;

  let run: RunDetail;
  try {
    const result = await fetchApi<{ run: RunDetail }>(`/api/v1/runs/${id}`);
    run = result.run;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const dungeonName = run.dungeonName ?? run.dungeon.name;
  const resultClass = run.onTime ? "text-green-400" : "text-red-400";

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {run.season.name} · {formatDateTime(run.recordedAt)}
        </p>
        <h1 className="text-3xl font-bold">
          {dungeonName} <span className="text-muted-foreground">+{run.keystoneLevel}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className={`font-semibold ${resultClass}`}>
            {formatUpgrades(run.upgrades, run.onTime)}
          </span>
          <span>Time: <span className="font-mono">{formatDuration(run.completionMs)}</span> / {formatDuration(run.parMs)}</span>
          <span>Deaths: {run.deaths}</span>
          <span>Juice: <span className="font-semibold">{formatNumber(run.personalJuice)}</span></span>
          {run.ratingGained != null && run.ratingGained !== 0 && (
            <span>
              Rating:{" "}
              <span className={run.ratingGained > 0 ? "text-green-400" : "text-red-400"}>
                {run.ratingGained > 0 ? "+" : ""}
                {run.ratingGained}
              </span>
            </span>
          )}
        </div>
        {run.affixes.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Affixes: [{run.affixes.join(", ")}]
          </p>
        )}
      </div>

      {/* Party members (from run submission) */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Party</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {run.members.map((m) => {
            const cls = m.character?.class ?? m.classSnapshot;
            const color = getClassColor(cls);
            return (
              <div
                key={m.id}
                className="rounded border border-border bg-card p-3"
                style={{ borderTopColor: color, borderTopWidth: 3 }}
              >
                <div className="text-sm font-semibold" style={{ color }}>
                  {m.character?.name ?? "Unknown"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {m.specSnapshot} {getClassName(cls)}
                </div>
                <div className="mt-1 text-xs capitalize text-muted-foreground">
                  {m.roleSnapshot}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Enrichment section — falls back if not available */}
      {run.enrichment && run.enrichment.status === "complete" ? (
        <>
          <EnrichmentOverview enrichment={run.enrichment} />
          <PlayersTable players={run.enrichment.players} runDurationMs={run.completionMs} />
          <EncountersTable encounters={run.enrichment.encounters} />
        </>
      ) : (
        <EnrichmentMissing
          reason={run.enrichment?.statusReason ?? "no_attempt"}
          hasAttempt={run.enrichment !== null}
        />
      )}
    </main>
  );
}

function EnrichmentOverview({ enrichment }: { enrichment: NonNullable<RunDetail["enrichment"]> }) {
  const stats = [
    { label: "Damage", value: formatNumber(Number(enrichment.totalDamage)) },
    {
      label: "Support Damage",
      value: formatNumber(Number(enrichment.totalDamageSupport)),
      hide: Number(enrichment.totalDamageSupport) === 0,
    },
    { label: "Healing", value: formatNumber(Number(enrichment.totalHealing)) },
    {
      label: "Support Healing",
      value: formatNumber(Number(enrichment.totalHealingSupport)),
      hide: Number(enrichment.totalHealingSupport) === 0,
    },
    { label: "Interrupts", value: String(enrichment.totalInterrupts) },
    { label: "Dispels", value: String(enrichment.totalDispels) },
    { label: "Party Deaths", value: String(enrichment.partyDeaths) },
  ].filter((s) => !s.hide);

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Combat Stats</h2>
      <p className="text-xs text-muted-foreground">
        Enriched from your local WoWCombatLog.txt · parser v{enrichment.parserVersion}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map((s) => (
          <div key={s.label} className="rounded border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="mt-1 font-mono font-semibold">{s.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlayersTable({
  players,
  runDurationMs,
}: {
  players: RunDetailEnrichmentPlayer[];
  runDurationMs: number;
}) {
  const durationSec = Math.max(1, runDurationMs / 1000);
  const sorted = [...players].sort(
    (a, b) => Number(b.damageDone) - Number(a.damageDone),
  );

  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold">Per-player</h3>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Player</th>
              <th className="px-3 py-2 font-medium">Spec</th>
              <th className="px-3 py-2 text-right font-medium">Damage</th>
              <th className="px-3 py-2 text-right font-medium">DPS</th>
              <th className="px-3 py-2 text-right font-medium">Healing</th>
              <th className="px-3 py-2 text-right font-medium">HPS</th>
              <th className="px-3 py-2 text-right font-medium">Intr</th>
              <th className="px-3 py-2 text-right font-medium">Disp</th>
              <th className="px-3 py-2 text-right font-medium">Deaths</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const damage = Number(p.damageDone);
              const healing = Number(p.healingDone);
              const spec = p.specId ? getSpecById(p.specId) : undefined;
              const colorHex = spec
                ? `#${spec.classColor.toString(16).padStart(6, "0").toUpperCase()}`
                : undefined;
              const shortName = p.playerName.split("-")[0];

              return (
                <tr key={p.id} className="border-b border-border/50">
                  <td className="px-3 py-2">
                    <span
                      className="font-medium"
                      style={colorHex ? { color: colorHex } : undefined}
                    >
                      {shortName}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {spec
                      ? `${spec.name} ${spec.className}`
                      : p.specId != null
                        ? `spec ${p.specId}`
                        : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatNumber(damage)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {formatNumber(Math.round(damage / durationSec))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatNumber(healing)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {formatNumber(Math.round(healing / durationSec))}
                  </td>
                  <td className="px-3 py-2 text-right">{p.interrupts}</td>
                  <td className="px-3 py-2 text-right">{p.dispels}</td>
                  <td className="px-3 py-2 text-right">{p.deaths}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EncountersTable({
  encounters,
}: {
  encounters: RunDetail["enrichment"] extends null ? never : NonNullable<RunDetail["enrichment"]>["encounters"];
}) {
  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold">Boss fights</h3>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Boss</th>
              <th className="px-3 py-2 font-medium">Outcome</th>
              <th className="px-3 py-2 text-right font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {encounters.map((e) => (
              <tr key={e.id} className="border-b border-border/50">
                <td className="px-3 py-2 text-muted-foreground">{e.sequenceIndex + 1}</td>
                <td className="px-3 py-2">{e.encounterName}</td>
                <td className="px-3 py-2">
                  <span className={e.success ? "text-green-400" : "text-red-400"}>
                    {e.success ? "Kill" : "Wipe"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatDuration(e.fightTimeMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EnrichmentMissing({ reason, hasAttempt }: { reason: string; hasAttempt: boolean }) {
  const friendly =
    {
      log_not_found: "No WoWCombatLog.txt found when the run was submitted.",
      log_path_unresolvable: "The companion app didn't have a WoW install path configured.",
      parse_failed: "The combat log parser couldn't process the log file.",
      no_matching_segment: "The combat log had no CHALLENGE_MODE segment for this run.",
      segment_mismatch: "The combat log's segment didn't match this run's dungeon or time.",
      acl_disabled: "Advanced Combat Logging was disabled in-game during this run.",
      no_attempt: "This run was submitted before combat-log enrichment was available.",
    }[reason] ?? `Enrichment unavailable: ${reason}`;

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Combat Stats</h2>
      <div className="mt-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
        <p className="text-sm">Detailed combat stats are not available for this run.</p>
        <p className="mt-1 text-xs text-muted-foreground">{friendly}</p>
        {!hasAttempt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Future runs will include per-player damage, healing, interrupts, and
            dispels when the companion app is running with Advanced Combat
            Logging enabled. Type <code>/mkt acl</code> in-game to check.
          </p>
        )}
      </div>
    </section>
  );
}
