"use client";

import { useState, useTransition } from "react";

interface TextChannel {
  id: string;
  name: string;
  parentId: string | null;
}

interface Props {
  guildId: string;
  eventsChannelId: string | null;
  resultsChannelId: string | null;
  channels: TextChannel[];
}

export function ServerConfigForm({
  guildId,
  eventsChannelId,
  resultsChannelId,
  channels,
}: Props) {
  const [events, setEvents] = useState(eventsChannelId ?? "");
  const [results, setResults] = useState(resultsChannelId ?? "");
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("idle");

    startTransition(async () => {
      try {
        const res = await fetch(`/api/servers/${guildId}/config`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventsChannelId: events || null,
            resultsChannelId: results || null,
          }),
        });

        if (res.ok) {
          setStatus("saved");
          setTimeout(() => setStatus("idle"), 3000);
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <div>
        <label htmlFor="events-channel" className="block text-sm font-medium text-foreground">
          Events Channel
        </label>
        <p className="text-xs text-muted-foreground">Where event signup embeds are posted.</p>
        <select
          id="events-channel"
          value={events}
          onChange={(e) => setEvents(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">Not configured</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="results-channel" className="block text-sm font-medium text-foreground">
          Results Channel
        </label>
        <p className="text-xs text-muted-foreground">Where run completion results are posted.</p>
        <select
          id="results-channel"
          value={results}
          onChange={(e) => setResults(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">Not configured</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save Changes"}
        </button>

        {status === "saved" && (
          <span className="text-sm text-green-400">Saved!</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-400">Failed to save. Try again.</span>
        )}
      </div>
    </form>
  );
}
