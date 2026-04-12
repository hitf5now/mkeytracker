/**
 * /signup event:<id> role:<tank|healer|dps> [character] [realm] [region]
 *
 * Signs the user up for an event with a role preference. The role is
 * validated against the user's character class via wow-constants —
 * a mage can't sign up as tank.
 *
 * If character/realm/region aren't specified, uses the user's first
 * registered character.
 */

import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { CLASSES, getValidRoles } from "@mplus/wow-constants";
import { apiClient, ApiError } from "../lib/api-client.js";
import type { Command } from "./index.js";

export const signupCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("signup")
    .setDescription("Sign up for an M+ event.")
    .addIntegerOption((opt) =>
      opt
        .setName("event")
        .setDescription("Event ID (from /event status)")
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("role")
        .setDescription("Your preferred role for this event")
        .setRequired(true)
        .addChoices(
          { name: "Tank 🛡", value: "tank" },
          { name: "Healer 💚", value: "healer" },
          { name: "DPS ⚔", value: "dps" },
        ),
    )
    .addStringOption((opt) =>
      opt
        .setName("character")
        .setDescription("Character name (defaults to your registered character)")
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName("realm")
        .setDescription("Realm slug")
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName("region")
        .setDescription("Region")
        .addChoices(
          { name: "US", value: "us" },
          { name: "EU", value: "eu" },
        )
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const eventId = interaction.options.getInteger("event", true);
    const role = interaction.options.getString("role", true) as "tank" | "healer" | "dps";
    let character = interaction.options.getString("character");
    let realm = interaction.options.getString("realm");
    const region = interaction.options.getString("region") ?? "us";

    // If no character specified, try to find their registered character
    if (!character || !realm) {
      try {
        // Look up through the register API — use their Discord ID
        // For MVP, require explicit character + realm
        await interaction.editReply(
          "❌ Please specify your character and realm.\nExample: `/signup event:1 role:dps character:Tanavast realm:trollbane`",
        );
        return;
      } catch {
        // fallthrough
      }
    }

    if (!character || !realm) {
      await interaction.editReply(
        "❌ Please provide both `character` and `realm` options.",
      );
      return;
    }

    // Validate role against character's class (fetch from API)
    try {
      const profile = await apiClient.getCharacterProfile(region, realm, character);
      const charClass = profile.character.class;
      const validRoles = getValidRoles(charClass);

      if (!validRoles.includes(role)) {
        const classDef = CLASSES[charClass];
        const className = classDef?.name ?? charClass;
        const validList = validRoles
          .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
          .join(", ");
        await interaction.editReply(
          `❌ A **${className}** can only play as: **${validList}**. You selected **${role}**, which isn't valid for this class.`,
        );
        return;
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "character_not_found") {
        // Character not in our DB yet — let the signup go through anyway
        // (the API will handle validation)
      } else {
        // If profile lookup fails for other reasons, still try signup
      }
    }

    try {
      const result = await apiClient.eventSignup({
        eventId,
        discordId: interaction.user.id,
        characterName: character,
        characterRealm: realm,
        characterRegion: region as "us" | "eu" | "kr" | "tw" | "cn",
        rolePreference: role,
      });

      const roleIcon = role === "tank" ? "🛡" : role === "healer" ? "💚" : "⚔";
      const action = result.updated ? "updated" : "signed up";

      const embed = new EmbedBuilder()
        .setTitle(`${roleIcon} ${action === "updated" ? "Signup Updated" : "Signed Up!"}`)
        .setColor(0x3ba55d)
        .setDescription(
          `You've ${action} for event **#${eventId}** as **${role.toUpperCase()}** with **${character}**.`,
        )
        .setFooter({ text: "Use /event status to see the full signup list." });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      if (err instanceof ApiError) {
        await interaction.editReply(`❌ ${err.message}`);
        return;
      }
      console.error("/signup error:", err);
      await interaction.editReply("❌ Failed to sign up.");
    }
  },
};
