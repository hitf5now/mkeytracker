/**
 * Slash command deployment script.
 *
 * Registers all slash commands with Discord. Run this once after
 * scaffolding, and any time you add, remove, or change a command
 * definition (name, description, options).
 *
 * Behavior:
 *   - If DISCORD_GUILD_ID is set, commands register to that guild only
 *     (instant — use for development).
 *   - If DISCORD_GUILD_ID is empty, commands register globally
 *     (can take up to 1 hour to propagate — use for production).
 *
 * Usage:
 *   npm run deploy-commands --workspace=@mplus/bot
 */

import { REST, Routes } from "discord.js";
import { env } from "./config/env.js";
import { allCommands } from "./commands/index.js";

async function main(): Promise<void> {
  const payload = allCommands().map((c) => c.data.toJSON());

  const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);

  const target = env.DISCORD_GUILD_ID
    ? `guild ${env.DISCORD_GUILD_ID}`
    : "GLOBAL (up to 1 hour propagation)";

  console.log(`→ Deploying ${payload.length} slash command(s) to ${target}`);

  try {
    const route = env.DISCORD_GUILD_ID
      ? Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID)
      : Routes.applicationCommands(env.DISCORD_CLIENT_ID);

    const data = (await rest.put(route, { body: payload })) as unknown[];
    console.log(`✅ Successfully deployed ${data.length} command(s).`);
  } catch (err) {
    console.error("❌ Failed to deploy commands:", err);
    process.exit(1);
  }
}

void main();
