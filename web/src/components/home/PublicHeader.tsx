import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { IconLogo } from '../Icons';

const NAV_LINKS = [
  { to: '/markets', label: 'Markets' },
  { to: '/tournaments/overview', label: 'Tournaments' },
  { to: '/status', label: 'Status levels' },
  { to: '/affiliate', label: 'Affiliate' },
  { to: '/help', label: 'Help' },
  { to: '/about', label: 'About' },
];

/** The header every public (logged-out) page shares, with a mobile menu below `md`. */
export function PublicHeader() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <header className="relative mx-auto flex max-w-6xl items-center gap-4 px-4 py-5">
      <Link to="/" className="flex shrink-0 items-center gap-2">
        <IconLogo className="h-8 w-8" />
        <span className="text-lg font-bold tracking-tight">Quantex</span>
      </Link>
      <nav aria-label="Site" className="hidden min-w-0 flex-1 items-center gap-1 md:flex">
        {NAV_LINKS.map((link) => {
          const active = location.pathname === link.to;
          return (
            <Link
              key={link.to}
              to={link.to}
              aria-current={active ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <nav className="ml-auto hidden shrink-0 items-center gap-2 md:flex">
        <Link to="/login" className="btn-ghost !px-3 !py-2">
          Sign in
        </Link>
        <Link to="/register" className="btn-primary !px-3 !py-2">
          Start trading
        </Link>
      </nav>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="public-nav-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="btn-ghost ml-auto !px-3 !py-2 md:hidden"
      >
        {open ? '✕' : '☰'}
      </button>

      {open && (
        <div
          id="public-nav-menu"
          className="absolute inset-x-4 top-full z-40 mt-2 rounded-xl border border-ink-600 bg-ink-800 p-2 shadow-xl md:hidden"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-ink-700"
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-2 flex gap-2 border-t border-ink-700 pt-2">
            <Link to="/login" onClick={() => setOpen(false)} className="btn-ghost flex-1 justify-center">
              Sign in
            </Link>
            <Link to="/register" onClick={() => setOpen(false)} className="btn-primary flex-1 justify-center">
              Start trading
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
