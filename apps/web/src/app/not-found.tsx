import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-24">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="mt-2 text-muted-foreground">Page not found.</p>
      <Link
        href="/"
        className="mt-6 rounded-md bg-gold px-6 py-2 text-sm font-semibold text-background transition-colors hover:bg-gold-dark"
      >
        Back to Home
      </Link>
    </div>
  );
}
