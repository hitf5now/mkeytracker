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
import {
  postOrUpdateReadyCheckMessage,
  finalizeReadyCheckMessage,
  buildGroupEmbed,
  buildGroupButtons,
  type FormedGroupView,
} from "../components/ready-check.js";

/**
 * Display labels for endorsement categories, mirroring
 * apps/web/src/lib/endorsement-categories.ts. Keep in sync if either side
 * changes — the enum values are owned by the Prisma schema.
 */
const ENDORSEMENT_CATEGORY_LABEL: Record<string, string> = {
  great_tank: "Great Tank",
  great_healer: "Great Healer",
  great_dps: "Great DPS",
  interrupt_master: "Interrupt Master",
  dispel_wizard: "Dispel Wizard",
  cc_master: "CC Master",
  cooldown_hero: "Cooldown Hero",
  affix_slayer: "Affix Slayer",
  route_master: "Route Master",
  patient_teacher: "Patient Teacher",
  calm_under_pressure: "Calm Under Pressure",
  positive_vibes: "Positive Vibes",
  shot_caller: "Shot Caller",
  clutch_saviour: "Clutch Saviour",
  comeback_kid: "Comeback Kid",
};

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

function buildGroupEventButtons(
  eventId: number,
  eventStatus: string,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event-signup:${eventId}`)
      .setLabel("Sign Up")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`event-tentative:${eventId}`)
      .setLabel("Tentative")
      .setStyle(ButtonStyle.Secondary),
  );
  if (eventStatus === "in_progress") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`event-ready-check:${eventId}`)
        .setLabel("Ready Check")
        .setEmoji("⚡")
        .setStyle(ButtonStyle.Primary),
    );
  }
  return row;
}

/** Public base URL for the website — used to deep-link run detail pages. */
const WEB_BASE = "https://mythicplustracker.com";

interface BotNotification {
  type: string;
  eventId?: number;
  runId?: number;
  /** Internal user id of the submitting companion-app user — drives per-user posting preference. */
  submitterUserId?: number;
  dungeonName?: string;
  keystoneLevel?: number;
  onTime?: boolean;
  upgrades?: number;
  completionMs?: number;
  parMs?: number;
  deaths?: number;
  juice?: number;
  members?: Array<{ name: string; realm: string; class: string; role: string }>;
  // event_completed payload
  results?: {
    eventId: number;
    eventType: string;
    standings: Array<{
      rank: number;
      groupId: number;
      groupName: string;
      score: number;
      displayScore: string;
      runCount: number;
      members: Array<{ characterName: string; realm: string; classSlug: string }>;
    }>;
    totalRuns: number;
    totalParticipants: number;
  };
  // endorsement_given payload
  endorsementId?: number;
  category?: string;
  note?: string | null;
  giverDiscordId?: string;
  receiverDiscordId?: string;
  giverCharacterName?: string | null;
  giverCharacterClass?: string | null;
  receiverCharacterName?: string | null;
  receiverCharacterClass?: string | null;
  channelIds?: string[];
  // ready_check_updated / ready_check_expired payload
  readyCheckId?: number;
  reason?: string;
  groupIds?: number[];
  bouncedSignupIds?: number[];
  // event_group_disbanded payload
  groupId?: number;
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
      } else if (notification.type === "event_reposted" && notification.eventId) {
        await handleEventReposted(client, notification.eventId);
      } else if (notification.type === "ready_check_updated" && notification.readyCheckId && notification.eventId) {
        await handleReadyCheckUpdated(client, notification.readyCheckId, notification.eventId);
      } else if (notification.type === "ready_check_expired" && notification.readyCheckId && notification.eventId) {
        await handleReadyCheckExpired(client, notification);
      } else if (notification.type === "event_group_disbanded" && notification.groupId && notification.eventId) {
        await handleGroupDisbanded(client, notification.groupId, notification.eventId);
      } else if (notification.type === "event_completed" && notification.eventId) {
        await handleEventCompleted(client, notification);
      } else if (notification.type === "run_completed" && notification.runId) {
        await handleRunCompleted(client, notification);
      } else if (notification.type === "endorsement_given" && notification.endorsementId) {
        await handleEndorsementGiven(client, notification);
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
      : buildGroupEventButtons(event.id, event.status);

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

/** Resolve the events channel for a guild — null if unconfigured. */
async function resolveEventsChannel(guildId: string | null | undefined): Promise<string | null> {
  if (!guildId) return null;
  try {
    const { config } = await apiClient.getServerConfig(guildId);
    return config?.eventsChannelId ?? null;
  } catch {
    return null;
  }
}

async function handleReadyCheckUpdated(
  client: Client,
  readyCheckId: number,
  eventId: number,
): Promise<void> {
  try {
    const [{ event }, rc] = await Promise.all([
      apiClient.getEvent(eventId),
      apiClient.getActiveReadyCheck(eventId),
    ]);
    if (!rc.active || rc.active.id !== readyCheckId) {
      // The RC has already moved on (expired/cancelled) — skip refresh
      return;
    }

    const channelId = await resolveEventsChannel(event.discordGuildId);
    if (!channelId) {
      console.log(`No events channel for event #${eventId} — skipping RC message`);
      return;
    }

    await postOrUpdateReadyCheckMessage(client, {
      eventId,
      readyCheckId,
      channelId,
      eventName: event.name,
      expiresAt: new Date(rc.active.expiresAt),
      participants: rc.active.participants.map((p) => ({
        characterName: p.characterName,
        realm: p.realm,
        primaryRole: p.primaryRole,
        flexRole: p.flexRole,
        priorityFlag: p.priorityFlag,
      })),
    });
  } catch (err) {
    console.error(`Failed to refresh RC message for event #${eventId}:`, err);
  }
}

async function handleReadyCheckExpired(
  client: Client,
  notification: BotNotification,
): Promise<void> {
  const { readyCheckId, eventId, groupIds, bouncedSignupIds } = notification;
  if (!readyCheckId || !eventId) return;

  try {
    const { event } = await apiClient.getEvent(eventId);
    const groupCount = (groupIds ?? []).length;
    const bouncedCount = (bouncedSignupIds ?? []).length;

    // Convert the RC message into a "complete" summary
    await finalizeReadyCheckMessage(client, {
      readyCheckId,
      eventName: event.name,
      groupCount,
      bouncedCount,
    });

    if (groupCount === 0) return;

    const channelId = await resolveEventsChannel(event.discordGuildId);
    if (!channelId) return;
    const channel = (await client.channels.fetch(channelId)) as TextChannel | null;
    if (!channel) return;

    // Match formed groups against the event's groups list (which we
    // just refetched). For each group, post a standalone card with
    // slot layout + vote-to-disband button.
    const newlyFormed = event.groups.filter(
      (g) => g.readyCheckId === readyCheckId && g.state === "forming",
    );

    for (const group of newlyFormed) {
      const slots: FormedGroupView["slots"] = (
        ["tank", "healer", "dps1", "dps2", "dps3"] as const
      ).map((position) => {
        const member = group.members.find((m) => m.slotPosition === position);
        if (!member) return { position, participant: null };
        return {
          position,
          participant: {
            characterName: member.character.name,
            realm: member.character.realm,
            classSlug: member.character.class,
            primaryRole: member.rolePreference as "tank" | "healer" | "dps",
            flexRole: member.flexRole,
          },
        };
      });

      const view: FormedGroupView = { groupId: group.id, name: group.name, slots };
      await channel.send({
        embeds: [buildGroupEmbed(event.name, view)],
        components: [buildGroupButtons(group.id)],
      });
    }

    console.log(
      `Posted ${newlyFormed.length} group card(s) for event #${eventId} (RC #${readyCheckId})`,
    );
  } catch (err) {
    console.error(`Failed to handle RC expired for event #${eventId}:`, err);
  }
}

async function handleGroupDisbanded(
  client: Client,
  _groupId: number,
  eventId: number,
): Promise<void> {
  try {
    const { event } = await apiClient.getEvent(eventId);
    const channelId = await resolveEventsChannel(event.discordGuildId);
    if (!channelId) return;
    const channel = (await client.channels.fetch(channelId)) as TextChannel | null;
    if (!channel) return;
    await channel.send(
      `🛑 A group for **${event.name}** was disbanded by its members. Those players are free to Ready Check again.`,
    );
  } catch (err) {
    console.error(`Failed to announce group disband for event #${eventId}:`, err);
  }
}

async function handleEventReposted(client: Client, eventId: number): Promise<void> {
  try {
    const { event } = await apiClient.getEvent(eventId);
    if (!event.discordChannelId) return;

    const channel = (await client.channels.fetch(event.discordChannelId)) as TextChannel | null;
    if (!channel) return;

    const link = event.discordMessageId
      ? `https://discord.com/channels/${event.discordGuildId ?? "@me"}/${event.discordChannelId}/${event.discordMessageId}`
      : null;

    const body = link
      ? `📌 **${event.name}** is still accepting signups — [jump to event](${link})`
      : `📌 **${event.name}** is still accepting signups.`;

    await channel.send(body);
    console.log(`Posted repost pointer for event #${eventId}`);
  } catch (err) {
    console.error(`Failed to repost event #${eventId}:`, err);
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
      : buildGroupEventButtons(event.id, event.status);

    const channel = await client.channels.fetch(event.discordChannelId) as TextChannel | null;
    if (!channel) return;

    const message = await channel.messages.fetch(event.discordMessageId);
    await message.edit({ embeds: [embed], components: [buttons] });

    console.log(`Updated Discord embed for event #${eventId}`);
  } catch (err) {
    console.error(`Failed to update event #${eventId} embed:`, err);
  }
}

async function handleEventCompleted(client: Client, notification: BotNotification): Promise<void> {
  const { eventId, results } = notification;
  if (!eventId || !results) return;

  try {
    const { event } = await apiClient.getEvent(eventId);

    // Find events channel for this server
    let channelId: string | null = null;
    const guildId = event.discordGuildId;
    if (guildId) {
      const { config } = await apiClient.getServerConfig(guildId);
      channelId = config?.eventsChannelId ?? null;
    }
    if (!channelId) {
      console.log(`No events channel for event #${eventId} — skipping results embed`);
      return;
    }

    const RANK_EMOJI = ["🥇", "🥈", "🥉"];
    const TYPE_LABELS: Record<string, string> = {
      key_climbing: "Key Climbing",
      marathon: "Marathon",
      best_average: "Best Average",
      bracket_tournament: "Bracket Tournament",
      fastest_clear_race: "Fastest Clear",
      speed_sprint: "Speed Sprint",
      random_draft: "Random Draft",
    };

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Event Complete — ${event.name}`)
      .setColor(0xffd700)
      .setDescription(
        `**${results.totalRuns}** runs completed by **${results.standings.length}** groups\n` +
        `Event type: **${TYPE_LABELS[results.eventType] ?? results.eventType}**`,
      );

    // Top 3 groups
    const top3 = results.standings.slice(0, 3);
    for (const standing of top3) {
      const emoji = RANK_EMOJI[standing.rank - 1] ?? `#${standing.rank}`;
      const memberList = standing.members
        .map((m) => `**${m.characterName}**-${m.realm}`)
        .join(", ");
      embed.addFields({
        name: `${emoji} ${standing.groupName}`,
        value: `${standing.displayScore}\n${memberList}`,
        inline: false,
      });
    }

    if (results.standings.length === 0) {
      embed.addFields({ name: "No results", value: "No runs were submitted during this event.", inline: false });
    }

    embed.setFooter({ text: `Event #${eventId} · ${results.totalParticipants} participants` });
    embed.setTimestamp();

    const channel = await client.channels.fetch(channelId) as TextChannel | null;
    if (!channel) {
      console.error(`Events channel ${channelId} not found for results embed`);
      return;
    }

    await channel.send({ embeds: [embed] });
    console.log(`Posted event results embed for event #${eventId} to channel ${channelId}`);
  } catch (err) {
    console.error(`Failed to post event results embed for event #${eventId}:`, err);
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

async function handleEndorsementGiven(
  client: Client,
  notification: BotNotification,
): Promise<void> {
  const {
    endorsementId,
    runId,
    category,
    note,
    receiverDiscordId,
    giverCharacterName,
    receiverCharacterName,
    dungeonName,
    keystoneLevel,
    channelIds,
  } = notification;

  if (
    !endorsementId ||
    !runId ||
    !category ||
    !receiverDiscordId ||
    !channelIds ||
    channelIds.length === 0
  ) {
    console.log(
      `endorsement_given #${endorsementId}: missing fields or no channels — skipping`,
    );
    return;
  }

  const label = ENDORSEMENT_CATEGORY_LABEL[category] ?? category;
  const runUrl = `${WEB_BASE}/runs/${runId}`;
  const runContext =
    dungeonName && keystoneLevel
      ? `[${dungeonName} +${keystoneLevel}](${runUrl})`
      : `[View run](${runUrl})`;

  const receiverLabel = receiverCharacterName ?? `<@${receiverDiscordId}>`;
  const giverLabel = giverCharacterName ?? "A teammate";

  const embed = new EmbedBuilder()
    .setTitle("✨ Endorsement received")
    .setColor(0xffd100) // platform gold
    .setDescription(
      `**${receiverLabel}** earned a **${label}** endorsement from **${giverLabel}** on ${runContext}.`,
    );

  if (note) {
    embed.addFields({ name: "Note", value: `*“${note}”*`, inline: false });
  }

  embed.setFooter({ text: "M+ Challenge Platform · Endorsements" }).setTimestamp();

  // Ping the recipient so they get the Discord notification badge. The
  // mention is in the content (not the embed) because embeds don't trigger
  // pings on their own.
  const mention = `<@${receiverDiscordId}>`;

  for (const channelId of channelIds) {
    try {
      const channel = (await client.channels.fetch(channelId)) as TextChannel | null;
      if (!channel) continue;
      await channel.send({
        content: mention,
        embeds: [embed],
        allowedMentions: { users: [receiverDiscordId] },
      });
    } catch (err) {
      console.error(
        `Failed to post endorsement #${endorsementId} to channel ${channelId}:`,
        err,
      );
    }
  }

  console.log(
    `Posted endorsement #${endorsementId} (${category}) to ${channelIds.length} channel(s)`,
  );
}

async function handleRunCompleted(client: Client, notification: BotNotification): Promise<void> {
  try {
    const {
      runId, submitterUserId, dungeonName, keystoneLevel, onTime, upgrades,
      completionMs, parMs, deaths, juice, members,
    } = notification;

    if (!runId || !dungeonName || !keystoneLevel || !members) return;

    // Per-user posting: resolve the submitter's preferred channels, claim
    // them atomically, and only post to the freshly-claimed subset.
    // No submitter (e.g. internal/admin submission) → don't post anywhere.
    if (!submitterUserId) {
      console.log(`Run #${runId} has no submitterUserId — skipping Discord post`);
      return;
    }

    let candidateChannels: string[];
    try {
      const { mode, channelIds } = await apiClient.getRunResultsChannelsForUser(submitterUserId);
      if (mode === "none" || channelIds.length === 0) {
        console.log(`Run #${runId}: submitter ${submitterUserId} mode=${mode} resolves to no channels`);
        return;
      }
      candidateChannels = channelIds;
    } catch (err) {
      console.error(`Failed to resolve channels for user ${submitterUserId}:`, err);
      return;
    }

    let claimedChannels: string[];
    try {
      const { claimedChannelIds } = await apiClient.claimRunDiscordChannels(runId, candidateChannels);
      claimedChannels = claimedChannelIds;
    } catch (err) {
      console.error(`Failed to claim channels for run ${runId}:`, err);
      return;
    }

    if (claimedChannels.length === 0) {
      console.log(`Run #${runId}: all candidate channels already claimed by earlier submitters`);
      return;
    }

    // Build the embed (only after we know we have somewhere to post)
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

    const runUrl = `${WEB_BASE}/runs/${runId}`;
    const embed = new EmbedBuilder()
      .setTitle(`${dungeonName} +${keystoneLevel}`)
      .setURL(runUrl)
      .setColor(onTime ? TIMED_COLOR : DEPLETED_COLOR)
      .setDescription(`${resultLabel} — ${timeDiff}`)
      .addFields(
        { name: "Party", value: partyLines.join("\n"), inline: false },
        { name: "Time", value: formatRunDuration(completionMs ?? 0), inline: true },
        { name: "Deaths", value: String(deaths ?? 0), inline: true },
        { name: "Juice", value: (juice ?? 0).toLocaleString(), inline: true },
        { name: "Full stats", value: `[View on the website](${runUrl})`, inline: false },
      )
      .setFooter({ text: "M+ Challenge Platform" })
      .setTimestamp();

    for (const channelId of claimedChannels) {
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
