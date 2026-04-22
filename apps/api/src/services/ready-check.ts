/**
 * Ready Check service — the only path to group formation under the new design.
 *
 * See docs/EVENT_READY_CHECK_SYSTEM.md §5 and §7.
 *
 * Lifecycle:
 *   startOrJoin(eventId, signupId)
 *     - If no active RC for this event, create one with a 5-minute window
 *       and add the signup as first participant.
 *     - Otherwise, add the signup to the active RC (idempotent: re-joining
 *       flips cancelledAt back to null).
 *
 *   cancel(readyCheckId, signupId)
 *     - Marks participant cancelledAt. Allowed while RC is active.
 *
 *   expire(readyCheckId)
 *     - Marks RC expired, runs skeleton matchmaker over non-cancelled
 *       participants, creates EventGroup rows with slotPosition assignments,
 *       sets priorityFlag on bounced signups, clears priority on assigned.
 *     - Atomic in a single transaction.
 *
 *   sweepExpired()
 *     - Best-effort scheduler: finds any `active` RC where expiresAt <= now
 *       and calls expire() on it. Safe to run repeatedly.
 *
 *   autoDisbandTimedOutGroups()
 *     - Transitions `forming` groups to `timed_out` when they've sat for 2h
 *       OR the event has ended, whichever comes first.
 *
 * Lock rules enforced here:
 *   - A signup cannot start/join a new RC if they're already in an active RC
 *     on any event, OR assigned to a `forming` group (see checkLocked()).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { formSkeletons, type RCParticipant, type SlotPosition } from "./matchmaking.js";

const BOT_CHANNEL = "mplus:bot-notifications";

/**
 * Fire-and-forget publisher. Failures are logged but don't abort the
 * caller's transaction — the bot reads authoritative state via HTTP on
 * every notification, so a missed ping is self-healing on next click.
 */
function publishBotEvent(type: string, payload: Record<string, unknown>): void {
  redis
    .publish(BOT_CHANNEL, JSON.stringify({ type, ...payload }))
    .catch((err) => {
      console.error(`[ready-check] failed to publish ${type}:`, err);
    });
}

const READY_CHECK_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const FORMING_GROUP_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

export class ReadyCheckError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 409,
  ) {
    super(message);
    this.name = "ReadyCheckError";
  }
}

// ─────────────────────────────────────────────────────────────
// Start or Join
// ─────────────────────────────────────────────────────────────

export interface StartOrJoinResult {
  readyCheckId: number;
  startedNew: boolean;
  expiresAt: Date;
  participantCount: number;
}

export async function startOrJoin(
  eventId: number,
  signupId: number,
): Promise<StartOrJoinResult> {
  const result = await prisma.$transaction(async (tx) => {
    const signup = await tx.eventSignup.findUnique({
      where: { id: signupId },
      select: {
        id: true,
        eventId: true,
        userId: true,
        groupId: true,
        signupStatus: true,
      },
    });
    if (!signup) throw new ReadyCheckError("signup_not_found", "Signup not found", 404);
    if (signup.eventId !== eventId)
      throw new ReadyCheckError("signup_event_mismatch", "Signup is for a different event");
    if (signup.signupStatus !== "confirmed")
      throw new ReadyCheckError(
        "signup_not_confirmed",
        "Only confirmed signups can ready-check",
      );

    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    if (!event) throw new ReadyCheckError("event_not_found", "Event not found", 404);
    if (event.status !== "in_progress")
      throw new ReadyCheckError(
        "event_not_active",
        `Ready Check is only available while event is in_progress (current: ${event.status})`,
      );

    await assertNotLocked(tx, signup.id, signup.userId);

    // Find active RC for this event
    const activeRC = await tx.readyCheck.findFirst({
      where: { eventId, state: "active" },
      orderBy: { startedAt: "desc" },
    });

    if (activeRC && activeRC.expiresAt > new Date()) {
      // Join existing RC — upsert participant, clear cancellation if re-joining.
      await tx.readyCheckParticipant.upsert({
        where: {
          readyCheckId_signupId: { readyCheckId: activeRC.id, signupId: signup.id },
        },
        create: { readyCheckId: activeRC.id, signupId: signup.id },
        update: { cancelledAt: null },
      });

      const count = await tx.readyCheckParticipant.count({
        where: { readyCheckId: activeRC.id, cancelledAt: null },
      });

      return {
        readyCheckId: activeRC.id,
        startedNew: false,
        expiresAt: activeRC.expiresAt,
        participantCount: count,
      };
    }

    // No active RC → start one. The starter must have a linked user.
    if (signup.userId === null)
      throw new ReadyCheckError(
        "signup_not_linked",
        "Starting a Ready Check requires a registered user account",
      );

    const now = new Date();
    const rc = await tx.readyCheck.create({
      data: {
        eventId,
        startedAt: now,
        expiresAt: new Date(now.getTime() + READY_CHECK_WINDOW_MS),
        state: "active",
        startedByUserId: signup.userId,
        participants: { create: { signupId: signup.id } },
      },
      select: { id: true, expiresAt: true },
    });

    return {
      readyCheckId: rc.id,
      startedNew: true,
      expiresAt: rc.expiresAt,
      participantCount: 1,
    };
  });

  publishBotEvent("ready_check_updated", {
    readyCheckId: result.readyCheckId,
    eventId,
    reason: result.startedNew ? "started" : "joined",
  });

  return result;
}

/**
 * Locks:
 *   - Participant in another active RC (any event)
 *   - Signup assigned to a `forming` group (must disband or be matched first)
 */
async function assertNotLocked(
  tx: Prisma.TransactionClient,
  signupId: number,
  userId: number | null,
): Promise<void> {
  // Forming group lock: use signup's own groupId
  const signupWithGroup = await tx.eventSignup.findUnique({
    where: { id: signupId },
    select: { groupId: true, group: { select: { state: true } } },
  });
  if (signupWithGroup?.group?.state === "forming") {
    throw new ReadyCheckError(
      "locked_in_forming_group",
      "You're already in a forming group — wait for it to log a run, disband, or time out",
    );
  }

  // Active-RC-on-another-event lock: only meaningful if the signup has a userId
  if (userId !== null) {
    const otherActive = await tx.readyCheckParticipant.findFirst({
      where: {
        cancelledAt: null,
        readyCheck: { state: "active", expiresAt: { gt: new Date() } },
        signup: { userId, NOT: { id: signupId } },
      },
      select: { id: true },
    });
    if (otherActive) {
      throw new ReadyCheckError(
        "locked_in_other_ready_check",
        "You're already in an active Ready Check on another event",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Cancel participation
// ─────────────────────────────────────────────────────────────

export async function cancelParticipation(
  readyCheckId: number,
  signupId: number,
): Promise<void> {
  const eventId = await prisma.$transaction(async (tx) => {
    const rc = await tx.readyCheck.findUnique({
      where: { id: readyCheckId },
      select: { state: true, expiresAt: true, eventId: true },
    });
    if (!rc) throw new ReadyCheckError("ready_check_not_found", "Ready Check not found", 404);
    if (rc.state !== "active")
      throw new ReadyCheckError("ready_check_not_active", "Ready Check is no longer active");
    if (rc.expiresAt <= new Date())
      throw new ReadyCheckError("ready_check_expired", "Ready Check window has closed");

    await tx.readyCheckParticipant.update({
      where: { readyCheckId_signupId: { readyCheckId, signupId } },
      data: { cancelledAt: new Date() },
    });
    return rc.eventId;
  });

  publishBotEvent("ready_check_updated", { readyCheckId, eventId, reason: "cancelled" });
}

// ─────────────────────────────────────────────────────────────
// Expire (form groups)
// ─────────────────────────────────────────────────────────────

export interface ExpireResult {
  readyCheckId: number;
  groupsFormed: number;
  groupIds: number[];
  bouncedSignupIds: number[];
  stats: {
    totalParticipants: number;
    skeletonsFormed: number;
    fullSkeletons: number;
    partialSkeletons: number;
    bouncedCount: number;
  };
}

const SLOT_ORDER: SlotPosition[] = ["tank", "healer", "dps1", "dps2", "dps3"];

export async function expireReadyCheck(readyCheckId: number): Promise<ExpireResult> {
  const result = await prisma.$transaction(async (tx) => {
    const rc = await tx.readyCheck.findUnique({
      where: { id: readyCheckId },
      include: {
        participants: {
          where: { cancelledAt: null },
          include: {
            signup: {
              include: { character: true },
            },
          },
        },
      },
    });
    if (!rc) throw new ReadyCheckError("ready_check_not_found", "Ready Check not found", 404);
    if (rc.state !== "active") {
      // Already expired — treat as idempotent no-op
      return {
        readyCheckId,
        eventId: rc.eventId,
        groupsFormed: 0,
        groupIds: [] as number[],
        bouncedSignupIds: [] as number[],
        stats: {
          totalParticipants: 0,
          skeletonsFormed: 0,
          fullSkeletons: 0,
          partialSkeletons: 0,
          bouncedCount: 0,
        },
      };
    }

    // Build matchmaker input
    const pool: RCParticipant[] = rc.participants.map((part) => ({
      signupId: part.signupId,
      userId: part.signup.userId,
      characterId: part.signup.characterId,
      characterName: part.signup.character.name,
      realm: part.signup.character.realm,
      primaryRole: part.signup.rolePreference as "tank" | "healer" | "dps",
      flexRole: part.signup.flexRole,
      priorityFlag: part.signup.priorityFlag,
      hasCompanionApp: part.signup.character.hasCompanionApp,
    }));

    const result = formSkeletons(pool);

    // Create groups + assign slotPosition on signups
    const groupIds: number[] = [];
    const existingGroupCount = await tx.eventGroup.count({
      where: { eventId: rc.eventId },
    });

    for (let idx = 0; idx < result.skeletons.length; idx++) {
      const skel = result.skeletons[idx]!;
      const groupName = `Group ${existingGroupCount + idx + 1}`;

      const group = await tx.eventGroup.create({
        data: {
          eventId: rc.eventId,
          name: groupName,
          state: "forming",
          readyCheckId: rc.id,
        },
        select: { id: true },
      });
      groupIds.push(group.id);

      for (const slot of skel.slots) {
        if (!slot.participant) continue;
        await tx.eventSignup.update({
          where: { id: slot.participant.signupId },
          data: {
            groupId: group.id,
            slotPosition: slot.position,
            priorityFlag: false, // clears on assignment
          },
        });
      }
    }

    // Flag bounced participants. Cleared on next assignment or event complete.
    const bouncedIds = result.bounced.map((b) => b.signupId);
    if (bouncedIds.length > 0) {
      await tx.eventSignup.updateMany({
        where: { id: { in: bouncedIds } },
        data: { priorityFlag: true },
      });
    }

    // Close the RC
    await tx.readyCheck.update({
      where: { id: rc.id },
      data: { state: "expired" },
    });

    return {
      readyCheckId: rc.id,
      eventId: rc.eventId,
      groupsFormed: result.skeletons.length,
      groupIds,
      bouncedSignupIds: bouncedIds,
      stats: result.stats,
    };
  });

  if (result.groupsFormed > 0 || result.bouncedSignupIds.length > 0) {
    publishBotEvent("ready_check_expired", {
      readyCheckId: result.readyCheckId,
      eventId: result.eventId,
      groupIds: result.groupIds,
      bouncedSignupIds: result.bouncedSignupIds,
      stats: result.stats,
    });
  }

  // Strip eventId from the public return type (internal-only)
  return {
    readyCheckId: result.readyCheckId,
    groupsFormed: result.groupsFormed,
    groupIds: result.groupIds,
    bouncedSignupIds: result.bouncedSignupIds,
    stats: result.stats,
  };
}

// ─────────────────────────────────────────────────────────────
// Scheduler helpers — run these from a cron worker in production
// ─────────────────────────────────────────────────────────────

/**
 * Expires any active RC whose window has elapsed. Returns the RC IDs that
 * were expired. Safe to call repeatedly (idempotent per RC).
 */
export async function sweepExpiredReadyChecks(): Promise<number[]> {
  const due = await prisma.readyCheck.findMany({
    where: { state: "active", expiresAt: { lte: new Date() } },
    select: { id: true },
  });

  const expired: number[] = [];
  for (const rc of due) {
    try {
      await expireReadyCheck(rc.id);
      expired.push(rc.id);
    } catch (err) {
      // Log and continue — one bad RC shouldn't block the rest.
      console.error(`[ready-check] failed to expire RC ${rc.id}:`, err);
    }
  }
  return expired;
}

/**
 * Transitions `forming` groups to `timed_out` when either 2h have passed
 * since assignment OR the event has ended, whichever comes first.
 * No DM warning, no keep-alive (per design decision 2026-04-22).
 */
export async function autoDisbandTimedOutGroups(): Promise<number[]> {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - FORMING_GROUP_TIMEOUT_MS);

  const candidates = await prisma.eventGroup.findMany({
    where: {
      state: "forming",
      OR: [
        { assignedAt: { lte: twoHoursAgo } },
        { event: { endsAt: { lte: now } } },
      ],
    },
    select: { id: true },
  });

  const ids = candidates.map((g) => g.id);
  if (ids.length === 0) return [];

  await prisma.$transaction(async (tx) => {
    await tx.eventGroup.updateMany({
      where: { id: { in: ids }, state: "forming" },
      data: { state: "timed_out", resolvedAt: now },
    });
    // Release the signups from the group so they can RC again.
    await tx.eventSignup.updateMany({
      where: { groupId: { in: ids } },
      data: { groupId: null, slotPosition: null },
    });
  });

  return ids;
}

/**
 * Convenience: expose PrismaClient type for tests that want to inject a
 * transactional client. Not used in production.
 */
export type TxClient = Prisma.TransactionClient | PrismaClient;

// ─────────────────────────────────────────────────────────────
// Disband vote
// ─────────────────────────────────────────────────────────────

/**
 * In-memory disband-vote tally. Per §7.2, any 2 members can vote to
 * disband a `forming` group. Votes reset on restart — acceptable because
 * groups auto-disband after 2h anyway.
 */
const disbandVotes = new Map<number, Set<number>>();

export interface DisbandVoteResult {
  groupId: number;
  voteCount: number;
  required: number;
  disbanded: boolean;
}

export async function recordDisbandVote(
  groupId: number,
  signupId: number,
): Promise<DisbandVoteResult> {
  const group = await prisma.eventGroup.findUnique({
    where: { id: groupId },
    include: {
      members: { select: { id: true, userId: true } },
    },
  });
  if (!group) throw new ReadyCheckError("group_not_found", "Group not found", 404);
  if (group.state !== "forming")
    throw new ReadyCheckError("group_not_forming", `Group is ${group.state}, cannot disband`);

  const isMember = group.members.some((m) => m.id === signupId);
  if (!isMember)
    throw new ReadyCheckError(
      "not_a_member",
      "Only members of the group can vote to disband",
      403,
    );

  const votes = disbandVotes.get(groupId) ?? new Set<number>();
  votes.add(signupId);
  disbandVotes.set(groupId, votes);

  const required = 2;
  if (votes.size < required) {
    return { groupId, voteCount: votes.size, required, disbanded: false };
  }

  // Threshold met — disband atomically.
  await prisma.$transaction(async (tx) => {
    const count = await tx.eventGroup.updateMany({
      where: { id: groupId, state: "forming" },
      data: { state: "disbanded", resolvedAt: new Date() },
    });
    if (count.count === 1) {
      // Release members back to the pool.
      await tx.eventSignup.updateMany({
        where: { groupId },
        data: { groupId: null, slotPosition: null },
      });
    }
  });

  disbandVotes.delete(groupId);
  publishBotEvent("event_group_disbanded", { groupId, eventId: group.eventId });

  return { groupId, voteCount: votes.size, required, disbanded: true };
}
