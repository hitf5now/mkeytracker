--[[
    MKeyTrackerScout.lua — what your community knows about the people you
    are grouped with.

    Raider.IO answers "is this player good, globally". This answers a
    different and often more useful question: "how did it go when *we* ran
    together". That comes from the shared history in the inbound payload —
    runs done together and how many were timed — which no other addon can
    know because it is your platform's data, not Blizzard's.

    Two surfaces, both passive:

      - Unit tooltips. Hovering a player adds a few lines. Costs nothing
        when we have no data on them: the tooltip is simply unchanged.
      - A party section in the panel, listing the group with their numbers.

    Plus one active nudge: a single chat line when a group forms, because
    the moment you want this information is the moment someone joins, not
    whenever you happen to hover them.
]]--

local addonName, ns = ...
ns.Scout = {}

--- Roster changes fire in bursts as people load in. Wait for the dust to
--- settle before saying anything.
local ANNOUNCE_DEBOUNCE_SEC = 2.0

local announceTimer = nil
local lastAnnouncedKey = nil

local function Settings()
    MKeyTrackerDB = MKeyTrackerDB or {}
    MKeyTrackerDB.settings = MKeyTrackerDB.settings or {}
    if MKeyTrackerDB.settings.scoutTooltips == nil then
        MKeyTrackerDB.settings.scoutTooltips = true
    end
    if MKeyTrackerDB.settings.scoutAnnounce == nil then
        MKeyTrackerDB.settings.scoutAnnounce = true
    end
    return MKeyTrackerDB.settings
end

-- ─── Lookup ───────────────────────────────────────────────────────────────

--- Platform data for a unit, or nil when we know nothing about them.
function ns.Scout.GetUnitData(unit)
    if not unit or not UnitExists(unit) or not UnitIsPlayer(unit) then return nil end
    local name, realm = UnitName(unit)
    if not name then return nil end
    return ns.Inbound and ns.Inbound.GetCharacter and ns.Inbound.GetCharacter(name, realm) or nil
end

--- The current party, excluding the player. Empty when solo or in a raid —
--- a 20-man roster is not what this is for.
function ns.Scout.GetPartyUnits()
    local units = {}
    if not IsInGroup() or IsInRaid() then return units end
    for i = 1, 4 do
        local unit = "party" .. i
        if UnitExists(unit) then table.insert(units, unit) end
    end
    return units
end

-- ─── Tooltip ──────────────────────────────────────────────────────────────

local function AddTooltipLines(tooltip, unit)
    if not Settings().scoutTooltips then return end

    local data = ns.Scout.GetUnitData(unit)
    if not data then return end

    tooltip:AddLine(" ")
    tooltip:AddLine("MKey Tracker", 1, 0.82, 0)

    -- Shared history first: it is the reason this addon has anything to add.
    if (data.togetherRuns or 0) > 0 then
        local together = data.togetherRuns
        local timed = data.togetherTimed or 0
        tooltip:AddDoubleLine(
            "Run together",
            string.format("%d key%s · %d timed", together, together == 1 and "" or "s", timed),
            0.8, 0.8, 0.8, 0.4, 1, 0.4
        )
    else
        tooltip:AddLine("First time with this player", 0.6, 0.6, 0.6)
    end

    -- A partner who hasn't played this season is in the roster for their
    -- shared history alone. Reporting "+0 · 0% timed" for them would read as
    -- "this player is terrible" rather than "no runs yet".
    if (data.runs or 0) == 0 then
        tooltip:AddLine("No runs this season", 0.5, 0.5, 0.5)
    else
        tooltip:AddDoubleLine("Best key", "+" .. (data.bestKey or 0), 0.8, 0.8, 0.8, 1, 1, 1)
        tooltip:AddDoubleLine(
            "Timed",
            string.format("%d%% of %d", data.timedPct or 0, data.runs or 0),
            0.8, 0.8, 0.8, 1, 1, 1
        )
    end
end

local function HookTooltips()
    -- Dragonflight replaced the OnTooltipSetUnit script with a data
    -- processor; the old hook silently stopped firing. Prefer the modern
    -- path and keep the legacy one for older clients.
    if TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall and Enum
        and Enum.TooltipDataType and Enum.TooltipDataType.Unit then
        TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Unit, function(tooltip)
            if tooltip ~= GameTooltip then return end
            local _, unit = tooltip:GetUnit()
            if unit then AddTooltipLines(tooltip, unit) end
        end)
    elseif GameTooltip.HookScript then
        GameTooltip:HookScript("OnTooltipSetUnit", function(self)
            local _, unit = self:GetUnit()
            if unit then AddTooltipLines(self, unit) end
        end)
    end
end

-- ─── Group announcement ───────────────────────────────────────────────────

--- Identity of the current group, so the same roster isn't announced twice
--- as members finish loading.
local function GroupKey(units)
    local names = {}
    for _, unit in ipairs(units) do
        table.insert(names, (UnitName(unit)) or "?")
    end
    table.sort(names)
    return table.concat(names, "|")
end

local function AnnounceGroup()
    announceTimer = nil
    if not Settings().scoutAnnounce then return end

    local units = ns.Scout.GetPartyUnits()
    if #units == 0 then
        lastAnnouncedKey = nil
        return
    end

    local key = GroupKey(units)
    if key == lastAnnouncedKey then return end
    lastAnnouncedKey = key

    local known, lines = 0, {}
    for _, unit in ipairs(units) do
        local data = ns.Scout.GetUnitData(unit)
        local name = UnitName(unit)
        if data then
            known = known + 1
            local season = ((data.runs or 0) == 0)
                and "no runs this season"
                or string.format("best +%d, %d%% timed", data.bestKey or 0, data.timedPct or 0)
            if (data.togetherRuns or 0) > 0 then
                table.insert(lines, string.format(
                    "  %s — |cff40ff40%d key(s) together, %d timed|r · %s",
                    name, data.togetherRuns, data.togetherTimed or 0, season
                ))
            else
                table.insert(lines, string.format(
                    "  %s — first time together · %s", name, season
                ))
            end
        end
    end

    -- Nothing to say about anyone: stay quiet rather than announce a blank.
    if known == 0 then return end

    ns.Utils.Print(string.format("Group of %d — %d on the platform:", #units + 1, known))
    for _, line in ipairs(lines) do
        ns.Utils.Print(line)
    end
end

local function OnRosterUpdate()
    if announceTimer then announceTimer:Cancel() end
    announceTimer = C_Timer.NewTimer(ANNOUNCE_DEBOUNCE_SEC, AnnounceGroup)
end

-- ─── Public ───────────────────────────────────────────────────────────────

function ns.Scout.Init()
    HookTooltips()

    local frame = CreateFrame("Frame", "MKeyTrackerScoutFrame")
    frame:RegisterEvent("GROUP_ROSTER_UPDATE")
    frame:SetScript("OnEvent", OnRosterUpdate)
end

function ns.Scout.TooltipsEnabled()
    return Settings().scoutTooltips and true or false
end

function ns.Scout.SetTooltipsEnabled(enabled)
    Settings().scoutTooltips = enabled and true or false
end

function ns.Scout.AnnounceEnabled()
    return Settings().scoutAnnounce and true or false
end

function ns.Scout.SetAnnounceEnabled(enabled)
    Settings().scoutAnnounce = enabled and true or false
    -- Let the next roster change speak even if it is the same group.
    lastAnnouncedKey = nil
end

--- Print the current group's numbers on demand, for /mkt party.
function ns.Scout.PrintParty()
    local units = ns.Scout.GetPartyUnits()
    if #units == 0 then
        ns.Utils.Print("Not in a party.")
        return
    end
    lastAnnouncedKey = nil
    AnnounceGroup()
end
