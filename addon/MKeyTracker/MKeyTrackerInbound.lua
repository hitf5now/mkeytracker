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

--- What we know about a character, by name and realm.
--- Realm is normalised the way the platform stores it: lowercase, no spaces.
function ns.Inbound.GetCharacter(name, realm)
    if not ns.Inbound.IsAvailable() or not name then return nil end
    local roster = raw().roster
    if type(roster) ~= "table" then return nil end

    -- A same-realm party member comes back from the WoW API with no realm
    -- suffix at all, so fall back to the player's own realm.
    local resolvedRealm = realm
    if not resolvedRealm or resolvedRealm == "" then
        resolvedRealm = GetNormalizedRealmName and GetNormalizedRealmName() or nil
    end
    if not resolvedRealm then return nil end

    local key = string.lower(name .. "-" .. resolvedRealm:gsub("%s+", ""):gsub("'", ""))
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
