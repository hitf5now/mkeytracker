export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 animate-pulse">
      <div className="h-8 w-64 rounded bg-muted" />
      <div className="mt-2 h-4 w-32 rounded bg-muted" />

      {/* Stats grid skeleton */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-muted" />
        ))}
      </div>

      {/* Character cards skeleton */}
      <div className="mt-10 h-6 w-32 rounded bg-muted" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 rounded-lg bg-muted" />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="mt-10 h-6 w-40 rounded bg-muted" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
