# WoW Advanced Combat Logging — Research & Investigation Plan

**Date:** 2026-04-18
**Branch:** `feature/combat-log-ingestion`
**Status:** Research complete, prototype pending

---

## Research Question

Can WoW's native `WoWCombatLog.txt` file — produced by the "Advanced Combat Logging" feature and consumed by sites like [warcraftlogs.com](https://www.warcraftlogs.com) — serve as an additional data source alongside our existing SavedVariables Lua pipeline in MKeyTracker?

---

## 1. Enabling Advanced Combat Logging

### The "Advanced" CVar (persists)

Navigate: **Escape → System → Network → "Advanced Combat Logging"** checkbox.

Equivalents:

```
/console advancedCombatLogging 1
```

```lua
C_CVar.SetCVar("advancedCombatLogging", 1)
```

This controls the *format* of what gets written (enables the 17 extra advanced fields). It is a saved CVar — set it once, it survives logout and client restarts.

### `/combatlog` — the on/off toggle (does NOT persist)

Separate concern. Tells WoW to start writing events to `WoWCombatLog.txt`. Must be re-issued every login/reload.

Lua API:

```lua
LoggingCombat(true)   -- start
LoggingCombat(false)  -- stop
LoggingCombat()       -- query; returns true/false/nil
```

`nil` = rate limit hit. Rate limit: **5 calls per 10 seconds**, shared across all addons and the slash command.

### Auto-enabling options

- **[AutoCombatLogger](https://www.curseforge.com/wow/addons/autocombatlogger)** (Talryn) — most popular, 526K+ downloads, v12.0.2 Feb 2026. Allowlist-based by instance. Configured via `/acl`.
- **[LoggerHead](https://www.curseforge.com/wow/addons/loggerhead)** — alternative.
- **MKeyTracker itself** — add `LoggingCombat(true)` on `CHALLENGE_MODE_START` and `LoggingCombat(false)` on `CHALLENGE_MODE_END`. ~10 lines of Lua.

### Known conflicts

- **BigWigs** calls `LoggingCombat(false)` on boss death in M+. Our addon would need to re-enable on each `ENCOUNTER_START`.

---

## 2. File Location and Format

### Path (Windows, Retail)

```
C:\Program Files (x86)\World of Warcraft\_retail_\Logs\WoWCombatLog.txt
```

- Single file, **appends forever** — no automatic rotation
- Not flushed on force-quit (`Alt+F4` or process kill); need a graceful logout / character screen for final buffer to reach disk
- Writes are **buffered** — can be delayed seconds to minutes depending on event volume. This makes real-time tailing unreliable; post-hoc parsing is the pragmatic path.

### Line format

Plain UTF-8. One event per line, comma-separated with quoted strings:

```
11/21 12:01:34.071  COMBAT_LOG_VERSION,19,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,11.0.2,PROJECT_ID,1
```

Standard fields on every combat event:

- Timestamp `MM/DD HH:MM:SS.mmm` (wall clock)
- Event type (e.g. `SPELL_DAMAGE`, `CHALLENGE_MODE_START`)
- `hideCaster` boolean
- `sourceGUID`, `sourceName`, `sourceFlags`, `sourceRaidFlags`
- `destGUID`, `destName`, `destFlags`, `destRaidFlags`
- Event-specific parameters

### What "Advanced" adds

When `ADVANCED_LOG_ENABLED,1`, most combat events gain 17 extra fields: `infoGUID`, `ownerGUID`, `currentHP`, `maxHP`, `attackPower`, `spellPower`, `armor`, `absorb`, `powerType`, `currentPower`, `maxPower`, `powerCost`, `positionX`, `positionY`, `uiMapID`, `facing`, `level` (NPC level or player item level).

---

## 3. Mythic+ Specific Events

### `CHALLENGE_MODE_START`

```
CHALLENGE_MODE_START, zoneName, instanceID, challengeModeID, keystoneLevel, [affixID, ...]
```

Example:

```
CHALLENGE_MODE_START,"Mists of Tirna Scithe",2290,375,11,[9,122,4,121]
```

### `CHALLENGE_MODE_END`

```
CHALLENGE_MODE_END, instanceID, success, keystoneLevel, totalTime
```

- `success` = 1 in-time, 0 depleted
- `totalTime` in **milliseconds**, includes death penalties (5s/death)

### `ENCOUNTER_START` / `ENCOUNTER_END`

Emitted per boss pull inside a key. `ENCOUNTER_END` includes `success` (kill/wipe) and `fightTime` in ms.

### `COMBATANT_INFO` — roster with specs

Emitted for **each player in the instance** on every `ENCOUNTER_START`. Includes:

- `CurrentSpecID` (auto — solves our "spec never auto-set" problem)
- Full primary + secondary stats
- Complete gear (item ID, ilvl, enchants, gems, bonus IDs per slot)
- Class + PvP talents
- "Interesting auras" (flasks, food, set bonuses)

Limitation: only fires on `ENCOUNTER_START`, so a run with zero bosses pulled yields no `COMBATANT_INFO`.

### Reconstruction summary

| Data | SavedVariables (Addon) | Combat Log |
|------|------------------------|------------|
| Key level | ✓ | ✓ |
| Dungeon name | ✓ | ✓ |
| Affix list | ✓ | ✓ |
| Completion time | ✓ | ✓ |
| In-time vs depleted | ✓ | ✓ |
| Spec per player | ✗ (user dropdown only) | ✓ (auto) |
| Item level per player | ✗ | ✓ |
| Per-boss kill times | ✗ | ✓ |
| Death count | ✗ | ✓ (UNIT_DIED) |
| Damage/healing breakdown | ✗ | ✓ |
| Keystone par time | ✗ | ✗ (lookup table) |
| Run-end state if crash/force-quit | ✓ (reliable) | ✗ (buffer lost) |

---

## 4. Parsers and Libraries

**No mature npm/TS parser exists.** Options surveyed:

| Library | Status | Notes |
|---------|--------|-------|
| [wow-combat-log-parser](https://www.npmjs.com/package/wow-combat-log-parser) | Archived 2023 | TS, Arena-only, no CHALLENGE_MODE |
| [wow-log-parser](https://github.com/JanKoppe/wow-log-parser) | Archived 2021 | Incomplete |
| [nodewowlog](https://github.com/RalphSleigh/nodewowlog) | Stale 2020 | GraphQL app, not a library |
| [WoWAnalyzer/CombatLogParser](https://github.com/WoWAnalyzer/CombatLogParser) | Active | **AGPL** — copyleft, problematic for us |
| [rp4rk/WoWP](https://github.com/rp4rk/WoWP) | Stale 2021 | Rust, AGPL |

**Conclusion:** We'll write a focused parser for the ~6 event types we care about (~150 lines of TS).

### WarcraftLogs uploader

[RPGLogs/Uploaders-warcraftlogs](https://github.com/RPGLogs/Uploaders-warcraftlogs) — Electron app, **releases-only** (not open source). Watches Logs dir, uploads after each combat segment. Same architectural pattern as our companion's SavedVariables watcher.

---

## 5. Practical Considerations

- **File size:** single M+ run ≈ 20–80 MB. Full raid night ≈ 500 MB–1 GB. Unmanaged log grows to tens of GB.
- **Real-time parsing:** Unreliable due to write buffer delay. Use post-hoc after `CHALLENGE_MODE_END` appears.
- **Privacy:** Log captures all combatants in range, not just the uploader. In a 5-person M+ context this is minimal (just the party) but worth a UX note.
- **challengeModeID vs instanceID:** Need a lookup table (belongs in `packages/wow-constants`).
- **Affix IDs are not self-describing** (also needs a lookup table).

---

## 6. Recommended Prototype Scope

1. **Addon change:** `LoggingCombat(true)` on `CHALLENGE_MODE_START`, `LoggingCombat(false)` on `CHALLENGE_MODE_END`. Re-enable on each `ENCOUNTER_START` to survive BigWigs conflict.
2. **Companion change:** After existing SavedVariables watcher fires, also scan `WoWCombatLog.txt` backward from EOF for the last `CHALLENGE_MODE_START` → `CHALLENGE_MODE_END` segment.
3. **Parser:** Focused TS parser for `CHALLENGE_MODE_START`, `CHALLENGE_MODE_END`, `ENCOUNTER_START`, `ENCOUNTER_END`, `COMBATANT_INFO`, `UNIT_DIED`. No deps.
4. **Merge:** Enrich the addon's run payload with spec-per-player, death count, boss kill times before submitting to API.

---

## 7. Minimal Steps to Generate a Sample Log (for investigation)

Goal: get a small `WoWCombatLog.txt` with at least one combat segment to inspect the real format.

1. **Enable Advanced Combat Logging (one-time):** In WoW, press **Escape → System → Network → check "Advanced Combat Logging"** → Okay.
2. **Start logging:** In chat, type:
   ```
   /combatlog
   ```
   A system message confirms: "Combat log started."
3. **Generate events (any of these works):**
   - Attack a training dummy (Valdrakken, your garrison, etc.) for ~30 seconds
   - Run a dungeon on any difficulty
   - Do a M+ key (ideal — gives us `CHALLENGE_MODE_*` and `COMBATANT_INFO`)
4. **Stop logging:**
   ```
   /combatlog
   ```
   "Combat log ended."
5. **Grab the file** from:
   ```
   C:\Program Files (x86)\World of Warcraft\_retail_\Logs\WoWCombatLog.txt
   ```
   (Path may differ if WoW installed elsewhere — check `World of Warcraft\_retail_\Logs\`.)
6. **Copy it into this repo** at `samples/combatlog/` so we can reference it in tests and parser prototypes. Keep it short; a 30-second dummy test plus one dungeon run is plenty.

**Tip:** If you want just the M+ events without thousands of dummy-swing lines, delete or rename the existing `WoWCombatLog.txt` before step 2 so we start fresh.

---

## Key Sources

- [Warcraft Wiki — COMBAT_LOG_EVENT](https://warcraft.wiki.gg/wiki/COMBAT_LOG_EVENT) — event schemas and parameter tables
- [Warcraft Wiki — API LoggingCombat](https://warcraft.wiki.gg/wiki/API_LoggingCombat) — function signature, rate limit
- [Warcraft Wiki — Combat Log](https://warcraft.wiki.gg/wiki/Combat_Log) — file format overview
- [Blizzard Blue — COMBATANT_INFO announcement](https://www.bluetracker.gg/wow/topic/us-en/20419432775-new-logging-feature-combatant-info/)
- [Raider.IO — How to Enable Advanced Combat Logging](https://support.raider.io/kb/raider-dot-io-mythic-plus-addon/how-to-enable-advanced-combat-logging)
- [Archon.gg — Getting Started with Logging](https://www.archon.gg/wow/articles/help/getting-started) — BigWigs conflict note
- [RPGLogs/Uploaders-warcraftlogs](https://github.com/RPGLogs/Uploaders-warcraftlogs) — WarcraftLogs uploader (releases only)
- [AutoCombatLogger (GitHub)](https://github.com/Talryn/AutoCombatLogger) — open-source auto-logger
