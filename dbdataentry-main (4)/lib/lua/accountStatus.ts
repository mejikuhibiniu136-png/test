// Template script Lua (Roblox executor) untuk status akun.
// Disajikan oleh /scripts/account_status.lua dengan alamat endpoint diisi dari domain yang
// sedang dipakai, jadi tidak ada domain atau API key yang tertanam di repositori.
// Dijalankan dengan: loadstring(game:HttpGet("https://<domain>/scripts/account_status.lua"))()

export const ENDPOINT_PLACEHOLDER = '__DBDATAENTRY_ENDPOINT__';

export const ACCOUNT_STATUS_LUA = String.raw`--[[
  dbdataentry - klien status akun Roblox (v6, panel UI, design token, telemetri)
  Mengirim status ke Universal Webhook Endpoint. Tidak ada API key di script ini.

  Kolom yang dikirim: username, displayName, state, gameName, userId, placeId, jobId,
  event, latencyMs, fps, pingMs, memoryMb, sessionStart, timestamp, avatarUrl, type = "account_status".
  lastUpdate TIDAK dikirim: server mengisinya dari jamnya sendiri.
]]

local Players = game:GetService("Players")
local MarketplaceService = game:GetService("MarketplaceService")
local HttpService = game:GetService("HttpService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")
local Stats = game:GetService("Stats")

if not game:IsLoaded() then
	game.Loaded:Wait()
end

local LocalPlayer = Players.LocalPlayer
while not LocalPlayer do
	task.wait()
	LocalPlayer = Players.LocalPlayer
end

-- ===== KONFIGURASI =====
local CONFIG = {
	URL = "__DBDATAENTRY_ENDPOINT__",
	INTERVAL = 20, -- detik. Server: STALLED > 30 dtk, OFFLINE > 45 dtk. Jangan lebih dari 25.
	MAX_ATTEMPTS = 4, -- percobaan per pengiriman
	OFFLINE_ATTEMPTS = 2, -- Offline dikirim saat game menutup, waktunya sempit
	BASE_DELAY = 1.5, -- jeda retry awal (detik), dikali 2 tiap gagal
	MAX_DELAY = 12,
	SHOW_UI = true, -- false = tanpa panel
	OPACITY = 0.65, -- keburaman panel (0.2 sampai 1)
	POLL_INTERVAL = 5, -- detik. Cek status maintenance server (ON/OFF + teks), terpisah dari pengiriman data.
}
-- =======================

local httpRequest = (syn and syn.request) or (http and http.request) or http_request or request
if not httpRequest then
	warn("[dbdataentry] Executor tidak mendukung HTTP Request!")
	return
end

-- Cegah dua instance berjalan bersamaan (auto-execute + manual): yang lama dihentikan.
local sharedEnv = (getgenv and getgenv()) or _G
if type(sharedEnv.__dbdataentry_stop) == "function" then
	pcall(sharedEnv.__dbdataentry_stop)
end

local stopped = false
local paused = false
local offlineSent = false
local firstSent = false
local lastLatencyMs = nil -- RTT pengiriman sukses terakhir, dilaporkan di payload berikutnya
local warnedStatus = {}
local cachedGameName = nil
local gui = nil -- ScreenGui panel (nil jika tidak ada)

local SESSION_START = os.date("!%Y-%m-%dT%H:%M:%SZ")
local startedClock = os.time()

-- Statistik untuk panel UI
local stats = { state = "MENGIRIM", ok = 0, fail = 0, err = "-", history = {} }
-- Teks maintenance dari server (HTTP 503 + maintenance = true). nil = server normal.
local maintenanceText = nil
-- Alamat cek status maintenance diturunkan dari CONFIG.URL (domain yang sama dengan penerima).
local STATUS_URL = (string.gsub(CONFIG.URL, "/api/receiver/universal$", "/api/maintenance"))
if STATUS_URL == CONFIG.URL then
	STATUS_URL = nil
end
local lastPollOk = -math.huge -- os.clock() terakhir cek status berhasil

local function recordLatency(value)
	table.insert(stats.history, value)
	if #stats.history > 24 then
		table.remove(stats.history, 1)
	end
end

-- Telemetri klien: FPS, ping, memori. Dicuplik tiap 1 detik, dikirim bersama heartbeat.
local telemetry = { fps = nil, ping = nil, mem = nil }
local hist = { fps = {}, ping = {}, mem = {}, latency = stats.history }
local frameCount, frameSince = 0, os.clock()
local frameConn = RunService.RenderStepped:Connect(function()
	frameCount = frameCount + 1
end)

local function pushHist(list, value)
	table.insert(list, value)
	if #list > 24 then
		table.remove(list, 1)
	end
end

local function sampleTelemetry()
	local now = os.clock()
	local dt = now - frameSince
	if dt >= 0.5 then
		telemetry.fps = math.floor(frameCount / dt + 0.5)
		frameCount, frameSince = 0, now
		pushHist(hist.fps, telemetry.fps)
	end

	local okPing, ping = pcall(function()
		return Stats.Network.ServerStatsItem["Data Ping"]:GetValue()
	end)
	if not (okPing and type(ping) == "number") then
		local okNet, net = pcall(function()
			return LocalPlayer:GetNetworkPing()
		end)
		ping = (okNet and type(net) == "number") and net * 2000 or nil
	end
	if ping then
		telemetry.ping = math.floor(ping + 0.5)
		pushHist(hist.ping, telemetry.ping)
	end

	local okMem, mem = pcall(function()
		return Stats:GetTotalMemoryUsageMb()
	end)
	if okMem and type(mem) == "number" then
		telemetry.mem = math.floor(mem + 0.5)
		pushHist(hist.mem, telemetry.mem)
	end
end

sharedEnv.__dbdataentry_stop = function()
	stopped = true
	pcall(function()
		frameConn:Disconnect()
	end)
	if gui then
		pcall(function()
			gui:Destroy()
		end)
		gui = nil
	end
end

local function getGameName()
	if cachedGameName then
		return cachedGameName
	end
	local ok, info = pcall(function()
		return MarketplaceService:GetProductInfo(game.PlaceId)
	end)
	if ok and info and info.Name then
		cachedGameName = info.Name
		return cachedGameName
	end
	return "Unknown Game"
end

local function warnOnce(status, body)
	if warnedStatus[status] then
		return
	end
	warnedStatus[status] = true
	if status == 400 then
		warn("[dbdataentry] Payload ditolak (400): " .. tostring(body))
	elseif status == 401 then
		warn("[dbdataentry] Server menolak request (401). Endpoint memakai token? Hubungi admin.")
	elseif status == 429 then
		warn("[dbdataentry] Terkena rate limit (429). Naikkan CONFIG.INTERVAL.")
	else
		warn("[dbdataentry] Server membalas status " .. tostring(status))
	end
end

local function shouldRetry(status)
	return status == nil or status == 408 or status == 429 or status >= 500
end

-- Server maintenance menjawab 503 dengan body JSON { maintenance = true, message = "..." }.
-- Mengembalikan teksnya, atau nil bila ini bukan maintenance (503 biasa tetap di-retry).
local function readMaintenance(status, res)
	if status ~= 503 or type(res) ~= "table" or type(res.Body) ~= "string" then
		return nil
	end
	local okJson, decoded = pcall(function()
		return HttpService:JSONDecode(res.Body)
	end)
	if not okJson or type(decoded) ~= "table" or decoded.maintenance ~= true then
		return nil
	end
	if type(decoded.message) == "string" and decoded.message ~= "" then
		return decoded.message
	end
	return "Server sedang maintenance."
end

local function buildPayload(eventType)
	local payload = {
		type = "account_status",
		username = LocalPlayer.Name,
		displayName = LocalPlayer.DisplayName,
		state = (eventType == "Offline") and "OFFLINE" or "ONLINE",
		gameName = getGameName(),
		userId = LocalPlayer.UserId,
		placeId = game.PlaceId,
		jobId = game.JobId ~= "" and game.JobId or "Local/Private",
		event = eventType,
		latencyMs = lastLatencyMs, -- nil di pengiriman pertama: field dilewati
		fps = telemetry.fps, -- nil jika belum terukur: field dilewati
		pingMs = telemetry.ping,
		memoryMb = telemetry.mem,
		sessionStart = SESSION_START,
		timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ"),
		avatarUrl = "https://www.roblox.com/headshot-thumbnail/image?userId="
			.. LocalPlayer.UserId
			.. "&width=420&height=420&format=png",
	}
	local ok, encoded = pcall(function()
		return HttpService:JSONEncode(payload)
	end)
	return ok and encoded or nil
end

-- Kirim satu payload dengan retry (backoff eksponensial + jitter). Mengembalikan true jika sukses.
local function send(eventType, maxAttempts)
	local body = buildPayload(eventType)
	if not body then
		warn("[dbdataentry] Gagal meng-encode payload")
		return false
	end

	local delay = CONFIG.BASE_DELAY
	for attempt = 1, maxAttempts do
		-- Jika Offline sudah dikirim, retry yang tertinggal tidak boleh menimpanya.
		if eventType ~= "Offline" and (offlineSent or stopped) then
			return false
		end

		local startedAt = os.clock()
		local ok, res = pcall(httpRequest, {
			Url = CONFIG.URL,
			Method = "POST",
			Headers = { ["Content-Type"] = "application/json" },
			Body = body,
		})
		local rtt = math.floor((os.clock() - startedAt) * 1000 + 0.5)
		local status = (ok and type(res) == "table" and type(res.StatusCode) == "number") and res.StatusCode or nil

		if status and status >= 200 and status < 300 then
			maintenanceText = nil
			lastLatencyMs = rtt
			recordLatency(rtt)
			stats.ok = stats.ok + 1
			stats.err = "-"
			stats.state = (eventType == "Offline") and "OFFLINE" or "ONLINE"
			return true
		end

		local maintenanceNow = readMaintenance(status, res)
		if maintenanceNow then
			-- Bukan kegagalan: tidak di-retry, tidak dihitung gagal. Skrip mencoba lagi di siklus berikutnya.
			if maintenanceNow ~= maintenanceText then
				warn("[dbdataentry] Maintenance: " .. maintenanceNow)
			end
			maintenanceText = maintenanceNow
			stats.err = "-"
			stats.state = "MAINTENANCE"
			return false
		end

		stats.err = status and ("HTTP " .. tostring(status)) or "tanpa respons"

		if status then
			warnOnce(status, type(res) == "table" and res.Body or nil)
			if not shouldRetry(status) then
				stats.fail = stats.fail + 1
				recordLatency(-1)
				stats.state = "GAGAL"
				return false -- 400/401/403/404: mengulang tidak akan membantu
			end
		end

		if attempt < maxAttempts then
			local wait = delay
			local headers = type(res) == "table" and res.Headers or nil
			local retryAfter = headers and tonumber(headers["Retry-After"] or headers["retry-after"])
			if retryAfter then
				wait = math.min(retryAfter, CONFIG.MAX_DELAY)
			end
			task.wait(wait + math.random() * 0.5)
			delay = math.min(delay * 2, CONFIG.MAX_DELAY)
		end
	end
	stats.fail = stats.fail + 1
	recordLatency(-1)
	stats.state = "GAGAL"
	return false
end

local function sendOffline()
	if offlineSent then
		return
	end
	offlineSent = true
	send("Offline", CONFIG.OFFLINE_ATTEMPTS)
end

-- Pengiriman pertama bernama "Online" (dicatat di log); berikutnya "Heartbeat" (hanya memperbarui status).
local function sendActive()
	if paused then
		return
	end
	-- Maintenance yang terkonfirmasi cek status: jangan kirim data (pasti ditolak). Bila cek status
	-- gagal lebih dari 6 siklus, tetap coba kirim agar skrip tidak macet di status maintenance.
	if maintenanceText and os.clock() - lastPollOk < CONFIG.POLL_INTERVAL * 6 then
		stats.state = "MAINTENANCE"
		return
	end
	stats.state = maintenanceText and "MAINTENANCE" or "MENGIRIM"
	local eventType = firstSent and "Heartbeat" or "Online"
	if send(eventType, CONFIG.MAX_ATTEMPTS) then
		firstSent = true
	end
end

-- Cek status maintenance ke server (ringan, tanpa data akun). Teks yang diubah Superadmin di
-- dashboard sampai ke panel dalam hitungan detik, tanpa menunggu pengiriman data berikutnya.
local function pollMaintenance()
	if not STATUS_URL then
		return
	end
	local okReq, res = pcall(httpRequest, { Url = STATUS_URL, Method = "GET" })
	if not okReq or type(res) ~= "table" or res.StatusCode ~= 200 or type(res.Body) ~= "string" then
		return
	end
	local okJson, decoded = pcall(function()
		return HttpService:JSONDecode(res.Body)
	end)
	if not okJson or type(decoded) ~= "table" then
		return
	end
	lastPollOk = os.clock()
	if decoded.maintenance == true then
		local message = (type(decoded.message) == "string" and decoded.message ~= "") and decoded.message or "Server sedang maintenance."
		if message ~= maintenanceText then
			warn("[dbdataentry] Maintenance: " .. message)
		end
		maintenanceText = message
		stats.state = "MAINTENANCE"
	elseif maintenanceText then
		-- Maintenance selesai: langsung kirim status, tidak menunggu interval berikutnya.
		maintenanceText = nil
		stats.state = paused and "DIJEDA" or "MENGIRIM"
		task.spawn(sendActive)
	end
end

-- ===== PANEL UI =====
-- Token tiga lapis: primitif (nilai mentah) -> semantik (makna) -> komponen (per elemen).
local function rgb(r, g, b)
	return Color3.fromRGB(r, g, b)
end

local PRIMITIVE = {
	gray = {
		[100] = rgb(226, 230, 240), [300] = rgb(148, 157, 178), [400] = rgb(112, 121, 142),
		[600] = rgb(52, 58, 74), [700] = rgb(36, 41, 54), [800] = rgb(24, 28, 38),
		[850] = rgb(17, 20, 27), [900] = rgb(11, 13, 18),
	},
	blue = { [400] = rgb(96, 165, 250) },
	green = { [400] = rgb(74, 222, 128) },
	amber = { [400] = rgb(251, 191, 36) },
	red = { [400] = rgb(248, 113, 113) },
	space = { [1] = 4, [2] = 8, [3] = 12, [4] = 16 },
	radius = { sm = 6, md = 12, full = 999 },
	text = { xs = 11, sm = 12, md = 13, lg = 16 },
	motion = { fast = 0.12, base = 0.2, slow = 0.35 },
	opacity = { glass = math.clamp(CONFIG.OPACITY, 0.2, 1) },
}
local P = PRIMITIVE
local ALPHA = 1 - P.opacity.glass -- BackgroundTransparency permukaan panel

local SEMANTIC = {
	bg = P.gray[900],
	surface = P.gray[850],
	raised = P.gray[800],
	border = P.gray[700],
	borderStrong = P.gray[600],
	textPrimary = P.gray[100],
	textSecondary = P.gray[300],
	textMuted = P.gray[400],
	info = P.blue[400],
	success = P.green[400],
	warning = P.amber[400],
	danger = P.red[400],
	neutral = P.gray[300],
}
local S = SEMANTIC

local STATE_STYLE = {
	ONLINE = { color = S.success, label = "Online" },
	MENGIRIM = { color = S.info, label = "Mengirim" },
	GAGAL = { color = S.danger, label = "Gagal" },
	DIJEDA = { color = S.warning, label = "Dijeda" },
	OFFLINE = { color = S.neutral, label = "Offline" },
	MAINTENANCE = { color = S.warning, label = "Maintenance" },
}

local COMPONENT = {
	panel = { width = 264, headerH = 48, pad = P.space[3], radius = P.radius.md, minW = 232, maxW = 480, minH = 198, maxH = 720 },
	card = { bg = S.surface, radius = P.radius.sm, h = 40 },
	button = { h = 28, bg = S.raised, hover = S.border, active = S.borderStrong, radius = P.radius.sm },
	badge = { w = 112, h = 22, tint = 0.82 },
	spark = { bars = 24, minH = 52 },
	maint = { bg = S.surface, radius = P.radius.sm, minH = 112 },
}
local K = COMPONENT

local function new(class, props, parent)
	local inst = Instance.new(class)
	for k, v in pairs(props) do
		inst[k] = v
	end
	inst.Parent = parent
	return inst
end

local function tween(inst, props, duration)
	local t = TweenService:Create(inst, TweenInfo.new(duration or P.motion.base, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), props)
	t:Play()
	return t
end

local function getGuiParent()
	local okHui, hui = pcall(function()
		return gethui and gethui()
	end)
	if okHui and hui then
		return hui
	end
	local okCore, core = pcall(function()
		local c = game:GetService("CoreGui")
		local probe = Instance.new("Folder")
		probe.Parent = c
		probe:Destroy()
		return c
	end)
	if okCore and core then
		return core
	end
	return LocalPlayer:WaitForChild("PlayerGui")
end

local function formatUptime(seconds)
	local h = math.floor(seconds / 3600)
	local m = math.floor((seconds % 3600) / 60)
	local s = seconds % 60
	return string.format("%02d:%02d:%02d", h, m, s)
end

local function latencyColor(ms)
	if ms < 0 then
		return S.danger
	elseif ms < 150 then
		return S.success
	elseif ms < 400 then
		return S.warning
	end
	return S.danger
end

local function fpsColor(v)
	if v >= 50 then
		return S.success
	elseif v >= 30 then
		return S.warning
	end
	return S.danger
end

local function memColor()
	return S.info
end

-- Seri yang bisa ditampilkan di grafik (klik kartunya untuk memilih)
local SERIES = {
	fps = { title = "FPS", unit = "", floor = 60, color = fpsColor },
	ping = { title = "Ping", unit = " ms", floor = 300, color = latencyColor },
	mem = { title = "Memori", unit = " MB", floor = 100, color = memColor },
	latency = { title = "Latency", unit = " ms", floor = 300, color = latencyColor },
}

local function buildUI()
	local HH, PAD, GAP = K.panel.headerH, K.panel.pad, P.space[2]
	local TOP = 10
	local CARD_H = K.card.h
	local GRID_Y = TOP + K.badge.h + GAP
	local SPARK_Y = GRID_Y + 3 * CARD_H + 3 * GAP
	local ERR_H = 28
	local BTN_H = K.button.h

	local panelW = K.panel.width
	local panelH = HH + SPARK_Y + K.spark.minH + GAP + ERR_H + PAD + BTN_H + PAD
	local minimized = false
	local maintShown = false -- true = panel menampilkan kartu maintenance, fitur lain disembunyikan
	local selected = "fps"

	local conns = {}
	local function track(c)
		table.insert(conns, c)
		return c
	end

	local refresh -- diisi di bawah
	local shownState, pulse = nil, nil

	gui = new("ScreenGui", {
		Name = "dbdataentry_ui",
		ResetOnSpawn = false,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		DisplayOrder = 999,
		IgnoreGuiInset = true,
	}, nil)

	local main = new("Frame", {
		Name = "Main",
		Size = UDim2.fromOffset(panelW, panelH),
		Position = UDim2.new(0, -panelW - 24, 0, 80),
		BackgroundColor3 = S.bg,
		BackgroundTransparency = ALPHA,
		BorderSizePixel = 0,
		ClipsDescendants = true,
	}, gui)
	new("UICorner", { CornerRadius = UDim.new(0, K.panel.radius) }, main)
	new("UIStroke", { Color = S.border, Thickness = 1, Transparency = ALPHA }, main)

	local function text(parent, str, size, color, pos, sz, align, bold)
		return new("TextLabel", {
			Text = str,
			Font = bold and Enum.Font.GothamBold or Enum.Font.Gotham,
			TextSize = size,
			TextColor3 = color,
			TextXAlignment = align or Enum.TextXAlignment.Left,
			TextTruncate = Enum.TextTruncate.AtEnd,
			BackgroundTransparency = 1,
			Position = pos,
			Size = sz,
		}, parent)
	end

	local function bindButton(b, base, hover, active)
		track(b.MouseEnter:Connect(function()
			tween(b, { BackgroundColor3 = hover }, P.motion.fast)
		end))
		track(b.MouseLeave:Connect(function()
			tween(b, { BackgroundColor3 = base }, P.motion.fast)
		end))
		track(b.MouseButton1Down:Connect(function()
			tween(b, { BackgroundColor3 = active }, 0.06)
		end))
		track(b.MouseButton1Up:Connect(function()
			tween(b, { BackgroundColor3 = hover }, P.motion.fast)
		end))
	end

	-- ===== Header =====
	local header = new("Frame", {
		Name = "Header",
		Size = UDim2.new(1, 0, 0, HH),
		BackgroundColor3 = S.surface,
		BackgroundTransparency = ALPHA,
		BorderSizePixel = 0,
	}, main)
	new("Frame", {
		Position = UDim2.new(0, 0, 1, -1),
		Size = UDim2.new(1, 0, 0, 1),
		BackgroundColor3 = S.border,
		BackgroundTransparency = ALPHA,
		BorderSizePixel = 0,
	}, header)

	local avatar = new("ImageLabel", {
		Position = UDim2.fromOffset(PAD, 10),
		Size = UDim2.fromOffset(28, 28),
		BackgroundColor3 = S.border,
		BorderSizePixel = 0,
		Image = "rbxthumb://type=AvatarHeadShot&id=" .. tostring(LocalPlayer.UserId) .. "&w=150&h=150",
	}, header)
	new("UICorner", { CornerRadius = UDim.new(1, 0) }, avatar)

	local nameW = UDim2.new(1, -(PAD + 38 + 66), 0, 16)
	text(header, LocalPlayer.DisplayName, P.text.md, S.textPrimary, UDim2.fromOffset(PAD + 38, 8), nameW, nil, true)
	text(header, "@" .. LocalPlayer.Name, P.text.xs, S.textMuted, UDim2.fromOffset(PAD + 38, 25), UDim2.new(1, -(PAD + 38 + 66), 0, 14))

	local function iconButton(label, fromRight)
		local b = new("TextButton", {
			Text = label,
			Font = Enum.Font.GothamBold,
			TextSize = P.text.md,
			TextColor3 = S.textSecondary,
			BackgroundColor3 = S.surface,
			BackgroundTransparency = ALPHA,
			AutoButtonColor = false,
			BorderSizePixel = 0,
			AnchorPoint = Vector2.new(1, 0),
			Position = UDim2.new(1, -(PAD + fromRight), 0, 12),
			Size = UDim2.fromOffset(24, 24),
		}, header)
		new("UICorner", { CornerRadius = UDim.new(0, K.button.radius) }, b)
		bindButton(b, S.surface, S.raised, S.border)
		return b
	end
	local closeBtn = iconButton("x", 0)
	local minBtn = iconButton("-", 28)

	-- ===== Body (bisa di-scroll saat panel diperkecil) =====
	local body = new("ScrollingFrame", {
		Name = "Body",
		Position = UDim2.fromOffset(0, HH),
		Size = UDim2.new(1, 0, 1, -HH),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 3,
		ScrollBarImageColor3 = S.borderStrong,
		ScrollingDirection = Enum.ScrollingDirection.Y,
		CanvasSize = UDim2.fromOffset(0, panelH - HH),
	}, main)

	-- Baris status: badge + nama game
	local badge = new("Frame", {
		Position = UDim2.fromOffset(PAD, TOP),
		Size = UDim2.fromOffset(K.badge.w, K.badge.h),
		BackgroundColor3 = S.info,
		BackgroundTransparency = K.badge.tint,
		BorderSizePixel = 0,
	}, body)
	new("UICorner", { CornerRadius = UDim.new(1, 0) }, badge)
	local dot = new("Frame", {
		Position = UDim2.fromOffset(10, 7),
		Size = UDim2.fromOffset(8, 8),
		BackgroundColor3 = S.info,
		BorderSizePixel = 0,
	}, badge)
	new("UICorner", { CornerRadius = UDim.new(1, 0) }, dot)
	local badgeText = text(badge, "Mengirim", P.text.xs, S.info, UDim2.fromOffset(24, 0), UDim2.fromOffset(K.badge.w - 28, K.badge.h), nil, true)
	local gameValue = text(body, "-", P.text.xs, S.textMuted, UDim2.fromOffset(PAD + K.badge.w + GAP, TOP), UDim2.fromOffset(100, K.badge.h), Enum.TextXAlignment.Right)

	-- Kartu statistik 2 x 3. Kartu bertanda "seri" bisa diklik untuk memilih grafik.
	local cards = {}
	local function addCard(title, key)
		local f = new("Frame", {
			BackgroundColor3 = K.card.bg,
			BackgroundTransparency = ALPHA,
			BorderSizePixel = 0,
		}, body)
		new("UICorner", { CornerRadius = UDim.new(0, K.card.radius) }, f)
		local stroke = new("UIStroke", { Color = S.border, Thickness = 1, Transparency = ALPHA }, f)
		local titleLbl = text(f, title, P.text.xs, S.textMuted, UDim2.fromOffset(10, 5), UDim2.new(1, -20, 0, 12))
		local valueLbl = text(f, "-", P.text.md + 1, S.textPrimary, UDim2.fromOffset(10, 19), UDim2.new(1, -20, 0, 16), nil, true)
		local entry = { frame = f, stroke = stroke, title = titleLbl, value = valueLbl, key = key }
		if key then
			local hit = new("TextButton", { Text = "", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 1, 0), ZIndex = 3 }, f)
			track(hit.Activated:Connect(function()
				selected = key
				for _, c in ipairs(cards) do
					if c.key then
						c.stroke.Color = (c.key == key) and S.info or S.border
					end
				end
				if refresh then
					refresh()
				end
			end))
		end
		table.insert(cards, entry)
		return entry
	end

	local cFps = addCard("FPS", "fps")
	local cPing = addCard("Ping", "ping")
	local cMem = addCard("Memori", "mem")
	local cLat = addCard("Latency", "latency")
	local cUp = addCard("Uptime", nil)
	local cRate = addCard("Sukses", nil)
	cFps.stroke.Color = S.info -- seri awal

	-- Kartu grafik
	local sparkCard = new("Frame", {
		BackgroundColor3 = K.card.bg,
		BackgroundTransparency = ALPHA,
		BorderSizePixel = 0,
	}, body)
	new("UICorner", { CornerRadius = UDim.new(0, K.card.radius) }, sparkCard)
	new("UIStroke", { Color = S.border, Thickness = 1, Transparency = ALPHA }, sparkCard)
	local sparkTitle = text(sparkCard, "FPS, 24 terakhir", P.text.xs, S.textMuted, UDim2.fromOffset(10, 6), UDim2.new(0.5, -10, 0, 14))
	local sparkAvg = text(sparkCard, "-", P.text.xs, S.textSecondary, UDim2.new(0.5, 0, 0, 6), UDim2.new(0.5, -10, 0, 14), Enum.TextXAlignment.Right)
	local barsBox = new("Frame", {
		Position = UDim2.fromOffset(10, 24),
		Size = UDim2.new(1, -20, 1, -32),
		BackgroundTransparency = 1,
	}, sparkCard)
	local N = K.spark.bars
	local bars = {}
	for i = 1, N do
		local bar = new("Frame", {
			AnchorPoint = Vector2.new(0, 1),
			Position = UDim2.new((i - 1) / N, 0, 1, 0),
			Size = UDim2.new(1 / N, -2, 0, 3),
			BackgroundColor3 = S.border,
			BorderSizePixel = 0,
		}, barsBox)
		new("UICorner", { CornerRadius = UDim.new(0, 2) }, bar)
		bars[i] = bar
	end

	-- Baris error
	local errCard = new("Frame", {
		BackgroundColor3 = K.card.bg,
		BackgroundTransparency = ALPHA,
		BorderSizePixel = 0,
	}, body)
	new("UICorner", { CornerRadius = UDim.new(0, K.card.radius) }, errCard)
	local errStroke = new("UIStroke", { Color = S.border, Thickness = 1, Transparency = ALPHA }, errCard)
	local errDot = new("Frame", {
		Position = UDim2.fromOffset(10, 10),
		Size = UDim2.fromOffset(8, 8),
		BackgroundColor3 = S.success,
		BorderSizePixel = 0,
	}, errCard)
	new("UICorner", { CornerRadius = UDim.new(1, 0) }, errDot)
	local errText = text(errCard, "Tidak ada error", P.text.xs, S.textMuted, UDim2.fromOffset(26, 0), UDim2.new(1, -36, 1, 0))

	-- Kartu maintenance: menggantikan semua fitur panel selama server maintenance.
	local maintCard = new("Frame", {
		BackgroundColor3 = K.maint.bg,
		BackgroundTransparency = ALPHA,
		BorderSizePixel = 0,
		Visible = false,
	}, body)
	new("UICorner", { CornerRadius = UDim.new(0, K.maint.radius) }, maintCard)
	new("UIStroke", { Color = S.warning, Thickness = 1, Transparency = ALPHA }, maintCard)
	text(maintCard, "Sedang maintenance", P.text.sm, S.warning, UDim2.fromOffset(10, 8), UDim2.new(1, -20, 0, 16), nil, true)
	local maintText = text(maintCard, "", P.text.xs, S.textSecondary, UDim2.fromOffset(10, 30), UDim2.new(1, -20, 1, -56))
	maintText.TextWrapped = true
	maintText.TextYAlignment = Enum.TextYAlignment.Top
	text(maintCard, "Pengiriman data dijeda, lanjut otomatis.", P.text.xs, S.textMuted, UDim2.new(0, 10, 1, -22), UDim2.new(1, -20, 0, 14))

	-- Kontrol: Jeda + atur interval
	local function button(label)
		local b = new("TextButton", {
			Text = label,
			Font = Enum.Font.GothamMedium,
			TextSize = P.text.sm,
			TextColor3 = S.textPrimary,
			BackgroundColor3 = K.button.bg,
			BackgroundTransparency = ALPHA,
			AutoButtonColor = false,
			BorderSizePixel = 0,
			Size = UDim2.fromOffset(28, BTN_H),
		}, body)
		new("UICorner", { CornerRadius = UDim.new(0, K.button.radius) }, b)
		new("UIStroke", { Color = S.border, Thickness = 1, Transparency = ALPHA }, b)
		bindButton(b, K.button.bg, K.button.hover, K.button.active)
		return b
	end
	local pauseBtn = button("Jeda")
	local minusBtn = button("-")
	local plusBtn = button("+")
	local intervalLabel = text(body, tostring(CONFIG.INTERVAL) .. " dtk", P.text.sm, S.textSecondary, UDim2.fromOffset(0, 0), UDim2.fromOffset(40, BTN_H), Enum.TextXAlignment.Center)

	-- ===== Tata letak: dihitung ulang tiap ukuran panel berubah =====
	local function layout()
		local inner = panelW - PAD * 2
		local cardW = (inner - GAP) / 2
		gameValue.Size = UDim2.fromOffset(math.max(0, inner - K.badge.w - GAP), K.badge.h)
		for i, c in ipairs(cards) do
			local col, row = (i - 1) % 2, math.floor((i - 1) / 2)
			c.frame.Position = UDim2.fromOffset(PAD + col * (cardW + GAP), GRID_Y + row * (CARD_H + GAP))
			c.frame.Size = UDim2.fromOffset(cardW, CARD_H)
		end
		local tail = GAP + ERR_H + PAD + BTN_H + PAD
		local sparkH = math.max(K.spark.minH, panelH - HH - SPARK_Y - tail)
		sparkCard.Position = UDim2.fromOffset(PAD, SPARK_Y)
		sparkCard.Size = UDim2.fromOffset(inner, sparkH)
		local errY = SPARK_Y + sparkH + GAP
		errCard.Position = UDim2.fromOffset(PAD, errY)
		errCard.Size = UDim2.fromOffset(inner, ERR_H)
		local maintH = math.max(K.maint.minH, panelH - HH - GRID_Y - PAD)
		maintCard.Position = UDim2.fromOffset(PAD, GRID_Y)
		maintCard.Size = UDim2.fromOffset(inner, maintH)
		local ctrlY = errY + ERR_H + PAD
		pauseBtn.Position = UDim2.fromOffset(PAD, ctrlY)
		pauseBtn.Size = UDim2.fromOffset(math.min(120, inner - 110), BTN_H)
		minusBtn.Position = UDim2.fromOffset(PAD + inner - 100, ctrlY)
		intervalLabel.Position = UDim2.fromOffset(PAD + inner - 68, ctrlY)
		plusBtn.Position = UDim2.fromOffset(PAD + inner - 28, ctrlY)
		body.CanvasSize = UDim2.fromOffset(0, maintShown and (GRID_Y + maintH + PAD) or (ctrlY + BTN_H + PAD))
	end

	local function applySize()
		main.Size = UDim2.fromOffset(panelW, minimized and HH or panelH)
		layout()
	end
	layout()

	-- ===== Aksi tombol =====
	track(pauseBtn.Activated:Connect(function()
		paused = not paused
		pauseBtn.Text = paused and "Lanjut" or "Jeda"
		if paused then
			stats.state = "DIJEDA"
		else
			task.spawn(sendActive)
		end
	end))

	local function stepInterval(delta)
		CONFIG.INTERVAL = math.clamp(CONFIG.INTERVAL + delta, 10, 25)
		intervalLabel.Text = tostring(CONFIG.INTERVAL) .. " dtk"
	end
	track(minusBtn.Activated:Connect(function()
		stepInterval(-5)
	end))
	track(plusBtn.Activated:Connect(function()
		stepInterval(5)
	end))

	-- ===== Pegangan ubah ukuran: sudut kanan bawah, tepi bawah, tepi atas =====
	local function handle(props)
		props.BackgroundColor3 = S.info
		props.BackgroundTransparency = 1
		props.BorderSizePixel = 0
		props.Active = true
		props.ZIndex = 6
		local h = new("Frame", props, main)
		track(h.MouseEnter:Connect(function()
			tween(h, { BackgroundTransparency = 0.6 }, P.motion.fast)
		end))
		track(h.MouseLeave:Connect(function()
			tween(h, { BackgroundTransparency = 1 }, P.motion.fast)
		end))
		return h
	end
	local topEdge = handle({ Name = "ResizeTop", Position = UDim2.new(0, 16, 0, 0), Size = UDim2.new(1, -32, 0, 4) })
	local bottomEdge = handle({ Name = "ResizeBottom", Position = UDim2.new(0, 16, 1, -4), Size = UDim2.new(1, -40, 0, 4) })
	local corner = handle({ Name = "ResizeCorner", Position = UDim2.new(1, -18, 1, -18), Size = UDim2.fromOffset(18, 18) })
	for _, xy in ipairs({ { 12, 12 }, { 7, 12 }, { 12, 7 }, { 2, 12 }, { 12, 2 }, { 7, 7 } }) do
		local d = new("Frame", {
			Position = UDim2.fromOffset(xy[1], xy[2]),
			Size = UDim2.fromOffset(2, 2),
			BackgroundColor3 = S.borderStrong,
			BorderSizePixel = 0,
			ZIndex = 7,
		}, corner)
		new("UICorner", { CornerRadius = UDim.new(1, 0) }, d)
	end

	local function setHandlesVisible(v)
		topEdge.Visible = v
		bottomEdge.Visible = v
		corner.Visible = v
	end

	-- ===== Minimize dan tutup =====
	track(minBtn.Activated:Connect(function()
		minimized = not minimized
		minBtn.Text = minimized and "+" or "-"
		if not minimized then
			body.Visible = true
			setHandlesVisible(true)
		else
			setHandlesVisible(false)
		end
		local t = tween(main, { Size = UDim2.fromOffset(panelW, minimized and HH or panelH) }, P.motion.base)
		if minimized then
			t.Completed:Connect(function()
				if minimized then
					body.Visible = false
				end
			end)
		end
	end))

	track(closeBtn.Activated:Connect(function()
		task.spawn(function()
			sendOffline()
			stopped = true
			pcall(function()
				frameConn:Disconnect()
			end)
			for _, c in ipairs(conns) do
				pcall(function()
					c:Disconnect()
				end)
			end
			if gui then
				gui:Destroy()
				gui = nil
			end
		end)
	end))

	track(UserInputService.InputBegan:Connect(function(input, processed)
		if not processed and input.KeyCode == Enum.KeyCode.RightControl and gui then
			gui.Enabled = not gui.Enabled
		end
	end))

	-- ===== Geser dan ubah ukuran (mouse dan sentuh) =====
	local mode, startMouse, startPos, startW, startH = nil, nil, nil, 0, 0
	local function beginDrag(kind, input)
		mode = kind
		startMouse = input.Position
		startPos = main.Position
		startW, startH = panelW, panelH
		input.Changed:Connect(function()
			if input.UserInputState == Enum.UserInputState.End then
				mode = nil
			end
		end)
	end
	local function isPointer(input)
		return input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch
	end

	track(header.InputBegan:Connect(function(input)
		if isPointer(input) and mode == nil then
			beginDrag("move", input)
		end
	end))
	for kind, h in pairs({ top = topEdge, bottom = bottomEdge, corner = corner }) do
		track(h.InputBegan:Connect(function(input)
			if isPointer(input) then
				beginDrag(kind, input)
			end
		end))
	end

	track(UserInputService.InputChanged:Connect(function(input)
		if not mode then
			return
		end
		if input.UserInputType ~= Enum.UserInputType.MouseMovement and input.UserInputType ~= Enum.UserInputType.Touch then
			return
		end
		local dx, dy = input.Position.X - startMouse.X, input.Position.Y - startMouse.Y
		if mode == "move" then
			main.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + dx, startPos.Y.Scale, startPos.Y.Offset + dy)
			return
		end
		if minimized then
			return
		end
		if mode == "corner" then
			panelW = math.clamp(startW + dx, K.panel.minW, K.panel.maxW)
			panelH = math.clamp(startH + dy, K.panel.minH, K.panel.maxH)
		elseif mode == "bottom" then
			panelH = math.clamp(startH + dy, K.panel.minH, K.panel.maxH)
		elseif mode == "top" then
			panelH = math.clamp(startH - dy, K.panel.minH, K.panel.maxH)
			main.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset, startPos.Y.Scale, startPos.Y.Offset + (startH - panelH))
		end
		applySize()
	end))

	gui.Parent = getGuiParent()
	tween(main, { Position = UDim2.new(0, 16, 0, 80) }, P.motion.slow)

	-- ===== Tampilan maintenance: sembunyikan semua fitur, tampilkan kartu teks =====
	local function setMaintenanceView(on)
		maintShown = on
		for _, c in ipairs(cards) do
			c.frame.Visible = not on
		end
		sparkCard.Visible = not on
		errCard.Visible = not on
		pauseBtn.Visible = not on
		minusBtn.Visible = not on
		plusBtn.Visible = not on
		intervalLabel.Visible = not on
		maintCard.Visible = on
		layout()
	end

	-- ===== Segarkan tampilan =====
	local function applyState(state)
		local style = STATE_STYLE[state] or STATE_STYLE.OFFLINE
		if pulse then
			pulse:Cancel()
			pulse = nil
		end
		dot.BackgroundTransparency = 0
		tween(dot, { BackgroundColor3 = style.color }, P.motion.base)
		tween(badge, { BackgroundColor3 = style.color }, P.motion.base)
		badgeText.Text = style.label
		badgeText.TextColor3 = style.color
		if state == "MENGIRIM" then
			pulse = TweenService:Create(dot, TweenInfo.new(0.6, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true), { BackgroundTransparency = 0.75 })
			pulse:Play()
		end
	end

	refresh = function()
		if not gui then
			return
		end
		if stats.state ~= shownState then
			shownState = stats.state
			applyState(shownState)
		end

		gameValue.Text = cachedGameName or "-"

		local inMaintenance = maintenanceText ~= nil
		if inMaintenance ~= maintShown then
			setMaintenanceView(inMaintenance)
		end
		if inMaintenance then
			maintText.Text = maintenanceText
			return
		end

		if telemetry.fps then
			cFps.value.Text = tostring(telemetry.fps)
			cFps.value.TextColor3 = fpsColor(telemetry.fps)
		end
		if telemetry.ping then
			cPing.value.Text = tostring(telemetry.ping) .. " ms"
			cPing.value.TextColor3 = latencyColor(telemetry.ping)
		end
		if telemetry.mem then
			cMem.value.Text = tostring(telemetry.mem) .. " MB"
		end
		if lastLatencyMs then
			cLat.value.Text = tostring(lastLatencyMs) .. " ms"
			cLat.value.TextColor3 = latencyColor(lastLatencyMs)
		end
		cUp.value.Text = formatUptime(os.time() - startedClock)
		local total = stats.ok + stats.fail
		cRate.title.Text = "Sukses (" .. tostring(stats.ok) .. "/" .. tostring(stats.fail) .. ")"
		if total > 0 then
			local pct = math.floor(stats.ok / total * 100 + 0.5)
			cRate.value.Text = tostring(pct) .. "%"
			cRate.value.TextColor3 = pct >= 95 and S.success or (pct >= 80 and S.warning or S.danger)
		end

		-- grafik untuk seri terpilih
		local def = SERIES[selected]
		local list = hist[selected]
		local count, sum, valid, peak = #list, 0, 0, def.floor
		for _, v in ipairs(list) do
			if v >= 0 then
				sum = sum + v
				valid = valid + 1
				peak = math.max(peak, v)
			end
		end
		sparkTitle.Text = def.title .. ", " .. tostring(N) .. " terakhir"
		sparkAvg.Text = valid > 0 and ("rata-rata " .. tostring(math.floor(sum / valid + 0.5)) .. def.unit) or "-"
		for i = 1, N do
			local v = list[count - N + i]
			local bar = bars[i]
			if v then
				local frac = v < 0 and 0 or math.clamp(v / peak, 0, 1)
				bar.BackgroundColor3 = def.color(v)
				bar.Size = UDim2.new(1 / N, -2, frac, 3)
			else
				bar.BackgroundColor3 = S.border
				bar.Size = UDim2.new(1 / N, -2, 0, 3)
			end
		end

		if stats.err == "-" then
			errText.Text = "Tidak ada error"
			errText.TextColor3 = S.textMuted
			errDot.BackgroundColor3 = S.success
			errStroke.Color = S.border
		else
			errText.Text = "Error: " .. stats.err
			errText.TextColor3 = S.danger
			errDot.BackgroundColor3 = S.danger
			errStroke.Color = S.danger
		end
	end

	task.spawn(function()
		while gui and gui.Parent and not stopped do
			refresh()
			task.wait(0.5)
		end
		if pulse then
			pulse:Cancel()
		end
	end)
end

if CONFIG.SHOW_UI then
	local okUi, uiErr = pcall(buildUI)
	if not okUi then
		warn("[dbdataentry] Panel UI gagal dibuat: " .. tostring(uiErr))
	end
end
-- ===== AKHIR PANEL UI =====

sampleTelemetry()
task.spawn(function()
	while not offlineSent and not stopped do
		task.wait(1)
		sampleTelemetry()
	end
end)

pollMaintenance()
sendActive()

task.spawn(function()
	while not offlineSent and not stopped do
		task.wait(CONFIG.POLL_INTERVAL)
		if not offlineSent and not stopped then
			pollMaintenance()
		end
	end
end)

task.spawn(function()
	while not offlineSent and not stopped do
		-- jitter kecil agar banyak akun tidak mengirim serentak
		task.wait(CONFIG.INTERVAL + math.random() * 2)
		if not offlineSent and not stopped then
			sendActive()
		end
	end
end)

pcall(function()
	game:BindToClose(sendOffline)
end)

Players.PlayerRemoving:Connect(function(player)
	if player == LocalPlayer then
		sendOffline()
	end
end)
`;

import { obfuscateLuaSource } from '@/lib/lua/obfuscate';

// `obfuscate` dikontrol sakelar LUA_OBFUSCATION_ENABLED (Pengaturan Sistem, khusus Superadmin).
// Saat aktif: URL endpoint webhook dienkripsi (XOR runtime-decrypt) + seluruh skrip dibungkus
// control-flow obfuscation, sehingga endpoint tidak langsung terbaca dari hasil dekompilasi.
export function renderAccountStatusLua(endpoint: string, options: { obfuscate?: boolean } = {}): string {
  const rendered = ACCOUNT_STATUS_LUA.replace(ENDPOINT_PLACEHOLDER, endpoint);
  if (!options.obfuscate) return rendered;
  return obfuscateLuaSource(rendered, [{ configField: 'URL', value: endpoint }]).source;
}
