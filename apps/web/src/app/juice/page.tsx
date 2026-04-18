import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Juice — How Scoring Works",
  description:
    "Juice is how the M+ Tracker measures performance. Learn how Personal, Event, and Team Juice are earned — and what flavor your runs are pouring.",
};

// ── Real Personal Juice formula (mirrors apps/api/src/services/scoring.ts) ──

const TIME_MODIFIERS = [
  { label: "Depleted", flavor: "Spoiled Pulp", multiplier: "× 0.5", hint: "Better than nothing — we still pour you a sip." },
  { label: "Timed", flavor: "Fresh Squeeze", multiplier: "× 1.0", hint: "On the clock. Standard pour." },
  { label: "Timed +1", flavor: "Cold Press", multiplier: "× 1.2", hint: "A little extra zest." },
  { label: "Timed +2", flavor: "Double Strength", multiplier: "× 1.35", hint: "Now we're cooking." },
  { label: "Timed +3", flavor: "Concentrate", multiplier: "× 1.5", hint: "Pure, unfiltered, undiluted." },
];

const BONUSES = [
  { name: "Zero Deaths", value: "+150", flavor: "Pulp-Free Bonus", hint: "Nobody hit the floor. Smooth pour." },
  { name: "Personal Dungeon Record", value: "+200", flavor: "Signature Recipe", hint: "New PB on this dungeon." },
  { name: "Personal Overall Record", value: "+500", flavor: "Master Blender", hint: "Highest-scored run you've ever pulled." },
  { name: "Event Participation", value: "+100", flavor: "Tournament Pour", hint: "Showed up to compete — earned the entry." },
];

// ── Forward-looking tier ladder (preview, thresholds TBD) ──

const TIERS = [
  {
    name: "Orange Juice",
    rank: "S Tier",
    color: "from-orange-500 to-amber-500",
    border: "border-orange-500/60",
    text: "text-orange-400",
    bg: "bg-orange-500/10",
    emoji: "🍊",
    blurb: "The top shelf. Reserved for the players squeezing every drop out of every key. Vitamin-C-rich and unforgiving.",
  },
  {
    name: "Grape Juice",
    rank: "A Tier",
    color: "from-purple-500 to-fuchsia-500",
    border: "border-purple-500/60",
    text: "text-purple-400",
    bg: "bg-purple-500/10",
    emoji: "🍇",
    blurb: "Premium. Bottle-aged. The vintage you serve when guests are watching.",
  },
  {
    name: "Blueberry Juice",
    rank: "B Tier",
    color: "from-blue-500 to-cyan-500",
    border: "border-blue-500/60",
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    emoji: "🫐",
    blurb: "Antioxidant-loaded. Reliable. The juice you pour when you mean business but aren't trying to flex.",
  },
  {
    name: "Apple Juice",
    rank: "Starter Tier",
    color: "from-green-500 to-emerald-500",
    border: "border-green-500/60",
    text: "text-green-400",
    bg: "bg-green-500/10",
    emoji: "🍏",
    blurb: "Crisp, classic, and where everyone starts. No shame in apple juice — most of us still drink it daily.",
  },
];

const BUCKETS = [
  {
    name: "Personal Juice",
    icon: "🥤",
    accent: "text-gold",
    border: "border-gold/40",
    bg: "bg-gold/5",
    description:
      "The juice you squeeze from every key you push, solo or pugged. Earned every single run — timed, depleted, in‑event, or freelance. This is your bread and butter (or, well, your apple and orange).",
    earnedWhen: "Always. Every run, every time.",
  },
  {
    name: "Event Juice",
    icon: "🏆",
    accent: "text-purple-300",
    border: "border-purple-400/40",
    bg: "bg-purple-500/5",
    description:
      "Tournament reward. Earned only when your run gets matched to an active event you signed up for. Stacks on top of Personal Juice — the same run can pour into both glasses at once.",
    earnedWhen: "Only during organized events you've joined.",
  },
  {
    name: "Team Juice",
    icon: "👥",
    accent: "text-blue-300",
    border: "border-blue-400/40",
    bg: "bg-blue-500/5",
    description:
      "Five-stack synergy bonus. Pours when all five players in your run share the same Team. Rewards consistent rosters — the people who show up together, juice together.",
    earnedWhen: "When the entire group belongs to the same Team.",
  },
];

export default function JuicePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border py-20 sm:py-28">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-gold/10 via-transparent to-purple-500/10" />
        <div className="relative mx-auto max-w-4xl px-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-gold">
            Scoring, but tastier
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-6xl">
            What is{" "}
            <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-200 bg-clip-text text-transparent">
              Juice
            </span>
            ?
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Other sites give you a <em>score</em>. We give you{" "}
            <span className="font-semibold text-foreground">Juice</span> — a
            single delicious number that captures how hard you squeezed a run
            for everything it was worth. Push the key. Time it. Don&apos;t die.
            We&apos;ll measure the pulp.
          </p>
        </div>
      </section>

      {/* The Three Buckets */}
      <section className="border-b border-border py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">Three Glasses</h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Every run pours into one or more buckets. They don&apos;t replace
              each other — they stack. A single great run can fill all three
              glasses at once.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {BUCKETS.map((b) => (
              <div
                key={b.name}
                className={`flex flex-col rounded-xl border-2 ${b.border} ${b.bg} p-6`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-4xl" aria-hidden>
                    {b.icon}
                  </span>
                  <h3 className={`text-xl font-bold ${b.accent}`}>{b.name}</h3>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  {b.description}
                </p>
                <p className="mt-auto pt-4 text-xs uppercase tracking-wide text-foreground/80">
                  <span className="text-muted-foreground">Earned:</span>{" "}
                  {b.earnedWhen}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Tier Ladder — forward-looking */}
      <section className="border-b border-border py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-gold">
              Coming soon — calibrating thresholds
            </p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              The Juice Ladder
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              Player profiles will eventually be tinted by the flavor of juice
              you&apos;re pouring. Four ranks. Four flavors. One question:{" "}
              <span className="text-foreground">what&apos;s in your glass?</span>
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((t, i) => (
              <div
                key={t.name}
                className={`relative overflow-hidden rounded-xl border-2 ${t.border} ${t.bg} p-5`}
              >
                <div
                  className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.color}`}
                />
                <div className="flex items-center justify-between">
                  <span className="text-3xl" aria-hidden>
                    {t.emoji}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    #{i + 1} · {t.rank}
                  </span>
                </div>
                <h3 className={`mt-3 text-xl font-bold ${t.text}`}>{t.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{t.blurb}</p>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">
            Exact season-Juice cutoffs are still being calibrated. Once
            rankings settle, your dashboard&apos;s color tells the whole story
            at a glance.
          </p>
        </div>
      </section>

      {/* How Personal Juice is earned */}
      <section className="border-b border-border py-20">
        <div className="mx-auto max-w-4xl px-4">
          <div className="text-center">
            <h2 className="text-3xl font-bold sm:text-4xl">
              How Personal Juice Gets Squeezed
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
              The recipe is simple, the flavor is in the bonuses. Same formula
              applies to every run, every dungeon, every key level.
            </p>
          </div>

          {/* The base */}
          <div className="mt-10 rounded-xl border border-gold/40 bg-gold/5 p-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-gold">
              The Base Pour
            </p>
            <p className="mt-2 font-mono text-2xl text-foreground">
              keystone level <span className="text-gold">×</span> 100
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              That&apos;s the raw juice. A +15 starts the press at{" "}
              <span className="font-mono text-foreground">1,500</span>. A +20
              starts at <span className="font-mono text-foreground">2,000</span>.
              Higher key, more pulp.
            </p>
          </div>

          {/* Time modifier */}
          <div className="mt-8">
            <h3 className="text-xl font-semibold">
              Then: the Time Modifier{" "}
              <span className="text-sm font-normal text-muted-foreground">
                (multiplies the base)
              </span>
            </h3>
            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-background/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Result</th>
                    <th className="px-4 py-2 text-left font-medium">Flavor</th>
                    <th className="px-4 py-2 text-right font-medium">Multiplier</th>
                  </tr>
                </thead>
                <tbody>
                  {TIME_MODIFIERS.map((m, i) => (
                    <tr
                      key={m.label}
                      className={i > 0 ? "border-t border-border/40" : ""}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">
                        {m.label}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="text-gold">{m.flavor}</span>
                        <span className="ml-2 text-xs text-muted-foreground/70">
                          — {m.hint}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-foreground">
                        {m.multiplier}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bonuses */}
          <div className="mt-8">
            <h3 className="text-xl font-semibold">
              Then: stack the Bonuses{" "}
              <span className="text-sm font-normal text-muted-foreground">
                (added flat, after the multiplier)
              </span>
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {BONUSES.map((b) => (
                <div
                  key={b.name}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-semibold text-foreground">{b.name}</p>
                    <p className="font-mono text-lg text-gold">{b.value}</p>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-wide text-purple-300/80">
                    {b.flavor}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{b.hint}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Worked example */}
          <div className="mt-10 rounded-xl border-2 border-orange-500/40 bg-gradient-to-br from-orange-500/10 to-amber-500/5 p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-orange-400">
              Worked Example
            </p>
            <p className="mt-2 text-lg font-semibold">
              A +18 timed with{" "}
              <span className="text-gold">2 upgrades</span> and{" "}
              <span className="text-gold">zero deaths</span>:
            </p>
            <div className="mt-4 space-y-1 font-mono text-sm">
              <p className="text-muted-foreground">
                Base ……………………… 18 × 100 ={" "}
                <span className="text-foreground">1,800</span>
              </p>
              <p className="text-muted-foreground">
                × Double Strength …… 1,800 × 1.35 ={" "}
                <span className="text-foreground">2,430</span>
              </p>
              <p className="text-muted-foreground">
                + Pulp-Free Bonus ……{" "}
                <span className="text-foreground">+150</span>
              </p>
              <p className="border-t border-border/60 pt-2 text-base">
                <span className="text-foreground">= </span>
                <span className="text-2xl font-bold text-orange-400">
                  2,580 Personal Juice
                </span>
              </p>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Add a Personal Dungeon Record on top? +200. Personal Overall
              Record? +500. Event participation? +100. The bonuses don&apos;t
              compete — they pile up.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-b border-border py-20">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">
            Common Pours
          </h2>
          <div className="mt-10 space-y-4">
            {FAQ.map((q) => (
              <details
                key={q.q}
                className="group rounded-lg border border-border bg-card"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
                  <span className="font-semibold text-foreground">{q.q}</span>
                  <span className="text-xs text-muted-foreground transition group-open:rotate-180">
                    ▾
                  </span>
                </summary>
                <p className="border-t border-border/40 px-5 py-4 text-sm text-muted-foreground">
                  {q.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">
            Ready to start pouring?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
            Install the addon, fire up the companion app, and your next run
            starts the press. No setup, no spreadsheets, no waiting on
            third-party rescores.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
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
              See Who&apos;s Pouring
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

const FAQ = [
  {
    q: "Why call it Juice instead of Score?",
    a: "Because score is what your math teacher gave you. Juice is what you pour after a sweaty 17. We wanted a name that doesn't take itself too seriously and reminds you that this is, ultimately, a video game.",
  },
  {
    q: "Why three buckets instead of one?",
    a: "Different vibes deserve different glasses. Personal Juice rewards your individual grind, no matter the context. Event Juice celebrates organized competition. Team Juice rewards the players who consistently roll with the same crew. Mixing them into one number would lose the story.",
  },
  {
    q: "Does Juice carry between seasons?",
    a: "Each WoW season is a fresh batch. Personal records, leaderboards, and tier placement reset so the new season is a clean glass for everyone. Your historical runs stick around in your dashboard — the press never deletes.",
  },
  {
    q: "What about depleted runs? Do they count?",
    a: "Yes — depleted runs still pour Juice, just at half the multiplier. We don't want to discourage pushing keys above your comfort zone. A failed +20 still teaches more than a clean +15.",
  },
  {
    q: "When do the colored Juice tiers go live?",
    a: "Soon. Thresholds are still being calibrated against the season's actual leaderboard distribution — we'd rather wait than slap arbitrary numbers on it. Until then, your dashboard shows raw Juice totals.",
  },
];
