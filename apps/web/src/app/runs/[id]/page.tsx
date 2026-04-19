import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchApi, ApiError } from "@/lib/api";
import type { RunDetail, RunDetailEnrichmentPlayer, RunDetailMember, RunJuiceBreakdown } from "@/types/api";
import { formatDuration, formatNumber, formatDateTime, formatUpgrades } from "@/lib/format";
import { getClassColor, getClassName } from "@/lib/class-colors";
import { getSpecById } from "@mplus/wow-constants";
import {
  DamageTimelineChart,
  type TimelineBossMarker,
  type TimelinePlayer,
} from "./_components/damage-timeline-chart";
import { AchievementList } from "./_components/achievement-badges";
import { EndorsementsBox } from "./_components/endorsements-box";
import { evaluateRun, achievementsForMember } from "@/lib/achievements";
import { auth } from "@/lib/auth";

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
  const achievements = evaluateRun(run);

  const session = await auth();
  const currentUserId = (session?.userId as number | undefined) ?? null;
  const currentUserDiscordId =
    (session?.discordId as string | undefined) ?? null;

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
            <span title="Mythic+ rating change for the submitting player only">
              Your Rating:{" "}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Party</h2>
          {achievements.party.length > 0 && (
            <AchievementList
              awarded={achievements.party}
              stepMs={90}
            />
          )}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {sortPartyForDisplay(run).map((m) => {
            const cls = m.character?.class ?? m.classSnapshot;
            const color = getClassColor(cls);
            const memberAchievements = achievementsForMember(
              run,
              m,
              achievements,
            );
            const name = m.character?.name ?? "Unknown";
            const roleLabel = formatRoleLabel(m.roleSnapshot);
            return (
              <div
                key={m.id}
                className="flex flex-col rounded border border-border bg-card p-3"
                style={{ borderTopColor: color, borderTopWidth: 3 }}
              >
                {/* Section 1: Role + identity */}
                <SectionHeader>{roleLabel}</SectionHeader>
                <div className="mt-1.5 flex items-start gap-2.5">
                  <PlayerAvatar
                    name={name}
                    classSlug={cls}
                    avatarUrl={m.character?.avatarUrl ?? null}
                    thumbnailUrl={m.character?.thumbnailUrl ?? null}
                    insetUrl={m.character?.insetUrl ?? null}
                    color={color}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-sm font-semibold leading-tight"
                      style={{ color }}
                    >
                      {name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {m.specSnapshot} {getClassName(cls)}
                    </div>
                  </div>
                </div>

                {/* Divider + Section 2: Juice earned */}
                <div className="mt-3 border-t border-border/60 pt-3">
                  <SectionHeader>Juice Earned</SectionHeader>
                  <JuiceBreakdown
                    breakdown={run.juiceBreakdown}
                    personalJuice={run.personalJuice}
                  />
                </div>

                {/* Divider + Section 3: Run achievements */}
                <div className="mt-3 border-t border-border/60 pt-3">
                  <SectionHeader>Run Achievements</SectionHeader>
                  {memberAchievements.length > 0 ? (
                    <AchievementList
                      awarded={memberAchievements}
                      baseDelayMs={120}
                      direction="col"
                      className="mt-1.5"
                    />
                  ) : (
                    <div className="mt-1.5 text-[11px] italic text-muted-foreground">
                      Nothing earned this run.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Endorsements — below the party cards, above enrichment */}
      <EndorsementsBox
        run={run}
        currentUserId={currentUserId}
        currentUserDiscordId={currentUserDiscordId}
      />

      {/* Enrichment section — falls back if not available */}
      {run.enrichment && run.enrichment.status === "complete" ? (
        <>
          <EnrichmentOverview enrichment={run.enrichment} />
          <PlayersTable
            players={run.enrichment.players}
            runDurationMs={run.completionMs}
            bucketSizeMs={run.enrichment.bucketSizeMs}
          />
          <TimelineSection
            enrichment={run.enrichment}
            runDurationMs={run.completionMs}
          />
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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </div>
  );
}

function formatRoleLabel(role: string): string {
  const r = role.toLowerCase();
  if (r === "tank") return "Tank";
  if (r === "healer") return "Healer";
  if (r === "dps") return "DPS";
  return role;
}

/**
 * Display ordering for the party grid: Tank, Healer, then DPS sorted by
 * damageDone (descending) from enrichment. Falls back to submission order
 * for any member whose enrichment row can't be matched.
 */
function sortPartyForDisplay(run: RunDetail): RunDetailMember[] {
  const damageByCharId = new Map<number, number>();
  const damageByName = new Map<string, number>();
  if (run.enrichment && run.enrichment.status === "complete") {
    for (const p of run.enrichment.players) {
      const dmg = Number(p.damageDone);
      if (p.characterId != null) damageByCharId.set(p.characterId, dmg);
      const bare = p.playerName.split("-")[0]?.toLowerCase();
      if (bare) damageByName.set(bare, dmg);
    }
  }

  const damageFor = (m: RunDetailMember): number => {
    if (m.character?.id != null) {
      const byId = damageByCharId.get(m.character.id);
      if (byId != null) return byId;
    }
    const bare = m.character?.name.toLowerCase();
    if (bare && damageByName.has(bare)) return damageByName.get(bare) ?? 0;
    return 0;
  };

  const bucket = (m: RunDetailMember): number => {
    const r = m.roleSnapshot.toLowerCase();
    if (r === "tank") return 0;
    if (r === "healer") return 1;
    if (r === "dps") return 2;
    return 3;
  };

  return [...run.members].sort((a, b) => {
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;
    // Within DPS bucket: higher damage first.
    if (ba === 2) return damageFor(b) - damageFor(a);
    return 0;
  });
}

function PlayerAvatar({
  name,
  classSlug,
  avatarUrl,
  thumbnailUrl,
  insetUrl,
  color,
}: {
  name: string;
  classSlug: string;
  avatarUrl: string | null;
  thumbnailUrl: string | null;
  insetUrl: string | null;
  color: string;
}) {
  const src = avatarUrl ?? thumbnailUrl ?? insetUrl;
  const initial = name?.[0]?.toUpperCase() ?? "?";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        loading="lazy"
        className="h-11 w-11 flex-shrink-0 rounded-md object-cover"
        style={{ border: `2px solid ${color}` }}
      />
    );
  }
  return (
    <div
      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-sm font-bold uppercase"
      style={{
        border: `2px solid ${color}`,
        color,
        backgroundColor: `${color}1A`,
      }}
      aria-hidden
      title={classSlug}
    >
      {initial}
    </div>
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
      label: "Overheal",
      value: formatNumber(Number(enrichment.totalOverhealing)),
      hide: Number(enrichment.totalOverhealing) === 0,
    },
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
      <h2 className="text-lg font-semibold">Total Combat Stats</h2>
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

function JuiceBreakdown({
  breakdown,
  personalJuice,
}: {
  breakdown: RunJuiceBreakdown;
  personalJuice: number;
}) {
  const { base, timeModifier, afterModifier, bonuses } = breakdown;
  const modifierLabel = timeModifier === 1
    ? "Timed"
    : timeModifier < 1
      ? "Depleted (×0.5)"
      : `Timed (×${timeModifier})`;

  const entries: Array<{ label: string; delta: string; positive?: boolean }> = [
    { label: `Base (+${base})`, delta: `${base}` },
    {
      label: modifierLabel,
      delta: afterModifier !== base ? `${afterModifier - base >= 0 ? "+" : ""}${afterModifier - base}` : "—",
      positive: timeModifier > 1,
    },
  ];
  if (bonuses.noDeaths > 0) {
    entries.push({ label: "No deaths", delta: `+${bonuses.noDeaths}`, positive: true });
  }
  if (bonuses.eventParticipation > 0) {
    entries.push({ label: "Event", delta: `+${bonuses.eventParticipation}`, positive: true });
  }
  if (bonuses.personalDungeonRecord > 0) {
    entries.push({ label: "Dungeon PR", delta: `+${bonuses.personalDungeonRecord}`, positive: true });
  }
  if (bonuses.personalOverallRecord > 0) {
    entries.push({ label: "Overall PR", delta: `+${bonuses.personalOverallRecord}`, positive: true });
  }

  return (
    <div className="mt-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-muted-foreground">Total</span>
        <span className="font-mono text-sm font-semibold text-gold">
          {formatNumber(personalJuice)}
        </span>
      </div>
      <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
        {entries.map((e) => (
          <li key={e.label} className="flex items-center justify-between gap-2">
            <span className="truncate">• {e.label}</span>
            <span
              className={`font-mono ${
                e.positive ? "text-green-400" : e.delta.startsWith("-") ? "text-red-400" : ""
              }`}
            >
              {e.delta}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TimelineSection({
  enrichment,
  runDurationMs,
}: {
  enrichment: NonNullable<RunDetail["enrichment"]>;
  runDurationMs: number;
}) {
  const bucketSizeMs = enrichment.bucketSizeMs;
  const segmentStartedAt = enrichment.segmentStartedAt;
  // Legacy rows (pre-timeline) won't have bucket data — just skip the chart.
  if (!bucketSizeMs || !segmentStartedAt) return null;
  const havePlayerBuckets = enrichment.players.some(
    (p) => Array.isArray(p.damageBuckets) && p.damageBuckets.length > 0,
  );
  if (!havePlayerBuckets) return null;

  const segmentStartMs = new Date(segmentStartedAt).getTime();
  const runDurationSec = Math.max(1, runDurationMs / 1000);

  const timelinePlayers: TimelinePlayer[] = enrichment.players
    .filter((p) => Array.isArray(p.damageBuckets) && p.damageBuckets.length > 0)
    .map((p) => {
      const spec = p.specId ? getSpecById(p.specId) : undefined;
      const colorHex = spec
        ? `#${spec.classColor.toString(16).padStart(6, "0").toUpperCase()}`
        : "#999999";
      return {
        shortName: p.playerName.split("-")[0] ?? p.playerName,
        colorHex,
        buckets: p.damageBuckets ?? [],
      };
    });

  const bosses: TimelineBossMarker[] = enrichment.encounters.map((e) => ({
    name: e.encounterName,
    offsetSec: Math.max(
      0,
      (new Date(e.startedAt).getTime() - segmentStartMs + e.fightTimeMs) / 1000,
    ),
    success: e.success,
  }));

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Damage Timeline</h2>
      <p className="text-xs text-muted-foreground">
        DPS in {bucketSizeMs / 1000}s buckets. Dashed lines mark boss kills.
      </p>
      <div className="mt-3 rounded-lg border border-border bg-card p-3">
        <DamageTimelineChart
          bucketSizeMs={bucketSizeMs}
          runDurationSec={runDurationSec}
          players={timelinePlayers}
          bosses={bosses}
        />
      </div>
    </section>
  );
}

function PlayersTable({
  players,
  runDurationMs,
  bucketSizeMs,
}: {
  players: RunDetailEnrichmentPlayer[];
  runDurationMs: number;
  bucketSizeMs: number | null;
}) {
  const durationSec = Math.max(1, runDurationMs / 1000);
  const sorted = [...players].sort(
    (a, b) => Number(b.damageDone) - Number(a.damageDone),
  );

  // Per-column maxima for highlighting the top performer in each category.
  // Deaths is intentionally excluded — "most deaths" isn't a positive stat.
  const maxDamage = Math.max(...sorted.map((p) => Number(p.damageDone)));
  const maxHealing = Math.max(...sorted.map((p) => Number(p.healingDone)));
  const maxInterrupts = Math.max(...sorted.map((p) => p.interrupts));
  const maxDispels = Math.max(...sorted.map((p) => p.dispels));
  const maxPeakDps = Math.max(
    ...sorted.map((p) => (p.peakDamage ? Number(p.peakDamage) : 0)),
  );
  const leader = (isLeader: boolean, baseClass = "") =>
    `${baseClass} ${isLeader ? "font-bold text-gold" : ""}`.trim();

  const bucketSizeSec = bucketSizeMs ? bucketSizeMs / 1000 : null;
  const showPeakColumn = bucketSizeSec !== null && maxPeakDps > 0;

  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold">Per-player</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        <span className="font-semibold text-gold">Gold</span> = top in column.
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Player</th>
              <th className="px-3 py-2 font-medium">Spec</th>
              <th className="px-3 py-2 text-right font-medium">Damage</th>
              <th className="px-3 py-2 text-right font-medium">Average DPS</th>
              {showPeakColumn && (
                <th
                  className="px-3 py-2 text-right font-medium"
                  title={`Highest DPS in any ${bucketSizeSec}-second window`}
                >
                  Peak DPS
                </th>
              )}
              <th
                className="px-3 py-2 text-right font-medium"
                title="Effective healing — includes shield absorbs, excludes overheal"
              >
                Healing
              </th>
              <th className="px-3 py-2 text-right font-medium">Average HPS</th>
              <th
                className="px-3 py-2 text-right font-medium"
                title="Healing that went to already-topped targets (wasted GCDs)"
              >
                Overheal
              </th>
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

              const isTopDamage = damage > 0 && damage === maxDamage;
              const isTopHealing = healing > 0 && healing === maxHealing;
              const isTopInterrupts = p.interrupts > 0 && p.interrupts === maxInterrupts;
              const isTopDispels = p.dispels > 0 && p.dispels === maxDispels;
              const peakDamage = p.peakDamage ? Number(p.peakDamage) : 0;
              const peakDps = bucketSizeSec ? Math.round(peakDamage / bucketSizeSec) : 0;
              const isTopPeak = peakDamage > 0 && peakDamage === maxPeakDps;

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
                  <td className={leader(isTopDamage, "px-3 py-2 text-right font-mono")}>
                    {formatNumber(damage)}
                    {Number(p.petDamageDone) > 0 && (
                      <div
                        className="text-xs font-normal text-muted-foreground"
                        title="Included in total damage — this is the amount coming from pets/guardians/totems"
                      >
                        +{formatNumber(Number(p.petDamageDone))} pet
                      </div>
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      isTopDamage ? "font-bold text-gold" : "text-muted-foreground"
                    }`}
                  >
                    {formatNumber(Math.round(damage / durationSec))}
                  </td>
                  {showPeakColumn && (
                    <td className={leader(isTopPeak, "px-3 py-2 text-right font-mono")}>
                      {peakDps > 0 ? formatNumber(peakDps) : "—"}
                    </td>
                  )}
                  <td className={leader(isTopHealing, "px-3 py-2 text-right font-mono")}>
                    {formatNumber(healing)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      isTopHealing ? "font-bold text-gold" : "text-muted-foreground"
                    }`}
                  >
                    {formatNumber(Math.round(healing / durationSec))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {Number(p.overhealing) > 0 ? (
                      <>
                        {formatNumber(Number(p.overhealing))}
                        {healing > 0 && (
                          <div className="text-xs font-normal">
                            {Math.round(
                              (Number(p.overhealing) /
                                (healing + Number(p.overhealing))) *
                                100,
                            )}
                            %
                          </div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={leader(isTopInterrupts, "px-3 py-2 text-right")}>
                    {p.interrupts}
                  </td>
                  <td className={leader(isTopDispels, "px-3 py-2 text-right")}>
                    {p.dispels}
                  </td>
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
      log_not_found: "Advanced Combat Logging wasn't active when this run was submitted.",
      log_path_unresolvable: "The companion app didn't have a WoW install path configured.",
      parse_failed: "Couldn't process the combat data for this run.",
      no_matching_segment: "No matching segment found for this run.",
      segment_mismatch: "The captured segment didn't match this run's dungeon or time.",
      acl_disabled: "Advanced Combat Logging was disabled in-game during this run.",
      no_attempt: "Detailed stats were not captured for this run.",
    }[reason] ?? "Detailed stats are not available for this run.";

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Total Combat Stats</h2>
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
