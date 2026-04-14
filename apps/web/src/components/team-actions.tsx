"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  teamId: number;
}

export function TeamActions({ teamId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleInactivate() {
    if (!confirm("Are you sure you want to inactivate this team? This cannot be undone.")) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/teams/${teamId}`, { method: "PATCH" });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleInactivate}
      disabled={loading}
      className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
    >
      {loading ? "..." : "Inactivate Team"}
    </button>
  );
}
