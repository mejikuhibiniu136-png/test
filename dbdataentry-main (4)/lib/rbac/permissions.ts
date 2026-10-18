// RBAC granular: izin adalah satuan otorisasi, peran hanyalah kumpulan izin.
// ID peran yang tersimpan (superadmin | admin | viewer) TIDAK diubah agar akun dan JWT yang sudah
// ada tetap valid. Nama tampilan berbeda:
//   superadmin -> Super Admin          admin  -> Moderator / Analyst          viewer -> User / Client
import type { Role } from '@/types';

export const PERMISSIONS = [
  'logs:read', 'logs:search', 'logs:export', 'logs:clear',
  'games:read', 'games:write',
  'accounts:read', 'accounts:write',
  'analytics:read',
  'users:read', 'users:manage',
  'sessions:read:own', 'sessions:revoke:own', 'sessions:read:all', 'sessions:revoke:any',
  'settings:read', 'settings:write',
  'apikeys:manage',
  'audit:read',
  'notify:manage',
  'crypto:rotate',
  'queue:read', 'queue:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const USER: readonly Permission[] = [
  'logs:read', 'logs:search', 'logs:export', 'games:read', 'accounts:read', 'analytics:read',
  'sessions:read:own', 'sessions:revoke:own',
];

// Moderator/Analyst = User + mengelola data operasional + melihat pengguna dan antrean. Tanpa akses sistem.
const MODERATOR: readonly Permission[] = [
  ...USER, 'logs:clear', 'games:write', 'accounts:write', 'users:read', 'queue:read',
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  viewer: new Set(USER),
  admin: new Set(MODERATOR),
  superadmin: new Set(PERMISSIONS),
};

export const ROLE_LABEL_KEY: Readonly<Record<Role, 'role.superadmin' | 'role.admin' | 'role.viewer'>> = {
  superadmin: 'role.superadmin',
  admin: 'role.admin',
  viewer: 'role.viewer',
};

export const can = (role: Role | null | undefined, permission: Permission): boolean =>
  role ? ROLE_PERMISSIONS[role]?.has(permission) ?? false : false;

export const canAny = (role: Role | null | undefined, ...permissions: Permission[]): boolean => permissions.some((p) => can(role, p));
