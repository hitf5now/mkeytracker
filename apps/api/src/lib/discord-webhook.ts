/**
 * Minimal Discord webhook client.
 *
 * Discord webhooks accept a JSON payload over HTTPS — no bot token,
 * no intents, no discord.js dependency. Perfect for fire-and-forget
 * announcements from server-side code.
 *
 * https://discord.com/developers/docs/resources/webhook#execute-webhook
 *
 * All API send functions are fire-and-forget: they never throw, and
 * they swallow network errors after logging. A webhook failure must
 * not break a run submission.
 */

import { CLASSES } from "@mplus/wow-constants";

/**
 * Minimal structural type matching both Fastify and pino loggers.
 * Decouples this module from a specific logger implementation.
 */
interface LoggerLike {
  warn: (obj: object, msg?: string) => void;
  debug: (objOrMsg: object | string, msg?: string) => void;
}

const TIMED_COLOR = 0x3ba55d; // Discord green
const DEPLETED_COLOR = 0xed4245; // Discord red

interface WebhookEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface WebhookEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: WebhookEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

interface WebhookPayload {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: WebhookEmbed[];
}

/**
 * Low-level POST. Returns `true` on success, `false` on failure.
 * Never throws.
 */
export async function postWebhook(
  url: string,
  payload: WebhookPayload,
  logger?: LoggerLike,
): Promise<boolean> {
  if (!url) return false;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable>");
      logger?.warn(
        { status: response.status, body: body.slice(0, 400) },
        "Discord webhook non-OK response",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger?.warn({ err }, "Discord webhook request failed");
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Domain-specific embed builders
// ──────────────────────────────────────────────────────────────

export interface RunCompletedEmbedInput {
  dungeonName: string;
  keystoneLevel: number;
  onTime: boolean;
  upgrades: 0 | 1 | 2 | 3;
  completionMs: number;
  parMs: number;
  deaths: number;
  juice: number;
  affixes?: number[];
  /** Party members, ordered tank → healer → dps */
  members: Array<{
    name: string;
    realm: string;
    class: string;
    role: "tank" | "healer" | "dps";
  }>;
  /** Full RIO URL of one of the players (for click-through), optional */
  profileUrl?: string;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatResult(input: RunCompletedEmbedInput): string {
  if (!input.onTime) {
    const over = input.completionMs - input.parMs;
    return `❌ **Depleted** — ${formatDuration(over)} over par`;
  }
  const under = input.parMs - input.completionMs;
  const upgradeLabel =
    input.upgrades === 0 ? "Timed" : `Timed **+${input.upgrades}**`;
  return `✅ ${upgradeLabel} — ${formatDuration(under)} under par`;
}

const ROLE_ICON: Record<string, string> = {
  tank: "🛡",
  healer: "💚",
  dps: "⚔",
};

/**
 * Picks a dominant color for the embed: green if timed, red if depleted.
 * Ignores class colors at the embed level since the party is mixed.
 */
function colorFor(input: RunCompletedEmbedInput): number {
  return input.onTime ? TIMED_COLOR : DEPLETED_COLOR;
}

export function buildRunCompletedEmbed(input: RunCompletedEmbedInput): WebhookEmbed {
  const partyLines = input.members.map((m) => {
    const classDisplay = CLASSES[m.class]?.name ?? m.class.replace(/-/g, " ");
    return `${ROLE_ICON[m.role] ?? "•"}  **${m.name}** — ${classDisplay}`;
  });

  const title = `${input.dungeonName} +${input.keystoneLevel}`;
  const description = formatResult(input);

  return {
    title,
    url: input.profileUrl,
    description,
    color: colorFor(input),
    fields: [
      {
        name: "Party",
        value: partyLines.join("\n"),
        inline: false,
      },
      {
        name: "Time",
        value: formatDuration(input.completionMs),
        inline: true,
      },
      {
        name: "Deaths",
        value: String(input.deaths),
        inline: true,
      },
      {
        name: "Juice",
        value: input.juice.toLocaleString(),
        inline: true,
      },
    ],
    footer: { text: "M+ Challenge Platform" },
    timestamp: new Date().toISOString(),
  };
}

