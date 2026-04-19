"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  EndorsementCategory,
  EndorsementListItem,
  EndorsementSummary,
  TokenBalance,
} from "@/types/api";
import {
  ENDORSEMENT_CATEGORIES,
  categoryLabel,
} from "@/lib/endorsement-categories";
import {
  computeBadges,
  TIER_CHIP_CLASSES,
  type Badge,
} from "@/lib/endorsement-badges";

interface Props {
  summary: EndorsementSummary;
  /** Only when rendering the viewer's own profile/dashboard. */
  tokenBalance?: TokenBalance | null;
  /** When true, user can change their favorite endorsement. Dashboard only. */
  editableFavorite?: boolean;
  /** User whose endorsements these are. Required for PUT favorite endpoint. */
  userId?: number | null;
}

export function EndorsementDisplay({
  summary,
  tokenBalance,
  editableFavorite = false,
  userId,
}: Props) {
  if (summary.totalReceived === 0) {
    return (
      <section className="rounded border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">Endorsements</h2>
        {tokenBalance !== undefined && tokenBalance !== null && (
          <TokenBalancePill balance={tokenBalance} />
        )}
        <p className="mt-2 text-sm italic text-muted-foreground">
          No endorsements received yet.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Endorsements</h2>
        <div className="flex items-baseline gap-4 text-sm">
          <span>
            <span className="text-2xl font-bold text-gold">
              {summary.totalReceived}
            </span>{" "}
            <span className="text-muted-foreground">received</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {summary.seasonReceived} this season
          </span>
        </div>
      </div>

      {tokenBalance !== undefined && tokenBalance !== null && (
        <TokenBalancePill balance={tokenBalance} />
      )}

      {/* Favorite */}
      {summary.favorite ? (
        <div className="mt-4 rounded border border-gold/40 bg-gold/5 p-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold">
              Favorite
            </div>
            {editableFavorite && userId != null && (
              <FavoriteMenu
                summary={summary}
                userId={userId}
                currentFavoriteId={summary.favorite.id}
              />
            )}
          </div>
          <EndorsementItem item={summary.favorite} showDateOnly />
        </div>
      ) : editableFavorite && userId != null && summary.recent.length > 0 ? (
        <div className="mt-4 rounded border border-dashed border-border p-3 text-center text-sm text-muted-foreground">
          <p>Pin a favorite endorsement to feature it at the top.</p>
          <FavoriteMenu summary={summary} userId={userId} currentFavoriteId={null} />
        </div>
      ) : null}

      {/* Badges */}
      <BadgeGrid badges={computeBadges(summary)} />

      {/* Category breakdown */}
      {summary.categoryBreakdown.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            By Category
          </div>
          <div className="flex flex-wrap gap-2">
            {summary.categoryBreakdown.map((b) => (
              <span
                key={b.category}
                className="rounded-full border border-gold/30 bg-gold/5 px-2.5 py-1 text-xs"
              >
                <span className="font-medium text-gold">{b.count}×</span>{" "}
                <span className="text-foreground/80">
                  {categoryLabel(b.category)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent feed */}
      {summary.recent.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Recent
          </div>
          <ul className="space-y-2">
            {summary.recent.map((item) => (
              <li
                key={item.id}
                className="rounded border border-border/60 bg-background/50 p-3"
              >
                <EndorsementItem item={item} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function BadgeGrid({ badges }: { badges: Badge[] }) {
  if (badges.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Milestones
      </div>
      <div className="flex flex-wrap gap-2">
        {badges.map((b) => (
          <span
            key={b.id}
            title={b.subtitle}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${TIER_CHIP_CLASSES[b.tier]}`}
          >
            {b.title}
            <span className="ml-1 opacity-70">· {b.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TokenBalancePill({ balance }: { balance: TokenBalance }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs">
      <span className="rounded-md border border-border bg-background/60 px-2 py-1 text-foreground">
        <span className="font-bold text-gold">{balance.total}</span>{" "}
        <span className="text-muted-foreground">
          token{balance.total === 1 ? "" : "s"} to give
        </span>
      </span>
      {balance.seasonalTokensRemaining > 0 && (
        <span className="text-muted-foreground">
          {balance.seasonalTokensRemaining} seasonal
        </span>
      )}
      {balance.starterTokensRemaining > 0 && (
        <span className="text-muted-foreground">
          {balance.starterTokensRemaining} starter
        </span>
      )}
    </div>
  );
}

function EndorsementItem({
  item,
  showDateOnly,
}: {
  item: EndorsementListItem;
  showDateOnly?: boolean;
}) {
  const date = new Date(item.createdAt);
  const dateStr = showDateOnly
    ? date.toLocaleDateString()
    : date.toLocaleString();
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="rounded-full border border-gold/30 bg-gold/5 px-2 py-0.5 text-xs font-medium text-gold">
          {categoryLabel(item.category)}
        </span>
        <Link
          href={`/runs/${item.runId}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Run #{item.runId}
        </Link>
        <span className="ml-auto text-xs text-muted-foreground">{dateStr}</span>
      </div>
      {item.note && (
        <p className="mt-1.5 text-sm italic text-foreground/90">
          &ldquo;{item.note}&rdquo;
        </p>
      )}
    </>
  );
}

/** Dropdown menu of received endorsements to pick a new favorite. */
function FavoriteMenu({
  summary,
  userId,
  currentFavoriteId,
}: {
  summary: EndorsementSummary;
  userId: number;
  currentFavoriteId: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setFavorite(endorsementId: number | null) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/endorsements/favorite`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endorsementId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setError(data.message ?? data.error ?? `Failed (${res.status}).`);
        setSaving(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground underline-offset-2 hover:text-gold hover:underline"
      >
        {currentFavoriteId === null ? "Pick one" : "Change"}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-border bg-card p-3 shadow-lg">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Pick your favorite
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {summary.recent.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={saving || item.id === currentFavoriteId}
                  onClick={() => setFavorite(item.id)}
                  className="w-full rounded border border-border bg-background/50 p-2 text-left text-xs hover:border-gold/50 disabled:opacity-50"
                >
                  <div className="font-medium text-gold">
                    {categoryLabel(item.category)}
                  </div>
                  {item.note && (
                    <div className="mt-0.5 line-clamp-2 italic text-foreground/80">
                      &ldquo;{item.note}&rdquo;
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {currentFavoriteId !== null && (
            <button
              type="button"
              disabled={saving}
              onClick={() => setFavorite(null)}
              className="mt-2 text-xs text-muted-foreground hover:text-red-400 disabled:opacity-50"
            >
              Clear favorite
            </button>
          )}
          {error && (
            <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
