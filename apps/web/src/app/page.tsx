import Link from "next/link";

const FEATURES = [
  {
    title: "Instant Run Tracking",
    description:
      "The addon captures every key the moment it ends. The companion app uploads it in seconds — no waiting for RaiderIO to backfill.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
  {
    title: "Cross-Guild Events",
    description:
      "Spin up tournaments that span multiple Discord servers. Players sign up with a single button click — automatic matchmaking handles the rest.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-4.52 0" />
      </svg>
    ),
  },
  {
    title: "Smart Matchmaking",
    description:
      "Group-mode events auto-balance signups by role. Leftover players are bundled into PUG groups instead of getting benched.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    title: "Persistent Teams",
    description:
      "Build a five-stack roster that sticks together across events. Same crew, every time — and they earn Team Juice when they roll as one.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    title: "Live Leaderboards",
    description:
      "Per-event live standings update as runs come in, with per-run breakdowns and how-to-take-#1 hints for everyone chasing the leader.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-4.52 0" />
      </svg>
    ),
  },
  {
    title: "Multi-Tenant Discord Bot",
    description:
      "One bot install, any number of Discord servers. Per-server channels for events and results, admin-gated setup, no hardcoded webhooks.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.073a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V14.15M16.5 9.75L12 14.25m0 0L7.5 9.75M12 14.25V3" />
      </svg>
    ),
  },
];

const EVENT_TYPES = [
  {
    name: "Fastest Clear Race",
    blurb: "Same dungeon, lowest time wins. Pure speed.",
  },
  {
    name: "Key Climbing",
    blurb: "Push the highest key you can. Peak level wins.",
  },
  {
    name: "Marathon",
    blurb: "Complete as many keys as possible. Streaks and variety stack.",
  },
  {
    name: "Best Average",
    blurb: "Best average across your top N runs. Consistency over peaks.",
  },
  {
    name: "Bracket Tournament",
    blurb: "Single-elimination head-to-head. Winners advance.",
  },
  {
    name: "Random Draft",
    blurb: "Random groups, combined total wins. Chaos with rules.",
  },
];

const AUDIENCES = [
  {
    title: "For Solo Players",
    accent: "text-gold",
    border: "border-gold/40",
    bg: "bg-gold/5",
    tagline: "Track your grind without the spreadsheet tax.",
    bullets: [
      "Every key auto-uploads — no manual entry",
      "Personal Juice scores every run instantly",
      "Personal records flagged automatically",
      "Sign up for cross-guild events with one button",
    ],
    cta: { href: "/download", label: "Get the Companion App" },
  },
  {
    title: "For Teams",
    accent: "text-blue-300",
    border: "border-blue-400/40",
    bg: "bg-blue-500/5",
    tagline: "Five-stack synergy, recognized and rewarded.",
    bullets: [
      "Build a persistent team roster",
      "Team Juice pours when all 5 share the team",
      "Sign up entire teams to events with one click",
      "Track team performance across the season",
    ],
    cta: { href: "/teams", label: "Build a Team" },
  },
  {
    title: "For Discord Communities",
    accent: "text-purple-300",
    border: "border-purple-400/40",
    bg: "bg-purple-500/5",
    tagline: "Spin up tournaments your members actually finish.",
    bullets: [
      "One-click bot install in any Discord server",
      "Per-server events and results channels",
      "Admin-gated setup — only mods can configure",
      "6 event types from speed runs to season-long marathons",
    ],
    cta: { href: "/servers/install", label: "Install the Bot" },
  },
];

const STEPS = [
  {
    step: "1",
    title: "Install the Addon",
    description:
      "Drop MKeyTracker into your WoW addons folder. It captures every M+ run automatically.",
  },
  {
    step: "2",
    title: "Run the Companion App",
    description:
      "The desktop app watches for new runs and uploads them to the platform in seconds.",
  },
  {
    step: "3",
    title: "Compete & Climb",
    description:
      "Sign up for events via Discord, push your keys, and watch your Juice climb the leaderboards.",
  },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden py-28 sm:py-40">
        {/* Background image */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url('/hero-bg.jpg')" }}
        />
        {/* Dark overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/60 to-background" />

        <div className="relative mx-auto max-w-6xl px-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight drop-shadow-lg sm:text-6xl">
            <span className="text-gold">Track.</span>{" "}
            <span className="text-white">Compete.</span>{" "}
            <span className="text-gold">Improve.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-200 drop-shadow">
            The cross-guild Mythic+ competitive platform for WoW. Real-time run
            tracking, multi-tenant Discord events, persistent teams, live
            leaderboards, and a scoring system we call{" "}
            <Link href="/juice" className="text-gold underline-offset-4 hover:underline">
              Juice
            </Link>
            .
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/download"
              className="inline-flex h-11 items-center rounded-md bg-gold px-8 text-sm font-semibold text-background transition-colors hover:bg-gold-dark"
            >
              Download Companion App
            </Link>
            <Link
              href="/leaderboards"
              className="inline-flex h-11 items-center rounded-md border border-border px-8 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              View Leaderboards
            </Link>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">
              Everything Mythic+ asked for
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Built by M+ players who got tired of stitching together
              spreadsheets, screenshots, and Discord scrollback to track a
              season.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-lg border border-border bg-card p-6"
              >
                <div className="text-gold">{feature.icon}</div>
                <h3 className="mt-4 text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Event types showcase */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-gold">
              Six event types, one platform
            </p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              Run the competition you actually want
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Speed runs, season-long marathons, head-to-head brackets, or
              random-draft chaos. Every type has its own scoring rules,
              auto-generated rules display, and live leaderboard.
            </p>
          </div>

          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {EVENT_TYPES.map((t) => (
              <div
                key={t.name}
                className="rounded-lg border border-border bg-card p-4"
              >
                <h3 className="font-semibold text-foreground">{t.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t.blurb}</p>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Each event auto-matches submitted runs in real time, computes
            standings, and announces results to your Discord — no manual
            scoring, no Google Forms.
          </p>
        </div>
      </section>

      {/* Audience tracks */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">
              Built for the way you play
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Whether you push solo, run with a tight five-stack, or organize
              for a community — the platform meets you where you are.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {AUDIENCES.map((a) => (
              <div
                key={a.title}
                className={`flex flex-col rounded-xl border-2 ${a.border} ${a.bg} p-6`}
              >
                <h3 className={`text-xl font-bold ${a.accent}`}>{a.title}</h3>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {a.tagline}
                </p>
                <ul className="mt-4 space-y-2">
                  {a.bullets.map((b) => (
                    <li
                      key={b}
                      className="flex gap-2 text-sm text-muted-foreground"
                    >
                      <span className={`shrink-0 ${a.accent}`}>›</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-6">
                  <Link
                    href={a.cta.href}
                    className="inline-flex h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
                  >
                    {a.cta.label} →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Juice teaser */}
      <section className="relative overflow-hidden border-t border-border py-20">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-purple-500/5" />
        <div className="relative mx-auto max-w-4xl px-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-gold">
            The scoring system
          </p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
            We don&apos;t give you a score. We give you{" "}
            <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-200 bg-clip-text text-transparent">
              Juice
            </span>
            .
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Three buckets — Personal, Event, and Team — that pour from the same
            run. Higher keys, cleaner runs, and personal records all stack.
            Soon, your dashboard will be tinted by what flavor of Juice
            you&apos;re pouring.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-2xl">
            <span title="Orange Juice — top tier">🍊</span>
            <span title="Grape Juice — A tier">🍇</span>
            <span title="Blueberry Juice — B tier">🫐</span>
            <span title="Apple Juice — starter tier">🍏</span>
          </div>
          <Link
            href="/juice"
            className="mt-8 inline-flex h-11 items-center rounded-md border border-gold/60 bg-gold/10 px-8 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
          >
            How Juice Works →
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">
            How It Works
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.step} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold text-xl font-bold text-background">
                  {step.step}
                </div>
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">
            Ready to push your keys?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
            Get started in minutes. Install the addon, fire up the companion
            app, and your first run will be tracked automatically.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/download"
              className="inline-flex h-11 items-center rounded-md bg-gold px-8 text-sm font-semibold text-background transition-colors hover:bg-gold-dark"
            >
              Get Started
            </Link>
            <Link
              href="/leaderboards"
              className="inline-flex h-11 items-center rounded-md border border-border px-8 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              View Leaderboards
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
