/**
 * Back-office roles and what each one may touch.
 *
 * `SUPER_ADMIN` holds every area. Every other role holds a fixed set of
 * areas that route middleware checks by name — adding a route to a new
 * corner of the admin API means picking the area it belongs to, not writing
 * a new check. The areas are coarse (a resource, not a CRUD verb) except for
 * traders, where money-moving actions (`users.finance`) are split from the
 * rest (`users.manage`) because those two things are different jobs even
 * when the same person holds both roles.
 */

export const ADMIN_ROLES = ['SUPER_ADMIN', 'FINANCE', 'RISK', 'SUPPORT', 'CONTENT'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super admin',
  FINANCE: 'Finance',
  RISK: 'Risk',
  SUPPORT: 'Support',
  CONTENT: 'Content',
};

export const PERMISSION_AREAS = [
  'dashboard',
  'users.view',
  'users.manage',
  'users.finance',
  'finance',
  'support',
  'risk',
  'content',
  'settings',
] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];

/** Areas every role holds, before the SUPER_ADMIN "everything" rule below. */
const ROLE_AREAS: Record<AdminRole, PermissionArea[]> = {
  SUPER_ADMIN: [], // resolved to every area by hasPermission/areasFor
  FINANCE: ['dashboard', 'users.view', 'users.finance', 'finance'],
  RISK: ['dashboard', 'risk'],
  SUPPORT: ['dashboard', 'users.view', 'users.manage', 'support'],
  CONTENT: ['dashboard', 'content'],
};

export function areasFor(role: AdminRole | null | undefined): PermissionArea[] {
  if (!role) return [];
  if (role === 'SUPER_ADMIN') return [...PERMISSION_AREAS];
  return ROLE_AREAS[role] ?? [];
}

export function hasPermission(role: AdminRole | null | undefined, area: PermissionArea): boolean {
  return areasFor(role).includes(area);
}

export function isAdminRole(value: string | null | undefined): value is AdminRole {
  return !!value && (ADMIN_ROLES as readonly string[]).includes(value);
}
