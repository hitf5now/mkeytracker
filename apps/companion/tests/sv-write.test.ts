import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSavedVariablesSource,
  removeSubmittedRuns,
  writeInbound,
} from "../src/core/sv-parser.js";

/**
 * The companion rewrites the addon's SavedVariables file when it clears
 * submitted runs. It used to rebuild that table from only the two keys it
 * modelled, silently deleting everything else — the player's saved toast
 * position in `settings`, and `inbound`, which is the whole
 * companion-to-addon channel. WoW masked it by rewriting the file from
 * memory at logout, so it only bit when the companion wrote with the game
 * closed. These pin that every key survives a rewrite.
 */

const dirs: string[] = [];

function svFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mkt-sv-"));
  dirs.push(dir);
  const path = join(dir, "MKeyTracker.lua");
  writeFileSync(path, contents, "utf-8");
  return path;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const RUN = `{
["challengeModeId"] = 588,
["keystoneLevel"] = 5,
["completionMs"] = 1455958,
["onTime"] = true,
["upgrades"] = 1,
["deaths"] = 3,
["timeLostSec"] = 0,
["serverTime"] = 1787619885,
["affixes"] = {},
["region"] = "us",
["members"] = {
{ ["name"] = "Solistome", ["realm"] = "trollbane", ["class"] = "druid", ["spec"] = "Restoration", ["role"] = "healer" },
{ ["name"] = "Xalia", ["realm"] = "malfurion", ["class"] = "monk", ["spec"] = "Windwalker", ["role"] = "dps" },
{ ["name"] = "Eljayye", ["realm"] = "trollbane", ["class"] = "paladin", ["spec"] = "Protection", ["role"] = "tank" },
}
}`;

const FULL_DB = `
MKeyTrackerDB = {
["inbound"] = {
["version"] = 1,
},
["settings"] = {
["debugMode"] = false,
["toastPosition"] = {
["point"] = "TOPLEFT",
["x"] = 120.5,
["y"] = -40,
},
},
["lastUpdatedAt"] = 1787619885,
["pendingRuns"] = {
${RUN},
},
["lastCapturedHash"] = "588|3|1787619885|x",
}
`;

describe("removeSubmittedRuns", () => {
  it("keeps settings and inbound when clearing runs", () => {
    const path = svFile(FULL_DB);
    const result = removeSubmittedRuns(path, new Set(["h1"]), () => "h1");
    expect(result.removed).toBe(1);

    const after = parseSavedVariablesSource(readFileSync(path, "utf-8"));
    expect(after.runs).toHaveLength(0);
    // The regression: these used to be gone after a rewrite.
    expect(after.db.settings).toMatchObject({
      debugMode: false,
      toastPosition: { point: "TOPLEFT", x: 120.5, y: -40 },
    });
    expect(after.db.inbound).toMatchObject({ version: 1 });
    expect(after.db.lastUpdatedAt).toBe(1787619885);
  });

  it("leaves the file alone when nothing was submitted", () => {
    const path = svFile(FULL_DB);
    const before = readFileSync(path, "utf-8");
    const result = removeSubmittedRuns(path, new Set(["other"]), () => "h1");
    expect(result.removed).toBe(0);
    expect(readFileSync(path, "utf-8")).toBe(before);
  });
});

describe("writeInbound", () => {
  it("replaces inbound and preserves queued runs and settings", () => {
    const path = svFile(FULL_DB);
    writeInbound(path, { version: 2, records: { "588": { bestLevel: 12 } } });

    const after = parseSavedVariablesSource(readFileSync(path, "utf-8"));
    expect(after.db.inbound).toMatchObject({
      version: 2,
      records: { "588": { bestLevel: 12 } },
    });
    // A queued run must not be collateral damage of pushing data inbound.
    expect(after.runs).toHaveLength(1);
    expect(after.db.settings).toMatchObject({ debugMode: false });
  });

  it("produces Lua the parser can read back", () => {
    const path = svFile(FULL_DB);
    // Quotes and backslashes are the realistic hazard — set and realm names
    // carry apostrophes ("Kings' Rest", "Jade Warlord's Dominion").
    const tricky =
      "Kings' Rest " + String.fromCharCode(34) + "best" +
      String.fromCharCode(34) + " " + String.fromCharCode(92) + " run";
    writeInbound(path, { note: tricky, nested: { list: [1, 2, 3], flag: true } });

    const after = parseSavedVariablesSource(readFileSync(path, "utf-8"));
    const inbound = after.db.inbound as Record<string, unknown>;
    expect(inbound.note).toBe(tricky);
    expect(inbound.nested).toMatchObject({ list: [1, 2, 3], flag: true });
  });
});
