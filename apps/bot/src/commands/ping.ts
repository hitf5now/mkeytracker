/**
 * /ping — simple health check command.
 *
 * Verifies the bot is connected, responding, and that slash commands
 * are registered. No DB or API calls.
 */

import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./index.js";

export const pingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check that the M+ Tracker bot is online."),

  async execute(interaction) {
    const started = Date.now();
    await interaction.reply({ content: "Pinging...", ephemeral: true });
    const roundTrip = Date.now() - started;
    await interaction.editReply(
      `🏓 Pong! Gateway: \`${interaction.client.ws.ping}ms\` • Reply: \`${roundTrip}ms\``,
    );
  },
};
