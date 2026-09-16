import { create } from 'zustand';

const KEY = 'qx.tournament';

interface TradingAccountState {
  /** set while the trader is playing a tournament instead of demo/real */
  tournamentId: string | null;
  tournamentName: string | null;
  tournamentBalance: number | null;
  setTournament: (value: { id: string; name: string; balance: number } | null) => void;
  setBalance: (balance: number) => void;
}

export const useTradingAccount = create<TradingAccountState>((set) => ({
  tournamentId: localStorage.getItem(KEY),
  tournamentName: null,
  tournamentBalance: null,

  setTournament(value) {
    if (value) {
      localStorage.setItem(KEY, value.id);
      set({ tournamentId: value.id, tournamentName: value.name, tournamentBalance: value.balance });
    } else {
      localStorage.removeItem(KEY);
      set({ tournamentId: null, tournamentName: null, tournamentBalance: null });
    }
  },

  setBalance(balance) {
    set({ tournamentBalance: balance });
  },
}));
