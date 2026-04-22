/**
 * Matchmaking — skeleton-based group formation for the Ready Check system.
 *
 * See docs/EVENT_READY_CHECK_SYSTEM.md §6. Every group produced is a 1T/1H/3DPS
 * skeleton; seats that can't be filled become open slots (PUG, filled in-game,
 * no event credit).
 *
 * Pure function — no DB. The Ready Check service calls this, then writes the
 * result to the DB atomically at RC expiry.
 *
 * Invariants:
 *   - Every skeleton has exactly 5 slots in the canonical order
 *     tank / healer / dps1 / dps2 / dps3.
 *   - Every skeleton has >= 2 real (filled) members.
 *   - A participant appears in at most one skeleton per RC.
 *   - Priority-flagged participants are placed before non-flagged of the same role.
 *   - A flex is pulled only when doing so strictly increases the skeleton count.
 */

export type Role = "tank" | "healer" | "dps";
export type FlexRole = Role | "none";
export type SlotPosition = "tank" | "healer" | "dps1" | "dps2" | "dps3";

export interface RCParticipant {
  signupId: number;
  userId: number | null;
  characterId: number;
  characterName: string;
  realm: string;
  primaryRole: Role;
  flexRole: FlexRole;
  priorityFlag: boolean;
  hasCompanionApp: boolean;
}

export interface SkeletonSlot {
  position: SlotPosition;
  /** null = open slot (PUG seat, no event credit) */
  participant: RCParticipant | null;
  /** true if the participant was pulled via their flex role, not their primary */
  filledByFlex: boolean;
}

export interface Skeleton {
  /** Exactly 5 slots, in canonical order tank/healer/dps1/dps2/dps3. */
  slots: SkeletonSlot[];
  realMemberCount: number;
  openSlotCount: number;
}

export interface MatchmakingResult {
  skeletons: Skeleton[];
  /**
   * Participants who came to the RC but did not land in any skeleton.
   * These get priority_flag set for the next RC.
   */
  bounced: RCParticipant[];
  stats: {
    totalParticipants: number;
    skeletonsFormed: number;
    fullSkeletons: number;
    partialSkeletons: number;
    bouncedCount: number;
  };
}

/** Primary entry point. */
export function formSkeletons(participants: RCParticipant[]): MatchmakingResult {
  const bestPlan = chooseBestFlexAssignment(participants);

  const skeletons = drawSkeletons(
    bestPlan.tanks,
    bestPlan.healers,
    bestPlan.dps,
    bestPlan.flexedIds,
  );

  const assignedIds = new Set<number>();
  for (const s of skeletons) {
    for (const slot of s.slots) {
      if (slot.participant) assignedIds.add(slot.participant.signupId);
    }
  }

  const bounced = participants.filter((p) => !assignedIds.has(p.signupId));

  const fullSkeletons = skeletons.filter((s) => s.realMemberCount === 5).length;
  const partialSkeletons = skeletons.length - fullSkeletons;

  return {
    skeletons,
    bounced,
    stats: {
      totalParticipants: participants.length,
      skeletonsFormed: skeletons.length,
      fullSkeletons,
      partialSkeletons,
      bouncedCount: bounced.length,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────

interface FlexPlan {
  tanks: RCParticipant[];
  healers: RCParticipant[];
  dps: RCParticipant[];
  /** signupIds placed into their flex role rather than their primary */
  flexedIds: Set<number>;
}

/**
 * Decide which flexors (if any) to pull. A flexor is only pulled when doing so
 * strictly increases the number of skeletons the draw algorithm produces.
 *
 * Implementation: greedy hill-climb. Start with the no-flex baseline and try
 * each candidate flexor one at a time; keep the move if skeleton count improves.
 * Repeat until no single-move improvement remains. Small N makes this cheap.
 */
function chooseBestFlexAssignment(participants: RCParticipant[]): FlexPlan {
  const baseline = partitionByPrimary(participants);
  let bestPlan: FlexPlan = { ...baseline, flexedIds: new Set() };
  let bestCount = skeletonCount(bestPlan);

  while (true) {
    let improved = false;
    const candidates = participants.filter(
      (p) =>
        p.flexRole !== "none" &&
        p.flexRole !== p.primaryRole &&
        !bestPlan.flexedIds.has(p.signupId),
    );

    for (const candidate of candidates) {
      const tentative = applyFlex(bestPlan, candidate);
      const tentativeCount = skeletonCount(tentative);
      if (tentativeCount > bestCount) {
        bestPlan = tentative;
        bestCount = tentativeCount;
        improved = true;
        break; // restart the scan after any improvement
      }
    }

    if (!improved) break;
  }

  return bestPlan;
}

function partitionByPrimary(
  participants: RCParticipant[],
): { tanks: RCParticipant[]; healers: RCParticipant[]; dps: RCParticipant[] } {
  const tanks = participants.filter((p) => p.primaryRole === "tank");
  const healers = participants.filter((p) => p.primaryRole === "healer");
  const dps = participants.filter((p) => p.primaryRole === "dps");
  return {
    tanks: sortForSlotting(tanks),
    healers: sortForSlotting(healers),
    dps: sortForSlotting(dps),
  };
}

/** Priority-flagged first; stable within that. */
function sortForSlotting(list: RCParticipant[]): RCParticipant[] {
  return [...list].sort((a, b) => {
    if (a.priorityFlag && !b.priorityFlag) return -1;
    if (!a.priorityFlag && b.priorityFlag) return 1;
    return a.signupId - b.signupId;
  });
}

/** Move `candidate` from its primary bucket to its flex bucket. */
function applyFlex(plan: FlexPlan, candidate: RCParticipant): FlexPlan {
  const remove = (arr: RCParticipant[], id: number): RCParticipant[] =>
    arr.filter((p) => p.signupId !== id);
  const insert = (arr: RCParticipant[], p: RCParticipant): RCParticipant[] =>
    sortForSlotting([...arr, p]);

  let tanks = plan.tanks;
  let healers = plan.healers;
  let dps = plan.dps;

  if (candidate.primaryRole === "tank") tanks = remove(tanks, candidate.signupId);
  else if (candidate.primaryRole === "healer") healers = remove(healers, candidate.signupId);
  else dps = remove(dps, candidate.signupId);

  if (candidate.flexRole === "tank") tanks = insert(tanks, candidate);
  else if (candidate.flexRole === "healer") healers = insert(healers, candidate);
  else if (candidate.flexRole === "dps") dps = insert(dps, candidate);

  return {
    tanks,
    healers,
    dps,
    flexedIds: new Set([...plan.flexedIds, candidate.signupId]),
  };
}

function skeletonCount(plan: FlexPlan): number {
  return drawSkeletons(plan.tanks, plan.healers, plan.dps, plan.flexedIds).length;
}

/**
 * Greedy draw: on each iteration, pull 1T + 1H + 3D from the remaining buckets
 * (taking whatever is available). Accept the skeleton if it has >= 2 real
 * members; otherwise bounce the drawn participants and stop.
 *
 * This produces the §6.4 outcome table correctly. Participants drawn into a
 * failed skeleton on the final iteration count as bounced; they remain in
 * `drawn` and won't be reassigned.
 */
function drawSkeletons(
  tanksIn: RCParticipant[],
  healersIn: RCParticipant[],
  dpsIn: RCParticipant[],
  flexedIds: Set<number>,
): Skeleton[] {
  const tanks = [...tanksIn];
  const healers = [...healersIn];
  const dps = [...dpsIn];
  const skeletons: Skeleton[] = [];

  while (true) {
    const t = tanks.shift() ?? null;
    const h = healers.shift() ?? null;
    const d1 = dps.shift() ?? null;
    const d2 = dps.shift() ?? null;
    const d3 = dps.shift() ?? null;

    const draw = [t, h, d1, d2, d3].filter((p): p is RCParticipant => p !== null);
    if (draw.length === 0) break;
    if (draw.length < 2) {
      // Not enough to form a skeleton — invalid. These get bounced.
      break;
    }

    const slots: SkeletonSlot[] = [
      makeSlot("tank", t, flexedIds),
      makeSlot("healer", h, flexedIds),
      makeSlot("dps1", d1, flexedIds),
      makeSlot("dps2", d2, flexedIds),
      makeSlot("dps3", d3, flexedIds),
    ];

    skeletons.push({
      slots,
      realMemberCount: draw.length,
      openSlotCount: 5 - draw.length,
    });
  }

  return skeletons;
}

function makeSlot(
  position: SlotPosition,
  p: RCParticipant | null,
  flexedIds: Set<number>,
): SkeletonSlot {
  return {
    position,
    participant: p,
    filledByFlex: p !== null && flexedIds.has(p.signupId),
  };
}
