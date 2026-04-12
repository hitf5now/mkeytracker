--[[
    MKeyTrackerCombatLog.lua — per-player combat stats tracking

    Registers COMBAT_LOG_EVENT_UNFILTERED at CHALLENGE_MODE_START and
    tracks per-player: deaths, interrupts, dispels, damage dealt,
    healing done, damage taken.

    Unregisters at CHALLENGE_MODE_COMPLETED. The accumulated stats are
    read by MKeyTrackerCapture.lua and included in the run payload.
]]--

local addonName, ns = ...
ns.CombatLog = {}

-- Active tracking state (nil when not in a key)
local tracking = nil

local PLAYER_FLAG = COMBATLOG_OBJECT_TYPE_PLAYER or 0x00000400

local function IsPlayer(flags)
    return bit.band(flags, PLAYER_FLAG) ~= 0
end

local function EnsurePlayer(guid)
    if not tracking then return nil end
    if not tracking.stats[guid] then
        tracking.stats[guid] = {
            damage = 0,
            healing = 0,
            damageTaken = 0,
            deaths = 0,
            interrupts = 0,
            dispels = 0,
        }
    end
    return tracking.stats[guid]
end

-- ─── Combat log handler ──────────────────────────────────────────────────
local clFrame = CreateFrame("Frame", "MKeyTrackerCombatLogFrame")

local function OnCombatLogEvent()
    if not tracking or ns.CombatLog._stopped then return end

    local timestamp, subevent, hideCaster,
          sourceGUID, sourceName, sourceFlags, sourceRaidFlags,
          destGUID, destName, destFlags, destRaidFlags,
          p12, p13, p14, p15, p16, p17, p18, p19, p20, p21 = CombatLogGetCurrentEventInfo()

    -- ── Deaths ───────────────────────────────────────────────
    if subevent == "UNIT_DIED" then
        if IsPlayer(destFlags) and tracking.partyGUIDs[destGUID] then
            local stats = EnsurePlayer(destGUID)
            if stats then stats.deaths = stats.deaths + 1 end
        end
        return
    end

    -- ── Interrupts ───────────────────────────────────────────
    if subevent == "SPELL_INTERRUPT" then
        if IsPlayer(sourceFlags) and tracking.partyGUIDs[sourceGUID] then
            local stats = EnsurePlayer(sourceGUID)
            if stats then stats.interrupts = stats.interrupts + 1 end
        end
        return
    end

    -- ── Dispels ──────────────────────────────────────────────
    if subevent == "SPELL_DISPEL" then
        if IsPlayer(sourceFlags) and tracking.partyGUIDs[sourceGUID] then
            local stats = EnsurePlayer(sourceGUID)
            if stats then stats.dispels = stats.dispels + 1 end
        end
        return
    end

    -- ── Damage dealt ─────────────────────────────────────────
    if subevent == "SWING_DAMAGE" or subevent == "RANGE_DAMAGE"
       or subevent == "SPELL_DAMAGE" or subevent == "SPELL_PERIODIC_DAMAGE" then
        -- Source is a party player doing damage
        if IsPlayer(sourceFlags) and tracking.partyGUIDs[sourceGUID] then
            local amount
            if subevent == "SWING_DAMAGE" then
                amount = p12 or 0  -- amount is param 12 for SWING
            else
                amount = p15 or 0  -- amount is param 15 for SPELL/RANGE
            end
            local stats = EnsurePlayer(sourceGUID)
            if stats then stats.damage = stats.damage + amount end
        end
        -- Dest is a party player taking damage
        if IsPlayer(destFlags) and tracking.partyGUIDs[destGUID] then
            local amount
            if subevent == "SWING_DAMAGE" then
                amount = p12 or 0
            else
                amount = p15 or 0
            end
            local stats = EnsurePlayer(destGUID)
            if stats then stats.damageTaken = stats.damageTaken + amount end
        end
        return
    end

    -- ── Healing done ─────────────────────────────────────────
    if subevent == "SPELL_HEAL" or subevent == "SPELL_PERIODIC_HEAL" then
        if IsPlayer(sourceFlags) and tracking.partyGUIDs[sourceGUID] then
            local amount = p15 or 0      -- healing amount
            local overhealing = p16 or 0 -- overhealing
            local effective = amount - overhealing
            if effective > 0 then
                local stats = EnsurePlayer(sourceGUID)
                if stats then stats.healing = stats.healing + effective end
            end
        end
        return
    end
end

-- ─── Spec detection via inspect ──────────────────────────────────────────
local inspectQueue = {}
local inspectIndex = 0

local function ProcessNextInspect()
    inspectIndex = inspectIndex + 1
    if inspectIndex > #inspectQueue then return end

    local unit = inspectQueue[inspectIndex]
    if unit and UnitExists(unit) and UnitIsConnected(unit) then
        NotifyInspect(unit)
    else
        -- Skip this unit, try next
        C_Timer.After(0.2, ProcessNextInspect)
    end
end

local function OnInspectReady(guid)
    if not tracking then return end

    -- Find which unit this GUID belongs to
    for _, unit in ipairs(inspectQueue) do
        if UnitExists(unit) and UnitGUID(unit) == guid then
            local specID = GetInspectSpecialization(unit)
            if specID and specID > 0 then
                local _, specName, _, _, specRole = GetSpecializationInfoByID(specID)
                if specName then
                    tracking.specs[guid] = {
                        specId = specID,
                        specName = specName,
                        role = specRole,
                    }
                    ns.Utils.Debug(string.format("Inspect: %s → %s (%s)", UnitName(unit) or "?", specName, specRole or "?"))
                end
            end
            ClearInspectPlayer()
            break
        end
    end

    -- Process next in queue (throttled ~1 per second)
    C_Timer.After(1.2, ProcessNextInspect)
end

-- ─── Public API ──────────────────────────────────────────────────────────

function ns.CombatLog.Start()
    -- Snapshot party GUIDs
    local partyGUIDs = {}
    local playerGUID = UnitGUID("player")
    if playerGUID then partyGUIDs[playerGUID] = true end

    for i = 1, 4 do
        local unit = "party" .. i
        if UnitExists(unit) then
            local guid = UnitGUID(unit)
            if guid then partyGUIDs[guid] = true end
        end
    end

    tracking = {
        partyGUIDs = partyGUIDs,
        stats = {},
        specs = {},
    }

    -- Initialize stats for all known party members
    for guid in pairs(partyGUIDs) do
        EnsurePlayer(guid)
    end

    ns.CombatLog._stopped = false

    -- Register events with a combined handler
    clFrame:RegisterEvent("COMBAT_LOG_EVENT_UNFILTERED")
    clFrame:RegisterEvent("INSPECT_READY")
    clFrame:SetScript("OnEvent", function(self, event, arg1)
        if event == "COMBAT_LOG_EVENT_UNFILTERED" then
            OnCombatLogEvent()
        elseif event == "INSPECT_READY" and arg1 then
            OnInspectReady(arg1)
        end
    end)

    -- Start inspecting party members for spec detection
    inspectQueue = {}
    inspectIndex = 0
    for i = 1, 4 do
        local unit = "party" .. i
        if UnitExists(unit) then
            table.insert(inspectQueue, unit)
        end
    end

    if #inspectQueue > 0 then
        -- Small delay to let the instance fully load
        C_Timer.After(2.0, ProcessNextInspect)
    end

    ns.Utils.Debug("Combat log tracking started for " .. tostring(#inspectQueue + 1) .. " players")
end

function ns.CombatLog.Stop()
    -- Do NOT call UnregisterEvent here — it's a protected function
    -- and CHALLENGE_MODE_COMPLETED fires during combat. The handler
    -- already checks `if not tracking then return end`, so setting
    -- tracking to nil in Clear() will stop processing.
    -- The events will be unregistered safely when we leave combat.
    ns.CombatLog._stopped = true
end

function ns.CombatLog.GetPlayerStats()
    if not tracking then return {} end

    -- Convert GUID-keyed stats to name-keyed for the payload
    local result = {}
    for guid, stats in pairs(tracking.stats) do
        local name, realm
        if guid == UnitGUID("player") then
            name = UnitName("player")
            realm = GetRealmName()
        else
            for i = 1, 4 do
                local unit = "party" .. i
                if UnitExists(unit) and UnitGUID(unit) == guid then
                    local uName, uRealm = UnitName(unit)
                    name = uName
                    realm = (uRealm and uRealm ~= "") and uRealm or GetRealmName()
                    break
                end
            end
        end

        if name then
            local key = name .. "-" .. ns.Utils.RealmSlug(realm or "")
            result[key] = {
                damage = stats.damage,
                healing = stats.healing,
                damageTaken = stats.damageTaken,
                deaths = stats.deaths,
                interrupts = stats.interrupts,
                dispels = stats.dispels,
            }
        end
    end
    return result
end

function ns.CombatLog.GetPartySpecs()
    if not tracking then return {} end

    local result = {}
    for guid, specInfo in pairs(tracking.specs) do
        -- Find the unit name for this GUID
        for i = 1, 4 do
            local unit = "party" .. i
            if UnitExists(unit) and UnitGUID(unit) == guid then
                local name = UnitName(unit)
                if name then
                    result[name] = specInfo.specName
                end
                break
            end
        end
    end
    return result
end

function ns.CombatLog.Clear()
    tracking = nil
    inspectQueue = {}
    inspectIndex = 0
    ns.CombatLog._stopped = false

    -- Safely unregister events now that we're (hopefully) out of combat.
    -- If still in combat, use PLAYER_REGEN_ENABLED to defer.
    if not InCombatLockdown() then
        pcall(function()
            clFrame:UnregisterEvent("COMBAT_LOG_EVENT_UNFILTERED")
            clFrame:UnregisterEvent("INSPECT_READY")
        end)
    else
        -- Defer until combat ends
        local regenFrame = CreateFrame("Frame")
        regenFrame:RegisterEvent("PLAYER_REGEN_ENABLED")
        regenFrame:SetScript("OnEvent", function(self)
            self:UnregisterEvent("PLAYER_REGEN_ENABLED")
            pcall(function()
                clFrame:UnregisterEvent("COMBAT_LOG_EVENT_UNFILTERED")
                clFrame:UnregisterEvent("INSPECT_READY")
            end)
        end)
    end
end

-- Note: INSPECT_READY is handled inside the combined OnEvent handler
-- set in ns.CombatLog.Start(). No HookScript needed.
