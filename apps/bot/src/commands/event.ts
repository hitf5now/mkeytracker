/**
 * /event start | /event cancel
 *
 * Minimal event management commands. Events are created on the website;
 * signups and group formation happen via Ready Check buttons on the embed
 * (see docs/EVENT_READY_CHECK_SYSTEM.md). These commands only handle the
 * organizer lifecycle transitions.
 */

import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { apiClient, ApiError } from "../lib/api-client.js";
import type { Command } from "./index.js";

export const eventCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("event")
    .setDescription("Manage M+ events.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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

    if (sub === "start") {
      await handleTransition(interaction, "in_progress", "Active Event");
    } else if (sub === "cancel") {
      await handleTransition(interaction, "cancelled", "Cancelled");
    }
  },
};

function hasManageGuild(interaction: import("discord.js").ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

async function handleTransition(
  interaction: import("discord.js").ChatInputCommandInteraction,
  targetStatus: string,
  displayName: string,
): Promise<void> {
  await interaction.deferReply();

  if (!hasManageGuild(interaction)) {
    await interaction.editReply("❌ You need the **Manage Server** permission to manage events.");
    return;
  }

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
