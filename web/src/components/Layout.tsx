import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { useMarket } from '../store/market';
import { useRealtime } from '../hooks/useRealtime';
import { BalanceSwitcher } from './BalanceSwitcher';
import { ErrorBoundary } from './ErrorBoundary';
import { SupportChat } from './SupportChat';
import { Toasts } from './Toasts';
import { IconChart, IconCup, IconHistory, IconLogo, IconShield, IconUser, IconWallet } from './Icons';

const NAV = [
  { to: '/trade', label: 'Trade', icon: IconChart },
  { to: '/tournaments', label: 'Events', icon: IconCup },
  { to: '/wallet', label: 'Wallet', icon: IconWallet },
  { to: '/history', label: 'History', icon: IconHistory },
  { to: '/leaderboard', label: 'Top', icon: IconCup },
  { to: '/account', label: 'Account', icon: IconUser },
];

export function Layout() {
  const { user, logout } = useAuth();
  const connected = useMarket((s) => s.connected);
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
            <BalanceSwitcher />
            <Link to="/wallet?tab=deposit" className="btn-primary hidden !px-3 !py-2 sm:inline-flex">
              Deposit
            </Link>

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

      <main
        className={`flex-1 pb-20 md:pb-0 ${isTerminal ? '' : 'mx-auto w-full max-w-[1400px] px-3 py-5 sm:px-4'}`}
      >
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-ink-700 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map((item) => (
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
      <Toasts />
    </div>
  );
}
