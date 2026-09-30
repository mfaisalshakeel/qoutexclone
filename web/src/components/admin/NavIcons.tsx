/**
 * One line icon per back-office section, keyed by route. Stroke-only 24px
 * glyphs so they inherit `currentColor` and read in both themes; drawn here
 * rather than pulled from a pack to keep the bundle free of one.
 */
const PATHS: Record<string, JSX.Element> = {
  '/admin': (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="10" width="7" height="11" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  '/admin/withdrawals': (
    <>
      <path d="M12 19V5M12 5l-5 5M12 5l5 5" />
      <path d="M4 21h16" />
    </>
  ),
  '/admin/deposits': (
    <>
      <path d="M12 5v14M12 19l5-5M12 19l-5-5" />
      <path d="M4 3h16" />
    </>
  ),
  '/admin/payment-methods': (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19" />
    </>
  ),
  '/admin/ledger': (
    <>
      <path d="M5 4h11l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M8 12h8M8 16h5" />
    </>
  ),
  '/admin/referrals': (
    <>
      <circle cx="7" cy="8" r="3" />
      <circle cx="17" cy="16" r="3" />
      <path d="M9.5 9.8l5 4.4" />
    </>
  ),
  '/admin/users': (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 11a3 3 0 1 0-1.5-5.6M17.5 20a4.8 4.8 0 0 0-2.2-4" />
    </>
  ),
  '/admin/kyc': (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M5.5 16.5a4 4 0 0 1 7 0M14.5 10h4M14.5 13.5h3" />
    </>
  ),
  '/admin/trades': (
    <>
      <path d="M4 18l5-5 3.5 3L20 8" />
      <path d="M15 8h5v5" />
    </>
  ),
  '/admin/support': (
    <>
      <path d="M21 12a8 8 0 1 1-3.5-6.6" />
      <path d="M8 11h8M8 14.5h5" />
    </>
  ),
  '/admin/tournaments': (
    <>
      <path d="M8 4h8v5a4 4 0 1 1-8 0V4z" />
      <path d="M8 6H5.5a3 3 0 0 0 3 3M16 6h2.5a3 3 0 0 1-3 3" />
      <path d="M10 20h4M12 13v7" />
    </>
  ),
  '/admin/content': (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </>
  ),
  '/admin/promos': (
    <>
      <path d="M3 8.5A2.5 2.5 0 0 0 5.5 6H19a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 0 3 15.5z" />
      <path d="M9 10.5l6 3" />
    </>
  ),
  '/admin/bonus-offers': (
    <>
      <rect x="3" y="9" width="18" height="11" rx="2" />
      <path d="M3 13h18M12 9v11" />
      <path d="M12 9c-2.5 0-4-1-4-2.4S9.5 4 12 9zM12 9c2.5 0 4-1 4-2.4S14.5 4 12 9z" />
    </>
  ),
  '/admin/marketplace-items': (
    <>
      <path d="M4 8h16l-1 12H5z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  '/admin/marketplace-orders': (
    <>
      <path d="M4 5h2l2 11h10l2-7H7" />
      <circle cx="10" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </>
  ),
  '/admin/assets': (
    <>
      <path d="M4 19V5M20 19H4" />
      <path d="M8 16V11M12 16V7M16 16v-3" />
    </>
  ),
  '/admin/schedules': (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
    </>
  ),
  '/admin/price-engine': (
    <>
      <path d="M3 17l4-6 4 3 4-7 6 10" />
      <circle cx="7" cy="11" r="1.2" />
    </>
  ),
  '/admin/payouts': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M14.5 9.5a2.8 2.8 0 0 0-2.5-1.3c-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.7 2.5 2-1 2-2.5 2a2.8 2.8 0 0 1-2.5-1.3" />
    </>
  ),
  '/admin/risk': (
    <>
      <path d="M12 3l8 3.5V12c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6.5z" />
      <path d="M12 9v4M12 16h.01" />
    </>
  ),
  '/admin/email': (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5l8.5 6 8.5-6" />
    </>
  ),
  '/admin/staff': (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M17.5 4.5l1.2 1.2 2.3-2.3" />
    </>
  ),
  '/admin/settings': (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8l1.2 2.2 2.5-.4.5 2.5 2.2 1.2-1.2 2.2 1.2 2.2-2.2 1.2-.5 2.5-2.5-.4L12 21.2l-1.2-2.2-2.5.4-.5-2.5-2.2-1.2L6.8 12 5.6 9.8l2.2-1.2.5-2.5 2.5.4z" />
    </>
  ),
  '/admin/audit': (
    <>
      <path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M13.5 4v5.5H19" />
      <path d="M8 14h7M8 17h4" />
    </>
  ),
};

const FALLBACK = <circle cx="12" cy="12" r="7.5" />;

export function NavIcon({ to, className = 'h-[18px] w-[18px]' }: { to: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[to] ?? FALLBACK}
    </svg>
  );
}
