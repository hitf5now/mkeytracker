/**
 * NextAuth.js v5 configuration — Discord OAuth provider.
 *
 * On sign-in, calls the API's /auth/discord-login endpoint to
 * upsert the User row and get the userId. Session uses JWT strategy.
 *
 * Scopes: "identify guilds" — we need guild membership for server-scoped events.
 * The Discord access token is stored in the JWT (server-side only) for
 * making Discord API calls to fetch the user's guild list.
 */

import NextAuth, { type NextAuthResult } from "next-auth";
import Discord from "next-auth/providers/discord";

const API_BASE =
  process.env.API_INTERNAL_URL?.replace(/\/$/, "") ?? "http://localhost:3001";

const nextAuth: NextAuthResult = NextAuth({
  trustHost: true,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      authorization: { params: { scope: "identify guilds" } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      if (account?.access_token) {
        // Store Discord access token for server-side guild lookups
        token.discordAccessToken = account.access_token;

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async session({ session, token }): Promise<any> {
      return {
        ...session,
        userId: token.userId,
        discordId: token.discordId,
        displayName: token.displayName,
        avatar: token.avatar ?? null,
        // NOTE: discordAccessToken intentionally NOT included in session
        // (stays server-side only in the JWT)
      };
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
});

export const { handlers, signIn, signOut, auth } = nextAuth;
