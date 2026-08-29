--[[
    MKeyTrackerMinimap.lua — the minimap button.

    Written self-contained rather than on LibDBIcon. The addon ships no
    libraries at all, and the Ace3 stack would add a dozen files to a bundle
    that is currently 57 KB and served over the wire on every update. A
    minimap button is ~150 lines; the dependency is not worth it.

    Left-click opens the panel, right-click syncs when runs are waiting, and
    dragging moves the button around the minimap edge. The angle is saved so
    it stays where the player put it.
]]--

local addonName, ns = ...
ns.Minimap = {}

--- Gap between the minimap edge and the button's centre. Small on purpose:
--- the button straddles the ring rather than floating off it, which is how
--- every other minimap button sits.
local EDGE_GAP = 6
local DEFAULT_ANGLE = 194

--- Orbit radius, measured from the minimap itself.
---
--- This was hardcoded to 80, which put the button *inside* the ring — the
--- default minimap has grown across expansions, and other addons rescale it.
--- Reading the live size keeps the button on the edge whatever that size is.
local function OrbitRadii()
    local w = (Minimap:GetWidth() or 140) / 2 + EDGE_GAP
    local h = (Minimap:GetHeight() or 140) / 2 + EDGE_GAP
    return w, h
end

local button = nil

local function Settings()
    MKeyTrackerDB = MKeyTrackerDB or {}
    MKeyTrackerDB.settings = MKeyTrackerDB.settings or {}
    MKeyTrackerDB.settings.minimap = MKeyTrackerDB.settings.minimap or {}
    return MKeyTrackerDB.settings.minimap
end

local function PositionAt(angle)
    if not button then return end
    local rad = math.rad(angle)
    local w, h = OrbitRadii()
    button:ClearAllPoints()
    button:SetPoint("CENTER", Minimap, "CENTER", math.cos(rad) * w, math.sin(rad) * h)
end

--- Follow the cursor around the minimap while dragging.
local function OnUpdateDragging(self)
    local mx, my = Minimap:GetCenter()
    local scale = Minimap:GetEffectiveScale()
    local cx, cy = GetCursorPosition()
    cx, cy = cx / scale, cy / scale

    local angle = math.deg(math.atan2(cy - my, cx - mx))
    if angle < 0 then angle = angle + 360 end

    Settings().angle = angle
    PositionAt(angle)
end

local function BuildTooltip(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:SetText("MKey Tracker", 1, 1, 1)

    local pending = (MKeyTrackerDB and MKeyTrackerDB.pendingRuns) or {}
    if #pending > 0 then
        GameTooltip:AddLine(
            string.format("%d run(s) waiting to sync", #pending), 1, 0.82, 0
        )
    else
        GameTooltip:AddLine("No runs waiting", 0.6, 0.6, 0.6)
    end

    -- Season standing, when the companion has sent any.
    local player = ns.Inbound and ns.Inbound.GetPlayer and ns.Inbound.GetPlayer()
    if player then
        GameTooltip:AddLine(" ")
        GameTooltip:AddDoubleLine(
            "Juice",
            BreakUpLargeNumbers and BreakUpLargeNumbers(player.juice or 0)
                or tostring(player.juice or 0),
            0.8, 0.8, 0.8, 1, 1, 1
        )
        GameTooltip:AddDoubleLine("Timed", (player.timedPct or 0) .. "%", 0.8, 0.8, 0.8, 1, 1, 1)
        GameTooltip:AddDoubleLine("Best key", "+" .. (player.bestKey or 0), 0.8, 0.8, 0.8, 1, 1, 1)
    end

    GameTooltip:AddLine(" ")
    GameTooltip:AddLine("Left-click to open", 0.4, 0.78, 1)
    GameTooltip:AddLine("Right-click to sync now", 0.4, 0.78, 1)
    GameTooltip:AddLine("Drag to move", 0.5, 0.5, 0.5)
    GameTooltip:Show()
end

local function CreateButton()
    if button then return button end

    button = CreateFrame("Button", "MKeyTrackerMinimapButton", Minimap)
    button:SetSize(31, 31)
    button:SetFrameStrata("MEDIUM")
    button:SetFrameLevel(8)
    button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    button:RegisterForDrag("LeftButton")
    button:SetMovable(true)

    local icon = button:CreateTexture(nil, "BACKGROUND")
    icon:SetSize(20, 20)
    icon:SetTexture("Interface\\Icons\\INV_Relics_Hourglass")
    -- Trim the icon's built-in border so it sits cleanly inside the ring.
    icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
    icon:SetPoint("CENTER", button, "CENTER", 0, 1)
    button.icon = icon

    local border = button:CreateTexture(nil, "OVERLAY")
    border:SetSize(53, 53)
    border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
    border:SetPoint("TOPLEFT")

    button:SetScript("OnDragStart", function(self)
        self:SetScript("OnUpdate", OnUpdateDragging)
        GameTooltip:Hide()
    end)
    button:SetScript("OnDragStop", function(self)
        self:SetScript("OnUpdate", nil)
    end)

    button:SetScript("OnEnter", BuildTooltip)
    button:SetScript("OnLeave", function() GameTooltip:Hide() end)

    button:SetScript("OnClick", function(self, mouseButton)
        if mouseButton == "RightButton" then
            -- ReloadUI must be called straight from the click handler. A
            -- deferred call loses the hardware-event context and WoW blocks
            -- it as "Interface action failed because of an AddOn".
            if #((MKeyTrackerDB and MKeyTrackerDB.pendingRuns) or {}) > 0 then
                ReloadUI()
            else
                ns.Utils.Print("Nothing to sync.")
            end
            return
        end
        if ns.Panel and ns.Panel.Toggle then ns.Panel.Toggle() end
    end)

    return button
end

--- Create and place the button, honouring the saved position and hide flag.
function ns.Minimap.Init()
    local settings = Settings()
    if settings.hide then return end

    CreateButton()
    PositionAt(settings.angle or DEFAULT_ANGLE)
    button:Show()

    -- A UI-scale change or a minimap-resizing addon moves the ring out from
    -- under us, so re-place the button whenever the minimap changes size.
    if not button.sizeHook then
        button.sizeHook = true
        Minimap:HookScript("OnSizeChanged", function()
            PositionAt(Settings().angle or DEFAULT_ANGLE)
        end)
    end
end

--- Show or hide the button. Persists so it survives a reload.
function ns.Minimap.SetShown(shown)
    Settings().hide = not shown
    if shown then
        CreateButton()
        PositionAt(Settings().angle or DEFAULT_ANGLE)
        button:Show()
    elseif button then
        button:Hide()
    end
end

function ns.Minimap.IsShown()
    return not Settings().hide
end

function ns.Minimap.Toggle()
    ns.Minimap.SetShown(not ns.Minimap.IsShown())
    return ns.Minimap.IsShown()
end

--- Put the button back at the default angle, for when it ends up somewhere
--- unreachable behind another addon's frames.
function ns.Minimap.ResetPosition()
    Settings().angle = DEFAULT_ANGLE
    PositionAt(DEFAULT_ANGLE)
end
