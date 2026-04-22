/**
 * Unit tests for the skeleton matchmaker.
 *
 * Covers the §6.4 outcome table from docs/EVENT_READY_CHECK_SYSTEM.md.
 */

import { describe, it, expect } from "vitest";
import {
  formSkeletons,
  type RCParticipant,
  type Role,
  type FlexRole,
} from "../src/services/matchmaking.js";

let seq = 1;
function p(
  primary: Role,
  opts: { flex?: FlexRole; priority?: boolean; id?: number } = {},
): RCParticipant {
  const id = opts.id ?? seq++;
  return {
    signupId: id,
    userId: id,
    characterId: id,
    characterName: `P${id}`,
    realm: "Illidan",
    primaryRole: primary,
    flexRole: opts.flex ?? "none",
    priorityFlag: opts.priority ?? false,
    hasCompanionApp: false,
  };
}

function roleCounts(
  s: ReturnType<typeof formSkeletons>["skeletons"][number],
): { t: number; h: number; d: number; open: number } {
  let t = 0,
    h = 0,
    d = 0,
    open = 0;
  for (const slot of s.slots) {
    if (slot.participant === null) {
      open++;
    } else {
      if (slot.position === "tank") t++;
      else if (slot.position === "healer") h++;
      else d++;
    }
  }
  return { t, h, d, open };
}

describe("formSkeletons — §6.4 outcome table", () => {
  it("empty pool → no skeleton, no bounces", () => {
    const r = formSkeletons([]);
    expect(r.skeletons).toHaveLength(0);
    expect(r.bounced).toHaveLength(0);
  });

  it("1 player, any role → bounced (min 2 members)", () => {
    const r = formSkeletons([p("tank")]);
    expect(r.skeletons).toHaveLength(0);
    expect(r.bounced).toHaveLength(1);
  });

  it("2 players, 1T + 1H → 1 skeleton with 3 open DPS slots", () => {
    const pool = [p("tank", { id: 1 }), p("healer", { id: 2 })];
    const r = formSkeletons(pool);
    expect(r.skeletons).toHaveLength(1);
    const c = roleCounts(r.skeletons[0]!);
    expect(c).toEqual({ t: 1, h: 1, d: 0, open: 3 });
    expect(r.bounced).toHaveLength(0);
  });

  it("2 DPS → 1 skeleton with 1T + 1H + 1DPS open (both assigned)", () => {
    const r = formSkeletons([p("dps", { id: 1 }), p("dps", { id: 2 })]);
    expect(r.skeletons).toHaveLength(1);
    const c = roleCounts(r.skeletons[0]!);
    expect(c).toEqual({ t: 0, h: 0, d: 2, open: 3 });
    expect(r.bounced).toHaveLength(0);
  });

  it("2 tanks same role → both bounced (only 1 T slot per skeleton)", () => {
    const r = formSkeletons([p("tank", { id: 1 }), p("tank", { id: 2 })]);
    expect(r.skeletons).toHaveLength(0);
    expect(r.bounced).toHaveLength(2);
  });

  it("2 healers same role → both bounced", () => {
    const r = formSkeletons([p("healer", { id: 1 }), p("healer", { id: 2 })]);
    expect(r.skeletons).toHaveLength(0);
    expect(r.bounced).toHaveLength(2);
  });

  it("5 balanced (1T/1H/3D) → 1 full skeleton, 0 open slots", () => {
    const pool = [
      p("tank", { id: 1 }),
      p("healer", { id: 2 }),
      p("dps", { id: 3 }),
      p("dps", { id: 4 }),
      p("dps", { id: 5 }),
    ];
    const r = formSkeletons(pool);
    expect(r.skeletons).toHaveLength(1);
    expect(r.skeletons[0]!.realMemberCount).toBe(5);
    expect(r.skeletons[0]!.openSlotCount).toBe(0);
  });

  it("10 balanced (2T/2H/6D) → 2 full skeletons", () => {
    const pool: RCParticipant[] = [];
    for (let i = 0; i < 2; i++) pool.push(p("tank"));
    for (let i = 0; i < 2; i++) pool.push(p("healer"));
    for (let i = 0; i < 6; i++) pool.push(p("dps"));
    const r = formSkeletons(pool);
    expect(r.skeletons).toHaveLength(2);
    for (const s of r.skeletons) expect(s.realMemberCount).toBe(5);
  });

  it("11 = 2T/2H/7D → 2 full skeletons + 1 bounced DPS (priority-flag candidate)", () => {
    const pool: RCParticipant[] = [];
    for (let i = 0; i < 2; i++) pool.push(p("tank"));
    for (let i = 0; i < 2; i++) pool.push(p("healer"));
    for (let i = 0; i < 7; i++) pool.push(p("dps"));
    const r = formSkeletons(pool);
    expect(r.skeletons).toHaveLength(2);
    expect(r.bounced).toHaveLength(1);
    expect(r.bounced[0]!.primaryRole).toBe("dps");
  });

  it("12 = 2T/2H/8D → 2 full + 1 partial (2 DPS, 3 open)", () => {
    const pool: RCParticipant[] = [];
    for (let i = 0; i < 2; i++) pool.push(p("tank"));
    for (let i = 0; i < 2; i++) pool.push(p("healer"));
    for (let i = 0; i < 8; i++) pool.push(p("dps"));
    const r = formSkeletons(pool);
    expect(r.skeletons).toHaveLength(3);
    expect(r.skeletons.filter((s) => s.realMemberCount === 5)).toHaveLength(2);
    const partial = r.skeletons.find((s) => s.realMemberCount === 2);
    expect(partial).toBeDefined();
    expect(roleCounts(partial!)).toEqual({ t: 0, h: 0, d: 2, open: 3 });
  });

  it("11 = 3T/3H/5D → 3 skeletons, all assigned", () => {
    const pool: RCParticipant[] = [];
    for (let i = 0; i < 3; i++) pool.push(p("tank"));
    for (let i = 0; i < 3; i++) pool.push(p("healer"));
    for (let i = 0; i < 5; i++) pool.push(p("dps"));
    const r = formSkeletons(pool);
    expect(r.skeletons).toHaveLength(3);
    expect(r.bounced).toHaveLength(0);
    expect(r.skeletons[0]!.realMemberCount).toBe(5);
    expect(r.skeletons[1]!.realMemberCount).toBe(4); // 1T + 1H + 2D
    expect(r.skeletons[2]!.realMemberCount).toBe(2); // 1T + 1H, 3 open DPS
  });

  it("10 tanks → all bounced", () => {
    const pool = Array.from({ length: 10 }, () => p("tank"));
    const r = formSkeletons(pool);
    expect(r.skeletons).toHaveLength(0);
    expect(r.bounced).toHaveLength(10);
  });
});

describe("formSkeletons — flex pulls", () => {
  it("pulls a DPS flex→healer when it unlocks a second skeleton", () => {
    // 2T, 1H, 0D, 1 flexor (primary=dps, flex=healer).
    // Without flex: T1+H1 form 1 skel with 3 open. T2 bounced, flexor kept as DPS → dps1 of same skel.
    //   Actually: 1st draw = T1, H1, flexor, (no D), (no D) → 3 real.
    //   2nd draw = T2, none, none → 1 real → bounce T2.
    //   So 1 skeleton, 1 bounced.
    // With flex: T1+H1 first draw, T2+flexor 2nd draw → 2 skeletons, 0 bounced.
    const pool: RCParticipant[] = [
      p("tank", { id: 1 }),
      p("tank", { id: 2 }),
      p("healer", { id: 3 }),
      p("dps", { id: 4, flex: "healer" }),
    ];
    const r = formSkeletons(pool);
    expect(r.skeletons).toHaveLength(2);
    expect(r.bounced).toHaveLength(0);
    // Flexor must be in a healer slot and marked filledByFlex
    const flexed = r.skeletons
      .flatMap((s) => s.slots)
      .find((slot) => slot.participant?.signupId === 4);
    expect(flexed).toBeDefined();
    expect(flexed!.position).toBe("healer");
    expect(flexed!.filledByFlex).toBe(true);
  });

  it("does NOT pull flex when count would not increase", () => {
    // 1T, 1H, 3D, flexor (primary=dps, flex=tank). Already 1 full skeleton.
    // Pulling flex would strand DPS, count unchanged → don't pull.
    const pool: RCParticipant[] = [
      p("tank", { id: 1 }),
      p("healer", { id: 2 }),
      p("dps", { id: 3 }),
      p("dps", { id: 4 }),
      p("dps", { id: 5, flex: "tank" }),
    ];
    const r = formSkeletons(pool);
    expect(r.skeletons).toHaveLength(1);
    const p5 = r.skeletons[0]!.slots.find((s) => s.participant?.signupId === 5);
    expect(p5).toBeDefined();
    expect(p5!.position.startsWith("dps")).toBe(true);
    expect(p5!.filledByFlex).toBe(false);
  });
});

describe("formSkeletons — priority flag", () => {
  it("slots priority-flagged players before non-flagged of the same role", () => {
    // 2T, 1H, 3D. Only 1 skeleton forms. The priority tank must land in it.
    const pool: RCParticipant[] = [
      p("tank", { id: 1, priority: false }),
      p("tank", { id: 2, priority: true }),
      p("healer", { id: 3 }),
      p("dps", { id: 4 }),
      p("dps", { id: 5 }),
      p("dps", { id: 6 }),
    ];
    const r = formSkeletons(pool);
    expect(r.skeletons).toHaveLength(1);
    const tankSlot = r.skeletons[0]!.slots.find((s) => s.position === "tank");
    expect(tankSlot!.participant!.signupId).toBe(2); // priority wins
    expect(r.bounced).toHaveLength(1);
    expect(r.bounced[0]!.signupId).toBe(1);
  });
});

describe("formSkeletons — invariants", () => {
  it("every skeleton has exactly 5 slots in canonical order", () => {
    const pool: RCParticipant[] = [];
    for (let i = 0; i < 3; i++) pool.push(p("tank"));
    for (let i = 0; i < 3; i++) pool.push(p("healer"));
    for (let i = 0; i < 9; i++) pool.push(p("dps"));
    const r = formSkeletons(pool);
    for (const s of r.skeletons) {
      expect(s.slots.map((x) => x.position)).toEqual([
        "tank",
        "healer",
        "dps1",
        "dps2",
        "dps3",
      ]);
    }
  });

  it("every skeleton has >= 2 real members", () => {
    const pool: RCParticipant[] = [
      p("tank"),
      p("healer"),
      p("dps"),
      p("dps"),
      p("dps"),
      p("dps"),
      p("dps"),
    ];
    const r = formSkeletons(pool);
    for (const s of r.skeletons) expect(s.realMemberCount).toBeGreaterThanOrEqual(2);
  });

  it("no participant appears in more than one skeleton", () => {
    const pool = Array.from({ length: 20 }, (_, i) => {
      const role: Role = i % 3 === 0 ? "tank" : i % 3 === 1 ? "healer" : "dps";
      return p(role);
    });
    const r = formSkeletons(pool);
    const placed = r.skeletons.flatMap((s) =>
      s.slots.filter((slot) => slot.participant).map((slot) => slot.participant!.signupId),
    );
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("totalParticipants = placed + bounced", () => {
    const pool: RCParticipant[] = [];
    for (let i = 0; i < 4; i++) pool.push(p("tank"));
    for (let i = 0; i < 2; i++) pool.push(p("healer"));
    for (let i = 0; i < 9; i++) pool.push(p("dps"));
    const r = formSkeletons(pool);
    const placed = r.skeletons.flatMap((s) =>
      s.slots.filter((slot) => slot.participant),
    ).length;
    expect(placed + r.bounced.length).toBe(pool.length);
  });
});
