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

/** Short rules summary for Discord embeds, keyed by event type slug. */
const TYPE_SUMMARIES: Record<string, string> = {
  fastest_clear_race: "Fastest timed clear wins. Depleted runs don't count.",
  speed_sprint: "Single attempt per group/team. Best score wins.",
  random_draft: "Random groups compete on combined total score.",
  key_climbing: "Push the highest key you can. Peak level wins.",
  marathon: "Complete as many keys as possible. Total score wins.",
  best_average: "Best average across your top runs. Consistency wins.",
  bracket_tournament: "Single-elimination bracket. Better score advances.",
};

const CHANNEL = "mplus:bot-notifications";

interface GroupMember {
  characterName: string;
  realm: string;
  role: "tank" | "healer" | "dps";
}

interface AssignedGroupPayload {
  name: string;
  members: GroupMember[];
}

interface BotNotification {
  type: string;
  eventId?: number;
  runId?: number;
  dungeonName?: string;
  keystoneLevel?: number;
  onTime?: boolean;
  upgrades?: number;
  completionMs?: number;
  parMs?: number;
  deaths?: number;
  juice?: number;
  members?: Array<{ name: string; realm: string; class: string; role: string }>;
  // groups_assigned payload
  groups?: AssignedGroupPayload[];
  benched?: GroupMember[];
  stats?: {
    totalSignups: number;
    groupsFormed: number;
    benchedCount: number;
    limitingRole: string;
    groupsWithoutCompanion: number;
  };
}

export function startNotificationSubscriber(client: Client): void {
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
      } else if (notification.type === "groups_assigned" && notification.eventId) {
        await handleGroupsAssigned(client, notification);
      } else if (notification.type === "run_completed" && notification.runId) {
        await handleRunCompleted(client, notification);
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

    // Resolve the channel from the server's config
    let channelId: string | null = null;
    const guildId = event.discordGuildId;
    if (guildId) {
      const { config } = await apiClient.getServerConfig(guildId);
      channelId = config?.eventsChannelId ?? null;
    }
    if (!channelId) {
      console.log(`No events channel configured for event #${eventId} (guild ${guildId ?? "none"}) — skipping embed post`);
      return;
    }

    const startTs = Math.floor(new Date(event.startsAt).getTime() / 1000);
    const endTs = Math.floor(new Date(event.endsAt).getTime() / 1000);

    const isTeamMode = event.mode === "team";
    const modeLabel = isTeamMode ? "Team Signup" : "Individual Signup";
    const typeSummary = TYPE_SUMMARIES[event.type] ?? "";
    const descriptionText = [event.description, typeSummary ? `**How it works:** ${typeSummary}` : ""]
      .filter(Boolean)
      .join("\n\n") || "_No description_";

    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${event.name}`)
      .setColor(0x3ba55d)
      .setDescription(descriptionText)
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

async function handleGroupsAssigned(client: Client, notification: BotNotification): Promise<void> {
  const { eventId, groups, benched, stats } = notification;
  if (!eventId || !groups || !stats) return;

  try {
    const { event } = await apiClient.getEvent(eventId);

    // Find the events channel for this server
    let channelId: string | null = null;
    const guildId = event.discordGuildId;
    if (guildId) {
      const { config } = await apiClient.getServerConfig(guildId);
      channelId = config?.eventsChannelId ?? null;
    }
    if (!channelId) {
      console.log(`No events channel configured for event #${eventId} — skipping groups embed`);
      return;
    }

    const ROLE_ICONS: Record<string, string> = { tank: "🛡", healer: "💚", dps: "⚔" };

    const embed = new EmbedBuilder()
      .setTitle(`🎯 Groups Assigned — ${event.name}`)
      .setColor(0xffcc00)
      .setDescription(
        `**${stats.groupsFormed}** group${stats.groupsFormed !== 1 ? "s" : ""} formed from **${stats.totalSignups}** signups.` +
        (stats.benchedCount > 0 ? ` **${stats.benchedCount}** player${stats.benchedCount !== 1 ? "s" : ""} benched.` : ""),
      );

    for (const group of groups) {
      const memberLines = group.members.map((m) => {
        const icon = ROLE_ICONS[m.role] ?? "•";
        return `${icon} **${m.characterName}**-${m.realm}`;
      });
      embed.addFields({ name: group.name, value: memberLines.join("\n"), inline: true });
    }

    if (benched && benched.length > 0) {
      const benchLines = benched.map((b) => {
        const icon = ROLE_ICONS[b.role] ?? "•";
        return `${icon} ${b.characterName}-${b.realm}`;
      });
      embed.addFields({ name: "📋 Bench", value: benchLines.join("\n"), inline: false });
    }

    if (stats.limitingRole) {
      embed.setFooter({ text: `Event #${eventId} · Limiting role: ${stats.limitingRole}` });
    }

    const channel = await client.channels.fetch(channelId) as TextChannel | null;
    if (!channel) {
      console.error(`Events channel ${channelId} not found for groups embed`);
      return;
    }

    await channel.send({ embeds: [embed] });
    console.log(`Posted groups assigned embed for event #${eventId} to channel ${channelId}`);
  } catch (err) {
    console.error(`Failed to post groups assigned embed for event #${eventId}:`, err);
  }
}

const ROLE_ICON: Record<string, string> = { tank: "🛡", healer: "💚", dps: "⚔" };
const TIMED_COLOR = 0x3ba55d;
const DEPLETED_COLOR = 0xed4245;

function formatRunDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

async function handleRunCompleted(client: Client, notification: BotNotification): Promise<void> {
  try {
    const {
      dungeonName, keystoneLevel, onTime, upgrades, completionMs, parMs,
      deaths, juice, members,
    } = notification;

    if (!dungeonName || !keystoneLevel || !members) return;

    // Build the embed
    const resultLabel = onTime
      ? (upgrades && upgrades > 0 ? `✅ Timed **+${upgrades}**` : "✅ Timed")
      : "❌ Depleted";

    const timeDiff = onTime
      ? `${formatRunDuration((parMs ?? 0) - (completionMs ?? 0))} under par`
      : `${formatRunDuration((completionMs ?? 0) - (parMs ?? 0))} over par`;

    const partyLines = members.map((m) => {
      const icon = ROLE_ICON[m.role] ?? "•";
      return `${icon} **${m.name}** — ${m.class.replace(/-/g, " ")}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`${dungeonName} +${keystoneLevel}`)
      .setColor(onTime ? TIMED_COLOR : DEPLETED_COLOR)
      .setDescription(`${resultLabel} — ${timeDiff}`)
      .addFields(
        { name: "Party", value: partyLines.join("\n"), inline: false },
        { name: "Time", value: formatRunDuration(completionMs ?? 0), inline: true },
        { name: "Deaths", value: String(deaths ?? 0), inline: true },
        { name: "Juice", value: (juice ?? 0).toLocaleString(), inline: true },
      )
      .setFooter({ text: "M+ Challenge Platform" })
      .setTimestamp();

    // Post to all active servers with a results channel configured
    // For now, broadcast to all configured servers. Phase 4 (user primary server) will narrow this.
    const servers = await getAllResultsChannels();
    for (const channelId of servers) {
      try {
        const channel = await client.channels.fetch(channelId) as TextChannel | null;
        if (channel) {
          await channel.send({ embeds: [embed] });
        }
      } catch (err) {
        console.error(`Failed to post run to channel ${channelId}:`, err);
      }
    }
  } catch (err) {
    console.error("Failed to handle run_completed notification:", err);
  }
}

async function getAllResultsChannels(): Promise<string[]> {
  try {
    const result = await apiClient.getResultsChannels();
    return result.channelIds;
  } catch (err) {
    console.error("Failed to fetch results channels:", err);
    return [];
  }
}
