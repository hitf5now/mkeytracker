import Link from "next/link";

const EVENT_TYPES = [
  { slug: "key_climbing", label: "Key Climbing", tagline: "How high can you go?" },
  { slug: "marathon", label: "Marathon", tagline: "Endurance meets consistency" },
  { slug: "best_average", label: "Best Average", tagline: "Your top runs, averaged" },
  { slug: "bracket_tournament", label: "Bracket Tournament", tagline: "Head-to-head elimination" },
];

export default function FeedbackLandingPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="text-center">
        <span className="inline-block rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-400">
          Reviewer Feedback
        </span>
        <h1 className="mt-4 text-3xl font-bold text-foreground">
          M+ Event Types — Scoring Review
        </h1>
        <p className="mt-3 text-muted-foreground">
          We're designing the scoring system for four competitive event types.
          Review each one and tell us what you think — your feedback directly shapes what ships.
        </p>
      </div>

      <div className="mt-10 grid gap-4">
        {EVENT_TYPES.map((type) => (
          <Link
            key={type.slug}
            href={`/feedback/events/${type.slug}`}
            className="flex items-center justify-between rounded-lg border border-border bg-card p-5 transition-colors hover:border-indigo-500/50"
          >
            <div>
              <p className="text-lg font-semibold text-foreground">{type.label}</p>
              <p className="text-sm text-muted-foreground">{type.tagline}</p>
            </div>
            <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ))}
      </div>

      <div className="mt-10 rounded-lg border border-border bg-card/50 p-6">
        <h2 className="font-semibold text-foreground">How Juice Works</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Juice is our scoring currency. There are three independent pools:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li><strong className="text-foreground">Personal Juice</strong> — earned from every mythic run, event or not. Your career total.</li>
          <li><strong className="text-foreground">Event Juice</strong> — earned only from runs linked to a specific event. Determines event standings.</li>
          <li><strong className="text-foreground">Team Juice</strong> — earned when all 5 party members are on the same team. Accumulates whether in an event or not.</li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">
          A single run can earn all three simultaneously. Depleted runs earn zero base Juice — only participation and zero-death bonuses.
        </p>
      </div>
    </div>
  );
}
