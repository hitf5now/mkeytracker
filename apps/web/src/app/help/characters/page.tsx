import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Registering Characters",
  description:
    "How to link your WoW characters to your platform account so you can receive endorsements and show up in leaderboards.",
};

export default function CharactersHelpPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href="/dashboard"
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to dashboard
      </Link>

      <h1 className="mt-3 text-3xl font-bold">Registering Characters</h1>
      <p className="mt-3 text-muted-foreground">
        Characters on this platform can be <em>claimed</em> or{" "}
        <em>unclaimed</em>. Unclaimed characters exist in our database because
        someone ran a key with them, but the actual player hasn&rsquo;t linked
        the character to their account yet. Only claimed characters can receive
        endorsements, appear on your dashboard, or be captained on teams.
      </p>

      <section className="mt-8 rounded-lg border border-border bg-card p-5">
        <h2 className="text-xl font-semibold">
          Option 1 — The Discord <code>/register</code> command{" "}
          <span className="text-xs text-muted-foreground">(recommended)</span>
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The simplest path. You don&rsquo;t need to install anything.
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          <li>
            Make sure you&rsquo;re in a Discord server where the M+ Tracker bot
            is installed.
          </li>
          <li>
            In any channel (or a DM with the bot), type:
            <pre className="mt-1 rounded border border-border bg-background px-3 py-2 font-mono text-xs">
              /register character:&lt;name&gt; realm:&lt;realm-slug&gt;
            </pre>
          </li>
          <li>
            The bot will look up your character on RaiderIO to confirm the
            character exists, then link it to your Discord identity.
          </li>
          <li>
            Repeat for each character you want to link. One Discord account can
            own many characters.
          </li>
        </ol>
        <p className="mt-3 rounded border border-border/60 bg-background/50 p-3 text-xs text-muted-foreground">
          <strong>Heads up:</strong> your character must be visible on
          RaiderIO for <code>/register</code> to validate it. A brand-new alt
          that hasn&rsquo;t run any keys or raids yet may not be indexed — give
          it one M+ run or a raid boss kill and try again.
        </p>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="text-xl font-semibold">
          Option 2 — Companion app auto-claim
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          If you&rsquo;re already running the companion app with a paired
          Discord account, the first run you submit auto-links the character
          you played. No extra command needed.
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          <li>
            Install the companion app (see the{" "}
            <Link
              href="/download"
              className="text-gold underline-offset-2 hover:underline"
            >
              download page
            </Link>
            ) and complete the pairing wizard.
          </li>
          <li>Run any M+ key. The companion submits the run automatically.</li>
          <li>
            Your character is claimed on the first submission and flagged with
            a ⚡ icon on the dashboard.
          </li>
        </ol>
      </section>

      <section className="mt-6 rounded-lg border border-gold/30 bg-gold/5 p-5">
        <h2 className="text-lg font-semibold text-gold">
          Why only registered characters can receive endorsements
        </h2>
        <p className="mt-2 text-sm">
          Endorsements are attached to a platform account (your Discord
          identity), not to a character in isolation. An unclaimed character
          has no account to attach recognition to — nobody to notify, no
          profile to display it on, no leaderboard slot to credit.
        </p>
        <p className="mt-2 text-sm">
          Once a teammate runs <code>/register</code>, they become endorsable
          immediately on every run they&rsquo;ve ever participated in. Past
          runs aren&rsquo;t lost — they just become visible to the endorsement
          flow.
        </p>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="text-xl font-semibold">What about party members I ran with?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          If you want to endorse a teammate from a specific run, the fastest
          path is to ping them in Discord and tell them to run{" "}
          <code>/register</code> for the character they played. Once they do,
          they&rsquo;ll show up in the endorsement picker on the run page.
        </p>
      </section>
    </main>
  );
}
