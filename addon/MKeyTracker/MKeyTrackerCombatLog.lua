--[[
    MKeyTrackerCombatLog.lua — per-player combat stats via C_DamageMeter

    Uses Blizzard's built-in Damage Meter API (added in Midnight 12.0)
    instead of parsing COMBAT_LOG_EVENT_UNFILTERED (which is restricted
    during M+ keys by Secret Values).

    Called after CHALLENGE_MODE_COMPLETED to snapshot the Overall session
    data for all tracked metrics.
]]--

local addonName, ns = ...
ns.CombatLog = {}

-- DamageMeterType enum values (from DamageMeterConstantsDocumentation.lua)
local METER_TYPES = {
    DamageDone = 0,
    Dps = 1,
    HealingDone = 2,
    Hps = 3,
    Absorbs = 4,
    Interrupts = 5,
    Dispels = 6,
    DamageTaken = 7,
    AvoidableDamageTaken = 8,
    Deaths = 9,
}

-- DamageMeterSessionType
local SESSION_OVERALL = 0  -- Full run aggregate

-- Cached party specs from inspect (best-effort, done at key start)
local partySpecs = {}

-- ─── Spec detection via inspect (still works in Midnight) ────────────
local inspectQueue = {}
local inspectIndex = 0

local inspectFrame = CreateFrame("Frame", "MKeyTrackerInspectFrame")

local function ProcessNextInspect()
    inspectIndex = inspectIndex + 1
    if inspectIndex > #inspectQueue then return end

    local unit = inspectQueue[inspectIndex]
    if unit and UnitExists(unit) and UnitIsConnected(unit) and not InCombatLockdown() then
        NotifyInspect(unit)
    else
        C_Timer.After(0.5, ProcessNextInspect)
    end
end

inspectFrame:RegisterEvent("INSPECT_READY")
inspectFrame:SetScript("OnEvent", function(self, event, guid)
    if event ~= "INSPECT_READY" or not guid then return end

    for _, unit in ipairs(inspectQueue) do
        if UnitExists(unit) and UnitGUID(unit) == guid then
            local specID = GetInspectSpecialization(unit)
            if specID and specID > 0 then
                local _, specName = GetSpecializationInfoByID(specID)
                if specName then
                    local uName = UnitName(unit)
                    if uName then
                        partySpecs[uName] = specName
                        ns.Utils.Debug(string.format("Inspect: %s → %s", uName, specName))
                    end
                end
            end
            ClearInspectPlayer()
            break
        end
    end

    C_Timer.After(1.2, ProcessNextInspect)
end)

-- ─── Public API ──────────────────────────────────────────────────────

function ns.CombatLog.Start()
    partySpecs = {}
    inspectQueue = {}
    inspectIndex = 0

    -- Queue party members for spec inspection
    -- Do this before combat starts if possible
    for i = 1, 4 do
        local unit = "party" .. i
        if UnitExists(unit) then
            table.insert(inspectQueue, unit)
        end
    end

    if #inspectQueue > 0 and not InCombatLockdown() then
        C_Timer.After(1.0, ProcessNextInspect)
    end

    ns.Utils.Debug("Combat tracking started (C_DamageMeter mode)")
end

function ns.CombatLog.Stop()
    -- Nothing to unregister — we query C_DamageMeter on demand
end

function ns.CombatLog.Clear()
    partySpecs = {}
    inspectQueue = {}
    inspectIndex = 0
end

--[[
    Query C_DamageMeter for per-player stats from the Overall session.
    Returns a table keyed by "Name-realm" with damage, healing, etc.

    Must be called after CHALLENGE_MODE_COMPLETED while still in the
    instance (data doesn't survive logout/reload).
]]--
function ns.CombatLog.GetPlayerStats()
    if not C_DamageMeter or not C_DamageMeter.IsDamageMeterAvailable then
        ns.Utils.Debug("C_DamageMeter not available")
        return {}
    end

    local available, reason = C_DamageMeter.IsDamageMeterAvailable()
    if not available then
        ns.Utils.Debug("DamageMeter unavailable: " .. (reason or "unknown"))
        return {}
    end

    -- Helper: query a metric and return { [guid] = amount }
    local function queryMetric(meterType)
        local result = {}
        local ok, session = pcall(C_DamageMeter.GetCombatSessionFromType, SESSION_OVERALL, meterType)
        if not ok or not session or not session.combatSources then
            return result
        end
        for _, source in ipairs(session.combatSources) do
            if source.sourceGUID and source.totalAmount then
                result[source.sourceGUID] = {
                    amount = source.totalAmount,
                    name = source.name,
                    classFilename = source.classFilename,
                }
            end
        end
        return result
    end

    -- Query all metrics we care about
    local damage = queryMetric(METER_TYPES.DamageDone)
    local healing = queryMetric(METER_TYPES.HealingDone)
    local damageTaken = queryMetric(METER_TYPES.DamageTaken)
    local interrupts = queryMetric(METER_TYPES.Interrupts)
    local dispels = queryMetric(METER_TYPES.Dispels)
    local deaths = queryMetric(METER_TYPES.Deaths)

    -- Merge all metrics into a per-player stats table
    -- Collect all known GUIDs
    local allGUIDs = {}
    for guid in pairs(damage) do allGUIDs[guid] = true end
    for guid in pairs(healing) do allGUIDs[guid] = true end
    for guid in pairs(damageTaken) do allGUIDs[guid] = true end

    local stats = {}
    local fallbackRealm = GetRealmName() or ""

    for guid in pairs(allGUIDs) do
        -- Resolve name and realm from the damage meter data or unit tokens
        local name, realm
        local dmgEntry = damage[guid]
        if dmgEntry and dmgEntry.name then
            name = dmgEntry.name
        end

        -- Try to find the unit token for this GUID to get realm
        local unit
        if guid == UnitGUID("player") then
            unit = "player"
        else
            for i = 1, 4 do
                local u = "party" .. i
                if UnitExists(u) and UnitGUID(u) == guid then
                    unit = u
                    break
                end
            end
        end

        if unit then
            local uName, uRealm = UnitName(unit)
            name = name or uName
            realm = (uRealm and uRealm ~= "") and uRealm or fallbackRealm
        else
            realm = fallbackRealm
        end

        if name then
            local key = name .. "-" .. ns.Utils.RealmSlug(realm)
            stats[key] = {
                damage = damage[guid] and damage[guid].amount or 0,
                healing = healing[guid] and healing[guid].amount or 0,
                damageTaken = damageTaken[guid] and damageTaken[guid].amount or 0,
                deaths = deaths[guid] and deaths[guid].amount or 0,
                interrupts = interrupts[guid] and interrupts[guid].amount or 0,
                dispels = dispels[guid] and dispels[guid].amount or 0,
            }
        end
    end

    return stats
end

function ns.CombatLog.GetPartySpecs()
    return partySpecs
end
