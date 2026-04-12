import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchApi, ApiError } from "@/lib/api";
import type { CharacterProfile } from "@/types/api";
import { getClassColor, getClassName } from "@/lib/class-colors";
import { formatDuration, formatNumber, formatUpgrades, formatDate } from "@/lib/format";
import { RoleIcon } from "@/components/role-icon";
import { PlayerSearch } from "@/components/player-search";
import { RefreshPortraitButton } from "@/components/refresh-portrait-button";

interface Props {
  params: Promise<{ region: string; realm: string; name: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { region, realm, name } = await params;
  return {
    title: `${name} — ${realm} (${region.toUpperCase()})`,
    description: `Mythic+ profile for ${name} on ${realm} (${region.toUpperCase()}).`,
  };
}

export default async function PlayerProfilePage({ params }: Props) {
  const { region, realm, name } = await params;

  let data: CharacterProfile;
  try {
    data = await fetchApi<CharacterProfile>(
      `/api/v1/characters/${region}/${realm}/${name}`,
      { revalidate: 120 },
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  const { character, stats, season } = data;
  const classColor = getClassColor(character.class);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Search */}
      <div className="mb-8">
        <PlayerSearch />
      </div>

      {/* Character header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        {/* Portrait — use avatar (head) for compact view, inset (bust) for larger */}
        {(character.avatarUrl || character.thumbnailUrl || character.insetUrl) && (
          <div className="shrink-0">
            <img
              src={character.avatarUrl ?? character.thumbnailUrl ?? character.insetUrl ?? ""}
              alt={character.name}
              className="h-16 w-16 rounded-lg border border-border sm:h-20 sm:w-20"
              loading="eager"
            />
          </div>
        )}
        <div className="flex-1">
          <h1 className="text-3xl font-bold" style={{ color: classColor }}>
            {character.name}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {character.realm} &mdash; {character.region.toUpperCase()} &mdash;{" "}
            {getClassName(character.class)} ({character.spec})
          </p>
          <div className="mt-2 flex items-center gap-4">
            <RoleIcon role={character.role} />
            {character.rioScore > 0 && (
              <span className="text-sm text-muted-foreground">
                RIO {formatNumber(character.rioScore)}
              </span>
            )}
            <RefreshPortraitButton region={region} realm={realm} name={name} />
          </div>
        </div>
      </div>

      {/* Season */}
      <p className="mt-2 text-sm text-muted-foreground">{season.name}</p>

      {/* Stats grid */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Runs", value: stats.totalRuns },
          { label: "Timed", value: stats.timedRuns },
          { label: "Depleted", value: stats.depletedRuns },
          { label: "Deaths", value: stats.totalDeaths },
          { label: "Highest Key", value: stats.highestKeyCompleted > 0 ? `+${stats.highestKeyCompleted}` : "—" },
          { label: "Season Points", value: formatNumber(stats.totalPoints) },
          { label: "Weekly Points", value: formatNumber(stats.weeklyPoints) },
          { label: "Timed Rate", value: stats.totalRuns > 0 ? `${Math.round((stats.timedRuns / stats.totalRuns) * 100)}%` : "—" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-border bg-card p-4"
          >
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="mt-1 text-xl font-bold">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Best runs per dungeon */}
      {stats.bestRunPerDungeon.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold">Best Run Per Dungeon</h2>
          <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Dungeon</th>
                  <th className="px-4 py-3 font-medium">Level</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Result</th>
                  <th className="px-4 py-3 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody>
                {stats.bestRunPerDungeon.map((run) => (
                  <tr
                    key={run.dungeonSlug}
                    className="border-b border-border/50"
                  >
                    <td className="px-4 py-3 font-medium">
                      <span title={run.dungeonName}>
                        {run.dungeonShortCode}
                      </span>
                    </td>
                    <td className="px-4 py-3">+{run.level}</td>
                    <td className="px-4 py-3 font-mono">
                      {formatDuration(run.completionMs)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          run.onTime ? "text-green-400" : "text-red-400"
                        }
                      >
                        {formatUpgrades(run.upgrades, run.onTime)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {formatNumber(run.points)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent runs */}
      {stats.recentRuns.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold">Recent Runs</h2>
          <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Dungeon</th>
                  <th className="px-4 py-3 font-medium">Level</th>
                  <th className="px-4 py-3 font-medium">Result</th>
                  <th className="px-4 py-3 font-medium">Deaths</th>
                  <th className="px-4 py-3 font-medium">Points</th>
                  <th className="px-4 py-3 text-right font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-border/50"
                  >
                    <td className="px-4 py-3 font-medium">
                      {run.dungeonName}
                    </td>
                    <td className="px-4 py-3">+{run.level}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          run.onTime ? "text-green-400" : "text-red-400"
                        }
                      >
                        {formatUpgrades(run.upgrades, run.onTime)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {run.deaths}
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      {formatNumber(run.points)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {formatDate(run.recordedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {stats.totalRuns === 0 && (
        <p className="mt-12 text-center text-muted-foreground">
          No runs recorded yet for this character this season.
        </p>
      )}
    </div>
  );
}
