import { useEffect } from 'react';
import { realtime } from '../lib/ws';
import { useAuth } from '../store/auth';
import { useTradingAccount } from '../store/tradingAccount';
import { useMarket } from '../store/market';
import { toast } from '../store/toast';
import { money } from '../lib/format';

/**
 * Wires the socket into the stores once, at the app shell level: quotes feed
 * the market store, settled trades patch the balance and raise a toast.
 */
export function useRealtime(): void {
  const setPrices = useMarket((s) => s.setPrices);
  const setConnected = useMarket((s) => s.setConnected);
  const patchBalance = useAuth((s) => s.patchBalance);
  const refreshUser = useAuth((s) => s.refreshUser);

  useEffect(() => {
    realtime.connect();
    const offQuotes = realtime.on('quotes', ({ prices }) => setPrices(prices));
    const offStatus = realtime.on('status', ({ connected }) => setConnected(connected));

    const offSettled = realtime.on('trade:settled', ({ trade, balance, accountType }) => {
      if (accountType === 'TOURNAMENT') useTradingAccount.getState().setBalance(balance);
      else patchBalance(accountType, balance);

      if (trade.status === 'WON') {
        toast.success(`${trade.symbol} won`, `+${money(trade.profit)} profit credited`);
      } else if (trade.status === 'LOST') {
        toast.error(`${trade.symbol} lost`, `${money(trade.stake)} stake`);
      } else {
        toast.info(`${trade.symbol} refunded`, 'Price closed exactly at entry');
      }
    });

    const offDeposit = realtime.on('deposit:updated', ({ deposit }) => {
      if (deposit.status === 'COMPLETED') {
        toast.success('Deposit credited', `${deposit.cryptoAmount} ${deposit.currency} → ${money(deposit.creditedAmount)}`);
        void refreshUser();
      } else if (deposit.status === 'CONFIRMING') {
        toast.info('Payment detected', `Waiting for ${deposit.requiredConf} confirmations`);
      }
    });

    const offWithdrawal = realtime.on('withdrawal:updated', ({ withdrawal }) => {
      if (withdrawal.status === 'COMPLETED') {
        toast.success('Withdrawal sent', `${withdrawal.cryptoAmount} ${withdrawal.currency} on its way`);
      } else if (withdrawal.status === 'REJECTED') {
        toast.error('Withdrawal rejected', withdrawal.adminNote ?? 'Funds returned to your balance');
      }
      void refreshUser();
    });

    return () => {
      offQuotes();
      offStatus();
      offSettled();
      offDeposit();
      offWithdrawal();
    };
  }, [setPrices, setConnected, patchBalance, refreshUser]);
}
