import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { realtime } from '../../lib/ws';
import { useAuth } from '../../store/auth';
import { useRealtime } from '../../hooks/useRealtime';
import { ErrorBoundary } from '../ErrorBoundary';
import { Toasts } from '../Toasts';
import { IconLogo } from '../Icons';

export interface AdminCounts {
  pendingWithdrawals: number;
  pendingDeposits: number;
  pendingKyc: number;
  openTickets: number;
  liveTournaments: number;
}

const SECTIONS: { label: string; items: { to: string; label: string; badge?: keyof AdminCounts }[] }[] = [
  {
    label: 'Overview',
    items: [{ to: '/admin', label: 'Dashboard' }],
  },
  {
    label: 'Money',
    items: [
      { to: '/admin/withdrawals', label: 'Withdrawals', badge: 'pendingWithdrawals' },
      { to: '/admin/deposits', label: 'Deposits', badge: 'pendingDeposits' },
    ],
  },
  {
    label: 'Traders',
    items: [
      { to: '/admin/users', label: 'Users' },
      { to: '/admin/kyc', label: 'Verification', badge: 'pendingKyc' },
      { to: '/admin/support', label: 'Support', badge: 'openTickets' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/admin/tournaments', label: 'Tournaments', badge: 'liveTournaments' },
      { to: '/admin/promos', label: 'Promo codes' },
      { to: '/admin/assets', label: 'Markets' },
      { to: '/admin/audit', label: 'Audit log' },
    ],
  },
];

/**
 * Back-office shell: fixed sidebar on desktop, slide-over drawer on phones,
 * with live counters on the queues that need attention.
 */
export function AdminLayout() {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  const [counts, setCounts] = useState<AdminCounts | null>(null);
  const [drawer, setDrawer] = useState(false);

  useRealtime();

  const loadCounts = () =>
    api
      .get<AdminCounts>('/admin/overview')
      .then(setCounts)
      .catch(() => undefined);

  useEffect(() => {
    void loadCounts();
    const id = window.setInterval(loadCounts, 30000);
    const offs = [
      realtime.on('support:incoming', loadCounts),
      realtime.on('withdrawal:updated', loadCounts),
      realtime.on('deposit:updated', loadCounts),
    ];
    return () => {
      window.clearInterval(id);
      offs.forEach((off) => off());
    };
  }, []);

  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);

  // Escape closes the drawer, as it does for any modal surface
  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-700 px-4">
        <IconLogo className="h-7 w-7" />
        <span className="text-sm font-bold tracking-tight">Quantex</span>
        <span className="chip ml-auto bg-accent-soft text-accent">admin</span>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {section.label}
            </p>
            {section.items.map((item) => {
              const badge = item.badge && counts ? counts[item.badge] : 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/admin'}
                  className={({ isActive }) =>
                    `mb-0.5 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                      isActive
                        ? 'bg-accent-soft font-semibold text-accent'
                        : 'text-slate-400 hover:bg-ink-700 hover:text-slate-100'
                    }`
                  }
                >
                  <span className="flex-1">{item.label}</span>
                  {badge > 0 && (
                    <span className="rounded-full bg-down px-1.5 text-[10px] font-bold text-white">
                      {badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-ink-700 p-3">
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-600 text-xs font-semibold uppercase">
            {user?.name?.[0] ?? 'A'}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold">{user?.name}</span>
            <span className="block truncate text-[10px] text-slate-500">{user?.email}</span>
          </span>
        </div>
        <Link to="/trade" className="btn-ghost w-full !py-2 text-xs">
          Back to terminal
        </Link>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-ink-900">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-ink-700 bg-ink-800/60 lg:block">
        {nav}
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* a real button, so the backdrop is reachable by keyboard and screen readers */}
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink-900/70 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-ink-600 bg-ink-800 shadow-2xl">
            {nav}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-700 bg-ink-900/95 px-4 backdrop-blur lg:hidden">
          <button
            onClick={() => setDrawer(true)}
            className="btn-ghost !px-2.5 !py-2"
            aria-label="Open navigation"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          <span className="text-sm font-bold">Administration</span>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>

        <Toasts />
      </div>
    </div>
  );
}
