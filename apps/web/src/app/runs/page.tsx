import type { Metadata } from "next";
import Link from "next/link";
import { fetchApi } from "@/lib/api";
import type { RunsListResult, RunsListMember, SeasonsResponse } from "@/types/api";
import { getClassColor } from "@/lib/class-colors";
import { formatDuration, formatNumber, formatUpgrades } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { SeasonPicker } from "@/components/season-picker";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Runs",
  description: "Every Mythic+ run logged on M+ Tracker, newest first.",
};

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

interface Props {
  searchParams: Promise<{
    limit?: string;
    offset?: string;
    season?: string;
  }>;
}

export default async function RunsListPage({ searchParams }: Props) {
  const params = await searchParams;

  const limitRaw = Number.parseInt(params.limit ?? "", 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_PAGE_SIZE)
      : PAGE_SIZE;
  const offsetRaw = Number.parseInt(params.offset ?? "", 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  const seasonParam = params.season;

  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  if (seasonParam) qs.set("season", seasonParam);

  const [data, seasons] = await Promise.all([
    fetchApi<RunsListResult>(`/api/v1/runs?${qs.toString()}`),
    fetchApi<SeasonsResponse>("/api/v1/seasons"),
  ]);

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(data.total / limit));
  const hasPrev = offset > 0;
  const hasNext = offset + limit < data.total;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Runs</h1>
          <p className="mt-2 text-muted-foreground">
            Every Mythic+ run logged on the site, newest first.
          </p>
        </div>
        <SeasonPicker data={seasons} value={seasonParam} />
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {formatNumber(data.total)} run{data.total === 1 ? "" : "s"}
          {data.season ? ` · ${data.season.name}` : " · all seasons"}
        </span>
        <span>
          Page {page} of {totalPages}
        </span>
      </div>

      {data.runs.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No runs logged yet.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Dungeon</th>
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">Result</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Deaths</th>
                <th className="px-4 py-3 font-medium">Party</th>
                <th className="px-4 py-3 text-right font-medium">Juice</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border/50 transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <Link href={`/runs/${r.id}`} className="block w-full">
                      <LocalTime iso={r.recordedAt} />
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/runs/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.dungeonName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    <Link href={`/runs/${r.id}`} className="block w-full">
                      +{r.keystoneLevel}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/runs/${r.id}`} className="block w-full">
                      <span
                        className={`text-xs font-semibold ${
                          r.onTime ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {formatUpgrades(r.upgrades, r.onTime)}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/runs/${r.id}`} className="block w-full">
                      {formatDuration(r.completionMs)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <Link href={`/runs/${r.id}`} className="block w-full">
                      {r.deaths}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/runs/${r.id}`}
                      className="block w-full"
                      aria-label="View run"
                    >
                      <PartyChips members={sortPartyForList(r.members)} />
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-gold">
                    <Link href={`/runs/${r.id}`} className="block w-full">
                      {formatNumber(r.personalJuice)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <PageLink
              enabled={hasPrev}
              href={pageHref({
                offset: Math.max(0, offset - limit),
                limit,
                season: seasonParam,
              })}
              label="← Previous"
            />
            <PageLink
              enabled={hasNext}
              href={pageHref({
                offset: offset + limit,
                limit,
                season: seasonParam,
              })}
              label="Next →"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PartyChips({ members }: { members: RunsListMember[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {members.map((m) => (
        <span
          key={m.id}
          className="truncate"
          style={{ color: getClassColor(m.characterClass) }}
          title={`${m.characterName} · ${m.specSnapshot} ${m.classSnapshot} · ${m.roleSnapshot}`}
        >
          {m.characterName}
        </span>
      ))}
    </div>
  );
}

function sortPartyForList(members: RunsListMember[]): RunsListMember[] {
  const bucket = (m: RunsListMember): number => {
    const r = m.roleSnapshot.toLowerCase();
    if (r === "tank") return 0;
    if (r === "healer") return 1;
    if (r === "dps") return 2;
    return 3;
  };
  return [...members].sort((a, b) => bucket(a) - bucket(b));
}

function pageHref(args: {
  offset: number;
  limit: number;
  season: string | undefined;
}): string {
  const p = new URLSearchParams();
  if (args.offset > 0) p.set("offset", String(args.offset));
  if (args.limit !== PAGE_SIZE) p.set("limit", String(args.limit));
  // Preserve whatever season is being viewed — not just "all", or paging
  // through a past season would snap the reader back to the current one.
  if (args.season) p.set("season", args.season);
  const qs = p.toString();
  return qs ? `/runs?${qs}` : "/runs";
}

function PageLink({
  enabled,
  href,
  label,
}: {
  enabled: boolean;
  href: string;
  label: string;
}) {
  if (!enabled) {
    return (
      <span className="cursor-not-allowed rounded border border-border bg-background/40 px-3 py-1 text-xs text-muted-foreground">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      scroll={false}
      className="rounded border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground hover:bg-background/40"
    >
      {label}
    </Link>
  );
}
