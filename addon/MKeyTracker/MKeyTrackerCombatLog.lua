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
    -- C_DamageMeter data is wrapped in Secret Values during active M+
    -- keys. We attempt to read it but gracefully return empty if the
    -- data is still restricted. The run capture proceeds without stats.
    local ok, stats = pcall(ns.CombatLog._queryAllStats)
    if ok and stats then
        return stats
    end
    ns.Utils.Debug("C_DamageMeter data is restricted (Secret Values) — skipping combat stats")
    return {}
end

function ns.CombatLog._queryAllStats()
    if not C_DamageMeter or not C_DamageMeter.IsDamageMeterAvailable then
        return {}
    end

    local available, reason = C_DamageMeter.IsDamageMeterAvailable()
    if not available then
        return {}
    end

    -- Helper: query a metric and return { [name] = amount }
    -- Uses name (not GUID) since GUID may be a secret value
    local function queryMetric(meterType)
        local result = {}
        local session = C_DamageMeter.GetCombatSessionFromType(SESSION_OVERALL, meterType)
        if not session or not session.combatSources then
            return result
        end
        for _, source in ipairs(session.combatSources) do
            -- Try to read values — they may be secrets
            local name = source.name
            local amount = source.totalAmount
            if name and amount then
                result[name] = amount
            end
        end
        return result
    end

    -- Query all metrics we care about (keyed by player name)
    local damage = queryMetric(METER_TYPES.DamageDone)
    local healing = queryMetric(METER_TYPES.HealingDone)
    local damageTaken = queryMetric(METER_TYPES.DamageTaken)
    local interrupts = queryMetric(METER_TYPES.Interrupts)
    local dispels = queryMetric(METER_TYPES.Dispels)
    local deaths = queryMetric(METER_TYPES.Deaths)

    -- Merge all metrics by player name
    local allNames = {}
    for name in pairs(damage) do allNames[name] = true end
    for name in pairs(healing) do allNames[name] = true end
    for name in pairs(damageTaken) do allNames[name] = true end

    local stats = {}
    local fallbackRealm = ns.Utils.RealmSlug(GetRealmName() or "")

    for name in pairs(allNames) do
        -- Try to find the realm for this player
        local realm = fallbackRealm
        if name == UnitName("player") then
            realm = fallbackRealm
        else
            for i = 1, 4 do
                local u = "party" .. i
                if UnitExists(u) then
                    local uName, uRealm = UnitName(u)
                    if uName == name then
                        realm = ns.Utils.RealmSlug((uRealm and uRealm ~= "") and uRealm or fallbackRealm)
                        break
                    end
                end
            end
        end

        local key = name .. "-" .. realm
        stats[key] = {
            damage = damage[name] or 0,
            healing = healing[name] or 0,
            damageTaken = damageTaken[name] or 0,
            deaths = deaths[name] or 0,
            interrupts = interrupts[name] or 0,
            dispels = dispels[name] or 0,
        }
    end

    return stats
end

function ns.CombatLog.GetPartySpecs()
    return partySpecs
end
