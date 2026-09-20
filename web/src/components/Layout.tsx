import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useMarket } from '../store/market';
import { useSupport } from '../store/support';
import { useRealtime } from '../hooks/useRealtime';
import { BalanceSwitcher } from './BalanceSwitcher';
import { ErrorBoundary } from './ErrorBoundary';
import { SupportChat } from './SupportChat';
import { SessionReminder } from './SessionReminder';
import { NotificationCentre } from './NotificationCentre';
import { Toasts } from './Toasts';
import { ExclusionBanner, VerifyEmailBanner } from './VerifyEmailBanner';
import { IconChart, IconCup, IconHistory, IconLogo, IconShield, IconUser, IconWallet } from './Icons';

const NAV = [
  { to: '/trade', label: 'Trade', icon: IconChart },
  { to: '/tournaments', label: 'Events', icon: IconCup },
  { to: '/wallet', label: 'Wallet', icon: IconWallet },
  { to: '/history', label: 'History', icon: IconHistory },
  { to: '/leaderboard', label: 'Top', icon: IconCup },
  { to: '/account', label: 'Account', icon: IconUser },
];

/**
 * The phone's bottom bar holds five, because a sixth wraps to a second row and
 * eats a chunk of a 390px screen. The leaderboard is one tap away in the
 * account menu, which is where the rest of the account lives anyway.
 */
const MOBILE_NAV = NAV.filter((item) => item.to !== '/leaderboard');

export function Layout() {
  const { user, logout } = useAuth();
  const connected = useMarket((s) => s.connected);
  const openSupport = useSupport((s) => s.setOpen);
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useRealtime();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const isTerminal = location.pathname.startsWith('/trade');
  const nav = user?.role === 'ADMIN' ? [...NAV, { to: '/admin', label: 'Admin', icon: IconShield }] : NAV;

  return (
    <div className="flex min-h-full flex-col bg-ink-900">
      <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-3 px-3 sm:px-4">
          <Link to="/trade" className="flex items-center gap-2">
            <IconLogo />
            <span className="hidden text-base font-bold tracking-tight sm:block">Quantex</span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-ink-700 text-white' : 'text-slate-400 hover:text-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span
              title={connected ? 'Live market data connected' : 'Reconnecting…'}
              className={`hidden h-2 w-2 rounded-full sm:block ${connected ? 'bg-up' : 'bg-amber-400'}`}
            />
            <NotificationCentre />
            <BalanceSwitcher />
            <Link to="/wallet?tab=deposit" className="btn-primary hidden !px-3 !py-2 sm:inline-flex">
              Deposit
            </Link>

            {/* the level belongs in the header, where the trader sees what
                their deposits have bought them without going looking */}
            {user?.statusLevel?.enabled && (
              <Link
                to="/account/status"
                title={`${user.statusLevel.name} status`}
                className="hidden items-center rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/25 lg:inline-flex"
              >
                {user.statusLevel.name}
              </Link>
            )}

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-600 text-sm font-semibold uppercase text-slate-200 transition hover:bg-ink-500"
              >
                {user?.name?.[0] ?? '?'}
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-30 mt-2 w-52 animate-fade-up rounded-xl border border-ink-500 bg-ink-800 p-1.5 shadow-2xl">
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-semibold">{user?.name}</p>
                    <p className="truncate text-xs text-slate-400">{user?.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {user?.statusLevel?.enabled && (
                        <span className="chip bg-accent/15 text-accent">{user.statusLevel.name}</span>
                      )}
                      {user?.experience?.enabled && (
                        <span className="chip bg-ink-600 text-slate-300">Level {user.experience.level}</span>
                      )}
                    </div>
                  </div>
                  <div className="my-1 h-px bg-ink-600" />
                  {nav.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className="block rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-ink-700"
                    >
                      {item.label}
                    </Link>
                  ))}
                  <Link
                    to="/account/limits"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-ink-700"
                  >
                    Responsible trading
                  </Link>
                  <Link
                    to="/marketplace"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-ink-700"
                  >
                    Marketplace
                  </Link>
                  <Link
                    to="/account/progress"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-ink-700"
                  >
                    Progress
                  </Link>
                  <Link
                    to="/account/status"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-ink-700"
                  >
                    Status
                  </Link>
                  <Link
                    to="/account/security"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-ink-700"
                  >
                    Security
                  </Link>
                  {/* the terminal's dock covers the floating launcher on a
                      phone, so support is reachable from here too */}
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      openSupport(true);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-ink-700"
                  >
                    Support
                  </button>
                  <div className="my-1 h-px bg-ink-600" />
                  <button
                    onClick={async () => {
                      setMenuOpen(false);
                      await logout();
                      navigate('/login');
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-down transition hover:bg-down-soft"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* the terminal is full-bleed and sized to the viewport, so a strip
          above it would push the chart off the screen: it nags everywhere else */}
      {!isTerminal && <ExclusionBanner />}
      {!isTerminal && <VerifyEmailBanner />}

      <main
        className={`app-main flex-1 ${isTerminal ? '' : 'mx-auto w-full max-w-[1400px] px-3 py-5 sm:px-4'}`}
      >
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <nav
        aria-label="Sections"
        className="app-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-ink-700 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {MOBILE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition ${
                isActive ? 'text-accent' : 'text-slate-500'
              }`
            }
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <SupportChat />
      <SessionReminder />
      <Toasts />
    </div>
  );
}
