"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Dungeon {
  id: number;
  slug: string;
  name: string;
  shortCode: string;
}

interface Guild {
  id: string;
  name: string;
  icon: string | null;
}

interface Props {
  dungeons: Dungeon[];
}

const EVENT_TYPES = [
  { value: "fastest_clear_race", label: "Fastest Clear Race" },
  { value: "speed_sprint", label: "Speed Sprint" },
  { value: "random_draft", label: "Random Draft" },
];

export function EventCreateForm({ dungeons }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildsLoading, setGuildsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/guilds")
      .then((res) => res.json())
      .then((data: { guilds?: Guild[] }) => {
        setGuilds(data.guilds ?? []);
      })
      .catch(() => setGuilds([]))
      .finally(() => setGuildsLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);

    const body = {
      name: form.get("name") as string,
      type: form.get("type") as string,
      dungeonSlug: (form.get("dungeon") as string) || undefined,
      minKeyLevel: parseInt(form.get("minKey") as string) || 2,
      maxKeyLevel: parseInt(form.get("maxKey") as string) || 40,
      startsAt: new Date(form.get("startsAt") as string).toISOString(),
      endsAt: new Date(form.get("endsAt") as string).toISOString(),
      description: (form.get("description") as string) || undefined,
      discordGuildId: (form.get("server") as string) || undefined,
    };

    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          (err as { message?: string })?.message ?? `API returned ${res.status}`,
        );
      }

      const { event } = (await res.json()) as { event: { id: number } };
      router.push(`/events/${event.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold/50";
  const labelClass = "block text-sm font-medium text-foreground mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Discord Server */}
      <div>
        <label htmlFor="server" className={labelClass}>
          Discord Server
        </label>
        {guildsLoading ? (
          <div className="h-10 animate-pulse rounded-md bg-muted" />
        ) : guilds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No servers found. The bot must be installed in a server you belong to.
          </p>
        ) : (
          <select id="server" name="server" required className={inputClass}>
            {guilds.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Name */}
      <div>
        <label htmlFor="name" className={labelClass}>
          Event Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="Friday Night Keys"
          className={inputClass}
        />
      </div>

      {/* Type */}
      <div>
        <label htmlFor="type" className={labelClass}>
          Event Type
        </label>
        <select id="type" name="type" className={inputClass}>
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Dungeon */}
      <div>
        <label htmlFor="dungeon" className={labelClass}>
          Dungeon
        </label>
        <select id="dungeon" name="dungeon" className={inputClass}>
          <option value="">Any dungeon</option>
          {dungeons.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {/* Key Range */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="minKey" className={labelClass}>
            Min Key Level
          </label>
          <input
            id="minKey"
            name="minKey"
            type="number"
            min={2}
            max={40}
            defaultValue={2}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="maxKey" className={labelClass}>
            Max Key Level
          </label>
          <input
            id="maxKey"
            name="maxKey"
            type="number"
            min={2}
            max={40}
            defaultValue={40}
            className={inputClass}
          />
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="startsAt" className={labelClass}>
            Starts At
          </label>
          <input
            id="startsAt"
            name="startsAt"
            type="datetime-local"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="endsAt" className={labelClass}>
            Ends At
          </label>
          <input
            id="endsAt"
            name="endsAt"
            type="datetime-local"
            required
            className={inputClass}
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className={labelClass}>
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          placeholder="Event rules, details, or anything participants should know..."
          className={inputClass}
        />
      </div>

      {error && (
        <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || guilds.length === 0}
        className="w-full rounded-md bg-gold px-4 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-gold-dark disabled:opacity-50"
      >
        {submitting ? "Creating..." : "Create Event & Post to Discord"}
      </button>
    </form>
  );
}
