import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    userId?: number;
    discordId?: string;
    displayName?: string;
    avatar?: string | null;
  }
}
