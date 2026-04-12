/**
 * Bot-side env loader. Mirrors the API pattern — one place reads
 * process.env, everything else consumes the typed `env` object.
 */

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/, "DISCORD_CLIENT_ID must be a snowflake"),
  /**
   * When set, slash commands register to this guild only (instant in dev).
   * When empty, commands register globally (up to 1 hour propagation).
   */
  DISCORD_GUILD_ID: z
    .string()
    .regex(/^\d{17,20}$/, "DISCORD_GUILD_ID must be a snowflake")
    .optional()
    .or(z.literal("")),

  API_BASE_URL: z.string().url().default("http://localhost:3001"),
  API_INTERNAL_SECRET: z.string().min(16),

  /** Redis URL for pub/sub notifications from the API */
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  /** Discord channel ID where event embeds are posted */
  DISCORD_EVENTS_CHANNEL_ID: z.string().regex(/^\d{17,20}$/).optional().or(z.literal("")),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid bot environment configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
