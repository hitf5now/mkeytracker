import type { Metadata } from "next";
import { Inter, Oswald } from "next/font/google";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { SessionProvider } from "@/components/auth/session-provider";
import { ElectricFilters } from "@/components/electric-filters";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-body" });

/**
 * Condensed face for ranks, scores and board titles. A leaderboard is a
 * scoreboard, and the compressed widths let a rank column stay narrow while
 * the number stays large. Exposed as a variable so only the surfaces that
 * want the scoreboard register opt in.
 */
const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: {
    default: "M+ Tracker — Mythic Plus Competitive Platform",
    template: "%s | M+ Tracker",
  },
  description:
    "Track your Mythic+ runs instantly, compete in cross-guild events, and climb the leaderboards.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${oswald.variable} ${inter.className}`}>
        <ElectricFilters />
        <SessionProvider>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </SessionProvider>
      </body>
    </html>
  );
}
