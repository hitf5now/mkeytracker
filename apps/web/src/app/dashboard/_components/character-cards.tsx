import Link from "next/link";
import type { DashboardCharacter } from "@/types/api";
import { getClassColor, getClassName } from "@/lib/class-colors";
import { formatNumber } from "@/lib/format";

export function CharacterCards({ characters }: { characters: DashboardCharacter[] }) {
  if (characters.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No characters linked yet.{" "}
        <Link
          href="/help/characters"
          className="text-gold underline-offset-2 hover:underline"
        >
          Learn how to register a character →
        </Link>
      </p>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {characters.map((char) => (
        <Link
          key={char.id}
          href={`/players/${char.region}/${char.realm}/${char.name}`}
          className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-gold/50"
        >
          <div className="flex items-center justify-between">
            <h3
              className="font-semibold group-hover:underline"
              style={{ color: getClassColor(char.class) }}
            >
              {char.name}
            </h3>
            {char.hasCompanionApp && (
              <span title="Companion app linked" className="text-gold">⚡</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {char.realm} — {getClassName(char.class)} ({char.spec})
          </p>
          {char.rioScore > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatNumber(char.rioScore)} RIO
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Runs:</span>{" "}
              <span className="font-medium">{char.totalRuns}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Timed:</span>{" "}
              <span className="font-medium">{char.timedRuns}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Highest:</span>{" "}
              <span className="font-medium">{char.highestKey > 0 ? `+${char.highestKey}` : "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Juice:</span>{" "}
              <span className="font-medium">{formatNumber(char.totalJuice)}</span>
            </div>
          </div>
        </Link>
      ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Missing a character?{" "}
        <Link
          href="/help/characters"
          className="text-gold underline-offset-2 hover:underline"
        >
          How to register it →
        </Link>
      </p>
    </>
  );
}
