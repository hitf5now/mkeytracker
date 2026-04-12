/**
 * Slash command registry.
 *
 * Each command module exports a `Command` object with its builder (for
 * deployment) and its execute function (for runtime). This file collects
 * them into a Map keyed by command name.
 */

import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import { leaderboardCommand } from "./leaderboard.js";
import { linkCommand } from "./link.js";
import { pingCommand } from "./ping.js";
import { profileCommand } from "./profile.js";
import { registerCommand } from "./register.js";
import { setupCommand } from "./setup.js";

export type CommandBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;

export interface Command {
  data: CommandBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export const commands: Map<string, Command> = new Map([
  [pingCommand.data.name, pingCommand],
  [registerCommand.data.name, registerCommand],
  [linkCommand.data.name, linkCommand],
  [setupCommand.data.name, setupCommand],
  [profileCommand.data.name, profileCommand],
  [leaderboardCommand.data.name, leaderboardCommand],
]);

export function allCommands(): Command[] {
  return Array.from(commands.values());
}
