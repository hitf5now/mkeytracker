--[[
    MKeyTrackerUI.lua — in-game notification frame.

    Shows a non-intrusive toast after a run is captured. User can:
      - Click "Sync & Reload" → immediately flushes to disk via ReloadUI()
      - Click "Dismiss" → toast disappears, run syncs later on natural reload/logout
      - Ignore it → auto-fades after 15 seconds (same as dismiss)

    The frame is draggable with left-click so users can position it
    wherever they want. Position is saved to MKeyTrackerDB.settings.toastPosition
    and restored on login.
]]--

local addonName, ns = ...
ns.UI = {}

local TOAST_DURATION_SEC = 15
local TOAST_WIDTH = 380
local TOAST_HEIGHT = 108
-- Vertical room per scorecard line. The frame only grows when there is
-- something to say, so a run with no history still gets the compact toast.
local SCORECARD_LINE_HEIGHT = 16

-- Frame state
local toast = nil
local remainingSec = 0

-- ─── Position persistence ─────────────────────────────────────────────────
local function LoadToastPosition(frame)
    local pos = MKeyTrackerDB and MKeyTrackerDB.settings and MKeyTrackerDB.settings.toastPosition
    if pos and pos.point and pos.x and pos.y then
        frame:ClearAllPoints()
        frame:SetPoint(pos.point, UIParent, pos.relativePoint or "CENTER", pos.x, pos.y)
    else
        -- Default: dead center of the screen — most reliable spot for clicks
        -- to land over the Sync button regardless of other UI layouts.
        frame:ClearAllPoints()
        frame:SetPoint("CENTER", UIParent, "CENTER", 0, 0)
    end
end

local function SaveToastPosition(frame)
    local point, _, relativePoint, x, y = frame:GetPoint()
    if not MKeyTrackerDB then return end
    MKeyTrackerDB.settings = MKeyTrackerDB.settings or {}
    MKeyTrackerDB.settings.toastPosition = {
        point = point,
        relativePoint = relativePoint,
        x = x,
        y = y,
    }
end

-- ─── Lazy-init the toast frame ────────────────────────────────────────────
local function CreateToastFrame()
    if toast then return toast end

    toast = CreateFrame("Frame", "MKeyTrackerToastFrame", UIParent, "BackdropTemplate")
    toast:SetSize(TOAST_WIDTH, TOAST_HEIGHT)
    toast:SetFrameStrata("HIGH")
    toast:SetClampedToScreen(true)
    toast:Hide()

    -- Dark panel with green border by default
    toast:SetBackdrop({
        bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
        edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 16,
        insets = { left = 4, right = 4, top = 4, bottom = 4 },
    })
    toast:SetBackdropColor(0, 0, 0, 0.88)
    toast:SetBackdropBorderColor(0.2, 0.8, 0.2, 1)

    -- Draggable title bar (invisible — the whole frame is draggable)
    toast:SetMovable(true)
    toast:EnableMouse(true)
    toast:RegisterForDrag("LeftButton")
    toast:SetScript("OnDragStart", function(self) self:StartMoving() end)
    toast:SetScript("OnDragStop", function(self)
        self:StopMovingOrSizing()
        SaveToastPosition(self)
    end)

    -- Title
    toast.title = toast:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    toast.title:SetPoint("TOP", toast, "TOP", 0, -10)
    toast.title:SetText("|cff33ff99Run Captured|r")

    -- Info line (dungeon + level + result)
    toast.info = toast:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    toast.info:SetPoint("TOP", toast.title, "BOTTOM", 0, -6)
    toast.info:SetWidth(TOAST_WIDTH - 24)
    toast.info:SetJustifyH("CENTER")

    -- Scorecard — how this run compares to the player's own history. Empty
    -- for a dungeon we have no record of, in which case the frame stays at
    -- its compact height.
    toast.scorecard = toast:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    toast.scorecard:SetPoint("TOP", toast.info, "BOTTOM", 0, -6)
    toast.scorecard:SetWidth(TOAST_WIDTH - 32)
    toast.scorecard:SetJustifyH("CENTER")
    toast.scorecard:SetSpacing(2)

    -- Sync button (primary action)
    toast.syncBtn = CreateFrame("Button", "MKeyTrackerSyncBtn", toast, "UIPanelButtonTemplate")
    toast.syncBtn:SetSize(170, 24)
    toast.syncBtn:SetPoint("BOTTOMLEFT", toast, "BOTTOMLEFT", 16, 12)
    toast.syncBtn:SetText("Sync & Reload")
    toast.syncBtn:SetScript("OnClick", function()
        -- ReloadUI() must be called DIRECTLY from the click handler,
        -- not wrapped in C_Timer.After or any other deferred callback.
        -- Deferred calls lose the hardware-event context and WoW blocks
        -- them as "Interface action failed because of an AddOn".
        toast:Hide()
        ReloadUI()
    end)
    toast.syncBtn:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_TOP")
        GameTooltip:SetText("Triggers /reload")
        GameTooltip:AddLine("Writes pending runs to disk so the companion app can pick them up immediately.", 1, 1, 1, true)
        GameTooltip:Show()
    end)
    toast.syncBtn:SetScript("OnLeave", function() GameTooltip:Hide() end)

    -- Dismiss button (secondary)
    toast.dismissBtn = CreateFrame("Button", "MKeyTrackerDismissBtn", toast, "UIPanelButtonTemplate")
    toast.dismissBtn:SetSize(150, 24)
    toast.dismissBtn:SetPoint("BOTTOMRIGHT", toast, "BOTTOMRIGHT", -16, 12)
    toast.dismissBtn:SetText("Dismiss")
    toast.dismissBtn:SetScript("OnClick", function() toast:Hide() end)

    -- Countdown timer via OnUpdate. Updates the dismiss button with
    -- remaining seconds so the auto-fade is never a surprise.
    toast:SetScript("OnUpdate", function(self, elapsed)
        remainingSec = remainingSec - elapsed
        if remainingSec <= 0 then
            self:Hide()
            return
        end
        self.dismissBtn:SetText(string.format("Dismiss (%ds)", math.ceil(remainingSec)))
    end)

    LoadToastPosition(toast)
    return toast
end

-- ─── Public API ───────────────────────────────────────────────────────────

-- Show the capture toast with this run's info.
-- onTime / upgrades drive the border color (green vs red) and the result text.
-- @param context Optional { challengeModeId, completionMs, deaths } used to
--        compare this run against the player's records. Omitted by callers
--        that have no run context, which just yields the compact toast.
function ns.UI.ShowCaptureToast(dungeonName, level, onTime, upgrades, context)
    local frame = CreateToastFrame()

    local resultStr
    if onTime then
        local upg = upgrades or 0
        resultStr = (upg > 0) and ("|cff33ff99Timed +" .. upg .. "|r") or "|cff33ff99Timed|r"
    else
        resultStr = "|cffff3333Depleted|r"
    end

    frame.info:SetText(string.format(
        "%s |cffffffff+%d|r — %s",
        dungeonName or "Unknown",
        level or 0,
        resultStr
    ))

    -- Border color mirrors the result
    if onTime then
        frame:SetBackdropBorderColor(0.2, 0.8, 0.2, 1)
    else
        frame:SetBackdropBorderColor(0.9, 0.3, 0.2, 1)
    end

    -- Scorecard lines, when the companion has given us anything to compare
    -- against. Guarded because the Inbound module is optional at runtime —
    -- an addon updated ahead of its companion must still show the toast.
    local lines = {}
    if context and ns.Inbound and ns.Inbound.BuildScorecard then
        local ok, built = pcall(
            ns.Inbound.BuildScorecard,
            context.challengeModeId, level, onTime, context.completionMs, context.deaths
        )
        if ok and type(built) == "table" then lines = built end
    end

    if #lines > 0 then
        frame.scorecard:SetText(table.concat(lines, "\n"))
        frame.scorecard:Show()
        frame:SetHeight(TOAST_HEIGHT + (#lines * SCORECARD_LINE_HEIGHT) + 6)
    else
        frame.scorecard:SetText("")
        frame.scorecard:Hide()
        frame:SetHeight(TOAST_HEIGHT)
    end

    remainingSec = TOAST_DURATION_SEC
    frame.dismissBtn:SetText(string.format("Dismiss (%ds)", TOAST_DURATION_SEC))
    frame:Show()
end

-- Force-hide the toast (used by /mkt hide)
function ns.UI.HideToast()
    if toast then toast:Hide() end
end

-- Reset the saved position to the default anchor (used by /mkt resetpos)
function ns.UI.ResetPosition()
    if MKeyTrackerDB and MKeyTrackerDB.settings then
        MKeyTrackerDB.settings.toastPosition = nil
    end
    if toast then
        LoadToastPosition(toast)
    end
end

-- ─── Keystone briefing ────────────────────────────────────────────────────

--[[
    A short banner when a key starts.

    Separate from the capture toast on purpose: this one carries no action,
    so it has no buttons and fades on its own. It sits high on the screen
    rather than centre, because the player is about to move and a box over
    the middle of the viewport during a pull is an obstruction.
]]--
local BRIEFING_DURATION_SEC = 12
local briefing = nil
local briefingRemaining = 0

local function CreateBriefingFrame()
    if briefing then return briefing end

    briefing = CreateFrame("Frame", "MKeyTrackerBriefingFrame", UIParent, "BackdropTemplate")
    briefing:SetSize(420, 74)
    briefing:SetPoint("TOP", UIParent, "TOP", 0, -140)
    briefing:SetFrameStrata("MEDIUM")
    briefing:SetClampedToScreen(true)
    briefing:SetBackdrop({
        bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
        edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 16,
        insets = { left = 4, right = 4, top = 4, bottom = 4 },
    })
    briefing:SetBackdropColor(0, 0, 0, 0.82)
    briefing:SetBackdropBorderColor(1, 0.82, 0, 1)
    briefing:Hide()

    briefing.title = briefing:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    briefing.title:SetPoint("TOP", briefing, "TOP", 0, -10)
    briefing.title:SetWidth(400)
    briefing.title:SetJustifyH("CENTER")

    briefing.body = briefing:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    briefing.body:SetPoint("TOP", briefing.title, "BOTTOM", 0, -6)
    briefing.body:SetWidth(396)
    briefing.body:SetJustifyH("CENTER")
    briefing.body:SetSpacing(3)

    briefing:SetScript("OnUpdate", function(self, elapsed)
        briefingRemaining = briefingRemaining - elapsed
        if briefingRemaining <= 0 then self:Hide() end
    end)

    return briefing
end

--- @param lines Array of strings from ns.Inbound.BuildBriefing.
function ns.UI.ShowBriefing(dungeonName, level, lines)
    if not lines or #lines == 0 then return end
    local frame = CreateBriefingFrame()

    frame.title:SetText(string.format(
        "|cffffd100%s|r |cffffffff+%d|r", dungeonName or "Mythic+", level or 0
    ))
    frame.body:SetText(table.concat(lines, "\n"))
    frame:SetHeight(46 + (#lines * 15))

    briefingRemaining = BRIEFING_DURATION_SEC
    frame:Show()
end

function ns.UI.HideBriefing()
    if briefing then briefing:Hide() end
end
