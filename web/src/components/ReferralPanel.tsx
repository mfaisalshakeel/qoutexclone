import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { CopyButton } from './Copy';
import { Skeleton, SkeletonGroup } from './Skeleton';

interface ReferralState {
  code: string;
  earnings: number;
  commissionPct: number;
  referrals: { id: string; name: string; joinedAt: string; deposited: number }[];
  commissions: { id: string; amount: number; rate: number; createdAt: string }[];
}

/** Partner programme: share a link, earn a cut of referred deposits. */
export function ReferralPanel() {
  const [state, setState] = useState<ReferralState | null>(null);

  useEffect(() => {
    api
      .get<ReferralState>('/me/referrals')
      .then(setState)
      .catch(() => undefined);
  }, []);

  if (!state) {
    return (
      <SkeletonGroup label="Loading partner programme" className="card space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-2.5 w-56 max-w-full" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Skeleton className="h-2 w-12" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1 !rounded-lg" />
          <Skeleton className="h-10 w-16 !rounded-lg" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-14 !rounded-lg" />
          <Skeleton className="h-14 !rounded-lg" />
        </div>
      </SkeletonGroup>
    );
  }
  const link = `${location.origin}/register?ref=${state.code}`;

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Partner programme</h2>
          <p className="text-xs text-slate-500">
            Earn {state.commissionPct}% of every deposit made by traders you invite
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Earned</p>
          <p className="tabular text-base font-bold text-up">{money(state.earnings)}</p>
        </div>
      </div>

      <div>
        <p className="label">Your invite link</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-700 px-3 py-2.5 font-mono text-[11px]">
            {link}
          </code>
          <CopyButton value={link} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-ink-700/60 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Traders invited</p>
          <p className="tabular text-sm font-bold">{state.referrals.length}</p>
        </div>
        <div className="rounded-lg bg-ink-700/60 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Commissions paid</p>
          <p className="tabular text-sm font-bold">{state.commissions.length}</p>
        </div>
      </div>

      {state.referrals.length > 0 && (
        <ul className="divide-y divide-ink-700 rounded-lg bg-ink-700/40">
          {state.referrals.slice(0, 8).map((referral) => (
            <li key={referral.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{referral.name}</span>
                <span className="block text-[10px] text-slate-500">joined {dateTime(referral.joinedAt)}</span>
              </span>
              <span className="tabular text-xs text-slate-300">{money(referral.deposited)} deposited</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
