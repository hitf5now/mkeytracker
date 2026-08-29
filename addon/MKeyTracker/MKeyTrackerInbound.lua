--[[
    MKeyTrackerInbound.lua — the companion-to-addon channel.

    The addon has no network access, so everything the platform knows about
    a player (Juice, personal bests, who they have grouped with) arrives the
    only way it can: the companion writes it into MKeyTrackerDB.inbound, and
    WoW hands it to us when SavedVariables load.

    Timing matters and is worth stating plainly. WoW reads SavedVariables at
    load and writes them at logout or /reload — and a /reload *writes before
    it reads*. Anything the companion writes while the game is running is
    therefore overwritten, not picked up. The companion only writes with WoW
    closed, so inbound data is as of the last time the game started.

    Everything here is read-only and defensive: a payload can be absent
    (never synced), stale (companion not running), or from a newer companion
    than this addon understands. None of those may error.
]]--

local addonName, ns = ...
ns.Inbound = {}

--- Payload versions this addon knows how to read.
local SUPPORTED_VERSION = 1

--- Past this, the data is old enough that showing it unqualified would
--- mislead — callers get `stale = true` and can say so.
local STALE_AFTER_SEC = 7 * 24 * 60 * 60

local function raw()
    return MKeyTrackerDB and MKeyTrackerDB.inbound or nil
end

--- True when a usable, understood payload is present.
function ns.Inbound.IsAvailable()
    local data = raw()
    return type(data) == "table" and data.version == SUPPORTED_VERSION
end

--- Age of the payload in seconds, or nil when unavailable.
function ns.Inbound.AgeSeconds()
    if not ns.Inbound.IsAvailable() then return nil end
    local generated = raw().generatedAt
    if type(generated) ~= "number" or generated <= 0 then return nil end
    return math.max(0, GetServerTime() - generated)
end

function ns.Inbound.IsStale()
    local age = ns.Inbound.AgeSeconds()
    return age ~= nil and age > STALE_AFTER_SEC
end

--- The player's own season standing, or nil.
function ns.Inbound.GetPlayer()
    if not ns.Inbound.IsAvailable() then return nil end
    local player = raw().player
    return type(player) == "table" and player or nil
end

function ns.Inbound.GetSeason()
    if not ns.Inbound.IsAvailable() then return nil end
    local season = raw().season
    return type(season) == "table" and season or nil
end

--- Personal best for one dungeon, keyed by challenge_mode_id.
--- Lua tables from the companion use string keys, so accept either form.
function ns.Inbound.GetRecord(challengeModeId)
    if not ns.Inbound.IsAvailable() or not challengeModeId then return nil end
    local records = raw().records
    if type(records) ~= "table" then return nil end
    local entry = records[tostring(challengeModeId)] or records[challengeModeId]
    return type(entry) == "table" and entry or nil
end

--- Collapse a name or realm to its lookup form.
---
--- Must match `normalizeKeyPart` in services/companion-inbound.ts exactly,
--- or every lookup silently misses and the addon reports that nobody is on
--- the platform. Every separator is removed rather than converted to a
--- dash: the platform's stored realms are not consistently slugged, and
--- `UnitName()` hands back the display form ("Area 52"), so collapsing to
--- `area52` is the one representation both sides can reach.
local function NormalizeKeyPart(value)
    if type(value) ~= "string" then return "" end
    value = value:lower()
    value = value:gsub("'", "")
    -- U+2019 (right single quote) built from its UTF-8 bytes, so this file
    -- stays plain ASCII and survives any encoding round-trip.
    value = value:gsub(string.char(226, 128, 153), "")
    value = value:gsub("[%s_%-]+", "")
    return value
end


--- What we know about a character, by name and realm.
function ns.Inbound.GetCharacter(name, realm)
    if not ns.Inbound.IsAvailable() or not name then return nil end
    local roster = raw().roster
    if type(roster) ~= "table" then return nil end

    -- A same-realm party member comes back from the WoW API with no realm
    -- suffix at all, so fall back to the player's own realm.
    local resolvedRealm = realm
    if not resolvedRealm or resolvedRealm == "" then
        resolvedRealm = GetNormalizedRealmName and GetNormalizedRealmName()
            or (GetRealmName and GetRealmName())
            or nil
    end
    if not resolvedRealm then return nil end

    local key = NormalizeKeyPart(name) .. "-" .. NormalizeKeyPart(resolvedRealm)
    local entry = roster[key]
    return type(entry) == "table" and entry or nil
end

--- Roster entry count — used by /mkt inbound to show the channel is live.
function ns.Inbound.CountRoster()
    if not ns.Inbound.IsAvailable() then return 0 end
    local roster = raw().roster
    if type(roster) ~= "table" then return 0 end
    local n = 0
    for _ in pairs(roster) do n = n + 1 end
    return n
end

function ns.Inbound.CountRecords()
    if not ns.Inbound.IsAvailable() then return 0 end
    local records = raw().records
    if type(records) ~= "table" then return 0 end
    local n = 0
    for _ in pairs(records) do n = n + 1 end
    return n
end

-- ─── Post-run scorecard ───────────────────────────────────────────────────

local function FormatTime(ms)
    if not ms or ms <= 0 then return "--:--" end
    local total = math.floor(ms / 1000)
    return string.format("%d:%02d", math.floor(total / 60), total % 60)
end

--[[
    Lines comparing a just-finished run to what the platform knows.

    This is the moment the whole loop exists for — the seconds after a key
    ends — and it used to spend itself on a bare "Sync & Reload". Everything
    here is derived from the cached inbound payload, so it renders instantly
    with no network round trip.

    Returns an empty list when there is nothing honest to say: no companion
    data, or a dungeon with no history yet. Better a short toast than a
    padded one.
]]--
function ns.Inbound.BuildScorecard(challengeModeId, level, onTime, completionMs, deaths)
    local lines = {}
    local record = ns.Inbound.GetRecord(challengeModeId)
    local player = ns.Inbound.GetPlayer()

    if record and onTime and completionMs and completionMs > 0 then
        local best = record.bestTimeMs
        if not best or best <= 0 then
            table.insert(lines, "|cff33ff99First timed clear here|r")
        elseif completionMs < best then
            table.insert(lines, string.format(
                "|cffffd100New best time|r — %s, beating %s by %s",
                FormatTime(completionMs), FormatTime(best), FormatTime(best - completionMs)
            ))
        else
            table.insert(lines, string.format(
                "%s — %s off your best of %s",
                FormatTime(completionMs), FormatTime(completionMs - best), FormatTime(best)
            ))
        end
    end

    if record and level and onTime then
        local bestLevel = record.bestLevel or 0
        if level > bestLevel then
            table.insert(lines, string.format("|cffffd100Highest key timed here|r (was +%d)", bestLevel))
        end
    end

    -- Deaths only earn a line when they say something. Matching your average
    -- exactly is not worth the reader's attention.
    if player and deaths and player.avgDeaths and player.avgDeaths > 0 then
        local avg = player.avgDeaths
        if deaths == 0 then
            table.insert(lines, "|cff33ff99No deaths|r")
        elseif deaths < avg - 0.5 then
            table.insert(lines, string.format("%d deaths — under your %.1f average", deaths, avg))
        elseif deaths > avg + 0.5 then
            table.insert(lines, string.format("|cffff8800%d deaths|r — over your %.1f average", deaths, avg))
        end
    end

    return lines
end
