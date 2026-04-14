/**
 * Event Type Registry — centralized definitions for all event types.
 *
 * Each type defines its rules, scoring description, Juice table, and
 * supported modes. The web create form and event detail pages read
 * from this registry to auto-generate rules displays.
 */

export interface ScoringTableRow {
  label: string;
  juice: string;
}

export interface ConfigField {
  key: string;
  label: string;
  type: "number";
  default: number;
  min: number;
  max: number;
}

export interface EventTypeConfig {
  slug: string;
  label: string;
  description: string;
  rules: string[];
  winCondition: string;
  scoringDescription: string;
  juiceTable: ScoringTableRow[];
  supportedModes: ("group" | "team")[];
  configFields?: ConfigField[];
}

export const EVENT_TYPE_REGISTRY: Record<string, EventTypeConfig> = {
  fastest_clear_race: {
    slug: "fastest_clear_race",
    label: "Fastest Clear Race",
    description:
      "All groups/teams run the same dungeon. Fastest timed completion wins.",
    rules: [
      "All participants run the same dungeon (set by event organizer).",
      "Only timed runs count — depleted runs are not ranked.",
      "Fastest completion time wins.",
      "Tiebreaker: fewer deaths, then higher key level.",
    ],
    winCondition: "Lowest completion time among timed runs.",
    scoringDescription:
      "Runs are scored using the standard Juice system. Rankings are determined by completion time, not Juice.",
    juiceTable: [
      { label: "Base score", juice: "Key level x 100" },
      { label: "Time modifier", juice: "Depleted 0.5x, Timed 1.0x, +1 = 1.2x, +2 = 1.35x, +3 = 1.5x" },
      { label: "No deaths bonus", juice: "+150" },
      { label: "Event participation", juice: "+100" },
    ],
    supportedModes: ["group", "team"],
  },

  speed_sprint: {
    slug: "speed_sprint",
    label: "Speed Sprint",
    description:
      "30-minute window, single attempt per group/team. Best score wins.",
    rules: [
      "Each group/team gets one attempt within the event window.",
      "Only the first completed run counts — no retries.",
      "Highest run score wins.",
      "Event window is typically 30 minutes but set by the organizer.",
    ],
    winCondition: "Highest single-run score.",
    scoringDescription:
      "Standard scoring applies. Only your first completed run counts — make it count.",
    juiceTable: [
      { label: "Base score", juice: "Key level x 100" },
      { label: "Time modifier", juice: "Depleted 0.5x, Timed 1.0x, +1 = 1.2x, +2 = 1.35x, +3 = 1.5x" },
      { label: "No deaths bonus", juice: "+150" },
      { label: "Event participation", juice: "+100" },
    ],
    supportedModes: ["group", "team"],
  },

  random_draft: {
    slug: "random_draft",
    label: "Random Draft",
    description:
      "Players are randomly drafted into balanced groups. Groups compete on total score.",
    rules: [
      "Players sign up individually with their preferred role.",
      "The system auto-assigns balanced groups (1 tank, 1 healer, 3 DPS).",
      "Groups compete against each other on combined total score.",
      "All runs by group members during the event window count.",
    ],
    winCondition: "Group with the highest combined total score.",
    scoringDescription:
      "Each member's runs are scored individually. The group score is the sum of all member scores.",
    juiceTable: [
      { label: "Base score (per run)", juice: "Key level x 100" },
      { label: "Time modifier", juice: "Depleted 0.5x, Timed 1.0x, +1 = 1.2x, +2 = 1.35x, +3 = 1.5x" },
      { label: "No deaths bonus", juice: "+150 per run" },
      { label: "Event participation", juice: "+100 per run" },
      { label: "Group score", juice: "Sum of all member run scores" },
    ],
    supportedModes: ["group"],
  },

  key_climbing: {
    slug: "key_climbing",
    label: "Key Climbing",
    description:
      "Push progressively higher keys. Only your peak key level matters — climb as high as you can.",
    rules: [
      "Start at the event's minimum key level and push higher.",
      "Only your highest completed key counts for ranking.",
      "Depleted runs still count — you reached that level.",
      "Time doesn't matter for ranking — only the peak level.",
      "Tiebreaker: timed beats depleted, then faster time, then fewer deaths.",
    ],
    winCondition: "Highest keystone level completed (timed or depleted).",
    scoringDescription:
      "Ranking is based on the highest key completed. Bonus Juice rewards timed completions and clean runs at your peak.",
    juiceTable: [
      { label: "Peak level score", juice: "Highest key x 200" },
      { label: "Timed at peak", juice: "+500" },
      { label: "Clean peak (0 deaths)", juice: "+150" },
      { label: "Progression bonus", juice: "+50 per level above event minimum" },
      { label: "Event participation", juice: "+100" },
    ],
    supportedModes: ["group", "team"],
  },

  marathon: {
    slug: "marathon",
    label: "Marathon",
    description:
      "Complete as many keys as possible. Every run counts — quantity and consistency win.",
    rules: [
      "Complete as many keys as possible within the event window.",
      "Every timed run earns full Juice. Depleted runs earn half.",
      "Consecutive timed runs build a streak bonus.",
      "Running different dungeons earns a variety bonus (if event allows any dungeon).",
      "Runs beyond your 5th earn an endurance bonus.",
    ],
    winCondition: "Highest total accumulated score across all runs.",
    scoringDescription:
      "Standard scoring applies to each run, plus marathon-specific bonuses for streaks, variety, and endurance.",
    juiceTable: [
      { label: "Base score (per run)", juice: "Key level x 100 x time modifier" },
      { label: "Streak bonus", juice: "+100 per consecutive timed run (resets on deplete)" },
      { label: "Variety bonus", juice: "+200 per unique dungeon completed" },
      { label: "Endurance bonus", juice: "+50 per run beyond the 5th" },
      { label: "No deaths bonus", juice: "+150 per run" },
      { label: "Event participation", juice: "+100 per run" },
    ],
    supportedModes: ["group", "team"],
  },

  best_average: {
    slug: "best_average",
    label: "Best Average",
    description:
      "Run multiple keys — your best N runs are averaged. Consistency over luck.",
    rules: [
      "Run as many keys as you want during the event window.",
      "Only your top N runs count (set by organizer, default 3).",
      "Your score is the average of those top N runs.",
      "You must complete at least N runs to qualify for rankings.",
      "Consistency bonus if all counted runs are timed with low spread.",
    ],
    winCondition: "Highest average score across your best N runs.",
    scoringDescription:
      "Standard scoring per run. Your final score is the average of your best N runs, plus a consistency bonus for tight performance.",
    juiceTable: [
      { label: "Base score (per run)", juice: "Key level x 100 x time modifier" },
      { label: "Final score", juice: "Average of top N run scores" },
      { label: "Consistency bonus", juice: "+300 if all N runs are timed" },
      { label: "Range penalty", juice: "No consistency bonus if score spread > 500" },
      { label: "No deaths bonus", juice: "+150 per run" },
      { label: "Event participation", juice: "+100 per run" },
    ],
    supportedModes: ["group", "team"],
    configFields: [
      {
        key: "runsToCount",
        label: "Runs to count",
        type: "number",
        default: 3,
        min: 2,
        max: 10,
      },
    ],
  },

  bracket_tournament: {
    slug: "bracket_tournament",
    label: "Bracket Tournament",
    description:
      "Single-elimination bracket. Head-to-head matchups — better score advances.",
    rules: [
      "Groups/teams are seeded into a single-elimination bracket.",
      "Each round is a head-to-head matchup — both sides run the same dungeon.",
      "Higher score advances to the next round.",
      "Seeding is based on average RaiderIO score of members.",
      "Byes are awarded to top seeds if the bracket isn't a power of 2.",
    ],
    winCondition: "Last group/team standing wins the tournament.",
    scoringDescription:
      "Standard run scoring per matchup, plus tournament placement Juice based on how far you advance.",
    juiceTable: [
      { label: "Run score (per matchup)", juice: "Key level x 100 x time modifier" },
      { label: "Match win bonus", juice: "+500 per round won" },
      { label: "Margin bonus", juice: "+100 if winning by 20%+" },
      { label: "1st place", juice: "2,000 tournament Juice" },
      { label: "2nd place", juice: "1,200 tournament Juice" },
      { label: "3rd/4th place", juice: "800 tournament Juice" },
      { label: "5th–8th place", juice: "400 tournament Juice" },
    ],
    supportedModes: ["group", "team"],
  },
};

/** Get config for a specific event type, or null if unknown. */
export function getEventTypeConfig(slug: string): EventTypeConfig | null {
  return EVENT_TYPE_REGISTRY[slug] ?? null;
}

/** Get all event type configs as an array (for the /event-types endpoint). */
export function getAllEventTypes(): EventTypeConfig[] {
  return Object.values(EVENT_TYPE_REGISTRY);
}
