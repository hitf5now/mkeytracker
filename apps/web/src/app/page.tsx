import Link from "next/link";

const FEATURES = [
  {
    title: "Instant Run Tracking",
    description:
      "Runs are captured the moment you finish a key. No waiting for RaiderIO — your score updates in seconds, not hours.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
  {
    title: "Cross-Guild Events",
    description:
      "Create competitions, sign up with your character, and get automatically matched into balanced groups. Race against rivals.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
  },
  {
    title: "Leaderboards",
    description:
      "Compete across multiple categories — season Juice, highest key, most timed runs, and fastest clears per dungeon.",
    icon: (
      <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-4.52 0" />
      </svg>
    ),
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
      "Join events via Discord, track your stats, and compete on the leaderboards.",
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
            The cross-guild Mythic+ competitive platform for WoW. Instant run
            tracking, automated matchmaking, and leaderboards that reward more
            than just raw score.
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

      {/* Features */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">
            Built for M+ Players
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-lg border border-border bg-card p-6"
              >
                <div className="text-gold">{feature.icon}</div>
                <h3 className="mt-4 text-lg font-semibold">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">
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
          <Link
            href="/download"
            className="mt-8 inline-flex h-11 items-center rounded-md bg-gold px-8 text-sm font-semibold text-background transition-colors hover:bg-gold-dark"
          >
            Get Started
          </Link>
        </div>
      </section>
    </>
  );
}
