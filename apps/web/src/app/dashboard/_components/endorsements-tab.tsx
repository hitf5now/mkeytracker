import Link from "next/link";
import type { EndorsementSummary, TokenBalance } from "@/types/api";
import { formatNumber, formatDateTime } from "@/lib/format";
import { categoryLabel } from "@/lib/endorsement-categories";

interface Props {
  summary: EndorsementSummary;
  tokenBalance: TokenBalance;
}

export function EndorsementsTab({ summary, tokenBalance }: Props) {
  const progressPct =
    tokenBalance.juicePerToken > 0
      ? Math.min(
          100,
          Math.round(
            (tokenBalance.juiceTowardNextToken / tokenBalance.juicePerToken) *
              100,
          ),
        )
      : 0;

  return (
    <div className="space-y-8">
      {/* ─── Token balance + progress to next ─────────────────── */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          Tokens
        </h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <TokenCard
            label="Available"
            value={tokenBalance.total}
            hint={`${tokenBalance.seasonalTokensRemaining} seasonal · ${tokenBalance.starterTokensRemaining} starter`}
          />
          <TokenCard
            label="Given"
            value={summary.totalSent}
            hint={`${summary.seasonSent} this season`}
          />
          <TokenCard
            label="Received"
            value={summary.totalReceived}
            hint={`${summary.seasonReceived} this season`}
          />
        </div>

        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold">Progress to next token</span>
            <span className="font-mono text-muted-foreground">
              {formatNumber(tokenBalance.juiceTowardNextToken)}
              {" / "}
              {formatNumber(tokenBalance.juicePerToken)}
              {" Juice"}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-background/60">
            <div
              className="h-full bg-gold transition-[width]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {tokenBalance.juiceToNextToken > 0
              ? `${formatNumber(tokenBalance.juiceToNextToken)} more Juice until your next token.`
              : "You've earned a token. It'll mint on your next run submission."}
          </p>
        </div>
      </section>

      {/* ─── Favorite ─────────────────────────────────────────── */}
      {summary.favorite && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
            Favorite Endorsement
          </h3>
          <div className="mt-2 rounded-lg border border-gold/40 bg-gold/5 p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold text-gold">
                {categoryLabel(summary.favorite.category)}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(summary.favorite.createdAt)}
              </span>
            </div>
            {summary.favorite.note && (
              <p className="mt-2 text-sm italic text-foreground">
                “{summary.favorite.note}”
              </p>
            )}
            <div className="mt-2 text-xs text-muted-foreground">
              from{" "}
              <code className="text-muted-foreground/80">
                {summary.favorite.giverDiscordId}
              </code>{" "}
              on{" "}
              <Link
                href={`/runs/${summary.favorite.runId}`}
                className="text-gold hover:underline"
              >
                run #{summary.favorite.runId}
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ─── Received ──────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          Endorsements Received
        </h3>
        {summary.recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No endorsements received yet. Run well, be helpful — other players
            will recognize you.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {summary.recent.map((e) => (
              <li
                key={e.id}
                className="rounded-md border border-border bg-card p-3 text-sm"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">
                    {categoryLabel(e.category)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(e.createdAt)}
                  </span>
                </div>
                {e.note && (
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    “{e.note}”
                  </p>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  from{" "}
                  <code className="text-muted-foreground/80">
                    {e.giverDiscordId}
                  </code>{" "}
                  on{" "}
                  <Link
                    href={`/runs/${e.runId}`}
                    className="text-gold hover:underline"
                  >
                    run #{e.runId}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── Sent ─────────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          Endorsements Given
        </h3>
        {summary.sentRecent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            You haven&apos;t given any endorsements yet. Spend a token on a
            teammate after a good run.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {summary.sentRecent.map((e) => (
              <li
                key={e.id}
                className="rounded-md border border-border bg-card p-3 text-sm"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">
                    {categoryLabel(e.category)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(e.createdAt)}
                  </span>
                </div>
                {e.note && (
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    “{e.note}”
                  </p>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  to{" "}
                  <span className="text-foreground">
                    {e.receiverCharacterName ?? e.receiverDiscordId}
                  </span>{" "}
                  on{" "}
                  <Link
                    href={`/runs/${e.runId}`}
                    className="text-gold hover:underline"
                  >
                    run #{e.runId}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TokenCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-bold text-gold">
        {value.toLocaleString()}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}
