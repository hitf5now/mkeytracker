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
  void backfillDiscordServers(c);
  startNotificationSubscriber(client);
});

// Reconciles `discord_servers` rows against the bot's live guild list.
// GuildCreate only fires for new joins, so guilds the bot has been in since
// before the row was missing (DB wipe, manual delete, pre-multitenant version)
// would otherwise stay un-rowed. Idempotent: initServer is upsert.
async function backfillDiscordServers(c: Client<true>): Promise<void> {
  const guilds = [...c.guilds.cache.values()];
  if (guilds.length === 0) return;
  console.log(`   Reconciling ${guilds.length} guild(s) into discord_servers...`);
  let ok = 0;
  let failed = 0;
  await Promise.all(
    guilds.map(async (guild) => {
      try {
        await apiClient.initServer(guild.id, {
          guildName: guild.name,
          guildIconUrl: guild.iconURL({ size: 128 }),
          installedByDiscordId: guild.ownerId,
        });
        ok++;
      } catch (err) {
        failed++;
        console.error(`   Backfill failed for ${guild.id} (${guild.name}):`, err);
      }
    }),
  );
  console.log(`   Backfill complete: ${ok} ok, ${failed} failed`);
}

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
        `Thanks for adding **M+ Tracker** to **${guild.name}**! Complete setup on the website to start running events.`,
      )
      .addFields(
        {
          name: "Step 1 — Configure your channels",
          value: `Open your [server dashboard](${dashboardUrl}) and select which channels the bot should use for events and run results.`,
          inline: false,
        },
        {
          name: "Step 2 — Create your first event",
          value: `[Create an event](${WEB_BASE}/events/create) on the website. The bot will post a signup embed in your configured events channel.`,
          inline: false,
        },
        {
          name: "Step 3 — Invite your members",
          value: "Members can sign up for events directly from the Discord embed buttons, or from the website.",
          inline: false,
        },
      )
      .setFooter({ text: `Server dashboard: ${dashboardUrl}` });

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

/**
 * Best-effort error reply. Wrapped in its own try/catch because the
 * interaction's token may already be expired (Discord 10062), in which
 * case any reply attempt will throw — and an unhandled throw inside an
 * async event listener crashes the process.
 *
 * Worst case: the user sees Discord's generic "interaction failed"
 * toast instead of our friendlier message. Acceptable; a crash is not.
 */
async function safeErrorReply(
  interaction:
    | import("discord.js").ChatInputCommandInteraction
    | import("discord.js").ButtonInteraction
    | import("discord.js").StringSelectMenuInteraction
    | import("discord.js").ModalSubmitInteraction,
  msg: string,
): Promise<void> {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  } catch (err) {
    console.error("Failed to deliver error reply (token likely expired):", err);
  }
}

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
      await safeErrorReply(interaction, "❌ An error occurred while running that command.");
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
      await safeErrorReply(interaction, "❌ Something went wrong. Please try again.");
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
      await safeErrorReply(interaction, "❌ Something went wrong. Please try again.");
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
      await safeErrorReply(interaction, "❌ Something went wrong. Please try again.");
    }
    return;
  }
});

// Last-resort safety net: any unhandled rejection from a misbehaving
// listener path should be logged, not silently take down the whole
// process. Interaction tokens regenerate; crashes lose every in-flight
// session.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (kept process alive):", reason);
});

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down bot...`);
  void client.destroy().then(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void client.login(env.DISCORD_BOT_TOKEN);
