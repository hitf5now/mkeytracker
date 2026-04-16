import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Add Bot to Server",
  description: "Install the M+ Tracker bot on your Discord server.",
};

const CLIENT_ID = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID ?? "";

// bot + applications.commands
// Permissions: Send Messages (2048), Embed Links (16384), Read Message History (65536),
// Use Application Commands (2147483648), Manage Messages (8192), Manage Webhooks (536870912),
// Manage Roles (268435456)
const PERMISSIONS = "2953576448";
const INVITE_URL = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=${PERMISSIONS}&scope=bot%20applications.commands`;

export default function InstallPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-3xl font-bold text-foreground">
        Add M+ Tracker to Your Server
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Bring competitive Mythic+ events, leaderboards, and Juice scoring to your Discord community.
      </p>

      <div className="mt-8">
        <a
          href={INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-indigo-500"
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" />
          </svg>
          Add to Discord
        </a>
      </div>

      <div className="mt-12 space-y-6 text-left">
        <h2 className="text-xl font-semibold text-foreground">What happens next?</h2>

        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-sm font-bold text-indigo-400">1</div>
            <div>
              <p className="font-medium text-foreground">Select your server</p>
              <p className="text-sm text-muted-foreground">Choose the Discord server where you want to install the bot. You need Manage Server permission.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-sm font-bold text-indigo-400">2</div>
            <div>
              <p className="font-medium text-foreground">Configure channels</p>
              <p className="text-sm text-muted-foreground">
                Run <code className="rounded bg-muted px-1 py-0.5 text-xs">/setup events-channel #channel</code> and{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">/setup results-channel #channel</code> to set where events and run results appear.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-sm font-bold text-indigo-400">3</div>
            <div>
              <p className="font-medium text-foreground">Create your first event</p>
              <p className="text-sm text-muted-foreground">Head to the website's Events page to create an event. The bot will post a signup embed in your configured channel.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 rounded-lg border border-border p-6">
        <h3 className="font-semibold text-foreground">Bot Permissions</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          The bot requests: Send Messages, Embed Links, Read Message History, Manage Messages (edit event embeds),
          Manage Webhooks (auto-create result webhooks), Manage Roles (assign Registered role), and Use Application Commands.
        </p>
      </div>
    </div>
  );
}
