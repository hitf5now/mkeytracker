"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";

export function UserMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (status === "loading") {
    return <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />;
  }

  if (!session) {
    return (
      <button
        type="button"
        onClick={() => signIn("discord", { callbackUrl: "/dashboard" })}
        className="rounded-md bg-[#5865F2] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#4752C4]"
      >
        Sign in
      </button>
    );
  }

  const avatar = session.avatar ?? null;
  const displayName = session.displayName;

  return (
    <div className="relative" ref={menuRef}>
      {/* Profile trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-accent"
      >
        {avatar ? (
          <img src={avatar} alt="" className="h-8 w-8 rounded-full" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gold text-sm font-bold text-background">
            {(displayName ?? "?")[0]}
          </div>
        )}
        <span className="hidden text-sm text-muted-foreground md:inline">
          {displayName ?? session.user?.name}
        </span>
        <svg
          className="h-3.5 w-3.5 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-48 rounded-md border border-border bg-card py-1 shadow-lg">
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
          >
            Dashboard
          </Link>
          <Link
            href="/events/create"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
          >
            Create Event
          </Link>
          <Link
            href="/account/discord"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
          >
            Discord Settings
          </Link>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut({ callbackUrl: "/" });
            }}
            className="block w-full px-4 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
