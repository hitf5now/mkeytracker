import { describe, expect, it } from "vitest";
import {
  isRefreshEligible,
  REFRESH_GRACE_SECONDS,
} from "../src/plugins/refresh-eligibility.js";

const NOW = 1_750_000_000; // arbitrary fixed unix time (seconds)

describe("isRefreshEligible", () => {
  it("accepts a token that has not expired yet", () => {
    expect(isRefreshEligible(NOW + 60, NOW)).toBe(true);
  });

  it("accepts a token expiring exactly now", () => {
    expect(isRefreshEligible(NOW, NOW)).toBe(true);
  });

  it("accepts a token expired within the grace window", () => {
    expect(isRefreshEligible(NOW - 1, NOW)).toBe(true);
    expect(isRefreshEligible(NOW - REFRESH_GRACE_SECONDS + 1, NOW)).toBe(true);
  });

  it("accepts a token expired exactly at the grace boundary", () => {
    expect(isRefreshEligible(NOW - REFRESH_GRACE_SECONDS, NOW)).toBe(true);
  });

  it("rejects a token expired past the grace window", () => {
    expect(isRefreshEligible(NOW - REFRESH_GRACE_SECONDS - 1, NOW)).toBe(false);
  });

  it("rejects tokens without a usable exp claim", () => {
    expect(isRefreshEligible(undefined, NOW)).toBe(false);
    expect(isRefreshEligible(null, NOW)).toBe(false);
    expect(isRefreshEligible("123", NOW)).toBe(false);
    expect(isRefreshEligible(Number.NaN, NOW)).toBe(false);
    expect(isRefreshEligible(Number.POSITIVE_INFINITY, NOW)).toBe(false);
  });
});
