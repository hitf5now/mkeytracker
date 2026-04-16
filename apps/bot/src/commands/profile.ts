/**
 * /profile [character] [realm] [region]
 *
 * If no character is provided, defaults to the invoker's first registered
 * character (if they have one). Otherwise looks up whoever they specify.
 *
 * Shows an embed with season stats, highest key, best run per dungeon,
 * and the 5 most recent runs. Color-coded by class.
 */

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { CLASSES } from "@mplus/wow-constants";
import {
  apiClient,
  ApiError,
  type CharacterProfileResponse,
  type ProfileBestRun,
  type ProfileRecentRun,
} from "../lib/api-client.js";
import type { Command } from "./index.js";

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffSec = (Date.now() - d.getTime()) / 1000;
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function runResultLabel(run: ProfileRecentRun | ProfileBestRun): string {
  if (!run.onTime) return "❌ Depleted";
  if (run.upgrades > 0) return `✅ +${run.upgrades}`;
  return "✅ Timed";
}

function buildStatsField(profile: CharacterProfileResponse): string {
  const { stats } = profile;
  const lines = [
    `**${stats.totalRuns}** runs (${stats.timedRuns} timed, ${stats.depletedRuns} depleted)`,
    `Highest: **+${stats.highestKeyCompleted || 0}**`,
    `Season Juice: **${stats.totalJuice.toLocaleString()}**`,
    `Weekly Juice: **${stats.weeklyJuice.toLocaleString()}**`,
    `Total deaths: ${stats.totalDeaths}`,
  ];
  return lines.join("\n");
}

function buildBestPerDungeonField(best: ProfileBestRun[]): string {
  if (best.length === 0) return "_No runs yet_";
  return best
    .slice(0, 8)
    .map((b) => {
      const result = b.onTime
        ? b.upgrades > 0
          ? `+${b.upgrades}`
          : "timed"
        : "depleted";
      return `\`${b.dungeonShortCode.padEnd(5)}\` **+${b.level}** ${result} • ${formatDuration(b.completionMs)} • ${b.juice.toLocaleString()} Juice`;
    })
    .join("\n");
}

function buildRecentRunsField(runs: ProfileRecentRun[]): string {
  if (runs.length === 0) return "_No runs yet_";
  return runs
    .map(
      (r) =>
        `${runResultLabel(r)} **${r.dungeonName}** +${r.level} • ${r.juice.toLocaleString()} Juice • ${formatRelative(r.recordedAt)}`,
    )
    .join("\n");
}

export const profileCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View a character's M+ Platform profile.")
    .addStringOption((opt) =>
      opt
        .setName("character")
        .setDescription("Character name (omit to show your own)")
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName("realm")
        .setDescription("Realm slug (e.g. area-52). Required if character is given.")
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName("region")
        .setDescription("Region (default us)")
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
    await interaction.deferReply();

    const characterArg = interaction.options.getString("character");
    const realmArg = interaction.options.getString("realm");
    const regionArg =
      (interaction.options.getString("region") as
        | "us"
        | "eu"
        | "kr"
        | "tw"
        | "cn"
        | null) ?? "us";

    let region: string;
    let realm: string;
    let name: string;

    if (characterArg) {
      if (!realmArg) {
        await interaction.editReply(
          "❌ When specifying a character, you must also provide a realm.",
        );
        return;
      }
      region = regionArg;
      realm = realmArg;
      name = characterArg;
    } else {
      // Look up the invoker's first registered character via the API.
      // We don't have a dedicated endpoint for this yet, so we handle it
      // implicitly: if they haven't run /register, the next API call
      // will fail and we'll tell them what to do.
      await interaction.editReply(
        "ℹ️ For now, please provide the character name and realm explicitly.\nExample: `/profile character:Tanavast realm:trollbane region:US`\n\n(Auto-lookup of your registered character is coming soon.)",
      );
      return;
    }

    try {
      const profile = await apiClient.getCharacterProfile(region, realm, name);
      const c = profile.character;
      const classDef = CLASSES[c.class];
      const classDisplayName =
        classDef?.name ?? c.class.replace(/-/g, " ");
      const classColor = classDef?.color ?? 0x888888;

      const embed = new EmbedBuilder()
        .setTitle(`${c.name} — ${c.realm} (${c.region.toUpperCase()})`)
        .setColor(classColor)
        .setDescription(
          `**${classDisplayName}** • ${c.spec || "Unknown spec"} • ${c.role} • RIO ${c.rioScore.toLocaleString()}\n_Season: ${profile.season.name}_`,
        )
        .addFields(
          {
            name: "📊 Season Stats",
            value: buildStatsField(profile),
            inline: false,
          },
          {
            name: "🏆 Best run per dungeon",
            value: buildBestPerDungeonField(profile.stats.bestRunPerDungeon),
            inline: false,
          },
          {
            name: "🕒 Recent runs",
            value: buildRecentRunsField(profile.stats.recentRuns),
            inline: false,
          },
        )
        .setFooter({
          text: c.claimed
            ? "Claimed character"
            : "Unclaimed — this player hasn't linked a Discord account",
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "character_not_found") {
          await interaction.editReply(
            `❌ Couldn't find **${name}-${realm}** (${region.toUpperCase()}).\nThey may not have registered yet, or been in any captured run.`,
          );
          return;
        }
        await interaction.editReply(`❌ ${err.message}`);
        return;
      }
      console.error("Unexpected /profile error:", err);
      await interaction.editReply(
        "❌ Something went wrong. The bot logged the error.",
      );
    }
  },
};
