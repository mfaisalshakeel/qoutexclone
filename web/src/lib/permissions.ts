/**
 * Mirrors `server/src/lib/permissions.ts`'s area names and role labels — kept
 * in sync by hand, the same way the seeded fixture credentials in
 * `e2e/helpers.ts` mirror `server/src/seed.ts`. The server is authoritative;
 * this copy only drives which nav links and page guards the client shows.
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

export type PermissionArea =
  | 'dashboard'
  | 'users.view'
  | 'users.manage'
  | 'users.finance'
  | 'finance'
  | 'support'
  | 'risk'
  | 'content'
  | 'settings';

export function hasArea(permissions: string[] | undefined, area: PermissionArea): boolean {
  return !!permissions?.includes(area);
}
