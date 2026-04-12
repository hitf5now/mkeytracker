"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  region: string;
  realm: string;
  name: string;
}

export function RefreshPortraitButton({ region, realm, name }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRefresh() {
    setLoading(true);
    try {
      await fetch("/api/refresh-portrait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region, realm, name }),
      });
      router.refresh();
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleRefresh}
      disabled={loading}
      className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      title="Refresh character portrait from Blizzard"
    >
      {loading ? "..." : "Refresh Portrait"}
    </button>
  );
}
