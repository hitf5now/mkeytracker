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
        -- Default: top-center, below minimap/default UI
        frame:ClearAllPoints()
        frame:SetPoint("TOP", UIParent, "TOP", 0, -180)
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
    toast.title:SetText("|cff33ff99✓ Run Captured|r")

    -- Info line (dungeon + level + result)
    toast.info = toast:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    toast.info:SetPoint("TOP", toast.title, "BOTTOM", 0, -6)
    toast.info:SetWidth(TOAST_WIDTH - 24)
    toast.info:SetJustifyH("CENTER")

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
function ns.UI.ShowCaptureToast(dungeonName, level, onTime, upgrades)
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
