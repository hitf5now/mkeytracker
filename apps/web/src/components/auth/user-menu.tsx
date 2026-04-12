"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";

export function UserMenu() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <div className="h-8 w-20 animate-pulse rounded bg-muted" />;
  }

  if (!session) {
    return (
      <button
        type="button"
        onClick={() => signIn("discord")}
        className="rounded-md bg-[#5865F2] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#4752C4]"
      >
        Sign in
      </button>
    );
  }

  const avatar = session.avatar;
  const displayName = session.displayName;

  return (
    <div className="flex items-center gap-3">
      <Link
        href="/events/create"
        className="rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-background transition-colors hover:bg-gold-dark"
      >
        Create Event
      </Link>
      <div className="flex items-center gap-2">
        {avatar && (
          <img
            src={avatar}
            alt=""
            className="h-7 w-7 rounded-full"
          />
        )}
        <span className="text-sm text-muted-foreground">
          {displayName ?? session.user?.name}
        </span>
        <button
          type="button"
          onClick={() => signOut()}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
