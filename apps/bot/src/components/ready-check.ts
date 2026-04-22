/**
 * Ready Check component handlers — button + message rendering for the
 * RC flow described in docs/EVENT_READY_CHECK_SYSTEM.md §5, §7.
 *
 * Handles three custom IDs:
 *   event-ready-check:{eventId}         — "Ready Check" button on event embed
 *   rc-cancel:{eventId}:{readyCheckId}  — "Cancel my participation" button on RC message
 *   group-disband:{groupId}             — "Vote to disband" button on formed-group post
 *
 * Also exports helpers used by the Redis notification subscriber to
 * post and refresh the RC message and to post formed-group posts.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type Client,
  type TextChannel,
} from "discord.js";
import { apiClient, ApiError } from "../lib/api-client.js";
import type { ComponentHandler } from "./index.js";

// ── Message tracking ─────────────────────────────────────────────

/**
 * readyCheckId → { channelId, messageId } for the live RC message.
 * In-memory only; a bot restart loses the reference and we'll post a
 * new message on the next update. Acceptable because RC windows are
 * 5 minutes.
 */
const rcMessageRegistry = new Map<number, { channelId: string; messageId: string }>();

const ROLE_ICON: Record<string, string> = { tank: "🛡", healer: "💚", dps: "⚔" };
const SLOT_LABEL: Record<string, string> = {
  tank: "🛡 Tank",
  healer: "💚 Healer",
  dps1: "⚔ DPS 1",
  dps2: "⚔ DPS 2",
  dps3: "⚔ DPS 3",
};

// ── Ready Check button on the event embed ────────────────────────

async function handleReadyCheckButton(
  interaction: ButtonInteraction,
  _client: Client,
): Promise<void> {
  const eventId = parseInt(interaction.customId.split(":")[1] ?? "0", 10);
  if (!eventId) {
    await interaction.reply({ content: "❌ Invalid event.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await apiClient.readyCheckStartOrJoin(eventId, interaction.user.id);
    const expires = Math.floor(new Date(result.expiresAt).getTime() / 1000);
    const msg = result.startedNew
      ? `✅ **Ready Check started!** Window closes <t:${expires}:R>. Watch for the Ready Check post in this channel — others can join until expiry.`
      : `✅ **Joined the Ready Check.** Window closes <t:${expires}:R>.`;
    await interaction.editReply(msg);
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }
    console.error("ready-check button error:", err);
    await interaction.editReply("❌ Something went wrong starting the Ready Check.");
  }
}

// ── Cancel participation button on the RC message ────────────────

async function handleCancelButton(
  interaction: ButtonInteraction,
  _client: Client,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const eventId = parseInt(parts[1] ?? "0", 10);
  const readyCheckId = parseInt(parts[2] ?? "0", 10);
  if (!eventId || !readyCheckId) {
    await interaction.reply({ content: "❌ Invalid Ready Check.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  try {
    await apiClient.readyCheckCancel(eventId, readyCheckId, interaction.user.id);
    await interaction.editReply(
      "✅ You've been removed from this Ready Check. You can click Ready Check again if you change your mind.",
    );
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }
    console.error("ready-check cancel error:", err);
    await interaction.editReply("❌ Something went wrong.");
  }
}

// ── Vote-to-disband button on the formed-group post ──────────────

async function handleDisbandVoteButton(
  interaction: ButtonInteraction,
  _client: Client,
): Promise<void> {
  const groupId = parseInt(interaction.customId.split(":")[1] ?? "0", 10);
  if (!groupId) {
    await interaction.reply({ content: "❌ Invalid group.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await apiClient.disbandVote(groupId, interaction.user.id);
    if (result.disbanded) {
      await interaction.editReply(
        `🛑 Group disbanded — ${result.voteCount}/${result.required} votes reached. Members are released back to the pool.`,
      );
    } else {
      await interaction.editReply(
        `🗳️ Vote recorded (${result.voteCount}/${result.required}). Another teammate needs to vote to disband.`,
      );
    }
  } catch (err) {
    if (err instanceof ApiError) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }
    console.error("disband-vote error:", err);
    await interaction.editReply("❌ Something went wrong.");
  }
}

// ── Ready Check message rendering ────────────────────────────────

interface RCParticipantView {
  characterName: string;
  realm: string;
  primaryRole: "tank" | "healer" | "dps";
  flexRole: "tank" | "healer" | "dps" | "none";
  priorityFlag: boolean;
}

function buildRCEmbed(opts: {
  eventName: string;
  eventId: number;
  readyCheckId: number;
  expiresAt: Date;
  participants: RCParticipantView[];
}): EmbedBuilder {
  const expires = Math.floor(opts.expiresAt.getTime() / 1000);
  const tanks = opts.participants.filter((p) => p.primaryRole === "tank");
  const healers = opts.participants.filter((p) => p.primaryRole === "healer");
  const dps = opts.participants.filter((p) => p.primaryRole === "dps");

  const formatOne = (p: RCParticipantView): string => {
    const flex = p.flexRole !== "none" ? ` · flex ${ROLE_ICON[p.flexRole] ?? p.flexRole}` : "";
    const star = p.priorityFlag ? " ⭐" : "";
    return `• **${p.characterName}**-${p.realm}${flex}${star}`;
  };

  const embed = new EmbedBuilder()
    .setTitle(`⚡ Ready Check — ${opts.eventName}`)
    .setColor(0x3498db)
    .setDescription(
      `Click **Ready Check** on the event embed to join. Groups form when the window closes <t:${expires}:R>.`,
    )
    .addFields(
      { name: `🛡 Tanks (${tanks.length})`, value: tanks.length ? tanks.map(formatOne).join("\n") : "_none yet_", inline: true },
      { name: `💚 Healers (${healers.length})`, value: healers.length ? healers.map(formatOne).join("\n") : "_none yet_", inline: true },
      { name: `⚔ DPS (${dps.length})`, value: dps.length ? dps.map(formatOne).join("\n") : "_none yet_", inline: true },
    )
    .setFooter({
      text: `Event #${opts.eventId} · RC #${opts.readyCheckId} · ${opts.participants.length} checked in · ⭐ = priority flag`,
    });
  return embed;
}

function buildRCButtons(
  eventId: number,
  readyCheckId: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`rc-cancel:${eventId}:${readyCheckId}`)
      .setLabel("Cancel my participation")
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Post a fresh RC message, or edit the existing one if we have a
 * reference. Called from the Redis subscriber on `ready_check_updated`.
 */
export async function postOrUpdateReadyCheckMessage(
  client: Client,
  opts: {
    eventId: number;
    readyCheckId: number;
    channelId: string;
    eventName: string;
    expiresAt: Date;
    participants: RCParticipantView[];
  },
): Promise<void> {
  const embed = buildRCEmbed(opts);
  const components = [buildRCButtons(opts.eventId, opts.readyCheckId)];

  const existing = rcMessageRegistry.get(opts.readyCheckId);
  try {
    const channel = (await client.channels.fetch(opts.channelId)) as TextChannel | null;
    if (!channel) return;

    if (existing && existing.channelId === opts.channelId) {
      try {
        const msg = await channel.messages.fetch(existing.messageId);
        await msg.edit({ embeds: [embed], components });
        return;
      } catch {
        // Message was deleted or can't be fetched — fall through to repost
        rcMessageRegistry.delete(opts.readyCheckId);
      }
    }

    const msg = await channel.send({ embeds: [embed], components });
    rcMessageRegistry.set(opts.readyCheckId, {
      channelId: opts.channelId,
      messageId: msg.id,
    });
  } catch (err) {
    console.error(`Failed to post/update RC message for event #${opts.eventId}:`, err);
  }
}

/**
 * Convert an active RC message into a "Groups Formed" summary after
 * expiry. Removes the Cancel button and replaces the body.
 */
export async function finalizeReadyCheckMessage(
  client: Client,
  opts: {
    readyCheckId: number;
    eventName: string;
    groupCount: number;
    bouncedCount: number;
  },
): Promise<void> {
  const existing = rcMessageRegistry.get(opts.readyCheckId);
  if (!existing) return;

  try {
    const channel = (await client.channels.fetch(existing.channelId)) as TextChannel | null;
    if (!channel) return;
    const msg = await channel.messages.fetch(existing.messageId);

    const embed = new EmbedBuilder()
      .setTitle(`✅ Ready Check complete — ${opts.eventName}`)
      .setColor(0x3ba55d)
      .setDescription(
        `${opts.groupCount} group${opts.groupCount === 1 ? "" : "s"} formed.` +
          (opts.bouncedCount > 0
            ? ` ${opts.bouncedCount} player${opts.bouncedCount === 1 ? "" : "s"} bounced with priority for next Ready Check.`
            : ""),
      )
      .setFooter({ text: `RC #${opts.readyCheckId}` });

    await msg.edit({ embeds: [embed], components: [] });
  } catch (err) {
    console.error(
      `Failed to finalize RC message for ready-check #${opts.readyCheckId}:`,
      err,
    );
  } finally {
    rcMessageRegistry.delete(opts.readyCheckId);
  }
}

// ── Formed-group post (one per group) ────────────────────────────

export interface FormedGroupView {
  groupId: number;
  name: string;
  slots: Array<{
    position: "tank" | "healer" | "dps1" | "dps2" | "dps3";
    participant: null | {
      characterName: string;
      realm: string;
      classSlug: string;
      primaryRole: "tank" | "healer" | "dps";
      flexRole: "tank" | "healer" | "dps" | "none";
    };
  }>;
}

export function buildGroupEmbed(eventName: string, group: FormedGroupView): EmbedBuilder {
  const lines = group.slots.map((s) => {
    const label = SLOT_LABEL[s.position] ?? s.position;
    if (!s.participant) {
      return `${label}: _open — fill with a PUG in game_`;
    }
    const p = s.participant;
    const flexNote =
      p.flexRole !== "none" && p.flexRole !== p.primaryRole
        ? ` *(flexed from ${p.primaryRole})*`
        : "";
    return `${label}: **${p.characterName}**-${p.realm}${flexNote}`;
  });

  return new EmbedBuilder()
    .setTitle(`🎯 ${group.name} — ${eventName}`)
    .setColor(0xffcc00)
    .setDescription(lines.join("\n"))
    .setFooter({
      text: `Group #${group.groupId} · Vote to disband needs 2 members · Auto-disband after 2h or at event end`,
    });
}

export function buildGroupButtons(groupId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`group-disband:${groupId}`)
      .setLabel("Vote to disband")
      .setStyle(ButtonStyle.Danger),
  );
}

// ── Handler exports ──────────────────────────────────────────────

export const eventReadyCheckHandler: ComponentHandler = {
  prefix: "event-ready-check",
  handleButton: handleReadyCheckButton,
};

export const readyCheckCancelHandler: ComponentHandler = {
  prefix: "rc-cancel",
  handleButton: handleCancelButton,
};

export const groupDisbandHandler: ComponentHandler = {
  prefix: "group-disband",
  handleButton: handleDisbandVoteButton,
};
