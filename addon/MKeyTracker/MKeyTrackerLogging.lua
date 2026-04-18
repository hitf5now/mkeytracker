--[[
    MKeyTrackerLogging.lua — combat-log system integration (WoW's built-in logging)

    Responsibilities:
      - Inspect the `advancedCombatLogging` CVar and warn the user if it's off.
        Without this CVar, WoWCombatLog.txt omits COMBATANT_INFO spec detection
        and all advanced fields the companion relies on for enrichment.
      - Provide a user-initiated `/mkt acl` command to enable the CVar.
      - Report combined status (ACL CVar + /combatlog session state) on demand.

    Deliberately does NOT flip the CVar without user action: the same politeness
    principle that applies to WoWCombatLog.txt extends to shared client settings.

    Separate file from MKeyTrackerCombatLog.lua (which handles party-inspect spec
    detection) so this experimental enrichment path can be removed cleanly
    without touching existing functionality.
]]--

local addonName, ns = ...
ns.Logging = {}

-- ─── Primitives ─────────────────────────────────────────────────────────────

function ns.Logging.IsACLEnabled()
    local v = GetCVar("advancedCombatLogging")
    return v == "1"
end

function ns.Logging.IsLoggingActive()
    -- LoggingCombat() returns true / false / nil (nil = rate-limit hit).
    return LoggingCombat() == true
end

-- Enables the CVar. Called only from a user-initiated path (slash command).
-- Returns the post-set state so the caller can confirm.
function ns.Logging.EnableACL()
    SetCVar("advancedCombatLogging", "1")
    return ns.Logging.IsACLEnabled()
end

-- ─── User-facing warning with session-level dedup ───────────────────────────

local warnedThisSession = false

-- Prints a friendly banner if ACL is off. No-op if it's on.
-- Passes `force=true` from key-start to show the banner again even if the user
-- has already seen it this session — they're about to run content that needs it.
function ns.Logging.CheckAndWarn(force)
    if ns.Logging.IsACLEnabled() then
        warnedThisSession = false  -- reset so a future disable can re-warn
        return true
    end

    if warnedThisSession and not force then return false end
    warnedThisSession = true

    local chat = DEFAULT_CHAT_FRAME
    chat:AddMessage("|cffffff00[MKeyTracker]|r |cffff6b6bAdvanced Combat Logging is OFF|r.")
    chat:AddMessage("    Required for per-player combat stats on the M+ Platform.")
    chat:AddMessage("    Enable now: type |cffffff00/mkt acl|r  (one-time, persists).")
    chat:AddMessage("    Or: Escape -> System -> Network -> 'Advanced Combat Logging'.")
    return false
end

-- ─── Status ─────────────────────────────────────────────────────────────────

-- ─── Auto-start logging on key entry ───────────────────────────────────────
--
-- Called from CHALLENGE_MODE_START and ENCOUNTER_START. Ensures the session
-- is actively writing to WoWCombatLog.txt. The ENCOUNTER_START re-enable is
-- specifically for the BigWigs conflict: that addon calls LoggingCombat(false)
-- on boss deaths in M+ keys, which would silently stop logging mid-key.
--
-- Rate limit: LoggingCombat() is capped at 5 calls per 10s SHARED across all
-- addons. We only call it when state is actually off, so we don't burn budget.

function ns.Logging.EnsureLogging()
    if ns.Logging.IsLoggingActive() then return true end
    -- Not active — turn it on.
    LoggingCombat(true)
    local now = ns.Logging.IsLoggingActive()
    if now then
        ns.Utils.Debug("LoggingCombat enabled automatically")
    else
        ns.Utils.Debug("LoggingCombat() returned false/nil — may be rate-limited")
    end
    return now
end

function ns.Logging.PrintStatus()
    local acl = ns.Logging.IsACLEnabled()
    local logging = ns.Logging.IsLoggingActive()
    ns.Utils.Print(string.format(
        "Advanced Combat Logging: %s  |  /combatlog active this session: %s",
        acl and "|cff00ff00ON|r" or "|cffff6b6bOFF|r",
        logging and "|cff00ff00yes|r" or "|cffff6b6bno|r"
    ))
end
