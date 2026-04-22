/**
 * Component interaction registry.
 *
 * Each handler declares a customId prefix (e.g. "event-signup").
 * The router in index.ts matches incoming component interactions
 * by prefix and dispatches to the correct handler.
 *
 * Convention for customId: "{prefix}:{eventId}:{extra}"
 * e.g. "event-signup:42", "event-spec:42:shaman"
 */

import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  Client,
} from "discord.js";

export interface ComponentHandler {
  /** Prefix that customId must start with */
  prefix: string;
  handleButton?(interaction: ButtonInteraction, client: Client): Promise<void>;
  handleSelectMenu?(interaction: StringSelectMenuInteraction, client: Client): Promise<void>;
  handleModal?(interaction: ModalSubmitInteraction, client: Client): Promise<void>;
}

import {
  eventSignupHandler,
  eventTentativeHandler,
  eventEditHandler,
  eventRemoveHandler,
  eventSwitchTentativeHandler,
  eventSwitchConfirmedHandler,
  eventCharHandler,
  eventSpecHandler,
  eventFlexHandler,
  eventManualHandler,
  eventManualSpecHandler,
  eventConfirmHandler,
  eventCancelHandler,
  eventRoleHandler,
} from "./event-signup.js";
import {
  eventReadyCheckHandler,
  readyCheckCancelHandler,
  groupDisbandHandler,
} from "./ready-check.js";

const handlers: ComponentHandler[] = [
  eventSignupHandler,
  eventTentativeHandler,
  eventEditHandler,
  eventRemoveHandler,
  eventSwitchTentativeHandler,
  eventSwitchConfirmedHandler,
  eventCharHandler,
  eventSpecHandler,
  eventFlexHandler,
  eventManualHandler,
  eventManualSpecHandler,
  eventConfirmHandler,
  eventCancelHandler,
  eventRoleHandler,
  eventReadyCheckHandler,
  readyCheckCancelHandler,
  groupDisbandHandler,
];

/** Map of prefix → handler for fast lookup */
export const componentHandlers = new Map<string, ComponentHandler>();
for (const h of handlers) {
  componentHandlers.set(h.prefix, h);
}

/**
 * Find the handler whose prefix matches the start of a customId.
 * customId format: "prefix:rest" — we split on ":" and match the first segment.
 */
export function findHandler(customId: string): ComponentHandler | undefined {
  // Try progressively longer prefixes to handle "event-manual-spec" vs "event-manual"
  const parts = customId.split(":");
  const prefix = parts[0]!;

  // Direct match first
  const direct = componentHandlers.get(prefix);
  if (direct) return direct;

  // Try compound prefixes (e.g. "event-role-direct")
  for (const [key, handler] of componentHandlers) {
    if (customId.startsWith(key + ":")) return handler;
  }

  return undefined;
}
