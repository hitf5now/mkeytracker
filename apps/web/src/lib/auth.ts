/**
 * NextAuth.js v5 configuration — Discord OAuth provider.
 *
 * On sign-in, calls the API's /auth/discord-login endpoint to
 * upsert the User row and get the userId. Session uses JWT strategy.
 */

import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      authorization: { params: { scope: "identify" } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      // On initial sign-in, call our API to resolve/create the user
      if (account?.access_token) {
        try {
          const res = await fetch(`${API_BASE}/api/v1/auth/discord-login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: account.access_token }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              userId: number;
              discordId: string;
              displayName: string;
              avatar: string | null;
            };
            token.userId = data.userId;
            token.discordId = data.discordId;
            token.displayName = data.displayName;
            token.avatar = data.avatar;
          }
        } catch (err) {
          console.error("Failed to call /auth/discord-login:", err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) {
        (session as Record<string, unknown>).userId = token.userId;
        (session as Record<string, unknown>).discordId = token.discordId;
        (session as Record<string, unknown>).displayName = token.displayName;
        (session as Record<string, unknown>).avatar = token.avatar;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
});
