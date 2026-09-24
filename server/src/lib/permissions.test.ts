import { describe, expect, it } from 'vitest';
import { ADMIN_ROLES, PERMISSION_AREAS, areasFor, hasPermission, isAdminRole } from './permissions.js';

describe('areasFor', () => {
  it('gives the super admin every area', () => {
    expect(areasFor('SUPER_ADMIN')).toEqual([...PERMISSION_AREAS]);
  });

  it('gives every other role a fixed, non-empty set', () => {
    for (const role of ADMIN_ROLES) {
      if (role === 'SUPER_ADMIN') continue;
      const areas = areasFor(role);
      expect(areas.length).toBeGreaterThan(0);
      expect(areas).toContain('dashboard');
    }
  });

  it('keeps money-moving and non-money trader actions apart', () => {
    expect(areasFor('SUPPORT')).toContain('users.manage');
    expect(areasFor('SUPPORT')).not.toContain('users.finance');
    expect(areasFor('FINANCE')).toContain('users.finance');
    expect(areasFor('FINANCE')).not.toContain('users.manage');
  });

  it('is empty for null, undefined or an unknown role', () => {
    expect(areasFor(null)).toEqual([]);
    expect(areasFor(undefined)).toEqual([]);
  });

  it('keeps risk and content out of each other and out of finance/support', () => {
    expect(areasFor('RISK')).toEqual(['dashboard', 'risk']);
    expect(areasFor('CONTENT')).toEqual(['dashboard', 'content']);
  });
});

describe('hasPermission', () => {
  it('matches areasFor', () => {
    expect(hasPermission('FINANCE', 'finance')).toBe(true);
    expect(hasPermission('FINANCE', 'risk')).toBe(false);
    expect(hasPermission('SUPER_ADMIN', 'settings')).toBe(true);
    expect(hasPermission(null, 'dashboard')).toBe(false);
  });
});

describe('isAdminRole', () => {
  it('accepts only a real role', () => {
    for (const role of ADMIN_ROLES) expect(isAdminRole(role)).toBe(true);
    expect(isAdminRole('OWNER')).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});
