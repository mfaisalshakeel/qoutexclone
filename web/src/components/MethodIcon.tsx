/**
 * A generic, original glyph per payment method — never a real brand's logo.
 * Crypto gets a coloured ticker badge; card and e-wallet get a plain
 * pictogram, since neither is a "currency" the same way.
 */
const CURRENCY_TONE: Record<string, string> = {
  BTC: 'bg-orange-500/15 text-orange-400',
  ETH: 'bg-indigo-500/15 text-indigo-300',
  USDT: 'bg-emerald-500/15 text-emerald-400',
  USD: 'bg-sky-500/15 text-sky-300',
};

export function MethodIcon({
  currency,
  network,
  className = 'h-9 w-9 text-[10px]',
}: {
  currency: string;
  network: string;
  className?: string;
}) {
  const tone = CURRENCY_TONE[currency] ?? 'bg-ink-600 text-slate-200';
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-bold ${tone} ${className}`}>
      {network === 'CARD' ? <CardGlyph /> : network === 'EWALLET' ? <WalletGlyph /> : currency}
    </span>
  );
}

function CardGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function WalletGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <circle cx="16" cy="13" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
