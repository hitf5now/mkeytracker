"use client";

import { useState, useTransition } from "react";

interface Server {
  id: string;
  name: string;
  icon: string | null;
}

interface Props {
  servers: Server[];
}

export function PrimaryServerPicker({ servers }: Props) {
  const [selected, setSelected] = useState("");
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function handleSave() {
    if (!selected) return;
    setStatus("idle");

    startTransition(async () => {
      try {
        const res = await fetch("/api/account/primary-server", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ discordGuildId: selected }),
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

  if (servers.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-border p-6 text-center text-muted-foreground">
        No shared servers found. The M+ Tracker bot must be installed in at least one of your Discord servers.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {servers.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setSelected(s.id)}
          className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
            selected === s.id
              ? "border-indigo-500 bg-indigo-500/10"
              : "border-border bg-card hover:border-border/80"
          }`}
        >
          {s.icon ? (
            <img src={s.icon} alt="" className="h-10 w-10 rounded-full" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
              {s.name.charAt(0)}
            </div>
          )}
          <span className="font-medium text-foreground">{s.name}</span>
          {selected === s.id && (
            <span className="ml-auto text-xs text-indigo-400">Selected</span>
          )}
        </button>
      ))}

      <div className="flex items-center gap-4 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!selected || isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Set as Primary"}
        </button>

        <button
          type="button"
          onClick={() => setSelected("")}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>

        {status === "saved" && (
          <span className="text-sm text-green-400">Saved!</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-400">Failed to save.</span>
        )}
      </div>
    </div>
  );
}
