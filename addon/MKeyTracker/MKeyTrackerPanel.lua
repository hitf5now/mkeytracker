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

    Built with plain frames rather than a config library for the same reason
    the minimap button is: the addon ships no dependencies, and this is a
    handful of rows.
]]--

local addonName, ns = ...
ns.Panel = {}

local PANEL_WIDTH = 440
local PANEL_HEIGHT = 520

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

-- ─── Small builders ───────────────────────────────────────────────────────

local function AddHeading(parent, text, anchor, yOffset)
    local fs = parent:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    fs:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, yOffset or -12)
    fs:SetText(text)
    fs:SetTextColor(1, 0.82, 0)
    return fs
end

--- A label on the left, a value on the right, on one line.
---
--- Both halves occupy the same full-width box and are separated by
--- justification. Anchoring the value to the panel's right edge *and* to the
--- label's top would give it two competing Y coordinates.
local ROW_TEXT_WIDTH = PANEL_WIDTH - 48

local function AddStatRow(parent, anchor, yOffset)
    local label = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    label:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 8, yOffset or -6)
    label:SetWidth(ROW_TEXT_WIDTH)
    label:SetJustifyH("LEFT")

    local value = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    value:SetPoint("TOPLEFT", label, "TOPLEFT", 0, 0)
    value:SetWidth(ROW_TEXT_WIDTH)
    value:SetJustifyH("RIGHT")

    return { label = label, value = value }
end

local function AddCheckbox(parent, text, tooltip, anchor, yOffset, onClick)
    local cb = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    cb:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, yOffset or -6)
    cb:SetSize(24, 24)

    local label = cb:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    label:SetPoint("LEFT", cb, "RIGHT", 2, 0)
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
    cb.labelText = label
    return cb
end

-- ─── Panel construction ───────────────────────────────────────────────────

local function CreatePanel()
    if panel then return panel end

    panel = CreateFrame("Frame", "MKeyTrackerPanel", UIParent, "BasicFrameTemplateWithInset")
    panel:SetSize(PANEL_WIDTH, PANEL_HEIGHT)
    panel:SetPoint("CENTER")
    panel:SetFrameStrata("HIGH")
    panel:SetMovable(true)
    panel:EnableMouse(true)
    panel:RegisterForDrag("LeftButton")
    panel:SetScript("OnDragStart", panel.StartMoving)
    panel:SetScript("OnDragStop", panel.StopMovingOrSizing)
    panel:SetClampedToScreen(true)
    -- Escape should close it, like every other WoW window.
    tinsert(UISpecialFrames, "MKeyTrackerPanel")
    panel:Hide()

    panel.TitleText:SetText("MKey Tracker")

    local anchor = panel:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    anchor:SetPoint("TOPLEFT", panel, "TOPLEFT", 16, -32)
    anchor:SetText(" ")

    -- ── Status ──
    panel.statusHeading = AddHeading(panel, "Status", anchor, -2)
    panel.rowVersion = AddStatRow(panel, panel.statusHeading, -8)
    panel.rowVersion.label:SetText("Addon version")
    panel.rowPending = AddStatRow(panel, panel.rowVersion.label, -6)
    panel.rowPending.label:SetText("Runs waiting to sync")
    panel.rowData = AddStatRow(panel, panel.rowPending.label, -6)
    panel.rowData.label:SetText("Companion data")

    -- ── Season ──
    panel.seasonHeading = AddHeading(panel, "This season", panel.rowData.label, -14)
    panel.rowJuice = AddStatRow(panel, panel.seasonHeading, -8)
    panel.rowJuice.label:SetText("Juice")
    panel.rowRuns = AddStatRow(panel, panel.rowJuice.label, -6)
    panel.rowRuns.label:SetText("Runs")
    panel.rowTimed = AddStatRow(panel, panel.rowRuns.label, -6)
    panel.rowTimed.label:SetText("Timed")
    panel.rowBest = AddStatRow(panel, panel.rowTimed.label, -6)
    panel.rowBest.label:SetText("Highest key timed")
    panel.rowDeaths = AddStatRow(panel, panel.rowBest.label, -6)
    panel.rowDeaths.label:SetText("Deaths per run")

    -- ── Personal bests ──
    panel.bestsHeading = AddHeading(panel, "Your best per dungeon", panel.rowDeaths.label, -14)
    panel.bestRows = {}
    local previous = panel.bestsHeading
    for i = 1, 8 do
        local row = AddStatRow(panel, previous, i == 1 and -8 or -4)
        row.label:SetTextColor(0.9, 0.9, 0.9)
        panel.bestRows[i] = row
        previous = row.label
    end
    panel.bestsEmpty = panel:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
    panel.bestsEmpty:SetPoint("TOPLEFT", panel.bestsHeading, "BOTTOMLEFT", 8, -8)
    panel.bestsEmpty:SetWidth(PANEL_WIDTH - 48)
    panel.bestsEmpty:SetJustifyH("LEFT")

    -- ── Settings ──
    panel.settingsHeading = AddHeading(panel, "Settings", previous, -14)

    panel.cbMinimap = AddCheckbox(
        panel, "Show minimap button",
        "Hide it if you keep your minimap clear. /mkt minimap brings it back.",
        panel.settingsHeading, -6,
        function(checked) ns.Minimap.SetShown(checked) end
    )
    panel.cbDebug = AddCheckbox(
        panel, "Verbose logging",
        "Prints detailed capture information to chat. Useful when reporting a problem.",
        panel.cbMinimap, -2,
        function(checked)
            MKeyTrackerDB.settings = MKeyTrackerDB.settings or {}
            MKeyTrackerDB.settings.debugMode = checked
        end
    )

    -- ── Footer ──
    panel.syncBtn = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
    panel.syncBtn:SetSize(150, 22)
    panel.syncBtn:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT", 16, 14)
    panel.syncBtn:SetText("Sync & Reload")
    panel.syncBtn:SetScript("OnClick", function()
        -- Direct call: deferring ReloadUI loses the hardware-event context.
        ReloadUI()
    end)

    panel.resetBtn = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
    panel.resetBtn:SetSize(150, 22)
    panel.resetBtn:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT", -16, 14)
    panel.resetBtn:SetText("Reset positions")
    panel.resetBtn:SetScript("OnClick", function()
        if ns.UI and ns.UI.ResetPosition then ns.UI.ResetPosition() end
        ns.Minimap.ResetPosition()
        ns.Utils.Print("Toast and minimap button moved back to their defaults.")
    end)

    return panel
end

-- ─── Refresh ──────────────────────────────────────────────────────────────

local function RefreshStatus()
    local pending = (MKeyTrackerDB and MKeyTrackerDB.pendingRuns) or {}
    panel.rowVersion.value:SetText("v" .. (ns.version or "?"))
    panel.rowPending.value:SetText(tostring(#pending))

    if not (ns.Inbound and ns.Inbound.IsAvailable()) then
        panel.rowData.value:SetText("|cffff8800not received yet|r")
        return
    end
    local age = ns.Inbound.AgeSeconds()
    local season = ns.Inbound.GetSeason()
    local when
    if not age then
        when = "received"
    elseif age < 3600 then
        when = string.format("%d min ago", math.floor(age / 60))
    elseif age < 86400 then
        when = string.format("%d hr ago", math.floor(age / 3600))
    else
        when = string.format("%d day(s) ago", math.floor(age / 86400))
    end
    if ns.Inbound.IsStale() then when = "|cffff8800" .. when .. "|r" end
    panel.rowData.value:SetText((season and season.name or "") .. " · " .. when)
end

local function RefreshSeason()
    local player = ns.Inbound and ns.Inbound.GetPlayer and ns.Inbound.GetPlayer()
    local rows = {
        panel.rowJuice, panel.rowRuns, panel.rowTimed, panel.rowBest, panel.rowDeaths,
    }
    if not player then
        for _, row in ipairs(rows) do row.value:SetText("|cff808080—|r") end
        return
    end
    panel.rowJuice.value:SetText(Comma(player.juice))
    panel.rowRuns.value:SetText(tostring(player.runs or 0))
    panel.rowTimed.value:SetText((player.timedPct or 0) .. "%")
    panel.rowBest.value:SetText("+" .. (player.bestKey or 0))
    panel.rowDeaths.value:SetText(string.format("%.2f", player.avgDeaths or 0))
end

--- Personal bests, ordered by the key level reached. Doubles as the
--- keystone briefing: the time to beat is visible before you start.
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

    -- Names come from the game rather than the payload, so they are always
    -- localised and always match what the player sees on their keystone.
    local entries = {}
    local records = MKeyTrackerDB.inbound.records or {}
    for key, record in pairs(records) do
        local cmid = tonumber(key)
        if cmid and type(record) == "table" then
            local name = C_ChallengeMode and C_ChallengeMode.GetMapUIInfo
                and C_ChallengeMode.GetMapUIInfo(cmid) or ("Map " .. cmid)
            table.insert(entries, {
                name = name or ("Map " .. cmid),
                level = record.bestLevel or 0,
                timeMs = record.bestTimeMs or 0,
                runs = record.runs or 0,
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
                "|cffffffff+%d|r  %s", entry.level, FormatTime(entry.timeMs)
            ))
        else
            row.value:SetText("|cff808080not timed|r")
        end
    end
end

local function Refresh()
    if not panel then return end
    RefreshStatus()
    RefreshSeason()
    RefreshBests()
    panel.cbMinimap:SetChecked(ns.Minimap and ns.Minimap.IsShown())
    panel.cbDebug:SetChecked(
        MKeyTrackerDB and MKeyTrackerDB.settings and MKeyTrackerDB.settings.debugMode or false
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
