import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Feedback Review",
  description: "Review event type scoring feedback from reviewers.",
};

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";
const API_SECRET = process.env.API_INTERNAL_SECRET ?? "";
const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS ?? "").split(",").filter(Boolean);

const TYPE_LABELS: Record<string, string> = {
  key_climbing: "Key Climbing",
  marathon: "Marathon",
  best_average: "Best Average",
  bracket_tournament: "Bracket Tournament",
};

interface FeedbackItem {
  id: number;
  eventType: string;
  reviewerName: string;
  reviewerEmail: string | null;
  scoringPreference: string | null;
  ratings: { fun?: number; clarity?: number; competitiveness?: number } | null;
  comments: string | null;
  createdAt: string;
}

interface SummaryData {
  count: number;
  votes: Record<string, number>;
  avgFun: number;
  avgClarity: number;
  avgCompetitiveness: number;
}

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (await auth()) as any;
  if (!session?.discordId || !ADMIN_DISCORD_IDS.includes(session.discordId)) {
    redirect("/");
  }

  const { type: filterType } = await searchParams;
  const activeType = filterType ?? "key_climbing";

  const [feedbackRes, summaryRes] = await Promise.all([
    fetch(`${API_BASE}/api/v1/admin/feedback?eventType=${activeType}`, {
      headers: { Authorization: `Bearer ${API_SECRET}` },
      next: { revalidate: 0 },
    }),
    fetch(`${API_BASE}/api/v1/admin/feedback/summary`, {
      headers: { Authorization: `Bearer ${API_SECRET}` },
      next: { revalidate: 0 },
    }),
  ]);

  const feedbackData = feedbackRes.ok
    ? ((await feedbackRes.json()) as { items: FeedbackItem[]; total: number })
    : { items: [], total: 0 };

  const summaryData = summaryRes.ok
    ? ((await summaryRes.json()) as { summary: Record<string, SummaryData> })
    : { summary: {} };

  const summary = summaryData.summary[activeType];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground">Feedback Review</h1>

      {/* Type tabs */}
      <div className="mt-6 flex gap-2 border-b border-border pb-2">
        {Object.entries(TYPE_LABELS).map(([slug, label]) => {
          const count = summaryData.summary[slug]?.count ?? 0;
          return (
            <a
              key={slug}
              href={`/admin/feedback?type=${slug}`}
              className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
                activeType === slug
                  ? "border-b-2 border-indigo-500 text-indigo-400"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label} ({count})
            </a>
          );
        })}
      </div>

      {/* Summary card */}
      {summary && summary.count > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{summary.count}</p>
            <p className="text-xs text-muted-foreground">Submissions</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{summary.avgFun.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">Avg Fun</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{summary.avgClarity.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">Avg Clarity</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{summary.avgCompetitiveness.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">Avg Competitiveness</p>
          </div>
        </div>
      )}

      {/* Vote distribution */}
      {summary && Object.keys(summary.votes).length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">Formula Votes</p>
          <div className="mt-2 flex gap-4">
            {Object.entries(summary.votes)
              .sort(([, a], [, b]) => b - a)
              .map(([formula, count]) => (
                <div key={formula} className="text-center">
                  <p className="text-lg font-bold text-foreground">{count}</p>
                  <p className="text-xs text-muted-foreground">Formula {formula}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Feedback table */}
      <div className="mt-6">
        {feedbackData.items.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            No feedback submitted for {TYPE_LABELS[activeType]} yet.
          </p>
        ) : (
          <div className="space-y-4">
            {feedbackData.items.map((item) => (
              <div key={item.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-foreground">{item.reviewerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()}
                      {item.scoringPreference && ` · Prefers Formula ${item.scoringPreference}`}
                    </p>
                  </div>
                  {item.ratings && (
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>Fun: {item.ratings.fun}/5</span>
                      <span>Clarity: {item.ratings.clarity}/5</span>
                      <span>Comp: {item.ratings.competitiveness}/5</span>
                    </div>
                  )}
                </div>
                {item.comments && (
                  <p className="mt-2 text-sm text-muted-foreground">{item.comments}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
