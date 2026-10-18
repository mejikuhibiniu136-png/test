--[[ dbdataentry loader. Isi KEY dengan API Key dari dashboard (Sistem > API Key), lalu jalankan. ]]
local KEY  = "dbde_PASTE_API_KEY_DI_SINI"
local BASE = "https://dbdataentry.vercel.app/scripts/account_status.lua"

local request_fn = (syn and syn.request) or (http and http.request) or http_request or request
if not request_fn then return warn("[dbde] executor tidak mendukung HTTP request") end
if not bit32 then return warn("[dbde] bit32 tidak tersedia") end

local M = 4294967296
local function seedOf(s)               -- harus identik dengan seedOf() di scriptCrypto.ts
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

local ok, res = pcall(request_fn, { Url = BASE, Method = "GET", Headers = { ["x-script-key"] = KEY } })
if not ok or type(res) ~= "table" or res.StatusCode ~= 200 then
	return warn("[dbde] gagal memuat skrip (status: " .. tostring(ok and type(res) == "table" and res.StatusCode or res) .. ")")
end

local nonce, hex = tostring(res.Body):match("^(%x+)\n(%x+)%s*$")
if not nonce then return warn("[dbde] respons tidak valid") end

local source = decrypt(hex, KEY, nonce)
if source:sub(1, 10) ~= "--dbde-ok\n" then return warn("[dbde] key salah atau data rusak") end

local fn, err = loadstring(source)
if not fn then return warn("[dbde] gagal kompilasi: " .. tostring(err)) end
fn()
