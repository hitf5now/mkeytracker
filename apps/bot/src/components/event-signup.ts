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
  discordUserId: string | null;
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
    const className = CLASSES[s.classSlug]?.name ?? s.classSlug;
    const specClass = s.spec ? `${s.spec} ${className}` : className;
    const userMention = s.discordUserId ? `<@${s.discordUserId}>` : s.characterName;
    return `${i + 1}. ${userMention} — ${specClass} (${s.characterName})${tag}`;
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

export function buildEventButtons(
  eventId: number,
  eventStatus: string,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event-signup:${eventId}`)
      .setLabel("Sign Up")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`event-tentative:${eventId}`)
      .setLabel("Tentative")
      .setStyle(ButtonStyle.Secondary),
  );
  // Ready Check only available while the event is actively running.
  if (eventStatus === "in_progress") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`event-ready-check:${eventId}`)
        .setLabel("Ready Check")
        .setEmoji("⚡")
        .setStyle(ButtonStyle.Primary),
    );
  }
  return row;
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
        discordUserId: s.discordUserId ?? null,
      }));

      const embed = buildRosterEmbed(event, signups);
      const buttons = buildEventButtons(eventId, event.status);

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

async function verifyGuildScope(eventId: number, guildId: string | null): Promise<string | null> {
  if (!guildId) return null;
  try {
    const { event } = await apiClient.getEvent(eventId);
    if (event.discordGuildId && event.discordGuildId !== guildId) {
      return "This event belongs to a different server.";
    }
  } catch {
    // If we can't fetch the event, let the signup attempt handle the error
  }
  return null;
}

async function handleSignupButton(interaction: ButtonInteraction, _client: Client): Promise<void> {
  const eventId = parseEventId(interaction.customId);

  // IMPORTANT: do NOT deferReply yet. If the user has no linked characters
  // we need to fall through to showManualModal(), and showModal() must be
  // the FIRST response to an interaction — it can't follow a deferReply.
  // Run the cheap pre-checks first and only defer once we know we're
  // committing to an editReply / reply path.

  const scopeError = await verifyGuildScope(eventId, interaction.guildId);
  if (scopeError) {
    await interaction.reply({ content: `❌ ${scopeError}`, ephemeral: true });
    return;
  }

  const check = await apiClient.signupCheck(eventId, interaction.user.id);

  if (check.hasSignup && check.signup) {
    const s = check.signup;
    const className = CLASSES[s.characterClass]?.name ?? s.characterClass;
    const specLabel = s.spec ? `${s.spec} ${className}` : className;
    const statusLabel = s.signupStatus === "tentative" ? " (tentative)" : "";

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`event-edit:${eventId}`)
        .setLabel("Edit Signup")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(
          s.signupStatus === "confirmed"
            ? `event-switch-tentative:${eventId}`
            : `event-switch-confirmed:${eventId}`,
        )
        .setLabel(s.signupStatus === "confirmed" ? "Switch to Tentative" : "Switch to Confirmed")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`event-remove:${eventId}`)
        .setLabel("Remove Signup")
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.reply({
      content: `You're already signed up as **${specLabel}** (${s.rolePreference.toUpperCase()}) with **${s.characterName}**${statusLabel}. What would you like to do?`,
      components: [row],
      ephemeral: true,
    });
    return;
  }

  // No existing signup — peek at character list to decide reply-vs-modal.
  const { characters } = await apiClient.getUserCharacters(interaction.user.id);

  if (characters.length === 0) {
    // No linked characters → manual entry modal. Must be the first response.
    await showManualModal(interaction, eventId);
    return;
  }

  // Has characters — show the picker via reply (no defer needed).
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

  await interaction.reply({
    content: "Which character are you signing up with?",
    components: [row],
    ephemeral: true,
  });
}

/**
 * Render the character picker. Caller MUST have already deferred the
 * interaction (deferReply or deferUpdate) — we use editReply here.
 *
 * Note: this function intentionally does NOT fall through to showManualModal
 * for the zero-character case. showModal can't be called after a defer, so
 * the no-characters path must be handled by entry-point callers (which
 * choose reply-vs-modal before deferring).
 */
async function startSignupFlow(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  eventId: number,
): Promise<void> {
  const { characters } = await apiClient.getUserCharacters(interaction.user.id);

  if (characters.length === 0) {
    // Should be unreachable from current callers, but defend against it
    // rather than crashing with InteractionAlreadyReplied.
    await interaction.editReply({
      content:
        "❌ No linked characters found on your account. Click **Sign Up** on the event embed to enter character details manually.",
      components: [],
    });
    return;
  }

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
}

async function handleTentativeButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  const eventId = parseEventId(interaction.customId);

  // Same constraint as handleSignupButton: no defer until we know we won't
  // need to showModal (which must be the first response).
  const scopeError = await verifyGuildScope(eventId, interaction.guildId);
  if (scopeError) {
    await interaction.reply({ content: `❌ ${scopeError}`, ephemeral: true });
    return;
  }

  const check = await apiClient.signupCheck(eventId, interaction.user.id);

  if (check.hasSignup && check.signup) {
    if (check.signup.signupStatus === "tentative") {
      await interaction.reply({
        content: "You're already marked as tentative. Click **Sign Up** to switch to confirmed or edit your signup.",
        ephemeral: true,
      });
      return;
    }
    // Switch from confirmed to tentative — safe to defer here, no modal path.
    await interaction.deferReply({ ephemeral: true });
    try {
      await apiClient.eventSignup({
        eventId,
        discordId: interaction.user.id,
        characterName: check.signup.characterName,
        characterRealm: check.signup.characterRealm,
        characterRegion: "us",
        rolePreference: check.signup.rolePreference as "tank" | "healer" | "dps",
        signupStatus: "tentative",
      });
      await interaction.editReply("✅ Switched to **tentative**. Click **Sign Up** to confirm when you're sure.");
      await updateEventEmbed(eventId, client);
    } catch (err) {
      await interaction.editReply(err instanceof ApiError ? `❌ ${err.message}` : "❌ Something went wrong.");
    }
    return;
  }

  // No existing signup — peek at character list to decide reply-vs-modal.
  const { characters } = await apiClient.getUserCharacters(interaction.user.id);

  if (characters.length === 0) {
    await showManualModal(interaction, eventId);
    return;
  }

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

  await interaction.reply({
    content: "Which character are you signing up with?",
    components: [row],
    ephemeral: true,
  });
}

async function handleEditButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  await interaction.deferUpdate();
  const eventId = parseEventId(interaction.customId);
  await startSignupFlow(interaction, eventId);
}

async function handleRemoveButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  await interaction.deferUpdate();
  const eventId = parseEventId(interaction.customId);

  try {
    await apiClient.removeSignup(eventId, interaction.user.id);
    await interaction.editReply({ content: "✅ Your signup has been removed. You can sign up again anytime.", components: [] });
    await updateEventEmbed(eventId, client);
  } catch (err) {
    await interaction.editReply({ content: err instanceof ApiError ? `❌ ${err.message}` : "❌ Something went wrong.", components: [] });
  }
}

async function handleSwitchTentativeButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  await interaction.deferUpdate();
  const eventId = parseEventId(interaction.customId);

  const check = await apiClient.signupCheck(eventId, interaction.user.id);
  if (!check.hasSignup || !check.signup) {
    await interaction.editReply({ content: "❌ No signup found.", components: [] });
    return;
  }

  try {
    await apiClient.eventSignup({
      eventId,
      discordId: interaction.user.id,
      characterName: check.signup.characterName,
      characterRealm: check.signup.characterRealm,
      characterRegion: "us",
      rolePreference: check.signup.rolePreference as "tank" | "healer" | "dps",
      signupStatus: "tentative",
    });
    await interaction.editReply({ content: "✅ Switched to **tentative**.", components: [] });
    await updateEventEmbed(eventId, client);
  } catch (err) {
    await interaction.editReply({ content: err instanceof ApiError ? `❌ ${err.message}` : "❌ Something went wrong.", components: [] });
  }
}

async function handleSwitchConfirmedButton(interaction: ButtonInteraction, client: Client): Promise<void> {
  await interaction.deferUpdate();
  const eventId = parseEventId(interaction.customId);

  const check = await apiClient.signupCheck(eventId, interaction.user.id);
  if (!check.hasSignup || !check.signup) {
    await interaction.editReply({ content: "❌ No signup found.", components: [] });
    return;
  }

  try {
    await apiClient.eventSignup({
      eventId,
      discordId: interaction.user.id,
      characterName: check.signup.characterName,
      characterRealm: check.signup.characterRealm,
      characterRegion: "us",
      rolePreference: check.signup.rolePreference as "tank" | "healer" | "dps",
      signupStatus: "confirmed",
    });
    await interaction.editReply({ content: "✅ Switched to **confirmed**!", components: [] });
    await updateEventEmbed(eventId, client);
  } catch (err) {
    await interaction.editReply({ content: err instanceof ApiError ? `❌ ${err.message}` : "❌ Something went wrong.", components: [] });
  }
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

async function handleSpecSelect(interaction: StringSelectMenuInteraction, _client: Client): Promise<void> {
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

  // Now ask for flex role. customId encodes all the submission data so we
  // can finish the signup on their next click without re-fetching.
  const flexOptions = buildFlexOptions(role);
  const flexRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(
        `event-flex:${eventId}:${characterId}:${encodeURIComponent(specName)}:${role}`,
      )
      .setPlaceholder("Flex role (one you'd also fill)")
      .addOptions(flexOptions),
  );

  await interaction.editReply({
    content:
      `Selected **${specName} ${CLASSES[char.class]?.name ?? char.class}** (${role.toUpperCase()}). ` +
      `Pick a flex role — the matchmaker can pull you into that role if it unlocks another group.`,
    components: [flexRow],
  });
}

/** Build flex-role select menu options, excluding the user's primary role. */
function buildFlexOptions(
  primary: "tank" | "healer" | "dps",
): Array<{ label: string; value: string; description?: string }> {
  const all: Array<{ label: string; value: string; description: string }> = [
    { label: "Tank", value: "tank", description: "Can also fill tank" },
    { label: "Healer", value: "healer", description: "Can also fill healer" },
    { label: "DPS", value: "dps", description: "Can also fill DPS" },
    { label: "None — primary role only", value: "none", description: "Don't flex me" },
  ];
  return all.filter((o) => o.value !== primary);
}

async function handleFlexSelect(
  interaction: StringSelectMenuInteraction,
  client: Client,
): Promise<void> {
  await interaction.deferUpdate();
  const parts = interaction.customId.split(":");
  const eventId = parseInt(parts[1] ?? "0", 10);
  const characterId = parseInt(parts[2] ?? "0", 10);
  const specName = decodeURIComponent(parts[3] ?? "");
  const role = (parts[4] ?? "dps") as "tank" | "healer" | "dps";
  const flexRole = interaction.values[0] as "tank" | "healer" | "dps" | "none";

  const { characters } = await apiClient.getUserCharacters(interaction.user.id);
  const char = characters.find((c: UserCharacter) => c.id === characterId);
  if (!char) {
    await interaction.editReply({ content: "❌ Character not found.", components: [] });
    return;
  }

  try {
    await apiClient.eventSignup({
      eventId,
      discordId: interaction.user.id,
      characterName: char.name,
      characterRealm: char.realm,
      characterRegion: char.region as "us" | "eu" | "kr" | "tw" | "cn",
      rolePreference: role,
      flexRole,
      spec: specName,
      characterClass: char.class,
    });

    const flexLabel = flexRole === "none" ? "no flex" : `flex ${flexRole.toUpperCase()}`;
    await interaction.editReply({
      content: `✅ Signed up as **${specName} ${CLASSES[char.class]?.name ?? char.class}** (${role.toUpperCase()}, ${flexLabel}) with **${char.name}**!`,
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
      spec: specName,
      characterClass: pending.classSlug ?? undefined,
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

export const eventEditHandler: ComponentHandler = {
  prefix: "event-edit",
  handleButton: handleEditButton,
};

export const eventRemoveHandler: ComponentHandler = {
  prefix: "event-remove",
  handleButton: handleRemoveButton,
};

export const eventSwitchTentativeHandler: ComponentHandler = {
  prefix: "event-switch-tentative",
  handleButton: handleSwitchTentativeButton,
};

export const eventSwitchConfirmedHandler: ComponentHandler = {
  prefix: "event-switch-confirmed",
  handleButton: handleSwitchConfirmedButton,
};

export const eventCharHandler: ComponentHandler = {
  prefix: "event-char",
  handleSelectMenu: handleCharSelect,
};

export const eventSpecHandler: ComponentHandler = {
  prefix: "event-spec",
  handleSelectMenu: handleSpecSelect,
};

export const eventFlexHandler: ComponentHandler = {
  prefix: "event-flex",
  handleSelectMenu: handleFlexSelect,
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
