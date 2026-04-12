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
 *   5. Post-process: redistribute companion-app users across teams
 *      (soft constraint — prefer at least 1 per team for run tracking)
 *
 * The bottleneck role determines how many teams form. If you have
 * 5 tanks, 3 healers, and 20 DPS, you form 3 teams (limited by healers).
 * The remaining 2 tanks and 11 DPS are benched.
 */

export interface SignupForMatching {
  signupId: number;
  userId: number | null;
  characterId: number;
  rolePreference: "tank" | "healer" | "dps";
  characterName: string;
  realm: string;
  hasCompanionApp: boolean;
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
    teamsWithoutCompanion: number;
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

  // ── Post-process: distribute companion-app users across teams ──
  // Soft constraint: try to ensure at least 1 companion user per team.
  // Swap within the same role bucket only to preserve role balance.
  if (teams.length > 1) {
    distributeCompanionUsers(teams);
  }

  // Leftover players go to the bench.
  const assigned = new Set(teams.flatMap((t) => t.members.map((m) => m.signupId)));
  const benched = signups.filter((s) => !assigned.has(s.signupId));

  const teamsWithoutCompanion = teams.filter(
    (t) => !t.members.some((m) => m.hasCompanionApp),
  ).length;

  return {
    teams,
    benched,
    stats: {
      totalSignups: signups.length,
      teamsFormed: teamCount,
      benchedCount: benched.length,
      limitingRole,
      teamsWithoutCompanion,
    },
  };
}

/**
 * Try to redistribute companion-app users so each team has at least one.
 * Only swaps within the same role to preserve role balance.
 */
function distributeCompanionUsers(teams: AssignedTeam[]): void {
  for (const needyTeam of teams) {
    const hasCompanion = needyTeam.members.some((m) => m.hasCompanionApp);
    if (hasCompanion) continue;

    // Find a team with 2+ companion users to swap with
    for (const richTeam of teams) {
      if (richTeam === needyTeam) continue;

      const richCompanions = richTeam.members.filter((m) => m.hasCompanionApp);
      if (richCompanions.length < 2) continue;

      // Try to swap a companion user for a non-companion user in the same role
      const donor = richCompanions[0]!;
      const recipient = needyTeam.members.find(
        (m) => m.rolePreference === donor.rolePreference && !m.hasCompanionApp,
      );

      if (recipient) {
        // Swap them
        const donorIdx = richTeam.members.indexOf(donor);
        const recipientIdx = needyTeam.members.indexOf(recipient);
        richTeam.members[donorIdx] = recipient;
        needyTeam.members[recipientIdx] = donor;
        break;
      }
    }
  }
}
