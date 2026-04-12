import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { fetchApi } from "@/lib/api";
import { EventCreateForm } from "@/components/event-create-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create Event",
  description: "Create a new M+ competitive event.",
};

interface DungeonsResponse {
  season: { id: number; slug: string; name: string } | null;
  dungeons: Array<{
    id: number;
    slug: string;
    name: string;
    shortCode: string;
  }>;
}

export default async function CreateEventPage() {
  const session = await auth();

  if (!session) {
    redirect("/api/auth/signin?callbackUrl=/events/create");
  }

  let dungeons: DungeonsResponse["dungeons"] = [];
  try {
    const data = await fetchApi<DungeonsResponse>("/api/v1/dungeons", {
      revalidate: 3600,
    });
    dungeons = data.dungeons;
  } catch {
    // API may be down — show form without dungeon list
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold">Create Event</h1>
      <p className="mt-2 text-muted-foreground">
        Fill in the details and the event will be posted to Discord
        automatically.
      </p>

      <div className="mt-8">
        <EventCreateForm dungeons={dungeons} />
      </div>
    </div>
  );
}
