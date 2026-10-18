import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, can } from '@/lib/rbac/permissions';

describe('RBAC granular', () => {
  it('superadmin memegang semua izin', () => {
    for (const p of PERMISSIONS) expect(can('superadmin', p)).toBe(true);
  });

  it('hierarki ketat: izin viewer ⊂ admin ⊂ superadmin', () => {
    for (const p of ROLE_PERMISSIONS.viewer) expect(ROLE_PERMISSIONS.admin.has(p)).toBe(true);
    for (const p of ROLE_PERMISSIONS.admin) expect(ROLE_PERMISSIONS.superadmin.has(p)).toBe(true);
    expect(ROLE_PERMISSIONS.admin.size).toBeGreaterThan(ROLE_PERMISSIONS.viewer.size);
  });

  it('setara dengan guard lama: staf = games/accounts/logs:clear; hanya superadmin = sistem', () => {
    expect(can('admin', 'games:write') && can('admin', 'accounts:write') && can('admin', 'logs:clear')).toBe(true);
    expect(can('viewer', 'games:write') || can('viewer', 'logs:clear')).toBe(false);
    for (const p of ['settings:write', 'apikeys:manage', 'audit:read', 'notify:manage', 'crypto:rotate', 'users:manage', 'queue:manage', 'sessions:revoke:any', 'sessions:read:all'] as const) {
      expect(can('admin', p), p).toBe(false);
      expect(can('viewer', p), p).toBe(false);
    }
  });

  it('semua peran boleh mengelola sesinya sendiri; hanya superadmin sesi orang lain', () => {
    expect(can('viewer', 'sessions:revoke:own')).toBe(true);
    expect(can('admin', 'sessions:revoke:any')).toBe(false);
  });

  it('peran tidak dikenal / kosong ditolak', () => {
    expect(can(undefined, 'logs:read')).toBe(false);
    expect(can('hacker' as never, 'logs:read')).toBe(false);
  });
});
