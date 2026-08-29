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

ns.version = "0.4.21"

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
        -- Minimap only exists by PLAYER_LOGIN, not at ADDON_LOADED.
        if ns.Minimap and ns.Minimap.Init then
            ns.Minimap.Init()
        end
        if ns.Scout and ns.Scout.Init then
            ns.Scout.Init()
        end

        -- Wait a few seconds before speaking: chat frames and other addons
        -- are still initialising at PLAYER_LOGIN, and a line printed into
        -- that scroll gets lost.
        C_Timer.After(6, function()
            pcall(ns.ShowLoginDigest)
        end)
        if ns.Logging and ns.Logging.CheckAndWarn then
            ns.Logging.CheckAndWarn(false)
        end
    elseif event == "CHALLENGE_MODE_START" then
        -- What the player has to beat, while there is still time to act on
        -- it. Guarded end to end: a missing API or payload must not disturb
        -- the capture path that runs right after this.
        pcall(function()
            if not (ns.Inbound and ns.Inbound.BuildBriefing and ns.UI and ns.UI.ShowBriefing) then
                return
            end
            local mapId = C_ChallengeMode.GetActiveChallengeMapID()
            if not mapId then return end
            local level = C_ChallengeMode.GetActiveKeystoneInfo()
            local name, _, timeLimit = C_ChallengeMode.GetMapUIInfo(mapId)
            ns.UI.ShowBriefing(name, level, ns.Inbound.BuildBriefing(mapId, level, timeLimit))
        end)

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

-- ─── Login digest ─────────────────────────────────────────────────────────

--[[
    "Since you last played" — achievements earned and where the player now
    stands, printed once.

    The watermark is stored per install rather than per character: the
    achievements are the account's, and announcing the same three on every
    alt would be noise rather than news.
]]--
function ns.ShowLoginDigest()
    if not (ns.Inbound and ns.Inbound.BuildDigest) then return end

    MKeyTrackerDB.settings = MKeyTrackerDB.settings or {}
    local seen = MKeyTrackerDB.settings.lastDigestAt or 0

    local digest = ns.Inbound.BuildDigest(seen)
    if not digest then return end

    local count = #digest.achievements
    ns.Utils.Print(string.format(
        "Since you last played: |cffffd100%d achievement%s|r.",
        count, count == 1 and "" or "s"
    ))
    for i, entry in ipairs(digest.achievements) do
        if i > 5 then
            ns.Utils.Print(string.format("  ...and %d more.", count - 5))
            break
        end
        ns.Utils.Print(string.format("  %s |cff808080(%s)|r", entry.name, entry.rarity or "common"))
    end

    if digest.juiceRank and digest.juiceRankOf then
        ns.Utils.Print(string.format(
            "You are |cffffd100#%d|r of %d on Season Juice.",
            digest.juiceRank, digest.juiceRankOf
        ))
    end

    -- Watermark the newest one so this is said once, not every login.
    local newest = seen
    for _, entry in ipairs(digest.achievements) do
        if (entry.at or 0) > newest then newest = entry.at end
    end
    MKeyTrackerDB.settings.lastDigestAt = newest
end
