import { describe, expect, it } from 'vitest';
import { renameLocalIdentifiers } from '@/lib/lua/obfuscate';
import { ACCOUNT_STATUS_LUA } from '@/lib/lua/accountStatus';

describe('renameLocalIdentifiers', () => {
  it('tidak merusak parameter fungsi yang namanya sama dengan local lain', () => {
    const src = [
      'local function pushHist(list, value)',
      '  list[#list + 1] = value',
      'end',
      'local list = {}',
      'pushHist(list, 1)',
    ].join('\n');
    const out = renameLocalIdentifiers(src);
    // `list` dikecualikan dari rename, jadi badan fungsi tetap merujuk parameter yang sama.
    expect(out).toContain('list[#list + 1] = value');
    expect(out).toContain('local list = {}');
  });

  it('tidak merusak variabel for yang namanya sama dengan local lain', () => {
    const src = ['local v = 1', 'for _, v in ipairs({}) do print(v) end'].join('\n');
    expect(renameLocalIdentifiers(src)).toContain('for _, v in ipairs({}) do print(v) end');
  });

  it('ikut me-rename variabel yang dipakai sesudah operator .. (concat)', () => {
    const out = renameLocalIdentifiers('local counter = 1\nprint("n: " .. counter .. "!" .. counter)');
    expect(out).not.toContain('counter');
    // field dengan nama yang sama tetap utuh
    expect(renameLocalIdentifiers('local counter = 1\nprint(obj.counter, "x" .. obj.counter)')).toContain('obj.counter, "x" .. obj.counter');
  });

  it('tetap me-rename local biasa', () => {
    const out = renameLocalIdentifiers('local counter = 1\nprint(counter)');
    expect(out).not.toContain('counter');
  });

  it('account_status.lua: tiap parameter/for-var tetap utuh setelah rename', () => {
    const out = renameLocalIdentifiers(ACCOUNT_STATUS_LUA);
    expect(out).toMatch(/local function \w+\(list, value\)/);
    expect(out).toMatch(/local function \w+\(inst, props, duration\)/);
    expect(out).toMatch(/local function \w+\(status, body\)/);
    expect(out).toMatch(/local function \w+\(r, g, b\)/);
  });
});

describe('account_status.lua: status maintenance', () => {
  it('template memuat pembaca 503 maintenance dan gaya panelnya', () => {
    expect(ACCOUNT_STATUS_LUA).toContain('local function readMaintenance(status, res)');
    expect(ACCOUNT_STATUS_LUA).toContain('decoded.maintenance ~= true');
    expect(ACCOUNT_STATUS_LUA).toContain('MAINTENANCE = { color = S.warning, label = "Maintenance" }');
  });
  it('rename tidak menyentuh field JSON maintenance/message dan nama state', () => {
    const out = renameLocalIdentifiers(ACCOUNT_STATUS_LUA);
    // `decoded` boleh di-rename, tapi nama field JSON dari server harus utuh.
    expect(out).toMatch(/\.maintenance ~= true/);
    expect(out).toMatch(/\.message ~= ""/);
    expect(out).not.toMatch(/\bdecoded\b/);
    expect(out).toMatch(/\.state = "MAINTENANCE"/);
    expect(out).not.toMatch(/\bmaintenanceText\b/);
  });
});
