--[[
    MKeyTrackerPanel.lua — the window behind the minimap button.

    Two jobs, in this order:

      1. Show what the platform knows, in game. Season standing and personal
         bests per dungeon were only ever visible on the website; now that
         the companion pushes them into SavedVariables, this is where they
         surface. The dungeon list doubles as the keystone briefing — the
         time to beat is on screen before you start.

      2. Settings. Everything the slash commands already did, without
         needing to remember them.

    ## Layout

    Every element sits at an explicit Y offset from the top of the frame,
    tracked by a running cursor, and the frame's height is whatever that
    cursor ends at. The first version chained each row off the previous
    row's FontString, so the layout depended on text height — one long
    dungeon name wrapped, every row below it shifted, and the bottom of the
    window ran off the frame. Fixed offsets make the height knowable, which
    is the only way to size the window correctly.

    Built with plain frames rather than a config library for the same reason
    the minimap button is: the addon ships no dependencies, and this is a
    handful of rows.
]]--

local addonName, ns = ...
ns.Panel = {}

local PANEL_WIDTH = 420
local PAD = 18
local CONTENT_WIDTH = PANEL_WIDTH - (PAD * 2)

-- Fixed metrics. The window height derives from these, so changing one
-- resizes the frame instead of overflowing it.
local TOP_INSET = 32
local HEADING_H = 20
local ROW_H = 17
local TILE_H = 38
local CHECKBOX_H = 26
local GAP = 10
local FOOTER_H = 44
local MAX_BEST_ROWS = 8
local MAX_PARTY_ROWS = 4

local panel = nil

local function FormatTime(ms)
    if not ms or ms <= 0 then return "--:--" end
    local total = math.floor(ms / 1000)
    return string.format("%d:%02d", math.floor(total / 60), total % 60)
end

local function Comma(n)
    if BreakUpLargeNumbers then return BreakUpLargeNumbers(n or 0) end
    return tostring(n or 0)
end

-- ─── Builders ─────────────────────────────────────────────────────────────

local function Heading(parent, text, y)
    local fs = parent:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    fs:SetPoint("TOPLEFT", parent, "TOPLEFT", PAD, -y)
    fs:SetSize(CONTENT_WIDTH, HEADING_H)
    fs:SetJustifyH("LEFT")
    fs:SetJustifyV("TOP")
    fs:SetText(text)
    fs:SetTextColor(1, 0.82, 0)

    local rule = parent:CreateTexture(nil, "ARTWORK")
    rule:SetColorTexture(1, 0.82, 0, 0.20)
    rule:SetHeight(1)
    rule:SetPoint("TOPLEFT", parent, "TOPLEFT", PAD, -(y + HEADING_H - 4))
    rule:SetPoint("TOPRIGHT", parent, "TOPRIGHT", -PAD, -(y + HEADING_H - 4))
    return fs
end

--- A label and a value on one line.
---
--- Both occupy the same full-width box and are separated by justification.
--- Anchoring the value to the frame's right edge *and* to the label would
--- give it two competing Y coordinates.
local function Row(parent, y)
    local label = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    label:SetPoint("TOPLEFT", parent, "TOPLEFT", PAD + 4, -y)
    label:SetSize(CONTENT_WIDTH - 8, ROW_H)
    label:SetJustifyH("LEFT")
    label:SetJustifyV("TOP")
    -- Rows are single-line by contract. Without this a long dungeon name
    -- wraps and silently pushes the fixed layout out of alignment.
    label:SetWordWrap(false)

    local value = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    value:SetPoint("TOPLEFT", label, "TOPLEFT", 0, 0)
    value:SetSize(CONTENT_WIDTH - 8, ROW_H)
    value:SetJustifyH("RIGHT")
    value:SetJustifyV("TOP")
    value:SetWordWrap(false)

    return { label = label, value = value }
end

--- One of N stat tiles across the width: a big number over a small caption.
--- Far more compact than the same figures as stacked label/value rows, and
--- quicker to scan.
local function Tile(parent, index, count, y)
    local width = CONTENT_WIDTH / count
    local x = PAD + (width * (index - 1))

    local value = parent:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    value:SetPoint("TOPLEFT", parent, "TOPLEFT", x, -y)
    value:SetSize(width, 22)
    value:SetJustifyH("CENTER")
    value:SetWordWrap(false)

    local caption = parent:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
    caption:SetPoint("TOPLEFT", parent, "TOPLEFT", x, -(y + 22))
    caption:SetSize(width, 14)
    caption:SetJustifyH("CENTER")

    return { value = value, caption = caption }
end

local function Checkbox(parent, text, tooltip, y, onClick)
    local cb = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    cb:SetPoint("TOPLEFT", parent, "TOPLEFT", PAD, -y)
    cb:SetSize(22, 22)

    local label = cb:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    label:SetPoint("LEFT", cb, "RIGHT", 4, 0)
    label:SetText(text)

    cb:SetScript("OnClick", function(self) onClick(self:GetChecked() and true or false) end)
    if tooltip then
        cb:SetScript("OnEnter", function(self)
            GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
            GameTooltip:SetText(text, 1, 1, 1)
            GameTooltip:AddLine(tooltip, 1, 1, 1, true)
            GameTooltip:Show()
        end)
        cb:SetScript("OnLeave", function() GameTooltip:Hide() end)
    end
    return cb
end

-- ─── Construction ─────────────────────────────────────────────────────────

local function CreatePanel()
    if panel then return panel end

    panel = CreateFrame("Frame", "MKeyTrackerPanel", UIParent, "BasicFrameTemplateWithInset")
    panel:SetWidth(PANEL_WIDTH)
    panel:SetPoint("CENTER")
    panel:SetFrameStrata("HIGH")
    panel:SetMovable(true)
    panel:EnableMouse(true)
    panel:RegisterForDrag("LeftButton")
    panel:SetScript("OnDragStart", panel.StartMoving)
    panel:SetScript("OnDragStop", panel.StopMovingOrSizing)
    panel:SetClampedToScreen(true)
    tinsert(UISpecialFrames, "MKeyTrackerPanel") -- Escape closes it
    panel:Hide()

    -- Blizzard moved the title into a TitleContainer on some frame templates
    -- and left it at .TitleText on others. Getting this wrong is a nil call
    -- that takes the whole panel down, so try both and shrug if neither.
    local title = panel.TitleText
        or (panel.TitleContainer and panel.TitleContainer.TitleText)
    if title then title:SetText("MKey Tracker") end

    -- Running layout cursor, absolute from the top of the frame. Its final
    -- value is exactly the content height.
    local y = TOP_INSET

    -- ── Status: one compact line rather than three rows ──
    panel.status = panel:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
    panel.status:SetPoint("TOPLEFT", panel, "TOPLEFT", PAD, -y)
    panel.status:SetSize(CONTENT_WIDTH, ROW_H)
    panel.status:SetJustifyH("LEFT")
    panel.status:SetJustifyV("TOP")
    panel.status:SetWordWrap(false)
    y = y + ROW_H + GAP

    -- ── Season ──
    panel.seasonHeading = Heading(panel, "THIS SEASON", y)
    y = y + HEADING_H + 4

    panel.tiles = {}
    local captions = { "Juice", "Runs", "Timed", "Best key" }
    for i = 1, 4 do
        panel.tiles[i] = Tile(panel, i, 4, y)
        panel.tiles[i].caption:SetText(captions[i])
    end
    y = y + TILE_H + 4

    panel.deaths = panel:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
    panel.deaths:SetPoint("TOPLEFT", panel, "TOPLEFT", PAD, -y)
    panel.deaths:SetSize(CONTENT_WIDTH, ROW_H)
    panel.deaths:SetJustifyH("CENTER")
    panel.deaths:SetJustifyV("TOP")
    y = y + ROW_H + GAP

    -- ── Party ──
    -- Sits above personal bests because when you are grouped, who you are
    -- grouped with is the more urgent question.
    panel.partyHeading = Heading(panel, "YOUR GROUP", y)
    y = y + HEADING_H + 2

    panel.partyEmpty = panel:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
    panel.partyEmpty:SetPoint("TOPLEFT", panel, "TOPLEFT", PAD + 4, -y)
    panel.partyEmpty:SetSize(CONTENT_WIDTH - 8, ROW_H)
    panel.partyEmpty:SetJustifyH("LEFT")
    panel.partyEmpty:SetJustifyV("TOP")

    panel.partyRows = {}
    for i = 1, MAX_PARTY_ROWS do
        panel.partyRows[i] = Row(panel, y + ((i - 1) * ROW_H))
    end
    y = y + (MAX_PARTY_ROWS * ROW_H) + GAP

    -- ── Personal bests ──
    panel.bestsHeading = Heading(panel, "YOUR BEST PER DUNGEON", y)
    y = y + HEADING_H + 2

    panel.bestsEmpty = panel:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
    panel.bestsEmpty:SetPoint("TOPLEFT", panel, "TOPLEFT", PAD + 4, -y)
    panel.bestsEmpty:SetSize(CONTENT_WIDTH - 8, ROW_H * 3)
    panel.bestsEmpty:SetJustifyH("LEFT")
    panel.bestsEmpty:SetJustifyV("TOP")

    panel.bestRows = {}
    for i = 1, MAX_BEST_ROWS do
        panel.bestRows[i] = Row(panel, y + ((i - 1) * ROW_H))
    end
    y = y + (MAX_BEST_ROWS * ROW_H) + GAP

    -- ── Settings ──
    panel.settingsHeading = Heading(panel, "SETTINGS", y)
    y = y + HEADING_H + 2

    panel.cbMinimap = Checkbox(
        panel, "Show minimap button",
        "Hide it if you keep your minimap clear. /mkt minimap brings it back.",
        y, function(checked) ns.Minimap.SetShown(checked) end
    )
    y = y + CHECKBOX_H

    panel.cbTooltips = Checkbox(
        panel, "Show group history on tooltips",
        "Adds how many keys you have run with a player, and how many were timed, when you hover them.",
        y, function(checked) ns.Scout.SetTooltipsEnabled(checked) end
    )
    y = y + CHECKBOX_H

    panel.cbAnnounce = Checkbox(
        panel, "Announce group in chat",
        "Prints one summary when a group forms. Nothing is sent to anyone else — it is local to you.",
        y, function(checked) ns.Scout.SetAnnounceEnabled(checked) end
    )
    y = y + CHECKBOX_H

    panel.cbDebug = Checkbox(
        panel, "Verbose logging",
        "Prints detailed capture information to chat. Useful when reporting a problem.",
        y, function(checked)
            MKeyTrackerDB.settings = MKeyTrackerDB.settings or {}
            MKeyTrackerDB.settings.debugMode = checked
        end
    )
    y = y + CHECKBOX_H + GAP

    -- ── Footer ──
    panel.syncBtn = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
    panel.syncBtn:SetSize(150, 22)
    panel.syncBtn:SetPoint("TOPLEFT", panel, "TOPLEFT", PAD, -y)
    panel.syncBtn:SetText("Sync & Reload")
    panel.syncBtn:SetScript("OnClick", function()
        -- Direct call: deferring ReloadUI loses the hardware-event context.
        ReloadUI()
    end)

    panel.resetBtn = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
    panel.resetBtn:SetSize(150, 22)
    panel.resetBtn:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -PAD, -y)
    panel.resetBtn:SetText("Reset positions")
    panel.resetBtn:SetScript("OnClick", function()
        if ns.UI and ns.UI.ResetPosition then ns.UI.ResetPosition() end
        ns.Minimap.ResetPosition()
        ns.Utils.Print("Toast and minimap button moved back to their defaults.")
    end)

    -- The window is exactly as tall as its content — the point of the
    -- fixed-offset layout is that there is no guessed constant to drift.
    panel:SetHeight(y + FOOTER_H)
    return panel
end

-- ─── Refresh ──────────────────────────────────────────────────────────────

local function RefreshStatus()
    local pending = #((MKeyTrackerDB and MKeyTrackerDB.pendingRuns) or {})
    local parts = {
        "v" .. (ns.version or "?"),
        pending == 1 and "1 run waiting" or (pending .. " runs waiting"),
    }

    if ns.Inbound and ns.Inbound.IsAvailable() then
        local age = ns.Inbound.AgeSeconds()
        local when
        if not age then
            when = "data received"
        elseif age < 3600 then
            when = string.format("data %d min old", math.floor(age / 60))
        elseif age < 86400 then
            when = string.format("data %d hr old", math.floor(age / 3600))
        else
            when = string.format("data %d day(s) old", math.floor(age / 86400))
        end
        table.insert(parts, ns.Inbound.IsStale() and ("|cffff8800" .. when .. "|r") or when)
    else
        table.insert(parts, "|cffff8800no companion data|r")
    end

    panel.status:SetText(table.concat(parts, "  ·  "))
end

local function RefreshSeason()
    local player = ns.Inbound and ns.Inbound.GetPlayer and ns.Inbound.GetPlayer()
    local season = ns.Inbound and ns.Inbound.GetSeason and ns.Inbound.GetSeason()
    panel.seasonHeading:SetText(season and string.upper(season.name) or "THIS SEASON")

    if not player then
        for _, tile in ipairs(panel.tiles) do tile.value:SetText("|cff808080—|r") end
        panel.deaths:SetText("")
        return
    end

    panel.tiles[1].value:SetText(Comma(player.juice))
    panel.tiles[2].value:SetText(tostring(player.runs or 0))
    panel.tiles[3].value:SetText((player.timedPct or 0) .. "%")
    panel.tiles[4].value:SetText("+" .. (player.bestKey or 0))
    panel.deaths:SetText(string.format(
        "|cff808080%.2f deaths per run|r", player.avgDeaths or 0
    ))
end

--- Personal bests, ordered by key level. Doubles as the keystone briefing:
--- the time to beat is visible before the key starts.
local function RefreshBests()
    for _, row in ipairs(panel.bestRows) do
        row.label:SetText("")
        row.value:SetText("")
    end

    if not (ns.Inbound and ns.Inbound.IsAvailable()) then
        panel.bestsEmpty:SetText(
            "No companion data yet. Run the companion app with WoW closed, then log back in."
        )
        panel.bestsEmpty:Show()
        return
    end

    -- Names come from the game, so they are localised and match the player's
    -- keystone rather than whatever the server happened to store.
    local entries = {}
    for key, record in pairs(MKeyTrackerDB.inbound.records or {}) do
        local cmid = tonumber(key)
        if cmid and type(record) == "table" then
            local name = C_ChallengeMode and C_ChallengeMode.GetMapUIInfo
                and C_ChallengeMode.GetMapUIInfo(cmid) or nil
            table.insert(entries, {
                name = name or ("Map " .. cmid),
                level = record.bestLevel or 0,
                timeMs = record.bestTimeMs or 0,
            })
        end
    end

    if #entries == 0 then
        panel.bestsEmpty:SetText("No runs recorded this season yet.")
        panel.bestsEmpty:Show()
        return
    end
    panel.bestsEmpty:Hide()

    table.sort(entries, function(a, b)
        if a.level ~= b.level then return a.level > b.level end
        return a.name < b.name
    end)

    for i, entry in ipairs(entries) do
        local row = panel.bestRows[i]
        if not row then break end
        row.label:SetText(entry.name)
        if entry.level > 0 then
            row.value:SetText(string.format(
                "|cffffffff+%d|r   %s", entry.level, FormatTime(entry.timeMs)
            ))
        else
            row.value:SetText("|cff808080not timed|r")
        end
    end
end

--- The current group and what we know about each member.
local function RefreshParty()
    for _, row in ipairs(panel.partyRows) do
        row.label:SetText("")
        row.value:SetText("")
    end

    local units = ns.Scout and ns.Scout.GetPartyUnits and ns.Scout.GetPartyUnits() or {}
    if #units == 0 then
        panel.partyEmpty:SetText("Not in a group.")
        panel.partyEmpty:Show()
        return
    end
    panel.partyEmpty:Hide()

    for i, unit in ipairs(units) do
        local row = panel.partyRows[i]
        if not row then break end

        local name = UnitName(unit) or "?"
        local _, classFile = UnitClass(unit)
        local colour = classFile and RAID_CLASS_COLORS and RAID_CLASS_COLORS[classFile]
        if colour then
            row.label:SetText(string.format("|c%s%s|r", colour.colorStr or "ffffffff", name))
        else
            row.label:SetText(name)
        end

        local data = ns.Scout.GetUnitData(unit)
        if not data then
            row.value:SetText("|cff808080not on the platform|r")
        elseif (data.togetherRuns or 0) > 0 then
            row.value:SetText(string.format(
                "|cff40ff40%d together, %d timed|r   +%d",
                data.togetherRuns, data.togetherTimed or 0, data.bestKey or 0
            ))
        else
            row.value:SetText(string.format(
                "|cff808080first time|r   +%d · %d%%",
                data.bestKey or 0, data.timedPct or 0
            ))
        end
    end
end

local function Refresh()
    if not panel then return end
    RefreshStatus()
    RefreshSeason()
    RefreshParty()
    RefreshBests()
    panel.cbMinimap:SetChecked(ns.Minimap and ns.Minimap.IsShown())
    panel.cbTooltips:SetChecked(ns.Scout and ns.Scout.TooltipsEnabled())
    panel.cbAnnounce:SetChecked(ns.Scout and ns.Scout.AnnounceEnabled())
    panel.cbDebug:SetChecked(
        (MKeyTrackerDB and MKeyTrackerDB.settings and MKeyTrackerDB.settings.debugMode) or false
    )
end

-- ─── Public API ───────────────────────────────────────────────────────────

function ns.Panel.Show()
    CreatePanel()
    Refresh()
    panel:Show()
end

function ns.Panel.Hide()
    if panel then panel:Hide() end
end

function ns.Panel.Toggle()
    CreatePanel()
    if panel:IsShown() then
        panel:Hide()
    else
        ns.Panel.Show()
    end
end
