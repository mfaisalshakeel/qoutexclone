import { create } from 'zustand';

const KEY = 'qx.tournament';

interface TradingAccountState {
  /** set while the trader is playing a tournament instead of demo/real */
  tournamentId: string | null;
  tournamentName: string | null;
  tournamentBalance: number | null;
  /** null means the tournament offers every market. */
  allowedAssetIds: string[] | null;
  setTournament: (
    value: { id: string; name: string; balance: number; allowedAssetIds: string[] | null } | null,
  ) => void;
  setBalance: (balance: number) => void;
}

export const useTradingAccount = create<TradingAccountState>((set) => ({
  tournamentId: localStorage.getItem(KEY),
  tournamentName: null,
  tournamentBalance: null,
  allowedAssetIds: null,

  setTournament(value) {
    if (value) {
      localStorage.setItem(KEY, value.id);
      set({
        tournamentId: value.id,
        tournamentName: value.name,
        tournamentBalance: value.balance,
        allowedAssetIds: value.allowedAssetIds,
      });
    } else {
      localStorage.removeItem(KEY);
      set({ tournamentId: null, tournamentName: null, tournamentBalance: null, allowedAssetIds: null });
    }
  },

  setBalance(balance) {
    set({ tournamentBalance: balance });
  },
}));
