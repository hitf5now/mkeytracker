"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface MemberSlot {
  characterName: string;
  characterRealm: string;
  characterRegion: "us" | "eu" | "kr" | "tw" | "cn";
  role: "tank" | "healer" | "dps";
}

const EMPTY_MEMBER: MemberSlot = {
  characterName: "",
  characterRealm: "",
  characterRegion: "us",
  role: "dps",
};

const REGIONS = ["us", "eu", "kr", "tw", "cn"] as const;

const SLOT_LABELS = [
  { label: "Tank", defaultRole: "tank" as const },
  { label: "Healer", defaultRole: "healer" as const },
  { label: "DPS 1", defaultRole: "dps" as const },
  { label: "DPS 2", defaultRole: "dps" as const },
  { label: "DPS 3", defaultRole: "dps" as const },
];

export function TeamCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<MemberSlot[]>(
    SLOT_LABELS.map((s) => ({ ...EMPTY_MEMBER, role: s.defaultRole })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateMember(index: number, field: keyof MemberSlot, value: string) {
    setMembers((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, members }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          (err as { message?: string })?.message ?? `API returned ${res.status}`,
        );
      }

      const { team } = (await res.json()) as { team: { id: number } };
      router.push(`/teams/${team.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gold/50";
  const labelClass = "block text-xs font-medium text-muted-foreground mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="teamName" className="block text-sm font-medium text-foreground mb-1.5">
          Team Name
        </label>
        <input
          id="teamName"
          type="text"
          required
          minLength={2}
          maxLength={50}
          placeholder="The Keystone Crushers"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Roster (5 players)</h3>
        {members.map((member, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-4"
          >
            <p className="mb-3 text-xs font-semibold text-gold uppercase tracking-wide">
              {SLOT_LABELS[i]!.label}
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-1">
                <label className={labelClass}>Name</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={12}
                  placeholder="Character"
                  value={member.characterName}
                  onChange={(e) => updateMember(i, "characterName", e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-1">
                <label className={labelClass}>Realm</label>
                <input
                  type="text"
                  required
                  placeholder="area-52"
                  value={member.characterRealm}
                  onChange={(e) => updateMember(i, "characterRealm", e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Region</label>
                <select
                  value={member.characterRegion}
                  onChange={(e) => updateMember(i, "characterRegion", e.target.value)}
                  className={inputClass}
                >
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>{r.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Role</label>
                <select
                  value={member.role}
                  onChange={(e) => updateMember(i, "role", e.target.value)}
                  className={inputClass}
                >
                  <option value="tank">Tank</option>
                  <option value="healer">Healer</option>
                  <option value="dps">DPS</option>
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-gold px-4 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-gold-dark disabled:opacity-50"
      >
        {submitting ? "Creating..." : "Create Team"}
      </button>
    </form>
  );
}
