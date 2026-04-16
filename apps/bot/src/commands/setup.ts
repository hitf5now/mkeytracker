/**
 * /setup — server configuration + companion app instructions.
 *
 * Subcommands:
 *   /setup companion  — reposts companion app installation instructions
 *   /setup events-channel <channel> — configure where event embeds are posted
 */

import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { apiClient, ApiError } from "../lib/api-client.js";
import type { Command } from "./index.js";

const COMPANION_DOWNLOAD_URL = "https://api.mythicplustracker.com/download";

export const setupCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Server configuration and companion app setup.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("companion")
        .setDescription("Get the M+ Tracker Companion installer + setup instructions."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("events-channel")
        .setDescription("Set the channel where event embeds are posted.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("The text channel for event embeds")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("results-channel")
        .setDescription("Set the channel where run results are posted.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("The text channel for run results")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("show")
        .setDescription("Show the current server configuration."),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "events-channel") {
      await handleEventsChannel(interaction);
    } else if (sub === "results-channel") {
      await handleResultsChannel(interaction);
    } else if (sub === "show") {
      await handleShow(interaction);
    } else {
      await handleCompanion(interaction);
    }
  },
};

async function handleCompanion(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("M+ Tracker — Companion App Setup")
    .setColor(0xffcc00)
    .setDescription(
      "The companion is a small Windows app that captures your M+ runs and posts them to this Discord.",
    )
    .addFields(
      {
        name: "1. Download",
        value: `**[Download MKeyTracker-Setup.exe](${COMPANION_DOWNLOAD_URL})**`,
        inline: false,
      },
      {
        name: "2. Install",
        value:
          "Run the installer. Windows may show a SmartScreen warning — click **More info > Run anyway**. The app auto-detects your WoW install and copies the addon for you.",
        inline: false,
      },
      {
        name: "3. Pair",
        value:
          "In the wizard's pairing step, run `/link` here in Discord to get a 6-digit code, then paste it into the companion.",
        inline: false,
      },
      {
        name: "4. Play",
        value:
          "Run Mythic+ keys normally. The companion posts them automatically.",
        inline: false,
      },
    )
    .setFooter({
      text: "💡 With the companion app, your characters are auto-linked — no /register needed!",
    });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleEventsChannel(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const channel = interaction.options.getChannel("channel", true);
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.editReply("❌ This command can only be used in a server.");
    return;
  }

  try {
    await apiClient.setServerConfig(guildId, {
      eventsChannelId: channel.id,
      guildName: interaction.guild?.name ?? null,
    });

    await interaction.editReply(
      `✅ Event embeds will now be posted to <#${channel.id}>.\n` +
      "Events created on the website or via `/event create` will appear there with signup buttons.",
    );
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }
    console.error("/setup events-channel error:", err);
    await interaction.editReply("❌ Failed to save channel configuration.");
  }
}

async function handleResultsChannel(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const channel = interaction.options.getChannel("channel", true);
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.editReply("❌ This command can only be used in a server.");
    return;
  }

  try {
    await apiClient.setServerConfig(guildId, {
      resultsChannelId: channel.id,
      guildName: interaction.guild?.name ?? null,
    });

    await interaction.editReply(
      `✅ Run results will now be posted to <#${channel.id}>.`,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }
    console.error("/setup results-channel error:", err);
    await interaction.editReply("❌ Failed to save channel configuration.");
  }
}

async function handleShow(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply("❌ This command can only be used in a server.");
    return;
  }

  try {
    const { config } = await apiClient.getServerConfig(guildId);

    if (!config) {
      await interaction.editReply(
        "No configuration found for this server.\nRun `/setup events-channel` and `/setup results-channel` to get started.",
      );
      return;
    }

    const lines = [
      `**Server:** ${config.guildName ?? interaction.guild?.name ?? "Unknown"}`,
      `**Events channel:** ${config.eventsChannelId ? `<#${config.eventsChannelId}>` : "_Not set_"}`,
      `**Results channel:** ${config.resultsChannelId ? `<#${config.resultsChannelId}>` : "_Not set_"}`,
    ];

    const embed = new EmbedBuilder()
      .setTitle("Server Configuration")
      .setColor(0x3ba55d)
      .setDescription(lines.join("\n"));

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }
    console.error("/setup show error:", err);
    await interaction.editReply("❌ Failed to read server configuration.");
  }
}
