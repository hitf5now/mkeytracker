"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RunDetail, EndorsementCategory } from "@/types/api";
import {
  ENDORSEMENT_CATEGORIES,
  GROUP_LABELS,
  categoryLabel,
} from "@/lib/endorsement-categories";
import { getClassColor, getClassName } from "@/lib/class-colors";

interface Props {
  run: RunDetail;
  currentUserId: number | null;
  currentUserDiscordId: string | null;
}

/**
 * Endorsements box, rendered below the party-member grid on the run
 * detail page. Shows existing endorsements for this run and, if the
 * viewer was in the run and linked to the platform, a give button.
 */
export function EndorsementsBox({
  run,
  currentUserId,
  currentUserDiscordId,
}: Props) {
  const router = useRouter();
  const [isGiving, setIsGiving] = useState(false);

  // Viewer was in this run? They must have a userId that appears in members.
  const viewerInRun = useMemo(() => {
    if (currentUserId === null) return false;
    return run.members.some((m) => m.userId === currentUserId);
  }, [run.members, currentUserId]);

  // How many teammates can't be endorsed because their character is
  // unclaimed? An unclaimed character has userId === null.
  const unclaimedTeammateCount = useMemo(
    () => run.members.filter((m) => m.userId === null).length,
    [run.members],
  );

  // Giveable targets: other claimed members (exclude self + unclaimed).
  // We don't dedupe across categories here — per-run dedup is enforced at
  // the API (one endorsement per giver→receiver per run).
  const eligibleTargets = useMemo(() => {
    if (!viewerInRun) return [];
    const givenPairs = new Set(
      run.endorsements
        .filter((e) => e.giverId === currentUserId)
        .map((e) => e.receiverId),
    );
    return run.members.filter(
      (m) =>
        m.userId !== null &&
        m.userId !== currentUserId &&
        !givenPairs.has(m.userId),
    );
  }, [run.members, run.endorsements, currentUserId, viewerInRun]);

  function onGiven() {
    setIsGiving(false);
    // Refresh server component to pull the new endorsement into view.
    router.refresh();
  }

  return (
    <section className="mt-6 rounded border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Endorsements</h2>
          <p className="text-xs text-muted-foreground">
            Recognize a teammate for a standout performance in this run.
          </p>
        </div>
        {viewerInRun && eligibleTargets.length > 0 && (
          <button
            type="button"
            onClick={() => setIsGiving(true)}
            className="rounded-md border border-gold/50 bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold hover:bg-gold/20"
          >
            Give Endorsement
          </button>
        )}
      </div>

      {run.endorsements.length === 0 ? (
        <p className="mt-3 text-sm italic text-muted-foreground">
          No endorsements yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {run.endorsements.map((e) => {
            const receiver = run.members.find((m) => m.userId === e.receiverId);
            const giver = run.members.find((m) => m.userId === e.giverId);
            const receiverName = receiver?.character?.name ?? "Unknown";
            const giverName = giver?.character?.name ?? "Unknown";
            const cls = receiver?.character?.class ?? receiver?.classSnapshot;
            const color = cls ? getClassColor(cls) : "#999";
            return (
              <li
                key={e.id}
                className="rounded border border-border/60 bg-background/50 p-3"
              >
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-semibold" style={{ color }}>
                    {receiverName}
                  </span>
                  <span className="text-muted-foreground">—</span>
                  <span className="rounded-full border border-gold/30 bg-gold/5 px-2 py-0.5 text-xs font-medium text-gold">
                    {categoryLabel(e.category)}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    from {giverName}
                  </span>
                </div>
                {e.note && (
                  <p className="mt-1.5 text-sm italic text-foreground/90">
                    &ldquo;{e.note}&rdquo;
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Note about unclaimed teammates — only shown to viewers in the run */}
      {viewerInRun && unclaimedTeammateCount > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Only registered characters can receive endorsements.{" "}
          {unclaimedTeammateCount === 1
            ? "1 teammate isn't listed yet because their character is unclaimed."
            : `${unclaimedTeammateCount} teammates aren't listed yet because their characters are unclaimed.`}{" "}
          <Link
            href="/help/characters"
            className="text-gold underline-offset-2 hover:underline"
          >
            How character registration works →
          </Link>
        </p>
      )}

      {/* Gentle hint for non-logged-in viewers who see that endorsements exist but can't give */}
      {!viewerInRun && currentUserDiscordId === null && (
        <p className="mt-3 text-xs italic text-muted-foreground">
          Sign in with Discord and link a character to give endorsements.
        </p>
      )}

      {isGiving && (
        <GiveEndorsementModal
          runId={run.id}
          targets={eligibleTargets}
          onClose={() => setIsGiving(false)}
          onGiven={onGiven}
        />
      )}
    </section>
  );
}

interface ModalProps {
  runId: number;
  targets: RunDetail["members"];
  onClose: () => void;
  onGiven: () => void;
}

function GiveEndorsementModal({ runId, targets, onClose, onGiven }: ModalProps) {
  const [receiverId, setReceiverId] = useState<number | "">(
    targets[0]?.userId ?? "",
  );
  const [category, setCategory] = useState<EndorsementCategory>(
    ENDORSEMENT_CATEGORIES[0]!.value,
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (receiverId === "") {
      setError("Pick a teammate.");
      return;
    }
    const receiver = targets.find((t) => t.userId === receiverId);
    if (!receiver || !receiver.character) {
      setError("That teammate isn't selectable.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/endorsements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverUserId: receiverId,
          runId,
          category,
          note: note.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(data.message ?? data.error ?? `Failed (${res.status}).`);
        setSubmitting(false);
        return;
      }
      onGiven();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-gold/50";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">Give an Endorsement</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          This spends one of your endorsement tokens. One endorsement per
          teammate per run.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Teammate
            </label>
            <select
              required
              value={receiverId}
              onChange={(e) =>
                setReceiverId(
                  e.target.value === "" ? "" : Number(e.target.value),
                )
              }
              className={inputClass}
            >
              {targets.map((t) => {
                const name = t.character?.name ?? `Member #${t.id}`;
                const cls = t.character?.class ?? t.classSnapshot;
                return (
                  <option key={t.id} value={t.userId ?? ""}>
                    {name} — {getClassName(cls)} ({t.roleSnapshot})
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Category
            </label>
            <select
              required
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as EndorsementCategory)
              }
              className={inputClass}
            >
              {(["role", "mechanical", "soft", "memorable"] as const).map(
                (group) => (
                  <optgroup key={group} label={GROUP_LABELS[group]}>
                    {ENDORSEMENT_CATEGORIES.filter(
                      (c) => c.group === group,
                    ).map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Note{" "}
              <span className="text-muted-foreground/70">
                (optional, encouraged — 280 chars max)
              </span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="Clutch kick on the last boss cast."
              className={inputClass}
            />
            <div className="mt-1 text-right text-[10px] text-muted-foreground">
              {note.length}/280
            </div>
          </div>

          {error && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-background disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md border border-gold/50 bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Send Endorsement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
