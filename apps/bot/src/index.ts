/**
 * Discord bot entry point.
 *
 * Loads env, connects to Discord gateway, dispatches interactions to
 * the command handlers registered in commands/index.ts.
 */

import { Client, Events, GatewayIntentBits, type Interaction } from "discord.js";
import { env } from "./config/env.js";
import { commands } from "./commands/index.js";
import { findHandler } from "./components/index.js";
import { startNotificationSubscriber } from "./lib/notifications.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot online as ${c.user.tag} (${c.user.id})`);
  console.log(`   Serving ${c.guilds.cache.size} guild(s)`);
  if (env.DISCORD_GUILD_ID) {
    console.log(`   Dev guild: ${env.DISCORD_GUILD_ID}`);
  }
  startNotificationSubscriber(client);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  // ── Slash commands ──────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) {
      console.warn(`Unknown command: ${interaction.commandName}`);
      return;
    }
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`Error executing /${interaction.commandName}:`, err);
      const errorMessage = "❌ An error occurred while running that command.";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
    return;
  }

  // ── Button interactions ─────────────────────────────────────
  if (interaction.isButton()) {
    const handler = findHandler(interaction.customId);
    if (!handler?.handleButton) return;
    try {
      await handler.handleButton(interaction, client);
    } catch (err) {
      console.error(`Error handling button ${interaction.customId}:`, err);
      const msg = "❌ Something went wrong. Please try again.";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    }
    return;
  }

  // ── Select menu interactions ────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    const handler = findHandler(interaction.customId);
    if (!handler?.handleSelectMenu) return;
    try {
      await handler.handleSelectMenu(interaction, client);
    } catch (err) {
      console.error(`Error handling select ${interaction.customId}:`, err);
      const msg = "❌ Something went wrong. Please try again.";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    }
    return;
  }

  // ── Modal submit interactions ───────────────────────────────
  if (interaction.isModalSubmit()) {
    const handler = findHandler(interaction.customId);
    if (!handler?.handleModal) return;
    try {
      await handler.handleModal(interaction, client);
    } catch (err) {
      console.error(`Error handling modal ${interaction.customId}:`, err);
      const msg = "❌ Something went wrong. Please try again.";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    }
    return;
  }
});

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down bot...`);
  void client.destroy().then(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void client.login(env.DISCORD_BOT_TOKEN);
