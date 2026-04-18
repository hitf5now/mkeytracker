import type { Metadata } from "next";
import { fetchApi } from "@/lib/api";
import type { ReleaseInfo } from "@/types/api";
import { formatFileSize, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Download",
  description: "Download the M+ Tracker companion app for Windows.",
};

const STEPS = [
  {
    step: "1",
    title: "Install the Companion App",
    description:
      "The installer bundles the WoW addon and places it in your AddOns folder automatically — no manual file copying. After install, the app runs in your system tray and watches for completed keys.",
  },
  {
    step: "2",
    title: "Pair Your Account",
    description:
      "Sign in to the app with Discord. Your characters are linked automatically the first time you submit a run — no need to register them by hand.",
  },
  {
    step: "3",
    title: "Play & Track",
    description:
      "Complete a Mythic+ key, type /reload in-game, and your run will appear on the leaderboards within seconds.",
  },
];

export default async function DownloadPage() {
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL ?? "https://api.mythicplustracker.com";

  let release: ReleaseInfo | null = null;
  try {
    release = await fetchApi<ReleaseInfo>("/download/info", {
      revalidate: 300,
    });
  } catch {
    // API may be down — show page without version info
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold">Download M+ Tracker</h1>
        <p className="mt-2 text-muted-foreground">
          The companion app connects your WoW addon to the platform. Runs are
          uploaded automatically — no manual input needed.
        </p>

        {/* Download CTA */}
        <div className="mt-8">
          <a
            href={`${apiUrl}/download`}
            className="inline-flex h-12 items-center rounded-md bg-gold px-8 text-base font-semibold text-background transition-colors hover:bg-gold-dark"
          >
            Download for Windows
          </a>
          {release && (
            <p className="mt-3 text-sm text-muted-foreground">
              {release.version} &mdash; {formatFileSize(release.size)} &mdash;
              Released {formatDate(release.publishedAt)}
            </p>
          )}
        </div>

        {/* System requirements */}
        <div className="mt-12 rounded-lg border border-border bg-card p-6 text-left">
          <h2 className="text-lg font-semibold">System Requirements</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>Windows 10 or later (64-bit)</li>
            <li>World of Warcraft: The War Within installed</li>
            <li>A Discord account for registration</li>
          </ul>
        </div>

        {/* Setup steps */}
        <div className="mt-12 text-left">
          <h2 className="text-center text-lg font-semibold">Getting Started</h2>
          <div className="mt-6 space-y-6">
            {STEPS.map((step) => (
              <div key={step.step} className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-bold text-background">
                  {step.step}
                </div>
                <div>
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
