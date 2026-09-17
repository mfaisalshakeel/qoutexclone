import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { Skeleton, SkeletonGroup } from './Skeleton';

export function ProtectedRoute({
  children,
  adminOnly = false,
}: {
  children: ReactNode;
  adminOnly?: boolean;
}) {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <SkeletonGroup label="Loading your account" className="flex h-screen flex-col bg-ink-900">
        <div className="flex h-14 items-center gap-3 border-b border-ink-700 px-3 sm:px-4">
          <Skeleton className="h-8 w-8 !rounded-lg" />
          <div className="ml-4 hidden gap-2 md:flex">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-3 w-14" />
            ))}
          </div>
          <Skeleton className="ml-auto h-9 w-32 !rounded-lg" />
          <Skeleton className="h-9 w-9 !rounded-full" />
        </div>
        <div className="flex min-h-0 flex-1 gap-2 p-2">
          <Skeleton className="hidden w-60 !rounded-xl md:block" />
          <Skeleton className="flex-1 !rounded-xl" />
          <Skeleton className="hidden w-72 !rounded-xl md:block" />
        </div>
      </SkeletonGroup>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (adminOnly && user.role !== 'ADMIN') return <Navigate to="/trade" replace />;
  return <>{children}</>;
}
