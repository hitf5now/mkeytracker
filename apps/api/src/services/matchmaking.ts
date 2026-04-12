/**
 * Matchmaking service — role-balanced team assignment.
 *
 * Takes a pool of signups and assigns them to teams of 5:
 *   1 tank + 1 healer + 3 DPS per team.
 *
 * Strategy:
 *   1. Bucket signups by role preference (tank / healer / dps)
 *   2. Shuffle each bucket randomly for fairness
 *   3. Form teams by pulling 1 tank, 1 healer, 3 DPS
 *   4. Leftover players who can't form a complete team go to "bench"
 *
 * The bottleneck role determines how many teams form. If you have
 * 5 tanks, 3 healers, and 20 DPS, you form 3 teams (limited by healers).
 * The remaining 2 tanks and 11 DPS are benched.
 *
 * MVP: fully random within each role bucket. Future enhancements:
 *   - RIO-balanced (spread high + low across teams)
 *   - Preferred teammate matching
 *   - Avoid-previous-teammate heuristic
 */

export interface SignupForMatching {
  signupId: number;
  userId: number;
  characterId: number;
  rolePreference: "tank" | "healer" | "dps";
  characterName: string;
  realm: string;
}

export interface AssignedTeam {
  name: string;
  members: SignupForMatching[];
}

export interface MatchmakingResult {
  teams: AssignedTeam[];
  benched: SignupForMatching[];
  stats: {
    totalSignups: number;
    teamsFormed: number;
    benchedCount: number;
    limitingRole: "tank" | "healer" | "dps";
  };
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function assignTeams(signups: SignupForMatching[]): MatchmakingResult {
  const tanks = shuffle(signups.filter((s) => s.rolePreference === "tank"));
  const healers = shuffle(signups.filter((s) => s.rolePreference === "healer"));
  const dps = shuffle(signups.filter((s) => s.rolePreference === "dps"));

  // Number of complete teams is limited by the scarcest role.
  const teamsByTank = tanks.length;
  const teamsByHealer = healers.length;
  const teamsByDps = Math.floor(dps.length / 3);

  const teamCount = Math.min(teamsByTank, teamsByHealer, teamsByDps);
  const limitingRole: "tank" | "healer" | "dps" =
    teamCount === teamsByTank
      ? "tank"
      : teamCount === teamsByHealer
        ? "healer"
        : "dps";

  const teams: AssignedTeam[] = [];
  for (let i = 0; i < teamCount; i++) {
    teams.push({
      name: `Team ${i + 1}`,
      members: [
        tanks[i]!,
        healers[i]!,
        dps[i * 3]!,
        dps[i * 3 + 1]!,
        dps[i * 3 + 2]!,
      ],
    });
  }

  // Leftover players go to the bench.
  const assigned = new Set(teams.flatMap((t) => t.members.map((m) => m.signupId)));
  const benched = signups.filter((s) => !assigned.has(s.signupId));

  return {
    teams,
    benched,
    stats: {
      totalSignups: signups.length,
      teamsFormed: teamCount,
      benchedCount: benched.length,
      limitingRole,
    },
  };
}
