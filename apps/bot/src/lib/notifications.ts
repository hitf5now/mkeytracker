/**
 * Redis pub/sub subscriber for API→bot notifications.
 *
 * Listens on the "mplus:bot-notifications" channel for events like
 * event creation (from the website) and posts Discord embeds.
 */

import { Redis } from "ioredis";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type TextChannel,
} from "discord.js";
import { env } from "../config/env.js";
import { apiClient } from "./api-client.js";

const CHANNEL = "mplus:bot-notifications";

interface BotNotification {
  type: string;
  eventId?: number;
}

export function startNotificationSubscriber(client: Client): void {
  if (!env.DISCORD_EVENTS_CHANNEL_ID) {
    console.log("⚠️  DISCORD_EVENTS_CHANNEL_ID not set — skipping Redis notification subscriber");
    return;
  }

  const subscriber = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // required for subscriber mode
    lazyConnect: false,
  });

  subscriber.subscribe(CHANNEL, (err) => {
    if (err) {
      console.error("Failed to subscribe to Redis notifications:", err);
      return;
    }
    console.log(`📡 Subscribed to Redis channel: ${CHANNEL}`);
  });

  subscriber.on("message", async (_channel: string, message: string) => {
    try {
      const notification = JSON.parse(message) as BotNotification;

      if (notification.type === "event_created" && notification.eventId) {
        await handleEventCreated(client, notification.eventId);
      }
    } catch (err) {
      console.error("Error handling Redis notification:", err);
    }
  });

  subscriber.on("error", (err) => {
    console.error("Redis subscriber error:", err);
  });
}

async function handleEventCreated(client: Client, eventId: number): Promise<void> {
  try {
    const { event } = await apiClient.getEvent(eventId);

    // Resolve the channel: per-guild config first, fallback to env var
    let channelId: string | null = null;
    const guildId = event.discordGuildId;
    if (guildId) {
      const { config } = await apiClient.getGuildConfig(guildId);
      channelId = config?.eventsChannelId ?? null;
    }
    if (!channelId) {
      channelId = env.DISCORD_EVENTS_CHANNEL_ID || null;
    }
    if (!channelId) {
      console.log(`No events channel configured for event #${eventId} — skipping embed post`);
      return;
    }

    const startTs = Math.floor(new Date(event.startsAt).getTime() / 1000);
    const endTs = Math.floor(new Date(event.endsAt).getTime() / 1000);

    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${event.name}`)
      .setColor(0x3ba55d)
      .setDescription(event.description || "_No description_")
      .addFields(
        { name: "Type", value: event.type.replace(/_/g, " "), inline: true },
        {
          name: "Key Range",
          value: `+${event.minKeyLevel} – +${event.maxKeyLevel}`,
          inline: true,
        },
        { name: "Status", value: "Open", inline: true },
        { name: "Dungeon", value: event.dungeon?.name ?? "Any", inline: true },
        { name: "Time", value: `<t:${startTs}:F> — <t:${endTs}:t>`, inline: false },
        { name: "🛡 Tanks (0)", value: "_None yet_", inline: false },
        { name: "💚 Healers (0)", value: "_None yet_", inline: false },
        { name: "⚔ DPS (0)", value: "_None yet_", inline: false },
      )
      .setFooter({ text: `Event #${event.id} · 0 confirmed` });

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`event-signup:${event.id}`)
        .setLabel("Sign Up")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`event-tentative:${event.id}`)
        .setLabel("Tentative")
        .setStyle(ButtonStyle.Secondary),
    );

    const channel = await client.channels.fetch(channelId) as TextChannel | null;
    if (!channel) {
      console.error(`Events channel ${channelId} not found`);
      return;
    }

    const message = await channel.send({
      content: "🆕 A new event has been created! Click a button to sign up.",
      embeds: [embed],
      components: [buttons],
    });

    // Store the message/channel IDs so the embed can be updated on signups
    await apiClient.storeDiscordMessage(event.id, message.id, channelId);

    console.log(`Posted event #${event.id} embed to channel ${channelId}`);
  } catch (err) {
    console.error(`Failed to post event #${eventId} embed:`, err);
  }
}
