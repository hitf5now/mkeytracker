/**
 * /event create | /event status | /event close-signups
 *
 * Subcommand-based event management. Creates events, shows status,
 * and triggers matchmaking (close-signups).
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { apiClient, ApiError, type EventDetailResponse, type EventListItem } from "../lib/api-client.js";
import type { Command } from "./index.js";

const DUNGEON_CHOICES = [
  { name: "Algeth'ar Academy", value: "algethar-academy" },
  { name: "Maisara Caverns", value: "maisara-caverns" },
  { name: "Magisters' Terrace", value: "magisters-terrace" },
  { name: "Nexus-Point Xenas", value: "nexus-point-xenas" },
  { name: "Pit of Saron", value: "pit-of-saron" },
  { name: "Seat of the Triumvirate", value: "seat-of-the-triumvirate" },
  { name: "Skyreach", value: "skyreach" },
  { name: "Windrunner Spire", value: "windrunner-spire" },
  { name: "Any dungeon", value: "any" },
] as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export const eventCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("event")
    .setDescription("Create and manage M+ events.")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a new M+ event.")
        // Required options first (Discord enforces this order)
        .addStringOption((opt) =>
          opt.setName("name").setDescription("Event name").setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("starts")
            .setDescription('Start time (e.g. "2026-04-15 8:00 PM EST" or ISO)')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("ends")
            .setDescription('End time (e.g. "2026-04-15 11:00 PM EST" or ISO)')
            .setRequired(true),
        )
        // Optional options after
        .addStringOption((opt) =>
          opt
            .setName("dungeon")
            .setDescription("Specific dungeon (or leave for any)")
            .addChoices(...DUNGEON_CHOICES)
            .setRequired(false),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("min-key")
            .setDescription("Minimum keystone level (default 2)")
            .setMinValue(2)
            .setMaxValue(40)
            .setRequired(false),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("max-key")
            .setDescription("Maximum keystone level (default 40)")
            .setMinValue(2)
            .setMaxValue(40)
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("description")
            .setDescription("Event description / rules")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show an event's signup status and teams.")
        .addIntegerOption((opt) =>
          opt
            .setName("id")
            .setDescription("Event ID (shows latest if omitted)")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("close-signups")
        .setDescription("Close signups and auto-assign teams.")
        .addIntegerOption((opt) =>
          opt
            .setName("id")
            .setDescription("Event ID")
            .setRequired(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "create") {
      await handleCreate(interaction);
    } else if (sub === "status") {
      await handleStatus(interaction);
    } else if (sub === "close-signups") {
      await handleCloseSignups(interaction);
    }
  },
};

async function handleCreate(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const name = interaction.options.getString("name", true);
  const dungeon = interaction.options.getString("dungeon") || undefined;
  const starts = interaction.options.getString("starts", true);
  const ends = interaction.options.getString("ends", true);
  const minKey = interaction.options.getInteger("min-key") ?? 2;
  const maxKey = interaction.options.getInteger("max-key") ?? 40;
  const description = interaction.options.getString("description") ?? undefined;

  // Parse natural date input
  let startsAt: string;
  let endsAt: string;
  try {
    startsAt = new Date(starts).toISOString();
    endsAt = new Date(ends).toISOString();
  } catch {
    await interaction.editReply(
      "❌ Could not parse the start/end time. Try a format like `2026-04-15 8:00 PM` or ISO `2026-04-15T20:00:00Z`.",
    );
    return;
  }

  try {
    const result = await apiClient.createEvent({
      name,
      dungeonSlug: dungeon === "" || dungeon === "any" ? undefined : dungeon,
      startsAt,
      endsAt,
      minKeyLevel: minKey,
      maxKeyLevel: maxKey,
      description,
      createdByDiscordId: interaction.user.id,
    });

    const event = result.event;

    // Use Discord timestamp format for automatic timezone conversion
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
      new ButtonBuilder()
        .setCustomId(`event-decline:${event.id}`)
        .setLabel("Decline")
        .setStyle(ButtonStyle.Danger),
    );

    const reply = await interaction.editReply({
      content: "✅ Event created! Click a button below to sign up.",
      embeds: [embed],
      components: [buttons],
    });

    // Store the message ID so we can edit the embed in-place on signups
    try {
      await apiClient.storeDiscordMessage(event.id, reply.id, interaction.channelId);
    } catch (err) {
      console.error("Failed to store Discord message ID:", err);
    }
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }
    console.error("/event create error:", err);
    await interaction.editReply("❌ Failed to create event.");
  }
}

async function handleStatus(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const eventId = interaction.options.getInteger("id");

  try {
    let event: EventDetailResponse | EventListItem;
    if (eventId) {
      const result = await apiClient.getEvent(eventId);
      event = result.event;
    } else {
      const result = await apiClient.listEvents();
      if (result.events.length === 0) {
        await interaction.editReply("No active events found. Create one with `/event create`.");
        return;
      }
      event = result.events[0]!;
    }

    const signupsByRole = { tank: 0, healer: 0, dps: 0 };
    const signups = "signups" in event ? event.signups : [];
    for (const s of signups) {
      const role = s.rolePreference as keyof typeof signupsByRole;
      if (role in signupsByRole) signupsByRole[role]++;
    }

    const teams = "teams" in event ? event.teams : [];
    const teamCount = teams.length || ("_count" in event ? event._count.teams : 0);
    const signupCount = signups.length || ("_count" in event ? event._count.signups : 0);

    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${event.name}`)
      .setColor(event.status === "open" ? 0x3ba55d : event.status === "in_progress" ? 0xffcc00 : 0x888888)
      .addFields(
        { name: "Status", value: event.status.replace(/_/g, " "), inline: true },
        { name: "Event ID", value: `#${event.id}`, inline: true },
        {
          name: "Dungeon",
          value: event.dungeon?.name || "Any",
          inline: true,
        },
        { name: "Starts", value: formatDate(event.startsAt), inline: true },
        { name: "Ends", value: formatDate(event.endsAt), inline: true },
        {
          name: "Key Range",
          value: `+${event.minKeyLevel} – +${event.maxKeyLevel}`,
          inline: true,
        },
        {
          name: `Signups (${signupCount})`,
          value: `🛡 ${signupsByRole.tank} tank · 💚 ${signupsByRole.healer} healer · ⚔ ${signupsByRole.dps} DPS`,
          inline: false,
        },
      );

    if (teamCount > 0 && teams.length > 0) {
      for (const team of teams) {
        const members = team.members || [];
        const memberList = members
          .map((m) => {
            const icon = m.rolePreference === "tank" ? "🛡" : m.rolePreference === "healer" ? "💚" : "⚔";
            return `${icon} ${m.character.name}`;
          })
          .join("\n");
        embed.addFields({ name: team.name, value: memberList || "_Empty_", inline: true });
      }
    }

    if (event.status === "open") {
      embed.setFooter({
        text: "💡 Click the buttons on the event embed to sign up, or create events at mythicplustracker.com/events/create",
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }
    console.error("/event status error:", err);
    await interaction.editReply("❌ Failed to load event.");
  }
}

async function handleCloseSignups(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const eventId = interaction.options.getInteger("id", true);

  try {
    const result = await apiClient.closeSignups(eventId);

    const embed = new EmbedBuilder()
      .setTitle("🎯 Teams Assigned!")
      .setColor(0xffcc00)
      .setDescription(
        `${result.stats.teamsFormed} team(s) formed from ${result.stats.totalSignups} signup(s). ${result.stats.benchedCount} benched.`,
      );

    for (const team of result.teams) {
      const memberList = team.members
        .map((m) => {
          const icon = m.role === "tank" ? "🛡" : m.role === "healer" ? "💚" : "⚔";
          return `${icon} **${m.characterName}** (${m.realm})`;
        })
        .join("\n");
      embed.addFields({ name: team.name, value: memberList, inline: true });
    }

    if (result.benched.length > 0) {
      const benchList = result.benched
        .map((b) => `${b.characterName}-${b.realm} (${b.role})`)
        .join(", ");
      embed.addFields({ name: "📋 Bench", value: benchList, inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }
    console.error("/event close-signups error:", err);
    await interaction.editReply("❌ Failed to close signups.");
  }
}
