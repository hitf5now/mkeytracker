import { describe, expect, it } from "vitest";
import { isNewerVersion } from "../src/electron/addon-update.js";

/**
 * Version comparison decides whether the dashboard offers an addon update.
 * A false negative silently strands players on an old addon after a fix has
 * shipped, which is exactly what serving the addon from the API is meant to
 * stop happening.
 */
describe("isNewerVersion", () => {
  it("offers an update when nothing is installed", () => {
    expect(isNewerVersion("0.4.15", null)).toBe(true);
  });

  it("does not offer an update when versions match", () => {
    expect(isNewerVersion("0.4.15", "0.4.15")).toBe(false);
  });

  it("compares numerically, not as strings", () => {
    // The regression a string compare would introduce: "0.4.9" > "0.4.10".
    expect(isNewerVersion("0.4.10", "0.4.9")).toBe(true);
    expect(isNewerVersion("0.4.9", "0.4.10")).toBe(false);
  });

  it("handles a major bump", () => {
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.9.9", "1.0.0")).toBe(false);
  });

  it("treats missing segments as zero", () => {
    expect(isNewerVersion("0.5", "0.5.0")).toBe(false);
    expect(isNewerVersion("0.5.1", "0.5")).toBe(true);
  });

  it("never reports a downgrade as an update", () => {
    expect(isNewerVersion("0.4.14", "0.4.15")).toBe(false);
  });

  it("offers an update when a version can't be parsed", () => {
    // Better to show a redundant update than to hide a real one behind an
    // unexpected version string.
    expect(isNewerVersion("0.4.15", "dev")).toBe(true);
    expect(isNewerVersion("nightly", "0.4.15")).toBe(true);
  });
});
