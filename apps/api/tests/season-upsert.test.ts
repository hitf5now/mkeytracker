/**
 * Regression tests for `upsertSeason`'s handling of `isActive`.
 *
 * The bug these pin: `upsertSeason` used to write `isActive` on update as
 * well as create. The season sync refreshes season metadata on every tick
 * and passes `isActive: false` to mean "activation is not my decision" —
 * so the first sync after a rollover deactivated the season the seed had
 * just activated, leaving *no* active season and 500ing run submission.
 *
 * Driven with a stub client rather than a real DB: the whole point is to
 * assert the exact shape of the write, which a stub captures precisely.
 */

import { describe, it, expect } from "vitest";
import { upsertSeason, type SeasonInput } from "../src/services/seasons.js";

interface UpsertCall {
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

function stubPrisma(existing: boolean) {
  const calls: UpsertCall[] = [];
  const client = {
    season: {
      findUnique: async () => (existing ? { id: 1, slug: "midnight-s2" } : null),
      upsert: async (args: UpsertCall) => {
        calls.push(args);
        return { id: 1, slug: "midnight-s2" };
      },
    },
    dungeon: {
      upsert: async () => ({}),
      findMany: async () => [],
      delete: async () => ({}),
    },
  };
  return { client, calls };
}

const input: SeasonInput = {
  slug: "midnight-s2",
  name: "Midnight Season 2",
  patch: "12.1.0",
  startsAt: "2026-08-18T15:00:00Z",
  endsAt: null,
  isActive: false,
  externalSlug: "season-mn-2",
  wowSeasonId: 18,
  dungeons: [
    { challengeModeId: 588, slug: "altar-of-fangs", name: "Altar of Fangs", shortCode: "AOF", parTimeSec: 1800 },
  ],
};

describe("upsertSeason", () => {
  it("never writes isActive on update", async () => {
    const { client, calls } = stubPrisma(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertSeason(client as any, input);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.update).not.toHaveProperty("isActive");
  });

  it("still seeds isActive when creating the row", async () => {
    const { client, calls } = stubPrisma(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertSeason(client as any, { ...input, isActive: true });
    expect(calls[0]!.create).toMatchObject({ isActive: true });
  });

  it("carries the upstream identifiers through on update", async () => {
    const { client, calls } = stubPrisma(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertSeason(client as any, input);
    expect(calls[0]!.update).toMatchObject({
      externalSlug: "season-mn-2",
      wowSeasonId: 18,
    });
  });
});
