--[[
    MKeyTrackerCommands.lua — /mkt slash commands
    Debugging and manual queue inspection.
]]--

local addonName, ns = ...

SLASH_MKEYTRACKER1 = "/mkt"
SLASH_MKEYTRACKER2 = "/mkeytracker"

local function FormatRunSummary(i, run)
    local mapName = C_ChallengeMode.GetMapUIInfo(run.challengeModeId) or ("map " .. tostring(run.challengeModeId))
    local resultStr
    if run.onTime then
        local upg = run.upgrades or 0
        resultStr = (upg > 0) and ("Timed +" .. upg) or "Timed"
    else
        resultStr = "Depleted"
    end
    return string.format(
        "  %d. %s +%d | %s | %d death(s) | %d member(s) | srv:%d",
        i, mapName, run.keystoneLevel, resultStr, run.deaths or 0,
        run.members and #run.members or 0, run.serverTime or 0
    )
end

local function CmdDump()
    local q = (MKeyTrackerDB and MKeyTrackerDB.pendingRuns) or {}
    if #q == 0 then
        ns.Utils.Print("Pending queue is empty.")
        return
    end
    ns.Utils.Print(string.format("Pending queue (%d run[s]):", #q))
    for i, run in ipairs(q) do
        ns.Utils.Print(FormatRunSummary(i, run))
    end
end

local function CmdDumpDetails(idx)
    local q = (MKeyTrackerDB and MKeyTrackerDB.pendingRuns) or {}
    local run = q[idx]
    if not run then
        ns.Utils.PrintError("No run at index " .. tostring(idx) .. ".")
        return
    end
    ns.Utils.Print(string.format("Run #%d details:", idx))
    ns.Utils.Print(FormatRunSummary(idx, run))
    ns.Utils.Print("  region: " .. (run.region or "?"))
    ns.Utils.Print("  time: " .. (run.completionMs or 0) .. " ms")
    ns.Utils.Print("  affixes: " .. table.concat(run.affixes or {}, ", "))
    ns.Utils.Print("  members:")
    for _, m in ipairs(run.members or {}) do
        ns.Utils.Print(string.format(
            "    - %s-%s | %s | %s | %s",
            m.name or "?", m.realm or "?", m.class or "?", m.spec or "?", m.role or "?"
        ))
    end
end

local function CmdClear()
    if MKeyTrackerDB then
        MKeyTrackerDB.pendingRuns = {}
        MKeyTrackerDB.lastCapturedHash = nil
        ns.Utils.Print("Pending queue cleared.")
    end
end

local function CmdStatus()
    local q = (MKeyTrackerDB and MKeyTrackerDB.pendingRuns) or {}
    local debug = (MKeyTrackerDB and MKeyTrackerDB.settings and MKeyTrackerDB.settings.debugMode) or false
    ns.Utils.Print(string.format(
        "v%s | pending=%d | debug=%s | lastHash=%s",
        ns.version, #q, tostring(debug),
        tostring((MKeyTrackerDB and MKeyTrackerDB.lastCapturedHash) or "nil")
    ))
end

local function CmdDebug(on)
    MKeyTrackerDB = MKeyTrackerDB or {}
    MKeyTrackerDB.settings = MKeyTrackerDB.settings or {}
    MKeyTrackerDB.settings.debugMode = on
    ns.Utils.Print("Debug mode " .. (on and "|cff33ff99on|r" or "off") .. ".")
end

local function CmdTestToast()
    if ns.UI and ns.UI.ShowCaptureToast then
        ns.UI.ShowCaptureToast("Algeth'ar Academy", 15, true, 2)
        ns.Utils.Print("Test toast shown — drag it to reposition, or click Dismiss.")
    else
        ns.Utils.PrintError("UI module not loaded.")
    end
end

local function CmdHideToast()
    if ns.UI and ns.UI.HideToast then ns.UI.HideToast() end
end

local function CmdResetToastPosition()
    if ns.UI and ns.UI.ResetPosition then
        ns.UI.ResetPosition()
        ns.Utils.Print("Toast position reset to default.")
    end
end

local function CmdHelp()
    ns.Utils.Print("Commands:")
    ns.Utils.Print("  /mkt dump         — list pending runs")
    ns.Utils.Print("  /mkt dump <n>     — show full detail for run #n")
    ns.Utils.Print("  /mkt clear        — wipe pending queue")
    ns.Utils.Print("  /mkt status       — addon version + queue counts")
    ns.Utils.Print("  /mkt test         — preview the capture toast")
    ns.Utils.Print("  /mkt hide         — hide the toast now")
    ns.Utils.Print("  /mkt resetpos     — reset toast position to default")
    ns.Utils.Print("  /mkt debug on|off — toggle verbose logging")
end

SlashCmdList["MKEYTRACKER"] = function(msg)
    msg = (msg or ""):lower()
    msg = msg:gsub("^%s+", ""):gsub("%s+$", "")

    if msg == "" or msg == "help" then
        CmdHelp()
    elseif msg == "dump" then
        CmdDump()
    elseif msg:match("^dump%s+(%d+)$") then
        local idx = tonumber(msg:match("^dump%s+(%d+)$"))
        CmdDumpDetails(idx)
    elseif msg == "clear" then
        CmdClear()
    elseif msg == "status" then
        CmdStatus()
    elseif msg == "debug on" then
        CmdDebug(true)
    elseif msg == "debug off" then
        CmdDebug(false)
    elseif msg == "test" then
        CmdTestToast()
    elseif msg == "hide" then
        CmdHideToast()
    elseif msg == "resetpos" then
        CmdResetToastPosition()
    else
        ns.Utils.PrintError("Unknown command: /mkt " .. msg .. " — try /mkt help")
    end
end
