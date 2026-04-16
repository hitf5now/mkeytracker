/**
 * Strongly-typed environment loader.
 *
 * Validates required env vars at startup — the server refuses to boot
 * if anything is missing or malformed. This is the only place process.env
 * should be read; the rest of the app imports the typed `env` object.
 */

import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  API_INTERNAL_SECRET: z.string().min(16, "API_INTERNAL_SECRET must be at least 16 characters"),

  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),

  FEEDBACK_TOKENS: z.string().optional().default(""),

  RAIDERIO_BASE_URL: z.string().url().default("https://raider.io/api/v1"),

  // Blizzard Battle.net API (optional — for character portraits)
  BLIZZARD_CLIENT_ID: z.string().optional().or(z.literal("")).default(""),
  BLIZZARD_CLIENT_SECRET: z.string().optional().or(z.literal("")).default(""),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
