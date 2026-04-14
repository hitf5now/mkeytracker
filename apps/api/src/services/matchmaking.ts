/**
 * Matchmaking service — role-balanced group assignment.
 *
 * Takes a pool of signups and assigns them to groups of 5:
 *   1 tank + 1 healer + 3 DPS per group.
 *
 * Strategy:
 *   1. Bucket signups by role preference (tank / healer / dps)
 *   2. Shuffle each bucket randomly for fairness
 *   3. Form groups by pulling 1 tank, 1 healer, 3 DPS
 *   4. Leftover players who can't form a complete group go to "bench"
 *   5. Post-process: redistribute companion-app users across groups
 *      (soft constraint — prefer at least 1 per group for run tracking)
 *
 * The bottleneck role determines how many groups form. If you have
 * 5 tanks, 3 healers, and 20 DPS, you form 3 groups (limited by healers).
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

export interface AssignedGroup {
  name: string;
  members: SignupForMatching[];
}

export interface MatchmakingResult {
  groups: AssignedGroup[];
  benched: SignupForMatching[];
  stats: {
    totalSignups: number;
    groupsFormed: number;
    benchedCount: number;
    limitingRole: "tank" | "healer" | "dps";
    groupsWithoutCompanion: number;
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

export function assignGroups(signups: SignupForMatching[]): MatchmakingResult {
  const tanks = shuffle(signups.filter((s) => s.rolePreference === "tank"));
  const healers = shuffle(signups.filter((s) => s.rolePreference === "healer"));
  const dps = shuffle(signups.filter((s) => s.rolePreference === "dps"));

  // Number of complete groups is limited by the scarcest role.
  const groupsByTank = tanks.length;
  const groupsByHealer = healers.length;
  const groupsByDps = Math.floor(dps.length / 3);

  const groupCount = Math.min(groupsByTank, groupsByHealer, groupsByDps);
  const limitingRole: "tank" | "healer" | "dps" =
    groupCount === groupsByTank
      ? "tank"
      : groupCount === groupsByHealer
        ? "healer"
        : "dps";

  const groups: AssignedGroup[] = [];
  for (let i = 0; i < groupCount; i++) {
    groups.push({
      name: `Group ${i + 1}`,
      members: [
        tanks[i]!,
        healers[i]!,
        dps[i * 3]!,
        dps[i * 3 + 1]!,
        dps[i * 3 + 2]!,
      ],
    });
  }

  // ── Post-process: distribute companion-app users across groups ──
  // Soft constraint: try to ensure at least 1 companion user per group.
  // Swap within the same role bucket only to preserve role balance.
  if (groups.length > 1) {
    distributeCompanionUsers(groups);
  }

  // Leftover players go to the bench.
  const assigned = new Set(groups.flatMap((g) => g.members.map((m) => m.signupId)));
  const benched = signups.filter((s) => !assigned.has(s.signupId));

  const groupsWithoutCompanion = groups.filter(
    (g) => !g.members.some((m) => m.hasCompanionApp),
  ).length;

  return {
    groups,
    benched,
    stats: {
      totalSignups: signups.length,
      groupsFormed: groupCount,
      benchedCount: benched.length,
      limitingRole,
      groupsWithoutCompanion,
    },
  };
}

/**
 * Try to redistribute companion-app users so each group has at least one.
 * Only swaps within the same role to preserve role balance.
 */
function distributeCompanionUsers(groups: AssignedGroup[]): void {
  for (const needyGroup of groups) {
    const hasCompanion = needyGroup.members.some((m) => m.hasCompanionApp);
    if (hasCompanion) continue;

    // Find a group with 2+ companion users to swap with
    for (const richGroup of groups) {
      if (richGroup === needyGroup) continue;

      const richCompanions = richGroup.members.filter((m) => m.hasCompanionApp);
      if (richCompanions.length < 2) continue;

      // Try to swap a companion user for a non-companion user in the same role
      const donor = richCompanions[0]!;
      const recipient = needyGroup.members.find(
        (m) => m.rolePreference === donor.rolePreference && !m.hasCompanionApp,
      );

      if (recipient) {
        const donorIdx = richGroup.members.indexOf(donor);
        const recipientIdx = needyGroup.members.indexOf(recipient);
        richGroup.members[donorIdx] = recipient;
        needyGroup.members[recipientIdx] = donor;
        break;
      }
    }
  }
}
