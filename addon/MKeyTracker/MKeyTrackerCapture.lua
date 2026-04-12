--[[
    MKeyTrackerCapture.lua — run capture logic
    Fires on CHALLENGE_MODE_COMPLETED, builds a RunSubmission payload matching
    the shape in packages/types/src/runs.ts, appends to pendingRuns[].
]]--

local addonName, ns = ...
ns.Capture = {}

-- ─── Client-side dedup ────────────────────────────────────────────────────
-- Builds a deterministic hash of the run identity. If the user /reloads right
-- after completing, CHALLENGE_MODE_COMPLETED won't fire again — but in the
-- unlikely case of a double-fire we should not double-queue.
local function ComputeRunHash(payload)
    local memberKeys = {}
    for _, m in ipairs(payload.members) do
        table.insert(memberKeys, (m.realm or "") .. "/" .. (m.name or ""))
    end
    table.sort(memberKeys)
    return string.format(
        "%d|%d|%d|%s",
        payload.challengeModeId or 0,
        payload.keystoneLevel or 0,
        payload.serverTime or 0,
        table.concat(memberKeys, ",")
    )
end

-- ─── Role token normalization ─────────────────────────────────────────────
-- WoW's role strings are TANK / HEALER / DAMAGER. Our API uses tank/healer/dps.
local function NormalizeRole(roleToken)
    if not roleToken or roleToken == "" or roleToken == "NONE" then return "dps" end
    local r = roleToken:upper()
    if r == "TANK" then return "tank" end
    if r == "HEALER" then return "healer" end
    return "dps"
end

-- ─── Class file name → slug ───────────────────────────────────────────────
-- WoW returns class tokens like "DEATHKNIGHT", "DEMONHUNTER". Convert to
-- "death-knight", "demon-hunter" to match our API + wow-constants package.
local CLASS_SLUG_OVERRIDES = {
    DEATHKNIGHT = "death-knight",
    DEMONHUNTER = "demon-hunter",
}

local function ClassSlug(classFileName)
    if not classFileName then return "" end
    return CLASS_SLUG_OVERRIDES[classFileName] or classFileName:lower()
end

-- ─── Self-member builder ──────────────────────────────────────────────────
-- Always builds the player's own member entry from live unit queries.
-- The player is reliable post-completion — "player" unit is always valid.
local function BuildSelfMember()
    local name = UnitName("player")
    local realm = GetRealmName()
    local _, classFile = UnitClass("player")

    local specName = "Unknown"
    local roleToken = "dps"
    local specIndex = GetSpecialization()
    if specIndex then
        local _, sName, _, _, sRole = GetSpecializationInfo(specIndex)
        specName = sName or "Unknown"
        roleToken = sRole
    end

    return {
        name = name or "Unknown",
        realm = ns.Utils.RealmSlug(realm or ""),
        class = ClassSlug(classFile or ""),
        spec = specName,
        role = NormalizeRole(roleToken),
    }
end

-- Look up an `info.members` entry and enrich it with class/realm via
-- whichever source is available — live party unit preferred, GUID lookup
-- as a fallback. Role comes from live party state if possible; otherwise
-- we default to "dps" since role is unknowable from GUID alone.
local function ResolveOtherMember(apiMember, fallbackRealm)
    local name = apiMember.name
    local guid = apiMember.memberGUID

    -- Try to find this member as a live party1..4 unit.
    local unit
    for i = 1, 4 do
        local u = "party" .. i
        if UnitExists(u) then
            local uName = UnitName(u)
            if uName == name then
                unit = u
                break
            end
        end
    end

    local class, realm, role = "", "", "dps"
    local spec = "Unknown"

    if unit then
        local _, classFile = UnitClass(unit)
        class = ClassSlug(classFile or "")
        local _, uRealm = UnitName(unit)
        realm = ns.Utils.RealmSlug((uRealm and uRealm ~= "") and uRealm or fallbackRealm)
        role = NormalizeRole(UnitGroupRolesAssigned(unit))
    elseif guid and GetPlayerInfoByGUID then
        -- Fallback: no live unit, but we have the GUID. Returns:
        --   locClass, class, locRace, race, sex, name, realm
        local _, classFile, _, _, _, _, gRealm = GetPlayerInfoByGUID(guid)
        if classFile and classFile ~= "" then class = ClassSlug(classFile) end
        if gRealm and gRealm ~= "" then
            realm = ns.Utils.RealmSlug(gRealm)
        else
            realm = ns.Utils.RealmSlug(fallbackRealm)
        end
    else
        realm = ns.Utils.RealmSlug(fallbackRealm)
    end

    return {
        name = name or "Unknown",
        realm = realm,
        class = class,
        spec = spec,
        role = role,
    }
end

-- Build the full 5-member list.
-- Primary source is `info.members` (the 4 OTHER members from the API).
-- Player is always prepended from live unit queries.
-- If `info.members` is missing or empty, we fall back to enumerating
-- party1..4 units directly — the pre-refactor behavior, useful for the
-- natural event flow where party state is definitely live.
local function BuildMembers(info)
    local members = { BuildSelfMember() }
    local fallbackRealm = GetRealmName() or ""

    if info and type(info.members) == "table" and #info.members > 0 then
        for _, apiMember in ipairs(info.members) do
            table.insert(members, ResolveOtherMember(apiMember, fallbackRealm))
        end
        return members
    end

    -- No API members provided — enumerate live party units.
    for i = 1, 4 do
        local unit = "party" .. i
        if UnitExists(unit) then
            local uName, uRealm = UnitName(unit)
            if uName then
                local _, classFile = UnitClass(unit)
                if not uRealm or uRealm == "" then uRealm = fallbackRealm end
                table.insert(members, {
                    name = uName,
                    realm = ns.Utils.RealmSlug(uRealm),
                    class = ClassSlug(classFile or ""),
                    spec = "Unknown",
                    role = NormalizeRole(UnitGroupRolesAssigned(unit)),
                })
            end
        end
    end
    return members
end

-- ─── Affix list ───────────────────────────────────────────────────────────
local function GetActiveAffixIds()
    local ids = {}
    if C_MythicPlus and C_MythicPlus.GetCurrentAffixes then
        local affixes = C_MythicPlus.GetCurrentAffixes()
        if type(affixes) == "table" then
            for _, a in ipairs(affixes) do
                if type(a) == "table" and a.id then
                    table.insert(ids, a.id)
                elseif type(a) == "number" then
                    table.insert(ids, a)
                end
            end
        end
    end
    return ids
end

-- ─── Event handlers ───────────────────────────────────────────────────────
function ns.Capture.OnStart()
    ns.Utils.Debug("CHALLENGE_MODE_START fired")
    -- Future sprint: snapshot active event state into MKeyTrackerDB for the
    -- competition overlay.
end

--[[
    Capture a completed challenge mode.

    `overrideInfo` is an optional parameter that lets us bootstrap a capture
    from a previously-stashed snapshot (e.g. `MKeyTrackerDB.debugCapture[1]`).
    When it's nil, we call the live API like the natural event flow does.

    API shape (WoW Midnight 12.0.1):
      C_ChallengeMode.GetChallengeCompletionInfo() → table {
          mapChallengeModeID, level, time, onTime, keystoneUpgradeLevels,
          practiceRun, isEligibleForScore, oldOverallDungeonScore,
          newOverallDungeonScore, isMapRecord, isAffixRecord,
          members = { { memberGUID, name }, ... }   -- 4 OTHER members, not player
      }
]]--
function ns.Capture.OnCompleted(overrideInfo)
    ns.Utils.Debug("CHALLENGE_MODE_COMPLETED fired")

    local info = overrideInfo or (C_ChallengeMode.GetChallengeCompletionInfo and C_ChallengeMode.GetChallengeCompletionInfo())
    if not info or type(info) ~= "table" then
        ns.Utils.PrintError("GetChallengeCompletionInfo returned nil. Nothing captured.")
        return
    end

    local mapID = info.mapChallengeModeID
    local level = info.level
    local timeMs = info.time
    local onTime = info.onTime
    local keystoneUpgradeLevels = info.keystoneUpgradeLevels
    local practiceRun = info.practiceRun

    if not mapID or not level then
        ns.Utils.PrintError("GetChallengeCompletionInfo returned a table but mapChallengeModeID/level were missing. Nothing captured.")
        return
    end

    if practiceRun then
        ns.Utils.Print(string.format("Ignoring practice run (+%d).", level))
        return
    end

    local deaths, timeLostSec = 0, 0
    if C_ChallengeMode.GetDeathCount then
        local d, t = C_ChallengeMode.GetDeathCount()
        deaths = d or 0
        timeLostSec = t or 0
    end

    local serverTime = GetServerTime and GetServerTime() or time()

    local payload = {
        challengeModeId = mapID,
        keystoneLevel = level,
        completionMs = timeMs or 0,
        onTime = onTime or false,
        upgrades = keystoneUpgradeLevels or 0,
        deaths = deaths,
        timeLostSec = timeLostSec,
        serverTime = serverTime,
        affixes = GetActiveAffixIds(),
        region = ns.Utils.RegionCode(),
        members = BuildMembers(info),
        source = "addon",
    }

    -- Client-side dedup
    local hash = ComputeRunHash(payload)
    if MKeyTrackerDB.lastCapturedHash == hash then
        ns.Utils.Debug("Duplicate capture ignored (hash match)")
        return
    end
    MKeyTrackerDB.lastCapturedHash = hash

    -- Sanity: 5 members expected for a real M+ run
    if #payload.members ~= 5 then
        ns.Utils.PrintError(string.format(
            "Captured only %d member(s) — expected 5. Run was still queued, but the API may reject it.",
            #payload.members
        ))
    end

    table.insert(MKeyTrackerDB.pendingRuns, payload)
    MKeyTrackerDB.lastUpdatedAt = serverTime

    -- Friendly confirmation (chat line for logs)
    local mapName = C_ChallengeMode.GetMapUIInfo(mapID) or ("map " .. mapID)
    local resultStr
    if onTime then
        local upg = keystoneUpgradeLevels or 0
        resultStr = (upg > 0) and ("Timed |cff33ff99+" .. upg .. "|r") or "Timed"
    else
        resultStr = "|cffff3333Depleted|r"
    end

    ns.Utils.Print(string.format(
        "Captured %s +%d — %s, %d death(s). |cffffff00%d|r run(s) pending.",
        mapName, level, resultStr, deaths, #MKeyTrackerDB.pendingRuns
    ))

    -- Primary UX: show the sync toast
    if ns.UI and ns.UI.ShowCaptureToast then
        ns.UI.ShowCaptureToast(mapName, level, onTime, keystoneUpgradeLevels)
    end
end
