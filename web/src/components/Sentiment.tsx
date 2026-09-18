interface Props {
  sentiment?: {
    upPct: number;
    downPct: number;
    trades: number;
    stake: number;
    meaningful: boolean;
  } | null;
  minTrades: number;
}

/**
 * What the crowd is doing on this market: the share of staked money on each
 * side over the recent window.
 *
 * Below the threshold it says so rather than drawing a bar, because a 100/0
 * split from one position is noise dressed as information — and a trader who
 * acts on it has been misled by the platform.
 */
export function Sentiment({ sentiment, minTrades }: Props) {
  if (!sentiment) return null;

  if (!sentiment.meaningful) {
    return (
      <div className="text-[10px] text-slate-500">
        {sentiment.trades > 0
          ? `Not enough activity yet — ${sentiment.trades} of ${minTrades} positions`
          : 'No recent positions on this market'}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px] font-semibold">
        <span className="text-up">{sentiment.upPct}% higher</span>
        <span className="text-slate-500">
          {sentiment.trades} position{sentiment.trades === 1 ? '' : 's'}
        </span>
        <span className="text-down">{sentiment.downPct}% lower</span>
      </div>
      <div
        className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-ink-700"
        role="img"
        aria-label={`${sentiment.upPct}% of staked money is on higher, ${sentiment.downPct}% on lower, across ${sentiment.trades} positions`}
      >
        <div className="bg-up transition-[width] duration-500" style={{ width: `${sentiment.upPct}%` }} />
        <div className="bg-down transition-[width] duration-500" style={{ width: `${sentiment.downPct}%` }} />
      </div>
    </div>
  );
}
