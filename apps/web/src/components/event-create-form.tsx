"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EventTypeConfig } from "@/types/api";

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

const EVENT_MODES = [
  { value: "group", label: "Individual Signup (Groups)", description: "Players sign up individually and are auto-matched into balanced groups." },
  { value: "team", label: "Team Signup", description: "Pre-made teams sign up as a unit. No matchmaking." },
];

export function EventCreateForm({ dungeons }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildsLoading, setGuildsLoading] = useState(true);
  const [eventTypes, setEventTypes] = useState<EventTypeConfig[]>([]);
  const [selectedType, setSelectedType] = useState<string>("fastest_clear_race");
  const [typeConfig, setTypeConfig] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/guilds")
      .then((res) => res.json())
      .then((data: { guilds?: Guild[] }) => setGuilds(data.guilds ?? []))
      .catch(() => setGuilds([]))
      .finally(() => setGuildsLoading(false));

    // Fetch event type definitions from API
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "https://api.mythicplustracker.com";
    fetch(`${apiBase}/api/v1/event-types`)
      .then((res) => res.json())
      .then((data: { eventTypes?: EventTypeConfig[] }) => {
        setEventTypes(data.eventTypes ?? []);
      })
      .catch(() => setEventTypes([]));
  }, []);

  const activeTypeConfig = eventTypes.find((t) => t.slug === selectedType);

  function handleTypeChange(newType: string) {
    setSelectedType(newType);
    // Reset config fields for the new type
    const config = eventTypes.find((t) => t.slug === newType);
    if (config?.configFields) {
      const defaults: Record<string, number> = {};
      for (const f of config.configFields) {
        defaults[f.key] = f.default;
      }
      setTypeConfig(defaults);
    } else {
      setTypeConfig({});
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(e.currentTarget);

    const body: Record<string, unknown> = {
      name: form.get("name") as string,
      type: selectedType,
      mode: form.get("mode") as string,
      dungeonSlug: (form.get("dungeon") as string) || undefined,
      minKeyLevel: parseInt(form.get("minKey") as string) || 2,
      maxKeyLevel: parseInt(form.get("maxKey") as string) || 40,
      startsAt: new Date(form.get("startsAt") as string).toISOString(),
      endsAt: new Date(form.get("endsAt") as string).toISOString(),
      description: (form.get("description") as string) || undefined,
      discordGuildId: (form.get("server") as string) || undefined,
    };

    if (Object.keys(typeConfig).length > 0) {
      body.typeConfig = typeConfig;
    }

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
        <select
          id="type"
          name="type"
          value={selectedType}
          onChange={(e) => handleTypeChange(e.target.value)}
          className={inputClass}
        >
          {eventTypes.length > 0
            ? eventTypes.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.label}
                </option>
              ))
            : (
              <>
                <option value="fastest_clear_race">Fastest Clear Race</option>
                <option value="speed_sprint">Speed Sprint</option>
                <option value="random_draft">Random Draft</option>
                <option value="key_climbing">Key Climbing</option>
                <option value="marathon">Marathon</option>
                <option value="best_average">Best Average</option>
                <option value="bracket_tournament">Bracket Tournament</option>
              </>
            )}
        </select>
      </div>

      {/* Type Rules Preview */}
      {activeTypeConfig && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-gold">{activeTypeConfig.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">{activeTypeConfig.description}</p>
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rules</p>
            <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
              {activeTypeConfig.rules.map((rule, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-gold">-</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scoring</p>
            <div className="mt-1 space-y-0.5">
              {activeTypeConfig.scoringTable.map((row, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-mono text-foreground">{row.points}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Type-specific config fields */}
      {activeTypeConfig?.configFields && activeTypeConfig.configFields.length > 0 && (
        <div className="space-y-3">
          {activeTypeConfig.configFields.map((field) => (
            <div key={field.key}>
              <label className={labelClass}>{field.label}</label>
              <input
                type="number"
                min={field.min}
                max={field.max}
                value={typeConfig[field.key] ?? field.default}
                onChange={(e) =>
                  setTypeConfig((prev) => ({ ...prev, [field.key]: parseInt(e.target.value) || field.default }))
                }
                className={inputClass}
              />
            </div>
          ))}
        </div>
      )}

      {/* Mode */}
      <div>
        <label htmlFor="mode" className={labelClass}>
          Signup Mode
        </label>
        <select id="mode" name="mode" className={inputClass}>
          {EVENT_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          {EVENT_MODES[0]?.description}
        </p>
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
          Additional Notes
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          placeholder="Custom rules, house rules, or anything participants should know..."
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
