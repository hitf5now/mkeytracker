import { notFound } from "next/navigation";
import { PROPOSALS } from "@/lib/feedback-proposals";
import { FeedbackForm } from "@/components/feedback-form";
import { JuiceCalculator } from "@/components/juice-calculator";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ type: string }>;
}

export default async function EventTypeFeedbackPage({ params }: Props) {
  const { type } = await params;
  const proposal = PROPOSALS[type];

  if (!proposal) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center gap-3">
        <span className="inline-block rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-400">
          Reviewer Feedback
        </span>
        <span className="text-sm text-muted-foreground">{proposal.label}</span>
      </div>

      <h1 className="mt-4 text-3xl font-bold text-foreground">{proposal.label}</h1>

      {/* Description */}
      <section className="mt-6 space-y-3">
        {proposal.description.map((p, i) => (
          <p key={i} className="text-muted-foreground leading-relaxed">{p}</p>
        ))}
      </section>

      {/* Workflow */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold text-foreground">How It Plays Out</h2>
        <div className="mt-4 space-y-3">
          {proposal.workflow.map((step, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600/20 text-xs font-bold text-indigo-400">
                {i + 1}
              </div>
              <div>
                <p className="font-medium text-foreground">{step.phase}</p>
                <p className="text-sm text-muted-foreground">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Universal Rules */}
      <section className="mt-10 rounded-lg border border-border bg-card/50 p-6">
        <h3 className="font-semibold text-foreground">Universal Scoring Rules</h3>
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {proposal.universalRules.map((rule, i) => (
            <li key={i}>• {rule}</li>
          ))}
        </ul>
      </section>

      {/* Scoring Formulas — side by side */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold text-foreground">Scoring Proposals</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Compare these candidate formulas. Same sample run across all — apples to apples.
        </p>

        <div className="mt-6 space-y-6">
          {proposal.formulas.map((f) => (
            <div
              key={f.id}
              className="rounded-lg border border-border bg-card p-6"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    Formula {f.id}: {f.name}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{f.summary}</p>
                </div>
                {f.id === "A" && (
                  <span className="shrink-0 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                    Recommended
                  </span>
                )}
              </div>

              <div className="mt-4 rounded bg-muted/50 p-3">
                <p className="font-mono text-xs text-foreground whitespace-pre-wrap">{f.formula}</p>
              </div>

              <div className="mt-3 rounded bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Example:</p>
                <p className="mt-1 font-mono text-xs text-foreground whitespace-pre-wrap">{f.example}</p>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-green-400">Pros</p>
                  <ul className="mt-1 space-y-1">
                    {f.pros.map((p, i) => (
                      <li key={i} className="text-xs text-muted-foreground">+ {p}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-red-400">Cons</p>
                  <ul className="mt-1 space-y-1">
                    {f.cons.map((c, i) => (
                      <li key={i} className="text-xs text-muted-foreground">- {c}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Juice Calculator */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold text-foreground">Score This Run</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Adjust the inputs to see what each formula would award.
        </p>
        <JuiceCalculator eventType={type} />
      </section>

      {/* Juice Pools Explanation */}
      <section className="mt-10 rounded-lg border border-border bg-card/50 p-6">
        <h3 className="font-semibold text-foreground">Juice Pools for {proposal.label}</h3>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li><strong className="text-foreground">Personal Juice:</strong> Earned from every mythic run — event or not. Career total, global.</li>
          <li><strong className="text-foreground">Event Juice:</strong> Only earned from runs linked to this event. Determines {proposal.label} standings.</li>
          <li><strong className="text-foreground">Team Juice:</strong> Earned when all 5 party members share a team. Accumulates whether in an event or not.</li>
        </ul>
      </section>

      {/* Feedback Form */}
      <section className="mt-10 border-t border-border pt-10">
        <h2 className="text-xl font-semibold text-foreground">Your Feedback</h2>
        <FeedbackForm eventType={type} formulas={proposal.formulas.map((f) => ({ id: f.id, name: f.name }))} />
      </section>
    </div>
  );
}
