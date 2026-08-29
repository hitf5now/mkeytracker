import { describe, expect, it } from "vitest";
import { needsFirstRunWizard, type CompanionConfig } from "../src/core/config.js";

/**
 * `needsFirstRunWizard` gates two things that must agree: which page the
 * window loads, and whether the app may boot straight into the tray. Since
 * `startMinimized` defaults to true, a false negative here means a
 * half-configured install starts hidden with the wizard behind it — the app
 * looks like it failed to launch, with no obvious way back.
 */

function config(overrides: Partial<CompanionConfig> = {}): CompanionConfig {
  return {
    jwt: "token",
    jwtExpiresAt: "2026-12-01T00:00:00Z",
    apiBaseUrl: "https://api.mythicplustracker.com",
    wowInstallPath: "C:\\Program Files (x86)\\World of Warcraft",
    wowAccountName: "ACCOUNT",
    savedVariablesPath: "C:\\wow\\SavedVariables\\MKeyTracker.lua",
    postedRunHashes: [],
    lastSubmittedAt: null,
    onboarded: true,
    telemetryInstallId: null,
    telemetryOptOut: false,
    startMinimized: true,
    ...overrides,
  };
}

/** Mirrors the startup decision in electron/main.ts. */
function shouldStartHidden(cfg: CompanionConfig): boolean {
  return cfg.startMinimized && !needsFirstRunWizard(cfg);
}

describe("needsFirstRunWizard", () => {
  it("is false for a fully configured install", () => {
    expect(needsFirstRunWizard(config())).toBe(false);
  });

  it("is true when onboarding never completed", () => {
    expect(needsFirstRunWizard(config({ onboarded: false }))).toBe(true);
  });

  it("is true when the account was never paired", () => {
    expect(needsFirstRunWizard(config({ jwt: null }))).toBe(true);
  });

  it("is true when SavedVariables was never resolved", () => {
    expect(needsFirstRunWizard(config({ savedVariablesPath: null }))).toBe(true);
  });
});

describe("start-minimized decision", () => {
  it("starts hidden once setup is done and the user opted in", () => {
    expect(shouldStartHidden(config())).toBe(true);
  });

  it("stays visible when the user opted out", () => {
    expect(shouldStartHidden(config({ startMinimized: false }))).toBe(false);
  });

  it("never hides a fresh install, even with the default opt-in", () => {
    // The regression that matters: startMinimized defaults to true, so a
    // brand-new install would vanish into the tray without this guard.
    expect(shouldStartHidden(config({ onboarded: false, jwt: null }))).toBe(false);
  });

  it("never hides an install that lost its pairing", () => {
    // "Pair again" clears jwt + onboarded and reopens the wizard; a restart
    // in that state has to show the window too.
    expect(shouldStartHidden(config({ jwt: null, onboarded: false }))).toBe(false);
  });
});
