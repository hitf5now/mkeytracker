/**
 * Unit tests for the season-sync gating rules.
 *
 * Pure function tests — no DB, no network. `evaluateCandidate` is the guard
 * that decides whether to flip which season is active, and getting that
 * wrong silently resets every leaderboard, so each refusal path is pinned
 * here. The regression these exist for is the Midnight S1 → S2 rollover on
 * 2026-08-18, which went unnoticed for three weeks.
 */

import { describe, it, expect } from "vitest";
import { evaluateCandidate, deriveSeasonIdentity } from "../src/services/season-sync-rules.js";
import type { SeasonInput } from "../src/services/seasons.js";

const NOW = new Date("2026-08-29T00:00:00Z");

function season(overrides: Partial<SeasonInput> = {}): SeasonInput {
  return {
    slug: "midnight-s2",
    name: "Midnight Season 2",
    patch: "12.1.0",
    startsAt: "2026-08-18T15:00:00Z",
    endsAt: null,
    isActive: false,
    externalSlug: "season-mn-2",
    wowSeasonId: 18,
    dungeons: [588, 586, 249, 587, 399, 250, 584, 585].map((id, i) => ({
      challengeModeId: id,
      slug: `d${i}`,
      name: `Dungeon ${i}`,
      shortCode: `D${i}`,
      parTimeSec: 1800,
    })),
    ...overrides,
  };
}

const S1_POOL = "161,239,402,556,557,558,559,560";

describe("evaluateCandidate", () => {
  it("activates a started season with a different pool", () => {
    const r = evaluateCandidate({
      candidate: season(),
      activeSlug: "midnight-s1",
      activePoolKey: S1_POOL,
      now: NOW,
    });
    expect(r.activate).toBe(true);
  });

  it("refuses a season that has not started yet", () => {
    const r = evaluateCandidate({
      candidate: season({ startsAt: "2026-12-01T15:00:00Z" }),
      activeSlug: "midnight-s1",
      activePoolKey: S1_POOL,
      now: NOW,
    });
    expect(r.activate).toBe(false);
    expect(r.reason).toMatch(/has not started/);
  });

  it("refuses a suspiciously small dungeon pool", () => {
    const r = evaluateCandidate({
      candidate: season({ dungeons: season().dungeons.slice(0, 2) }),
      activeSlug: "midnight-s1",
      activePoolKey: S1_POOL,
      now: NOW,
    });
    expect(r.activate).toBe(false);
    expect(r.reason).toMatch(/suspect pool/);
  });

  it("is a no-op when the candidate is already active", () => {
    const r = evaluateCandidate({
      candidate: season(),
      activeSlug: "midnight-s2",
      activePoolKey: "249,250,399,584,585,586,587,588",
      now: NOW,
    });
    expect(r.activate).toBe(false);
    expect(r.reason).toMatch(/already active/);
  });

  it("refuses a relabelled season that shares the active pool", () => {
    // Guards against Raider.IO side modes (break-the-meta, legion-remix)
    // which carry a distinct slug but the live season's dungeon pool.
    const r = evaluateCandidate({
      candidate: season({ slug: "midnight-s2-break-the-meta" }),
      activeSlug: "midnight-s2",
      activePoolKey: "249,250,399,584,585,586,587,588",
      now: NOW,
    });
    expect(r.activate).toBe(false);
    expect(r.reason).toMatch(/relabel, not a rollover/);
  });

  it("activates when there is no active season at all (bootstrap)", () => {
    const r = evaluateCandidate({
      candidate: season(),
      activeSlug: null,
      activePoolKey: null,
      now: NOW,
    });
    expect(r.activate).toBe(true);
  });

  it("treats pool order as irrelevant when comparing to the active pool", () => {
    const shuffled = season({
      slug: "midnight-s2-relabel",
      dungeons: [...season().dungeons].reverse(),
    });
    const r = evaluateCandidate({
      candidate: shuffled,
      activeSlug: "midnight-s2",
      activePoolKey: "249,250,399,584,585,586,587,588",
      now: NOW,
    });
    expect(r.activate).toBe(false);
    expect(r.reason).toMatch(/relabel, not a rollover/);
  });
});

describe("deriveSeasonIdentity", () => {
  const rio = (slug: string, name: string) =>
    ({ slug, name }) as Parameters<typeof deriveSeasonIdentity>[0];

  it("maps a known expansion abbreviation to the platform's naming", () => {
    expect(deriveSeasonIdentity(rio("season-mn-2", "MN Season 2"))).toEqual({
      slug: "midnight-s2",
      name: "Midnight Season 2",
      expansion: "Midnight",
      seasonNumber: 2,
    });
  });

  it("handles multi-word expansion names", () => {
    expect(deriveSeasonIdentity(rio("season-tww-3", "TWW Season 3"))).toEqual({
      slug: "the-war-within-s3",
      name: "The War Within Season 3",
      expansion: "The War Within",
      seasonNumber: 3,
    });
  });

  it("falls back to upstream values for an unknown expansion", () => {
    // A future expansion must not block the sync — an admin can rename the
    // row later, and externalSlug keeps the sync pointed at it either way.
    // Grouping fields stay null so the picker files it under "Other" rather
    // than inventing an expansion name.
    expect(deriveSeasonIdentity(rio("season-xyz-1", "XYZ Season 1"))).toEqual({
      slug: "season-xyz-1",
      name: "XYZ Season 1",
      expansion: null,
      seasonNumber: null,
    });
  });

  it("falls back for non-standard slugs like post-seasons", () => {
    expect(deriveSeasonIdentity(rio("season-tww-1-post", "TWW Season 1 Post"))).toEqual({
      slug: "season-tww-1-post",
      name: "TWW Season 1 Post",
      expansion: null,
      seasonNumber: null,
    });
  });
});
