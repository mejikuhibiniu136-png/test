// Template skrip Lua (Roblox executor) ber-watermark HWID + verifikasi + kill-switch polling.
//
// Disajikan oleh /api/scripts/download. Server mengganti placeholder dengan payload terenkripsi
// (xorshift32, cermin scriptCrypto.ts) yang dibangkitkan per-unduhan. Saat jalan, skrip:
//   1) mendekripsi payload watermark (nonce+hex+key tertanam),
//   2) menghitung HWID lokal (djb2 atas UserId|PlaceId — cermin computeHwidHash),
//   3) mencocokkan; bila tidak cocok -> POST laporan kebocoran ke /api/hwid/report,
//   4) mulai mengirim status akun ke /api/receiver/universal,
//   5) mulai polling perintah kontrol ke /api/receiver/control (KILL -> henti + bersih-bersih).
//
// Catatan jujur (sama dengan loader.lua & obfuscate.ts): skema xorshift adalah deterensi, bukan
// rahasia mutlak — pemegang skrip pasti bisa membongkarnya. Tujuannya: badan skrip tidak terbaca
// sekilas (cache/CDN/scanner), dan laporan kebocoran divalidasi server via downloadId di Redis.

export const WM_ENDPOINT = '__DBDATAENTRY_ENDPOINT__';
export const WM_LEAK_URL = '__DBDATAENTRY_LEAK_URL__';
export const WM_CONTROL_URL = '__DBDATAENTRY_CONTROL_URL__';
export const WM_NONCE = '__DBDATAENTRY_HWID_NONCE__';
export const WM_HEX = '__DBDATAENTRY_HWID_HEX__';
export const WM_KEY = '__DBDATAENTRY_HWID_KEY__';
export const WM_ACCOUNT_ID = '__DBDATAENTRY_ACCOUNT_ID__';

export const HWID_SCRIPT_LUA = String.raw`--[[ dbdataentry - skrip ber-watermark HWID (verifikasi + kill-switch)
   Verifikasi HWID terjadi sebelum aktivitas apa pun. Kebocoran dilaporkan ke server. ]]
local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")

if not game:IsLoaded() then game.Loaded:Wait() end
local LocalPlayer = Players.LocalPlayer
while not LocalPlayer do task.wait() LocalPlayer = Players.LocalPlayer end

-- ===== Konfigurasi (diisi server) =====
local ENDPOINT     = "__DBDATAENTRY_ENDPOINT__"
local LEAK_URL     = "__DBDATAENTRY_LEAK_URL__"
local CONTROL_URL  = "__DBDATAENTRY_CONTROL_URL__"
local ACCOUNT_ID   = "__DBDATAENTRY_ACCOUNT_ID__"
local WM_NONCE     = "__DBDATAENTRY_HWID_NONCE__"
local WM_HEX       = "__DBDATAENTRY_HWID_HEX__"
local WM_KEY       = "__DBDATAENTRY_HWID_KEY__"
local SEND_INTERVAL = 20
local POLL_INTERVAL = 5
-- ======================================

local httpRequest = (syn and syn.request) or (http and http.request) or http_request or request
if not httpRequest then return warn("[dbde] executor tidak mendukung HTTP Request!") end
if not bit32 then return warn("[dbde] bit32 tidak tersedia") end

-- Cegah dua instance: yang lama dihentikan.
local sharedEnv = (getgenv and getgenv()) or _G
if type(sharedEnv.__dbde_wm_stop) == "function" then pcall(sharedEnv.__dbde_wm_stop) end
local stopped = false
local paused = false
local function stop() stopped = true end
sharedEnv.__dbde_wm_stop = stop

-- ===== Dekripsi xorshift32 (cermin scriptCrypto.ts) =====
local M = 4294967296
local function seedOf(s)
	local h = 5381
	for i = 1, #s do h = (h * 33 + s:byte(i)) % M end
	return h == 0 and 0x9E3779B9 or h
end
local function decrypt(hex, key, nonce)
	local x, out, n = seedOf(key .. nonce), {}, 0
	for pair in hex:gmatch("%x%x") do
		x = bit32.bxor(x, bit32.lshift(x, 13))
		x = bit32.bxor(x, bit32.rshift(x, 17))
		x = bit32.bxor(x, bit32.lshift(x, 5))
		n = n + 1
		out[n] = string.char(bit32.bxor(tonumber(pair, 16), bit32.band(bit32.rshift(x, 8), 255)))
	end
	return table.concat(out)
end

-- ===== Hitung HWID lokal (cermin computeHwidHash) =====
local function computeHwid()
	local uid = tostring(LocalPlayer.UserId)
	local pid = tostring(game.PlaceId)
	local s = uid .. "|" .. pid
	local h = 5381
	for i = 1, #s do h = (h * 33 + s:byte(i)) % M end
	if h == 0 then h = 2654435769 end
	return string.format("%08x", h)
end

-- ===== Verifikasi watermark =====
local watermark = nil
local function verifyWatermark()
	local raw = decrypt(WM_HEX, WM_KEY, WM_NONCE)
	if raw:sub(1, 10) ~= "--dbde-ok\n" then return nil, "watermark rusak / key salah" end
	local body = raw:sub(11)
	local ok, data = pcall(HttpService.JSONDecode, HttpService, body)
	if not ok or type(data) ~= "table" then return nil, "payload watermark tidak terbaca" end
	return data
end

local function reportLeak(expected, detected, reason)
	local payload = HttpService:JSONEncode({
		downloadId = (watermark and watermark.downloadId) or "",
		accountId = ACCOUNT_ID,
		expectedHwid = expected,
		detectedHwid = detected,
		reason = reason,
	})
	pcall(httpRequest, {
		Url = LEAK_URL, Method = "POST",
		Headers = { ["Content-Type"] = "application/json" },
		Body = payload,
	})
end

-- Buka & verifikasi watermark SEBELUM aktivitas apa pun.
local wmData, wmErr = verifyWatermark()
watermark = wmData
if wmErr then
	warn("[dbde] watermark gagal: " .. tostring(wmErr))
	reportLeak("?", computeHwid(), "watermark_corrupt")
	return -- jangan lanjut: skrip tidak terverifikasi
end

local localHwid = computeHwid()
if localHwid ~= watermark.hwidHash then
	warn("[dbde] HWID tidak cocok — kebocoran terdeteksi")
	reportLeak(watermark.hwidHash, localHwid, "hwid_mismatch")
	return -- henti: perangkat tidak terdaftar
end

-- ===== Pengiriman status akun (posisi, health, inventaris) =====
local function characterRoot()
	local char = LocalPlayer.Character
	if not char then return nil end
	local hrp = char:FindFirstChild("HumanoidRootPart")
	local hum = char:FindFirstChildOfClass("Humanoid")
	return hrp, hum
end

local function buildStatus()
	local hrp, hum = characterRoot()
	local pos = hrp and hrp.Position
	local status = {
		username = LocalPlayer.Name,
		userId = tostring(LocalPlayer.UserId),
		placeId = tostring(game.PlaceId),
		jobId = game.JobId,
		gameName = game.Name,
		state = "ONLINE",
		event = "heartbeat",
		timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ"),
	}
	if pos then status.positionX = math.floor(pos.X * 10) / 10; status.positionY = math.floor(pos.Z * 10) / 10 end
	if hum then status.health = math.floor(hum.Health) end
	local inv, n = {}, 0
	local backpack = LocalPlayer:FindFirstChild("Backpack")
	if backpack then
		for _, item in ipairs(backpack:GetChildren()) do
			if item:IsA("Tool") then n = n + 1; inv[n] = item.Name end
		end
	end
	if n > 0 then status.inventory = table.concat(inv, ", ") end
	return status
end

local function sendStatus()
	if stopped or paused then return end
	local body = HttpService:JSONEncode(buildStatus())
	pcall(httpRequest, {
		Url = ENDPOINT, Method = "POST",
		Headers = { ["Content-Type"] = "application/json" },
		Body = body,
	})
end

-- ===== Kill-switch: polling perintah kontrol =====
local function selfDestruct()
	stop()
	sharedEnv.__dbde_wm_stop = nil
	pcall(function()
		local gui = sharedEnv.__dbde_wm_gui
		if gui then gui:Destroy() end
	end)
	warn("[dbde] KILL diterima — skrip berhenti dan dibersihkan dari memori")
end

local function pollControl()
	if stopped then return end
	local ok, res = pcall(httpRequest, {
		Url = CONTROL_URL .. "?accountId=" .. ACCOUNT_ID .. "&format=lua",
		Method = "GET",
	})
	if not ok or type(res) ~= "table" or res.StatusCode ~= 200 then return end
	local cmd = tostring(res.Body):upper()
	if cmd:find("KILL") then
		selfDestruct()
	elseif cmd:find("PAUSE") then
		paused = true
	elseif cmd:find("RESUME") then
		paused = false
	end
end

-- ===== Mulai =====
sendStatus()
task.spawn(function()
	while not stopped do
		task.wait(SEND_INTERVAL + math.random() * 2)
		if not stopped then sendStatus() end
	end
end)
task.spawn(function()
	while not stopped do
		task.wait(POLL_INTERVAL)
		if not stopped then pollControl() end
	end
end)

local function sendOffline()
	if stopped then return end
	stopped = true
	local body = HttpService:JSONEncode({
		username = LocalPlayer.Name, userId = tostring(LocalPlayer.UserId),
		placeId = tostring(game.PlaceId), jobId = game.JobId, gameName = game.Name,
		state = "OFFLINE", event = "Keluar", timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ"),
	})
	pcall(httpRequest, { Url = ENDPOINT, Method = "POST", Headers = { ["Content-Type"] = "application/json" }, Body = body })
end
pcall(function() game:BindToClose(sendOffline) end)
Players.PlayerRemoving:Connect(function(p) if p == LocalPlayer then sendOffline() end end)
`;

// Mengganti placeholder dengan nilai dari server. Hex & nonce di-escape agar aman sebagai literal
// string Lua (hanya hex, jadi aman; tetap dijaga agar karakter `"` atau `\` tidak menyusup).
const safeLuaString = (v: string) => v.replace(/[\\"\n\r]/g, (c) => (c === '\n' ? '\\n' : c === '\r' ? '\\r' : `\\${c}`));

export function renderHwidScript(params: {
  endpoint: string;
  leakUrl: string;
  controlUrl: string;
  accountId: string;
  nonce: string;
  hex: string;
  key: string;
}): string {
  return HWID_SCRIPT_LUA
    .split(WM_ENDPOINT).join(safeLuaString(params.endpoint))
    .split(WM_LEAK_URL).join(safeLuaString(params.leakUrl))
    .split(WM_CONTROL_URL).join(safeLuaString(params.controlUrl))
    .split(WM_ACCOUNT_ID).join(safeLuaString(params.accountId))
    .split(WM_NONCE).join(safeLuaString(params.nonce))
    .split(WM_HEX).join(safeLuaString(params.hex))
    .split(WM_KEY).join(safeLuaString(params.key));
}
