"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { NavLink } from "./nav-link";
import { UserMenu } from "@/components/auth/user-menu";
import { cn } from "@/lib/utils";

const PUBLIC_NAV = [
  { href: "/leaderboards", label: "Leaderboards" },
  { href: "/download", label: "Download" },
];

const AUTH_NAV = [
  { href: "/events", label: "Events" },
  { href: "/teams", label: "Teams" },
];

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: session } = useSession();
  const navItems = session ? [...PUBLIC_NAV, ...AUTH_NAV] : PUBLIC_NAV;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-lg font-bold text-gold">M+ Tracker</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 md:flex">
          {navItems.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.label}
            </NavLink>
          ))}
          <UserMenu />
        </nav>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:text-foreground md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            {mobileOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      <nav
        className={cn(
          "border-b border-border md:hidden",
          mobileOpen ? "block" : "hidden",
        )}
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
          <div className="pt-2">
            <UserMenu />
          </div>
        </div>
      </nav>
    </header>
  );
}
