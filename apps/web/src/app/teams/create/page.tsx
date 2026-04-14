import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { TeamCreateForm } from "@/components/team-create-form";

export const metadata: Metadata = {
  title: "Create Team",
  description: "Build your M+ team roster.",
};

export default async function CreateTeamPage() {
  const session = await auth();
  if (!session) redirect("/");

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Create Team</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Build a 5-player roster (1 tank, 1 healer, 3 DPS). Rosters are permanent once created.
      </p>
      <div className="mt-8">
        <TeamCreateForm />
      </div>
    </main>
  );
}
