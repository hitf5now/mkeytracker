import Link from "next/link";

export default function ThanksPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <div className="text-5xl">🎉</div>
      <h1 className="mt-4 text-2xl font-bold text-foreground">Thanks for your feedback!</h1>
      <p className="mt-3 text-muted-foreground">
        Your input helps shape how these events work. We'll review all submissions
        and follow up if we have questions.
      </p>
      <Link
        href="/feedback"
        className="mt-8 inline-block rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Review another event type
      </Link>
    </div>
  );
}
