/**
 * /register — link a Discord user to a WoW character.
 *
 * Forwards to POST /api/v1/register on the M+ API, which validates the
 * character against RaiderIO and stores it in the DB.
 */

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { CLASSES, getValidRoles, isMultiRoleClass } from "@mplus/wow-constants";
import { apiClient, ApiError } from "../lib/api-client.js";
import type { Command } from "./index.js";

const REGIONS = ["us", "eu", "kr", "tw", "cn"] as const;

/** GitHub Releases URL for the companion installer. */
const COMPANION_DOWNLOAD_URL =
  "https://github.com/hitf5now/mkeytracker/releases/latest/download/MKeyTracker-Setup.exe";
const COMPANION_RELEASES_PAGE =
  "https://github.com/hitf5now/mkeytracker/releases/latest";

export const registerCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("register")
    .setDescription("Link your Discord account to a WoW character.")
    .addStringOption((opt) =>
      opt
        .setName("character")
        .setDescription("Character name (case-insensitive)")
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("realm")
        .setDescription('Realm slug, e.g. "area-52" or "tichondrius"')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("region")
        .setDescription("Region (defaults to us)")
        .addChoices(
          { name: "US", value: "us" },
          { name: "EU", value: "eu" },
          { name: "KR", value: "kr" },
          { name: "TW", value: "tw" },
          { name: "CN", value: "cn" },
        )
        .setRequired(false),
    ),

  async execute(interaction) {
    const character = interaction.options.getString("character", true);
    const realm = interaction.options.getString("realm", true);
    const region =
      (interaction.options.getString("region") as (typeof REGIONS)[number] | null) ??
      "us";

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await apiClient.register({
        discordId: interaction.user.id,
        character,
        realm,
        region,
      });

      const c = result.character;
      const classDef = CLASSES[c.class];
      const classDisplayName = classDef?.name ?? c.class.replace(/-/g, " ");
      const classColor = classDef?.color ?? 0x888888;

      // Build the valid-roles hint so the user understands spec/role is
      // flexible per event, not locked in by registration.
      const validRoles = getValidRoles(c.class);
      const rolesLabel = validRoles
        .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
        .join(" / ");

      const defaultLine = `${c.spec} • ${c.role.toUpperCase()}`;
      const eventRolesLine = isMultiRoleClass(c.class)
        ? `You can sign up for events as **${rolesLabel}** — pick per event.`
        : `Only role available for this class: **${rolesLabel}**.`;

      const embed = new EmbedBuilder()
        .setTitle(`${c.name} — ${c.realm} (${c.region.toUpperCase()})`)
        .setURL(c.profileUrl)
        .setColor(classColor)
        .addFields(
          { name: "Class", value: classDisplayName, inline: true },
          { name: "Current Spec", value: defaultLine, inline: true },
          { name: "RIO Score", value: c.rioScore.toLocaleString(), inline: true },
          { name: "Event Flexibility", value: eventRolesLine, inline: false },
          {
            name: "📥 Next: Install the Companion App",
            value: [
              `Download the **M+ Tracker Companion** for Windows:`,
              `**[⬇ MKeyTracker-Setup.exe](${COMPANION_DOWNLOAD_URL})**`,
              ``,
              `The installer bundles the WoW addon and sets everything up with a 5-step wizard. After installing, run \`/link\` to pair your account.`,
              `All releases: [github.com/hitf5now/mkeytracker](${COMPANION_RELEASES_PAGE})`,
            ].join("\n"),
            inline: false,
          },
        )
        .setFooter({
          text: "Linked to your Discord account. Spec shown is your last known — choose your role per event at signup.",
        })
        .setTimestamp();

      await interaction.editReply({
        content: "✅ Character linked.",
        embeds: [embed],
      });
    } catch (err) {
      if (err instanceof ApiError) {
        let msg: string;
        switch (err.code) {
          case "character_not_found":
            msg = `❌ Could not find **${character}-${realm}** (${region.toUpperCase()}) on RaiderIO. Double-check the spelling and realm slug.`;
            break;
          case "character_already_claimed":
            msg = `❌ **${character}-${realm}** is already linked to a different Discord account.`;
            break;
          case "raiderio_unavailable":
            msg = "❌ RaiderIO is temporarily unreachable. Try again in a minute.";
            break;
          case "invalid_body":
            msg = "❌ The API rejected the request. Check your inputs.";
            break;
          default:
            msg = `❌ Error: ${err.message}`;
        }
        await interaction.editReply({ content: msg });
        return;
      }
      // Unexpected error
      console.error("Unexpected /register error:", err);
      await interaction.editReply({
        content: "❌ Something went wrong. The bot logged the error.",
      });
    }
  },
};
