/**
 * Discord bot entry point.
 *
 * Loads env, connects to Discord gateway, dispatches interactions to
 * the command handlers registered in commands/index.ts.
 */

import { Client, EmbedBuilder, Events, GatewayIntentBits, type Interaction, type TextChannel } from "discord.js";
import { Redis } from "ioredis";
import { env } from "./config/env.js";
import { commands } from "./commands/index.js";
import { findHandler } from "./components/index.js";
import { startNotificationSubscriber } from "./lib/notifications.js";
import { apiClient } from "./lib/api-client.js";

const redisClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });

/** Write the bot's guild list to Redis for the web app's guild intersection. */
async function syncGuildCache(client: Client): Promise<void> {
  const guilds = client.guilds.cache.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.iconURL({ size: 64 }),
  }));
  await redisClient.set("bot:guilds", JSON.stringify(guilds));
  console.log(`   Synced ${guilds.length} guild(s) to Redis cache`);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot online as ${c.user.tag} (${c.user.id})`);
  console.log(`   Serving ${c.guilds.cache.size} guild(s)`);
  if (env.DISCORD_GUILD_ID) {
    console.log(`   Dev guild: ${env.DISCORD_GUILD_ID}`);
  }
  void syncGuildCache(client);
  startNotificationSubscriber(client);
});

const WEB_BASE = "https://mythicplustracker.com";

// Multi-tenant: register/unregister servers + sync cache
client.on(Events.GuildCreate, (guild) => {
  console.log(`📥 Joined guild: ${guild.name} (${guild.id})`);
  void syncGuildCache(client);
  void apiClient.initServer(guild.id, {
    guildName: guild.name,
    guildIconUrl: guild.iconURL({ size: 128 }),
    installedByDiscordId: guild.ownerId,
  }).catch((err: unknown) => console.error(`Failed to init server ${guild.id}:`, err));

  void sendWelcomeMessage(guild);
});

async function sendWelcomeMessage(guild: import("discord.js").Guild): Promise<void> {
  try {
    const dashboardUrl = `${WEB_BASE}/servers/${guild.id}`;

    const embed = new EmbedBuilder()
      .setTitle("M+ Tracker — Setup Guide")
      .setColor(0x3ba55d)
      .setDescription(
        `Thanks for adding **M+ Tracker** to **${guild.name}**! Let's get your server configured.`,
      )
      .addFields(
        {
          name: "Step 1 — Set your Events channel",
          value: "Run `/setup events-channel #your-channel` to choose where event signup embeds appear.",
          inline: false,
        },
        {
          name: "Step 2 — Set your Results channel",
          value: "Run `/setup results-channel #your-channel` to choose where run completion results are posted.",
          inline: false,
        },
        {
          name: "Step 3 — Create your first event",
          value: `Head to the [website](${WEB_BASE}/events/create) to create an M+ event. The bot will post a signup embed in your events channel.`,
          inline: false,
        },
        {
          name: "Web Dashboard",
          value: `[Configure your server on the web](${dashboardUrl}) — manage channels, view admins, and more.`,
          inline: false,
        },
      )
      .setFooter({ text: "Need help? Run /setup show to see your current configuration." });

    // Try posting to the system channel first, fall back to the first text channel
    const targetChannel = guild.systemChannel
      ?? guild.channels.cache.find(
        (c): c is TextChannel => c.isTextBased() && !c.isVoiceBased() && !c.isThread(),
      ) as TextChannel | undefined;

    if (targetChannel) {
      await targetChannel.send({ embeds: [embed] });
      console.log(`Posted welcome embed to #${targetChannel.name} in ${guild.name}`);
    } else {
      console.log(`No suitable channel found for welcome message in ${guild.name}`);
    }
  } catch (err) {
    console.error(`Failed to send welcome message to ${guild.name}:`, err);
  }
}

client.on(Events.GuildDelete, (guild) => {
  console.log(`📤 Left guild: ${guild.name ?? guild.id}`);
  void syncGuildCache(client);
  void apiClient.uninstallServer(guild.id)
    .catch((err: unknown) => console.error(`Failed to uninstall server ${guild.id}:`, err));
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
