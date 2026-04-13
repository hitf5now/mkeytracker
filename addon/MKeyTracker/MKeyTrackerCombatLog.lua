--[[
    MKeyTrackerCombatLog.lua — party info: spec detection via inspect

    Inspects party members at key start to detect their specs.
    Also snapshots the full party roster so BuildMembers() has a
    reliable fallback if the completion API is missing entries.
]]--

local addonName, ns = ...
ns.CombatLog = {}

-- Cached party specs from inspect (best-effort, done at key start)
local partySpecs = {}

-- Party snapshot taken at CHALLENGE_MODE_START — every member that was
-- present when the key began. Used as a tertiary source in BuildMembers().
local partySnapshot = {}

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

-- ─── Class file name → slug (duplicated from Capture for snapshot use) ──
local CLASS_SLUG_OVERRIDES = {
    DEATHKNIGHT = "death-knight",
    DEMONHUNTER = "demon-hunter",
}

local function ClassSlug(classFileName)
    if not classFileName then return "" end
    return CLASS_SLUG_OVERRIDES[classFileName] or classFileName:lower()
end

local function NormalizeRole(roleToken)
    if not roleToken or roleToken == "" or roleToken == "NONE" then return "dps" end
    local r = roleToken:upper()
    if r == "TANK" then return "tank" end
    if r == "HEALER" then return "healer" end
    return "dps"
end

-- ─── Public API ──────────────────────────────────────────────────────

function ns.CombatLog.Start()
    partySpecs = {}
    partySnapshot = {}
    inspectQueue = {}
    inspectIndex = 0

    local fallbackRealm = GetRealmName() or ""

    -- Snapshot the player first
    local pName = UnitName("player")
    local _, pClassFile = UnitClass("player")
    local pSpecName = "Unknown"
    local pRoleToken = "dps"
    local specIndex = GetSpecialization()
    if specIndex then
        local _, sName, _, _, sRole = GetSpecializationInfo(specIndex)
        pSpecName = sName or "Unknown"
        pRoleToken = sRole
    end
    table.insert(partySnapshot, {
        name = pName or "Unknown",
        realm = ns.Utils.RealmSlug(fallbackRealm),
        class = ClassSlug(pClassFile or ""),
        spec = pSpecName,
        role = NormalizeRole(pRoleToken),
    })
    ns.Utils.Debug(string.format("Snapshot[player]: %s-%s %s %s",
        pName or "?", fallbackRealm, ClassSlug(pClassFile or ""), NormalizeRole(pRoleToken)))

    -- Snapshot party1..4 and queue for spec inspection
    for i = 1, 4 do
        local unit = "party" .. i
        if UnitExists(unit) then
            local uName, uRealm = UnitName(unit)
            if uName then
                local _, classFile = UnitClass(unit)
                if not uRealm or uRealm == "" then uRealm = fallbackRealm end
                table.insert(partySnapshot, {
                    name = uName,
                    realm = ns.Utils.RealmSlug(uRealm),
                    class = ClassSlug(classFile or ""),
                    spec = "Unknown",
                    role = NormalizeRole(UnitGroupRolesAssigned(unit)),
                })
                ns.Utils.Debug(string.format("Snapshot[%s]: %s-%s %s %s",
                    unit, uName, uRealm, ClassSlug(classFile or ""),
                    NormalizeRole(UnitGroupRolesAssigned(unit))))
            end
            table.insert(inspectQueue, unit)
        end
    end

    if #inspectQueue > 0 and not InCombatLockdown() then
        C_Timer.After(1.0, ProcessNextInspect)
    end

    ns.Utils.Debug(string.format("Party snapshot: %d member(s), %d queued for inspect",
        #partySnapshot, #inspectQueue))
end

function ns.CombatLog.Clear()
    partySpecs = {}
    inspectQueue = {}
    inspectIndex = 0
    -- NOTE: partySnapshot is intentionally NOT cleared here.
    -- It persists until the next key start so BuildMembers can use it.
end

function ns.CombatLog.GetPartySpecs()
    return partySpecs
end

function ns.CombatLog.GetPartySnapshot()
    return partySnapshot
end
