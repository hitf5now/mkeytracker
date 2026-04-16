/**
 * Shared user & character types used by API, bot, web, and companion.
 */

export type Region = "us" | "eu" | "kr" | "tw" | "cn";

export type WowRole = "tank" | "healer" | "dps";

export type WowClass =
  | "death-knight"
  | "demon-hunter"
  | "druid"
  | "evoker"
  | "hunter"
  | "mage"
  | "monk"
  | "paladin"
  | "priest"
  | "rogue"
  | "shaman"
  | "warlock"
  | "warrior";

export interface UserPublic {
  id: number;
  discordId: string;
  battleTag: string | null;
  timezone: string | null;
  isMentor: boolean;
  mentorJuice: number;
}

export interface CharacterPublic {
  id: number;
  userId: number;
  name: string;
  realm: string;
  region: Region;
  class: WowClass;
  spec: string;
  role: WowRole;
  rioScore: number;
}
