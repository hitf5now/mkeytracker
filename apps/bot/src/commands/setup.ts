/**
 * /setup — reposts companion app installation instructions.
 *
 * Useful for users who lost their original /register reply (ephemeral,
 * closes when Discord restarts) or who registered before the companion
 * app was available.
 */

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { Command } from "./index.js";

/** Dynamic download redirect served by our API. Resolves to the latest
 * .exe on click; hides the distribution backend from end users. */
const COMPANION_DOWNLOAD_URL = "https://api.mythicplustracker.com/download";

export const setupCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Get the M+ Tracker Companion installer + setup instructions."),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle("M+ Tracker — Companion App Setup")
      .setColor(0xffcc00)
      .setDescription(
        "The companion is a small Windows app that captures your M+ runs and posts them to this Discord.",
      )
      .addFields(
        {
          name: "1️⃣ Download",
          value: `**[⬇ Download MKeyTracker-Setup.exe](${COMPANION_DOWNLOAD_URL})**`,
          inline: false,
        },
        {
          name: "2️⃣ Install",
          value:
            "Run the installer. Windows may show a SmartScreen warning — click **More info → Run anyway**. The app auto-detects your WoW install and copies the addon for you.",
          inline: false,
        },
        {
          name: "3️⃣ Pair",
          value:
            "In the wizard's pairing step, run `/link` here in Discord to get a 6-digit code, then paste it into the companion.",
          inline: false,
        },
        {
          name: "4️⃣ Play",
          value:
            "Run Mythic+ keys normally. The companion posts them to <#results> automatically.",
          inline: false,
        },
        {
          name: "❓ Haven't registered yet?",
          value:
            "You need to link a WoW character first with `/register character:<name> realm:<realm> region:US`.",
          inline: false,
        },
      )
      .setFooter({
        text: "Need help? Check #mkeytracker-help or ping an admin.",
      });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
