import { describe, expect, it } from "vitest";
import { isRefreshDue, REFRESH_WINDOW_MS } from "../src/core/token-refresh.js";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

describe("isRefreshDue", () => {
  it("is never due without a JWT", () => {
    expect(isRefreshDue(null, null, NOW)).toBe(false);
    expect(isRefreshDue(null, iso(-DAY_MS), NOW)).toBe(false);
  });

  it("is due when paired but no expiry is stored (pre-renewal configs)", () => {
    expect(isRefreshDue("jwt", null, NOW)).toBe(true);
  });

  it("is due when the stored expiry is unparseable", () => {
    expect(isRefreshDue("jwt", "not-a-date", NOW)).toBe(true);
  });

  it("is not due with plenty of lifetime left", () => {
    expect(isRefreshDue("jwt", iso(REFRESH_WINDOW_MS + DAY_MS), NOW)).toBe(false);
    expect(isRefreshDue("jwt", iso(30 * DAY_MS), NOW)).toBe(false);
  });

  it("is due inside the renewal window", () => {
    expect(isRefreshDue("jwt", iso(REFRESH_WINDOW_MS - 1), NOW)).toBe(true);
    expect(isRefreshDue("jwt", iso(DAY_MS), NOW)).toBe(true);
  });

  it("is due when already expired", () => {
    expect(isRefreshDue("jwt", iso(-1), NOW)).toBe(true);
    expect(isRefreshDue("jwt", iso(-45 * DAY_MS), NOW)).toBe(true);
  });
});
