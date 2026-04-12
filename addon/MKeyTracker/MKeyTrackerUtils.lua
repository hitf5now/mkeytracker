--[[
    MKeyTrackerUtils.lua — shared helpers
    Loaded first so subsequent files can use ns.Utils.
]]--

local addonName, ns = ...
ns.Utils = {}

-- ─── Chat output ──────────────────────────────────────────────────────────
-- Green addon prefix, consistent formatting across all addon messages.
local PREFIX = "|cff33ff99MKey Tracker|r: "

function ns.Utils.Print(msg)
    DEFAULT_CHAT_FRAME:AddMessage(PREFIX .. tostring(msg))
end

function ns.Utils.PrintError(msg)
    DEFAULT_CHAT_FRAME:AddMessage("|cffff3333MKey Tracker|r: " .. tostring(msg))
end

function ns.Utils.Debug(msg)
    if MKeyTrackerDB and MKeyTrackerDB.settings and MKeyTrackerDB.settings.debugMode then
        DEFAULT_CHAT_FRAME:AddMessage("|cff888888MKey Tracker debug|r: " .. tostring(msg))
    end
end

-- ─── Realm slug normalization ─────────────────────────────────────────────
-- Matches the canonical form used by the M+ API (apps/api/src/lib/realm.ts).
-- Must stay in sync with that regex.
function ns.Utils.RealmSlug(realmName)
    if not realmName or realmName == "" then return "" end
    local slug = realmName:lower()
    slug = slug:gsub("'", "")
    slug = slug:gsub("[%s_]+", "-")
    slug = slug:gsub("[^%w%-]", "")
    slug = slug:gsub("%-+", "-")
    slug = slug:gsub("^%-", ""):gsub("%-$", "")
    return slug
end

-- ─── Region code ──────────────────────────────────────────────────────────
-- GetCurrentRegion() returns 1..5 for live regions; map to our lowercase codes.
local REGION_MAP = {
    [1] = "us",
    [2] = "kr",
    [3] = "eu",
    [4] = "tw",
    [5] = "cn",
}

function ns.Utils.RegionCode()
    local r = GetCurrentRegion and GetCurrentRegion() or 1
    return REGION_MAP[r] or "us"
end

-- ─── Table helpers ────────────────────────────────────────────────────────

function ns.Utils.TableLength(t)
    if type(t) ~= "table" then return 0 end
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end

-- Deep copy with primitive-only safety (SavedVariables cannot store functions,
-- metatables, or references — this flattens tables to plain data).
function ns.Utils.DeepCopy(tbl)
    if type(tbl) ~= "table" then return tbl end
    local copy = {}
    for k, v in pairs(tbl) do
        if type(v) == "table" then
            copy[k] = ns.Utils.DeepCopy(v)
        elseif type(v) == "string" or type(v) == "number" or type(v) == "boolean" then
            copy[k] = v
        end
        -- functions, userdata, etc. silently dropped
    end
    return copy
end
