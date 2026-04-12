"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PlayerSearch() {
  const router = useRouter();
  const [region, setRegion] = useState("us");
  const [realm, setRealm] = useState("");
  const [name, setName] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!realm.trim() || !name.trim()) return;
    const realmSlug = realm.trim().toLowerCase().replace(/\s+/g, "-");
    const charName = name.trim();
    router.push(`/players/${region}/${realmSlug}/${charName}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
      <select
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground"
      >
        <option value="us">US</option>
        <option value="eu">EU</option>
        <option value="kr">KR</option>
        <option value="tw">TW</option>
        <option value="cn">CN</option>
      </select>
      <input
        type="text"
        value={realm}
        onChange={(e) => setRealm(e.target.value)}
        placeholder="Realm"
        className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Character name"
        className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-gold-dark"
      >
        Search
      </button>
    </form>
  );
}
