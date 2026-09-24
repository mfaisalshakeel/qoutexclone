import type { ReactNode } from 'react';
import { useAuth } from '../../store/auth';
import { hasArea, type PermissionArea } from '../../lib/permissions';

/**
 * Guards one admin page by permission area, on top of nav links already
 * hiding the ones a role can't use — a direct URL still has to land
 * somewhere, and this is what it lands on instead of a page quietly making
 * requests the server is about to refuse.
 */
export function RequireArea({ area, children }: { area: PermissionArea; children: ReactNode }) {
  const { user } = useAuth();
  if (!hasArea(user?.permissions, area)) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm font-semibold text-slate-200">Not available for your role</p>
        <p className="mt-1 text-xs text-slate-500">
          Your admin role doesn't include access to this section. Ask a super admin if you need it.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
