// Cuplikan Lua mandiri untuk polling perintah kontrol (kill-switch). Dapat disisipkan ke skrip
// apa pun (mis. account_status.lua) tanpa watermark HWID. Skrip air terjun: GET endpoint kontrol
// tiap POLL_INTERVAL detik; KILL -> hentikan loop & bersih-bersih memori; PAUSE/RESUME -> toggle.
//
// Endpoint mengembalikan teks biasa ("KILL"/"PAUSE"/"RESUME"/"OK") saat ?format=lua, sehingga
// tidak perlu parsing JSON di sisi executor.

export const CONTROL_SNIPPET_PLACEHOLDER_ACCOUNT = '__DBDATAENTRY_CTRL_ACCOUNT__';
export const CONTROL_SNIPPET_PLACEHOLDER_URL = '__DBDATAENTRY_CTRL_URL__';

export const CONTROL_POLL_LUA = String.raw`-- ===== dbdataentry: kill-switch polling (dapat disisipkan ke skrip mana pun) =====
local __dbde_ctrl_account = "__DBDATAENTRY_CTRL_ACCOUNT__"
local __dbde_ctrl_url = "__DBDATAENTRY_CTRL_URL__"
local __dbde_ctrl_interval = 5

local __dbde_ctrl_req = (syn and syn.request) or (http and http.request) or http_request or request
local __dbde_ctrl_stopped = false

local function __dbde_ctrl_selfdestruct()
	__dbde_ctrl_stopped = true
	local g = (getgenv and getgenv()) or _G
	if type(g.__dbde_stop) == "function" then pcall(g.__dbde_stop) end
	if type(g.__dbde_wm_stop) == "function" then pcall(g.__dbde_wm_stop) end
	pcall(function()
		local gui = g.__dbde_wm_gui or g.__dbde_gui
		if gui then gui:Destroy() end
	end)
	g.__dbde_stop = nil
	g.__dbde_wm_stop = nil
	warn("[dbde] KILL diterima — proses dihentikan dan dibersihkan dari memori")
end

local function __dbde_ctrl_poll()
	if __dbde_ctrl_stopped or not __dbde_ctrl_req then return end
	local ok, res = pcall(__dbde_ctrl_req, {
		Url = __dbde_ctrl_url .. "?accountId=" .. __dbde_ctrl_account .. "&format=lua",
		Method = "GET",
	})
	if not ok or type(res) ~= "table" or res.StatusCode ~= 200 then return end
	local cmd = tostring(res.Body):upper()
	if cmd:find("KILL") then
		__dbde_ctrl_selfdestruct()
	elseif cmd:find("PAUSE") then
		local g = (getgenv and getgenv()) or _G
		g.__dbde_paused = true
	elseif cmd:find("RESUME") then
		local g = (getgenv and getgenv()) or _G
		g.__dbde_paused = false
	end
end

task.spawn(function()
	while not __dbde_ctrl_stopped do
		task.wait(__dbde_ctrl_interval)
		__dbde_ctrl_poll()
	end
end)
-- ===== akhir kill-switch =====
`;

const esc = (v: string) => v.replace(/[\\"\n\r]/g, (c) => (c === '\n' ? '\\n' : c === '\r' ? '\\r' : `\\${c}`));

export function renderControlSnippet(accountId: string, controlUrl: string): string {
  return CONTROL_POLL_LUA
    .split(CONTROL_SNIPPET_PLACEHOLDER_ACCOUNT).join(esc(accountId))
    .split(CONTROL_SNIPPET_PLACEHOLDER_URL).join(esc(controlUrl));
}
