/**
 * /setup — reposts companion app installation instructions.
 *
 * Useful for users who lost their original /register reply (ephemeral,
 * closes when Discord restarts) or who registered before the companion
 * app was available.
 */

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { Command } from "./index.js";

/** Release page URL — always resolves to the latest published release
 * so we don't have to hardcode a version in the link. */
const COMPANION_RELEASES_PAGE =
  "https://github.com/hitf5now/mkeytracker/releases/latest";

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
          value: `**[⬇ Open the latest release](${COMPANION_RELEASES_PAGE})** then click the \`.exe\` file under **Assets**.`,
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
