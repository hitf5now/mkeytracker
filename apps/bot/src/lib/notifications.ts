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
      } else if (notification.type === "event_updated" && notification.eventId) {
        await handleEventUpdated(client, notification.eventId);
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

    const isTeamMode = event.mode === "team";
    const modeLabel = isTeamMode ? "Team Signup" : "Individual Signup";

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
        { name: "Mode", value: modeLabel, inline: true },
        { name: "Dungeon", value: event.dungeon?.name ?? "Any", inline: true },
        { name: "Time", value: `<t:${startTs}:F> — <t:${endTs}:t>`, inline: false },
      );

    if (isTeamMode) {
      embed.addFields({ name: "Teams Registered", value: "_None yet_", inline: false });
      embed.setFooter({ text: `Event #${event.id} · Team mode · 0 teams` });
    } else {
      embed.addFields(
        { name: "🛡 Tanks (0)", value: "_None yet_", inline: false },
        { name: "💚 Healers (0)", value: "_None yet_", inline: false },
        { name: "⚔ DPS (0)", value: "_None yet_", inline: false },
      );
      embed.setFooter({ text: `Event #${event.id} · 0 confirmed` });
    }

    const buttons = isTeamMode
      ? new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`team-signup:${event.id}`)
            .setLabel("Sign Up Team")
            .setStyle(ButtonStyle.Success),
        )
      : new ActionRowBuilder<ButtonBuilder>().addComponents(
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

async function handleEventUpdated(client: Client, eventId: number): Promise<void> {
  try {
    const { event } = await apiClient.getEvent(eventId);

    if (!event.discordMessageId || !event.discordChannelId) {
      console.log(`Event #${eventId} has no Discord message to update`);
      return;
    }

    const startTs = Math.floor(new Date(event.startsAt).getTime() / 1000);
    const endTs = Math.floor(new Date(event.endsAt).getTime() / 1000);

    const statusLabels: Record<string, string> = {
      open: "Signups Open",
      signups_closed: "Group Assignments",
      in_progress: "Active Event",
      completed: "Completed",
      cancelled: "Cancelled",
    };

    const isTeamMode = event.mode === "team";
    const modeLabel = isTeamMode ? "Team Signup" : "Individual Signup";

    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${event.name}`)
      .setColor(event.status === "open" ? 0x3ba55d : event.status === "in_progress" ? 0xffcc00 : 0x888888)
      .setDescription(event.description || "_No description_")
      .addFields(
        { name: "Dungeon", value: event.dungeon?.name ?? "Any", inline: true },
        { name: "Key Range", value: `+${event.minKeyLevel} – +${event.maxKeyLevel}`, inline: true },
        { name: "Status", value: statusLabels[event.status] ?? event.status, inline: true },
        { name: "Mode", value: modeLabel, inline: true },
        { name: "Time", value: `<t:${startTs}:F> — <t:${endTs}:t>`, inline: false },
      );

    if (isTeamMode) {
      // Show registered teams
      const teamSignups = event.teamSignups || [];
      const registered = teamSignups.filter((ts: { status: string }) => ts.status === "registered");
      if (registered.length > 0) {
        const teamList = registered.map((ts: { team: { name: string; members?: Array<{ role: string; character: { name: string } }> } }, i: number) => {
          const members = (ts.team.members || [])
            .map((m: { role: string; character: { name: string } }) => {
              const icon = m.role === "tank" ? "🛡" : m.role === "healer" ? "💚" : "⚔";
              return `${icon} ${m.character.name}`;
            })
            .join(", ");
          return `${i + 1}. **${ts.team.name}** — ${members}`;
        }).join("\n");
        embed.addFields({ name: `Teams Registered (${registered.length})`, value: teamList, inline: false });
      } else {
        embed.addFields({ name: "Teams Registered", value: "_None yet_", inline: false });
      }
      embed.setFooter({ text: `Event #${event.id} · Team mode · ${registered.length} team(s)` });
    } else {
      // Show individual signups by role
      const signups = event.signups || [];
      const confirmed = signups.filter((s: { signupStatus: string }) => s.signupStatus === "confirmed");
      const tentative = signups.filter((s: { signupStatus: string }) => s.signupStatus === "tentative");
      const tanks = confirmed.filter((s: { rolePreference: string }) => s.rolePreference === "tank");
      const healers = confirmed.filter((s: { rolePreference: string }) => s.rolePreference === "healer");
      const dps = confirmed.filter((s: { rolePreference: string }) => s.rolePreference === "dps");

      const formatMember = (s: { discordUserId: string | null; character: { name: string; hasCompanionApp: boolean } }, i: number): string => {
        const mention = s.discordUserId ? `<@${s.discordUserId}>` : s.character.name;
        const tag = s.character.hasCompanionApp ? " ⚡" : "";
        return `${i + 1}. ${mention} — ${s.character.name}${tag}`;
      };

      embed.addFields(
        { name: `🛡 Tanks (${tanks.length})`, value: tanks.length > 0 ? tanks.map(formatMember).join("\n") : "_None yet_", inline: false },
        { name: `💚 Healers (${healers.length})`, value: healers.length > 0 ? healers.map(formatMember).join("\n") : "_None yet_", inline: false },
        { name: `⚔ DPS (${dps.length})`, value: dps.length > 0 ? dps.map(formatMember).join("\n") : "_None yet_", inline: false },
      );

      if (tentative.length > 0) {
        embed.addFields({
          name: `❓ Tentative (${tentative.length})`,
          value: tentative.map(formatMember).join("\n"),
          inline: false,
        });
      }

      embed.setFooter({ text: `Event #${event.id} · ${confirmed.length} confirmed` });
    }

    const buttons = isTeamMode
      ? new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`team-signup:${event.id}`)
            .setLabel("Sign Up Team")
            .setStyle(ButtonStyle.Success),
        )
      : new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`event-signup:${event.id}`)
            .setLabel("Sign Up")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`event-tentative:${event.id}`)
            .setLabel("Tentative")
            .setStyle(ButtonStyle.Secondary),
        );

    const channel = await client.channels.fetch(event.discordChannelId) as TextChannel | null;
    if (!channel) return;

    const message = await channel.messages.fetch(event.discordMessageId);
    await message.edit({ embeds: [embed], components: [buttons] });

    console.log(`Updated Discord embed for event #${eventId}`);
  } catch (err) {
    console.error(`Failed to update event #${eventId} embed:`, err);
  }
}
