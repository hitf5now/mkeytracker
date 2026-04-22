"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  eventId: number;
  currentStatus: string;
  eventName: string;
  eventDescription: string | null;
  startsAt: string;
  endsAt: string;
  minKeyLevel: number;
  maxKeyLevel: number;
}

// Under the Ready Check system, signups stay open through Posted and In
// Progress; there is no separate "Assign Groups" phase — groups form
// automatically at RC expiry. See docs/EVENT_READY_CHECK_SYSTEM.md.
const STATUS_TRANSITIONS: Record<string, { label: string; target: string; style: string }[]> = {
  draft: [
    { label: "Post Event", target: "open", style: "bg-green-600 hover:bg-green-700" },
    { label: "Cancel Event", target: "cancelled", style: "bg-red-600 hover:bg-red-700" },
  ],
  open: [
    { label: "Start Event", target: "in_progress", style: "bg-blue-600 hover:bg-blue-700" },
    { label: "Cancel Event", target: "cancelled", style: "bg-red-600 hover:bg-red-700" },
  ],
  in_progress: [
    { label: "Complete Event", target: "completed", style: "bg-green-600 hover:bg-green-700" },
    { label: "Cancel Event", target: "cancelled", style: "bg-red-600 hover:bg-red-700" },
  ],
};

export function EventAdminPanel({
  eventId,
  currentStatus,
  eventName,
  eventDescription,
  startsAt,
  endsAt,
  minKeyLevel,
  maxKeyLevel,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const transitions = STATUS_TRANSITIONS[currentStatus] ?? [];

  async function handleAction(target: string) {
    setLoading(target);
    setError(null);

    try {
      const endpoint = `/api/event-actions?eventId=${eventId}&action=transition&target=${target}`;
      const res = await fetch(endpoint, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as { message?: string })?.message ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(null);
    }
  }

  async function handleRepost() {
    setLoading("repost");
    setError(null);
    try {
      const res = await fetch(`/api/event-actions?eventId=${eventId}&action=repost`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as { message?: string })?.message ?? `Failed (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repost failed");
    } finally {
      setLoading(null);
    }
  }

  async function handleSyncDiscord() {
    setLoading("discord");
    setError(null);

    try {
      const res = await fetch(`/api/event-actions?eventId=${eventId}&action=sync-discord`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as { message?: string })?.message ?? `Failed (${res.status})`);
      }
      setError(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discord sync failed");
    } finally {
      setLoading(null);
    }
  }

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading("edit");
    setError(null);

    const form = new FormData(e.currentTarget);
    const body = {
      name: form.get("name") as string,
      description: (form.get("description") as string) || null,
      startsAt: new Date(form.get("startsAt") as string).toISOString(),
      endsAt: new Date(form.get("endsAt") as string).toISOString(),
      minKeyLevel: parseInt(form.get("minKey") as string) || 2,
      maxKeyLevel: parseInt(form.get("maxKey") as string) || 40,
    };

    try {
      const res = await fetch(`/api/event-actions?eventId=${eventId}&action=edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as { message?: string })?.message ?? `Failed (${res.status})`);
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edit failed");
    } finally {
      setLoading(null);
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground";

  // Format datetime for input[type=datetime-local]
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  return (
    <div className="rounded-lg border border-gold/30 bg-card p-4">
      <h3 className="text-sm font-semibold text-gold">Event Admin</h3>

      {error && (
        <p className="mt-2 rounded bg-red-500/10 p-2 text-xs text-red-400">{error}</p>
      )}

      {/* Status actions */}
      {transitions.length > 0 && !editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          {transitions.map((t) => (
            <button
              key={t.target}
              type="button"
              disabled={loading !== null}
              onClick={() => handleAction(t.target)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50 ${t.style}`}
            >
              {loading === t.target ? "..." : t.label}
            </button>
          ))}
        </div>
      )}

      {/* Edit + Discord sync + Repost */}
      {!editing && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            Edit Details
          </button>
          <button
            type="button"
            disabled={loading !== null}
            onClick={handleSyncDiscord}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            {loading === "discord" ? "Syncing..." : "Update Discord"}
          </button>
          {(currentStatus === "open" || currentStatus === "in_progress") && (
            <button
              type="button"
              disabled={loading !== null}
              onClick={handleRepost}
              title="Post a pointer message in Discord linking back to this event's embed"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              {loading === "repost" ? "Reposting..." : "Repost to Discord"}
            </button>
          )}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <form onSubmit={handleEdit} className="mt-3 space-y-3">
          <input name="name" defaultValue={eventName} required className={inputClass} />
          <textarea name="description" defaultValue={eventDescription ?? ""} rows={2} className={inputClass} />
          <div className="grid grid-cols-2 gap-2">
            <input name="startsAt" type="datetime-local" defaultValue={toLocalInput(startsAt)} required className={inputClass} />
            <input name="endsAt" type="datetime-local" defaultValue={toLocalInput(endsAt)} required className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input name="minKey" type="number" min={2} max={40} defaultValue={minKeyLevel} className={inputClass} />
            <input name="maxKey" type="number" min={2} max={40} defaultValue={maxKeyLevel} className={inputClass} />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading !== null}
              className="rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-background hover:bg-gold-dark disabled:opacity-50"
            >
              {loading === "edit" ? "Saving..." : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
