"use client";

import { useState, useTransition } from "react";

type Mode = "all_my_servers" | "none" | "primary";

interface Server {
  discordGuildId: string;
  guildName: string | null;
  guildIconUrl: string | null;
  hasResultsChannel: boolean;
  isPrimary: boolean;
}

interface Props {
  initialMode: Mode;
  initialPrimaryGuildId: string | null;
  servers: Server[];
}

export function RunResultsPreference({
  initialMode,
  initialPrimaryGuildId,
  servers,
}: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [primaryGuildId, setPrimaryGuildId] = useState<string>(
    initialPrimaryGuildId ?? servers.find((s) => s.hasResultsChannel)?.discordGuildId ?? "",
  );
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const noServersJoined = servers.length === 0;
  const noResultsChannels = servers.length > 0 && !servers.some((s) => s.hasResultsChannel);

  function save(nextMode: Mode, nextPrimary: string | null) {
    setStatus("idle");
    setErrorMessage(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/account/run-results-preference", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: nextMode,
            ...(nextMode === "primary" && nextPrimary ? { primaryGuildId: nextPrimary } : {}),
          }),
        });
        if (res.ok) {
          setStatus("saved");
          setTimeout(() => setStatus("idle"), 2500);
        } else {
          const data = await res.json().catch(() => null);
          setErrorMessage(data?.message ?? data?.error ?? "Failed to save");
          setStatus("error");
        }
      } catch {
        setStatus("error");
        setErrorMessage("Network error");
      }
    });
  }

  function handleModeChange(nextMode: Mode) {
    setMode(nextMode);
    if (nextMode === "primary") {
      if (!primaryGuildId) return; // wait until they pick a server
      save("primary", primaryGuildId);
    } else {
      save(nextMode, null);
    }
  }

  function handlePrimaryChange(guildId: string) {
    setPrimaryGuildId(guildId);
    if (mode === "primary") save("primary", guildId);
  }

  return (
    <div className="mt-4 space-y-4">
      <fieldset className="space-y-2">
        <ModeRadio
          name="mode"
          value="all_my_servers"
          current={mode}
          onChange={handleModeChange}
          label="All my servers"
          description="Post to every server you've joined that has the bot installed and a results channel configured."
          disabled={noServersJoined}
        />
        <ModeRadio
          name="mode"
          value="primary"
          current={mode}
          onChange={handleModeChange}
          label="A specific server"
          description="Pick exactly one server to receive your run-completed posts."
          disabled={noResultsChannels}
        />
        <ModeRadio
          name="mode"
          value="none"
          current={mode}
          onChange={handleModeChange}
          label="Don't post my runs"
          description="Runs are still logged on the website and counted for events — they just won't be announced in any Discord server."
        />
      </fieldset>

      {mode === "primary" && (
        <div className="rounded-md border border-border/50 bg-background p-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Server to post to
          </label>
          <div className="mt-2 space-y-1.5">
            {servers.map((s) => {
              const disabled = !s.hasResultsChannel;
              const selected = primaryGuildId === s.discordGuildId;
              return (
                <button
                  key={s.discordGuildId}
                  type="button"
                  disabled={disabled || isPending}
                  onClick={() => handlePrimaryChange(s.discordGuildId)}
                  className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? "border-indigo-500 bg-indigo-500/10"
                      : "border-border bg-card hover:border-border/80"
                  } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  {s.guildIconUrl ? (
                    <img src={s.guildIconUrl} alt="" className="h-7 w-7 rounded-full" />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                      {(s.guildName ?? "?").charAt(0)}
                    </div>
                  )}
                  <span className="flex-1 font-medium text-foreground">
                    {s.guildName ?? s.discordGuildId}
                  </span>
                  {disabled && (
                    <span className="text-xs text-muted-foreground">No results channel</span>
                  )}
                  {selected && !disabled && (
                    <span className="text-xs text-indigo-400">Selected</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="min-h-[1.25rem] text-sm">
        {isPending && <span className="text-muted-foreground">Saving…</span>}
        {!isPending && status === "saved" && (
          <span className="text-green-400">Saved.</span>
        )}
        {!isPending && status === "error" && (
          <span className="text-red-400">{errorMessage ?? "Failed to save."}</span>
        )}
      </div>
    </div>
  );
}

function ModeRadio({
  name,
  value,
  current,
  onChange,
  label,
  description,
  disabled = false,
}: {
  name: string;
  value: Mode;
  current: Mode;
  onChange: (v: Mode) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  const checked = current === value;
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
        checked
          ? "border-indigo-500 bg-indigo-500/10"
          : "border-border bg-card hover:border-border/80"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-1 h-4 w-4 shrink-0 accent-indigo-500"
      />
      <div className="min-w-0">
        <p className="font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}
