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

--[[
    Build the full 5-member list by merging three sources:

    1. API completion data  — info.members from GetChallengeCompletionInfo()
       (may include the player, may have Secret Value entries that won't
       serialize). Enriched with live unit data when available.
    2. Live party units     — party1..4 at completion time. May be missing
       if someone DC'd or left right at the end.
    3. Key-start snapshot   — recorded by PartyInfo.Start() when the key
       began. Every member that was present at the start is guaranteed to
       be a real, serializable value.

    Members are keyed by name for dedup. Source 1 wins over 2, which wins
    over 3. The player is always built from live "player" unit queries.
]]--
local function BuildMembers(info)
    local self = BuildSelfMember()
    local playerName = UnitName("player") or self.name
    local fallbackRealm = GetRealmName() or ""

    -- Accumulator keyed by lowercase name to deduplicate across sources.
    -- Value = member table. Player entry is pre-seeded.
    local byName = {}
    byName[(playerName or ""):lower()] = self

    -- ── Source 3 (lowest priority): key-start snapshot ──────────────
    local snapshot = {}
    if ns.CombatLog and ns.CombatLog.GetPartySnapshot then
        snapshot = ns.CombatLog.GetPartySnapshot()
    end
    for _, m in ipairs(snapshot) do
        local key = (m.name or ""):lower()
        if key ~= "" and not byName[key] then
            byName[key] = {
                name  = m.name,
                realm = m.realm,
                class = m.class,
                spec  = m.spec or "Unknown",
                role  = m.role or "dps",
            }
            ns.Utils.Debug("BuildMembers: added from snapshot — " .. (m.name or "?"))
        end
    end

    -- ── Source 2 (medium priority): live party units ────────────────
    for i = 1, 4 do
        local unit = "party" .. i
        if UnitExists(unit) then
            local uName, uRealm = UnitName(unit)
            if uName then
                local key = uName:lower()
                if not uRealm or uRealm == "" then uRealm = fallbackRealm end
                local _, classFile = UnitClass(unit)
                local entry = {
                    name  = uName,
                    realm = ns.Utils.RealmSlug(uRealm),
                    class = ClassSlug(classFile or ""),
                    spec  = "Unknown",
                    role  = NormalizeRole(UnitGroupRolesAssigned(unit)),
                }
                -- Overwrite snapshot entry (better data), skip player
                if key ~= (playerName or ""):lower() then
                    byName[key] = entry
                    ns.Utils.Debug("BuildMembers: added/updated from live unit — " .. uName)
                end
            end
        end
    end

    -- ── Source 1 (highest priority): API completion members ─────────
    if info and type(info.members) == "table" then
        ns.Utils.Debug(string.format("BuildMembers: API info.members has %d entries", #info.members))
        for idx, apiMember in ipairs(info.members) do
            local name = apiMember.name
            -- Guard against Secret Values: name must be a real string
            if type(name) ~= "string" or name == "" then
                ns.Utils.Debug(string.format(
                    "BuildMembers: skipping API member[%d] — name is %s (type=%s)",
                    idx, tostring(name), type(name)))
            else
                local key = name:lower()
                -- Skip the player (already have self-member with accurate spec)
                if key ~= (playerName or ""):lower() then
                    local resolved = ResolveOtherMember(apiMember, fallbackRealm)
                    -- Preserve spec/role from lower-priority source if the API
                    -- version has no data (Unknown/dps defaults)
                    local existing = byName[key]
                    if existing then
                        if resolved.spec == "Unknown" and existing.spec ~= "Unknown" then
                            resolved.spec = existing.spec
                        end
                        if resolved.role == "dps" and existing.role ~= "dps" then
                            resolved.role = existing.role
                        end
                    end
                    byName[key] = resolved
                    ns.Utils.Debug("BuildMembers: added/updated from API — " .. name)
                end
            end
        end
    else
        ns.Utils.Debug("BuildMembers: no API info.members available")
    end

    -- ── Assemble final list: player first, then others ──────────────
    local members = { self }
    for key, m in pairs(byName) do
        if key ~= (playerName or ""):lower() then
            table.insert(members, m)
        end
    end

    ns.Utils.Debug(string.format("BuildMembers: final count = %d", #members))
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

    local members = BuildMembers(info)

    -- All enhancement data below is best-effort. If any of it fails
    -- due to Secret Values or API restrictions, the basic run data
    -- is still captured and submitted.

    -- Apply inspected specs to other members (from CombatLog module)
    pcall(function()
        if ns.CombatLog and ns.CombatLog.GetPartySpecs then
            local partySpecs = ns.CombatLog.GetPartySpecs()
            for _, m in ipairs(members) do
                if m.spec == "Unknown" and partySpecs[m.name] then
                    m.spec = partySpecs[m.name]
                end
            end
        end
    end)

    -- Dynamic dungeon metadata from WoW API
    local dungeonName, _, dungeonTimeLimitSec
    pcall(function()
        dungeonName, _, dungeonTimeLimitSec = C_ChallengeMode.GetMapUIInfo(mapID)
    end)

    -- Rating data (local player only) — may be secret values
    local oldRating, newRating, ratingGained
    pcall(function()
        oldRating = info.oldOverallDungeonScore
        newRating = info.newOverallDungeonScore
        ratingGained = 0
        if oldRating and newRating then
            ratingGained = newRating - oldRating
        end
    end)

    -- Season ID (dynamic)
    local wowSeasonId
    pcall(function()
        wowSeasonId = C_MythicPlus and C_MythicPlus.GetCurrentSeason and C_MythicPlus.GetCurrentSeason() or nil
    end)

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
        members = members,
        source = "addon",
        -- Dynamic dungeon metadata
        dungeonName = dungeonName or nil,
        dungeonTimeLimitSec = dungeonTimeLimitSec or nil,
        -- Rating (local player only)
        oldRating = oldRating,
        newRating = newRating,
        ratingGained = ratingGained,
        isMapRecord = info.isMapRecord or false,
        isAffixRecord = info.isAffixRecord or false,
        isEligibleForScore = info.isEligibleForScore or false,
        -- Season (dynamic)
        wowSeasonId = wowSeasonId,
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
