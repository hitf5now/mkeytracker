/**
 * Event signup component handlers — Raid-Helper-style interactive signups.
 *
 * Handles:
 *   - "event-signup:{eventId}"     — Sign Up button click
 *   - "event-tentative:{eventId}"  — Tentative button click
 *   - "event-decline:{eventId}"    — Decline button click
 *   - "event-char:{eventId}"       — Character select menu
 *   - "event-spec:{eventId}:{charId}" — Spec select menu
 *   - "event-manual:{eventId}"     — Manual entry modal submit
 *   - "event-confirm:{nonce}"      — Confirm unverified signup button
 *   - "event-role:{nonce}"         — Role select for unverified (no class data)
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { CLASSES, roleFromSpec, type SpecDefinition } from "@mplus/wow-constants";
import {
  apiClient,
  ApiError,
  type UserCharacter,
} from "../lib/api-client.js";
import type { ComponentHandler } from "./index.js";

// ── In-memory stores for multi-step flows ────────────────────────

/** Pending manual signup data, keyed by a short nonce */
interface PendingManual {
  eventId: number;
  discordUserId: string;
  name: string;
  realm: string;
  region: string;
  classSlug: string | null;
  rioScore: number;
}

const pendingManuals = new Map<string, PendingManual>();

/** Per-event lock to prevent concurrent embed edits */
const editLocks = new Map<number, Promise<void>>();

function withEditLock(eventId: number, fn: () => Promise<void>): Promise<void> {
  const prev = editLocks.get(eventId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  editLocks.set(eventId, next);
  return next;
}

let nonceCounter = 0;
function nonce(): string {
  return `${Date.now().toString(36)}${(nonceCounter++).toString(36)}`;
}

// ── Embed builder ────────────────────────────────────────────────

function getClassColor(classSlug: string): string {
  const cls = CLASSES[classSlug];
  if (!cls) return "";
  return `#${cls.color.toString(16).padStart(6, "0")}`;
}

interface SignupForRoster {
  characterName: string;
  realm: string;
  classSlug: string;
  spec: string | null;
  rolePreference: string;
  hasCompanionApp: boolean;
  signupStatus: string;
}

interface EventForEmbed {
  id: number;
  name: string;
  status: string;
  description: string | null;
  dungeon: { name: string } | null;
  minKeyLevel: number;
  maxKeyLevel: number;
  startsAt: string;
  endsAt: string;
}

function buildRosterEmbed(event: EventForEmbed, signups: SignupForRoster[]): EmbedBuilder {
  const confirmed = signups.filter((s) => s.signupStatus === "confirmed");
  const tentative = signups.filter((s) => s.signupStatus === "tentative");

  const tanks = confirmed.filter((s) => s.rolePreference === "tank");
  const healers = confirmed.filter((s) => s.rolePreference === "healer");
  const dps = confirmed.filter((s) => s.rolePreference === "dps");

  const formatMember = (s: SignupForRoster, i: number): string => {
    const tag = s.hasCompanionApp ? " ⚡" : "";
    const specLabel = s.spec ? ` (${s.spec})` : "";
    return `${i + 1}. **${s.characterName}** - ${s.realm}${specLabel}${tag}`;
  };

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${event.name}`)
    .setColor(event.status === "open" ? 0x3ba55d : event.status === "in_progress" ? 0xffcc00 : 0x888888)
    .setDescription(event.description || "_No description_");

  // Event info
  const startTs = Math.floor(new Date(event.startsAt).getTime() / 1000);
  const endTs = Math.floor(new Date(event.endsAt).getTime() / 1000);
  embed.addFields(
    { name: "Dungeon", value: event.dungeon?.name || "Any", inline: true },
    { name: "Key Range", value: `+${event.minKeyLevel} – +${event.maxKeyLevel}`, inline: true },
    { name: "Time", value: `<t:${startTs}:F> — <t:${endTs}:t>`, inline: false },
  );

  // Roster sections
  embed.addFields({
    name: `🛡 Tanks (${tanks.length})`,
    value: tanks.length > 0 ? tanks.map(formatMember).join("\n") : "_None yet_",
    inline: false,
  });
  embed.addFields({
    name: `💚 Healers (${healers.length})`,
    value: healers.length > 0 ? healers.map(formatMember).join("\n") : "_None yet_",
    inline: false,
  });
  embed.addFields({
    name: `⚔ DPS (${dps.length})`,
    value: dps.length > 0 ? dps.map(formatMember).join("\n") : "_None yet_",
    inline: false,
  });

  if (tentative.length > 0) {
    embed.addFields({
      name: `❓ Tentative (${tentative.length})`,
      value: tentative.map((s, i) => formatMember(s, i)).join("\n"),
      inline: false,
    });
  }

  embed.setFooter({ text: `Event #${event.id} · ${confirmed.length} confirmed` });

  return embed;
}

function buildEventButtons(eventId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event-signup:${eventId}`)
      .setLabel("Sign Up")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`event-tentative:${eventId}`)
      .setLabel("Tentative")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`event-decline:${eventId}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger),
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function parseEventId(customId: string): number {
  const parts = customId.split(":");
  return parseInt(parts[1] ?? "0", 10);
}

async function updateEventEmbed(eventId: number, client: Client): Promise<void> {
  await withEditLock(eventId, async () => {
    try {
      const { event } = await apiClient.getEvent(eventId);
      if (!event.discordMessageId || !event.discordChannelId) return;

      const signups: SignupForRoster[] = (event.signups || []).map((s) => ({
        characterName: s.character.name,
        realm: s.character.realm,
        classSlug: s.character.class,
        spec: s.spec ?? null,
        rolePreference: s.rolePreference,
        hasCompanionApp: s.character.hasCompanionApp ?? false,
        signupStatus: s.signupStatus ?? "confirmed",
      }));

      const embed = buildRosterEmbed(event, signups);
      const buttons = buildEventButtons(eventId);

      const channel = await client.channels.fetch(event.discordChannelId) as TextChannel | null;
      if (!channel) return;
      const message = await channel.messages.fetch(event.discordMessageId);
      await message.edit({ embeds: [embed], components: [buttons] });
    } catch (err) {
      console.error(`Failed to update embed for event ${eventId}:`, err);
    }
  });
}

function buildSpecSelect(eventId: number, characterId: number, classSlug: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const cls = CLASSES[classSlug];
  if (!cls) {
    // Unknown class — offer role selection instead
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`event-role-direct:${eventId}:${characterId}`)
        .setPlaceholder("Select your role")
        .addOptions(
          { label: "Tank", value: "tank" },
          { label: "Healer", value: "healer" },
          { label: "DPS", value: "dps" },
        ),
    );
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`event-spec:${eventId}:${characterId}`)
      .setPlaceholder("Select your spec for this event")
      .addOptions(
        cls.specs.map((spec: SpecDefinition) => ({
          label: `${spec.name} (${spec.role.toUpperCase()})`,
          value: spec.name,
        })),
      ),
  );
}

// ── Handlers ─────────────────────────────────────────────────────

async function handleSignupButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const eventId = parseEventId(interaction.customId);

  const { characters } = await apiClient.getUserCharacters(interaction.user.id);

  if (characters.length > 0) {
    // Show character select menu
    const options = characters.map((c: UserCharacter) => ({
      label: `${c.name} - ${c.realm} (${CLASSES[c.class]?.name ?? c.class})`,
      description: `${c.rioScore} RIO${c.hasCompanionApp ? " · ⚡ Companion" : ""}`,
      value: c.id.toString(),
    }));
    options.push({ label: "Enter manually...", description: "Type character name and realm", value: "manual" });

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`event-char:${eventId}`)
        .setPlaceholder("Select your character")
        .addOptions(options),
    );

    await interaction.editReply({ content: "Which character are you signing up with?", components: [row] });
  } else {
    // No linked characters — show manual modal
    await showManualModal(interaction, eventId);
  }
}

async function handleTentativeButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const eventId = parseEventId(interaction.customId);

  try {
    await apiClient.eventSignup({
      eventId,
      discordId: interaction.user.id,
      characterName: interaction.user.displayName,
      characterRealm: "unknown",
      characterRegion: "us",
      rolePreference: "dps",
    });
    await interaction.editReply("✅ You're marked as **tentative**. Update to confirmed by clicking Sign Up.");
    await updateEventEmbed(eventId, client);
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
    } else {
      await interaction.editReply("❌ Something went wrong.");
    }
  }
}

async function handleDeclineButton(interaction: ButtonInteraction, _client: Client): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply("👍 You've declined this event.");
}

async function handleCharSelect(interaction: StringSelectMenuInteraction, client: Client): Promise<void> {
  const eventId = parseEventId(interaction.customId);
  const value = interaction.values[0]!;

  if (value === "manual") {
    // Defer then show modal — can't show modal after deferUpdate
    await showManualModal(interaction, eventId);
    return;
  }

  await interaction.deferUpdate();
  const characterId = parseInt(value, 10);

  // Fetch the character's class to build spec dropdown
  const { characters } = await apiClient.getUserCharacters(interaction.user.id);
  const char = characters.find((c: UserCharacter) => c.id === characterId);
  if (!char) {
    await interaction.editReply({ content: "❌ Character not found.", components: [] });
    return;
  }

  const specRow = buildSpecSelect(eventId, characterId, char.class);
  await interaction.editReply({
    content: `Selected **${char.name}** - ${char.realm}. Now pick your spec:`,
    components: [specRow],
  });
}

async function handleSpecSelect(interaction: StringSelectMenuInteraction, client: Client): Promise<void> {
  await interaction.deferUpdate();
  const parts = interaction.customId.split(":");
  const eventId = parseInt(parts[1] ?? "0", 10);
  const characterId = parseInt(parts[2] ?? "0", 10);
  const specName = interaction.values[0]!;

  // Fetch character to get name/realm/region/class
  const { characters } = await apiClient.getUserCharacters(interaction.user.id);
  const char = characters.find((c: UserCharacter) => c.id === characterId);
  if (!char) {
    await interaction.editReply({ content: "❌ Character not found.", components: [] });
    return;
  }

  // Derive role from spec
  const role = roleFromSpec(char.class, specName) ?? "dps";

  try {
    await apiClient.eventSignup({
      eventId,
      discordId: interaction.user.id,
      characterName: char.name,
      characterRealm: char.realm,
      characterRegion: char.region as "us" | "eu" | "kr" | "tw" | "cn",
      rolePreference: role,
    });

    await interaction.editReply({
      content: `✅ Signed up as **${specName} ${CLASSES[char.class]?.name ?? char.class}** (${role.toUpperCase()}) with **${char.name}**!`,
      components: [],
    });

    await updateEventEmbed(eventId, client);
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply({ content: `❌ ${err.message}`, components: [] });
    } else {
      await interaction.editReply({ content: "❌ Failed to sign up.", components: [] });
    }
  }
}

async function showManualModal(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  eventId: number,
): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(`event-manual:${eventId}`)
    .setTitle("Manual Event Signup")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("charName")
          .setLabel("Character Name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(12),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("realm")
          .setLabel("Realm")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g. Area 52, Stormrage"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("region")
          .setLabel("Region (us/eu/kr/tw/cn)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue("us")
          .setMaxLength(2),
      ),
    );

  await interaction.showModal(modal);
}

async function handleManualModal(interaction: ModalSubmitInteraction, client: Client): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const eventId = parseEventId(interaction.customId);

  const charName = interaction.fields.getTextInputValue("charName").trim();
  const realm = interaction.fields.getTextInputValue("realm").trim();
  const region = interaction.fields.getTextInputValue("region").trim().toLowerCase() || "us";

  // Check RaiderIO
  const lookup = await apiClient.raiderioLookup(charName, realm, region);

  if (lookup.found && lookup.character) {
    const c = lookup.character;

    // Store pending data and show spec select
    const id = nonce();
    pendingManuals.set(id, {
      eventId,
      discordUserId: interaction.user.id,
      name: c.name,
      realm: c.realm,
      region,
      classSlug: c.class,
      rioScore: c.rioScore,
    });

    // Build spec select for verified character
    const cls = CLASSES[c.class];
    if (cls) {
      const specRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`event-manual-spec:${id}`)
          .setPlaceholder("Select your spec for this event")
          .addOptions(
            cls.specs.map((spec: SpecDefinition) => ({
              label: `${spec.name} (${spec.role.toUpperCase()})`,
              value: spec.name,
            })),
          ),
      );
      await interaction.editReply({
        content: `✅ Found **${c.name}** on ${c.realm} — ${cls.name} (${c.rioScore} RIO). Select your spec:`,
        components: [specRow],
      });
    } else {
      await interaction.editReply({ content: "❌ Unknown class returned from RaiderIO.", components: [] });
    }
  } else {
    // Not found — offer confirm anyway
    const id = nonce();
    pendingManuals.set(id, {
      eventId,
      discordUserId: interaction.user.id,
      name: charName,
      realm,
      region,
      classSlug: null,
      rioScore: 0,
    });

    // Expire after 5 minutes
    setTimeout(() => pendingManuals.delete(id), 5 * 60 * 1000);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`event-confirm:${id}`)
        .setLabel("Confirm Anyway")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`event-cancel:${id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({
      content: `⚠️ Could not verify **${charName}** on **${realm}** (${region.toUpperCase()}) with RaiderIO. Character data will be unverified — class, spec, and RIO score unavailable.`,
      components: [row],
    });
  }
}

async function handleConfirmButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  await interaction.deferUpdate();
  const id = interaction.customId.split(":")[1]!;
  const pending = pendingManuals.get(id);

  if (!pending) {
    await interaction.editReply({ content: "❌ This signup expired. Please try again.", components: [] });
    return;
  }

  pendingManuals.delete(id);

  // Unverified — need role selection since we don't know class
  const roleRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`event-role:${pending.eventId}:${pending.name}:${pending.realm}:${pending.region}`)
      .setPlaceholder("Select your role")
      .addOptions(
        { label: "Tank", value: "tank" },
        { label: "Healer", value: "healer" },
        { label: "DPS", value: "dps" },
      ),
  );

  await interaction.editReply({
    content: `Signing up as **${pending.name}** - ${pending.realm} (unverified). Select your role:`,
    components: [roleRow],
  });
}

async function handleCancelButton(interaction: ButtonInteraction, _client: Client): Promise<void> {
  await interaction.deferUpdate();
  const id = interaction.customId.split(":")[1]!;
  pendingManuals.delete(id);
  await interaction.editReply({ content: "Signup cancelled.", components: [] });
}

async function handleManualSpecSelect(interaction: StringSelectMenuInteraction, client: Client): Promise<void> {
  await interaction.deferUpdate();
  const id = interaction.customId.split(":")[1]!;
  const pending = pendingManuals.get(id);

  if (!pending) {
    await interaction.editReply({ content: "❌ This signup expired. Please try again.", components: [] });
    return;
  }

  pendingManuals.delete(id);
  const specName = interaction.values[0]!;
  const role = (pending.classSlug ? roleFromSpec(pending.classSlug, specName) : null) ?? "dps";

  try {
    await apiClient.eventSignup({
      eventId: pending.eventId,
      discordId: pending.discordUserId,
      characterName: pending.name,
      characterRealm: pending.realm,
      characterRegion: pending.region as "us" | "eu" | "kr" | "tw" | "cn",
      rolePreference: role,
    });

    const className = pending.classSlug ? CLASSES[pending.classSlug]?.name ?? "" : "";
    await interaction.editReply({
      content: `✅ Signed up as **${specName} ${className}** (${role.toUpperCase()}) with **${pending.name}** - ${pending.realm}!`,
      components: [],
    });

    await updateEventEmbed(pending.eventId, client);
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply({ content: `❌ ${err.message}`, components: [] });
    } else {
      await interaction.editReply({ content: "❌ Failed to sign up.", components: [] });
    }
  }
}

async function handleRoleSelect(interaction: StringSelectMenuInteraction, client: Client): Promise<void> {
  await interaction.deferUpdate();
  const parts = interaction.customId.split(":");
  const eventId = parseInt(parts[1] ?? "0", 10);
  const charName = parts[2] ?? "";
  const realm = parts[3] ?? "";
  const region = parts[4] ?? "us";
  const role = interaction.values[0] as "tank" | "healer" | "dps";

  try {
    await apiClient.eventSignup({
      eventId,
      discordId: interaction.user.id,
      characterName: charName,
      characterRealm: realm,
      characterRegion: region as "us" | "eu" | "kr" | "tw" | "cn",
      rolePreference: role,
    });

    await interaction.editReply({
      content: `✅ Signed up as **${role.toUpperCase()}** with **${charName}** - ${realm} (unverified)!`,
      components: [],
    });

    await updateEventEmbed(eventId, client);
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply({ content: `❌ ${err.message}`, components: [] });
    } else {
      await interaction.editReply({ content: "❌ Failed to sign up.", components: [] });
    }
  }
}

// ── Export composite handler ─────────────────────────────────────

export const eventSignupHandler: ComponentHandler = {
  prefix: "event-signup",
  handleButton: handleSignupButton,
};

export const eventTentativeHandler: ComponentHandler = {
  prefix: "event-tentative",
  handleButton: handleTentativeButton,
};

export const eventDeclineHandler: ComponentHandler = {
  prefix: "event-decline",
  handleButton: handleDeclineButton,
};

export const eventCharHandler: ComponentHandler = {
  prefix: "event-char",
  handleSelectMenu: handleCharSelect,
};

export const eventSpecHandler: ComponentHandler = {
  prefix: "event-spec",
  handleSelectMenu: handleSpecSelect,
};

export const eventManualHandler: ComponentHandler = {
  prefix: "event-manual",
  handleModal: handleManualModal,
};

export const eventManualSpecHandler: ComponentHandler = {
  prefix: "event-manual-spec",
  handleSelectMenu: handleManualSpecSelect,
};

export const eventConfirmHandler: ComponentHandler = {
  prefix: "event-confirm",
  handleButton: handleConfirmButton,
};

export const eventCancelHandler: ComponentHandler = {
  prefix: "event-cancel",
  handleButton: handleCancelButton,
};

export const eventRoleHandler: ComponentHandler = {
  prefix: "event-role",
  handleSelectMenu: handleRoleSelect,
};
