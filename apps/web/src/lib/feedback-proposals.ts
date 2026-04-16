export interface ScoringFormula {
  id: string;
  name: string;
  summary: string;
  formula: string;
  example: string;
  pros: string[];
  cons: string[];
}

export interface EventTypeProposal {
  slug: string;
  label: string;
  description: string[];
  workflow: { phase: string; detail: string }[];
  formulas: ScoringFormula[];
  universalRules: string[];
}

const UNIVERSAL_RULES = [
  "Depleted runs earn zero base Juice — only participation (+100) and zero-deaths (+150) if applicable.",
  "Base Juice = key level × 100 (only if timed).",
  "A single run can earn Personal + Event + Team Juice simultaneously.",
];

export const PROPOSALS: Record<string, EventTypeProposal> = {
  key_climbing: {
    slug: "key_climbing",
    label: "Key Climbing",
    description: [
      "Key Climbing is a \"how high can you go?\" event. Every group or team starts at the event's minimum keystone level — say, +10 — and tries to push their key as high as possible before the timer runs out.",
      "Players experience it as a personal mountain. There's no rush against a clock; the question is \"can we time this one?\" and then \"okay, can we time the next one too?\" When a key gets depleted, you don't get bumped down — you can keep trying at that level or below.",
      "Scoring is dead simple: only your highest completed key counts. Time it and you get the full base reward. Deplete it and you get participation credit only. The fun is the climb — the win is the summit.",
    ],
    workflow: [
      { phase: "Signup", detail: "Join via Discord embed or website. Pick your character, role, and spec." },
      { phase: "During Event", detail: "Queue keys at or above the minimum. Each timed run pushes you higher. Standings update live after each run." },
      { phase: "After Event", detail: "Standings frozen. Final peak per player. Personal Juice and Event Juice both deposited." },
      { phase: "Results", detail: "Highest peak by player, with each player's full climb path." },
    ],
    formulas: [
      {
        id: "A",
        name: "Peak Only (Recommended)",
        summary: "Only your highest key counts. Simple and clean.",
        formula: "peak × 100 + (peak − min) × 50 progression + 150 zero deaths + 100 participation",
        example: "Timed +18, 0 deaths, min +10 → 1800 + 400 + 150 + 100 = 2,450 Event Juice\nDepleted +18 → 150 + 100 = 250 Event Juice",
        pros: ["Matches WoW's natural 'highest key' mental model", "Easy to explain and understand", "Creates tension: push or hold?"],
        cons: ["One good pull at the end erases all earlier effort"],
      },
      {
        id: "B",
        name: "Peak + Climb Path Bonus",
        summary: "Same as A, but +25 Juice per distinct key level cleared on the way up.",
        formula: "Formula A + 25 × (distinct levels cleared)",
        example: "Timed +12, +14, +16, +17, +18 → 2,450 + 5×25 = 2,575\nJumped straight to +18 → 2,450 + 25 = 2,475",
        pros: ["Rewards the journey, not just the destination", "Differentiates 'I climbed' from 'I got carried'"],
        cons: ["Slightly punishes players whose first attempt is already their peak"],
      },
      {
        id: "C",
        name: "Highest Three Keys (Weighted)",
        summary: "60% peak + 30% second + 10% third. Rewards depth.",
        formula: "0.6 × scoreRun(peak) + 0.3 × scoreRun(2nd) + 0.1 × scoreRun(3rd)",
        example: "Runs scored 1950 / 1850 / 1750 → 1170 + 555 + 175 = 1,900 Event Juice",
        pros: ["Reduces 'one lucky timer' gaming", "Reuses existing scoring infrastructure"],
        cons: ["Harder to explain to players", "Players with only one run are penalized"],
      },
    ],
    universalRules: UNIVERSAL_RULES,
  },

  marathon: {
    slug: "marathon",
    label: "Marathon",
    description: [
      "Marathon is an endurance event. Every key your group runs during the event window earns Juice — quantity matters as much as quality. Think four hours of back-to-back keys, with the leaderboard ticking up after every successful dungeon.",
      "Groups settle into a rhythm — pull, recover, queue the next key, go. Variety bonuses encourage you to rotate dungeons rather than farm the easiest one. A streak bonus rewards consecutive timed runs, so depleting a key hurts more than just a low score — it breaks your momentum.",
      "Scoring stacks: every timed run earns its standard Juice, plus extras for streaks, dungeon variety, and stamina. Depleted runs earn nothing beyond participation. The win is the highest total. The fun is the rhythm and the camaraderie of a long session.",
    ],
    workflow: [
      { phase: "Signup", detail: "Join the event. See the window length (e.g. 4 hours)." },
      { phase: "During Event", detail: "Continuous play. After each run, a Discord embed posts: 'Run #4 — timed +15 — streak 3 — Event Juice +1,850.' Standings update live." },
      { phase: "After Event", detail: "Standings page lists all runs grouped by player, with cumulative scores." },
      { phase: "Results", detail: "Top 10 by total Event Juice. Per-player drill-down to all runs." },
    ],
    formulas: [
      {
        id: "A",
        name: "Sum + Streak + Variety + Endurance (Recommended)",
        summary: "Every timed run earns Juice. Bonuses for streaks, unique dungeons, and stamina.",
        formula: "Per timed run: key × 100 + streak × 100 + 200 (first unique dungeon) + 50 (if run #6+) + 150 (0 deaths) + 100 (participation once)",
        example: "6th run, timed +15, new dungeon, streak of 2 → 1500 + 200 + 200 + 50 + 100 = 2,050\nDepleted run → 100 participation only. Streak resets.",
        pros: ["Every run feels rewarding", "Endurance bonus keeps people playing", "Variety bonus prevents dungeon farming"],
        cons: ["Dominated by raw run count — 30 mediocre +10s beats 8 perfect +20s"],
      },
      {
        id: "B",
        name: "Sum with Diminishing Returns",
        summary: "Same bonuses, but each successive run is worth 5% less (0.95^n).",
        formula: "Per run: (key × 100) × 0.95^(runIndex − 1) + streak/variety/endurance",
        example: "Run #1 = full value. Run #6 ≈ 77% of base. Run #14 ≈ 50% of base.",
        pros: ["Caps grinder dominance", "Encourages quality over quantity"],
        cons: ["Punishes players who join late", "Complicates 'your run earned X' notifications"],
      },
      {
        id: "C",
        name: "Best 10 + Streak Multiplier",
        summary: "Only your top 10 runs count. Multiplied by 1 + 5% per longest streak.",
        formula: "sum(top 10 runs) × (1 + 0.05 × longestStreak) + 200 × distinctDungeons",
        example: "Top 10 sum = 15,000. Longest streak = 4. → 15,000 × 1.20 + 200×6 = 19,200",
        pros: ["Quality-first, still rewards consistency", "Streak multiplier adds excitement"],
        cons: ["Changes format entirely from 'every run counts' promise"],
      },
    ],
    universalRules: UNIVERSAL_RULES,
  },

  best_average: {
    slug: "best_average",
    label: "Best Average",
    description: [
      "Best Average is a consistency event. You can run as many keys as you want, but only your top three (or however many the organizer set) count toward your final score — and your final score is the average of those. One amazing run can't carry you. You need three good runs.",
      "Players experience it as a 'show your form' event. Mid-event, you watch your average and ask 'can I beat my current 3rd-place run?' If you can't, that one's locked in and any worse run is just practice.",
      "Scoring is the average of your best N runs. There's a consistency bonus if all of your top N are timed and within a tight score range. The win goes to the steadiest, most reliable player.",
    ],
    workflow: [
      { phase: "Signup", detail: "Join the event. Note the 'runs to count' setting (default 3)." },
      { phase: "During Event", detail: "Run keys. Each new run either cracks your top N (average improves) or doesn't (stored but no movement). UI shows 'your current top N' and 'your dropped run.'" },
      { phase: "After Event", detail: "Final average locked. Players with fewer than N runs shown as 'didn't qualify.'" },
      { phase: "Results", detail: "Final average, the N runs that counted, range, consistency bonus status." },
    ],
    formulas: [
      {
        id: "A",
        name: "Straight Average (Recommended)",
        summary: "Average of top N runs + consistency bonus if all timed.",
        formula: "average(top N run scores) + 300 (if all N timed) + 100 participation",
        example: "Top 3: 1850, 1750, 1700. Average = 1,767. All timed. → 1,767 + 300 + 100 = 2,167\nOnly 2 runs: unqualified — 'needs 1 more run'",
        pros: ["Simple, easy to explain", "Matches the registry description already on the site", "Depleted runs naturally fall out of top N"],
        cons: ["Pure average — one bad run in top N drags you down"],
      },
      {
        id: "B",
        name: "Trimmed Mean",
        summary: "Drop highest and lowest, average the middle. Requires N+2 runs.",
        formula: "average(runs after dropping best and worst) + 100 participation",
        example: "5 runs: 1850, 1750, 1700, 1500, 600. Drop 1850 and 600. Mean = 1,650 → 1,750 total",
        pros: ["One bad run doesn't permanently cap you", "Rewards more attempts"],
        cons: ["Requires more runs to qualify (N+2)", "May exclude casual players"],
      },
      {
        id: "C",
        name: "Weighted Top N",
        summary: "Best run weighted 50%, second 30%, third 20%. Peak still matters.",
        formula: "0.5 × top + 0.3 × 2nd + 0.2 × 3rd + 300 (consistency) + 100 participation",
        example: "1850, 1750, 1700 → 925 + 525 + 340 + 300 + 100 = 2,190",
        pros: ["Peak performance matters more than flat mean", "Close to A in practice"],
        cons: ["Slightly more complex to explain"],
      },
    ],
    universalRules: UNIVERSAL_RULES,
  },

  bracket_tournament: {
    slug: "bracket_tournament",
    label: "Bracket Tournament",
    description: [
      "Bracket Tournament is the head-to-head competitive format. Groups or teams are seeded by their average M+ rating, then matched up in a single-elimination bracket. In each round, both sides run the same dungeon at the same key level — the higher-scoring run advances.",
      "Players experience it as a high-stakes evening. There's a clear narrative: round of 8, quarterfinals, semis, finals. Between rounds you can scout your opponent's previous run, talk strategy, swap a healer if you need to.",
      "Scoring layers a per-match component (Juice for your run, plus a win bonus, plus a margin bonus) with a placement component (1st, 2nd, 3rd–4th, 5th–8th all get tournament Juice). The fun is the format — it's the only event type where you directly play against someone else's identical run.",
    ],
    workflow: [
      { phase: "Signup", detail: "Teams/groups lock before bracket generation. Cutoff = signup close time." },
      { phase: "Pre-Event", detail: "System generates bracket from RaiderIO seedings. Published as Discord embed and on web. Byes assigned to top seeds." },
      { phase: "During Event", detail: "Round 1 starts simultaneously. Both sides run the same dungeon at the same level. Winner advances → bracket updates → Round 2 announced." },
      { phase: "After Event", detail: "Champion crowned. Placement Juice distributed." },
    ],
    formulas: [
      {
        id: "A",
        name: "Per-Match + Placement (Recommended)",
        summary: "Win bonus per match + placement Juice at the end.",
        formula: "Winner: scoreRun() + 500 win + 100 margin (≥20%). Loser: scoreRun() only (0 if depleted).\nPlacement: 1st 2,000 / 2nd 1,200 / 3rd-4th 800 / 5th-8th 400",
        example: "Win R1 by 25% (run scored 1750) → 1750 + 500 + 100 = 2,350\nLose R2 (run scored 1700) → 1,700\n4th place → +400. Total = 4,450",
        pros: ["Clear, dramatic narrative per match", "Placement Juice rewards going deep"],
        cons: ["Single elimination = one bad key and you're out"],
      },
      {
        id: "B",
        name: "Best-of-3 Series",
        summary: "Each round is best-of-3 dungeons. Mitigates RNG.",
        formula: "Per set: scoreRun(). +250 per set won. +500 match win. + placement.",
        example: "Win 2-1 in R1: 1700+1650+1500 + 250×2 + 500 = 5,350 from R1 alone",
        pros: ["Mitigates affix luck and one-shot variance", "More keys = more fun"],
        cons: ["Takes ~3× the time per round", "Hard to schedule for casual guilds"],
      },
      {
        id: "C",
        name: "Match Differential",
        summary: "Your score minus opponent's score. Cumulative differential = tiebreaker.",
        formula: "(yourScore − opponentScore) + (won ? 500 : 0) + placement",
        example: "R1: you 1850 vs them 1500 → +350+500 = +850. R2: you 1700 vs them 1900 → −200. Sum +650 + 400 = 1,050",
        pros: ["Margin matters everywhere — competitive teams love this"],
        cons: ["Allows negative Event Juice — confuses casual players", "More complex to track"],
      },
    ],
    universalRules: UNIVERSAL_RULES,
  },
};
