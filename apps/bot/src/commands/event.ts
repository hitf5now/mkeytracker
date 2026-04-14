/**
 * /event assign-groups | /event start | /event cancel
 *
 * Minimal event management commands. Events are created on the website;
 * signups happen via embed buttons. These commands handle organizer actions.
 */

import {
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { apiClient, ApiError } from "../lib/api-client.js";
import type { Command } from "./index.js";

export const eventCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("event")
    .setDescription("Manage M+ events.")
    .addSubcommand((sub) =>
      sub
        .setName("assign-groups")
        .setDescription("Auto-assign groups (must be in Group Assignments phase).")
        .addIntegerOption((opt) =>
          opt.setName("id").setDescription("Event ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Start the event (transition to Active Event).")
        .addIntegerOption((opt) =>
          opt.setName("id").setDescription("Event ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("cancel")
        .setDescription("Cancel an event.")
        .addIntegerOption((opt) =>
          opt.setName("id").setDescription("Event ID").setRequired(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "assign-groups") {
      await handleAssignGroups(interaction);
    } else if (sub === "start") {
      await handleTransition(interaction, "in_progress", "Active Event");
    } else if (sub === "cancel") {
      await handleTransition(interaction, "cancelled", "Cancelled");
    }
  },
};

async function handleAssignGroups(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();
  const eventId = interaction.options.getInteger("id", true);

  try {
    const result = await apiClient.assignGroups(eventId);

    const embed = new EmbedBuilder()
      .setTitle("🎯 Groups Assigned!")
      .setColor(0xffcc00)
      .setDescription(
        `${result.stats.groupsFormed} group(s) formed from ${result.stats.totalSignups} signup(s). ${result.stats.benchedCount} benched.`,
      );

    for (const group of result.groups) {
      const memberList = group.members
        .map((m) => {
          const icon = m.role === "tank" ? "🛡" : m.role === "healer" ? "💚" : "⚔";
          return `${icon} **${m.characterName}** (${m.realm})`;
        })
        .join("\n");
      embed.addFields({ name: group.name, value: memberList, inline: true });
    }

    if (result.benched.length > 0) {
      const benchList = result.benched
        .map((b) => `${b.characterName}-${b.realm} (${b.role})`)
        .join(", ");
      embed.addFields({ name: "📋 Bench", value: benchList, inline: false });
    }

    embed.setFooter({ text: `Use /event start ${eventId} to begin the event.` });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }
    console.error("/event assign-groups error:", err);
    await interaction.editReply("❌ Failed to assign groups.");
  }
}

async function handleTransition(
  interaction: import("discord.js").ChatInputCommandInteraction,
  targetStatus: string,
  displayName: string,
): Promise<void> {
  await interaction.deferReply();
  const eventId = interaction.options.getInteger("id", true);

  try {
    await apiClient.transitionEvent(eventId, targetStatus);
    await interaction.editReply(`✅ Event **#${eventId}** is now **${displayName}**.`);
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }
    console.error(`/event ${targetStatus} error:`, err);
    await interaction.editReply("❌ Failed to update event status.");
  }
}
