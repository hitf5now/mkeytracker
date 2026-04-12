"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-24">
      <h1 className="text-4xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-muted-foreground">
        An error occurred loading this page.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md bg-gold px-6 py-2 text-sm font-semibold text-background transition-colors hover:bg-gold-dark"
      >
        Try Again
      </button>
    </div>
  );
}
