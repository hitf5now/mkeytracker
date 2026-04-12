--[[
    MKeyTracker.lua — addon entry point
    Loaded after MKeyTrackerUtils.lua and before MKeyTrackerCapture.lua.

    SavedVariables schema (MKeyTrackerDB):
    {
        pendingRuns = {               -- outbound queue, FIFO
            {
                challengeModeId = 123,
                keystoneLevel = 15,
                completionMs = 1710000,
                onTime = true,
                upgrades = 2,
                deaths = 0,
                timeLostSec = 0,
                serverTime = 1744500000,
                affixes = { 9, 10, 11 },
                region = "us",
                members = {
                    { name = "Tanavast", realm = "trollbane", class = "shaman", spec = "Elemental", role = "dps" },
                    ...
                },
                source = "addon",
            },
            ...
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

ns.version = "0.1.0"

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
    elseif event == "CHALLENGE_MODE_START" then
        if ns.Capture and ns.Capture.OnStart then
            ns.Capture.OnStart()
        end
    elseif event == "CHALLENGE_MODE_COMPLETED" then
        if ns.Capture and ns.Capture.OnCompleted then
            ns.Capture.OnCompleted()
        end
    end
end)

-- Expose namespace globally so /mkt commands and debug tools can poke at it.
_G.MKeyTracker = ns
