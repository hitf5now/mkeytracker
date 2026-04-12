/**
 * /link — generate a pairing code for the companion app.
 *
 * Calls POST /api/v1/auth/link-code on the M+ API, which returns a
 * 6-digit code the user types into the companion app's first-run
 * wizard. The code expires after 5 minutes.
 *
 * Reply is ephemeral (only the requesting user sees it) so the code
 * isn't phishable by other server members.
 */

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { apiClient, ApiError } from "../lib/api-client.js";
import type { Command } from "./index.js";

export const linkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("link")
    .setDescription(
      "Generate a pairing code for the M+ Companion app on your computer.",
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await apiClient.linkCode({ discordId: interaction.user.id });
      const minutes = Math.round(result.expiresInSeconds / 60);

      const embed = new EmbedBuilder()
        .setTitle("🔗 Companion Pairing Code")
        .setColor(0x5865f2)
        .setDescription(
          [
            `Your pairing code is:`,
            ``,
            `## \`${result.code}\``,
            ``,
            `Open the **M+ Companion** app on your computer, and enter this code in the first-run setup.`,
            ``,
            `⏱ The code expires in **${minutes} minutes** and can only be used once.`,
          ].join("\n"),
        )
        .setFooter({ text: "Do not share this code with anyone." });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "user_not_registered") {
          await interaction.editReply({
            content:
              "❌ You need to register a character first with `/register` before you can pair the companion app.",
          });
          return;
        }
        await interaction.editReply({ content: `❌ ${err.message}` });
        return;
      }
      console.error("Unexpected /link error:", err);
      await interaction.editReply({
        content: "❌ Something went wrong. The bot logged the error.",
      });
    }
  },
};
