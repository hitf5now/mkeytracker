--[[
    MKeyTracker.lua — addon entry point
    Loaded after MKeyTrackerUtils.lua and before MKeyTrackerCapture.lua.

    SavedVariables schema (MKeyTrackerDB):
    {
        pendingRuns = {               -- outbound queue, FIFO
            {
                challengeModeId = 123,  keystoneLevel = 15,
                completionMs = 1710000, onTime = true, upgrades = 2,
                deaths = 0, timeLostSec = 0, serverTime = 1744500000,
                affixes = { 9, 10, 11 }, region = "us",
                members = {
                    { name, realm, class, spec, role },  -- 5 entries
                },
                source = "addon",
                dungeonName = "...", dungeonTimeLimitSec = 600,
                oldRating, newRating, ratingGained,
                isMapRecord, isAffixRecord, isEligibleForScore,
                wowSeasonId = 17,
            },
        },
        inbound = {},                  -- populated by companion app, read on /reload
        settings = {
            debugMode = false,
        },
        lastCapturedHash = "...",      -- client-side dedup across /reloads
        lastUpdatedAt = <unix seconds>,
    }
]]--

local addonName, ns = ...

ns.version = "0.4.3"

-- ─── SavedVariables init ──────────────────────────────────────────────────
local function InitDB()
    if not MKeyTrackerDB then MKeyTrackerDB = {} end
    MKeyTrackerDB.pendingRuns = MKeyTrackerDB.pendingRuns or {}
    MKeyTrackerDB.inbound = MKeyTrackerDB.inbound or {}
    MKeyTrackerDB.settings = MKeyTrackerDB.settings or { debugMode = false }
    -- lastCapturedHash may be nil on a fresh install
    MKeyTrackerDB.lastUpdatedAt = MKeyTrackerDB.lastUpdatedAt or 0
end

-- ─── Event dispatch ───────────────────────────────────────────────────────
local frame = CreateFrame("Frame", "MKeyTrackerEventFrame")
frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("CHALLENGE_MODE_START")
frame:RegisterEvent("CHALLENGE_MODE_COMPLETED")
-- Encounter events: used to re-enable combat logging mid-key in case another
-- addon (notably BigWigs) called LoggingCombat(false) on the previous boss kill.
frame:RegisterEvent("ENCOUNTER_START")

frame:SetScript("OnEvent", function(self, event, arg1, ...)
    if event == "ADDON_LOADED" then
        if arg1 ~= addonName then return end
        InitDB()
        local pending = #MKeyTrackerDB.pendingRuns
        ns.Utils.Print(string.format(
            "v%s loaded. %d pending run(s) in queue.",
            ns.version, pending
        ))
        if pending > 0 then
            ns.Utils.Print("Type |cffffff00/mkt dump|r to inspect, or /reload to flush to disk for the companion app.")
        end
    elseif event == "PLAYER_LOGIN" then
        ns.Utils.Debug("PLAYER_LOGIN fired")
        if ns.Logging and ns.Logging.CheckAndWarn then
            ns.Logging.CheckAndWarn(false)
        end
    elseif event == "CHALLENGE_MODE_START" then
        -- Re-warn if ACL is off — this key will produce impoverished log data.
        if ns.Logging and ns.Logging.CheckAndWarn then
            ns.Logging.CheckAndWarn(true)
        end
        -- Auto-enable combat logging so WoWCombatLog.txt captures this key.
        -- Users don't need to remember /combatlog each session.
        if ns.Logging and ns.Logging.EnsureLogging then
            ns.Logging.EnsureLogging()
        end
        -- Snapshot the party roster + start spec detection via inspect
        if ns.CombatLog and ns.CombatLog.Start then
            ns.CombatLog.Start()
        end
        if ns.Capture and ns.Capture.OnStart then
            ns.Capture.OnStart()
        end
    elseif event == "ENCOUNTER_START" then
        -- Re-enable logging mid-key if another addon (BigWigs) turned it off
        -- on the previous boss kill. No-op if already active.
        if ns.Logging and ns.Logging.EnsureLogging then
            ns.Logging.EnsureLogging()
        end
    elseif event == "CHALLENGE_MODE_COMPLETED" then
        if ns.Capture and ns.Capture.OnCompleted then
            ns.Capture.OnCompleted()
        end
        -- Clear inspect state after capture (snapshot persists intentionally)
        if ns.CombatLog and ns.CombatLog.Clear then
            ns.CombatLog.Clear()
        end
    end
end)

-- Expose namespace globally so /mkt commands and debug tools can poke at it.
_G.MKeyTracker = ns
