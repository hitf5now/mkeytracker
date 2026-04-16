/**
 * /leaderboard category:<category>
 *
 * Top 10 for one of the supported leaderboard categories. Categories
 * are a fixed dropdown (Discord's addChoices — max 25 entries) covering:
 *   - Aggregate boards: season juice, highest key, most timed
 *   - Per-dungeon fastest clear: one entry per current-season dungeon
 *
 * Shows rank + character name + value, color-coded by rank position.
 */

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { CLASSES } from "@mplus/wow-constants";
import {
  apiClient,
  ApiError,
  type LeaderboardEntry,
  type LeaderboardResponse,
} from "../lib/api-client.js";
import type { Command } from "./index.js";

// Category choices — must be ≤ 25 total per Discord's limit.
// Includes 3 aggregate boards + 8 per-dungeon fastest-clear boards.
const CATEGORY_CHOICES = [
  { name: "Season Juice", value: "season-juice" },
  { name: "Highest Key (timed)", value: "highest-key" },
  { name: "Most Timed Runs", value: "most-timed" },
  // Fastest per dungeon — slugs must match the seeded dungeons.json
  { name: "Fastest: Algeth'ar Academy", value: "fastest-clear-algethar-academy" },
  { name: "Fastest: Maisara Caverns", value: "fastest-clear-maisara-caverns" },
  { name: "Fastest: Magisters' Terrace", value: "fastest-clear-magisters-terrace" },
  { name: "Fastest: Nexus-Point Xenas", value: "fastest-clear-nexus-point-xenas" },
  { name: "Fastest: Pit of Saron", value: "fastest-clear-pit-of-saron" },
  { name: "Fastest: Seat of the Triumvirate", value: "fastest-clear-seat-of-the-triumvirate" },
  { name: "Fastest: Skyreach", value: "fastest-clear-skyreach" },
  { name: "Fastest: Windrunner Spire", value: "fastest-clear-windrunner-spire" },
] as const;

const RANK_EMOJI: Record<number, string> = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
};

function formatEntry(entry: LeaderboardEntry): string {
  const rankLabel = RANK_EMOJI[entry.rank] ?? `**#${entry.rank}**`;
  const classDef = CLASSES[entry.character.class];
  const classTag = classDef ? `_${classDef.name}_` : "";
  const claimedTag = entry.character.claimed ? "" : " · _unclaimed_";
  return `${rankLabel} **${entry.character.name}**-${entry.character.realm} ${classTag}${claimedTag}\n⠀⠀${entry.displayValue}`;
}

function renderEmbed(result: LeaderboardResponse): EmbedBuilder {
  const title = CATEGORY_CHOICES.find((c) => c.value === result.category)?.name ?? result.category;
  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${title}`)
    .setColor(0xffcc00)
    .setFooter({ text: `Season: ${result.season.name}` })
    .setTimestamp(new Date(result.updatedAt));

  if (result.entries.length === 0) {
    embed.setDescription(
      "_No runs yet in this category. Be the first!_",
    );
    return embed;
  }

  // Discord embed description has a 4096 char limit; 10 entries × ~100 chars each is ~1KB. Safe.
  const lines = result.entries.map(formatEntry).join("\n\n");
  embed.setDescription(lines);

  if (result.entries[0]?.context) {
    embed.setAuthor({ name: result.entries[0].context });
  }

  return embed;
}

export const leaderboardCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top 10 for a chosen leaderboard category.")
    .addStringOption((opt) =>
      opt
        .setName("category")
        .setDescription("Which leaderboard to show")
        .setRequired(true)
        .addChoices(...CATEGORY_CHOICES),
    ),

  async execute(interaction) {
    const category = interaction.options.getString("category", true);
    await interaction.deferReply();

    try {
      const result = await apiClient.getLeaderboard(category, 10);
      await interaction.editReply({ embeds: [renderEmbed(result)] });
    } catch (err) {
      if (err instanceof ApiError) {
        await interaction.editReply(`❌ ${err.message}`);
        return;
      }
      console.error("Unexpected /leaderboard error:", err);
      await interaction.editReply(
        "❌ Something went wrong. The bot logged the error.",
      );
    }
  },
};
