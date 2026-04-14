/**
 * Individual run scoring — pure function.
 *
 * Derived directly from MPLUS_PLATFORM.md "Points Scoring Formula":
 *
 *   Base = keystoneLevel × 100
 *
 *   Time Modifier:
 *     Depleted:   × 0.5
 *     Timed:      × 1.0
 *     Timed +1:   × 1.2
 *     Timed +2:   × 1.35
 *     Timed +3:   × 1.5
 *
 *   Bonuses:
 *     0 deaths:                    +150 pts
 *     Personal dungeon record:     +200 pts
 *     Personal overall record:     +500 pts
 *     Event participation:         +100 pts
 *
 * Group score = sum of member scores. That lives in a different service
 * because it needs DB state.
 *
 * This function is intentionally dependency-free: give it the facts,
 * get back an integer + breakdown. Unit testable without a DB.
 */

export interface ScoringInput {
  keystoneLevel: number;
  /** 0 = depleted, 1 = timed, 2 = +1, 3 = +2, 4 = +3 */
  upgrades: 0 | 1 | 2 | 3;
  /** True if the run beat par time */
  onTime: boolean;
  deaths: number;
  /** True if this is the player's personal best for this specific dungeon */
  isPersonalDungeonRecord: boolean;
  /** True if this is the player's highest-scored run across all dungeons */
  isPersonalOverallRecord: boolean;
  /** True if the run was part of an organized event */
  isEventParticipation: boolean;
}

export interface ScoringBreakdown {
  base: number;
  timeModifier: number;
  afterModifier: number;
  bonuses: {
    noDeaths: number;
    personalDungeonRecord: number;
    personalOverallRecord: number;
    eventParticipation: number;
  };
  total: number;
}

const TIME_MODIFIERS = {
  depleted: 0.5,
  timed: 1.0,
  plus1: 1.2,
  plus2: 1.35,
  plus3: 1.5,
} as const;

const BONUS_NO_DEATHS = 150;
const BONUS_PERSONAL_DUNGEON_RECORD = 200;
const BONUS_PERSONAL_OVERALL_RECORD = 500;
const BONUS_EVENT_PARTICIPATION = 100;

function modifierFor(upgrades: number, onTime: boolean): number {
  if (!onTime) return TIME_MODIFIERS.depleted;
  if (upgrades >= 3) return TIME_MODIFIERS.plus3;
  if (upgrades === 2) return TIME_MODIFIERS.plus2;
  if (upgrades === 1) return TIME_MODIFIERS.plus1;
  return TIME_MODIFIERS.timed;
}

export function scoreRun(input: ScoringInput): ScoringBreakdown {
  const base = input.keystoneLevel * 100;
  const timeModifier = modifierFor(input.upgrades, input.onTime);
  const afterModifier = Math.round(base * timeModifier);

  const bonuses = {
    noDeaths: input.deaths === 0 ? BONUS_NO_DEATHS : 0,
    personalDungeonRecord: input.isPersonalDungeonRecord
      ? BONUS_PERSONAL_DUNGEON_RECORD
      : 0,
    personalOverallRecord: input.isPersonalOverallRecord
      ? BONUS_PERSONAL_OVERALL_RECORD
      : 0,
    eventParticipation: input.isEventParticipation ? BONUS_EVENT_PARTICIPATION : 0,
  };

  const total =
    afterModifier +
    bonuses.noDeaths +
    bonuses.personalDungeonRecord +
    bonuses.personalOverallRecord +
    bonuses.eventParticipation;

  return {
    base,
    timeModifier,
    afterModifier,
    bonuses,
    total,
  };
}
