"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface FormulaOption {
  id: string;
  name: string;
}

interface Props {
  eventType: string;
  formulas: FormulaOption[];
}

export function FeedbackForm({ eventType, formulas }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [favorite, setFavorite] = useState("");
  const [fun, setFun] = useState(3);
  const [clarity, setClarity] = useState(3);
  const [competitiveness, setCompetitiveness] = useState(3);
  const [comments, setComments] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError("");

    startTransition(async () => {
      try {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType,
            reviewerName: name.trim(),
            reviewerEmail: email.trim() || null,
            scoringPreference: favorite || null,
            scoringRanking: favorite ? [favorite] : [],
            ratings: { fun, clarity, competitiveness },
            comments: comments.trim() || null,
            website: honeypot,
          }),
        });

        if (res.ok) {
          router.push("/feedback/thanks");
        } else {
          const body = await res.json().catch(() => null);
          setError(body?.message ?? body?.error ?? "Failed to submit. Please try again.");
        }
      } catch {
        setError("Network error. Please try again.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-6">
      {/* Honeypot */}
      <div className="hidden" aria-hidden="true">
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="reviewer-name" className="block text-sm font-medium text-foreground">
            Your Name <span className="text-red-400">*</span>
          </label>
          <input
            id="reviewer-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            placeholder="Your name"
          />
        </div>
        <div>
          <label htmlFor="reviewer-email" className="block text-sm font-medium text-foreground">
            Email <span className="text-xs text-muted-foreground">(optional, for follow-up)</span>
          </label>
          <input
            id="reviewer-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            placeholder="you@example.com"
          />
        </div>
      </div>

      {/* Favorite formula */}
      <div>
        <p className="text-sm font-medium text-foreground">Which scoring formula do you prefer?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {formulas.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFavorite(f.id)}
              className={`rounded-md border px-4 py-2 text-sm transition-colors ${
                favorite === f.id
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
                  : "border-border text-muted-foreground hover:border-border/80"
              }`}
            >
              {f.id}: {f.name}
            </button>
          ))}
        </div>
      </div>

      {/* Ratings */}
      <div className="space-y-4">
        <p className="text-sm font-medium text-foreground">Rate this event type (1-5)</p>

        {[
          { label: "How fun does this format sound?", value: fun, setter: setFun },
          { label: "How clear are the rules?", value: clarity, setter: setClarity },
          { label: "How competitive does it feel?", value: competitiveness, setter: setCompetitiveness },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-4">
            <span className="w-52 text-sm text-muted-foreground">{item.label}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => item.setter(n)}
                  className={`h-8 w-8 rounded text-sm font-medium transition-colors ${
                    n <= item.value
                      ? "bg-indigo-600 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Comments */}
      <div>
        <label htmlFor="comments" className="block text-sm font-medium text-foreground">
          Comments or suggestions
        </label>
        <textarea
          id="comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          maxLength={4000}
          rows={4}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          placeholder="What would you change? What's missing? Any ideas for making this more fun?"
        />
        <p className="mt-1 text-xs text-muted-foreground">{comments.length}/4000</p>
      </div>

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {isPending ? "Submitting..." : "Submit Feedback"}
      </button>
    </form>
  );
}
